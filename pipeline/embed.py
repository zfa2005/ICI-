"""
Stage 3 — Embedding + vector index.

Builds two persistent ChromaDB collections over the Stage-1 store, each doc
tagged with the master row id + filterable metadata (state, year, type, subtype,
score, source_type, source_url) so Chroma can pre-filter inside the ANN query:

  descriptions   one doc per law (description + provision_description), no chunking
  legal_fulltext 641 bill texts + 1,455 MOA texts, word-chunked with overlap

Embeddings use sentence-transformers (config.EMBED_MODEL, default bge-small-en).
`search_laws()` embeds a query and does an ANN search with optional metadata
pre-filter. It is NOT wired to the model yet — Stage 4 adds reranking on top.

Run:  python pipeline/embed.py            # build both collections
      python pipeline/embed.py --descriptions-only
"""

from __future__ import annotations

import argparse
import sqlite3
import sys

import pandas as pd

import config as C
import tools  # reuse the MOA text loader + conn


# ── lazy singletons ──────────────────────────────────────────────────────────
_model = None
_client = None


def get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        print(f"loading embedding model: {C.EMBED_MODEL} …")
        _model = SentenceTransformer(C.EMBED_MODEL)
    return _model


def get_client():
    global _client
    if _client is None:
        import chromadb
        C.CHROMA_DIR.mkdir(parents=True, exist_ok=True)
        _client = chromadb.PersistentClient(path=str(C.CHROMA_DIR))
    return _client


def _nn(v):
    """None if the value is missing (handles pandas NA *and* Python None)."""
    try:
        if v is None or pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    return v


def _meta(row) -> dict:
    """Chroma metadata must be str/int/float/bool — drop missing, coerce types.
    Called from both the parquet (pandas NA) and sqlite (Python None) paths."""
    m = {
        "law_id": int(row["law_id"]),
        "source_type": str(_nn(row.get("source_type")) or ""),
        "source": str(_nn(row.get("source")) or ""),
        "type": str(_nn(row.get("type")) or ""),
        "subtype": str(_nn(row.get("subtype")) or ""),
    }
    st = _nn(row.get("state_norm"))
    if st:
        m["state"] = str(st)
    yr = _nn(row.get("year"))
    if yr is not None:
        m["year"] = int(yr)
    sc = _nn(row.get("score"))
    if sc is not None:
        m["score"] = int(sc)
    su = _nn(row.get("source_url"))
    if su:
        m["source_url"] = str(su)
    return m


def _embed(texts: list[str]):
    # bge models recommend normalized embeddings for cosine similarity.
    return get_model().encode(texts, batch_size=64, normalize_embeddings=True,
                              show_progress_bar=True).tolist()


# ── descriptions collection ──────────────────────────────────────────────────
def build_descriptions():
    laws = pd.read_parquet(C.PARQUET_PATH)
    laws["text"] = (laws["description"].fillna("").astype(str) + " "
                    + laws["provision_description"].fillna("").astype(str)).str.strip()
    laws = laws[laws["text"] != ""]
    print(f"descriptions: {len(laws):,} docs")

    client = get_client()
    try:
        client.delete_collection(C.COLLECTION_DESCRIPTIONS)
    except Exception:
        pass
    col = client.create_collection(C.COLLECTION_DESCRIPTIONS, metadata={"hnsw:space": "cosine"})

    ids = [f"desc-{int(i)}" for i in laws["law_id"]]
    docs = laws["text"].tolist()
    metas = [_meta(r) for _, r in laws.iterrows()]
    embs = _embed(docs)

    B = 2000
    for i in range(0, len(ids), B):
        col.add(ids=ids[i:i+B], documents=docs[i:i+B], embeddings=embs[i:i+B], metadatas=metas[i:i+B])
    print(f"descriptions collection: {col.count():,} vectors")


# ── legal_fulltext collection ────────────────────────────────────────────────
def _chunk(words: list[str]):
    step = C.CHUNK_WORDS - C.CHUNK_OVERLAP_WORDS
    for i in range(0, max(1, len(words)), step):
        yield " ".join(words[i:i + C.CHUNK_WORDS])
        if i + C.CHUNK_WORDS >= len(words):
            break


def build_legal_fulltext():
    with sqlite3.connect(f"file:{C.SQLITE_PATH}?mode=ro", uri=True) as con:
        con.row_factory = sqlite3.Row
        ft = con.execute(
            "SELECT f.law_id, f.kind, f.ref, l.state_norm, l.year, l.type, l.subtype, "
            "l.score, l.source_type, l.source, l.source_url "
            "FROM fulltext_map f JOIN laws l ON l.law_id = f.law_id WHERE f.has_text=1"
        ).fetchall()
    print(f"legal_fulltext: {len(ft)} source docs to chunk")

    ids, docs, metas = [], [], []
    for r in ft:
        text = tools._load_fulltext(r["kind"], r["ref"])
        if not text or not text.strip():
            continue
        base = _meta(dict(r, state_norm=r["state_norm"]))
        base["kind"] = r["kind"]
        for ci, chunk in enumerate(_chunk(text.split())):
            if not chunk.strip():
                continue
            ids.append(f"ft-{r['law_id']}-{ci}")
            docs.append(chunk)
            metas.append({**base, "chunk": ci})
    print(f"legal_fulltext: {len(docs):,} chunks")

    client = get_client()
    try:
        client.delete_collection(C.COLLECTION_LEGAL)
    except Exception:
        pass
    col = client.create_collection(C.COLLECTION_LEGAL, metadata={"hnsw:space": "cosine"})
    embs = _embed(docs)
    B = 2000
    for i in range(0, len(ids), B):
        col.add(ids=ids[i:i+B], documents=docs[i:i+B], embeddings=embs[i:i+B], metadatas=metas[i:i+B])
    print(f"legal_fulltext collection: {col.count():,} vectors")


# ── search (candidate generation — reranking added in Stage 4) ───────────────
def _where(filters: dict | None):
    if not filters:
        return None
    conds = []
    for key in ("state", "type", "subtype", "source_type", "source"):
        if filters.get(key):
            v = filters[key]
            conds.append({key: str(v).upper() if key in ("state", "type") else str(v)})
    if filters.get("year") is not None:
        conds.append({"year": int(filters["year"])})
    else:
        yr = {}
        if filters.get("year_from") is not None:
            yr["$gte"] = int(filters["year_from"])
        if filters.get("year_to") is not None:
            yr["$lte"] = int(filters["year_to"])
        if yr:
            conds.append({"year": yr})
    if not conds:
        return None
    return conds[0] if len(conds) == 1 else {"$and": conds}


def search_laws(query: str, filters: dict | None = None, k: int = 50,
                collection: str = C.COLLECTION_DESCRIPTIONS) -> list[dict]:
    """Embed the query and ANN-search a collection, with optional metadata
    pre-filter. Returns candidates (id, distance, metadata, text). Candidate
    generation only — Stage 4 reranks these."""
    col = get_client().get_collection(collection)
    # Prefix the query with the model's retrieval instruction (bge asymmetric);
    # passages were embedded without it, which is correct.
    q_text = C.QUERY_INSTRUCTION + query
    q_emb = get_model().encode([q_text], normalize_embeddings=True).tolist()
    res = col.query(query_embeddings=q_emb, n_results=k, where=_where(filters),
                    include=["metadatas", "documents", "distances"])
    out = []
    for i in range(len(res["ids"][0])):
        out.append({
            "law_id": res["metadatas"][0][i].get("law_id"),
            "distance": res["distances"][0][i],
            "metadata": res["metadatas"][0][i],
            "text": res["documents"][0][i][:300],
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--descriptions-only", action="store_true")
    args = ap.parse_args()
    if not C.PARQUET_PATH.exists():
        sys.exit("Run pipeline/ingest.py first (Stage 1).")
    build_descriptions()
    if not args.descriptions_only:
        build_legal_fulltext()
    print("done.")


if __name__ == "__main__":
    main()

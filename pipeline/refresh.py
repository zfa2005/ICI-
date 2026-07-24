"""
Stage 7 — one-command refresh + regression gate.

Re-runs the pipeline end to end for when the master CSV changes:

    ingest (Stage 1)  ->  incremental embed (Stage 3)  ->  eval (Stage 6)  ->  regression check

Incremental embed only re-embeds rows whose text actually changed (content hash),
and deletes vectors for rows that disappeared — so a small edit to the master
doesn't re-embed all 13.5k descriptions.

The regression check compares the fresh eval metrics to the committed baseline
(pipeline/eval_baseline.json) and exits non-zero if any gate metric regressed
beyond tolerance — the "CI check: metrics must not regress" from the plan. Note:
the corpus is gitignored/local-only, so this gate runs locally (and in any env
that has the data); GitHub CI runs only the data-free checks (see
.github/workflows/pipeline-ci.yml).

Usage:
    python pipeline/refresh.py                 # full refresh + regression check
    python pipeline/refresh.py --check          # eval + regression check only
    python pipeline/refresh.py --full-embed     # force a full re-embed
    python pipeline/refresh.py --no-eval         # ingest + embed only
    python pipeline/refresh.py --update-baseline # write current metrics as the new baseline
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys

import pandas as pd

import config as C
import embed
import eval as evalmod
import ingest

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MANIFEST = C.OUT_DIR / "embed_manifest.json"
BASELINE = C.PIPELINE_DIR / "eval_baseline.json"


def _hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


# ── incremental embedding ────────────────────────────────────────────────────
def incremental_embed(force: bool = False) -> dict:
    laws = pd.read_parquet(C.PARQUET_PATH)
    laws["text"] = (laws["description"].fillna("").astype(str) + " "
                    + laws["provision_description"].fillna("").astype(str)).str.strip()
    laws = laws[laws["text"] != ""].copy()
    current = {int(r.law_id): _hash(r.text) for r in laws.itertuples()}

    manifest = {}
    if MANIFEST.exists() and not force:
        manifest = {int(k): v for k, v in json.loads(MANIFEST.read_text(encoding="utf-8")).items()}

    client = embed.get_client()
    try:
        col = client.get_collection(C.COLLECTION_DESCRIPTIONS)
        have = col.count()
    except Exception:
        col = None
        have = 0

    # Full (re)build when forced, when the collection is empty, or when there's
    # no manifest to diff against.
    if force or have == 0 or not manifest or col is None:
        for name in (C.COLLECTION_DESCRIPTIONS,):
            try:
                client.delete_collection(name)
            except Exception:
                pass
        col = client.create_collection(C.COLLECTION_DESCRIPTIONS, metadata={"hnsw:space": "cosine"})
        changed_ids = list(current.keys())
        removed_ids = []
    else:
        changed_ids = [lid for lid, h in current.items() if manifest.get(lid) != h]
        removed_ids = [lid for lid in manifest if lid not in current]

    if changed_ids:
        sub = laws[laws["law_id"].isin(changed_ids)]
        ids = [f"desc-{int(i)}" for i in sub["law_id"]]
        docs = sub["text"].tolist()
        metas = [embed._meta(r) for _, r in sub.iterrows()]
        embs = embed._embed(docs)
        B = 2000
        for i in range(0, len(ids), B):
            col.upsert(ids=ids[i:i+B], documents=docs[i:i+B], embeddings=embs[i:i+B], metadatas=metas[i:i+B])
    if removed_ids:
        col.delete(ids=[f"desc-{int(i)}" for i in removed_ids])

    MANIFEST.write_text(json.dumps({str(k): v for k, v in current.items()}), encoding="utf-8")
    stats = {"changed": len(changed_ids), "removed": len(removed_ids), "total": col.count()}
    print(f"embed: {stats['changed']} changed/new, {stats['removed']} removed, "
          f"collection now {stats['total']:,} vectors")
    return stats


# ── regression gate ──────────────────────────────────────────────────────────
def check_regression(overall: dict, update: bool = False) -> bool:
    base = json.loads(BASELINE.read_text(encoding="utf-8"))
    if update:
        base["overall"] = {k: overall[k] for k in ("MRR", "recall@1", "recall@10", "recall@50")}
        base["generated"] = str(pd.Timestamp.today().date())
        base["model"] = C.EMBED_MODEL
        BASELINE.write_text(json.dumps(base, indent=2) + "\n", encoding="utf-8")
        print(f"baseline updated -> {BASELINE.name}")
        return True

    tol = base.get("tolerance", 0.02)
    fails = []
    print("\nregression gate (vs committed baseline):")
    for m in base["gate_metrics"]:
        cur, ref = overall.get(m), base["overall"][m]
        ok = cur is not None and cur >= ref - tol
        print(f"  {m:10s} current {cur}  baseline {ref}  (tol {tol})  {'OK' if ok else 'REGRESSED'}")
        if not ok:
            fails.append(m)
    if fails:
        print(f"  FAIL — regressed on: {', '.join(fails)}")
        return False
    print("  PASS")
    return True


# ── orchestration ────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="Stage 7 pipeline refresh + regression gate")
    ap.add_argument("--check", action="store_true", help="eval + regression check only")
    ap.add_argument("--full-embed", action="store_true", help="force a full re-embed")
    ap.add_argument("--no-eval", action="store_true", help="ingest + embed only")
    ap.add_argument("--update-baseline", action="store_true", help="write current metrics as baseline")
    args = ap.parse_args()

    if not args.check:
        print("=" * 66, "\nSTEP 1/3 — ingest\n", "=" * 66, sep="")
        ingest.main()
        print("=" * 66, "\nSTEP 2/3 — incremental embed\n", "=" * 66, sep="")
        incremental_embed(force=args.full_embed)
        if args.no_eval:
            print("done (--no-eval).")
            return 0

    print("=" * 66, "\nSTEP 3/3 — eval + regression gate\n", "=" * 66, sep="")
    overall = evalmod.run()
    ok = check_regression(overall, update=args.update_baseline)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
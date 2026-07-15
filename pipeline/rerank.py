"""
Stage 4 — Reranker.

A cross-encoder re-scores the (query, candidate-text) pairs from Stage 3's top-N
and keeps the best few. Bi-encoder recall + cross-encoder precision is the
standard two-stage retrieval pattern: the embedder narrows 13.5k rows to ~50
candidates cheaply; the cross-encoder, which reads query and passage together, is
far more precise but only has to score those ~50.

A small metadata tie-breaker (source='both' > 'manual' > 'automated') nudges
near-ties toward higher-confidence rows, but is deliberately too small to
override a clearly better text match.

`search_and_rerank()` is the full path: embed → ANN top-N → rerank → top-k, with
citation fields attached. Not wired to the model until Stage 5.
"""

from __future__ import annotations

import math
from typing import Any, Optional

import config as C
import embed

_reranker = None


def get_reranker():
    global _reranker
    if _reranker is None:
        from sentence_transformers import CrossEncoder
        print(f"loading reranker: {C.RERANK_MODEL} …")
        _reranker = CrossEncoder(C.RERANK_MODEL)
    return _reranker


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def rerank(query: str, candidates: list[dict], k: int = None) -> list[dict]:
    """Re-score candidates (each must carry 'text' and 'metadata') with the
    cross-encoder; return the top-k, each with a `rerank_score` (0–1) and the
    tie-break already folded in. Pure ranking — no side effects."""
    k = k or C.RERANK_TOP_K
    if not candidates:
        return []
    pairs = [[query, c.get("text") or ""] for c in candidates]
    raw = get_reranker().predict(pairs)  # raw logits
    scored = []
    for c, s in zip(candidates, raw):
        src = (c.get("metadata") or {}).get("source", "")
        score = _sigmoid(float(s)) + C.SOURCE_TIEBREAK.get(src, 0.0)
        scored.append({**c, "rerank_score": round(score, 4)})
    scored.sort(key=lambda x: x["rerank_score"], reverse=True)
    return scored[:k]


def search_and_rerank(query: str, filters: Optional[dict] = None,
                      k_candidates: int = None, k_final: int = None,
                      collection: str = C.COLLECTION_DESCRIPTIONS) -> list[dict]:
    """Full retrieval path: Stage-3 ANN candidates → cross-encoder rerank → top-k.
    Returns groundable rows (law_id, rerank_score, citation metadata, text)."""
    k_candidates = k_candidates or C.RERANK_CANDIDATES
    k_final = k_final or C.RERANK_TOP_K
    candidates = embed.search_laws(query, filters=filters, k=k_candidates, collection=collection)
    top = rerank(query, candidates, k=k_final)
    out = []
    for r in top:
        m = r.get("metadata") or {}
        out.append({
            "law_id": r.get("law_id"),
            "rerank_score": r["rerank_score"],
            "state": m.get("state"),
            "year": m.get("year"),
            "type": m.get("type"),
            "subtype": m.get("subtype"),
            "score": m.get("score"),
            "source_type": m.get("source_type"),
            "source": m.get("source"),
            "source_url": m.get("source_url"),   # citation
            "text": r.get("text"),
        })
    return out


if __name__ == "__main__":
    import sys
    q = sys.argv[1] if len(sys.argv) > 1 else "Idaho requiring proof of citizenship to get a driver's license"
    for i, r in enumerate(search_and_rerank(q), 1):
        print(f"{i:2d}. law {r['law_id']} [{r['type']}/{r['subtype']} {r['state']}/{r['year']} "
              f"score={r['score']}] rr={r['rerank_score']}  {(r['text'] or '')[:80]}")
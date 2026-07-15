"""
Stage 4 accuracy gate — reranked precision vs the no-rerank baseline.

Same 30-query gold set as Stage 3. For each query we take Stage-3's top-50
candidates, then compare the top-8 by raw embedding distance (baseline) against
the top-8 after cross-encoder reranking. Each query has one known target, so the
metric is "target in top-8" (recall@8) and its mean reciprocal rank. The doc's
gate: reranking must beat the no-rerank baseline. Both numbers are logged to
pipeline/out/eval/.

Run:  python pipeline/eval_stage4.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import config as C
import embed
import rerank
from eval_stage3 import GOLD

K_FINAL = C.RERANK_TOP_K
K_CAND = C.RERANK_CANDIDATES


def _rr(rank):  # reciprocal rank, 0 if absent
    return 1.0 / rank if rank else 0.0


def run():
    base_hits = rr_hits = 0
    base_mrr = rr_mrr = 0.0
    gained, lost = [], []

    for query, target, typ in GOLD:
        cands = embed.search_laws(query, k=K_CAND)
        base_ids = [c["law_id"] for c in cands[:K_FINAL]]
        rr_ids = [r["law_id"] for r in rerank.rerank(query, cands, k=K_FINAL)]

        b_rank = base_ids.index(target) + 1 if target in base_ids else None
        r_rank = rr_ids.index(target) + 1 if target in rr_ids else None
        base_hits += int(b_rank is not None)
        rr_hits += int(r_rank is not None)
        base_mrr += _rr(b_rank)
        rr_mrr += _rr(r_rank)
        if r_rank and not b_rank:
            gained.append((typ, target, query))
        if b_rank and not r_rank:
            lost.append((typ, target, query))

    n = len(GOLD)
    result = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "queries": n, "k_candidates": K_CAND, "k_final": K_FINAL,
        "embed_model": C.EMBED_MODEL, "rerank_model": C.RERANK_MODEL,
        "baseline_recall_at_k": round(base_hits / n, 3),
        "reranked_recall_at_k": round(rr_hits / n, 3),
        "baseline_mrr": round(base_mrr / n, 3),
        "reranked_mrr": round(rr_mrr / n, 3),
        "gained": len(gained), "lost": len(lost),
    }

    (C.OUT_DIR / "eval").mkdir(parents=True, exist_ok=True)
    path = C.OUT_DIR / "eval" / f"stage4-{datetime.now(timezone.utc):%Y%m%d}.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")

    beat = result["reranked_recall_at_k"] > result["baseline_recall_at_k"] or (
        result["reranked_recall_at_k"] == result["baseline_recall_at_k"]
        and result["reranked_mrr"] > result["baseline_mrr"])
    print(f"Stage 4 gate — rerank vs baseline (top-{K_FINAL} of {K_CAND} candidates)")
    print(f"  recall@{K_FINAL}: baseline {result['baseline_recall_at_k']:.3f}  ->  "
          f"reranked {result['reranked_recall_at_k']:.3f}")
    print(f"  MRR@{K_FINAL}   : baseline {result['baseline_mrr']:.3f}  ->  "
          f"reranked {result['reranked_mrr']:.3f}")
    print(f"  moved into top-{K_FINAL} by reranking: {len(gained)}   dropped out: {len(lost)}")
    print(f"  logged: {path.relative_to(C.OUT_DIR.parent)}")
    print(f"  gate (rerank beats baseline): {'PASS' if beat else 'FAIL'}")
    if gained:
        for typ, t, q in gained:
            print(f"    + [{typ}] {t}: {q[:60]}")
    return beat


if __name__ == "__main__":
    import sys
    sys.exit(0 if run() else 1)
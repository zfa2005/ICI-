"""
Stage 6 — Retrieval eval harness + logging.

Gold set v1 (from `audit_sample.csv`, 531 stratified rows): use each row's
`description` as a query and ask whether that row is retrieved in the top-k of
the `descriptions` vector index. Reports recall@k, MRR, and per-stratum
(state / local / 287g) breakdowns — the same stratification the human data audit
uses, so retrieval quality and data quality read on the same axes.

Every query's full chain (query, target ids, top-k candidates + scores, rank,
latency) is logged as JSONL to pipeline/out/eval/. A machine + markdown summary
is written alongside.

Gold set v2 (weight by human-confirmed rows, add discovered errors as negative
tests) is NOT possible yet — the C1–C6 audit columns in audit_sample.csv are
still empty. This harness reads them and will switch on automatically once filled.

Run:  python pipeline/eval.py
"""

from __future__ import annotations

import collections
import csv
import json
import sys
import time
from datetime import date, datetime, timezone

import pandas as pd

import config as C
import embed

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows console is cp1252
csv.field_size_limit(10 ** 8)
KS = [1, 5, 10, 20, 50]
MAXK = max(KS)


# ── map audit rows → master law_ids ──────────────────────────────────────────
def _state_norm(s: str):
    up = (s or "").strip().upper().replace(".", "")
    return up or None


def build_gold():
    laws = pd.read_parquet(C.PARQUET_PATH)
    by_url, by_bill, by_desc = (collections.defaultdict(list) for _ in range(3))
    for r in laws.itertuples():
        if r.source_url:
            by_url[str(r.source_url).strip()].append(r.law_id)
        if r.bill_id:
            by_bill[str(r.bill_id).strip()].append(r.law_id)
        d = (r.description or "").strip()
        if d:
            by_desc[(r.source_type, r.state_norm, d)].append(r.law_id)

    with open(C.AUDIT_SAMPLE_CSV, encoding="utf-8-sig", newline="") as f:
        audit = list(csv.DictReader(f))

    gold = []
    for a in audit:
        u, b = (a.get("source_url") or "").strip(), (a.get("bill_id") or "").strip()
        d, st = (a.get("description") or "").strip(), _state_norm(a.get("state"))
        if u and u in by_url:
            targets = by_url[u]
        elif b and b in by_bill:
            targets = by_bill[b]
        elif d and (a["source_type"], st, d) in by_desc:
            targets = by_desc[(a["source_type"], st, d)]
        else:
            continue  # unmapped (none in practice)
        if not d:
            continue
        gold.append({
            "audit_id": a["audit_id"], "stratum": a.get("stratum", ""),
            "source_type": a["source_type"], "query": d, "targets": set(targets),
            "audited": any(a.get(c, "").strip() for c in
                           ("c1_real_policy", "c2_jurisdiction", "c3_year", "c4_type", "c5_subtype", "c6_pos_neg")),
        })
    return gold


# ── run retrieval + metrics ──────────────────────────────────────────────────
def run():
    gold = build_gold()
    print(f"gold set v1: {len(gold)} mapped audit rows "
          f"({sum(g['audited'] for g in gold)} human-audited → gold v2 not active yet)\n")

    # Batch-embed all queries once (bge query prefix), then ANN-search each.
    model = embed.get_model()
    col = embed.get_client().get_collection(C.COLLECTION_DESCRIPTIONS)
    q_texts = [C.QUERY_INSTRUCTION + g["query"] for g in gold]
    q_embs = model.encode(q_texts, batch_size=64, normalize_embeddings=True, show_progress_bar=True).tolist()

    C.LOG_DIR.parent.mkdir(parents=True, exist_ok=True)
    eval_dir = C.OUT_DIR / "eval"
    eval_dir.mkdir(parents=True, exist_ok=True)
    log_path = eval_dir / f"retrieval-eval-{date.today():%Y%m%d}.jsonl"
    logf = open(log_path, "w", encoding="utf-8")

    # accumulators (overall + per source_type stratum)
    def _acc():
        return {"n": 0, **{f"hit@{k}": 0 for k in KS}, "rr": 0.0}
    overall = _acc()
    strata = collections.defaultdict(_acc)

    for g, q_emb in zip(gold, q_embs):
        t0 = time.perf_counter()
        res = col.query(query_embeddings=[q_emb], n_results=MAXK,
                        include=["metadatas", "distances"])
        latency = (time.perf_counter() - t0) * 1000
        ranked = [m.get("law_id") for m in res["metadatas"][0]]
        # rank = 1-based position of the first target law_id
        rank = next((i + 1 for i, lid in enumerate(ranked) if lid in g["targets"]), None)

        for acc in (overall, strata[g["source_type"]]):
            acc["n"] += 1
            if rank:
                acc["rr"] += 1.0 / rank
                for k in KS:
                    if rank <= k:
                        acc[f"hit@{k}"] += 1

        logf.write(json.dumps({
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "audit_id": g["audit_id"], "stratum": g["stratum"], "source_type": g["source_type"],
            "query": g["query"][:200], "target_law_ids": sorted(g["targets"]),
            "rank": rank, "latency_ms": round(latency, 2),
            "topk": [{"law_id": m.get("law_id"), "distance": round(d, 4)}
                     for m, d in zip(res["metadatas"][0][:10], res["distances"][0][:10])],
        }, default=str) + "\n")
    logf.close()

    # ── report ───────────────────────────────────────────────────────────────
    def summarize(acc):
        n = acc["n"] or 1
        return {"n": acc["n"], "MRR": round(acc["rr"] / n, 3),
                **{f"recall@{k}": round(acc[f"hit@{k}"] / n, 3) for k in KS}}

    lines = ["# ICI Stage 6 — Retrieval Eval (gold set v1)\n",
             f"_Generated {datetime.now(timezone.utc).isoformat(timespec='seconds')}; "
             f"model {C.EMBED_MODEL}; {overall['n']} queries from audit_sample.csv._\n",
             "Query = each audited row's `description`; target = that row in the "
             "`descriptions` index. Gold v2 (human-confirmed weighting) pending the C1–C6 audit.\n",
             "## Overall", "| metric | value |", "|---|---|"]
    ov = summarize(overall)
    for k in ("n", "MRR", *[f"recall@{k}" for k in KS]):
        lines.append(f"| {k} | {ov[k]} |")
    lines += ["\n## By stratum (source_type — mirrors the data audit axes)\n",
              "| stratum | n | recall@1 | recall@5 | recall@10 | recall@20 | recall@50 | MRR |",
              "|---|---|---|---|---|---|---|---|"]
    for stype in sorted(strata):
        s = summarize(strata[stype])
        lines.append(f"| {stype} | {s['n']} | {s['recall@1']} | {s['recall@5']} | "
                     f"{s['recall@10']} | {s['recall@20']} | {s['recall@50']} | {s['MRR']} |")

    report = "\n".join(lines) + "\n"
    (eval_dir / "retrieval_eval_report.md").write_text(report, encoding="utf-8")
    (eval_dir / "retrieval_eval_summary.json").write_text(
        json.dumps({"overall": ov, "by_source_type": {s: summarize(strata[s]) for s in strata},
                    "model": C.EMBED_MODEL, "n": overall["n"]}, indent=2), encoding="utf-8")

    # stdout
    print("=== OVERALL ===")
    for k in ("MRR", *[f"recall@{k}" for k in KS]):
        print(f"  {k:10s}: {ov[k]}")
    print("\n=== BY SOURCE_TYPE ===")
    print(f"  {'stratum':8s} {'n':>4s} {'r@1':>6s} {'r@10':>6s} {'r@50':>6s} {'MRR':>6s}")
    for stype in sorted(strata):
        s = summarize(strata[stype])
        print(f"  {stype:8s} {s['n']:>4d} {s['recall@1']:>6} {s['recall@10']:>6} {s['recall@50']:>6} {s['MRR']:>6}")
    print(f"\nlogged: {log_path.relative_to(C.OUT_DIR.parent)}")
    print(f"report: {(eval_dir / 'retrieval_eval_report.md').relative_to(C.OUT_DIR.parent)}")
    return ov


if __name__ == "__main__":
    run()
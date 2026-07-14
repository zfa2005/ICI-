"""
Generate a reviewable correction proposal for the subtype problems (ISSUE-030).

This does NOT change any data. It produces, under pipeline/out/:
  * corrections_proposed.csv  — one row per flagged law, with full context and a
    suggested fix + confidence, ready for the professor to edit/approve. Approved
    rows get copied into pipeline/corrections.csv (which ingest applies).
  * corrections_review.md     — a plain-English summary grouped by pattern, so the
    systematic decisions (36x B/13, 22x P/58, …) can be made once, not row-by-row.

Confidence is deliberately conservative: only unambiguous placeholder-value fixes
(a garbage subtype whose row type + description point to exactly one code) are
marked "high". Everything requiring a real classification judgment is "review".
"""

from __future__ import annotations

import collections

import pandas as pd

import config as C
import taxonomy as TX


def load():
    df = pd.read_parquet(C.PARQUET_PATH)
    df["sub_n"] = df["subtype"].map(TX.normalize_subtype)
    df["type_u"] = df["type"].str.strip().str.upper()
    df["belongs"] = df["sub_n"].map(lambda s: TX.SUBTYPES[s][0] if s in TX.SUBTYPES else None)
    df["known"] = df["sub_n"].isin(list(TX.SUBTYPES))
    return df


def classify(df):
    blank = df["sub_n"] == ""
    unknown = (~blank) & (~df["known"])
    wrong_type = df["known"] & (df["belongs"] != df["type_u"])
    return df[unknown | wrong_type].copy(), unknown, wrong_type


def suggest(row):
    """Conservative suggestion. Returns (set_type, set_subtype, confidence, note)."""
    t, sub, score = row["type_u"], row["sub_n"], row["score"]
    desc = ((row["description"] or "") + " " + (row["provision_description"] or "")).lower()
    absscore = abs(score) if pd.notna(score) else None

    # High-confidence: garbage placeholder subtype where type is already right and
    # the description maps to exactly one code within that type.
    if not row["known"]:  # off-list value
        if t == "V" and ("vote" in desc or "voting" in desc or "noncitizen" in desc or "non-citizen" in desc):
            return ("", "32", "high", "type V confirmed; description is about (non)citizen voting eligibility -> V/32")
        if t == "T" and ("bus" in desc or "transport" in desc):
            return ("", "66", "high", "type T confirmed; description is about transporting/buses -> T/66")
        return ("", "", "review", "off-list subtype value; needs classification from description")

    # wrong-type known code: the score tells us which field is inconsistent.
    sub_pts = TX.SUBTYPES[sub][1]
    type_base = TX.TYPE_POINTS.get(t)
    if absscore == sub_pts and absscore != type_base:
        return (row["belongs"], "", "review",
                f"score {score} matches subtype {sub}'s points -> TYPE may be wrong (->{row['belongs']}); confirm")
    if absscore == type_base and absscore != sub_pts:
        return ("", "", "review",
                f"score {score} matches type {t} -> SUBTYPE {sub} likely wrong; pick correct {t} code from description")
    return ("", "", "review", "ambiguous (points coincide); needs manual classification")


def main():
    C.OUT_DIR.mkdir(parents=True, exist_ok=True)
    df = load()
    flagged, unknown, wrong_type = classify(df)

    recs = []
    for _, r in flagged.iterrows():
        st, ss, conf, note = suggest(r)
        recs.append({
            "law_id": r["law_id"],
            "source_type": r["source_type"],
            "cur_type": r["type_u"],
            "cur_subtype": r["subtype"],
            "score": r["score"],
            "problem": "off_list_value" if not r["known"] else "wrong_type_code",
            "subtype_belongs_to": r["belongs"] or "",
            "suggest_set_type": st,
            "suggest_set_subtype": ss,
            "confidence": conf,
            "reason": note,
            "description": (r["description"] or r["provision_description"] or "")[:200],
        })
    out = pd.DataFrame(recs).sort_values(["confidence", "cur_type", "cur_subtype", "law_id"])
    out.to_csv(C.OUT_DIR / "corrections_proposed.csv", index=False)

    # ── grouped review markdown ──────────────────────────────────────────────
    L = ["# ICI Subtype Corrections — Proposal for Review (ISSUE-030)\n"]
    L.append(f"_{len(flagged)} flagged rows of 13,533. Nothing has been changed. "
             "Approve fixes by copying rows into `pipeline/corrections.csv`, then re-run ingest._\n")
    hi = out[out["confidence"] == "high"]
    L.append(f"## High-confidence, mechanical ({len(hi)})\n")
    L.append("These are placeholder subtype values where the type is already correct and the "
             "description maps to exactly one code. Safe to approve as-is.\n")
    L.append("| law_id | current | → suggest | why |")
    L.append("|---|---|---|---|")
    for _, r in hi.iterrows():
        L.append(f"| {r['law_id']} | {r['cur_type']}/{r['cur_subtype']} | "
                 f"{r['cur_type']}/{r['suggest_set_subtype']} | {r['reason']} |")

    L.append("\n## Systematic patterns needing a policy decision\n")
    L.append("These repeat many times, so they're likely intentional classifications or a "
             "systematic pipeline choice — one decision each, not row-by-row:\n")
    g = collections.Counter(zip(flagged["type_u"], flagged["sub_n"]))
    L.append("| current type/subtype | count | subtype code actually belongs to | question |")
    L.append("|---|---|---|---|")
    for (t, s), n in sorted(g.items(), key=lambda x: -x[1]):
        if n < 3:
            continue
        belongs = TX.SUBTYPES[s][0] if s in TX.SUBTYPES else "(off-list)"
        lbl = TX.SUBTYPES[s][2] if s in TX.SUBTYPES else "—"
        L.append(f"| {t}/{s} | {n} | {belongs} — \"{lbl}\" | Should these be type {belongs}, "
                 f"or is subtype {s} the error? |")

    L.append(f"\n## Everything else — individual review ({len(out[out['confidence']=='review']) - 0})\n")
    L.append("See `corrections_proposed.csv` (sorted by confidence) for the full per-row list "
             "with descriptions and the score-based hint about which field is wrong.\n")
    (C.OUT_DIR / "corrections_review.md").write_text("\n".join(L), encoding="utf-8")

    print(f"flagged rows: {len(flagged)}  (high-confidence: {len(hi)}, review: {len(flagged)-len(hi)})")
    print(f"wrote: {C.OUT_DIR/'corrections_proposed.csv'}")
    print(f"wrote: {C.OUT_DIR/'corrections_review.md'}")


if __name__ == "__main__":
    main()

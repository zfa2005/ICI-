"""
Stage 1 — Data foundation.

Loads ici_master.csv, enforces types, normalizes the state and locality fields
(ISSUE-006), validates every row against the ICI rules WITHOUT silently
dropping or coercing, precomputes the tier-weighted ICI aggregates the project
is named for (ISSUE-002), and joins full-text keys.

Outputs (all under pipeline/out/, gitignored):
  ici.parquet                  the cleaned `laws` table
  ici.sqlite                   tables: laws, ici_state_year, ici_county_year, fulltext_map
  validation_report.md         machine-oriented list of every rule violation
  data_quality_report.md       plain-English summary for the professor to review/veto

Run:  python pipeline/ingest.py
"""

from __future__ import annotations

import csv
import re
import sqlite3
import sys
from collections import Counter
from datetime import date, datetime, timezone

import pandas as pd

import config as C
import taxonomy as TX


# ─────────────────────────────────────────────────────────────────────────────
# Load
# ─────────────────────────────────────────────────────────────────────────────
def load_master() -> tuple[pd.DataFrame, dict]:
    """Read the master CSV as strings (we control every coercion ourselves),
    dropping any embedded duplicate header row."""
    notes = {}
    if not C.MASTER_CSV.exists():
        sys.exit(f"ERROR: master CSV not found at {C.MASTER_CSV}\n"
                 f"Set ICI_WORKSPACE or ICI_MASTER_CSV (see pipeline/config.py).")

    # Read everything as string, empty string = missing (not NaN yet), so we can
    # make explicit, reported decisions about each blank rather than pandas
    # guessing dtypes and hiding coercions.
    df = pd.read_csv(
        C.MASTER_CSV,
        dtype=str,
        keep_default_na=False,
        na_values=[],
        encoding="utf-8-sig",
    )
    notes["rows_read"] = len(df)

    # Defensive: drop any row that is literally a repeated header (a real risk
    # when CSVs are concatenated). None exist in the current master, but the
    # guard is cheap and documented.
    dup_header = df["source_type"].str.strip().str.lower() == "source_type"
    notes["duplicate_header_rows_dropped"] = int(dup_header.sum())
    df = df[~dup_header].reset_index(drop=True)

    # Stable identity for get_law() / joins: row order in the master.
    df.insert(0, "law_id", range(len(df)))
    return df, notes


# ─────────────────────────────────────────────────────────────────────────────
# Type enforcement
# ─────────────────────────────────────────────────────────────────────────────
def _to_int(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series.str.strip().replace("", pd.NA), errors="coerce").astype("Int64")


def enforce_dtypes(df: pd.DataFrame) -> pd.DataFrame:
    df["year"] = _to_int(df["year_enacted"]).astype("Int64")
    df["year_revoked"] = _to_int(df["year_revoked"]).astype("Int64")

    # score → nullable Int8 (values are ±1..±4).
    df["score"] = _to_int(df["score"]).astype("Int8")

    # pos_neg → nullable boolean (1 = positive/pro-immigrant, 0 = negative).
    pn = df["pos_neg"].str.strip()
    df["pos_neg_bool"] = pd.Series(
        pd.array([{"1": True, "0": False}.get(v, pd.NA) for v in pn], dtype="boolean"),
        index=df.index,
    )

    # fips_county → zero-padded 5-digit string (county FIPS), blank → NA.
    def pad_fips(v: str):
        v = (v or "").strip()
        if not v:
            return pd.NA
        digits = re.sub(r"\D", "", v)
        return digits.zfill(5) if digits else pd.NA

    df["fips"] = df["fips_county"].map(pad_fips).astype("string")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# State normalization (ISSUE-006)
# ─────────────────────────────────────────────────────────────────────────────
def normalize_state(raw: str):
    """Return (state_norm, is_us_state, state_class). Never drops — territories
    and foreign entries are flagged, blanks/'null' become NA."""
    s = (raw or "").strip()
    if s == "" :
        return pd.NA, False, "blank"
    if s.lower() == "null":
        return pd.NA, False, "null_literal"
    up = s.upper().replace(".", "")          # "D.C." -> "DC"
    if up in C.US_STATE_CODES:
        return up, True, "us_state"
    if up in C.TERRITORY_CODES:
        return up, False, "territory"
    low = s.lower()
    if low in C.TERRITORY_NAME_TO_CODE:
        return C.TERRITORY_NAME_TO_CODE[low], False, "territory"
    # Anything else non-empty (e.g. "Ontario") is foreign / non-US — keep it.
    return s, False, "foreign"


def apply_state_norm(df: pd.DataFrame) -> tuple[pd.DataFrame, Counter]:
    triples = df["state"].map(normalize_state)
    df["state_norm"] = pd.array([t[0] for t in triples], dtype="string")
    df["is_us_state"] = pd.array([t[1] for t in triples], dtype="boolean")
    df["state_class"] = pd.array([t[2] for t in triples], dtype="string")
    # audit trail: which raw values mapped to what class
    changes = Counter()
    for raw, (norm, _us, klass) in zip(df["state"], triples):
        if (raw or "").strip() != (str(norm) if norm is not pd.NA else "") or klass != "us_state":
            changes[(raw, str(norm) if norm is not pd.NA else "∅", klass)] += 1
    return df, changes


# ─────────────────────────────────────────────────────────────────────────────
# Locality normalization
# ─────────────────────────────────────────────────────────────────────────────
_TRAILING = re.compile(r"\s+(county|parish|borough)\s*$", re.IGNORECASE)
_ST_ABBR = re.compile(r"\bst\.\s*", re.IGNORECASE)


def normalize_locality(raw: str):
    s = (raw or "").strip()
    if not s:
        return pd.NA
    s = s.lower()
    s = _ST_ABBR.sub("saint ", s)      # "st. louis" -> "saint louis"
    s = _TRAILING.sub("", s)           # "cook county" -> "cook"
    s = re.sub(r"\s+", " ", s).strip()
    return s or pd.NA


def apply_locality_norm(df: pd.DataFrame) -> pd.DataFrame:
    df["county_norm"] = df["county"].map(normalize_locality).astype("string")
    df["city_norm"] = df["city_town"].map(normalize_locality).astype("string")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# Validation (emit violations — never silently coerce/drop)
# ─────────────────────────────────────────────────────────────────────────────
def validate(df: pd.DataFrame) -> dict:
    v = {}

    # score ∈ {±1..±4}
    score_ok = df["score"].isin(list(C.VALID_SCORES))
    v["score_missing"] = df[df["score"].isna()]["law_id"].tolist()
    v["score_out_of_range"] = df[(~score_ok) & (df["score"].notna())]["law_id"].tolist()

    # sign(score) agrees with pos_neg (only where both present)
    both = df["score"].notna() & df["pos_neg_bool"].notna()
    pos_bad = both & (df["pos_neg_bool"] == True) & (df["score"] < 0)   # noqa: E712
    neg_bad = both & (df["pos_neg_bool"] == False) & (df["score"] > 0)  # noqa: E712
    v["sign_mismatch"] = df[pos_bad | neg_bad]["law_id"].tolist()

    # pos_neg present?
    v["pos_neg_missing"] = df[df["pos_neg_bool"].isna()]["law_id"].tolist()

    # type ∈ taxonomy
    type_ok = df["type"].str.strip().isin(list(C.VALID_TYPES))
    v["type_invalid"] = df[~type_ok]["law_id"].tolist()

    # year present / plausible
    v["year_missing"] = df[df["year"].isna()]["law_id"].tolist()
    yr = df["year"]
    v["year_implausible"] = df[yr.notna() & ((yr < 1900) | (yr > date.today().year + 1))]["law_id"].tolist()

    # description present (either description or the richer provision_description)
    has_desc = (df["description"].str.strip() != "") | (df["provision_description"].str.strip() != "")
    v["description_missing"] = df[~has_desc]["law_id"].tolist()

    # source_type / source domains
    v["source_type_invalid"] = df[~df["source_type"].str.strip().isin(list(C.VALID_SOURCE_TYPES))]["law_id"].tolist()
    v["source_invalid"] = df[~df["source"].str.strip().isin(list(C.VALID_SOURCES))]["law_id"].tolist()

    # subtype: validated authoritatively against the taxonomy in taxonomy.py
    # (encoded from "Categories of SubFederal Laws", now obtained — ISSUE-030).
    # Subtype codes are globally unique, so a code paired with the wrong type is
    # a real error (e.g. B/2 — subtype 2 "Secure Communities" is a P code).
    type_up = df["type"].str.strip().str.upper()
    sub_norm = df["subtype"].map(TX.normalize_subtype)          # '13.0' -> '13'; junk kept
    belongs = sub_norm.map(lambda s: TX.SUBTYPES[s][0] if s in TX.SUBTYPES else None)

    is_blank = sub_norm == ""
    is_known = sub_norm.isin(list(TX.SUBTYPES))
    is_mismatch = is_known & (belongs != type_up)              # known code, wrong type
    is_unknown = (~is_blank) & (~is_known)                     # 'null','language','T' …
    is_valid_pair = is_known & (belongs == type_up)

    v["subtype_blank"] = df[is_blank]["law_id"].tolist()
    v["subtype_type_mismatch"] = df[is_mismatch]["law_id"].tolist()
    v["subtype_unknown_value"] = df[is_unknown]["law_id"].tolist()

    # |score| should equal the subtype's documented points (base or override),
    # but only for rows whose (type, subtype) pair is itself valid. Done on plain
    # float arrays to sidestep nullable-NA comparison ambiguity (pandas 3.0).
    import numpy as np
    exp_arr = sub_norm.map(
        lambda s: TX.SUBTYPES[s][1] if s in TX.SUBTYPES else float("nan")
    ).to_numpy(dtype="float64")
    score_arr = pd.to_numeric(df["score"], errors="coerce").to_numpy(dtype="float64")
    valid_arr = is_valid_pair.to_numpy(dtype=bool)
    pts_mismatch = valid_arr & ~np.isnan(score_arr) & ~np.isnan(exp_arr) & (np.abs(score_arr) != exp_arr)
    v["subtype_points_mismatch"] = df.loc[pts_mismatch, "law_id"].tolist()

    # reporting aids
    v["_n_valid_pairs"] = int(is_valid_pair.sum())
    v["_subtype_mismatch_examples"] = sorted({
        f"{t}/{s} (code {s} is a {TX.SUBTYPES[s][0]} type)"
        for t, s in zip(type_up[is_mismatch], sub_norm[is_mismatch])
    })
    v["_subtype_unknown_values"] = sorted({
        repr(x) for x in df[is_unknown]["subtype"].str.strip()
    })

    return v


# ─────────────────────────────────────────────────────────────────────────────
# ICI aggregates (ISSUE-002) — signed-score sums
# ─────────────────────────────────────────────────────────────────────────────
def build_aggregates(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Aggregate the signed tier score by (state, year) and (state, county, year).
    Only rows with a resolved state and a year contribute — the count excluded
    is reported so the professor can see what the index omits."""
    scored = df[df["state_norm"].notna() & df["year"].notna() & df["score"].notna()].copy()
    excluded = len(df) - len(scored)

    def agg(frame, keys):
        g = frame.groupby(keys, dropna=False)
        out = g.agg(
            n_laws=("law_id", "size"),
            n_positive=("pos_neg_bool", lambda s: int((s == True).sum())),   # noqa: E712
            n_negative=("pos_neg_bool", lambda s: int((s == False).sum())),  # noqa: E712
            ici_score=("score", "sum"),   # signed sum = the ICI score
        ).reset_index()
        return out

    state_year = agg(scored, ["state_norm", "year"]).rename(columns={"state_norm": "state"})
    county_year = agg(
        scored[scored["county_norm"].notna()],
        ["state_norm", "county_norm", "year"],
    ).rename(columns={"state_norm": "state", "county_norm": "county"})

    meta = {"rows_in_aggregate": len(scored), "rows_excluded_from_aggregate": excluded}
    return state_year, county_year, meta


# ─────────────────────────────────────────────────────────────────────────────
# Full-text join
# ─────────────────────────────────────────────────────────────────────────────
def _read_txt_header(path):
    """Parse the STATE/YEAR/DESCRIPTION/SOURCE_URL header block of a bill text."""
    meta = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for _ in range(8):
                line = f.readline()
                if not line:
                    break
                m = re.match(r"^(STATE|YEAR|DESCRIPTION|SOURCE_URL):\s*(.*)$", line.strip())
                if m:
                    meta[m.group(1).lower()] = m.group(2).strip()
    except OSError:
        pass
    return meta


def build_fulltext_map(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    rows = []
    stats = Counter()

    # --- state bill texts: filename == bill_id ---
    txt_by_billid = {}
    txt_by_url = {}
    if C.STATE_LAW_TEXTS_DIR.exists():
        for p in C.STATE_LAW_TEXTS_DIR.glob("*.txt"):
            txt_by_billid[p.stem] = p
            hdr = _read_txt_header(p)
            if hdr.get("source_url"):
                txt_by_url[hdr["source_url"].strip()] = p
    stats["state_text_files"] = len(txt_by_billid)

    # --- 287(g) MOA full text: keyed by source_url ---
    moa_urls = set()
    if C.FULLTEXT_287G_CSV.exists():
        csv.field_size_limit(10 ** 8)
        with open(C.FULLTEXT_287G_CSV, encoding="utf-8-sig", newline="") as f:
            r = csv.DictReader(f)
            for rec in r:
                u = (rec.get("source_url") or "").strip()
                if u:
                    moa_urls.add(u)
    stats["moa_fulltext_rows"] = len(moa_urls)

    for _, law in df.iterrows():
        st = law["source_type"].strip()
        bill = (law["bill_id"] or "").strip()
        url = (law["source_url"] or "").strip()

        if st == "state":
            if bill and bill in txt_by_billid:
                rows.append((law["law_id"], "bill_text", "direct_bill_id", str(txt_by_billid[bill]), True))
                stats["state_direct_billid"] += 1
            elif url and url in txt_by_url:
                rows.append((law["law_id"], "bill_text", "header_source_url", str(txt_by_url[url]), True))
                stats["state_header_url"] += 1
            else:
                stats["state_no_text"] += 1
        elif st == "287g":
            if url and url in moa_urls:
                rows.append((law["law_id"], "moa_text", "source_url", url, True))
                stats["moa_matched"] += 1
            else:
                stats["moa_no_text"] += 1
        else:
            stats["local_no_fulltext_expected"] += 1

    ft = pd.DataFrame(rows, columns=["law_id", "kind", "matched_how", "ref", "has_text"])
    return ft, dict(stats)


# ─────────────────────────────────────────────────────────────────────────────
# Persist
# ─────────────────────────────────────────────────────────────────────────────
LAWS_COLUMNS = [
    "law_id", "source_type", "source", "in_manual", "in_automated",
    "state", "state_norm", "is_us_state", "state_class",
    "county", "county_norm", "city_town", "city_norm", "fips",
    "year", "year_revoked", "date_enacted",
    "description", "provision_description",
    "pos_neg", "pos_neg_bool", "type", "subtype", "score",
    "bill_id", "parties", "model", "n_articles",
    "source_url", "article_url", "article_urls", "notes",
]


def persist(df, state_year, county_year, fulltext):
    C.OUT_DIR.mkdir(parents=True, exist_ok=True)
    C.LOG_DIR.mkdir(parents=True, exist_ok=True)

    laws = df[LAWS_COLUMNS].copy()

    # Parquet (typed, fast reloads for downstream stages).
    laws.to_parquet(C.PARQUET_PATH, index=False)

    # SQLite (deterministic exact-filter answers; readable from Node too).
    con = sqlite3.connect(C.SQLITE_PATH)
    try:
        # boolean/Int columns → sqlite-friendly (0/1, NULL) for portable querying.
        laws_sql = laws.copy()
        laws_sql["is_us_state"] = laws_sql["is_us_state"].map({True: 1, False: 0}).astype("Int64")
        laws_sql["pos_neg_bool"] = laws_sql["pos_neg_bool"].map({True: 1, False: 0}).astype("Int64")
        laws_sql.to_sql("laws", con, if_exists="replace", index=False)
        state_year.to_sql("ici_state_year", con, if_exists="replace", index=False)
        county_year.to_sql("ici_county_year", con, if_exists="replace", index=False)
        fulltext.to_sql("fulltext_map", con, if_exists="replace", index=False)

        cur = con.cursor()
        for stmt in [
            "CREATE INDEX IF NOT EXISTS idx_laws_state_year ON laws(state_norm, year)",
            "CREATE INDEX IF NOT EXISTS idx_laws_sourcetype ON laws(source_type)",
            "CREATE INDEX IF NOT EXISTS idx_laws_type ON laws(type, subtype)",
            "CREATE INDEX IF NOT EXISTS idx_sy ON ici_state_year(state, year)",
            "CREATE INDEX IF NOT EXISTS idx_cy ON ici_county_year(state, county, year)",
            "CREATE INDEX IF NOT EXISTS idx_ft ON fulltext_map(law_id)",
        ]:
            cur.execute(stmt)
        con.commit()
    finally:
        con.close()


# ─────────────────────────────────────────────────────────────────────────────
# Reports
# ─────────────────────────────────────────────────────────────────────────────
def _sample(ids, n=8):
    return ", ".join(str(i) for i in ids[:n]) + (" …" if len(ids) > n else "")


def write_validation_report(df, v, load_notes, agg_meta, ft_stats):
    hard = ["sign_mismatch", "score_out_of_range", "type_invalid",
            "source_type_invalid", "source_invalid"]
    soft = ["score_missing", "pos_neg_missing", "year_missing", "year_implausible",
            "description_missing"]
    n_hard = sum(len(v[k]) for k in hard)

    L = []
    L.append("# ICI Stage 1 — Validation Report\n")
    L.append(f"_Generated {datetime.now(timezone.utc).isoformat(timespec='seconds')} from "
             f"`{C.MASTER_CSV.name}`._\n")
    L.append(f"- Rows read: **{load_notes['rows_read']:,}**")
    L.append(f"- Duplicate-header rows dropped: **{load_notes['duplicate_header_rows_dropped']}**")
    L.append(f"- Rows in `laws` table: **{len(df):,}**")
    L.append(f"- **Hard rule violations: {n_hard}**  "
             f"(sign mismatch, score out of range, invalid type/source_type/source)\n")

    L.append("## Hard rules — must be zero for the accuracy gate\n")
    L.append("| Rule | Violations | Example law_ids |")
    L.append("|---|---|---|")
    labels = {
        "sign_mismatch": "score sign disagrees with pos_neg",
        "score_out_of_range": "score outside {±1..±4}",
        "type_invalid": "type not in taxonomy",
        "source_type_invalid": "source_type not in {state,local,287g}",
        "source_invalid": "source not in {manual,automated,both}",
    }
    for k in hard:
        L.append(f"| {labels[k]} | {len(v[k])} | {_sample(v[k]) or '—'} |")

    L.append("\n## Soft flags — reported, not dropped or coerced\n")
    L.append("| Flag | Rows | Example law_ids |")
    L.append("|---|---|---|")
    labels_soft = {
        "score_missing": "score is blank",
        "pos_neg_missing": "pos_neg is blank",
        "year_missing": "year_enacted is blank",
        "year_implausible": "year outside 1900..next year",
        "description_missing": "no description or provision_description",
    }
    for k in soft:
        L.append(f"| {labels_soft[k]} | {len(v[k])} | {_sample(v[k]) or '—'} |")

    L.append("\n## Subtype validation (authoritative — taxonomy.py / "
             "Categories of SubFederal Laws)\n")
    L.append(f"- Rows with a valid (type, subtype) pair: **{v['_n_valid_pairs']:,}**")
    L.append(f"- Blank subtype: **{len(v['subtype_blank'])}**")
    L.append(f"- **Subtype code paired with the wrong type: {len(v['subtype_type_mismatch'])}** "
             f"(law_ids: {_sample(v['subtype_type_mismatch']) or '—'})")
    if v["_subtype_mismatch_examples"]:
        L.append("  - distinct mismatches: " + "; ".join(v["_subtype_mismatch_examples"]))
    L.append(f"- **Unknown subtype value (not in taxonomy): {len(v['subtype_unknown_value'])}** "
             f"(law_ids: {_sample(v['subtype_unknown_value']) or '—'})")
    if v["_subtype_unknown_values"]:
        L.append("  - distinct values: " + ", ".join(v["_subtype_unknown_values"]))
    L.append(f"- Score |points| disagrees with the subtype's documented points: "
             f"**{len(v['subtype_points_mismatch'])}** (soft — subtype overrides make some "
             f"legitimate; law_ids: {_sample(v['subtype_points_mismatch']) or '—'})\n")

    L.append("## Aggregates\n")
    L.append(f"- Rows contributing to ICI aggregates (have state + year + score): "
             f"**{agg_meta['rows_in_aggregate']:,}**")
    L.append(f"- Rows excluded from aggregates (missing state/year/score): "
             f"**{agg_meta['rows_excluded_from_aggregate']:,}**\n")

    L.append("## Full-text join\n")
    for k, val in ft_stats.items():
        L.append(f"- `{k}`: {val:,}")
    L.append("")

    C.VALIDATION_REPORT.write_text("\n".join(L), encoding="utf-8")
    return n_hard


def write_data_quality_report(df, v, state_changes, agg_meta, ft_stats):
    """Plain-English version for the professor to review and veto."""
    total = len(df)
    us = int((df["is_us_state"] == True).sum())          # noqa: E712
    terr = int((df["state_class"] == "territory").sum())
    foreign = int((df["state_class"] == "foreign").sum())
    blank = int((df["state_class"] == "blank").sum())
    nulllit = int((df["state_class"] == "null_literal").sum())
    dc_from_dotted = state_changes.get(("D.C.", "DC", "us_state"), 0)

    def foreign_examples():
        rows = df[df["state_class"] == "foreign"]
        return ", ".join(sorted(set(rows["state"].tolist()))) or "none"

    def terr_breakdown():
        rows = df[df["state_class"] == "territory"]
        return ", ".join(f"{k} ({n})" for k, n in Counter(rows["state"].tolist()).items()) or "none"

    L = []
    L.append("# ICI Data Quality Report — Plain-Language Summary\n")
    L.append(f"_Generated {date.today().isoformat()}. This explains every automatic "
             "cleaning decision the pipeline made on the master database, so you can "
             "review and veto any of them. Nothing here was deleted — questionable rows "
             "are kept and flagged._\n")

    L.append("## The database in one line\n")
    L.append(f"The master file has **{total:,} laws**. We did not drop any of them. "
             "Below is what we changed or flagged, and why.\n")

    L.append("## 1. The 'state' column had inconsistencies — here is what we did\n")
    L.append(f"- **Washington D.C.** was written two ways: `DC` and `D.C.`. We merged the "
             f"**{dc_from_dotted}** `D.C.` row into `DC` so the capital is one place, not two. "
             f"There are now **{int((df['state_norm'] == 'DC').sum())}** D.C. laws in total.")
    L.append(f"- **US states + D.C.:** **{us:,}** laws are in the 50 states or D.C. — these are "
             "marked as U.S. jurisdictions.")
    L.append(f"- **U.S. territories:** **{terr}** laws are in territories ({terr_breakdown()}). "
             "We kept them but marked them as *not* one of the 50 states, so they don't distort "
             "state-level totals unless you ask for them.")
    L.append(f"- **Outside the U.S.:** **{foreign}** law(s) had a non-U.S. place in the state "
             f"column ({foreign_examples()}). This looks like a data-entry error in the source. "
             "We kept the row(s) but flagged them as non-U.S. — **worth your review.**")
    L.append(f"- **Blank / the word 'null':** **{blank}** rows had an empty state and "
             f"**{nulllit}** row literally said 'null'. We left the state empty and flagged them "
             "so they're easy to find and fix. **Worth your review.**\n")

    L.append("## 2. Locality names were standardized (for matching, not display)\n")
    L.append("- County and city names were lower-cased, trailing words like 'County', 'Parish', "
             "and 'Borough' were removed, and 'St.' was expanded to 'Saint' (so 'St. Louis' and "
             "'Saint Louis' count as the same place). The original names are preserved unchanged; "
             "the standardized version is only used internally for grouping and search.\n")

    L.append("## 3. Rows we flagged for you (kept, not deleted)\n")
    L.append("| What | How many | Meaning |")
    L.append("|---|---|---|")
    L.append(f"| Blank score | {len(v['score_missing'])} | The tier weight (±1 to ±4) is missing. |")
    L.append(f"| Blank positive/negative | {len(v['pos_neg_missing'])} | We can't tell if it's pro- or anti-immigrant. |")
    L.append(f"| Blank year | {len(v['year_missing'])} | No enactment year — excluded from year-based trends. |")
    L.append(f"| No description | {len(v['description_missing'])} | Nothing to show or search for this row. |")
    L.append(f"| Score/direction disagree | {len(v['sign_mismatch'])} | A positive law with a negative weight, or vice-versa. |")
    L.append(f"| Score out of range | {len(v['score_out_of_range'])} | A weight that isn't ±1, ±2, ±3, or ±4. |")
    L.append(f"| Unknown law type | {len(v['type_invalid'])} | A type code outside the 9 known categories. |")
    L.append("")
    if len(v["sign_mismatch"]) == 0 and len(v["score_out_of_range"]) == 0 and len(v["type_invalid"]) == 0:
        L.append("> **Good news:** none of the serious consistency problems (mismatched scores, "
                 "out-of-range weights, unknown types) were found. The scoring data is internally "
                 "consistent.\n")

    L.append("## 3b. Law sub-category (subtype) problems — now checkable\n")
    L.append("We now have the official 'Categories of SubFederal Laws' list, so every law's "
             "sub-category number can be checked against it. Each number belongs to exactly one "
             "category, so a number used under the wrong category is an error.")
    L.append("| What | How many | Meaning |")
    L.append("|---|---|---|")
    L.append(f"| Sub-category under the wrong category | {len(v['subtype_type_mismatch'])} | "
             "e.g. a law marked Benefits but using a Police sub-category number. |")
    L.append(f"| Sub-category value not on the official list | {len(v['subtype_unknown_value'])} | "
             "e.g. the words 'null', 'language', or a stray note in that field. |")
    L.append(f"| Blank sub-category | {len(v['subtype_blank'])} | No sub-category recorded. |")
    if v["_subtype_unknown_values"]:
        L.append("")
        L.append("The off-list values found were: " + ", ".join(v["_subtype_unknown_values"]) + ".")
    L.append("\nThese rows are **kept and flagged**, not deleted. They are a small share of the "
             "database and are worth a quick manual correction at the source (tracked as ISSUE-030).\n")

    L.append("## 4. The ICI score is now computed correctly\n")
    L.append("The whole point of the index — adding up the signed tier weights per place and year "
             "— is now precomputed. Previously the assistant ignored these weights entirely and "
             f"could only count laws (ISSUE-002). **{agg_meta['rows_in_aggregate']:,}** laws "
             f"(those with a place, a year, and a weight) feed the score; "
             f"**{agg_meta['rows_excluded_from_aggregate']:,}** are set aside for lacking one of "
             "those three.\n")

    L.append("## 5. Links to the full legal text\n")
    L.append(f"- **{ft_stats.get('state_direct_billid', 0)}** state laws were matched directly to "
             "their full bill text by bill ID"
             f"{', plus **%d** more via the URL in each text file' % ft_stats.get('state_header_url', 0) if ft_stats.get('state_header_url', 0) else ''}.")
    L.append(f"- **{ft_stats.get('moa_matched', 0)}** of the 287(g) agreements were matched to "
             "their full signed agreement text.")
    L.append("- Local ordinances don't have full text in this workspace (only descriptions), which "
             "is expected.\n")

    L.append("---\n")
    L.append("_If any decision above is wrong, tell us which and we'll change the rule — the "
             "pipeline is re-runnable in one command._")

    C.DATA_QUALITY_REPORT.write_text("\n".join(L), encoding="utf-8")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main():
    print("=" * 70)
    print("ICI STAGE 1 — DATA FOUNDATION")
    print("=" * 70)
    print(f"master CSV : {C.MASTER_CSV}")
    print(f"output dir : {C.OUT_DIR}")

    df, load_notes = load_master()
    df = enforce_dtypes(df)
    df, state_changes = apply_state_norm(df)
    df = apply_locality_norm(df)
    v = validate(df)
    state_year, county_year, agg_meta = build_aggregates(df)
    fulltext, ft_stats = build_fulltext_map(df)
    persist(df, state_year, county_year, fulltext)
    n_hard = write_validation_report(df, v, load_notes, agg_meta, ft_stats)
    write_data_quality_report(df, v, state_changes, agg_meta, ft_stats)

    # ── Accuracy-gate summary to stdout ──────────────────────────────────────
    print("\n--- STAGE 1 ACCURACY GATE ---")
    print(f"rows read / in laws table : {load_notes['rows_read']:,} / {len(df):,}  "
          f"(master README expects ~13,533)")
    print(f"hard rule violations      : {n_hard}  (must be 0)")
    print(f"  score/pos_neg sign mismatches : {len(v['sign_mismatch'])}")
    print(f"  score out of ±1..±4 range     : {len(v['score_out_of_range'])}")
    print(f"  invalid type                  : {len(v['type_invalid'])}")
    us_states = sorted(set(df[df["is_us_state"] == True]["state_norm"].dropna().tolist()))  # noqa: E712
    terr = sorted(set(df[df["state_class"] == "territory"]["state_norm"].dropna().tolist()))
    foreign = sorted(set(df[df["state_class"] == "foreign"]["state"].tolist()))
    print(f"US jurisdictions (50+DC)  : {len(us_states)} -> {us_states}")
    print(f"territories (flagged)     : {terr}")
    print(f"foreign (flagged)         : {foreign}")
    print(f"blank / 'null' states     : {int((df['state_class']=='blank').sum())} / "
          f"{int((df['state_class']=='null_literal').sum())}")
    print(f"ici_state_year rows       : {len(state_year):,}")
    print(f"ici_county_year rows      : {len(county_year):,}")
    print(f"fulltext_map rows         : {len(fulltext):,}")
    print(f"\nreports: {C.VALIDATION_REPORT.name}, {C.DATA_QUALITY_REPORT.name}")
    print(f"outputs: {C.PARQUET_PATH.name}, {C.SQLITE_PATH.name}")
    print("=" * 70)


if __name__ == "__main__":
    main()
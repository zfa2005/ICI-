"""
Stage 2 — Structured query tools.

Deterministic functions over the Stage-1 SQLite store. These are the exact-answer
path of the pipeline: state/year/type/score questions are `WHERE` clauses, not
similarity searches (PIPELINEWORKFLOW.md principle 2). Every function is pure and
parameterized (no string-built SQL), so results are reproducible and injection-safe.

Public functions: filter_laws, aggregate_laws, score_ici, get_law.
"""

from __future__ import annotations

import csv
import sqlite3
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import config as C

# Columns returned for a law "row" (compact but groundable).
ROW_COLUMNS = [
    "law_id", "source_type", "source", "state_norm AS state", "county_norm AS county",
    "city_town AS city", "year", "type", "subtype", "score",
    "pos_neg_bool AS pos_neg", "description", "bill_id", "source_url",
]

# Group-by axes allowed by aggregate_laws → the real SQL column behind each.
GROUP_COLUMNS = {
    "state": "state_norm",
    "county": "county_norm",
    "year": "year",
    "type": "type",
    "subtype": "subtype",
    "source_type": "source_type",
    "source": "source",
}


def get_conn() -> sqlite3.Connection:
    """Open the Stage-1 SQLite read-only."""
    if not C.SQLITE_PATH.exists():
        raise FileNotFoundError(
            f"{C.SQLITE_PATH} not found — run `python pipeline/ingest.py` first (Stage 1)."
        )
    con = sqlite3.connect(f"file:{C.SQLITE_PATH}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


# ─────────────────────────────────────────────────────────────────────────────
# filter_laws
# ─────────────────────────────────────────────────────────────────────────────
def filter_laws(
    state: Optional[str] = None,
    county: Optional[str] = None,
    city: Optional[str] = None,
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
    type: Optional[str] = None,          # noqa: A002 (mirrors the data column name)
    subtype: Optional[str] = None,
    pos_neg: Optional[int] = None,       # 1 = positive/pro-immigrant, 0 = negative
    score_min: Optional[int] = None,
    score_max: Optional[int] = None,
    source_type: Optional[str] = None,
    source: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Filter the `laws` table. ALWAYS returns `total_count` (the size of the full
    match set) alongside the capped `rows`, so a caller can never mistake one page
    for the whole universe (PIPELINEWORKFLOW.md Stage 2)."""
    where, params = [], []

    def eq(col, val, transform=lambda x: x):
        if val is not None and val != "":
            where.append(f"{col} = ?")
            params.append(transform(val))

    eq("state_norm", state, lambda s: str(s).strip().upper())
    eq("county_norm", county, _norm_locality)
    eq("city_norm", city, _norm_locality)
    eq("type", type, lambda s: str(s).strip().upper())
    eq("subtype", subtype, lambda s: str(s).strip())
    eq("source_type", source_type, lambda s: str(s).strip().lower())
    eq("source", source, lambda s: str(s).strip().lower())
    if pos_neg is not None:
        where.append("pos_neg_bool = ?")
        params.append(1 if int(pos_neg) == 1 else 0)
    if year_from is not None:
        where.append("year >= ?")
        params.append(int(year_from))
    if year_to is not None:
        where.append("year <= ?")
        params.append(int(year_to))
    if score_min is not None:
        where.append("score >= ?")
        params.append(int(score_min))
    if score_max is not None:
        where.append("score <= ?")
        params.append(int(score_max))

    clause = (" WHERE " + " AND ".join(where)) if where else ""
    limit = max(0, min(int(limit), 500))   # hard cap page size
    offset = max(0, int(offset))

    with get_conn() as con:
        total = con.execute(f"SELECT COUNT(*) FROM laws{clause}", params).fetchone()[0]
        rows = con.execute(
            f"SELECT {', '.join(ROW_COLUMNS)} FROM laws{clause} "
            f"ORDER BY year DESC, law_id ASC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()

    return {
        "total_count": int(total),
        "returned": len(rows),
        "limit": limit,
        "offset": offset,
        "rows": [dict(r) for r in rows],
    }


# ─────────────────────────────────────────────────────────────────────────────
# aggregate_laws
# ─────────────────────────────────────────────────────────────────────────────
def aggregate_laws(
    group_by: list[str] | str,
    **filters,
) -> dict[str, Any]:
    """Grouped counts and signed-score sums. `group_by` is one or more of
    state|county|year|type|subtype|source_type|source. Filters accept the same
    keyword args as filter_laws (except limit/offset)."""
    if isinstance(group_by, str):
        group_by = [group_by]
    cols = []
    for g in group_by:
        if g not in GROUP_COLUMNS:
            raise ValueError(f"invalid group_by '{g}'; allowed: {sorted(GROUP_COLUMNS)}")
        cols.append(GROUP_COLUMNS[g])

    # Reuse filter_laws' WHERE logic by calling it with limit 0 is wasteful; build
    # the same predicate here via a tiny shared builder.
    where, params = _build_where(filters)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    select_groups = ", ".join(f"{c} AS {g}" for c, g in zip(cols, group_by))

    sql = (
        f"SELECT {select_groups}, "
        f"COUNT(*) AS n_laws, "
        f"SUM(CASE WHEN pos_neg_bool=1 THEN 1 ELSE 0 END) AS n_positive, "
        f"SUM(CASE WHEN pos_neg_bool=0 THEN 1 ELSE 0 END) AS n_negative, "
        f"COALESCE(SUM(score),0) AS ici_score "
        f"FROM laws{clause} "
        f"GROUP BY {', '.join(cols)} "
        f"ORDER BY n_laws DESC"
    )
    with get_conn() as con:
        rows = con.execute(sql, params).fetchall()
    return {"group_by": group_by, "n_groups": len(rows), "groups": [dict(r) for r in rows]}


# ─────────────────────────────────────────────────────────────────────────────
# score_ici
# ─────────────────────────────────────────────────────────────────────────────
def score_ici(
    jurisdiction: str,
    county: Optional[str] = None,
    year: Optional[int] = None,
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
) -> dict[str, Any]:
    """The precomputed ICI score for a jurisdiction = signed sum of tier weights,
    with its components (n positive, n negative). Reads the Stage-1 aggregate
    tables (ici_state_year / ici_county_year), which fixes ISSUE-002."""
    state = str(jurisdiction).strip().upper()
    if year is not None:
        year_from = year_to = int(year)

    if county:
        table, keys, kparams = "ici_county_year", ["state = ?", "county = ?"], [state, _norm_locality(county)]
        label = f"{county.title()}, {state}"
    else:
        table, keys, kparams = "ici_state_year", ["state = ?"], [state]
        label = state

    where = list(keys)
    params = list(kparams)
    if year_from is not None:
        where.append("year >= ?"); params.append(int(year_from))
    if year_to is not None:
        where.append("year <= ?"); params.append(int(year_to))
    clause = " WHERE " + " AND ".join(where)

    sql = (
        f"SELECT COALESCE(SUM(n_laws),0) AS n_laws, "
        f"COALESCE(SUM(n_positive),0) AS n_positive, "
        f"COALESCE(SUM(n_negative),0) AS n_negative, "
        f"COALESCE(SUM(ici_score),0) AS ici_score "
        f"FROM {table}{clause}"
    )
    with get_conn() as con:
        r = dict(con.execute(sql, params).fetchone())

    yr_range = None
    if year_from is not None or year_to is not None:
        yr_range = [year_from, year_to]
    return {
        "jurisdiction": label,
        "state": state,
        "county": _norm_locality(county) if county else None,
        "year_range": yr_range,
        "ici_score": int(r["ici_score"]),        # signed sum of tier weights
        "n_positive": int(r["n_positive"]),
        "n_negative": int(r["n_negative"]),
        "n_laws": int(r["n_laws"]),
    }


# ─────────────────────────────────────────────────────────────────────────────
# get_law
# ─────────────────────────────────────────────────────────────────────────────
def get_law(law_id: int) -> Optional[dict[str, Any]]:
    """One full law row plus its full text (bill text or 287(g) MOA) when available."""
    with get_conn() as con:
        row = con.execute("SELECT * FROM laws WHERE law_id = ?", [int(law_id)]).fetchone()
        if row is None:
            return None
        ft = con.execute("SELECT kind, matched_how, ref FROM fulltext_map WHERE law_id = ?",
                         [int(law_id)]).fetchone()
    out = dict(row)
    out["full_text"] = None
    out["full_text_source"] = None
    if ft:
        text = _load_fulltext(ft["kind"], ft["ref"])
        if text:
            out["full_text"] = text
            out["full_text_source"] = {"kind": ft["kind"], "matched_how": ft["matched_how"], "ref": ft["ref"]}
    return out


# ─────────────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────────────
def _norm_locality(raw):
    """Mirror ingest.normalize_locality so callers can pass 'Cook County' etc."""
    import re
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s:
        return None
    s = re.sub(r"\bst\.\s*", "saint ", s)
    s = re.sub(r"\s+(county|parish|borough)\s*$", "", s)
    return re.sub(r"\s+", " ", s).strip() or None


def _build_where(filters: dict):
    where, params = [], []
    m = {
        "state": ("state_norm", lambda s: str(s).strip().upper()),
        "county": ("county_norm", _norm_locality),
        "city": ("city_norm", _norm_locality),
        "type": ("type", lambda s: str(s).strip().upper()),
        "subtype": ("subtype", lambda s: str(s).strip()),
        "source_type": ("source_type", lambda s: str(s).strip().lower()),
        "source": ("source", lambda s: str(s).strip().lower()),
    }
    for key, (col, tf) in m.items():
        val = filters.get(key)
        if val is not None and val != "":
            where.append(f"{col} = ?"); params.append(tf(val))
    if filters.get("pos_neg") is not None:
        where.append("pos_neg_bool = ?"); params.append(1 if int(filters["pos_neg"]) == 1 else 0)
    if filters.get("year_from") is not None:
        where.append("year >= ?"); params.append(int(filters["year_from"]))
    if filters.get("year_to") is not None:
        where.append("year <= ?"); params.append(int(filters["year_to"]))
    if filters.get("score_min") is not None:
        where.append("score >= ?"); params.append(int(filters["score_min"]))
    if filters.get("score_max") is not None:
        where.append("score <= ?"); params.append(int(filters["score_max"]))
    return where, params


def _load_fulltext(kind: str, ref: str) -> Optional[str]:
    if kind == "bill_text":
        try:
            return Path(ref).read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None
    if kind == "moa_text":
        return _moa_text_index().get(ref)
    return None


@lru_cache(maxsize=1)
def _moa_text_index() -> dict[str, str]:
    """Lazy-load the 287(g) MOA full text keyed by source_url (cached once)."""
    idx: dict[str, str] = {}
    if not C.FULLTEXT_287G_CSV.exists():
        return idx
    csv.field_size_limit(10 ** 8)
    with open(C.FULLTEXT_287G_CSV, encoding="utf-8-sig", newline="") as f:
        for rec in csv.DictReader(f):
            u = (rec.get("source_url") or "").strip()
            if u:
                idx[u] = rec.get("full_text") or ""
    return idx
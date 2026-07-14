"""
Stage 2 accuracy gate — pytest.

Ground truths were verified directly against the Stage-1 SQLite and a manual
pandas computation before being frozen here (see the session log / decision log).
If ingest logic changes and these move, that's a real regression to investigate,
not a test to loosen.

Run:  pipeline/.venv/Scripts/python -m pytest pipeline/tests -v
"""

import sqlite3

import pytest
from fastapi.testclient import TestClient

import config as C
import tools
from server import app

client = TestClient(app)


# ── ground truths (verified against SQLite + pandas) ─────────────────────────
GT_2017_BY_SOURCE = {"287g": 595, "local": 443, "state": 380}     # master README volume table

GT_STATE_YEAR_COUNTS = {                                          # filter_laws total_count
    ("CA", 2017): 313,
    ("TX", 2019): 20,
    ("NY", 2020): 22,
    ("FL", 2018): 44,
    ("IL", 2017): 79,
}

GT_SCORE_ICI = {                                                  # (ici_score, n_pos, n_neg, n_laws)
    ("CA", None, None): (4574, 1697, 287, 1984),
    ("AZ", 2010, 2019): (-53, 26, 43, 69),
    ("TX", 2017, 2017): (-110, 27, 52, 79),
}


# ── Stage 1 reconciliation (guards the foundation the tools sit on) ──────────
def test_row_count_reconciles():
    with tools.get_conn() as con:
        n = con.execute("SELECT COUNT(*) FROM laws").fetchone()[0]
    assert n == 13533


def test_zero_sign_mismatches():
    with tools.get_conn() as con:
        bad = con.execute(
            "SELECT COUNT(*) FROM laws WHERE pos_neg_bool IS NOT NULL AND score IS NOT NULL "
            "AND ((pos_neg_bool=1 AND score<0) OR (pos_neg_bool=0 AND score>0))"
        ).fetchone()[0]
    assert bad == 0


def test_state_set_is_50_plus_dc_plus_flagged_territories():
    with tools.get_conn() as con:
        us = {r[0] for r in con.execute(
            "SELECT DISTINCT state_norm FROM laws WHERE is_us_state=1 AND state_norm IS NOT NULL")}
        terr = {r[0] for r in con.execute(
            "SELECT DISTINCT state_norm FROM laws WHERE state_class='territory'")}
    assert len(us) == 51                     # 50 states + DC
    assert "DC" in us and "D.C." not in us   # collapsed
    assert terr == {"PR", "GU", "MP"}        # flagged, not dropped


# ── 2017 counts per source_type (README volume table) ────────────────────────
@pytest.mark.parametrize("source_type,expected", GT_2017_BY_SOURCE.items())
def test_2017_counts_by_source_type(source_type, expected):
    got = tools.filter_laws(year_from=2017, year_to=2017, source_type=source_type, limit=1)
    assert got["total_count"] == expected


def test_2017_counts_via_aggregate():
    agg = tools.aggregate_laws("source_type", year_from=2017, year_to=2017)
    counts = {g["source_type"]: g["n_laws"] for g in agg["groups"]}
    assert counts == GT_2017_BY_SOURCE


# ── filter_laws hand-verified state/year combinations ────────────────────────
@pytest.mark.parametrize("key,expected", GT_STATE_YEAR_COUNTS.items())
def test_filter_state_year_counts(key, expected):
    state, year = key
    got = tools.filter_laws(state=state, year_from=year, year_to=year, limit=5)
    assert got["total_count"] == expected


def test_filter_returns_total_even_when_capped():
    # CA has thousands of laws; a page of 3 must still report the true universe.
    got = tools.filter_laws(state="CA", limit=3)
    assert got["returned"] == 3
    assert got["total_count"] > 3
    assert got["total_count"] == 1988          # all CA rows (incl. blank-year etc.)


# ── score_ici spot-checks vs manual pandas ───────────────────────────────────
@pytest.mark.parametrize("key,expected", GT_SCORE_ICI.items())
def test_score_ici(key, expected):
    state, yf, yt = key
    r = tools.score_ici(state, year_from=yf, year_to=yt)
    assert (r["ici_score"], r["n_positive"], r["n_negative"], r["n_laws"]) == expected


def test_score_ici_sign_direction():
    # CA is strongly pro-immigrant (positive), AZ restrictive (negative) — the
    # index must reflect direction, not just volume.
    assert tools.score_ici("CA")["ici_score"] > 0
    assert tools.score_ici("AZ", year_from=2010, year_to=2019)["ici_score"] < 0


# ── get_law + full text ──────────────────────────────────────────────────────
def test_get_law_with_bill_text():
    with sqlite3.connect(f"file:{C.SQLITE_PATH}?mode=ro", uri=True) as con:
        law_id = con.execute("SELECT law_id FROM fulltext_map WHERE kind='bill_text' LIMIT 1").fetchone()[0]
    law = tools.get_law(law_id)
    assert law is not None
    assert law["full_text"] and len(law["full_text"]) > 50
    assert law["full_text_source"]["kind"] == "bill_text"


def test_get_law_with_moa_text():
    with sqlite3.connect(f"file:{C.SQLITE_PATH}?mode=ro", uri=True) as con:
        law_id = con.execute("SELECT law_id FROM fulltext_map WHERE kind='moa_text' LIMIT 1").fetchone()[0]
    law = tools.get_law(law_id)
    assert law is not None
    assert law["full_text"] and "MEMORANDUM" in law["full_text"].upper()


def test_get_law_missing_returns_none():
    assert tools.get_law(9_999_999) is None


# ── FastAPI endpoints ────────────────────────────────────────────────────────
def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["n_laws"] == 13533


def test_endpoint_filter_laws():
    r = client.post("/filter_laws", json={"state": "CA", "year_from": 2017, "year_to": 2017, "limit": 5})
    assert r.status_code == 200
    assert r.json()["total_count"] == 313


def test_endpoint_aggregate_laws():
    r = client.post("/aggregate_laws", json={"group_by": ["source_type"], "year_from": 2017, "year_to": 2017})
    assert r.status_code == 200
    counts = {g["source_type"]: g["n_laws"] for g in r.json()["groups"]}
    assert counts == GT_2017_BY_SOURCE


def test_endpoint_score_ici():
    r = client.post("/score_ici", json={"jurisdiction": "CA"})
    assert r.status_code == 200
    assert r.json()["ici_score"] == 4574


def test_endpoint_aggregate_rejects_bad_group_by():
    r = client.post("/aggregate_laws", json={"group_by": ["nonsense"]})
    assert r.status_code == 422


def test_logging_writes_jsonl_with_route_reason_field():
    import json
    from datetime import datetime, timezone
    client.post("/filter_laws", json={"state": "NY", "limit": 1, "route_reason": "unit-test"})
    path = C.LOG_DIR / f"queries-{datetime.now(timezone.utc):%Y%m%d}.jsonl"
    assert path.exists()
    last = json.loads(path.read_text(encoding="utf-8").strip().splitlines()[-1])
    assert last["endpoint"] == "filter_laws"
    assert "route_reason" in last          # schema reserves it now (Stage 5 fills it)
    assert set(last) >= {"ts", "endpoint", "params", "result_count", "latency_ms", "route_reason"}
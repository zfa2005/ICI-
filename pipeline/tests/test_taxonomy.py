"""
Taxonomy tests — the authoritative (type, subtype) reference and the data's
agreement with it. Guards ISSUE-030 work.
"""

import sqlite3

import taxonomy as TX
import config as C


def test_subtype_codes_are_globally_unique_and_typed():
    # Every code maps to exactly one (type, points, label); type is a valid type.
    for code, (t, pts, label) in TX.SUBTYPES.items():
        assert t in TX.VALID_TYPES
        assert pts in {1, 2, 3, 4}
        assert label
    # A code belongs to one type only — that's what makes B/2, E/13 detectable.
    assert TX.subtype_type("2") == "P"        # Secure Communities
    assert TX.subtype_type("13") == "D"       # Drivers Licenses
    assert TX.is_valid_pair("P", "2") is True
    assert TX.is_valid_pair("B", "2") is False   # subtype 2 is a P code
    assert TX.is_valid_pair("E", "13") is False  # subtype 13 is a D code


def test_point_overrides_encoded():
    assert TX.expected_points("12") == 1   # B override
    assert TX.expected_points("14") == 1   # B override
    assert TX.expected_points("18") == 2   # E override
    assert TX.expected_points("62") == 2   # E override
    assert TX.expected_points("9") == 2    # B base
    assert TX.expected_points("1") == 4    # P base


def test_normalize_subtype():
    assert TX.normalize_subtype("13.0") == "13"
    assert TX.normalize_subtype(" 13 ") == "13"
    assert TX.normalize_subtype("null") == "null"
    assert TX.normalize_subtype("") == ""


def test_data_scores_match_taxonomy_points_for_valid_pairs():
    """For every row whose (type, subtype) pair is valid, |score| must equal the
    subtype's documented points. Stage-1 reported 0 mismatches — lock that in."""
    with sqlite3.connect(f"file:{C.SQLITE_PATH}?mode=ro", uri=True) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT type, subtype, score FROM laws WHERE score IS NOT NULL"
        ).fetchall()
    mismatches = 0
    for r in rows:
        if TX.is_valid_pair(r["type"], r["subtype"]):
            if abs(r["score"]) != TX.expected_points(r["subtype"]):
                mismatches += 1
    assert mismatches == 0


def test_subtype_problem_counts_are_bounded():
    """The known ISSUE-030 rows: 121 wrong-type + 25 unknown = 146. If this grows,
    a data regression slipped in; investigate rather than loosen."""
    with sqlite3.connect(f"file:{C.SQLITE_PATH}?mode=ro", uri=True) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute("SELECT type, subtype FROM laws").fetchall()
    wrong_type = unknown = 0
    for r in rows:
        code = TX.normalize_subtype(r["subtype"])
        if code == "":
            continue
        if not TX.is_known_subtype(code):
            unknown += 1
        elif not TX.is_valid_pair(r["type"], code):
            wrong_type += 1
    assert wrong_type == 121
    assert unknown == 25

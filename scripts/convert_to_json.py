"""
convert_to_json.py
Reads ici_master.csv and writes ici_data.json for the ICI chatbot.
"""

import csv
import json
from datetime import date
from collections import defaultdict

CSV_PATH = r"C:\Users\ZEN\Downloads\ICI Claude Workspace\data\ici_master\ici_master.csv"
JSON_PATH = r"C:\Users\ZEN\UsersZENImmigrant-Climate\ici_data.json"

TYPE_MAP = {
    "P": "Police/Enforcement",
    "B": "Benefits",
    "D": "Drivers License",
    "E": "Employment",
    "L": "Language",
    "H": "Housing",
    "W": "Voting",
    "V": "Voting Rights",
    "T": "Transport",
}

def clean(val):
    """Strip whitespace; return None for empty/NaN-like values."""
    if val is None:
        return None
    s = str(val).strip()
    return s if s and s.lower() != "nan" else None

def to_int(val):
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None

def map_row(row):
    """Map CSV columns to JSON field names per the spec."""
    return {
        "year":        to_int(row.get("year_enacted")),
        "yearRevoked": to_int(row.get("year_revoked")) if clean(row.get("year_revoked")) else None,
        "state":       clean(row.get("state")),
        "county":      clean(row.get("county")),
        "city":        clean(row.get("city_town")),
        "fips":        clean(row.get("fips_county")),
        "bill":        clean(row.get("bill_id")),
        "description": clean(row.get("description")),
        "posNeg":      to_int(row.get("pos_neg")),
        "type":        clean(row.get("type")),
        "subtype":     clean(row.get("subtype")),
        "tier":        clean(row.get("score")),
        "sourceUrl":   clean(row.get("source_url")),
        "articleUrl":  clean(row.get("article_url")),
        "notes":       clean(row.get("notes")),
        "source":      clean(row.get("source")),
        "inManual":    clean(row.get("in_manual")),
        "inAutomated": clean(row.get("in_automated")),
    }

def remove_none(d):
    """Remove keys with None value to keep JSON compact."""
    return {k: v for k, v in d.items() if v is not None}

state_laws  = []
local_laws  = []
laws_287g   = []

skip_counts = defaultdict(int)
total_read  = 0
source_type_counts = defaultdict(int)

with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    for i, row in enumerate(reader):
        total_read += 1

        # Skip duplicate header rows (defense: if source_type literally equals the column name)
        if row.get("source_type", "").strip().lower() == "source_type":
            skip_counts["duplicate_header"] += 1
            continue

        src_type = clean(row.get("source_type", ""))
        source_type_counts[src_type or ""] += 1

        record = map_row(row)

        # Skip blank description
        if not record["description"]:
            skip_counts["blank_description"] += 1
            continue

        # Skip invalid pos_neg
        if record["posNeg"] not in (0, 1):
            skip_counts["invalid_pos_neg"] += 1
            continue

        obj = remove_none(record)

        if src_type == "state":
            state_laws.append(obj)
        elif src_type == "local":
            local_laws.append(obj)
        elif src_type == "287g":
            laws_287g.append(obj)
        else:
            skip_counts["unknown_source_type"] += 1

# Build year range across all three arrays
all_years = [
    r["year"] for arr in (state_laws, local_laws, laws_287g)
    for r in arr if r.get("year")
]
year_min = min(all_years) if all_years else None
year_max = max(all_years) if all_years else None

# Sorted unique state codes
all_states = sorted({
    r["state"] for arr in (state_laws, local_laws, laws_287g)
    for r in arr if r.get("state")
})

total_count = len(state_laws) + len(local_laws) + len(laws_287g)

metadata = {
    "generated":       str(date.today()),
    "stateLawsCount":  len(state_laws),
    "localLawsCount":  len(local_laws),
    "laws287gCount":   len(laws_287g),
    "totalCount":      total_count,
    "states":          all_states,
    "yearRange":       [year_min, year_max],
    "source":          "ici_master.csv — full merged dataset (manual + automated pipeline)",
}

output = {
    "stateLaws":  state_laws,
    "localLaws":  local_laws,
    "laws287g":   laws_287g,
    "typeMap":    TYPE_MAP,
    "metadata":   metadata,
}

with open(JSON_PATH, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False)

# ── Summary ──────────────────────────────────────────────────────────────────
print("=" * 60)
print("CONVERSION SUMMARY")
print("=" * 60)
print(f"Total CSV data rows read:   {total_read:,}")
print()
print("Rows by source_type (before cleaning):")
for k, v in sorted(source_type_counts.items()):
    print(f"  {k or '(blank)':20s}: {v:,}")
print()
print("Rows skipped:")
for reason, count in sorted(skip_counts.items()):
    print(f"  {reason:30s}: {count:,}")
total_skipped = sum(skip_counts.values())
print(f"  {'TOTAL skipped':30s}: {total_skipped:,}")
print()
print("Final output array counts:")
print(f"  stateLaws  : {len(state_laws):,}")
print(f"  localLaws  : {len(local_laws):,}")
print(f"  laws287g   : {len(laws_287g):,}")
print(f"  TOTAL      : {total_count:,}")
print()
print(f"Year range:  {year_min} – {year_max}")
print(f"States:      {len(all_states)} unique state codes")
print(f"Output file: {JSON_PATH}")
print("=" * 60)

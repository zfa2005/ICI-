"""
Central configuration for the ICI retrieval pipeline.

Every path is resolved relative to the repository (or overridden by an
environment variable). There are NO hardcoded absolute paths — the previous
`convert_to_json.py` was burned by exactly that (ISSUE-013), so nothing here
points at a machine-specific location.

Environment overrides
----------------------
  ICI_WORKSPACE    workspace root holding the master CSV + full-text corpora
                   (default: <repo>/ici_workspace — the gitignored local copy)
  ICI_MASTER_CSV   explicit path to ici_master.csv (default: derived below)
  ICI_OUT          output directory (default: <repo>/pipeline/out)
  ALLOWED_ORIGINS  comma-separated CORS origins for the FastAPI service
"""

from __future__ import annotations

import os
from pathlib import Path

# ── Repository / workspace roots ─────────────────────────────────────────────
# config.py lives in <repo>/pipeline/, so the repo root is two levels up.
REPO_ROOT = Path(__file__).resolve().parent.parent
PIPELINE_DIR = REPO_ROOT / "pipeline"


def _env_path(var: str, default: Path) -> Path:
    val = os.environ.get(var)
    return Path(val).expanduser().resolve() if val else default


# Workspace root: the ~1.9 GB local-only research assets (gitignored). Defaults
# to the in-repo copy; point ICI_WORKSPACE at "C:/ICI Claude Workspace" (or any
# other copy) to use a different one.
WORKSPACE_ROOT = _env_path("ICI_WORKSPACE", REPO_ROOT / "ici_workspace")

# ── Source data ──────────────────────────────────────────────────────────────
MASTER_CSV = _env_path("ICI_MASTER_CSV", WORKSPACE_ROOT / "data" / "ici_master" / "ici_master.csv")
STATE_LAW_TEXTS_DIR = WORKSPACE_ROOT / "state_law_texts"
FULLTEXT_287G_CSV = WORKSPACE_ROOT / "data" / "287g_fulltext.csv"
AUDIT_SAMPLE_CSV = WORKSPACE_ROOT / "data" / "ici_master" / "audit_sample.csv"

# ── Corrections (reviewed, non-destructive) ──────────────────────────────────
# Approved (type, subtype) corrections applied to the DERIVED tables at ingest
# time. The canonical ici_master.csv is never edited — this file is the auditable
# record of every change, reviewable/vetoable by the data owner (ISSUE-030).
CORRECTIONS_CSV = PIPELINE_DIR / "corrections.csv"

# ── Outputs (all gitignored) ─────────────────────────────────────────────────
OUT_DIR = _env_path("ICI_OUT", PIPELINE_DIR / "out")
PARQUET_PATH = OUT_DIR / "ici.parquet"
SQLITE_PATH = OUT_DIR / "ici.sqlite"
LOG_DIR = OUT_DIR / "logs"
VALIDATION_REPORT = OUT_DIR / "validation_report.md"
DATA_QUALITY_REPORT = OUT_DIR / "data_quality_report.md"

# ── Stage 3 — embeddings + vector index ─────────────────────────────────────
# Default to bge-small-en-v1.5: strong retrieval, 384-dim, fast on CPU for ~13.5k
# short docs (the doc's first choice bge-m3 is multilingual/heavier — override via
# ICI_EMBED_MODEL if a GPU is available). Pairs with the bge reranker in Stage 4.
EMBED_MODEL = os.environ.get("ICI_EMBED_MODEL", "BAAI/bge-small-en-v1.5")
# bge v1.5 is asymmetric: the QUERY is prefixed with a retrieval instruction,
# the passages are not. Omitting this measurably hurts recall. (Empty for models
# that don't use it.)
QUERY_INSTRUCTION = os.environ.get(
    "ICI_QUERY_INSTRUCTION",
    "Represent this sentence for searching relevant passages: ",
)
CHROMA_DIR = OUT_DIR / "chroma"
COLLECTION_DESCRIPTIONS = "descriptions"
COLLECTION_LEGAL = "legal_fulltext"
# Full-text chunking (word-based approximation of ~500–800 tokens w/ overlap).
CHUNK_WORDS = 450
CHUNK_OVERLAP_WORDS = 80

# ── Stage 4 — reranker ───────────────────────────────────────────────────────
# Cross-encoder that re-scores the Stage-3 candidate set. bge-reranker-base pairs
# with the bge embedder and is CPU-viable (it scores ~50 pairs per query, not the
# whole corpus). Override via ICI_RERANK_MODEL (e.g. bge-reranker-v2-m3 on GPU).
RERANK_MODEL = os.environ.get("ICI_RERANK_MODEL", "BAAI/bge-reranker-base")
RERANK_CANDIDATES = 50   # how many Stage-3 candidates to rerank
RERANK_TOP_K = 8         # how many to keep after reranking
# Tiny metadata tie-breaker added to the (0–1 sigmoid) rerank score: prefer rows
# two pipelines agreed on ('both') then manually-verified. Small enough to only
# break near-ties, never to override a clearly better text match.
SOURCE_TIEBREAK = {"both": 0.03, "manual": 0.02, "automated": 0.0}

# ── CORS (mirror server.js ALLOWED_ORIGINS approach — never a wildcard) ──────
_DEFAULT_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]
ALLOWED_ORIGINS = _DEFAULT_ORIGINS + [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()
]

# ── ICI taxonomy reference ───────────────────────────────────────────────────
# Law-type code → human label (matches the app's typeMap / convert_to_json.py).
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
VALID_TYPES = set(TYPE_MAP)

# Base tier points per type (subtype can override in the source data). From the
# workspace README: P=4; D/E/H/T=3; B=2; L/W/V=1. Used for reporting only —
# score validation checks the ±1..±4 range and sign, not the base magnitude,
# because documented subtype overrides make |score| != base legitimately.
TYPE_BASE_POINTS = {"P": 4, "D": 3, "E": 3, "H": 3, "T": 3, "B": 2, "L": 1, "W": 1, "V": 1}

VALID_SCORES = {-4, -3, -2, -1, 1, 2, 3, 4}

# ── US jurisdiction reference (for ISSUE-006 state normalization) ────────────
US_STATE_CODES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
    "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
    "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
    "WI", "WY", "DC",  # DC counted as a US jurisdiction here (51 total)
}

# US territories — kept in the data but flagged is_us_state=False.
TERRITORY_CODES = {"PR", "GU", "VI", "AS", "MP"}
TERRITORY_NAME_TO_CODE = {
    "puerto rico": "PR",
    "guam": "GU",
    "u.s. virgin islands": "VI",
    "us virgin islands": "VI",
    "virgin islands": "VI",
    "american samoa": "AS",
    "northern mariana islands": "MP",
    "commonwealth of the northern mariana islands": "MP",
}

# Source-type and provenance domains (for validation).
VALID_SOURCE_TYPES = {"state", "local", "287g"}
VALID_SOURCES = {"manual", "automated", "both"}
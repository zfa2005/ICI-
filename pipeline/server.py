"""
Stage 2 — FastAPI service exposing the structured query tools.

Each tool from tools.py is a typed endpoint. CORS uses the same allowlist
approach as the Node server.js (config.ALLOWED_ORIGINS) — never a wildcard, so
we don't reintroduce ISSUE-010. Every query is logged as one JSONL line under
pipeline/out/logs/ with a `route_reason` field reserved now (populated in Stage 5
when Claude picks the tool) so the log schema won't need migrating later.

Run:  uvicorn server:app --app-dir pipeline --port 8000
  or: python pipeline/server.py
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import config as C
import tools

app = FastAPI(title="ICI Retrieval — Structured Tools", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=C.ALLOWED_ORIGINS,   # explicit allowlist, no "*"
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


# ── Query logging (JSONL) ────────────────────────────────────────────────────
def log_query(endpoint: str, params: dict, result_count: int, latency_ms: float,
              route_reason: Optional[str] = None) -> None:
    C.LOG_DIR.mkdir(parents=True, exist_ok=True)
    rec = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "endpoint": endpoint,
        "params": params,
        "result_count": result_count,
        "latency_ms": round(latency_ms, 2),
        "route_reason": route_reason,   # filled in Stage 5 (why Claude chose this tool)
    }
    path = C.LOG_DIR / f"queries-{datetime.now(timezone.utc):%Y%m%d}.jsonl"
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, default=str) + "\n")


# ── Request models ───────────────────────────────────────────────────────────
class FilterRequest(BaseModel):
    state: Optional[str] = None
    county: Optional[str] = None
    city: Optional[str] = None
    year_from: Optional[int] = None
    year_to: Optional[int] = None
    type: Optional[str] = None
    subtype: Optional[str] = None
    pos_neg: Optional[int] = Field(default=None, ge=0, le=1)
    score_min: Optional[int] = None
    score_max: Optional[int] = None
    source_type: Optional[str] = None
    source: Optional[str] = None
    limit: int = Field(default=50, ge=1, le=500)
    offset: int = Field(default=0, ge=0)
    route_reason: Optional[str] = None   # Stage 5


class AggregateRequest(BaseModel):
    group_by: list[str]
    state: Optional[str] = None
    county: Optional[str] = None
    city: Optional[str] = None
    year_from: Optional[int] = None
    year_to: Optional[int] = None
    type: Optional[str] = None
    subtype: Optional[str] = None
    pos_neg: Optional[int] = Field(default=None, ge=0, le=1)
    score_min: Optional[int] = None
    score_max: Optional[int] = None
    source_type: Optional[str] = None
    source: Optional[str] = None
    route_reason: Optional[str] = None


class ScoreRequest(BaseModel):
    jurisdiction: str
    county: Optional[str] = None
    year: Optional[int] = None
    year_from: Optional[int] = None
    year_to: Optional[int] = None
    route_reason: Optional[str] = None


# ── Response envelopes (typed) ───────────────────────────────────────────────
class LawRow(BaseModel):
    law_id: int
    source_type: Optional[str] = None
    source: Optional[str] = None
    state: Optional[str] = None
    county: Optional[str] = None
    city: Optional[str] = None
    year: Optional[int] = None
    type: Optional[str] = None
    subtype: Optional[str] = None
    score: Optional[int] = None
    pos_neg: Optional[int] = None
    description: Optional[str] = None
    bill_id: Optional[str] = None
    source_url: Optional[str] = None


class FilterResponse(BaseModel):
    total_count: int
    returned: int
    limit: int
    offset: int
    rows: list[LawRow]


class AggregateResponse(BaseModel):
    group_by: list[str]
    n_groups: int
    groups: list[dict[str, Any]]


class ScoreResponse(BaseModel):
    jurisdiction: str
    state: str
    county: Optional[str]
    year_range: Optional[list[Optional[int]]]
    ici_score: int
    n_positive: int
    n_negative: int
    n_laws: int


# ── Endpoints ────────────────────────────────────────────────────────────────
@app.get("/health")
def health() -> dict:
    exists = C.SQLITE_PATH.exists()
    n_laws = None
    if exists:
        with tools.get_conn() as con:
            n_laws = con.execute("SELECT COUNT(*) FROM laws").fetchone()[0]
    return {"status": "ok" if exists else "no_data", "sqlite_exists": exists, "n_laws": n_laws}


@app.post("/filter_laws", response_model=FilterResponse)
def filter_laws_ep(req: FilterRequest) -> FilterResponse:
    t0 = time.perf_counter()
    args = req.model_dump(exclude={"route_reason"})
    result = tools.filter_laws(**args)
    log_query("filter_laws", req.model_dump(exclude={"route_reason"}),
              result["total_count"], (time.perf_counter() - t0) * 1000, req.route_reason)
    return result


@app.post("/aggregate_laws", response_model=AggregateResponse)
def aggregate_laws_ep(req: AggregateRequest) -> AggregateResponse:
    t0 = time.perf_counter()
    payload = req.model_dump(exclude={"route_reason", "group_by"}, exclude_none=True)
    try:
        result = tools.aggregate_laws(req.group_by, **payload)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    log_query("aggregate_laws", req.model_dump(exclude={"route_reason"}),
              result["n_groups"], (time.perf_counter() - t0) * 1000, req.route_reason)
    return result


@app.post("/score_ici", response_model=ScoreResponse)
def score_ici_ep(req: ScoreRequest) -> ScoreResponse:
    t0 = time.perf_counter()
    result = tools.score_ici(
        req.jurisdiction, county=req.county, year=req.year,
        year_from=req.year_from, year_to=req.year_to,
    )
    log_query("score_ici", req.model_dump(exclude={"route_reason"}),
              result["n_laws"], (time.perf_counter() - t0) * 1000, req.route_reason)
    return result


@app.get("/law/{law_id}")
def get_law_ep(law_id: int, route_reason: Optional[str] = None) -> dict:
    t0 = time.perf_counter()
    result = tools.get_law(law_id)
    if result is None:
        log_query("get_law", {"law_id": law_id}, 0, (time.perf_counter() - t0) * 1000, route_reason)
        raise HTTPException(status_code=404, detail=f"law_id {law_id} not found")
    log_query("get_law", {"law_id": law_id}, 1, (time.perf_counter() - t0) * 1000, route_reason)
    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
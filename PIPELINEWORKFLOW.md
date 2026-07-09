# ICI Retrieval Pipeline — Workflow & Build Plan

## Why this file exists

`ISSUES.md` documents *what is broken* in the current AI assistant — the
keyword-regex retrieval, the unused tier scores, the arbitrary fallback
samples. This file is the other half: *how we build the replacement*. It is
the working blueprint for a **Python retrieval pipeline** over the ICI
corpus (`C:\ICI Claude Workspace` — see the Asset Inventory in `ISSUES.md`),
designed around one goal: **the most accurate answer per query, every
component chosen and measured against that goal.**

Anyone (human or AI assistant) picking up pipeline work should read this
file first, follow the stage order, and update the status table as stages
land. Design changes belong here, with reasoning — not just in commit
messages.

---

## Guiding principles

1. **Accuracy is measured, not assumed.** Every stage ships with an eval
   check. A component that can't show a recall/precision number doesn't get
   merged. `audit_sample.csv` (531 stratified rows) is the seed ground
   truth.
2. **Structured questions get structured answers.** "How many laws did TX
   pass in 2019" is a `WHERE` clause, not a similarity search. The pipeline
   always routes exact-filter queries to SQL/pandas — embeddings only handle
   what columns can't.
3. **Retrieve small, retrieve ranked.** The model never sees an unranked
   blob (see ISSUES.md, ISSUE-001, for why). Candidates → rerank → top-k →
   prompt, with the full chain logged.
4. **Every answer is groundable.** Retrieved chunks carry `source_url` /
   `bill_id` / PDF path metadata so the assistant can cite the actual MOA or
   bill text it used.
5. **Python end-to-end.** pandas for data work, sentence-transformers for
   embeddings, ChromaDB for the vector store, a cross-encoder for reranking,
   FastAPI to serve it. The existing Node server keeps chat persistence; it
   delegates retrieval to the Python service.

---

## Target architecture

```
                              user query
                                  │
                       ┌──────────▼──────────┐
                       │   Claude (tool use)  │  decides which tool(s) to call,
                       │                      │  possibly multiple rounds
                       └──┬────────────────┬──┘
              structured  │                │  semantic
                          ▼                ▼
             ┌─────────────────┐   ┌──────────────────────┐
             │  filter_laws()  │   │  search_laws()        │
             │  score_ici()    │   │                      │
             │  (SQLite/pandas │   │  1. embed query       │
             │   over master   │   │     (sentence-        │
             │   parquet/DB)   │   │      transformers)    │
             │                 │   │  2. ChromaDB ANN      │
             │  exact axes:    │   │     search over 3     │
             │  state, year,   │   │     text tiers        │
             │  type, subtype, │   │  3. cross-encoder     │
             │  score, posNeg, │   │     RERANK candidates │
             │  county, fips,  │   │  4. return top-k w/   │
             │  source, model  │   │     master-row meta   │
             └────────┬────────┘   └──────────┬───────────┘
                      │                       │
                      └───────────┬───────────┘
                                  ▼
                     ranked, cited, small context
                                  │
                                  ▼
                      Claude answer w/ citations
                                  │
                        retrieval log (JSONL)
                        → eval metrics over time
```

---

## Stack (and why each piece)

| Layer | Choice | Why |
|---|---|---|
| Data wrangling | **pandas** (+ pyarrow/parquet) | The cleaning, joining, and aggregation work (Stage 1) is exactly what pandas is for; parquet keeps typed, fast reloads |
| Structured store | **SQLite** (via `sqlite-utils`/`sqlalchemy`) or DuckDB | 13.5k rows need zero infrastructure; SQL gives deterministic exact-filter answers; the Node server already ships better-sqlite3 so the file is readable from both sides |
| Embeddings | **sentence-transformers** — start with `BAAI/bge-m3` or `bge-small-en-v1.5`; fallback `all-MiniLM-L6-v2` if we need CPU speed | Open, local, no per-token cost, strong retrieval benchmarks; bge family pairs naturally with the bge reranker |
| Vector store | **ChromaDB** (persistent local) | Embedded, pip-installable, metadata filtering built in (state/year/type filters *inside* the ANN query), right size for ~50–100k chunks |
| Reranker | **cross-encoder** `BAAI/bge-reranker-base` (or `-v2-m3`) | Bi-encoder recall + cross-encoder precision is the standard two-stage pattern; reranking 50–100 candidates is fast even on CPU |
| Chunking | token-aware splitter (~500–800 tokens, ~100 overlap) for full texts; no chunking for one-line descriptions | Bill/MOA texts run to 30k+ chars; descriptions are already atomic |
| Serving | **FastAPI** + uvicorn, endpoints mirroring the tool schema | Lightweight, typed, async; Node proxies tool calls to it |
| Eval | pandas + a small harness script; metrics logged as JSONL | Recall@k / MRR / answer-grounding checks against the audit-derived gold set |

---

## Build stages

Status legend: 🔴 Not started · 🟡 In progress · 🟢 Done

| # | Stage | Status |
|---|---|---|
| 1 | Data foundation (pandas ingest, clean, score) | 🔴 |
| 2 | Structured query tools (SQL/pandas + FastAPI) | 🔴 |
| 3 | Embedding + vector index (sentence-transformers + ChromaDB) | 🔴 |
| 4 | Reranker integration | 🔴 |
| 5 | Claude tool-use wiring (replace regex context builder) | 🔴 |
| 6 | Eval harness + retrieval logging | 🔴 |
| 7 | Hardening: incremental refresh, CI checks, docs | 🔴 |

### Stage 1 — Data foundation (`pipeline/ingest.py`)

**Input:** `C:\ICI Claude Workspace\data\ici_master\ici_master.csv` (13,533
rows) + the full-text corpora.

- Load master with pandas; enforce dtypes (year → Int64, score → Int8,
  pos_neg → boolean, fips zero-padded string).
- Normalize `state` (fixes ISSUE-006): collapse `D.C.`/`DC`, drop literal
  `'null'`, explicit policy for territories (`PR`, `Guam`, `Northern
  Mariana Islands`) and the stray `Ontario` row — keep with an
  `is_us_state=False` flag rather than silently dropping.
- Normalize localities the same way the workspace merge did (lowercase,
  strip trailing "county/parish/borough", `st.` → `saint`).
- Validate: score ∈ {±1..±4}, sign agrees with pos_neg, type ∈ taxonomy,
  subtype pairs against the 116 known (type, subtype) combos; emit a
  validation report, don't silently coerce.
- **Precompute ICI aggregates** (fixes ISSUE-002): signed-score sums per
  state-year, county-year, and jurisdiction — the actual index the project
  is named for — into their own tables.
- Join keys to full text: `bill_id` → `state_law_texts/*.txt` (263 direct;
  remaining 378 joined via each file's STATE/YEAR/DESCRIPTION header, else
  kept as index-only docs), `source_url` → `287g_fulltext.csv` (verified
  100% for the 1,011 URL-linked 287(g) rows).
- **Output:** `pipeline/out/ici.parquet`, `pipeline/out/ici.sqlite`
  (tables: `laws`, `ici_state_year`, `ici_county_year`, `fulltext_map`),
  plus `validation_report.md`.

**Accuracy gate:** row counts reconcile with the master README (13,533);
zero rows with inconsistent score/pos_neg sign; state set = 50 states + DC
+ flagged territories, nothing else.

### Stage 2 — Structured query tools (`pipeline/tools.py`, `pipeline/server.py`)

Expose deterministic functions over the SQLite/parquet store, then wrap
them in FastAPI:

- `filter_laws(state?, county?, city?, year_from?, year_to?, type?,
  subtype?, pos_neg?, score_min?, score_max?, source_type?, source?,
  limit, offset)` → rows + total count. Always returns the *count* even
  when rows are capped, so the model can't mistake a page for the universe.
- `aggregate_laws(group_by=[state|year|type|subtype|county], filters…)` →
  grouped counts and signed-score sums.
- `score_ici(jurisdiction, year?/range?)` → the precomputed ICI score with
  its components (n positive, n negative, sum of weights).
- `get_law(id)` → one full row + its full text if available.

**Accuracy gate:** unit tests assert known ground truths pulled manually
from the master (e.g., exact 2017 counts per source_type from the README
volume table: 287g=595, local=443, state=380).

### Stage 3 — Embedding + vector index (`pipeline/embed.py`)

Three ChromaDB collections, all metadata-tagged with the master row id,
state, year, type, subtype, score, source_type, source_url:

| Collection | Content | Est. size |
|---|---|---|
| `descriptions` | `description` + `provision_description` per row (one doc per row, no chunking) | ~13.5k docs |
| `legal_fulltext` | 641 bill texts + 1,455 MOA texts, chunked ~500–800 tokens w/ overlap | ~15–30k chunks |
| `news_evidence` (optional, Stage 3b) | full articles from `local_news_raw.csv` | large; only if evidence queries prove needed |

- Embed with sentence-transformers in batches; persist ChromaDB to
  `pipeline/out/chroma/`.
- `search_laws(query, filters?, k=50)`: embed query → ANN search (with
  Chroma metadata pre-filter when the caller passes state/year/type) →
  return candidates. Not exposed to the model until Stage 4 adds reranking.

**Accuracy gate:** a smoke set of ~30 hand-written queries with known
target rows (drawn from distinctive laws across all 9 types) must hit
recall@50 ≥ 0.9 on `descriptions` before reranking is even added.

### Stage 4 — Reranker (`pipeline/rerank.py`)

- Cross-encoder scores each (query, candidate-text) pair from Stage 3's
  top-50; keep top-k (default 8) above a score floor.
- Blend tie-breakers from metadata: prefer `source='both'` (two pipelines
  agreed) and `manual` over `automated`; never let metadata *override* a
  clearly better text match — it only breaks near-ties.
- Final `search_laws()` returns: chunk text, master row, score, and
  citation fields.

**Accuracy gate:** on the same smoke set, precision@8 must beat the
no-rerank baseline; log both numbers in `pipeline/out/eval/`.

### Stage 5 — Claude tool-use wiring

- Replace the client-side `getDataContext()` regex builder
  (`frontend/src/pages/Assistant.jsx`) with server-side tool use: the Node
  `/api/chat` endpoint sends Claude the tool schema; tool calls are proxied
  to the FastAPI service; results go back as tool_result blocks in a loop
  until Claude answers.
- System prompt carries the taxonomy tables (type/subtype/score semantics
  from the workspace README) instead of a raw JSON dump — a fixed few-KB
  glossary, not per-query data.
- Conversation memory comes free: prior tool calls stay in the message
  history (fixes ISSUE-004); type coverage comes free via enum args (fixes
  ISSUE-005); the meaningless fallback disappears (fixes ISSUE-003).

**Accuracy gate:** side-by-side answers, old vs. new, on a fixed 20-question
script covering every law type, comparisons, follow-ups, and ICI-score
questions. New pipeline must state correct counts (verifiable via Stage 2
SQL) and cite sources.

### Stage 6 — Eval harness + logging (`pipeline/eval.py`)

- Every retrieval logged as JSONL: query, filters, candidates, rerank
  scores, chosen top-k, latency.
- Gold set v1: derive from `audit_sample.csv` (531 stratified rows) —
  "given this row's description as a query, is the row retrieved top-k?"
  Gold set v2: once the human audit fills C1–C6, weight by confirmed-correct
  rows and add the discovered error cases as negative tests.
- Report recall@k, MRR, and per-stratum breakdowns (state/local/287g —
  mirrors the audit's stratification, so retrieval quality and data quality
  read on the same axes).

### Stage 7 — Hardening

- `pipeline/refresh.py`: one command re-runs ingest → embed (only changed
  rows, hashed by content) → eval, for when the master CSV updates.
- CI check: eval metrics must not regress vs. the last committed baseline.
- Document the runbook here; flip stage statuses; record design changes.

---

## Repository layout (planned)

```
pipeline/
├── requirements.txt        # pandas, pyarrow, sentence-transformers,
│                           # chromadb, fastapi, uvicorn, sqlite-utils
├── config.py               # paths (workspace root), model names, chunk params
├── ingest.py               # Stage 1
├── tools.py                # Stage 2 query functions
├── server.py               # Stage 2/5 FastAPI app
├── embed.py                # Stage 3
├── rerank.py               # Stage 4
├── eval.py                 # Stage 6
├── refresh.py              # Stage 7
└── out/                    # gitignored: parquet, sqlite, chroma/, eval logs
```

The heavy source data stays in `C:\ICI Claude Workspace` (configured in
`config.py`), not in this repo — the repo carries code, docs, and small
eval fixtures only.

---

## Decision log

- **2026-07-09** — File created. Stack chosen: pandas + SQLite +
  sentence-transformers + ChromaDB + bge cross-encoder reranker + FastAPI,
  per the analysis in `ISSUES.md` (ISSUE-001 fix plan) and the workspace
  asset inventory. Hybrid structured-first routing chosen over vector-only
  because most failing queries today are filter/aggregation questions, not
  similarity questions.

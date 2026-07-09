# ICI Project — Issue & Improvement Tracker

This file is a living log of known problems in the codebase and the plan to fix
them. It exists so that architectural gaps don't just live in someone's head
or in a chat transcript — they're written down, prioritized, and checked off
as they're actually fixed. When you fix something on this list, don't delete
the entry: mark it fixed, note the date/commit, and leave it as a record.

## How to use this file

- New problem discovered → add an entry with an ID, area, severity, and status.
- Working on one → flip status to `In Progress`.
- Shipped a fix → flip to `Fixed`, add the date and a one-line note on what changed.
- Decided not to fix something → `Won't Fix`, with the reasoning, so it isn't
  re-litigated later.

**Status legend:** 🔴 Open · 🟡 In Progress · 🟢 Fixed · ⚪ Won't Fix

## Issue Index

| ID | Title | Area | Severity | Status |
|----|-------|------|----------|--------|
| **ISSUE-001** | AI Assistant retrieval is keyword-guessing, not RAG | AI Assistant | 🔴 Critical | Open |
| **ISSUE-002** | ICI tier score is never used by the assistant | AI Assistant / Data | 🔴 Critical | Open |
| **ISSUE-003** | No-match fallback returns the first 10 rows, not relevant ones | AI Assistant | 🟠 High | Open |
| **ISSUE-004** | No memory of filters across conversation turns | AI Assistant | 🟠 High | Open |
| **ISSUE-005** | Law-type keyword coverage is incomplete (3 of 9 types) | AI Assistant | 🟡 Medium | Open |
| **ISSUE-006** | State field has data-quality bugs (`'null'`, `D.C.`/`DC`, non-US entries) | Data Pipeline | 🟡 Medium | Open |
| **ISSUE-007** | App uses a thin slice of the available corpus — full-text sources sit unused in the ICI Claude Workspace | Data Pipeline / AI Assistant | 🟠 High | Open |

*(IDs below are not deep-links — this file is short enough to scroll or Ctrl+F.)*

---

## Issues in the Pipeline — Our RAG / Retrieval Architecture

### ISSUE-001: AI Assistant retrieval is keyword-guessing, not RAG

**Severity: Critical** — this is the most important issue in the project. It
undermines the core promise of the AI Research Assistant: that it answers
questions using real data instead of guessing.

#### What we actually have today

There is **no RAG, no vector search, no semantic search, no embeddings, no
reranker** anywhere in this codebase.

> **No sentence transformer, no vector embedding model of any kind is
> running in this pipeline — not client-side, not server-side, not in the
> data-prep scripts.** Nothing in `server.js`, `api/chat.js`,
> `frontend/src/pages/Assistant.jsx`, or `scripts/convert_to_json.py` ever
> converts a law's `description`/`notes` text (or a user's query) into an
> embedding vector. No `sentence-transformers`, no OpenAI/Voyage/Cohere
> embeddings API, no FAISS/Chroma/`sqlite-vss`/pgvector index exists
> anywhere in this repo or its dependencies (`package.json` only lists
> `better-sqlite3` server-side and `chart.js`/`react`/`react-router-dom`
> client-side — nothing ML-related). Every match the assistant makes today
> is plain-text `.includes()`/regex substring matching, with zero notion of
> semantic similarity. What exists instead:

1. On page load, the entire 13,524-law dataset (`ici_data.json`, ~1.7MB) is
   fetched whole into the browser
   (`frontend/src/pages/Assistant.jsx:667-676`).
2. On every message, `getDataContext(query)`
   (`frontend/src/pages/Assistant.jsx:708-875`) runs the raw query string
   through hand-written `.includes()` / regex checks — state names, a year
   regex, "compare"/"vs", and keyword lists for "sanctuary" vs "restrictive"
   and for exactly three law types (Police, Employment, Benefits).
3. Whatever survives is aggregated (counts by year/state/type) and a capped
   sample of 10–25 raw records is attached.
4. That JSON blob is pasted verbatim into the system prompt
   (`frontend/src/pages/Assistant.jsx:880-902`) and sent to Claude through
   `server.js`, which is a dumb proxy with zero retrieval logic of its own
   (`server.js:355-432`).

In plain terms: it's a hand-rolled, brittle guess at a `WHERE` clause, not
retrieval. It just happens to work often enough that it *looks* like the
assistant "knows" the data.

#### Why this is severe, concretely

- **The model can't compute the actual ICI score.** Every law has a `tier`
  field (±1 to ±4 — the entire point of the ICI methodology per `CLAUDE.md`).
  It is never read. The assistant can only report *counts* of positive vs.
  negative laws, not the weighted score the whole platform is named after.
  (Tracked separately as **ISSUE-002** because it's severe enough
  to need its own fix, but it's a direct symptom of not having real
  retrieval/aggregation logic.)
- **Silent bad fallback.** Any query that doesn't match the narrow keyword
  rules (e.g. drivers'-license, housing, voting, or language laws — 6 of 9
  law types have no keyword rule at all) silently falls back to "all 13,524
  laws," and the sample sent to the model is literally `array.slice(0, 10)`
  — the first 10 rows in file order. Not relevant, not recent, not random.
  The model reasons over whatever happens to be first in the JSON file and
  presents it as if it answered the question.
- **No memory across turns** — see **ISSUE-004**.
- **No fuzzy matching, synonyms, or typo tolerance.** "Hostile to
  immigrants," "ICE cooperation," "crackdown" etc. don't match the fixed
  keyword lists. The model only "sees" data when the user happens to phrase
  their question the way the regex expects.
- **Unauditable and untestable.** There's no logging of what was retrieved
  vs. what wasn't, no relevance score, nothing to eval. When the assistant
  gives a wrong or incomplete answer, there is no way to tell whether it was
  a bad retrieval or a bad generation — because "retrieval" is an invisible
  side effect of string matching, not a traceable step.

#### Why dumping the whole dataset (or a large raw chunk of it) into the prompt is wrong — in general, not just here

It's tempting to think "just send the model more data and it'll figure it
out." This is wrong, and worth spelling out because it'll come up again as
the dataset grows:

1. **"Lost in the middle."** LLMs do not attend uniformly across a long
   context. Facts placed in the middle of a large context are recalled and
   used far less reliably than facts near the start or end. Dumping hundreds
   or thousands of records and hoping the model finds the right ones is
   fighting the model's own attention behavior, not using it.
2. **No relevance guarantee.** Handing over unranked data means the model —
   not your system — is doing the searching, inside a single forward pass,
   with no ability to verify it found the right subset. That's strictly
   worse than doing the search *before* the model sees anything and handing
   it pre-ranked, verified evidence.
3. **Hallucination risk goes up, not down, with more irrelevant context.**
   When many similar-looking but irrelevant records are present, models
   conflate details across them (wrong state attached to a real law, wrong
   year, blended descriptions). A smaller, correctly-targeted context
   produces more accurate answers than a bigger, noisier one.
4. **Cost and latency scale with what you send, not with what's relevant.**
   Every extra token in the prompt is paid for and adds latency, on every
   single message, whether or not it was useful. This dataset is 13,524 rows
   today; if it doubles, a "just send more" approach doubles cost and
   latency for no accuracy gain.
5. **It doesn't scale past this dataset's current size anyway.** We're
   already capping samples at 10–25 records specifically *because* the full
   set can't reasonably go in a prompt. That cap is silently discarding data
   — which is fine if the cap is applied *after* good retrieval, and
   actively harmful if it's applied to an arbitrary or unranked slice (see
   **ISSUE-003**).
6. **It's true for any project, not just this one.** Whether the corpus is
   13,524 structured rows or a million unstructured documents, the fix is
   the same shape: retrieve a small, ranked, relevant subset *before*
   calling the model, don't hand the model a haystack and ask it to also be
   the search engine.

#### The fix: hybrid structured + semantic retrieval, with a reranking step

This dataset is structured (state, year, type, tier, posNeg are clean
categorical/numeric fields) *and* has free text (`description`, `notes`).
That means the right architecture uses **two retrieval paths**, merged:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CURRENT (broken) FLOW                        │
├─────────────────────────────────────────────────────────────────────┤
│  user query ─▶ regex/keyword guess ─▶ first-N sample ─▶ Claude       │
│               (client-side, brittle, unranked, unauditable)          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          TARGET FLOW                                  │
├─────────────────────────────────────────────────────────────────────┤
│                         user query                                    │
│                             │                                         │
│              ┌──────────────┴──────────────┐                         │
│              ▼                              ▼                         │
│   STRUCTURED FILTER TOOL          SEMANTIC VECTOR SEARCH              │
│   (exact: state/year/type/        (fuzzy: embed the query,           │
│    tier/posNeg — SQL/DuckDB/       cosine-search embedded             │
│    pandas, called by Claude        `description`/`notes` fields      │
│    via tool-use, not regex)        in a vector index)                 │
│              │                              │                         │
│              └──────────────┬───────────────┘                         │
│                             ▼                                         │
│                    candidate law records                              │
│                             ▼                                         │
│                    RERANKER MODEL                                     │
│         (cross-encoder scores query+candidate pairs directly —        │
│          more precise than embedding similarity alone; sorts          │
│          candidates by true relevance, trims to top-k)                │
│                             ▼                                         │
│              top-k ranked, grounded records ─▶ Claude                 │
│         (small, relevant, auditable — logged for eval)                │
└─────────────────────────────────────────────────────────────────────┘
```

**Structured filtering (replace the regex guessing):**
Move `getDataContext` server-side and expose it as real tools Claude can
call via native tool-use (function calling) — e.g. `filter_laws(state,
year_range, type, tier_min, posNeg)`, `aggregate_ici_score(jurisdiction)`.
Let the model decide what to query, in multiple steps if needed, instead of
a single hand-guessed regex pass. This alone fixes the "6 of 9 types have no
keyword rule" and "no cross-turn memory" problems, because the model can
just call the tool again with different arguments as the conversation
evolves. Backing store: `pandas`/DuckDB/SQLite over the cleaned dataset —
no vector math needed for these exact-match axes.

**Semantic / vector search (for the free-text fields):**
Embed `description` and `notes` for every law with a real embedding model
(e.g. `sentence-transformers`, Voyage, or OpenAI/Cohere embeddings — easy to
generate offline in Python/pandas) and store the vectors in a lightweight
vector index (FAISS, `sqlite-vss`, or Chroma — no need for a hosted vector
DB at this scale). This is what actually earns the name "semantic search":
it lets a query like "laws that punish landlords for renting to
undocumented tenants" find matching housing-type laws even if it never says
"housing" or "landlord" verbatim. This is the piece that's completely
absent today.

**Reranker model (the missing precision step):**
Embedding similarity (a bi-encoder) is fast but approximate — it's good for
narrowing 13,524 rows down to a candidate set of ~50, not for picking the
best 5. A reranker is a cross-encoder that scores the actual `(query,
candidate)` pair directly, which is slower but far more precise. Run it
*after* the structured filter + vector search produce a candidate set, to
sort that set and cut it down to the small number of records that actually
go in the prompt. Options: a hosted reranker API (Cohere Rerank), or a small
open cross-encoder (`bge-reranker`, `ms-marco-MiniLM`) run locally in
Python. This is the step that directly fixes the "irrelevant/unranked
sample" problem in **ISSUE-003**.

**Why hybrid, not vector-only:** pure vector search on the free-text fields
would be a downgrade for exact questions like "how many laws did Texas pass
in 2019" — that's a filter/aggregation problem, not a similarity problem,
and vector search will do it worse and less deterministically than a
`WHERE state='TX' AND year=2019` query. Use the structured path for
axes that are already clean columns, and the semantic path only for the
free text where there's no clean column to filter on.

#### Suggested phasing

| Phase | What | Depends on |
|---|---|---|
| 1 | Clean the data with pandas; compute real tier-weighted ICI scores; fix state field (**ISSUE-006**) | none — do this first |
| 2 | Replace client-side regex with server-side tool-calling for structured filters; fixes **ISSUE-003**, **ISSUE-004**, **ISSUE-005** | Phase 1 (needs clean data) |
| 3 | Embed `description`/`notes` — and the full-text corpora from the ICI Claude Workspace (bill texts, 287(g) MOA texts; see the Asset Inventory section) — into a vector index, wire in as a second tool | Phase 1 |
| 4 | Add reranker step over the merged candidate set from Phase 2 + 3 | Phase 2, 3 |
| 5 | Add a small eval set (sample questions + expected records) and log retrieval quality over time, so future changes can be measured, not just vibes-checked — `audit_sample.csv` in the workspace is the natural seed | Phase 2+ |

---

### ISSUE-002: ICI tier score is never used by the assistant
**Severity: Critical.** Every record has `tier` (±1 to ±4). `getDataContext`
never reads it (`frontend/src/pages/Assistant.jsx:708-875`). The assistant
can state raw positive/negative counts but not an actual ICI score — the
core metric of this whole project. Fix: compute `sum(tier)` per
jurisdiction/year in the pandas cleaning pass (Phase 1 above) and expose it
as a tool/field.

### ISSUE-003: No-match fallback returns the first 10 rows, not relevant ones
**Severity: High.** When no filter matches, `relevantData` defaults to all
13,524 laws and the sample sent to Claude is `relevantData.slice(0, 10)` —
file order, not relevance (`frontend/src/pages/Assistant.jsx:846-847`). Fix:
covered by Phase 2–4 above (real retrieval + reranking means there's no more
"no match" case with a meaningless fallback).

### ISSUE-004: No memory of filters across conversation turns
**Severity: High.** `getDataContext(query)` only looks at the latest message
text (`frontend/src/pages/Assistant.jsx:709`). A follow-up like "what about
after 2017?" without repeating the state loses the previously detected
filter. Fix: tool-calling (Phase 2) — the model retains its own filter state
across turns naturally, since it's calling tools with explicit arguments
rather than us re-guessing from raw text every time.

### ISSUE-005: Law-type keyword coverage is incomplete
**Severity: Medium.** Only Police (`P`), Employment (`E`), and Benefits
(`B`) have keyword rules. Drivers License (`D`), Language (`L`), Housing
(`H`), Voting (`W`/`V`), and Transport (`T`) have none — queries about them
silently fall through to the broken fallback in **ISSUE-003**.
Fix: made moot by Phase 2 (the model picks the type via a tool argument, not
a keyword list).

### ISSUE-006: State field has data-quality bugs
**Severity: Medium.** `metadata.states` in `data/ici_data.json` includes the
literal string `'null'`, both `'D.C.'` and `'DC'` as separate values, and
non-US entries (`'Ontario'`, `'Guam'`, `'Northern Mariana Islands'`) that
aren't in the frontend's `validStateCodes`/`stateNameMap`
(`frontend/src/pages/Assistant.jsx:717-734`), making those records
unreachable by name-based queries. Fix: normalize in the pandas cleaning
pass (Phase 1) — collapse `D.C.`/`DC`, drop/handle literal `'null'`,
decide explicitly what to do with territories/foreign entries rather than
silently mis-handling them.

### ISSUE-007: App uses a thin slice of the available corpus — full-text sources sit unused in the ICI Claude Workspace
**Severity: High.** The app's `ici_data.json` carries only one-line
descriptions per law, but the research workspace (see inventory below) holds
full bill texts, full 287(g) MOA texts, the complete news-article corpus,
the full type/subtype taxonomy, and audited quality metadata — none of which
the assistant can currently see. Retrieval quality is capped by the poverty
of the indexed text, not by the retrieval algorithm. Fix: build the Python
RAG pipeline over the workspace assets (see next section).

---

## ICI Claude Workspace — Asset Inventory for the Accurate Pipeline

> Local path: `C:\ICI Claude Workspace` (~1.9 GB). This is the full research
> workspace behind the dataset — raw sources, parsed intermediates, the
> merged master, methodology docs, and full text for two of the three source
> types. Everything the Python RAG pipeline needs lives here. Inventoried
> 2026-07-09; linkage keys below were verified programmatically, not assumed.

### What's in it

```
C:\ICI Claude Workspace\
├── data\
│   ├── ici_master\
│   │   ├── ici_master.csv           13,533 rows — THE canonical merged database
│   │   ├── ici_master_state.csv      3,460 rows — state merge (manual + NCSL pipeline)
│   │   ├── ici_master_local.csv      9,099 rows — local merge (manual + news pipeline)
│   │   ├── ici_master_287g.csv       3,498 rows — 287(g) merge (manual + PDF pipeline)
│   │   ├── ICI_Master_README.md.docx  full schema + merge/dedup methodology
│   │   ├── data_audit_methodology.md  stratified human-audit design (C1–C6 checks)
│   │   └── audit_sample.csv           531-row audit sample (checks not yet filled)
│   ├── state_laws_parsed.csv         2,658 rows — automated NCSL classifications
│   ├── local_laws_parsed.csv        17,199 rows — pre-dedup local classifications
│   ├── local_laws_deduped.csv        6,747 rows — deduped local classifications
│   ├── local_news_raw.csv           ~68 MB — raw news corpus incl. FULL ARTICLE TEXT
│   ├── 287g_fulltext.csv             1,455 rows — FULL TEXT of every parsed 287(g) MOA
│   ├── 287g_complete.csv             1,604 rows — agency/model/dates per agreement
│   └── 287g_parsed_v2[_unique].csv   1,455/1,361 rows — classified 287(g) records
├── 287g_pdfs\                          527 original ICE MOA PDFs
├── state_law_texts\                    641 .txt files — FULL BILL TEXT, filename = NCSL bill_id
└── reports\figures\                    1 analysis figure (event study)
```

### The master schema (from the workspace README)

`ici_master.csv` is the authoritative file — one row per unique provision,
26 columns. The fields that matter most for the pipeline:

- **`source_type`** — `287g` / `state` / `local`
- **`source`** — `manual` / `automated` / `both` → a built-in **confidence
  signal** (manual is the presumed-correct baseline; `both` means two
  independent pipelines agreed)
- **`type` + `subtype`** — the full SubFederal Laws taxonomy. **116 distinct
  (type, subtype) pairs** exist in the data (e.g., P/1 = 287(g) agreement,
  P/60 = sanctuary policy, W/31, B/11 …), far richer than the 9 type letters
  the app exposes today
- **`score`** — the signed ICI tier weight, already computed per row
  (±1…±4; verified distribution: 4,500 rows at −4, 5,705 at +4, etc.).
  Points follow the taxonomy: P=4, D/E/H/T=3, B=2, L/W/V=1, with subtype
  overrides
- **`provision_description`** — a *richer* Claude-generated description
  (automated rows) than the one-liner the app currently ships
- **`bill_id`**, **`source_url`**, **`article_urls`**, **`fips_county`**,
  **`n_articles`**, **`model`** (287(g) model type), **`parties`** (agency)

Note: the master extends **1974–2026** and shows the 2017 ("Trump 1",
1,418 provisions) and 2025 ("Trump 2", 4,858 provisions) spikes — the app's
marketing copy says 2005–2020, which undersells the corpus.

### Verified linkage keys (what joins to what)

| Asset | Joins to master via | Verified coverage |
|---|---|---|
| `state_law_texts/*.txt` | filename = NCSL `bill_id` (e.g. `AK2015000S147.txt`); each file also self-describes with STATE/YEAR/DESCRIPTION/SOURCE_URL header lines | 263 of 641 filenames match a master `bill_id` directly; the rest are SKIP-classified bills or manual-ID rows — join those via the file's header metadata |
| `287g_fulltext.csv` | `source_url` | **100%** — all 1,011 master 287(g) rows with a URL have full text here |
| `local_news_raw.csv` | `resolved_url`/`url` ↔ master `article_url(s)` | full article text for the local-news pipeline's evidence base |
| `audit_sample.csv` | `audit_id` + master keys | 531 rows ready for the C1–C6 human audit (not yet filled in) |

### How each asset slots into the RAG pipeline

1. **Structured store (pandas/SQLite/DuckDB)** ← `ici_master.csv` directly.
   It already has everything Phase 1 wanted: per-row signed `score`,
   `source` confidence, full taxonomy, FIPS codes. The app's
   `convert_to_json.py` already reads this exact file — but throws away
   `provision_description`, `score` semantics, and the subtype taxonomy on
   the way to `ici_data.json`.
2. **Embedding corpus (sentence-transformers → ChromaDB)** ← three text
   tiers, embedded per-chunk with metadata pointing back to the master row:
   - *Tier A (always):* `description` + `provision_description` for all
     13,533 rows — short, clean, one embedding each.
   - *Tier B (full legal text):* 641 state bill texts + 1,455 MOA full
     texts, chunked (~500–1,000 tokens) with `bill_id`/`source_url` metadata
     so a hit resolves to the master row. This is what lets a query match
     the *actual statutory language*, not just a headline.
   - *Tier C (optional, evidence):* full news articles from
     `local_news_raw.csv` for "what did coverage say about X" queries.
3. **Reranker** — cross-encoder over the candidate set from (1)+(2); the
   candidate's master-row metadata (score, source confidence, type/subtype)
   can be blended into final ranking.
4. **Answer grounding** — every retrieved chunk carries `source_url` /
   `article_url` / PDF path, so the assistant can cite the actual MOA PDF or
   bill text it's quoting. The 527 PDFs are on disk for deep-linking.
5. **Eval set (Phase 5)** ← `audit_sample.csv` + `data_audit_methodology.md`
   give a ready-made stratified sample and per-field check protocol (C1–C6).
   Once the human audit fills it in, it doubles as retrieval ground truth:
   "given this description, does the pipeline retrieve the right row?"
6. **Taxonomy prompt/tool docs** ← the README's type/subtype/score tables
   (and `Categories of SubFederal Laws.md`, referenced but **not present in
   the workspace copy — obtain it**) become the tool-argument enums and the
   system-prompt glossary, replacing the app's 9-letter `typeMap`.

### Gaps found while inventorying

- `Categories of SubFederal Laws.md` (the full taxonomy doc) is referenced
  by the audit methodology but missing from this workspace copy — needed for
  the definitive subtype table (116 pairs exist in-data; the doc defines them).
- The merge/pipeline scripts the README references (`scripts/merge_*.py`,
  `agents/parse_*.py`, `scripts/build_ici_master.py`) are not in this copy —
  we can rebuild aggregations ourselves in pandas, but the originals would
  save re-derivation.
- `audit_sample.csv` exists but no checks are filled in yet — the error-rate
  numbers for the paper (and our eval ground truth) don't exist until the
  human audit runs.
- ~378 of the 641 state-law text files don't key directly to a master
  `bill_id` (SKIP rows / manual-format IDs) — the pipeline's ingest step
  must join them via the in-file header metadata instead, or accept them as
  index-only documents.

---

## Changelog

- **2026-07-09** — File created. Logged the full RAG/retrieval audit
  (ISSUE-001 through ISSUE-006) after reviewing `server.js`,
  `frontend/src/pages/Assistant.jsx`, `scripts/convert_to_json.py`, and
  `data/ici_data.json`.
- **2026-07-09 (later)** — Inventoried `C:\ICI Claude Workspace` (~1.9 GB):
  master database schema, full-text corpora (641 bill texts, 1,455 MOA
  full-texts, 527 PDFs, 68 MB news corpus), audit methodology, and verified
  the linkage keys between them. Added ISSUE-007 and the "Asset Inventory
  for the Accurate Pipeline" section mapping each asset to its role in the
  planned sentence-transformers + ChromaDB + reranker pipeline.

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
| **ISSUE-001** | AI Assistant retrieval is keyword-guessing, not RAG | AI Assistant | 🔴 Critical | 🟢 Fixed (Stage 5) |
| **ISSUE-002** | ICI tier score is never used by the assistant | AI Assistant / Data | 🔴 Critical | 🟢 Fixed (Stage 5) |
| **ISSUE-003** | No-match fallback returns the first 10 rows, not relevant ones | AI Assistant | 🟠 High | 🟢 Fixed (Stage 5) |
| **ISSUE-004** | No memory of filters across conversation turns | AI Assistant | 🟠 High | 🟢 Fixed (Stage 5) |
| **ISSUE-005** | Law-type keyword coverage is incomplete (3 of 9 types) | AI Assistant | 🟡 Medium | 🟢 Fixed (Stage 5) |
| **ISSUE-006** | State field has data-quality bugs (`'null'`, `D.C.`/`DC`, non-US entries) | Data Pipeline | 🟡 Medium | Open |
| **ISSUE-007** | App uses a thin slice of the available corpus — full-text sources sit unused in the ICI Claude Workspace | Data Pipeline / AI Assistant | 🟠 High | Open |
| **ISSUE-008** | AI Assistant is dead in production — backend URL is still a placeholder | Frontend / Deploy | 🔴 Critical | Open |
| **ISSUE-009** | Stored XSS via chat messages (raw user input → `innerHTML`, persisted & replayed) | Security | 🔴 Critical | 🟢 Fixed |
| **ISSUE-010** | Chat proxy has wildcard CORS and no rate limiting → API-credit theft | Security / Backend | 🟠 High | 🟢 Fixed |
| **ISSUE-011** | Unsanitized AI/markdown output + data-driven XSS in result tables | Security | 🟠 High | 🟢 Fixed |
| **ISSUE-012** | Contact form silently discards every submission | Frontend | 🟠 High | Open (owner) |
| **ISSUE-013** | Data pipeline not reproducible — source CSV absent, hardcoded absolute paths | Data Pipeline | 🟠 High | Open |
| **ISSUE-014** | System prompt does not constrain hallucination (no "use only provided data") | AI Assistant | 🟠 High | 🟢 Fixed |
| **ISSUE-015** | The entire app exists twice — legacy `src/pages/*.html` vs the React frontend | Architecture | 🟡 Medium | 🟢 Fixed |
| **ISSUE-016** | God files with imperative DOM manipulation inside React | Architecture | 🟡 Medium | Open |
| **ISSUE-017** | `typeMap` & state maps duplicated across 5+ places (already drifting) | Architecture / Data | 🟡 Medium | 🟢 Fixed |
| **ISSUE-018** | Copy-pasted logic across the two chat interfaces (~60%+ shared) | Architecture | 🟡 Medium | 🟡 Reduced |
| **ISSUE-019** | CSV export formula injection (no `= + - @` neutralization) | Security | 🟡 Medium | 🟢 Fixed |
| **ISSUE-020** | 6.24 MB data file, byte-duplicated, fully parsed on every page load | Performance | 🟡 Medium | 🟡 Partly fixed |
| **ISSUE-021** | Widespread null/missing fields only partly handled (164 null years, etc.) | Data / Frontend | 🟡 Medium | Open |
| **ISSUE-022** | No loading / error / empty states; silent `catch {}` swallowing failures | Frontend / UX | 🟡 Medium | Open |
| **ISSUE-023** | Hero stats hardcoded; "2005–2026 / 21 yrs" coverage label is wrong | Frontend / Accuracy | 🟡 Medium | 🟢 Verified |
| **ISSUE-024** | README & CLAUDE.md materially outdated (wrong architecture, sizes, counts) | Docs | 🔵 Low | 🟢 Fixed |
| **ISSUE-025** | No automated tests anywhere | Testing | 🔵 Low | Open |
| **ISSUE-026** | Data provenance (manual vs automated, source URLs) not surfaced in the UI | Data / Product | 🔵 Low | Open |
| **ISSUE-027** | Observability is console-only; production failures go unnoticed | Backend / Ops | 🔵 Low | Open |
| **ISSUE-028** | Git hygiene & misc (`.DS_Store` tracked, dead deps, CDN SRI, repo URLs, licensing) | Maintenance | 🔵 Low | 🟡 Partly fixed |
| **ISSUE-029** | Assistant: opening the Chats sidebar overlays the chat instead of shifting it right | Frontend / UX | 🔵 Low | Open |
| **ISSUE-030** | `subtype` field in the master has malformed values (`null`, `None`, `language`, wrong-type codes) | Data Pipeline | 🟡 Medium | 🟡 Validated (source fix pending) |

*(IDs below are not deep-links — this file is short enough to scroll or Ctrl+F.)*
*ISSUE-008+ come from the 2026-07-13 full-repo codebase audit — see the "Codebase Audit" section below. Severity key adds 🔵 Low.*

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

- ~~`Categories of SubFederal Laws.md` (the full taxonomy doc) is referenced
  by the audit methodology but missing from this workspace copy~~ **— RESOLVED
  2026-07-14.** The doc was provided; it now lives at
  `pipeline/reference/Categories_of_SubFederal_Laws.md` (tracked) + the workspace
  copy, and is encoded in `pipeline/taxonomy.py` for validation. It defines 76
  subtype codes across the 9 types (globally unique, with point overrides). See
  ISSUE-030 for the resulting validation.
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

## Codebase Audit — Production-Readiness Review (2026-07-13)

> Full-repo audit ahead of public deployment. Every source file was read in
> full (`server.js`, `api/chat.js`, `scripts/convert_to_json.py`, the five
> legacy `src/pages/*.html`, and the whole React app under `frontend/src/`);
> `data/ici_data.json` was analysed programmatically (counts, null-field
> census, encoding, XSS-character scan); git history was scanned for secrets.
> **Overall grade: D+ — not production-ready.** The two ship-blockers are
> ISSUE-008 (flagship AI feature is dead on the live site) and ISSUE-010
> (the chat proxy can be abused to drain API credits); fix those together,
> since exposing a working endpoint without rate limiting turns "feature down"
> into "credits drained." The ISSUE-001…007 RAG work above is orthogonal and
> still stands — this section is about security, correctness, and deployment,
> not retrieval quality.
>
> **What was checked and found clean (no padding):** no secrets in code or
> git history; the server-side key-proxy design is correct and the key is
> never reachable client-side; `ici_data.json` is internally consistent
> (`totalCount` 13,524 = sum of arrays; `posNeg ∈ {0,1}` for all rows);
> UTF-8 encoding is intact (333 non-ASCII rows, no mojibake); Chart.js
> instances are destroyed before re-creation (no chart memory leak).

### ISSUE-008: AI Assistant is dead in production — backend URL is a placeholder
**Severity: Critical.** `frontend/src/pages/Assistant.jsx:23-25` still ships
the literal placeholder as the production API host:
```js
const API_BASE = /\.github\.io$/.test(location.hostname)
    ? 'https://REPLACE-WITH-RENDER-URL.onrender.com'   // never replaced
    : '';
```
On the deployed GitHub Pages site every `/api/*` call (chat, history, title
generation) goes to a host that doesn't exist — the 502s are already visible
in the console. The most prominently advertised capability ("Get instant
answers from the AI assistant", `frontend/src/pages/Home.jsx:198`) does
nothing for a public visitor. **Fix:** stand up the Node + SQLite backend
(`server.js`) on a real host (Render/Fly/etc.) with `ANTHROPIC_API_KEY` set,
replace the placeholder with its URL, and apply ISSUE-010 before exposing it.
The legacy `src/pages/chatbot-ai.html:1235-1237` carries the same placeholder.

### ISSUE-009: Stored XSS via chat messages
**Severity: Critical.** `addMessage` writes content into `innerHTML` with no
escaping (`frontend/src/pages/Assistant.jsx:690`), and the user's raw query is
passed straight in (`:1083`):
```js
div.innerHTML = `<div class="message-content">${content}</div>`; // :690
addMessage('user', query);                                        // :1083
```
The message is then POSTed to `/api/chat`, stored in SQLite, and replayed
through the same path on reload (`:596-597`), so `<img src=x onerror=…>` is
**stored** and re-executes for anyone who later opens that chat. An `esc()`
helper already exists (`:52-54`) and is correctly used for chat *names* — it
was simply never applied to message bodies. Same bug in the legacy twin
(`src/pages/chatbot-ai.html:1585` + `:2088`). **Fix:** `esc()` user content
before insertion; render bot content only through the sanitized path (ISSUE-011).
**🟢 Fixed 2026-07-13 (727b73a):** `addMessage` escapes content when
`type === 'user'` in both React chat components (added an `esc` helper to
DataExplorer). Verified in a headless browser — an `<img onerror>` payload
renders as inert escaped text and no handler fires. Legacy HTML still carries
it, pending ISSUE-015 deletion.

### ISSUE-010: Chat proxy has wildcard CORS and no rate limiting → credit theft
**Severity: High.** `server.js:255` sets `Access-Control-Allow-Origin: '*'`
with no throttle, auth, or request cap anywhere in the handler; `api/chat.js:3`
does the same and additionally pairs `Origin: *` with
`Access-Control-Allow-Credentials: true` (an invalid/insecure combination).
Any third-party site or a `curl` loop can drive paid Claude completions on the
authors' account. At Sonnet pricing with `max_tokens: 1024` plus a
~thousand-token system prompt per call, sustained abuse is **tens of dollars
per hour, unbounded** — a weekend is a four-figure bill. **Fix:** restrict
CORS to the known front-end origin(s); add per-IP rate limiting (a small
in-memory token bucket suffices for `server.js`; use the platform limiter or a
KV store on serverless); cap conversation length and `max_tokens`; consider a
shared secret or Turnstile on the endpoint.
**🟢 Fixed 2026-07-13 (727b73a):** wildcard CORS replaced with an
`ALLOWED_ORIGINS` allowlist (localhost always allowed) in both `server.js` and
`api/chat.js`; added a per-IP fixed-window rate limiter (`RATE_LIMIT_MAX` /
`RATE_LIMIT_WINDOW`, default 20/min) on `/api/chat`, plus request-body
validation. `api/chat.js` also dropped the invalid `Allow-Credentials: true` +
`*` combo. Verified: 429 after the cap; CORS header only for allowlisted
origins. Still TODO: cap conversation length/`max_tokens`, and a secret/Turnstile.

### ISSUE-011: Unsanitized AI/markdown output + data-driven XSS in tables
**Severity: High.** `formatResponse` builds HTML from the model's raw text via
regex and never escapes non-markdown characters
(`frontend/src/pages/Assistant.jsx:929-1010`, rendered at `:1093`). Separately,
the result tables interpolate `law.description` — external data — into both an
attribute and cell text unescaped (`frontend/src/pages/DataExplorer.jsx:459`,
`Assistant.jsx:1065`):
```js
html += `<td class="truncate" title="${law.description || ''}">${desc}</td>`;
```
**This is live, not hypothetical:** a scan of `ici_data.json` found **146
descriptions containing a `"`** (which breaks out of the `title="…"`
attribute) and **1 containing a `<`**. As automated-pipeline rows grow, a
description like `"><img src=x onerror=…>` becomes executable. **Fix:** escape
every data interpolation (`esc(...)`), and route AI markdown through a vetted
sanitizer — a build system already exists, so add `marked` + `DOMPurify`
(`DOMPurify.sanitize(marked.parse(text))`) instead of the hand-rolled regex
formatter. Correlates with the hallucination constraint in ISSUE-014.
**🟢 Fixed 2026-07-13 (727b73a):** took the no-new-dependency route —
`formatResponse` now `esc()`s its input as the very first step, so every tag
in the output is one we generate from a known markdown subset and any literal
markup (from the model or data) is inert; all law-data fields interpolated into
result tables are `esc()`'d in both components. (A `marked` + `DOMPurify`
migration remains a reasonable future hardening if the markdown grows.)

### ISSUE-012: Contact form silently discards every submission
**Severity: High.** `handleSubmit` validates the email then just sets
`submitted = true` — there is no `fetch`, no `mailto`, no backend
(`frontend/src/pages/Contact.jsx:43-52`). The user sees "Enquiry received —
the research team will be in touch," but nothing is transmitted anywhere. Real
enquiries from law firms, agencies, and researchers vanish. **Fix:** wire the
form to a real destination (a form service like Formspree, an email API, or a
new backend route) before launch, or remove the success confirmation so it
doesn't misrepresent what happened.

### ISSUE-013: Data pipeline not reproducible — source absent, hardcoded paths
**Severity: High.** `scripts/convert_to_json.py:12-13`:
```python
CSV_PATH  = r"C:\Users\ZEN\Downloads\ICI Claude Workspace\data\ici_master\ici_master.csv"
JSON_PATH = r"C:\Users\ZEN\UsersZENImmigrant-Climate\ici_data.json"
```
Three compounding problems: (1) the input `ici_master.csv` is **not committed**
(only the older 2005–2020 `.xlsx` files are in `data/source/`, a *different*
dataset — hence the cross-check the audit wanted to run is impossible);
(2) both paths are machine-local absolutes, so the script only runs on the
author's PC; (3) the **output path is wrong** — it writes repo-root
`ici_data.json`, but the app reads `data/ici_data.json` and
`frontend/public/data/ici_data.json`, so running the script wouldn't even
update the served files. No `requirements.txt` either (the script happens to
use stdlib only). **Fix:** commit `ici_master.csv` (or document its location +
license), make paths relative/CLI-driven, write to the served location(s), add
a `scripts/README`. Ties into the master-file plan in ISSUE-007 / the Asset
Inventory above.

### ISSUE-014: System prompt does not constrain hallucination
**Severity: High.** The system prompt (`frontend/src/pages/Assistant.jsx:880-902`)
supplies aggregated numbers but never tells the model to use *only* the
provided context or to say "I don't know" when data is absent — its rules
govern terminology, not factuality. Combined with the keyword retrieval's
silent "all laws / first 10 rows" fallback (**ISSUE-001**, **ISSUE-003**), the
model can confidently answer from the wrong slice or invent a plausible
statistic — a citable accuracy failure attached to the authors' names. **Fix:**
add explicit grounding constraints ("Answer only from the data context below;
if it's not there, say you don't have it; never estimate or invent numbers;
every figure must appear in the context"), and echo the active filter to the
user. This is the near-term mitigation until the RAG rebuild (ISSUE-001) lands.
**🟢 Fixed 2026-07-13 (727b73a):** the system prompt now leads with explicit
GROUNDING rules — answer only from the provided data context, say when the data
doesn't cover something, and never invent bill names, citations, or numbers.
The stronger structural fix (real retrieval) still tracks under ISSUE-001.

### ISSUE-015: The entire app exists twice — legacy HTML vs React
**Severity: Medium.** Two parallel front-ends implement the same five screens:
the legacy vanilla-HTML app (`src/pages/{home,team,contact,chatbot,chatbot-ai}.html`,
~380 KB, served by `server.js`) and the React app (`frontend/src/pages/*`,
deployed to Pages). `DataExplorer.jsx` ports `chatbot.html`; `Assistant.jsx`
ports `chatbot-ai.html`. Only the React build is live; the legacy set is dead
weight that still "works" enough to mislead maintainers and carries its own
copies of the XSS bugs (ISSUE-009/011) and the unpinned CDN Chart.js. **Fix:**
delete `src/pages/*.html` and repoint `server.js` static routes at
`frontend/dist`, or formally archive them. Removes ~380 KB and half the XSS
surface.
**🟢 Fixed 2026-07-13 (3937df9):** deleted all five legacy pages and repointed
`server.js` at `frontend/dist` with an SPA fallback to `index.html` (dev stays
on the Vite server; prod is GitHub Pages). This also removed the last copies of
the ISSUE-009/011 XSS and the unpinned-CDN Chart.js (the ISSUE-028 residual).
Verified `server.js` serves `/`, SPA routes, `/data`, `/research.html`, and
404s correctly. Docs still describe the old layout — tracked in ISSUE-024.

### ISSUE-016: God files with imperative DOM manipulation inside React
**Severity: Medium.** `frontend/src/pages/Assistant.jsx` is 77 KB / ~1,215
lines; `DataExplorer.jsx` is 49 KB. Each is a single giant `useEffect` doing
data loading, query parsing, aggregation, markdown→HTML, Chart.js rendering,
SQLite CRUD, sidebar/project management, and modals — 5–6 responsibilities in
one closure. Both manipulate the DOM directly (`document.createElement`,
`innerHTML`, `querySelector('#id')`) instead of rendering from state, so React
is a mounting shell and its automatic escaping (which would have prevented
ISSUE-009/011) is bypassed. **Fix:** not a launch blocker but the
highest-value refactor — extract shared modules (ISSUE-018) and move rendering
to JSX/state, starting with the message list so escaping becomes automatic.

### ISSUE-017: typeMap & state maps duplicated across 5+ places
**Severity: Medium.** The `typeMap`/`TYPE_MAP` and state-name→code maps are
independently re-declared in `scripts/convert_to_json.py:15-25`,
`frontend/src/pages/Assistant.jsx:722+`, `DataExplorer.jsx`,
`src/pages/chatbot-ai.html:1641`, and `src/pages/chatbot.html` — plus the type
map is echoed into the system prompt. **They already disagree** (the Python
`TYPE_MAP` maps `W`→Voting / `V`→Voting Rights and omits others). Changing one
score weight or label means editing 5–6 files. **Fix:** make `ici_data.json`
the single source of truth for `typeMap` (it already carries one) and derive
the state map from `metadata.states`; delete the hardcoded copies. Overlaps
with ISSUE-005 (incomplete type coverage) — both dissolve once the taxonomy
comes from one place (see the 116-subtype taxonomy note in the Asset Inventory).
**🟢 Fixed 2026-07-13 (3937df9):** state maps (previously hardcoded four times
with differing, incomplete contents) now come from one module,
`frontend/src/lib/usStates.js` (full 50 + DC + PR, `resolveStateCode` helper),
imported by both chat components — so "compare Ohio and Michigan" resolves
consistently everywhere. `typeMap` was already single-sourced
(`convert_to_json.py` → `ici_data.json` → `DATA.typeMap`); deleting the legacy
HTML (ISSUE-015) removed its remaining hardcoded copies.

### ISSUE-018: Copy-pasted logic across the two chat interfaces
**Severity: Medium.** `loadData`, `getDataContext`, `formatResponse`,
`addMessage`, `updateResultsTable`, the Chart.js setup, and `STATE_NAMES` are
duplicated near-verbatim between `Assistant.jsx` and `chatbot-ai.html`, and
between `DataExplorer.jsx` and `chatbot.html` (~60%+ shared per pair; e.g.
`formatResponse` at `Assistant.jsx:929` ≈ `chatbot-ai.html:1891`). **Fix:**
extract framework-agnostic modules — `lib/iciData.js` (load/cache),
`lib/queryContext.js` (aggregation), `lib/markdown.js` (sanitized format),
`lib/charts.js`, `lib/maps.js` — imported by React (and the HTML if kept).
Deleting the legacy set (ISSUE-015) removes half of this outright.
**🟡 Reduced 2026-07-13 (3937df9):** ISSUE-015 deleted the legacy HTML (the
Assistant↔chatbot-ai and DataExplorer↔chatbot duplication), and ISSUE-017
extracted the first shared module (`lib/usStates.js`). The remaining
duplication is between `Assistant.jsx` and `DataExplorer.jsx` themselves
(`loadData`, `formatResponse`, chart setup, `esc`) — still to extract into the
`lib/` structure above.

### ISSUE-019: CSV export formula injection
**Severity: Medium.** `frontend/src/pages/DataExplorer.jsx:472-491` doubles
quotes correctly but writes fields beginning with `=`, `+`, `-`, or `@` raw;
opening the exported `ici_export.csv` in Excel/Sheets executes those cells as
formulas. Descriptions are free text and can begin with such a character.
**Fix:** prefix any cell starting with `= + - @` with a `'` (or leading space)
during export.
**🟢 Fixed 2026-07-13 (727b73a):** `exportCSV` now runs every value through a
`csvSafe()` helper that prefixes cells starting with `= + - @` (or tab/CR) with
a `'` before quoting.

### ISSUE-020: 6.24 MB data file, byte-duplicated, fully parsed per load
**Severity: Medium.** `data/ici_data.json` is **6.24 MB uncompressed / 0.81 MB
gzipped** (not the "~1.7 MB" quoted in ISSUE-001, the README, and CLAUDE.md —
all outdated). It is **byte-for-byte duplicated** at
`frontend/public/data/ici_data.json` (identical MD5) — 13 MB of repo is the
same file twice, and the two can drift if only one is regenerated. The whole
file is fetched, parsed, and held in memory on every visit, and both chat
engines then `concat` + `.map(...spread)` all 13,524 rows into a new array on
every query (`Assistant.jsx:710-712`). **Fix:** de-dupe to one canonical copy
(build step copies into `dist`); cache the `allLaws` concat once; longer term,
shard or precompute aggregates (ties into ISSUE-001's server-side store).
**🟡 Partly fixed 2026-07-13 (3937df9):** de-duplicated — deleted the
byte-identical root `data/ici_data.json`; the single canonical copy is
`frontend/public/data/ici_data.json` (Vite copies it into `dist` at build), and
`convert_to_json.py` now writes there. **Still open:** the 6.24 MB file is still
fetched and JSON-parsed in full on every load, and both engines rebuild the
`allLaws` array per query — the caching/sharding/precompute work remains.

### ISSUE-021: Widespread null/missing fields only partly handled
**Severity: Medium.** Field census over all 13,524 records: **year missing 164,
state missing 20, county 6,762, city 7,739, sourceUrl 10,938 (81%).** No crash
was found (comparisons are null-safe and charts guard `if (l.year)`), but null
years are silently dropped from trend charts and the 20 stateless rows never
match a state filter — completeness issues hidden from the user. Extends
**ISSUE-006** (which flagged `'null'`, `D.C.`/`DC`, non-US entries in the state
field) to the fuller null-field picture. **Fix:** normalize in the Phase-1
pandas pass (ISSUE-006); surface "N records with unknown year excluded" on
charts; decide a policy for stateless rows.

### ISSUE-022: No loading / error / empty states; silent failures
**Severity: Medium.** The 6 MB `ici_data.json` fetch has no spinner, retry, or
error UI — on a slow link the page looks broken for seconds
(`Assistant.jsx:667-675`, `DataExplorer.jsx`). `loadChatList` swallows errors
with an empty `catch {}`, so when the backend is down (which it is in
production — ISSUE-008) the sidebar just stays empty with no explanation. A
zero-match filter in DataExplorer renders an empty table body rather than a "no
results" message. **Fix:** add explicit loading/empty/error states; replace
silent `catch {}` with visible degradation.

### ISSUE-023: Hero stats hardcoded; coverage label wrong
**Severity: Medium.** `frontend/src/pages/Home.jsx` hardcodes the hero stats.
Verified against the data: **"13,524 Laws"** (lines 45, 137, 198) and
**"3,491 287(g)"** (line 57) currently **match** the JSON exactly — so they're
correct today, but hardcoded in three places and will drift as the dataset
grows toward the ~13,533 master. The **"21 yrs — Coverage (2005–2026)"** label
(lines 53-54) is **wrong**: the data's `yearRange` is **[1974, 2026]** with
enacted-year records back to 1974 (the Asset Inventory above makes the same
point — the master spans 1974–2026 and "2005–2020 undersells the corpus").
**Fix:** derive counters from `DATA.metadata` at runtime; correct or footnote
the coverage window.
**🟢 Verified 2026-07-13 — no code change.** On measuring the year
distribution: only **35 records (0.3%)** are pre-2005 (scattered outliers:
1974, 1983-2004), **37.6%** are 2005-2020, and **62.1%** are post-2020 (to
2026). So "Coverage (2005–2026)" covers **99.7%** of the data and is defensible,
and the counts (13,524 / 3,491) match the JSON exactly — no visible bug to fix.
Downgraded from "wrong" to a note: the numbers remain hardcoded (drift risk),
but adding a 6 MB fetch to the landing page just to derive three integers would
be a net negative; revisit with a tiny metadata-only file if/when the data
regenerates. (Note: the README's "2005–2020" claim *is* wrong — it cuts 62% of
the data — tracked under ISSUE-024.)

### ISSUE-024: README & CLAUDE.md materially outdated
**Severity: Low** (high embarrassment risk). `README.md` describes a different
app than the one that ships: "2005 to 2020" (data is 1974–2026); "~1.7 MB"
(6.24 MB); `stateLaws 1,910 / localLaws 2,618 / yearRange [2005,2020]` (actually
3,458 / 6,575 / [1974,2026]); the file-structure/architecture diagrams describe
only `src/pages/*.html` and **omit the entire React `frontend/` that is
actually deployed**; "AI assistant frontend: Vanilla JS + marked" (it's React
with a custom regex formatter, not marked); the pandas/Excel "Updating the
Data" recipe doesn't match `convert_to_json.py`. `CLAUDE.md` is stale the same
way. **Fix:** rewrite both to match the React app, real data shape, and real
pipeline.
**🟢 Fixed 2026-07-13:** rewrote both `README.md` and `CLAUDE.md` from scratch to
describe the shipped app — the React/Vite front-end (routes, structure), the Node
proxy + SQLite backend, the stdlib Python pipeline (reads
`ici_workspace/.../ici_master.csv`, writes `frontend/public/data/ici_data.json`),
the real data shape/counts (3,458 / 6,575 / 3,491 = 13,524; 1974–2026; ~6.2 MB),
GitHub Pages deploy, and accurate dev/build/run commands. Both now point at
ISSUES.md + PIPELINEWORKFLOW.md for the RAG work. All figures re-verified against
`ici_data.json` before writing.

### ISSUE-025: No automated tests anywhere
**Severity: Low** (structural risk). Zero test files; the root `package.json`
`test` script is the npm placeholder that exits 1. Highest-value tests are
data/aggregation correctness. **Proposed minimal suite (priority order):**
(1) `ici_data.json` schema/invariants; (2) `getDataContext` counts for a known
state vs fixture; (3) filter row-counts; (4) `formatResponse` escapes
`< > "` (regression guard for ISSUE-011); (5) CSV export neutralizes quotes +
formulas (ISSUE-019); (6) posNeg/tier→label mapping; (7) comparison-mode
partitioning; (8) null-year rows excluded from trends but counted in totals;
(9) `convert_to_json.py` on a tiny fixture; (10) Contact email-provider
rejection.

### ISSUE-026: Data provenance not surfaced in the UI
**Severity: Low** (academically important). The converter carries `source`,
`inManual`, `inAutomated` per record (`convert_to_json.py:58-60`) and the
master has a `source` confidence signal (manual/automated/both — see Asset
Inventory), yet the UI never distinguishes verified from automated laws, and
**81% of records have no `sourceUrl`** so a user can't trace a claim to a
statute. For a tool meant to support litigation/policy this is close to a
requirement. **Fix:** show a provenance badge in results and the AI's cited
rows; expose `sourceUrl`; consider flagging/excluding automated rows in
headline counts. Depends on the richer master fields (ISSUE-007/013).

### ISSUE-027: Observability is console-only
**Severity: Low.** `server.js` logs via `console` (6 sites); `api/chat.js` does
`console.error`. No structured logging, request logging, or error alerting — if
the production chat backend fails (it does, ISSUE-008) nobody is notified; the
only symptom is a client-side 502. **Fix:** add minimal request/error logging
and an alert on upstream failures.

### ISSUE-028: Git hygiene & miscellaneous
**Severity: Low.** Grab-bag of quick items found during the sweep:
- **`.DS_Store` is tracked** (6,148 bytes) despite being gitignored — committed
  before the ignore rule. `git rm --cached .DS_Store`.
- **`react-chartjs-2` is a declared dependency but never imported**
  (`frontend/package.json:15`) — the app uses `chart.js/auto` directly. Dead.
- **`import math` unused** in `convert_to_json.py:8`.
- **Legacy CDN Chart.js is unpinned + no SRI** (`src/pages/chatbot-ai.html:10`,
  `chatbot.html:10`) — `npm/chart.js` runs whatever jsDelivr serves as latest
  with full page privileges. (Production React pins `chart.js@^4.5.1` via npm,
  so the live site isn't exposed — this is legacy-only, moot if ISSUE-015 deletes them.)
- **Root `package.json` `repository`/`homepage`/`bugs` point at
  `vpham415/Immigrant-Climate`** (upstream), not `zfa2005/ICI-`.
- **No `LICENSE` file** for code (root `package.json` claims ISC with no text)
  or a stated license/terms for the dataset — decide before public release.
- **Chat send has only the disabled-input guard** — no `AbortController` or
  in-flight flag (`Assistant.jsx:1086-1108`); low-risk race, tighten during the
  ISSUE-016 refactor.

**🟡 Partly fixed 2026-07-13 (727b73a / 5e38408 / 3937df9):** done —
`.DS_Store` untracked; `react-chartjs-2` removed; unused `import math` removed;
root `package.json` URLs repointed at `zfa2005/ICI-`; **legacy CDN SRI now moot**
(the unpinned-Chart.js files were deleted by ISSUE-015). Still open — `LICENSE`
(needs an owner decision on license type) and the chat-send race (defer to
ISSUE-016).

---

## UI / UX Reports

### ISSUE-029: Opening the Assistant Chats sidebar overlays the chat instead of shifting it right
**Severity: Low** (UX polish). **Reported 2026-07-13.** In the AI Assistant,
opening the left "Chats" history panel does not move the chat column — the panel
slides out *over the top* of it. The chat should shift to the right along with
the sidebar (a push/reflow), so both sit side by side.

Why it happens: on wide screens the chat already reflows —
`.assistant .main-wrapper` carries `margin-left: 220px` and drops to `0` when the
`.sidebar-collapsed` class is present (`frontend/src/pages/Assistant.css:792-794`
and `:49`). But the `@media (max-width: 900px)` block forces
`.assistant .main-wrapper { margin-left: 0 }` **unconditionally**
(`frontend/src/pages/Assistant.css:804-813`), so below that width the panel
becomes an off-canvas overlay and the chat stays put. The collapse state is a
class toggled on the component root (`setSidebarCollapsed`,
`frontend/src/pages/Assistant.jsx:1108-1109`), and the panel starts collapsed on
narrow screens (`Assistant.jsx:1280-1282`).

**Fix options:** (a) in the ≤900px block, drive `margin-left` off the
`.sidebar-collapsed` state the same way the desktop rule does, so opening the
panel pushes the chat right instead of covering it; or (b) raise the push
breakpoint. Caveat: on a genuinely narrow phone, a 220–250px push leaves very
little room for the chat, so either keep the overlay only below some smaller
width, or scale the panel/content — worth deciding what width the push should
start at rather than pushing at every size.

---

## Data Pipeline Findings

### ISSUE-030: The `subtype` field in the master CSV has malformed values
**Severity: Medium.** **Discovered 2026-07-14** during the Stage-1 ingest of the
retrieval pipeline (`pipeline/ingest.py`). The master has **116** distinct
(type, subtype) pairs, but among the pairs that appear exactly once are clearly
malformed subtype values, e.g.: `L/null`, `V/None`, `T/T`, `L/language`, and
`P/PD FaceBook post 11/15/16` (a free-text note stuffed into the subtype column).
These can't be validated authoritatively because the workspace's
`Categories of SubFederal Laws.md` (the definitive type/subtype taxonomy) is
missing (already noted in the Asset Inventory gaps) — so the pipeline flags
singleton pairs for review rather than hard-failing them. Full list in
`pipeline/out/validation_report.md` ("Subtype pairs").

**Why it matters:** subtype is part of the ICI taxonomy and will become a tool
argument / metadata filter in Stages 2–5; garbage values will surface in
`aggregate_laws(group_by="subtype")` and in retrieval metadata. **Fix:** obtain
`Categories of SubFederal Laws.md`, validate every (type, subtype) pair against
it, and correct the handful of malformed rows at the source (they're few). Until
then they're kept and flagged, not dropped.

**🟡 Validated 2026-07-14 (taxonomy obtained).** The authoritative
"Categories of SubFederal Laws" doc was provided and is now in the repo
(`pipeline/reference/Categories_of_SubFederal_Laws.md`) and encoded machine-
readably in `pipeline/taxonomy.py` (76 subtype codes; codes are globally unique;
point overrides B/12,14→1 and E/18,19,20,21,62→2 captured). `ingest.py` now
validates every (type, subtype) pair against it. **Precise picture (of 13,533):**
- **13,387** rows have a valid pair; **0** blank.
- **121** rows use a subtype code under the *wrong* type — real errors now caught,
  e.g. `B/2` (2 = Secure Communities is a P code), `E/13` (13 = Drivers Licenses
  is a D code), `W/10` (10 = Education is a B code). 31 distinct mismatches.
- **25** rows have an off-list value: `'null'`, `'None'`, `'language'`, `'Vote'`,
  `'el'`, `'L'`, `'T'`, `'V'`, `'PD FaceBook post 11/15/16'`.
- **0** rows where |score| disagrees with the subtype's documented points — i.e.
  the scoring is fully consistent with the taxonomy (validates both the encoding
  and the data's weights).
Full itemized law_ids in `pipeline/out/validation_report.md`; regression-locked
in `pipeline/tests/test_taxonomy.py`. **Remaining:** the 146 flagged rows still
need correcting at the source (they're kept and flagged, never dropped) — a
professor/data-owner task, not a code change.

**🟡 Correction proposal prepared 2026-07-14 (awaiting professor decision).**
Investigating the 146 rows showed the "fix" is a research-classification call,
not a mechanical replace: the score magnitude confirms the *type* is usually
right and the *subtype* is off, and the errors are **systematic** — 36× `B/13`,
22× `P/58`, 16× `P/54`, 13× `L/L` — i.e. likely intentional classifications or a
pipeline-wide choice, which is the authors' decision. So the pipeline now ships:
- a **non-destructive corrections layer** — `pipeline/corrections.csv` (approved
  fixes only) applied to the derived parquet/sqlite at ingest; the canonical
  `ici_master.csv` is never edited (`apply_corrections` in `ingest.py`);
- a **reviewable proposal** — `python pipeline/propose_corrections.py` writes
  `pipeline/out/corrections_proposed.csv` (per-row: current value, description,
  score-based hint on which field is wrong, suggested fix, confidence) and
  `corrections_review.md` (grouped by pattern for one-decision-each sign-off).
Only **8** rows are high-confidence mechanical (placeholder subtype + type
already right + one obvious code, e.g. `V/Vote`→`V/32`, `T/T`→`T/66`); the other
**138** need the professor's classification. **Nothing has been applied** —
`corrections.csv` is empty pending review. Once approved, populate it and re-run
ingest (one step). This is the "clean data" gate before Stage 3 embeddings.

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
- **2026-07-13** — Full-repo production-readiness codebase audit. Read every
  source file, analysed `data/ici_data.json` programmatically, and scanned git
  history for secrets. Added ISSUE-008 through ISSUE-028 and the "Codebase
  Audit" section (security, correctness, deployment, docs, tests). Two
  ship-blockers: ISSUE-008 (AI assistant dead in production) and ISSUE-010
  (unprotected chat proxy → credit theft). Cross-referenced overlaps with the
  existing RAG issues (ISSUE-014↔001/003, ISSUE-017↔005, ISSUE-021↔006).
  Confirmed clean: no committed secrets, sound key-proxy design, internally
  consistent data, intact encoding, no chart memory leak. Merged in from a
  standalone `codebase_audit.md`, which was then deleted to keep this file the
  single tracker.
- **2026-07-13 (fix batch 1)** — Started working through the audit findings
  (ISSUE-012 deferred to its owner pending a form host). Fixed and pushed:
  ISSUE-009 (stored XSS in chat messages), ISSUE-011 (unsanitized AI output +
  data-driven table XSS), ISSUE-019 (CSV formula injection), ISSUE-010 (CORS
  allowlist + `/api/chat` rate limiting + body validation), ISSUE-014 (system
  prompt grounding constraints). Verified in a headless browser (XSS payload
  renders inert; normal queries still work) and by load-testing the rate limiter
  (429 after cap) and CORS allowlist. Commits `727b73a` (security/correctness)
  and `5e38408` (ISSUE-028 hygiene: `.DS_Store` untracked, `react-chartjs-2` and
  unused `import math` removed, repo URLs repointed). ISSUE-023 investigated and
  downgraded to **Verified — no change** (stats match the data; "2005–2026"
  covers 99.7% of records). Still open for next batches: ISSUE-008 (needs a
  hosted backend URL), 013, 015, 016, 017, 018, 020, 021, 022, 024, 025, 026,
  027, and the residual parts of 028.
- **2026-07-13 (fix batch 2 — architecture cleanup)** — ISSUE-015 (deleted the
  ~380 KB legacy `src/pages/*.html` duplicate app; repointed `server.js` at
  `frontend/dist` with SPA fallback), ISSUE-017 (extracted `lib/usStates.js` as
  the single source for state maps; confirmed `typeMap` single-sourced),
  ISSUE-020 (de-duped to one canonical `ici_data.json`; pipeline writes there).
  Knock-on: ISSUE-018 reduced, ISSUE-028's CDN-SRI residual now moot, and the
  pipeline path fix advances ISSUE-013. Verified: build/lint pass; `server.js`
  serves the built app and SPA routes; DataExplorer state queries and the
  Assistant mount cleanly in a browser (the only console errors are the known
  ISSUE-008 backend 502s). Commit `3937df9`. Remaining: 008 (needs host), 013
  (commit source + requirements), 016, 018 (rest), 020 (perf), 021, 022, 024,
  025, 026, 027, and 028's LICENSE/race items.
- **2026-07-13** — Logged ISSUE-029 (user-reported): opening the Assistant Chats
  sidebar overlays the chat instead of shifting it right, because the ≤900px
  media query forces `main-wrapper` `margin-left: 0` unconditionally.
- **2026-07-13 (fix batch 3 — docs)** — ISSUE-024: rewrote `README.md` and
  `CLAUDE.md` to match the shipped React app, real data shape/counts, and the
  real pipeline; both now point at ISSUES.md + PIPELINEWORKFLOW.md as the entry
  point for the RAG work. Done ahead of starting the retrieval-pipeline effort.
- **2026-07-14 (RAG pipeline Stages 1–2)** — Built the data foundation and
  structured query tools per PIPELINEWORKFLOW.md (both stages now 🟢 there).
  Stage 1 (`pipeline/ingest.py`): typed load of the 13,533-row master, state
  normalization (fixes ISSUE-006 — D.C.→DC, territories/foreign/null flagged not
  dropped), precomputed tier-weighted ICI aggregates (fixes ISSUE-002),
  full-text join (543 bill texts + 1,011 MOAs), and two reports. Stage 2
  (`pipeline/tools.py` + `server.py`): `filter_laws` / `aggregate_laws` /
  `score_ici` / `get_law` over SQLite, wrapped in a FastAPI service with a CORS
  allowlist (no wildcard — respects ISSUE-010) and JSONL query logging.
  Accuracy gates: Stage 1 = 0 hard violations, counts reconcile; Stage 2 = 26/26
  pytest tests green. Discovered and logged ISSUE-030 (malformed subtypes).
  Stopped here for review before Stage 3 (embeddings).
- **2026-07-24 (RAG Stage 7 — hardening; pipeline plan complete)** — Built
  `pipeline/refresh.py` (one command: ingest → incremental content-hashed embed →
  eval → regression gate vs `pipeline/eval_baseline.json`), and a GitHub workflow
  (`.github/workflows/pipeline-ci.yml`) that runs the corpus-free checks
  (`py_compile` of all pipeline modules, data-free taxonomy tests, backend `node
  --check`). Added a Runbook to PIPELINEWORKFLOW.md. Stage 7 → 🟢. All seven RAG
  stages now built (Stage 4 remains 🟡 by choice). Next: production hosting
  (ISSUE-008) so the backend + FastAPI service run off `localhost`.
- **2026-07-24 (RAG Stage 6 — eval harness + retrieval logging)** — Built
  `pipeline/eval.py`: gold set v1 from `audit_sample.csv` (all 531 stratified rows
  mapped to law_ids), recall@k + MRR + per-stratum (state/local/287g) breakdowns,
  and full retrieval-chain JSONL logging to `out/eval/`. Results (bge-small):
  overall recall@50 **0.972**; per stratum local recall@1 0.99, state 0.85,
  **287(g) 0.56** — 287(g)'s terse near-identical descriptions are the weak spot
  (reinforces ISSUE-007: its full MOA text sits unused). Gold set v2 pending the
  C1–C6 human audit (columns still empty; harness auto-activates once filled).
  PIPELINEWORKFLOW.md Stage 6 → 🟢.
- **2026-07-15 (RAG Stage 5 — tool-use wiring; fixes ISSUE-001–005)** — Replaced
  the client-side `getDataContext()` regex retrieval with a server-side Claude
  tool-use loop (`api/pipelineChat.js` + `server.js` `/api/chat`) over the FastAPI
  pipeline: 5 tools (filter/aggregate/score_ici/search/get_law), taxonomy-glossary
  system prompt, added `/search_laws` to the FastAPI server, and updated
  `Assistant.jsx` to send only the conversation. **Gate 20/20** — all numeric
  answers matched Stage-2 SQL (TX 2019=20, 287g 2017=595, ICI CA=+4574, ICI TX
  2017=−110, …) plus a working multi-turn follow-up; verified end-to-end in the
  browser. Marks ISSUE-001/002/003/004/005 🟢 Fixed. Production still needs the
  backend + FastAPI hosted (ISSUE-008); `api/chat.js` serverless variant not yet
  updated. PIPELINEWORKFLOW.md Stage 5 → 🟢.
- **2026-07-15 (RAG Stage 4 — reranker, gate inconclusive 🟡)** — Built
  `pipeline/rerank.py` (cross-encoder `bge-reranker-base` + source tie-break) and
  `pipeline/eval_stage4.py`. The reranker did **not** beat the no-rerank baseline
  on the single-target gold set (recall@8 0.767→0.700). Diagnosed as a
  gold-set/relevance-clustering artifact, not a code defect: the reranker
  correctly surfaces the whole cluster of relevant laws, but the eval labels one
  arbitrary target per query. Also fixed a real bug (candidate text was truncated
  to 300 chars before the cross-encoder). Next: a relevance-set-based gate and/or
  validating rerank on the full-text collection. PIPELINEWORKFLOW.md Stage 4 → 🟡.
- **2026-07-14 (RAG Stage 3 — embeddings)** — Applied the 8 approved subtype
  corrections (derived data only), then built Stage 3: `pipeline/embed.py`
  descriptions ChromaDB collection (13,526 vectors) + `search_laws`. ML stack
  installs on Python 3.14. Gate **recall@50 = 0.967** (≥0.90) on a 30-query gold
  set across all 9 types (`pipeline/eval_stage3.py`), stable across re-runs. Used
  bge-small (bge-base was ~1 hr/embed on CPU — impractical here; override via
  `ICI_EMBED_MODEL` on GPU). `legal_fulltext` collection deferred (same slow CPU
  cost, not part of the gate). PIPELINEWORKFLOW.md Stage 3 → 🟢.
- **2026-07-14 (taxonomy obtained)** — The authoritative "Categories of
  SubFederal Laws" doc was provided, closing the Asset Inventory gap. Added
  `pipeline/reference/Categories_of_SubFederal_Laws.md` (tracked) +
  `pipeline/taxonomy.py` (machine-readable), rewired `ingest.py` to validate
  subtypes authoritatively, and added `pipeline/tests/test_taxonomy.py` (31 tests
  total pass). Result: 13,387 valid pairs, 121 wrong-type codes + 25 off-list
  values flagged (ISSUE-030, now precisely itemized), and 0 score/points
  mismatches — the taxonomy point-weights fully agree with the data.

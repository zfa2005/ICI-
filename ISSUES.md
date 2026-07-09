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

*(IDs below are not deep-links — this file is short enough to scroll or Ctrl+F.)*

---

## Issues in the Pipeline — Our RAG / Retrieval Architecture

### ISSUE-001: AI Assistant retrieval is keyword-guessing, not RAG

**Severity: Critical** — this is the most important issue in the project. It
undermines the core promise of the AI Research Assistant: that it answers
questions using real data instead of guessing.

#### What we actually have today

There is **no RAG, no vector search, no semantic search, no embeddings, no
reranker** anywhere in this codebase. What exists instead:

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
| 3 | Embed `description`/`notes`, add vector index, wire in as a second tool | Phase 1 |
| 4 | Add reranker step over the merged candidate set from Phase 2 + 3 | Phase 2, 3 |
| 5 | Add a small eval set (sample questions + expected records) and log retrieval quality over time, so future changes can be measured, not just vibes-checked | Phase 2+ |

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

---

## Changelog

- **2026-07-09** — File created. Logged the full RAG/retrieval audit
  (ISSUE-001 through ISSUE-006) after reviewing `server.js`,
  `frontend/src/pages/Assistant.jsx`, `scripts/convert_to_json.py`, and
  `data/ici_data.json`.

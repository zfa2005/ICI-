# CLAUDE.md — AI Assistant Guide for the ICI Repository

## Project Overview

**Project:** The Immigrant Climate Index (ICI)

**Purpose:** An academic research platform that measures the regulation-induced
"climate" for immigrants across U.S. jurisdictions (federal, state, county, city)
through a quantitative, tier-weighted scoring system.

**Authors:** Huyen Pham (Texas A&M University School of Law) · Pham Hoang Van
(Baylor University). **Copyright:** 2024.

**Live site:** https://zfa2005.github.io/ICI-/

## What This Repository Is (current state)

A full web application, **not** the static Pandoc document it began as. Three parts:

1. **React single-page app** (`frontend/`) — the deployed site. Landing page,
   team, contact, an interactive **Data Explorer**, and an **AI Research
   Assistant**. Built with Vite; deployed to GitHub Pages.
2. **Node.js backend** (`server.js`, `api/chat.js`) — proxies chat to the
   Anthropic API (key stays server-side), persists chat history in SQLite, and
   can serve the built front-end locally.
3. **Python data pipeline** (`scripts/convert_to_json.py`) — builds the app's
   `ici_data.json` from the research master CSV.

> The old standalone `src/pages/*.html` app (a duplicate of the React screens)
> was deleted. Do not resurrect it. The single front-end is the React app.

## Repository Structure

```
ICI-/
├── frontend/                       # React + Vite SPA (the deployed site)
│   ├── src/
│   │   ├── App.jsx                 # Routes: / /team /contact /chatbot /assistant
│   │   ├── pages/                  # Home, Team, Contact, DataExplorer, Assistant
│   │   ├── components/             # Nav, Footer, Layout, StatCounter, Reveal, …
│   │   ├── lib/usStates.js         # Single source: US state name↔code maps
│   │   └── hooks/ utils/ styles/
│   └── public/
│       ├── data/ici_data.json      # THE canonical law database (~6.2 MB)
│       └── research.html           # Research publication (Pandoc HTML), served at /research.html
├── server.js                       # Backend: /api proxy + SQLite + serves frontend/dist
├── api/chat.js                     # Serverless variant of the chat proxy
├── scripts/convert_to_json.py      # Regenerates ici_data.json from the master CSV
├── data/source/*.xlsx              # Legacy Excel sources (2005–2020), superseded
├── ici_workspace/                  # ~1.9 GB local-only RAG source assets (gitignored)
├── research/index.html             # Source copy of the Pandoc paper
├── db/                             # Runtime SQLite (auto-created, gitignored)
├── ISSUES.md                       # Issue tracker + RAG rebuild plan + Asset Inventory
├── PIPELINEWORKFLOW.md             # Build plan for the Python retrieval pipeline
└── .github/workflows/deploy-pages.yml
```

## Key Technologies

- **Front-end:** React 19, Vite, React Router, Chart.js (imported as
  `chart.js/auto`, used imperatively).
- **Backend:** Node.js built-in `http` (no framework), `better-sqlite3`.
- **AI:** Claude Sonnet (`claude-sonnet-4-6`) for chat; Claude Haiku for chat
  titles. Called only via the server-side proxy.
- **Pipeline:** Python standard library only (`csv`, `json`) — no pandas.

## The Data

`frontend/public/data/ici_data.json` is the **single source of truth**, fetched
client-side. It holds three arrays plus metadata:

- `stateLaws` (3,458), `localLaws` (6,575), `laws287g` (3,491) — **13,524 total**
- `typeMap` — law-type code → label (the app reads types from here; do not
  hardcode a second copy)
- `metadata` — `totalCount`, `yearRange` **[1974, 2026]**, `states`

Per-record fields (omitted when empty): `year`, `state`, `county`, `city`,
`type`, `subtype`, `posNeg` (1 = pro-immigrant/sanctuary, 0 = restrictive),
`tier`, `description`, `sourceUrl`, `source` (manual/automated/both — provenance).

### ICI tier scoring (unchanged methodology)

| Tier | Points | Description |
|------|--------|-------------|
| 4 | ±4 | Affects many aspects of daily life — highest impact |
| 3 | ±3 | Crucial aspects, hard to avoid/substitute |
| 2 | ±2 | Important aspects with alternatives |
| 1 | ±1 | Less significant (e.g., English-only) |

Positive = pro-immigrant, negative = restrictive. Note the 2017 ("Trump 1") and
2025 ("Trump 2") legislative spikes in the data.

## Development Workflow

```bash
# Front-end (site UI, hot reload):
cd frontend && npm install && npm run dev        # http://localhost:5173

# Backend (needed for the AI Assistant):
npm install                                       # root; installs better-sqlite3
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
npm start                                          # http://localhost:3000

# Production build preview:
cd frontend && npm run build                       # emits frontend/dist
npm start                                          # server.js serves dist at :3000

# Lint:
cd frontend && npm run lint                        # oxlint
```

**Deployment:** pushing to `main` triggers `.github/workflows/deploy-pages.yml`,
which builds `frontend/` with `--base=/ICI-/` and deploys `frontend/dist` to
GitHub Pages. The backend is **not** on Pages (Pages is static) — it must be
hosted separately; see ISSUE-008.

**Regenerating data:** `python scripts/convert_to_json.py` reads
`ici_workspace/data/ici_master/ici_master.csv` (override via `ICI_MASTER_CSV`)
and writes `frontend/public/data/ici_data.json`.

## Guidelines for AI Assistants

### DO
- **Read ISSUES.md first.** It is the live tracker of known problems, fixes in
  progress, and the RAG-pipeline plan (ISSUE-001–007 + Asset Inventory). Log new
  issues there; mark fixes with date + commit.
- **Keep the data single-sourced.** `ici_data.json` and its `typeMap` are
  canonical; state maps live in `frontend/src/lib/usStates.js`. Don't reintroduce
  duplicate copies.
- **Escape untrusted text.** User input and law-data fields are rendered via
  `innerHTML` in the chat components — always `esc()` them (see ISSUE-009/011).
- **Verify changes by running the app** (`npm run dev`, and `npm start` for the
  backend), not just by building.
- **Maintain scholarly accuracy.** This is published research under named
  authors; counts, labels, and aggregations must match the data.

### DON'T
- **Don't recreate the deleted `src/pages/*.html` app** or add a second copy of
  any screen.
- **Don't call the Anthropic API from the browser** — always go through the
  server-side proxy so the key stays private.
- **Don't commit large binaries.** The `ici_workspace/` (~1.9 GB) and `db/` are
  gitignored and stay local. `ici_data.json` (~6.2 MB) is the one large tracked
  file.
- **Don't hand the model unranked bulk data** in the RAG work — retrieve a small,
  ranked, relevant subset first (see ISSUE-001's rationale).

## Testing

No automated test suite exists yet (tracked as ISSUE-025). Verify manually by
running the app and exercising the affected flow; a headless browser
(Playwright/chromium) is the practical way to check the chat/explorer UIs.

## The RAG Pipeline Work (next major effort)

The AI Assistant's retrieval is currently keyword matching over a client-side
slice of `ici_data.json` — not semantic search. The plan to replace it with
structured tool-calling + semantic vector search + reranking over the full
`ici_workspace/` corpus (bill texts, 287(g) MOAs, news) is specified in
**ISSUES.md** (ISSUE-001–007 and the "Asset Inventory for the Accurate Pipeline")
and **PIPELINEWORKFLOW.md**. Begin there.

## External Resources

- Texas A&M Law: https://law.tamu.edu/
- Baylor Economics: https://www.baylor.edu/
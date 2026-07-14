# Immigrant Climate Index (ICI) — Research Platform

An academic research tool that quantifies the regulation-induced "climate" for
immigrants across U.S. jurisdictions by cataloguing and scoring sub-federal
immigration legislation at the federal, state, county, and city levels.

**Authors:** Huyen Pham (Texas A&M University School of Law) · Pham Hoang Van (Baylor University)

**Live site:** https://zfa2005.github.io/ICI-/

---

## What This Project Is

The ICI assigns a numerical score to jurisdictions based on the immigration laws
active there. A positive score means a pro-immigrant legislative environment; a
negative score means a restrictive one. Scores are built from a database of
**13,524 laws** (state, local, and 287(g) agreements) catalogued by type,
direction, tier weight, and year of enactment, spanning **1974–2026**.

This repository contains:

- **A React single-page app** (`frontend/`) — the public site: landing page,
  team, contact, an interactive **Data Explorer**, and an **AI Research
  Assistant**. This is what is deployed to GitHub Pages.
- **A Node.js backend** (`server.js`, `api/chat.js`) — proxies chat requests to
  the Anthropic Claude API (keeping the key server-side) and persists chat
  history in SQLite.
- **A Python data pipeline** (`scripts/convert_to_json.py`) — builds the app's
  `ici_data.json` from the research master CSV.
- **The research publication** — a Pandoc-generated HTML paper, served at
  `/research.html`.

> **Note:** the earlier standalone `src/pages/*.html` version of the app has been
> removed — the single front-end is now the React app under `frontend/`.

---

## Repository Structure

```
ICI-/
├── frontend/                       # React + Vite single-page app (the deployed site)
│   ├── src/
│   │   ├── App.jsx                 # Routes: / /team /contact /chatbot /assistant
│   │   ├── main.jsx
│   │   ├── pages/
│   │   │   ├── Home.jsx            # Landing page
│   │   │   ├── Team.jsx
│   │   │   ├── Contact.jsx         # Demo / enquiry form
│   │   │   ├── DataExplorer.jsx    # Keyword query engine + Chart.js (offline-capable)
│   │   │   └── Assistant.jsx       # AI Research Assistant (needs the backend)
│   │   ├── components/             # Nav, Footer, Layout, StatCounter, …
│   │   ├── lib/usStates.js         # Single source for US state name↔code maps
│   │   └── hooks/  utils/  styles/
│   ├── public/
│   │   ├── data/ici_data.json      # THE canonical law database (~6.2 MB) — served client-side
│   │   └── research.html           # Research publication (Pandoc HTML)
│   └── vite.config.js              # Dev server proxies /api → localhost:3000
│
├── server.js                       # Node backend: /api proxy + SQLite + serves frontend/dist
├── api/chat.js                     # Serverless variant of the chat proxy (Vercel/Netlify)
├── scripts/convert_to_json.py      # Regenerates frontend/public/data/ici_data.json from the master CSV
│
├── data/source/                    # Legacy Excel sources (2005–2020) — superseded by the master CSV
├── ici_workspace/                  # ~1.9 GB local-only research workspace (gitignored) — RAG source assets
├── research/index.html             # Source copy of the Pandoc paper
├── db/                             # Runtime SQLite (auto-created, gitignored)
│
├── ISSUES.md                       # Issue & improvement tracker (incl. the RAG rebuild plan)
├── PIPELINEWORKFLOW.md             # Build plan for the Python retrieval pipeline
├── CLAUDE.md                       # Guide for AI coding assistants
└── .github/workflows/deploy-pages.yml
```

---

## Quick Start

### Run the site (front-end only)

```bash
cd frontend
npm install        # first time only
npm run dev        # → http://localhost:5173
```

This gives you the landing page, team, contact, and the Data Explorer with
hot-reload. The Data Explorer works entirely client-side against
`public/data/ici_data.json` — no backend or API key needed.

### Run the full app (with the AI Assistant)

The AI chat needs the backend running too. In a second terminal:

```bash
# repo root
npm install                    # first time only (installs better-sqlite3)
echo "ANTHROPIC_API_KEY=sk-ant-your-key-here" > .env
npm start                      # → backend on http://localhost:3000
```

The Vite dev server proxies `/api` to this backend, so the assistant's chat and
history work. Without a valid `ANTHROPIC_API_KEY` the UI loads but chat replies
return an error.

### Preview the production build

```bash
cd frontend && npm run build   # emits frontend/dist
# repo root:
npm start                      # server.js serves frontend/dist → http://localhost:3000
```

---

## Architecture

```
Browser (React SPA)
  │
  ├── /chatbot  (Data Explorer) ──► public/data/ici_data.json     (direct fetch, no server)
  │
  ├── /assistant (AI Assistant)
  │     ├── GET/POST/PATCH/DELETE /api/chats*  ─► server.js ─► SQLite (db/ici_chats.db)
  │     └── POST /api/chat  ─► server.js ─► Anthropic API (Claude Sonnet)
  │                                    └─► SQLite (persist messages)
  │
  └── Production hosting: GitHub Pages serves the built frontend/dist
      (Actions workflow builds with --base=/ICI-/). The backend is a
      separate host — see ISSUE-008 in ISSUES.md.
```

**Why the API call is server-side:** the Anthropic API needs an `x-api-key`
header. Calling it from the browser would expose the key in DevTools. `server.js`
(and `api/chat.js`) proxy the request, add the key, and forward to Anthropic, so
the key never reaches the client. Both enforce a CORS allowlist
(`ALLOWED_ORIGINS`) and a per-IP rate limit on `/api/chat`.

---

## The ICI Data Format

`frontend/public/data/ici_data.json` is the single source of truth, loaded
client-side. Shape:

```json
{
  "stateLaws":  [ /* 3,458 records */ ],
  "localLaws":  [ /* 6,575 records */ ],
  "laws287g":   [ /* 3,491 records */ ],
  "typeMap":    { "P": "Police/Enforcement", "B": "Benefits", ... },
  "metadata":   { "totalCount": 13524, "yearRange": [1974, 2026], "states": ["AL", ...] }
}
```

Each law record (fields absent when empty):

```json
{
  "year": 2017, "state": "CA", "county": "", "city": "San Francisco",
  "type": "P", "subtype": "60", "posNeg": 1, "tier": "3",
  "description": "…", "sourceUrl": "…", "source": "manual"
}
```

| Field | Values | Meaning |
|---|---|---|
| `posNeg` | `1` / `0` | Pro-immigrant (sanctuary) / restrictive |
| `tier` | `1–4` | Impact weight (signed by `posNeg`) |
| `type` | `P B D E L H T V W` | Law category |
| `source` | `manual` / `automated` / `both` | Provenance / confidence |

### Scoring methodology (ICI tiers)

| Tier | Points | Description |
|---|---|---|
| 4 | ±4 | Laws affecting many aspects of daily life — highest impact |
| 3 | ±3 | Crucial aspects, difficult to avoid or substitute |
| 2 | ±2 | Important aspects for which alternatives exist |
| 1 | ±1 | Less significant impacts (e.g., English-only declarations) |

Positive values = pro-immigrant, negative = restrictive. Tier scores aggregate
per jurisdiction to produce the final ICI score.

---

## Regenerating the Data

`ici_data.json` is built from the research master CSV (`ici_master.csv`) by a
stdlib-only Python script:

```bash
python scripts/convert_to_json.py
```

- **Input:** `ici_workspace/data/ici_master/ici_master.csv` by default (the
  workspace is a ~1.9 GB local-only asset, gitignored — see the Asset Inventory
  in [ISSUES.md](ISSUES.md)). Override with the `ICI_MASTER_CSV` env var.
- **Output:** `frontend/public/data/ici_data.json` (the one canonical copy Vite
  serves and bundles into `dist`).

No third-party Python packages are required (the script uses only `csv` / `json`
from the standard library).

---

## The AI Research Assistant & the RAG Roadmap

The Assistant currently pre-aggregates a relevant slice of `ici_data.json` client-side
(counts by year/state/type, plus a small sample) and sends it in the system
prompt so Claude answers from real numbers. This retrieval is **keyword-based**,
not semantic — its limitations and the planned rebuild (structured tool-calling
+ semantic vector search + reranking over the full workspace corpus) are
documented in **[ISSUES.md](ISSUES.md)** (ISSUE-001 through ISSUE-007, plus the
Asset Inventory) and **[PIPELINEWORKFLOW.md](PIPELINEWORKFLOW.md)**. Start there
for the retrieval work.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Front-end | React 19 + Vite, React Router, Chart.js |
| Backend | Node.js `http` module + `better-sqlite3` |
| AI model | Claude Sonnet (`claude-sonnet-4-6`); titles via Claude Haiku |
| Data pipeline | Python standard library (`csv`, `json`) |
| Research paper | Pandoc → HTML |
| Hosting | GitHub Pages (front-end); backend hosted separately |

---

## Project Status

This platform is under active hardening. Known issues, fixes in progress, and the
retrieval-pipeline plan are tracked in **[ISSUES.md](ISSUES.md)** — consult it
before starting new work.

---

## Citation

> Pham, Huyen & Pham Hoang Van. *The Immigrant Climate Index.* Texas A&M
> University School of Law & Baylor University (2024).

- Prof. Huyen Pham — Texas A&M University School of Law — https://law.tamu.edu/
- Prof. Pham Hoang Van — Baylor University Department of Economics — https://www.baylor.edu/
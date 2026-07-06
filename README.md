# Immigrant Climate Index (ICI) — Research Platform

An academic research tool that quantifies the "climate" for immigrants across U.S. jurisdictions by cataloguing and scoring sub-federal immigration legislation from 2005 to 2020.

**Authors:** Huyen Pham (Texas A&M University School of Law) · Pham Hoang Van (Baylor University)

---

## What This Project Is

The ICI assigns a numerical score to every state, county, and city in the United States based on the immigration laws active in that jurisdiction. A positive score means the local legislative environment is pro-immigrant; a negative score means it is restrictive. The scores are built from a database of **13,524 laws** catalogued by type, direction, tier weight, and year of enactment.

This repository contains:
- The full research publication (static HTML)
- An interactive data explorer with filters, charts, and CSV export
- An AI research assistant powered by Claude that can answer natural-language questions about the database
- A Node.js backend that proxies API calls and persists chat history

---

## Quick Start

### Option A — Research paper (no setup)

Open `home.html` or `index.html` directly in a browser. No server or API key required.

### Option B — Full AI Assistant

The AI chat feature requires an API key and a running server.

**1. Install the one server-side dependency:**
```bash
npm install
```

**2. Create a `.env` file in the project root:**
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

**3. Start the server:**
```bash
npm start
```

**4. Open your browser:**
```
http://localhost:3000
```

---

## File Structure

```
Immigrant-Climate/
│
├── src/
│   └── pages/                          # Frontend — all HTML pages
│       ├── home.html                   # Landing page (entry point)
│       ├── team.html                   # Research team profiles
│       ├── contact.html                # Contact / request-a-demo form
│       ├── chatbot-ai.html             # AI Research Assistant (requires server)
│       └── chatbot.html               # Data Explorer (offline-capable)
│
├── data/
│   ├── ici_data.json                   # Processed JSON export of both databases (~1.7 MB)
│   │                                   # Loaded client-side; regenerate if Excel data changes
│   └── source/                         # Raw source files — do not modify directly
│       ├── ACTIVE State_Legislation_Database.xlsx   # State-level laws 2005–2026
│       └── ACTIVE_Local_Legislation_Database.xlsx   # City/county laws
│
├── research/
│   └── index.html                      # Full research publication (Pandoc-generated, ~1.7 MB)
│
├── scripts/
│   └── convert_to_json.py              # Regenerates ici_data.json from Excel source files
│
├── api/
│   └── chat.js                         # Serverless function handler (Vercel / Netlify)
│
├── db/                                 # Runtime database — auto-created, gitignored
│   └── ici_chats.db                    # SQLite: chat sessions + message history
│
├── server.js                           # Node.js development server:
│                                       #   - Proxies requests to the Anthropic Claude API
│                                       #   - Persists chat history in db/ici_chats.db
│                                       #   - Serves src/pages/, data/, and research/
│
├── .env                                # Local secrets — NOT committed (gitignored)
├── package.json                        # npm manifest — one dependency: better-sqlite3
├── .gitignore
├── README.md
└── CLAUDE.md                           # Guidelines for AI coding assistants
```

---

## Architecture

```
Browser
  │
  ├── src/pages/chatbot.html    ──► data/ici_data.json   (direct fetch, no server)
  │
  ├── src/pages/chatbot-ai.html
  │     │
  │     ├── GET  /api/chats        ────────────────────► SQLite (db/ici_chats.db)
  │     ├── POST /api/chats
  │     ├── GET  /api/chats/:id
  │     ├── PATCH/DELETE /api/chats/:id
  │     │
  │     └── POST /api/chat  ──► server.js ──► Anthropic API (Claude Sonnet)
  │                                    └──► SQLite (persist messages)
  │
  └── Static assets served by server.js from:
        ├── src/pages/    (HTML pages)
        ├── data/         (ici_data.json)
        └── research/     (index.html)
```

### Why is the API call server-side?

The Anthropic API requires an `x-api-key` header. If `chatbot-ai.html` called the API directly from the browser, the key would be visible to anyone opening DevTools. The server acts as a thin proxy: it receives the conversation from the browser, appends the key, forwards to Anthropic, and returns the response. The key never reaches the client.

---

## The Two Interfaces

### `chatbot.html` — Data Explorer

A keyword-matching query engine built entirely in client-side JavaScript. It parses the user's natural-language input using regular expressions and keyword detection to route to one of several pre-defined data views:

| Query pattern detected | What it shows |
|---|---|
| State name or 2-letter code | All laws for that state, grouped by year |
| Year + keyword ("laws in 2017") | All laws for that year, grouped by state |
| "trump", "spike", "2017 effect" | Pre/post 2017 comparison |
| "compare X and Y" | Side-by-side line chart for two states |
| "by type", "breakdown" | Stacked bar chart across all law categories |
| "trend", "over time" | Multi-series line chart: state vs local, pos vs neg |
| "sanctuary", "friendly" | Positive laws only |
| "policing", "enforcement", "287" | Policing category only |
| Anything else | Full database summary |

This interface works without an API key or a running server. All filtering and charting runs in the browser against the local `ici_data.json` file.

### `chatbot-ai.html` — AI Research Assistant

A full conversational interface backed by Claude. Before every API call, the client pre-aggregates the relevant slice of the database (counts by year, by state, by type; sample rows; comparison data) and sends it as a JSON payload inside the system prompt. This means Claude always answers from the actual database numbers rather than from training-data approximations.

Multi-turn conversation is maintained client-side as an array of `{ role, content }` objects that grows with each exchange. The server persists this to SQLite so conversations are recoverable across browser sessions.

---

## API Endpoints

All endpoints are served by `server.js` on port 3000.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/chats` | List all chat sessions, newest first, with last-message preview |
| `POST` | `/api/chats` | Create a new chat session; returns `{ id, name }` |
| `GET` | `/api/chats/:id` | Fetch a chat and its full message history |
| `PATCH` | `/api/chats/:id` | Rename a chat `{ name: "New name" }` |
| `DELETE` | `/api/chats/:id` | Delete a chat and all its messages |
| `POST` | `/api/chat` | Proxy a conversation turn to Claude; persist to SQLite |
| `GET` | `/*` | Serve static files from the project root |

### `POST /api/chat` — request body

```json
{
  "messages": [
    { "role": "system",    "content": "You are an expert on the ICI database. [data context]" },
    { "role": "user",      "content": "What happened to legislation in 2017?" },
    { "role": "assistant", "content": "In 2017, 1,418 laws were recorded..." },
    { "role": "user",      "content": "Which states drove the spike?" }
  ],
  "chatId": "uuid-of-current-chat",
  "newUserContent": "Which states drove the spike?"
}
```

`newUserContent` is the raw text the user typed. It differs from the last `messages` entry because the client injects a large data-context payload into the last user message before sending. `newUserContent` is what actually gets stored in SQLite.

---

## The ICI Data Format

`ici_data.json` has three top-level arrays:

```json
{
  "stateLaws":  [ /* 1,910 records */ ],
  "localLaws":  [ /* 2,618 records */ ],
  "laws287g":   [ /* 3,491 records */ ],
  "typeMap":    { "B": "Benefits", "P": "Policing", ... },
  "metadata":   { "yearRange": [2005, 2020], "states": ["AL", "AK", ...] }
}
```

Each law record:

```json
{
  "year":        2017,
  "state":       "CA",
  "county":      "",
  "city":        "San Francisco",
  "type":        "P",
  "posNeg":      1,
  "tier":        3,
  "description": "Ordinance prohibiting city resources from being used to enforce federal immigration law."
}
```

| Field | Values | Meaning |
|---|---|---|
| `posNeg` | `1` | Pro-immigrant / sanctuary law |
| `posNeg` | `0` | Restrictive / enforcement law |
| `tier` | `1–4` | Impact weight (see Scoring below) |
| `type` | `B P E D H L T V W` | Law category (Benefits, Policing, Employment, etc.) |

### Scoring Methodology (ICI Tiers)

| Tier | Points | Description |
|---|---|---|
| 4 | ±4 | Laws affecting many aspects of daily life — highest impact |
| 3 | ±3 | Crucial aspects that are difficult to avoid or substitute |
| 2 | ±2 | Important aspects for which alternatives exist |
| 1 | ±1 | Less significant impacts (e.g., English-only declarations) |

Positive values = pro-immigrant. Negative values = restrictive. Tier scores are aggregated at the jurisdiction level to produce the final ICI score.

---

## Updating the Data

If the source Excel files change, regenerate `ici_data.json`:

```python
import pandas as pd, json

state_df = pd.read_excel('ACTIVE State_Legislation_Database.xlsx')
local_df = pd.read_excel('ACTIVE_Local_Legislation_Database.xlsx')

# Local sheet stores the actual year in the second column (Unnamed: 1)
local_df = local_df.rename(columns={'Unnamed: 1': 'ActualYear'})

# ... normalise column names, map posNeg, tier, etc. ...

with open('ici_data.json', 'w') as f:
    json.dump({ "stateLaws": state_records, "localLaws": local_records, ... }, f)
```

---

## Technology Stack

| Layer | Technology | Why |
|---|---|---|
| Research publication | Pandoc → HTML | Reproducible academic document from Markdown source |
| Data explorer frontend | Vanilla JS + Chart.js | No build step; runs directly in any browser |
| AI assistant frontend | Vanilla JS + marked (inline) | Same — keeps deployment as simple as opening a file |
| Backend server | Node.js `http` module | Zero framework overhead; 6 routes don't need Express |
| Chat persistence | SQLite via `better-sqlite3` | File-based, zero configuration, survives restarts |
| AI model | Claude Sonnet (claude-sonnet-4-6) | Best balance of reasoning quality and response speed |
| Title generation | Claude Haiku | Lightweight task; faster and cheaper than Sonnet |
| Fonts | Inter (UI) + JetBrains Mono (code) | Inter is highly legible at small sizes; JM for tabular data |

---

## Citation

> Pham, Huyen & Pham Hoang Van. *The Immigrant Climate Index.* Texas A&M University School of Law & Baylor University (2024).

- Prof. Huyen Pham — Texas A&M University School of Law
- Prof. Pham Hoang Van — Baylor University Department of Economics

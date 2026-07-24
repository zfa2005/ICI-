# Deploying the ICI app

Everything runs as **one Node service** — the server serves the built React
front-end and the API (chat + retrieval) from a single process. There is no
separate Python service at runtime.

## Architecture (what's hosted)

```
Browser ─▶ Node server.js  (one process, one host)
             ├── serves the built React app (frontend/dist)
             ├── /api/chats*        chat history  (SQLite: db/ici_chats.db)
             └── /api/chat          Claude tool-use loop
                    └── in-process tools (api/pipelineChat.js):
                        ├── structured  → better-sqlite3 over server/data/ici.sqlite
                        └── semantic    → bge-small in Node (transformers.js) over
                                          server/data/desc_vecs.f32 (in memory)
```

The Python pipeline (`pipeline/`) is **offline only** now — it regenerates the
committed data in `server/data/` when the master CSV changes (see below). It is
not needed to run or host the app.

## What ships in the repo (committed, ~30 MB)

- `server/data/ici.sqlite` — laws + ICI aggregates (structured tools read this)
- `server/data/desc_vecs.f32` + `desc_ids.i32` — bge-small doc vectors for search

## Host it (Render — one click)

1. Push the repo (with `render.yaml`).
2. Render → **New + → Blueprint** → select this repo. It reads `render.yaml`
   and creates one web service that builds the front-end and runs `node server.js`.
3. In the service's **Environment**, set `ANTHROPIC_API_KEY` (secret).
4. Deploy. The app is served at the Render URL — front-end and API same-origin,
   so no extra config. (First semantic-search query downloads the ~130 MB model
   once, then it's cached for the instance.)

**Plan/RAM:** use **Standard (~2 GB)** — the embedding model + vectors sit in
memory. The 512 MB starter is too tight.

**Notes:**
- Chat history (`db/ici_chats.db`) is on the instance's disk; add a Render
  persistent disk if you want it to survive redeploys.
- Railway/Fly work the same way (one Node service, `node server.js`); only the
  dashboard differs. Vercel is a poor fit — its serverless functions can't hold
  the model in memory or run the native modules.
- If you host the front-end separately (e.g. GitHub Pages) and only the backend
  on Render, build the front-end with `VITE_API_BASE=https://<backend-url>` and
  add that Pages origin to `ALLOWED_ORIGINS` on the backend.

## Regenerating the data (only when the master CSV changes)

Locally, with the Python pipeline env and the workspace present:

```
python pipeline/refresh.py        # rebuild ici.sqlite (+ eval/regression gate)
cp pipeline/out/ici.sqlite server/data/ici.sqlite
node server/build-vectors.js      # rebuild server/data/desc_vecs.f32 (~15 min, one-time)
git add server/data && git commit -m "refresh ICI data"
```

Then redeploy (Render auto-deploys on push).

## Run locally

```
npm install                        # root (better-sqlite3, transformers.js)
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
cd frontend && npm install && npm run build && cd ..
node server.js                     # http://localhost:3000  (serves app + API)
```

Or for front-end hot-reload during development: `cd frontend && npm run dev`
(Vite on :5173, proxying `/api` to `node server.js` on :3000).
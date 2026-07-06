# ICI Frontend

React (Vite) single-page app for the Immigrant Climate Index platform — replaces the
static pages formerly in `src/pages/*.html`.

## Structure

- `src/pages/Home.jsx`, `Team.jsx`, `Contact.jsx` — marketing pages, wrapped in the
  shared `Layout` (`src/components/Nav.jsx` + `Footer.jsx`).
- `src/pages/DataExplorer.jsx` (route `/chatbot`) and `Assistant.jsx` (route
  `/assistant`) — standalone app pages with their own headers, ported near-verbatim
  from the original vanilla-JS tools (keyword query engine + Chart.js, and the
  Claude-backed chat assistant, respectively). Each wraps its legacy imperative
  script in a single `useEffect` keyed off a root ref rather than being rewritten
  into React state.
- `public/data/ici_data.json` — the law database, fetched client-side.
- `public/research.html` — the Pandoc-generated research paper, served as a static
  file (not a React route).

## Local dev

```bash
npm install
npm run dev
```

`Assistant.jsx` calls `/api/chat` and `/api/chats/*`, which need `server.js` (see the
repo root) running separately for those endpoints to respond — everything else works
without a backend.

## Deploying

The GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) builds this with
`vite build --base=/<repo-name>/` and publishes `dist/` to GitHub Pages. When served
from `github.io`, `Assistant.jsx`'s API calls point at a separately-hosted backend
(see `API_BASE` in `Assistant.jsx`) instead of same-origin, since Pages can't run
`server.js`.

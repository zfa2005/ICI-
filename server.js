'use strict';

/**
 * ICI Research Platform — Backend Server
 * ========================================
 * A minimal Node.js HTTP server with three responsibilities:
 *
 *  1. PROXY — Forwards chat requests to the Anthropic Claude API.
 *             The API key never leaves the server, so it cannot be
 *             extracted from browser dev-tools or network traffic.
 *
 *  2. PERSISTENCE — Stores chat sessions and messages in a local SQLite
 *             database (ici_chats.db). This lets conversations survive
 *             page refreshes and accumulate across sessions without
 *             needing a cloud database or user accounts.
 *
 *  3. STATIC FILES — Serves HTML, JSON, and other assets from the
 *             project root, so a single `npm start` runs the whole app.
 *
 * Why no Express / Fastify?
 *   The request surface is small (6 routes + static files) and adding a
 *   framework would introduce dozens of transitive dependencies. Node's
 *   built-in `http` module handles everything we need cleanly.
 *
 * Dependencies: only `better-sqlite3` (a synchronous SQLite driver).
 * Everything else (http, fs, path, crypto) ships with Node.
 */

const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const Database = require('better-sqlite3');
const pipelineChat = require('./api/pipelineChat');  // Stage 5 tool-use loop


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Environment variables
//
// We parse a .env file by hand instead of using the `dotenv` package to keep
// the dependency count at one (better-sqlite3). The parser handles:
//   KEY=value          → { KEY: "value" }
//   KEY="value"        → { KEY: "value" }   (strips surrounding quotes)
//   # comment lines    → ignored
//   blank lines        → ignored
//
// If the .env file is missing (e.g., CI or Docker) we fall through silently;
// ANTHROPIC_API_KEY must then be set in the shell environment instead.
// ─────────────────────────────────────────────────────────────────────────────
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
    .split('\n')
    .forEach(line => {
      const eq = line.indexOf('=');
      if (eq > 0 && !line.trimStart().startsWith('#')) {
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (key) process.env[key] = val;
      }
    });
} catch {
  console.warn('No .env file found — set ANTHROPIC_API_KEY manually.');
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — SQLite database setup
//
// SQLite is a file-based database — no server process, no configuration,
// no network. It lives in db/ici_chats.db (auto-created, gitignored).
//
// WAL (Write-Ahead Logging) mode:
//   By default SQLite locks the whole file on every write. WAL allows
//   concurrent reads while a write is in progress, which matters when the
//   Node event loop serves multiple requests without awaiting each other.
//
// Schema design:
//   chats      — one row per conversation (id, display name, timestamps)
//   messages   — one row per message (linked to a chat via chat_id)
//
//   The foreign key cascade means deleting a chat automatically deletes
//   all its messages — no orphaned rows to clean up manually.
//
//   The index on (chat_id, created_at) speeds up the most common query:
//   "give me all messages for chat X in chronological order."
// ─────────────────────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'db', 'ici_chats.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS chats (
    id         TEXT    PRIMARY KEY,
    name       TEXT    NOT NULL DEFAULT 'New Chat',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    TEXT    NOT NULL,
    role       TEXT    NOT NULL,          -- 'user' | 'assistant'
    content    TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
`);

// Lightweight migrations: CREATE TABLE IF NOT EXISTS won't add columns to a
// database created before these fields existed, so check and ALTER instead.
//   pinned   — pinned chats sort to the top of the sidebar
//   archived — hidden into a collapsible "Archived" section
//   project  — free-text label; chats sharing one are grouped in the sidebar
const chatCols = db.prepare('PRAGMA table_info(chats)').all().map(c => c.name);
if (!chatCols.includes('pinned'))   db.exec('ALTER TABLE chats ADD COLUMN pinned   INTEGER NOT NULL DEFAULT 0');
if (!chatCols.includes('archived')) db.exec('ALTER TABLE chats ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
if (!chatCols.includes('project'))  db.exec('ALTER TABLE chats ADD COLUMN project  TEXT');


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Prepared statements
//
// SQLite prepared statements are compiled once and reused for every call.
// This is faster than re-parsing the SQL each time AND it prevents SQL
// injection because parameters are bound separately from the query text
// (the database driver never concatenates user input into the SQL string).
// ─────────────────────────────────────────────────────────────────────────────
const stmts = {
  // List all chats newest-first, include a preview of the last message
  listChats:  db.prepare(`
    SELECT c.id, c.name, c.updated_at, c.pinned, c.archived, c.project,
           (SELECT content FROM messages WHERE chat_id = c.id
            ORDER BY created_at DESC LIMIT 1) AS preview
    FROM chats c ORDER BY c.pinned DESC, c.updated_at DESC
  `),

  getChat:    db.prepare('SELECT * FROM chats WHERE id = ?'),
  getMsgs:    db.prepare('SELECT id, role, content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC'),
  createChat: db.prepare('INSERT INTO chats (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'),
  renameChat: db.prepare('UPDATE chats SET name = ?, updated_at = ? WHERE id = ?'),

  // Pin/archive/project deliberately do NOT bump updated_at — organising a
  // chat shouldn't change its position in the recency ordering.
  setPinned:   db.prepare('UPDATE chats SET pinned = ? WHERE id = ?'),
  setArchived: db.prepare('UPDATE chats SET archived = ? WHERE id = ?'),
  setProject:  db.prepare('UPDATE chats SET project = ? WHERE id = ?'),

  // Projects have no table of their own — they exist as labels on chats, so
  // renaming/deleting one is a bulk update across its chats.
  renameProject: db.prepare('UPDATE chats SET project = ? WHERE project = ?'),
  clearProject:  db.prepare('UPDATE chats SET project = NULL WHERE project = ?'),
  deleteChat: db.prepare('DELETE FROM chats WHERE id = ?'),
  insertMsg:  db.prepare('INSERT INTO messages (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)'),

  // "Touch" a chat to bump its updated_at so it rises to the top of the list
  touchChat:  db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?'),

  countMsgs:  db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?'),
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — Helpers
// ─────────────────────────────────────────────────────────────────────────────

// MIME type map for static file serving.
// Only types we actually serve are listed; anything else falls back to
// 'text/plain' which the browser will display safely rather than execute.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

// Collects the full request body as a string, then parses it as JSON.
// Returns an empty object if the body is missing or malformed so callers
// never have to guard against a parse error.
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// Serialises `data` to JSON and writes it as the complete HTTP response.
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — Automatic chat title generator
//
// When a chat is first created it's named "New Chat". After the first
// assistant reply we call this function in the background (non-blocking)
// to ask Claude Haiku for a descriptive 3-6 word title.
//
// Why Haiku instead of Sonnet?
//   Generating a short title is a simple task. Haiku is faster and
//   cheaper, and the quality difference vs. Sonnet is imperceptible for
//   3-6 word outputs. We cap max_tokens at 20 — far less than a full
//   conversation reply — so the latency impact is negligible.
//
// The function is fire-and-forget: it is called with .then/.catch but
// its result is never awaited by the main request handler. If it fails,
// the chat simply keeps its "New Chat" name, which is harmless.
// ─────────────────────────────────────────────────────────────────────────────
async function generateChatTitle(apiKey, userMessage) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 20,
      system: 'You generate short chat titles. Reply with ONLY a 3-6 word title — no quotes, no punctuation at the end, no explanation.',
      messages: [{ role: 'user', content: `First message: "${userMessage}"\n\nTitle:` }],
    }),
  });

  const data = await resp.json();
  const raw  = data.content?.[0]?.text?.trim() || '';

  // Some models add decorative quotes despite the instruction — strip them
  return raw.replace(/^["'«»]+|["'«»]+$/g, '').trim().slice(0, 60) || 'New Chat';
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — HTTP server and route handlers
//
// Route table:
//   GET    /api/chats          → list all chats (sidebar)
//   POST   /api/chats          → create a new chat
//   GET    /api/chats/:id      → fetch a chat + its full message history
//   PATCH  /api/chats/:id      → rename a chat
//   DELETE /api/chats/:id      → delete a chat and all its messages
//   POST   /api/chat           → send a message, proxy to Claude, persist reply
//   GET    /*                  → serve static files from the project root
// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────────────────────
// CORS allowlist — only these origins may call the API. Set ALLOWED_ORIGINS in
// .env (comma-separated) for the deployed front-end; localhost dev origins are
// always allowed. A wildcard '*' would let any website drive our paid Claude
// endpoint, so we reflect the request's Origin only when it's on the list. (ISSUE-010)
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  ...(process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean),
]);

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiter — fixed window per client IP, applied to the paid /api/chat
// route. Without this, an attacker can loop the endpoint and run up an
// unbounded Anthropic bill. In-memory is fine for a single-process server;
// a multi-instance deploy would move this to a shared store. (ISSUE-010)
// ─────────────────────────────────────────────────────────────────────────────
const RATE_LIMIT_MAX    = Number(process.env.RATE_LIMIT_MAX)    || 20;   // requests
const RATE_LIMIT_WINDOW = Number(process.env.RATE_LIMIT_WINDOW) || 60000; // per ms
const rateHits = new Map(); // ip -> { count, resetAt }

function rateLimited(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateHits.get(ip);
  if (!entry || now > entry.resetAt) {
    rateHits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

// Opportunistically evict expired buckets so the Map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of rateHits) if (now > e.resetAt) rateHits.delete(ip);
}, RATE_LIMIT_WINDOW).unref();

http.createServer(async (req, res) => {

  // Reflect the request Origin only if it's on the allowlist (see above).
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');

  // Browsers send a preflight OPTIONS request before cross-origin POSTs.
  // We acknowledge it immediately so the real request can proceed.
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url      = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  // Match /api/chats/:id — captures the UUID portion
  const chatIdM = pathname.match(/^\/api\/chats\/([^/]+)$/);


  // ── GET /api/chats ────────────────────────────────────────────────────────
  // Returns all chats sorted by most-recently-updated, each with a preview
  // of the last message (used for the sidebar list).
  if (pathname === '/api/chats' && req.method === 'GET') {
    return json(res, 200, stmts.listChats.all());
  }


  // ── POST /api/chats ───────────────────────────────────────────────────────
  // Creates a new, empty chat and returns its id so the client can start
  // sending messages to it immediately.
  if (pathname === '/api/chats' && req.method === 'POST') {
    const body = await parseBody(req);
    const id   = crypto.randomUUID();      // UUIDs avoid any collision risk
    const now  = Date.now();               // Unix ms — consistent with JS Date
    const name = (body.name || 'New Chat').trim();
    stmts.createChat.run(id, name, now, now);
    return json(res, 201, { id, name, created_at: now, updated_at: now });
  }


  // ── GET /api/chats/:id ────────────────────────────────────────────────────
  // Returns a chat row plus its full message array (used when the user
  // clicks a chat in the sidebar to reload a previous conversation).
  if (chatIdM && req.method === 'GET') {
    const chat = stmts.getChat.get(chatIdM[1]);
    if (!chat) return json(res, 404, { error: 'Not found' });
    return json(res, 200, { ...chat, messages: stmts.getMsgs.all(chatIdM[1]) });
  }


  // ── PATCH /api/chats/:id ──────────────────────────────────────────────────
  // Partial update: any combination of name / pinned / archived / project.
  // Only the fields present in the body are touched.
  if (chatIdM && req.method === 'PATCH') {
    const body = await parseBody(req);
    const id   = chatIdM[1];
    if (body.name     !== undefined) stmts.renameChat.run((body.name || 'Chat').trim(), Date.now(), id);
    if (body.pinned   !== undefined) stmts.setPinned.run(body.pinned ? 1 : 0, id);
    if (body.archived !== undefined) stmts.setArchived.run(body.archived ? 1 : 0, id);
    if (body.project  !== undefined) {
      const project = body.project ? String(body.project).trim() : null;
      stmts.setProject.run(project || null, id);
    }
    return json(res, 200, { ok: true });
  }


  // ── DELETE /api/chats/:id ─────────────────────────────────────────────────
  // Deletes a chat; the ON DELETE CASCADE in the schema removes its messages.
  if (chatIdM && req.method === 'DELETE') {
    stmts.deleteChat.run(chatIdM[1]);
    return json(res, 200, { ok: true });
  }


  // ── PATCH /api/projects/:name — rename a project across all its chats ─────
  // ── DELETE /api/projects/:name — dissolve it (chats are kept, unlabelled) ─
  const projM = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projM && req.method === 'PATCH') {
    const body    = await parseBody(req);
    const newName = (body.name || '').trim();
    if (!newName) return json(res, 400, { error: 'Project name required' });
    stmts.renameProject.run(newName, decodeURIComponent(projM[1]));
    return json(res, 200, { ok: true });
  }
  if (projM && req.method === 'DELETE') {
    stmts.clearProject.run(decodeURIComponent(projM[1]));
    return json(res, 200, { ok: true });
  }


  // ── POST /api/chat ────────────────────────────────────────────────────────
  // The main endpoint. It:
  //   a) Validates that an API key is available
  //   b) Splits the messages array into system prompt + conversation turns
  //   c) Forwards the request to the Anthropic API
  //   d) Persists both the user message and the assistant reply to SQLite
  //   e) Triggers the background auto-titler on the first exchange
  //
  // Why forward to Claude server-side instead of calling the API from JS?
  //   The Anthropic API requires authentication via x-api-key. If we called
  //   it from the browser, that key would be visible to anyone opening
  //   DevTools. Keeping the call server-side means the key is never sent
  //   to the client at all.
  if (pathname === '/api/chat' && req.method === 'POST') {
    // Throttle the paid endpoint before doing any work. (ISSUE-010)
    if (rateLimited(req)) {
      return json(res, 429, { error: 'Too many requests — please slow down and try again shortly.' });
    }

    const body    = await parseBody(req);
    const { messages, chatId, newUserContent } = body;
    const apiKey  = process.env.ANTHROPIC_API_KEY;

    // Validate the request shape before forwarding anything upstream. (ISSUE-010)
    if (!Array.isArray(messages) || messages.length === 0) {
      return json(res, 400, { error: 'messages must be a non-empty array' });
    }

    if (!apiKey || apiKey === 'your-key-here') {
      return json(res, 500, { error: 'ANTHROPIC_API_KEY not set in .env' });
    }

    // Stage 5: the SERVER owns the system prompt (a fixed taxonomy glossary) and
    // runs a Claude tool-use loop over the FastAPI retrieval service, instead of
    // the client injecting a regex-guessed data blob. Any client-sent system
    // message is ignored; we keep only the user/assistant conversation turns.
    const userMessages = messages.filter(m => m.role !== 'system');

    let result;
    try {
      result = await pipelineChat.runToolLoop(apiKey, userMessages);
    } catch (err) {
      console.error('Tool-loop error:', err.message);
      return json(res, 502, { error: err.message });
    }
    const data = { content: [{ type: 'text', text: result.text }], _toolTrace: result.toolTrace };

    // Only persist if the client provided a chatId AND Claude returned text.
    if (chatId && result.text) {
      const now           = Date.now();
      const assistantText = result.text;

      // newUserContent is the raw human text (the messages array no longer
      // carries an injected data payload, but keep the field for compatibility).
      const userText = newUserContent || userMessages[userMessages.length - 1]?.content || '';

      // Insert user message 1ms before assistant to guarantee chronological order
      stmts.insertMsg.run(chatId, 'user',      userText,      now - 1);
      stmts.insertMsg.run(chatId, 'assistant', assistantText, now);
      stmts.touchChat.run(now, chatId);

      // Auto-name: ask Claude Haiku for a title on the very first exchange.
      // We check message count AFTER inserting (so the threshold is 2 = one
      // user + one assistant message = first complete exchange).
      const { n } = stmts.countMsgs.get(chatId);
      if (n <= 2) {
        const chat = stmts.getChat.get(chatId);
        if (chat?.name === 'New Chat') {
          generateChatTitle(apiKey, userText)
            .then(title => { stmts.renameChat.run(title, Date.now(), chatId); })
            .catch(() => {
              // Fallback: truncate the user's first message to 45 chars
              const fallback = userText.length > 45 ? userText.slice(0, 44) + '…' : userText;
              stmts.renameChat.run(fallback, Date.now(), chatId);
            });
        }
      }
    }

    // Return the final answer in the shape the client already expects
    // ({ content: [{ type:'text', text }] }); the tool trace rides along for
    // debugging/observability.
    return json(res, 200, data);
  }


  // ── Static file server (built React app) ──────────────────────────────────
  // The old standalone src/pages/*.html duplicates were deleted (ISSUE-015);
  // the single front-end is now the React app under frontend/. Production is
  // served by GitHub Pages; this static server exists so a local
  // `npm run build` (in frontend/) + `npm start` can preview the real app
  // alongside the API. Everything the browser needs — index.html, hashed
  // assets, data/ici_data.json, research.html — is emitted into frontend/dist.
  //
  // Day-to-day development uses the Vite dev server (`npm run dev` in frontend/),
  // which serves the front-end with HMR and proxies /api to this server.
  //
  // Path-traversal protection: the resolved path must stay inside DIST_ROOT.
  const DIST_ROOT = path.join(__dirname, 'frontend', 'dist');
  const urlPath   = pathname.split('?')[0];

  function resolveStatic(reqPath) {
    const candidate = path.resolve(DIST_ROOT, '.' + reqPath);
    if (!candidate.startsWith(DIST_ROOT + path.sep) && candidate !== DIST_ROOT) return null;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    return null;
  }

  // Client-side routing: an extensionless request (e.g. /team, /assistant) is a
  // React Router path, so fall back to index.html and let the app route it.
  // A miss with an extension is a genuine 404.
  let filePath = resolveStatic(urlPath === '/' ? '/index.html' : urlPath);
  if (!filePath && !path.extname(urlPath)) filePath = resolveStatic('/index.html');
  if (!filePath) {
    res.writeHead(404);
    res.end(fs.existsSync(DIST_ROOT)
      ? 'Not found'
      : 'Front-end not built — run `npm run build` in frontend/, then restart.');
    return;
  }

  fs.readFile(filePath, (err, fileData) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(fileData);
  });

}).listen(PORT, () => {
  console.log(`\nICI API server → http://localhost:${PORT}`);
  console.log(`  API routes    → /api/chat, /api/chats/*`);
  console.log(`  Static        → serves frontend/dist if built (\`npm run build\` in frontend/)`);
  console.log(`  Dev front-end → \`npm run dev\` in frontend/ (proxies /api here)\n`);
});

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
    SELECT c.id, c.name, c.updated_at,
           (SELECT content FROM messages WHERE chat_id = c.id
            ORDER BY created_at DESC LIMIT 1) AS preview
    FROM chats c ORDER BY c.updated_at DESC
  `),

  getChat:    db.prepare('SELECT * FROM chats WHERE id = ?'),
  getMsgs:    db.prepare('SELECT id, role, content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC'),
  createChat: db.prepare('INSERT INTO chats (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'),
  renameChat: db.prepare('UPDATE chats SET name = ?, updated_at = ? WHERE id = ?'),
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

http.createServer(async (req, res) => {

  // Allow the browser's fetch() to reach this server from any origin.
  // In production you would restrict this to your actual domain.
  res.setHeader('Access-Control-Allow-Origin', '*');
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
  // Renames a chat (user double-clicks the title in the sidebar).
  if (chatIdM && req.method === 'PATCH') {
    const body = await parseBody(req);
    stmts.renameChat.run((body.name || 'Chat').trim(), Date.now(), chatIdM[1]);
    return json(res, 200, { ok: true });
  }


  // ── DELETE /api/chats/:id ─────────────────────────────────────────────────
  // Deletes a chat; the ON DELETE CASCADE in the schema removes its messages.
  if (chatIdM && req.method === 'DELETE') {
    stmts.deleteChat.run(chatIdM[1]);
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
    const body    = await parseBody(req);
    const { messages, chatId, newUserContent } = body;
    const apiKey  = process.env.ANTHROPIC_API_KEY;

    if (!apiKey || apiKey === 'your-key-here') {
      return json(res, 500, { error: 'ANTHROPIC_API_KEY not set in .env' });
    }

    // The Claude API expects the system prompt as a top-level field, not
    // inside the messages array. We split them here so the client can
    // include everything in one array (simpler client-side state).
    const system       = messages.find(m => m.role === 'system')?.content || '';
    const userMessages = messages.filter(m => m.role !== 'system');

    let upstream, data;
    try {
      upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: 1024,
          system,
          messages:   userMessages,
        }),
      });
      data = await upstream.json();
    } catch (err) {
      console.error('Upstream error:', err.message);
      return json(res, 500, { error: err.message });
    }

    // Only persist if the client provided a chatId AND Claude returned text.
    // If either is missing we still return the response — we just don't save it.
    if (chatId && data.content?.[0]?.text) {
      const now           = Date.now();
      const assistantText = data.content[0].text;

      // Use newUserContent (the raw user text) rather than the last message
      // in the array, because that array may contain the data-context payload
      // injected by the client — we only want to store what the human typed.
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

    // Pass Claude's response straight back to the client unchanged.
    // We preserve the original HTTP status so the client can detect
    // upstream errors (e.g., 429 rate limit) without parsing the body.
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }


  // ── Static file server ────────────────────────────────────────────────────
  // Files are no longer all in the project root — they live in subdirectories
  // organised by concern (src/pages, data, research). The server searches each
  // directory in priority order until it finds the requested file.
  //
  // Search order:
  //   1. src/pages/   — HTML pages (home, team, contact, chatbot-ai, chatbot)
  //   2. data/        — JSON data files (ici_data.json)
  //   3. research/    — Research publication (index.html)
  //
  // Path traversal protection:
  //   Each candidate path is checked against its own root (not just __dirname),
  //   so a request for /../../etc/passwd cannot escape any of the three roots.
  const STATIC_ROOTS = [
    path.join(__dirname, 'src', 'pages'),
    path.join(__dirname, 'data'),
    path.join(__dirname, 'research'),
  ];

  const urlPath = (pathname === '/' ? '/home.html' : pathname).split('?')[0];

  // Walk each root in order; return the first file that exists and passes the
  // traversal check. Returns null if nothing matches.
  function resolveStatic(reqPath) {
    for (const root of STATIC_ROOTS) {
      const candidate = path.resolve(root, '.' + reqPath);
      if (!candidate.startsWith(root + path.sep) && candidate !== root) continue;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  const filePath = resolveStatic(urlPath);
  if (!filePath) { res.writeHead(404); res.end('Not found'); return; }

  fs.readFile(filePath, (err, fileData) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(fileData);
  });

}).listen(PORT, () => {
  console.log(`\nICI server → http://localhost:${PORT}`);
  console.log(`  Home         → http://localhost:${PORT}/`);
  console.log(`  AI Assistant → http://localhost:${PORT}/chatbot-ai.html`);
  console.log(`  Research     → http://localhost:${PORT}/index.html\n`);
});

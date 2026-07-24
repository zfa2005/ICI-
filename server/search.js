'use strict';

/**
 * Semantic search in Node (Path 2 — replaces the Chroma/FastAPI search).
 * Loads the pre-built bge-small doc vectors (server/data/desc_vecs.f32) into
 * memory once, embeds the query in-process (embed.js, same ONNX model), and does
 * brute-force cosine — trivially fast over ~13.5k×384 (no vector-DB extension
 * needed). Optional state/type/year filters pre-restrict the candidate set via
 * the SQLite metadata.
 */

const fs = require('fs');
const path = require('path');
const { embedQuery } = require('./embed');
const dbmod = require('./db');

const DATA = path.join(__dirname, 'data');
const DIM = 384;
let IDS = null, VECS = null, N = 0;

function load() {
  if (IDS) return;
  const ib = fs.readFileSync(path.join(DATA, 'desc_ids.i32'));
  IDS = new Int32Array(ib.buffer, ib.byteOffset, ib.byteLength / 4);
  const vb = fs.readFileSync(path.join(DATA, 'desc_vecs.f32'));
  VECS = new Float32Array(vb.buffer, vb.byteOffset, vb.byteLength / 4);
  N = IDS.length;
}

async function searchLaws(query, opts = {}) {
  const { state = null, type = null, year_from = null, year_to = null, k = 10 } = opts;
  load();
  const qv = await embedQuery(query);                       // normalized length-384
  const hasFilter = state || type || year_from != null || year_to != null;
  const allowed = hasFilter ? dbmod.matchingLawIds({ state, type, year_from, year_to }) : null;

  // Vectors are normalized, so cosine == dot product.
  const scored = [];
  for (let i = 0; i < N; i++) {
    const id = IDS[i];
    if (allowed && !allowed.has(id)) continue;
    let s = 0; const off = i * DIM;
    for (let j = 0; j < DIM; j++) s += qv[j] * VECS[off + j];
    scored.push([id, s]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const top = scored.slice(0, Math.max(1, Math.min(k, 50)));

  const rows = dbmod.lawsByIds(top.map((t) => t[0]));
  const byId = new Map(rows.map((r) => [r.law_id, r]));
  const results = top.map(([id, score]) => {
    const r = byId.get(id) || { law_id: id };
    return {
      law_id: id, score: Number(score.toFixed(4)),
      state: r.state, year: r.year, type: r.type, subtype: r.subtype,
      source_type: r.source_type, source_url: r.source_url,
      text: (r.description || '').slice(0, 300),
    };
  });
  return { query, n: results.length, results };
}

module.exports = { searchLaws, load };
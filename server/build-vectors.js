'use strict';

/**
 * Offline build step: embed every law description with the in-process ONNX model
 * and write the vectors as flat binary files the backend memory-maps at startup:
 *   server/data/desc_ids.i32   Int32   law_id per row
 *   server/data/desc_vecs.f32  Float32 (N x 384) normalized doc vectors, same order
 *
 * Run once after the pipeline regenerates ici.sqlite:  node server/build-vectors.js
 * (Uses the SAME model as query time — embed.js — so retrieval is consistent.)
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { embedTexts } = require('./embed');

const DATA = path.join(__dirname, 'data');
const DIM = 384;
const BATCH = 32;

(async () => {
  const db = new Database(path.join(DATA, 'ici.sqlite'), { readonly: true });
  const rows = db.prepare(
    "SELECT law_id, TRIM(COALESCE(description,'') || ' ' || COALESCE(provision_description,'')) AS text FROM laws"
  ).all().filter(r => r.text);
  db.close();

  console.log(`embedding ${rows.length} docs with bge-small (ONNX)…`);
  const ids = new Int32Array(rows.length);
  const vecs = new Float32Array(rows.length * DIM);

  const t0 = Date.now();
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const embs = await embedTexts(batch.map(r => r.text));
    for (let j = 0; j < batch.length; j++) {
      ids[i + j] = batch[j].law_id;
      vecs.set(embs[j], (i + j) * DIM);
    }
    if (i % (BATCH * 20) === 0) {
      const rate = (i || 1) / ((Date.now() - t0) / 1000);
      console.log(`  ${i}/${rows.length}  (${rate.toFixed(0)}/s)`);
    }
  }

  fs.writeFileSync(path.join(DATA, 'desc_ids.i32'), Buffer.from(ids.buffer));
  fs.writeFileSync(path.join(DATA, 'desc_vecs.f32'), Buffer.from(vecs.buffer));
  console.log(`done: ${rows.length} vectors (dim ${DIM}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})().catch(e => { console.error(e); process.exit(1); });
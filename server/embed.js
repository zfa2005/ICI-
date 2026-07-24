'use strict';

/**
 * In-process embeddings for the single Node backend (Path 2 — no Python service).
 *
 * Runs BAAI/bge-small-en-v1.5 via transformers.js (ONNX) — the SAME model the
 * offline pipeline used, so query and document vectors are consistent. The model
 * (~130 MB) loads once, lazily, on first use and is cached in-process.
 *
 * bge is asymmetric: only the QUERY gets the retrieval-instruction prefix; the
 * documents do not (see build-vectors.js).
 */

const MODEL = process.env.ICI_EMBED_MODEL_JS || 'Xenova/bge-small-en-v1.5';
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

let _extractorPromise = null;

async function getExtractor() {
  if (!_extractorPromise) {
    const { pipeline } = await import('@huggingface/transformers');
    _extractorPromise = pipeline('feature-extraction', MODEL);
  }
  return _extractorPromise;
}

// Embed an array of texts -> array of normalized Float32 vectors (plain arrays).
async function embedTexts(texts) {
  const ext = await getExtractor();
  const out = await ext(texts, { pooling: 'mean', normalize: true });
  const dim = out.dims[out.dims.length - 1];
  const vecs = [];
  for (let i = 0; i < texts.length; i++) {
    vecs.push(Array.from(out.data.slice(i * dim, (i + 1) * dim)));
  }
  return vecs;
}

async function embedQuery(q) {
  return (await embedTexts([QUERY_PREFIX + q]))[0];
}

module.exports = { getExtractor, embedTexts, embedQuery, MODEL, QUERY_PREFIX };
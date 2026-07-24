'use strict';

/**
 * Structured query tools in Node (Path 2 — replaces pipeline/tools.py at runtime).
 * Deterministic, parameterized queries over the Stage-1 ici.sqlite via
 * better-sqlite3. Same behaviour/results as the Python tools (verified against the
 * same ground truths).
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.ICI_SQLITE || path.join(__dirname, 'data', 'ici.sqlite');
let _db = null;
function db() {
  if (!_db) _db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return _db;
}

function normLocality(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/\bst\.\s*/g, 'saint ');
  s = s.replace(/\s+(county|parish|borough)\s*$/, '');
  return s.replace(/\s+/g, ' ').trim() || null;
}

const ROW_COLUMNS =
  "law_id, source_type, source, state_norm AS state, county_norm AS county, " +
  "city_town AS city, year, type, subtype, score, pos_neg_bool AS pos_neg, " +
  "description, bill_id, source_url";

function buildWhere(f) {
  const where = [], params = [];
  const eq = (col, val, tf = (x) => x) => {
    if (val != null && val !== '') { where.push(`${col} = ?`); params.push(tf(val)); }
  };
  eq('state_norm', f.state, (s) => String(s).trim().toUpperCase());
  eq('county_norm', f.county, normLocality);
  eq('city_norm', f.city, normLocality);
  eq('type', f.type, (s) => String(s).trim().toUpperCase());
  eq('subtype', f.subtype, (s) => String(s).trim());
  eq('source_type', f.source_type, (s) => String(s).trim().toLowerCase());
  eq('source', f.source, (s) => String(s).trim().toLowerCase());
  if (f.pos_neg != null) { where.push('pos_neg_bool = ?'); params.push(Number(f.pos_neg) === 1 ? 1 : 0); }
  if (f.year_from != null) { where.push('year >= ?'); params.push(Number(f.year_from)); }
  if (f.year_to != null) { where.push('year <= ?'); params.push(Number(f.year_to)); }
  if (f.score_min != null) { where.push('score >= ?'); params.push(Number(f.score_min)); }
  if (f.score_max != null) { where.push('score <= ?'); params.push(Number(f.score_max)); }
  return { clause: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
}

function filterLaws(f = {}) {
  const { clause, params } = buildWhere(f);
  const limit = Math.max(0, Math.min(Number(f.limit ?? 50), 500));
  const offset = Math.max(0, Number(f.offset ?? 0));
  const total = db().prepare(`SELECT COUNT(*) c FROM laws${clause}`).get(...params).c;
  const rows = db().prepare(
    `SELECT ${ROW_COLUMNS} FROM laws${clause} ORDER BY year DESC, law_id ASC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  return { total_count: total, returned: rows.length, limit, offset, rows };
}

const GROUP_COLUMNS = {
  state: 'state_norm', county: 'county_norm', year: 'year', type: 'type',
  subtype: 'subtype', source_type: 'source_type', source: 'source',
};

function aggregateLaws(group_by, f = {}) {
  if (typeof group_by === 'string') group_by = [group_by];
  const cols = group_by.map((g) => {
    if (!GROUP_COLUMNS[g]) throw new Error(`invalid group_by '${g}'`);
    return GROUP_COLUMNS[g];
  });
  const { clause, params } = buildWhere(f);
  const sel = cols.map((c, i) => `${c} AS ${group_by[i]}`).join(', ');
  const sql =
    `SELECT ${sel}, COUNT(*) AS n_laws, ` +
    `SUM(CASE WHEN pos_neg_bool=1 THEN 1 ELSE 0 END) AS n_positive, ` +
    `SUM(CASE WHEN pos_neg_bool=0 THEN 1 ELSE 0 END) AS n_negative, ` +
    `COALESCE(SUM(score),0) AS ici_score FROM laws${clause} ` +
    `GROUP BY ${cols.join(', ')} ORDER BY n_laws DESC`;
  const rows = db().prepare(sql).all(...params);
  return { group_by, n_groups: rows.length, groups: rows };
}

function scoreIci({ jurisdiction, county = null, year = null, year_from = null, year_to = null }) {
  const state = String(jurisdiction).trim().toUpperCase();
  if (year != null) { year_from = year_to = Number(year); }
  let table, keys, kp, label;
  if (county) {
    table = 'ici_county_year'; keys = ['state = ?', 'county = ?']; kp = [state, normLocality(county)];
    label = `${county}, ${state}`;
  } else {
    table = 'ici_state_year'; keys = ['state = ?']; kp = [state]; label = state;
  }
  const where = [...keys], params = [...kp];
  if (year_from != null) { where.push('year >= ?'); params.push(Number(year_from)); }
  if (year_to != null) { where.push('year <= ?'); params.push(Number(year_to)); }
  const r = db().prepare(
    `SELECT COALESCE(SUM(n_laws),0) n_laws, COALESCE(SUM(n_positive),0) n_positive, ` +
    `COALESCE(SUM(n_negative),0) n_negative, COALESCE(SUM(ici_score),0) ici_score ` +
    `FROM ${table} WHERE ${where.join(' AND ')}`
  ).get(...params);
  return {
    jurisdiction: label, state, county: county ? normLocality(county) : null,
    year_range: (year_from != null || year_to != null) ? [year_from, year_to] : null,
    ici_score: Number(r.ici_score), n_positive: Number(r.n_positive),
    n_negative: Number(r.n_negative), n_laws: Number(r.n_laws),
  };
}

// Full statutory/MOA text lives in the gitignored, local-only workspace; on a
// plain deploy it isn't present, so this degrades gracefully to null — the row's
// `description` is always available from sqlite. (Bill texts resolve locally when
// the workspace is present; 287(g) MOA text is workspace-only.)
function loadFulltext(kind, ref) {
  try {
    if (kind === 'bill_text' && fs.existsSync(ref)) return fs.readFileSync(ref, 'utf8');
  } catch { /* ignore */ }
  return null;
}

function getLaw(law_id) {
  const row = db().prepare('SELECT * FROM laws WHERE law_id = ?').get(Number(law_id));
  if (!row) return null;
  const ft = db().prepare('SELECT kind, matched_how, ref FROM fulltext_map WHERE law_id = ?').get(Number(law_id));
  row.full_text = null;
  row.full_text_source = null;
  if (ft) {
    const t = loadFulltext(ft.kind, ft.ref);
    if (t) { row.full_text = t; row.full_text_source = ft; }
  }
  return row;
}

// For semantic search: fetch citation fields for a set of law_ids, preserving order.
function lawsByIds(ids) {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const rows = db().prepare(`SELECT ${ROW_COLUMNS} FROM laws WHERE law_id IN (${ph})`).all(...ids);
  const byId = new Map(rows.map((r) => [r.law_id, r]));
  return ids.map((i) => byId.get(i)).filter(Boolean);
}

// Set of law_ids matching a metadata filter (no cap) — used to pre-filter search.
function matchingLawIds(f) {
  const { clause, params } = buildWhere(f);
  return new Set(db().prepare(`SELECT law_id FROM laws${clause}`).all(...params).map((r) => r.law_id));
}

module.exports = {
  db, filterLaws, aggregateLaws, scoreIci, getLaw, lawsByIds, matchingLawIds, normLocality, DB_PATH,
};
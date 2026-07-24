'use strict';

/**
 * Stage 5 — Claude tool-use wiring.
 *
 * Replaces the old client-side getDataContext() regex builder: instead of the
 * browser guessing a filter and pasting a JSON blob into the system prompt, the
 * server gives Claude a set of TOOLS and runs a tool-use loop. Claude decides
 * which tool(s) to call; each call is proxied to the FastAPI retrieval service
 * (Stages 1–4); results come back as tool_result blocks until Claude answers.
 *
 * This fixes, structurally: ISSUE-001 (real retrieval, not keyword guessing),
 * ISSUE-002 (score_ici uses the tier weights), ISSUE-003 (no meaningless
 * fallback), ISSUE-004 (multi-turn memory is just the message history), and
 * ISSUE-005 (every law type reachable via enum tool args).
 *
 * The taxonomy glossary below mirrors pipeline/taxonomy.py (the canonical
 * source) — a small fixed reference, not per-query data.
 */

const PIPELINE_URL = process.env.PIPELINE_URL || 'http://127.0.0.1:8000';
const CHAT_MODEL   = process.env.ICI_CHAT_MODEL || 'claude-sonnet-4-6';

// ── Tool schema (Anthropic tool-use format) ─────────────────────────────────
const FILTERS = {
  state:       { type: 'string', description: '2-letter state code, e.g. "CA", "TX", "DC".' },
  county:      { type: 'string', description: 'County name (e.g. "Cook").' },
  city:        { type: 'string', description: 'City/town name.' },
  year_from:   { type: 'integer', description: 'Earliest enactment year (inclusive).' },
  year_to:     { type: 'integer', description: 'Latest enactment year (inclusive).' },
  type:        { type: 'string', enum: ['P', 'B', 'D', 'E', 'L', 'H', 'W', 'V', 'T'],
                 description: 'Law type code (see the taxonomy in the system prompt).' },
  subtype:     { type: 'string', description: 'Numeric subtype code, e.g. "60" (sanctuary policies).' },
  pos_neg:     { type: 'integer', enum: [0, 1],
                 description: '1 = pro-immigrant/sanctuary, 0 = restrictive.' },
  score_min:   { type: 'integer', description: 'Minimum signed tier score (−4..4).' },
  score_max:   { type: 'integer', description: 'Maximum signed tier score (−4..4).' },
  source_type: { type: 'string', enum: ['state', 'local', '287g'] },
  source:      { type: 'string', enum: ['manual', 'automated', 'both'],
                 description: 'Provenance/confidence: manual is human-verified, both = two pipelines agreed.' },
};

const TOOLS = [
  {
    name: 'filter_laws',
    description: 'Exact structured filter over the law database. Use for "how many / which laws" ' +
      'questions with concrete criteria (state, year range, type, direction, etc.). Always returns ' +
      'total_count (the full match size) plus a capped page of rows — cite total_count for totals.',
    input_schema: {
      type: 'object',
      properties: { ...FILTERS, limit: { type: 'integer', description: 'Max rows to return (default 50).' },
                    offset: { type: 'integer' } },
    },
  },
  {
    name: 'aggregate_laws',
    description: 'Grouped counts and signed-score sums. Use for breakdowns/trends ("by year", "by state", ' +
      '"by type"). group_by is one or more of state, county, year, type, subtype, source_type, source.',
    input_schema: {
      type: 'object',
      properties: { group_by: { type: 'array', items: { type: 'string',
        enum: ['state', 'county', 'year', 'type', 'subtype', 'source_type', 'source'] } }, ...FILTERS },
      required: ['group_by'],
    },
  },
  {
    name: 'score_ici',
    description: 'The actual ICI score for a jurisdiction = signed sum of tier weights, with components ' +
      '(n_positive, n_negative, n_laws). Use for "what is the ICI score / how pro- or anti-immigrant is X".',
    input_schema: {
      type: 'object',
      properties: {
        jurisdiction: { type: 'string', description: '2-letter state code.' },
        county:       { type: 'string' },
        year:         { type: 'integer', description: 'Single year.' },
        year_from:    { type: 'integer' },
        year_to:      { type: 'integer' },
      },
      required: ['jurisdiction'],
    },
  },
  {
    name: 'search_laws',
    description: 'Semantic (meaning-based) search over law descriptions. Use when the question is about a ' +
      'topic/concept that is not a clean structured filter (e.g. "laws punishing landlords who rent to ' +
      'undocumented tenants"). Returns the top-k relevant laws with snippets + citations. Optional ' +
      'state/type/year filters narrow the search.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language search query.' },
        state: FILTERS.state, type: FILTERS.type,
        year_from: FILTERS.year_from, year_to: FILTERS.year_to,
        k: { type: 'integer', description: 'How many results (default 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_law',
    description: 'Fetch one full law record (and its full bill/MOA text when available) by law_id — ' +
      'use to quote or verify a specific law surfaced by another tool.',
    input_schema: { type: 'object', properties: { law_id: { type: 'integer' } }, required: ['law_id'] },
  },
];

// ── System prompt (taxonomy glossary — mirrors pipeline/taxonomy.py) ─────────
const SYSTEM_PROMPT = `You are the research assistant for the Immigrant Climate Index (ICI), an academic project measuring the regulation-induced "climate" for immigrants across U.S. jurisdictions (Huyen Pham, Texas A&M Law; Pham Hoang Van, Baylor).

You answer questions about a database of ~13,500 sub-federal immigration laws (state, local, and 287(g) agreements), 1974–2026. You have TOOLS that query the real database — use them for every factual claim.

HOW THE DATA WORKS
- posNeg: 1 = pro-immigrant / "sanctuary"; 0 = restrictive / anti-immigrant.
- Each law has a signed tier score (±1..±4). The ICI score of a place = the sum of these signed weights (positive = pro-immigrant climate). Use score_ici for that — never just count laws when asked about the ICI score.
- source_type: state | local | 287g (287(g) = local–ICE enforcement agreements).
- source (provenance/confidence): manual (human-verified), automated (pipeline), both (two pipelines agreed). Prefer/mention manual or both when confidence matters.

LAW TYPES (code — points):
P Law Enforcement (4) · D Driver's licenses (3) · E Employment (3) · H Housing (3) · T Transportation (3) · B Benefits (2) · L Language (1) · W Law-related (1) · V Vote-related (1).
Subtypes are numeric codes unique to one type; notable ones: P/1 287(g) agreement, P/37 ICE detainers, P/60 sanctuary policies, B/13→D drivers' licenses, E/16 E-Verify/eligibility, V/32 voting qualifications. Pass a subtype code to a tool only if the user asks for that specific sub-category.

RULES (grounding — this is an academic tool under named authors):
1. Every number, list, or claim MUST come from a tool result. Never estimate, guess, or use prior knowledge for figures.
2. For totals, cite the tool's total_count — do not count the returned page.
3. If the tools return nothing relevant, say so plainly and suggest how to refine — do not invent an answer.
4. Prefer the structured tools (filter_laws/aggregate_laws/score_ici) for exact criteria; use search_laws for topic/concept questions.
5. When you reference specific laws, cite them (state, year, and law_id or source_url from the tool result) so the user can verify.
6. Be concise; use markdown. State which jurisdiction/year/filter your numbers are for.`;

// ── Tool execution (proxy to the FastAPI retrieval service) ─────────────────
async function callTool(name, input) {
  let url = `${PIPELINE_URL}/${name}`;
  let opts = { method: 'POST', headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ ...input, route_reason: `claude:${name}` }) };
  if (name === 'get_law') {
    url = `${PIPELINE_URL}/law/${encodeURIComponent(input.law_id)}?route_reason=claude`;
    opts = { method: 'GET' };
  }
  const resp = await fetch(url, opts);
  const data = await resp.json().catch(() => ({ error: 'non-JSON response from retrieval service' }));
  if (!resp.ok) return { error: data.detail || data.error || `retrieval service ${resp.status}` };
  return data;
}

// ── Tool-use loop ───────────────────────────────────────────────────────────
// Runs Claude with the tools until it produces a final text answer (or a round
// cap is hit). `messages` is the conversation so far ([{role, content}]).
async function runToolLoop(apiKey, messages, { maxRounds = 6, maxTokens = 1024 } = {}) {
  const convo = messages.map(m => ({ role: m.role, content: m.content }));
  const toolTrace = [];

  for (let round = 0; round < maxRounds; round++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: CHAT_MODEL, max_tokens: maxTokens, system: SYSTEM_PROMPT, tools: TOOLS, messages: convo }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = data?.error?.message || `Anthropic ${resp.status}`;
      throw new Error(msg);
    }

    if (data.stop_reason === 'tool_use') {
      convo.push({ role: 'assistant', content: data.content });
      const toolResults = [];
      for (const block of data.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        try { result = await callTool(block.name, block.input); }
        catch (e) { result = { error: String(e.message || e) }; }
        toolTrace.push({ name: block.name, input: block.input,
                         result_count: result?.total_count ?? result?.n ?? result?.n_laws ?? null });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }
      convo.push({ role: 'user', content: toolResults });
      continue;
    }

    // Final answer
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    return { text, toolTrace, rounds: round + 1, stop_reason: data.stop_reason };
  }
  return { text: 'I wasn’t able to finish looking that up — please try narrowing the question.', toolTrace, rounds: maxRounds, stop_reason: 'max_rounds' };
}

module.exports = { TOOLS, SYSTEM_PROMPT, runToolLoop, callTool, PIPELINE_URL, CHAT_MODEL };
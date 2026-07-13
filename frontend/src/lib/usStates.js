// Single source of truth for US state (plus DC / PR) name↔code data.
//
// Previously this map was hardcoded — with slightly different, incomplete
// contents — inside Assistant.jsx (twice) and DataExplorer.jsx (twice). That
// meant a query like "compare Ohio and Michigan" worked in one screen but not
// the other. Centralising it here fixes that drift and gives both the query
// engine and the contextual-suggestion logic the full 50 states + DC + PR.
// (ISSUE-017)

export const STATE_NAME_TO_CODE = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
    'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
    'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
    'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
    'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
    'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
    'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
    'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
    'puerto rico': 'PR', 'district of columbia': 'DC',
};

// All valid 2-letter codes (derived from the map so the two can't drift apart).
export const VALID_STATE_CODES = [...new Set(Object.values(STATE_NAME_TO_CODE))];

// Resolve a free-text token to a state code: accepts a full name ("california")
// or an already-valid 2-letter code ("ca"); returns null if neither.
export function resolveStateCode(token) {
    if (!token) return null;
    const t = String(token).trim().toLowerCase();
    if (STATE_NAME_TO_CODE[t]) return STATE_NAME_TO_CODE[t];
    const upper = t.toUpperCase();
    return VALID_STATE_CODES.includes(upper) ? upper : null;
}

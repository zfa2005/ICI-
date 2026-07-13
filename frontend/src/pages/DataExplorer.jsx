import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Chart from 'chart.js/auto';
import { withBase } from '../utils/withBase';
import { resolveStateCode } from '../lib/usStates';
import './DataExplorer.css';

// ─────────────────────────────────────────────────────────────────────────────
// ICI DATA EXPLORER — client-side keyword query engine + Chart.js visualiser.
//
// This is ported near-verbatim from the original standalone chatbot.html. It's
// an imperative, DOM/canvas-driven tool (keyword routing, chart rendering,
// table painting) rather than naturally state-driven UI, so it's wrapped in a
// single effect operating on refs/ids instead of being rewritten into React
// state — that would be a much larger rewrite for no behavioural benefit.
// ─────────────────────────────────────────────────────────────────────────────
export default function DataExplorer() {
    const rootRef = useRef(null);

    useEffect(() => {
        const root = rootRef.current;
        const $ = (id) => root.querySelector(`#${id}`);

        Chart.defaults.color = '#A1A1AA';
        Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
        Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";

        // Escape HTML metacharacters before interpolating untrusted text (user
        // queries, law descriptions) into innerHTML. (ISSUE-009 / ISSUE-011)
        const esc = (s) => String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        let DATA = { stateLaws: [], localLaws: [], laws287g: [], typeMap: {}, metadata: {} };
        let currentResults = [];
        let resultsChart = null;

        async function loadData() {
            try {
                const response = await fetch(withBase('data/ici_data.json'));
                DATA = await response.json();
                initializeApp();
            } catch (error) {
                console.error('Error loading data:', error);
                addMessage('bot', 'Error loading data. Please make sure ici_data.json is available.');
            }
        }

        function initializeApp() {
            const allLaws = [...DATA.stateLaws, ...DATA.localLaws, ...(DATA.laws287g || [])];

            $('totalLaws').textContent = allLaws.length.toLocaleString();
            $('stateLaws').textContent = DATA.stateLaws.length.toLocaleString();
            $('localLaws').textContent = DATA.localLaws.length.toLocaleString();
            $('laws287g').textContent = (DATA.laws287g || []).length.toLocaleString();
            $('positiveLaws').textContent = allLaws.filter(l => l.posNeg === 1).length.toLocaleString();
            $('negativeLaws').textContent = allLaws.filter(l => l.posNeg === 0).length.toLocaleString();

            const stateSelect = $('filterState');
            DATA.metadata.states.forEach(state => {
                if (state && state.length === 2) {
                    const opt = document.createElement('option');
                    opt.value = state;
                    opt.textContent = state;
                    stateSelect.appendChild(opt);
                }
            });

            const typeSelect = $('filterType');
            Object.entries(DATA.typeMap).forEach(([code, name]) => {
                const opt = document.createElement('option');
                opt.value = code;
                opt.textContent = `${code} — ${name}`;
                typeSelect.appendChild(opt);
            });

            $('filterYearStart').value = DATA.metadata.yearRange[0];
            $('filterYearEnd').value = DATA.metadata.yearRange[1];
        }

        function addMessage(type, content) {
            const messagesDiv = $('chatMessages');
            const div = document.createElement('div');
            div.className = `message ${type}`;
            if (type === 'bot') {
                // Bot content is app-generated HTML (processQuery templates) — trusted.
                div.innerHTML = `<div class="message-label">ICI Database</div><div class="message-content">${content}</div>`;
            } else {
                // User query is raw and untrusted — escape it before rendering.
                div.innerHTML = `<div class="message-label" style="text-align:right;">Query</div><div class="message-content">${esc(content)}</div>`;
            }
            messagesDiv.appendChild(div);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function processQuery(query) {
            const q = query.toLowerCase();

            const allLaws = [
                ...DATA.stateLaws.map(l => ({ ...l, source: 'state' })),
                ...DATA.localLaws.map(l => ({ ...l, source: 'local' })),
                ...(DATA.laws287g || []).map(l => ({ ...l, source: '287g' }))
            ];

            const stateMatch =
                q.match(/(?:in|for|from)\s+([a-z]{2})\b|^([a-z]{2})\s+laws?|([a-z]{2})\s+legislation/i) ||
                q.match(/\b(california|texas|florida|new york|arizona|illinois|georgia|north carolina|ohio|michigan|pennsylvania|new jersey|virginia|washington|massachusetts|colorado|maryland|minnesota|oregon|wisconsin)\b/i);

            if (stateMatch) {
                let stateCode = stateMatch[1] || stateMatch[2] || stateMatch[3];
                stateCode = resolveStateCode(stateCode) || stateCode.toUpperCase();

                const stateLaws = allLaws.filter(l => l.state === stateCode);
                if (stateLaws.length > 0) {
                    const positive = stateLaws.filter(l => l.posNeg === 1).length;
                    const negative = stateLaws.filter(l => l.posNeg === 0).length;
                    currentResults = stateLaws;
                    showResults(`Laws in ${stateCode}`, stateLaws, 'byYear');
                    return `Found <strong>${stateLaws.length}</strong> laws in <strong>${stateCode}</strong>:<br>
                            • ${positive} positive (pro-immigrant)<br>
                            • ${negative} restrictive<br><br>
                            Results are displayed below with visualization and data table.`;
                } else {
                    return `No laws found for state code "${stateCode}". Please use a valid 2-letter state code.`;
                }
            }

            const yearMatch = q.match(/(?:in\s+)?(\d{4})/);
            if (yearMatch && (q.includes('year') || q.includes('passed') || q.includes('enacted') || q.includes('in 20') || q.includes('in 19'))) {
                const year = parseInt(yearMatch[1]);
                const yearLaws = allLaws.filter(l => l.year === year);
                if (yearLaws.length > 0) {
                    const positive = yearLaws.filter(l => l.posNeg === 1).length;
                    const negative = yearLaws.filter(l => l.posNeg === 0).length;
                    currentResults = yearLaws;
                    showResults(`Laws in ${year}`, yearLaws, 'byState');
                    return `In <strong>${year}</strong>, there were <strong>${yearLaws.length}</strong> laws recorded:<br>
                            • ${positive} positive (pro-immigrant)<br>
                            • ${negative} restrictive<br>
                            • ${yearLaws.filter(l => l.source === 'state').length} state-level<br>
                            • ${yearLaws.filter(l => l.source === 'local').length} local-level<br>
                            • ${yearLaws.filter(l => l.source === '287g').length} 287(g) agreements`;
                } else {
                    return `No laws found for year ${year}.`;
                }
            }

            if (q.includes('trump') || q.includes('2017 effect') || q.includes('spike')) {
                const before = allLaws.filter(l => l.year >= 2014 && l.year <= 2016);
                const during = allLaws.filter(l => l.year >= 2017 && l.year <= 2020);
                const beforePositive = before.filter(l => l.posNeg === 1).length;
                const duringPositive = during.filter(l => l.posNeg === 1).length;
                currentResults = during;
                showResults('Trump Era Laws (2017–2020)', during, 'byYear');
                return `<strong>The "Trump Effect" (2017–2020):</strong><br><br>
                        Pre-2017 baseline (2014–2016): ${before.length} laws (${beforePositive} positive)<br>
                        Trump era (2017–2020): ${during.length} laws (${duringPositive} positive)<br><br>
                        A significant spike in positive/sanctuary legislation was recorded after 2017 as state and local jurisdictions responded to heightened federal immigration enforcement.`;
            }

            const compareMatch = q.match(/compare\s+(\w+)\s+(?:and|vs?\.?|to|with)\s+(\w+)/i);
            if (compareMatch) {
                let state1 = resolveStateCode(compareMatch[1]) || compareMatch[1].toUpperCase();
                let state2 = resolveStateCode(compareMatch[2]) || compareMatch[2].toUpperCase();
                const laws1 = allLaws.filter(l => l.state === state1);
                const laws2 = allLaws.filter(l => l.state === state2);
                if (laws1.length > 0 && laws2.length > 0) {
                    const pos1 = laws1.filter(l => l.posNeg === 1).length;
                    const pos2 = laws2.filter(l => l.posNeg === 1).length;
                    currentResults = [...laws1, ...laws2];
                    showComparisonResults(state1, state2, laws1, laws2);
                    return `<strong>Jurisdictional Comparison: ${state1} vs. ${state2}</strong><br><br>
                            <strong>${state1}:</strong> ${laws1.length} total &mdash; ${pos1} positive, ${laws1.length - pos1} restrictive<br>
                            <strong>${state2}:</strong> ${laws2.length} total &mdash; ${pos2} positive, ${laws2.length - pos2} restrictive<br><br>
                            Legislative volume comparison by year is displayed below.`;
                }
            }

            if (q.includes('by type') || q.includes('type breakdown') || q.includes('categories')) {
                const typeBreakdown = {};
                allLaws.forEach(l => {
                    const type = l.type || 'Unknown';
                    if (!typeBreakdown[type]) typeBreakdown[type] = { positive: 0, negative: 0, total: 0 };
                    typeBreakdown[type].total++;
                    if (l.posNeg === 1) typeBreakdown[type].positive++;
                    else typeBreakdown[type].negative++;
                });
                showTypeBreakdown(typeBreakdown);
                let response = '<strong>Laws by Type:</strong><br><br>';
                Object.entries(typeBreakdown).sort((a, b) => b[1].total - a[1].total).slice(0, 10).forEach(([type, counts]) => {
                    const typeName = DATA.typeMap[type] || type;
                    response += `<strong>${type}</strong> (${typeName}): ${counts.total} laws<br>`;
                });
                return response;
            }

            if (q.includes('sanctuary') || (q.includes('immigrant') && q.includes('friendly')) ||
                (q.includes('pro') && q.includes('immigrant')) || q.includes('welcoming')) {
                const sanctuaryLaws = allLaws.filter(l => l.posNeg === 1);
                const stateSanctuary = sanctuaryLaws.filter(l => l.source === 'state').length;
                const localSanctuary = sanctuaryLaws.filter(l => l.source === 'local').length;
                currentResults = sanctuaryLaws;
                showResults('Sanctuary / Positive Laws', sanctuaryLaws, 'byState');
                return `Found <strong>${sanctuaryLaws.length}</strong> sanctuary / pro-immigrant laws:<br>
                        • ${stateSanctuary} state-level sanctuary laws<br>
                        • ${localSanctuary} local sanctuary ordinances<br><br>
                        In the ICI framework, "sanctuary laws" encompasses positive-scored legislation: policies that protect immigrant rights, expand access to public services, or formally limit cooperation with federal immigration enforcement agencies.`;
            }

            if (q.includes('polic') || q.includes('enforcement') || q.includes('detainer') || q.includes('287')) {
                const policingLaws = allLaws.filter(l => l.type === 'P');
                const positive = policingLaws.filter(l => l.posNeg === 1).length;
                currentResults = policingLaws;
                showResults('Policing / Enforcement Laws', policingLaws, 'byYear');
                return `Found <strong>${policingLaws.length}</strong> Policing &amp; Enforcement laws:<br>
                        • ${positive} positive (sanctuary / limiting cooperation)<br>
                        • ${policingLaws.length - positive} restrictive (enforcement / detainer)<br><br>
                        This category includes sanctuary city policies, ICE detainer cooperation agreements, 287(g) MOAs, and related policing mandates.`;
            }

            if (q.includes('trend') || q.includes('over time') || q.includes('history') || q.includes('timeline')) {
                showTrendsChart(allLaws);
                return `<strong>Immigration Legislation Trends (${DATA.metadata.yearRange[0]}–${DATA.metadata.yearRange[1]}):</strong><br><br>
                        The chart disaggregates legislative activity by source and direction. Key findings:<br>
                        • Significant legislative spike post-2017<br>
                        • Positive/sanctuary laws dominate the recent period<br>
                        • Local-level activity has grown markedly since 2017`;
            }

            if (q.includes('summary') || q.includes('by state') || q.includes('state breakdown')) {
                showStateSummary(allLaws);
                return `<strong>Summary by State:</strong><br><br>
                        The chart ranks all states by total legislative volume (top 20 shown). States with large immigrant populations — California, Texas, New York — exhibit the highest activity across both pro-immigrant and enforcement legislation.`;
            }

            if (q.includes('local') || q.includes('city') || q.includes('county') || q.includes('municipal')) {
                const localOnly = DATA.localLaws.map(l => ({ ...l, source: 'local' }));
                const positive = localOnly.filter(l => l.posNeg === 1).length;
                currentResults = localOnly;
                showResults('Local (City / County) Laws', localOnly, 'byState');
                return `Found <strong>${localOnly.length}</strong> local (city / county) laws:<br>
                        • ${positive} positive / sanctuary ordinances<br>
                        • ${localOnly.length - positive} restrictive policies<br><br>
                        Sub-state jurisdictions have emerged as a primary site of immigration regulation, particularly following the 2017 federal enforcement escalation.`;
            }

            const positive = allLaws.filter(l => l.posNeg === 1).length;
            showResults('All Laws', allLaws.slice(0, 100), 'byYear');
            return `The ICI database contains <strong>${allLaws.length}</strong> immigration-related laws:<br>
                    • ${DATA.stateLaws.length} state-level laws<br>
                    • ${DATA.localLaws.length} local ordinances<br>
                    • ${(DATA.laws287g || []).length} 287(g) agreements<br>
                    • ${positive} positive (pro-immigrant)<br>
                    • ${allLaws.length - positive} restrictive<br><br>
                    Use the query interface or the Advanced Filters panel to narrow results by state, year, type, or direction.`;
        }

        function showResults(title, laws, groupBy) {
            $('resultsSection').classList.add('active');
            $('resultsTitle').textContent = title;
            $('resultsCount').textContent = `${laws.length.toLocaleString()} records`;

            let chartData = {};
            if (groupBy === 'byYear') {
                laws.forEach(l => {
                    const year = l.year || 'Unknown';
                    if (!chartData[year]) chartData[year] = { positive: 0, negative: 0 };
                    if (l.posNeg === 1) chartData[year].positive++;
                    else chartData[year].negative++;
                });
            } else {
                laws.forEach(l => {
                    const state = l.state || 'Unknown';
                    if (!chartData[state]) chartData[state] = { positive: 0, negative: 0 };
                    if (l.posNeg === 1) chartData[state].positive++;
                    else chartData[state].negative++;
                });
            }

            const labels = Object.keys(chartData).sort();
            const positiveData = labels.map(k => chartData[k].positive);
            const negativeData = labels.map(k => chartData[k].negative);

            updateChart(labels, positiveData, negativeData, groupBy === 'byYear' ? 'line' : 'bar');
            updateTable(laws);
        }

        function showComparisonResults(state1, state2, laws1, laws2) {
            $('resultsSection').classList.add('active');
            $('resultsTitle').textContent = `${state1} vs. ${state2}`;
            $('resultsCount').textContent = `${(laws1.length + laws2.length).toLocaleString()} records`;

            const years = [...new Set([...laws1, ...laws2].map(l => l.year))].filter(y => y).sort();
            const data1 = years.map(y => laws1.filter(l => l.year === y).length);
            const data2 = years.map(y => laws2.filter(l => l.year === y).length);

            if (resultsChart) resultsChart.destroy();

            const ctx = $('resultsChart').getContext('2d');
            resultsChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: years,
                    datasets: [
                        { label: state1, data: data1, borderColor: '#6366F1', backgroundColor: 'rgba(99,102,241,0.10)', fill: true, tension: 0.3 },
                        { label: state2, data: data2, borderColor: '#EF4444', backgroundColor: 'rgba(239,68,68,0.10)', fill: true, tension: 0.3 }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } }
            });

            updateTable([...laws1, ...laws2]);
        }

        function showTrendsChart(laws) {
            $('resultsSection').classList.add('active');
            $('resultsTitle').textContent = 'Legislation Trends Over Time';
            $('resultsCount').textContent = `${laws.length.toLocaleString()} records`;

            const yearData = {};
            laws.forEach(l => {
                if (l.year && l.year >= 2005) {
                    if (!yearData[l.year]) yearData[l.year] = { state_pos: 0, state_neg: 0, local_pos: 0, local_neg: 0, g287_pos: 0, g287_neg: 0 };
                    if (l.source === 'state') { if (l.posNeg === 1) yearData[l.year].state_pos++; else yearData[l.year].state_neg++; }
                    else if (l.source === '287g') { if (l.posNeg === 1) yearData[l.year].g287_pos++; else yearData[l.year].g287_neg++; }
                    else { if (l.posNeg === 1) yearData[l.year].local_pos++; else yearData[l.year].local_neg++; }
                }
            });

            const years = Object.keys(yearData).sort();
            if (resultsChart) resultsChart.destroy();

            const ctx = $('resultsChart').getContext('2d');
            resultsChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: years,
                    datasets: [
                        { label: 'State — Positive', data: years.map(y => yearData[y].state_pos), borderColor: '#10B981', backgroundColor: 'transparent', tension: 0.3 },
                        { label: 'State — Restrictive', data: years.map(y => yearData[y].state_neg), borderColor: '#EF4444', backgroundColor: 'transparent', tension: 0.3 },
                        { label: 'Local — Positive', data: years.map(y => yearData[y].local_pos), borderColor: '#34D399', borderDash: [5, 5], backgroundColor: 'transparent', tension: 0.3 },
                        { label: 'Local — Restrictive', data: years.map(y => yearData[y].local_neg), borderColor: '#F87171', borderDash: [5, 5], backgroundColor: 'transparent', tension: 0.3 },
                        { label: '287(g) — Positive', data: years.map(y => yearData[y].g287_pos), borderColor: '#818CF8', borderDash: [2, 4], backgroundColor: 'transparent', tension: 0.3 },
                        { label: '287(g) — Restrictive', data: years.map(y => yearData[y].g287_neg), borderColor: '#C084FC', borderDash: [2, 4], backgroundColor: 'transparent', tension: 0.3 }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } }
            });

            currentResults = laws.filter(l => l.year >= 2005);
            updateTable(currentResults.slice(0, 50));
        }

        function showTypeBreakdown(typeBreakdown) {
            $('resultsSection').classList.add('active');
            const total = Object.values(typeBreakdown).reduce((s, v) => s + v.total, 0);
            $('resultsTitle').textContent = 'Breakdown by Law Type';
            $('resultsCount').textContent = `${total.toLocaleString()} records`;

            const types = Object.keys(typeBreakdown).sort((a, b) => typeBreakdown[b].total - typeBreakdown[a].total);
            const labels = types.map(t => DATA.typeMap[t] || t);

            if (resultsChart) resultsChart.destroy();

            const ctx = $('resultsChart').getContext('2d');
            resultsChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Positive', data: types.map(t => typeBreakdown[t].positive), backgroundColor: 'rgba(16,185,129,0.72)' },
                        { label: 'Restrictive', data: types.map(t => typeBreakdown[t].negative), backgroundColor: 'rgba(239,68,68,0.72)' }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { x: { stacked: true }, y: { stacked: true } } }
            });
        }

        function showStateSummary(laws) {
            $('resultsSection').classList.add('active');
            $('resultsTitle').textContent = 'Summary by State (Top 20)';
            $('resultsCount').textContent = `${laws.length.toLocaleString()} records`;

            const stateData = {};
            laws.forEach(l => {
                if (l.state && l.state.length === 2) {
                    if (!stateData[l.state]) stateData[l.state] = { positive: 0, negative: 0 };
                    if (l.posNeg === 1) stateData[l.state].positive++;
                    else stateData[l.state].negative++;
                }
            });

            const states = Object.keys(stateData)
                .sort((a, b) => (stateData[b].positive + stateData[b].negative) - (stateData[a].positive + stateData[a].negative))
                .slice(0, 20);

            if (resultsChart) resultsChart.destroy();

            const ctx = $('resultsChart').getContext('2d');
            resultsChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: states,
                    datasets: [
                        { label: 'Positive', data: states.map(s => stateData[s].positive), backgroundColor: 'rgba(16,185,129,0.72)' },
                        { label: 'Restrictive', data: states.map(s => stateData[s].negative), backgroundColor: 'rgba(239,68,68,0.72)' }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { x: { stacked: true }, y: { stacked: true } } }
            });

            currentResults = laws;
        }

        function updateChart(labels, positiveData, negativeData, type) {
            if (resultsChart) resultsChart.destroy();

            const ctx = $('resultsChart').getContext('2d');
            resultsChart = new Chart(ctx, {
                type,
                data: {
                    labels,
                    datasets: [
                        { label: 'Positive', data: positiveData, backgroundColor: type === 'bar' ? 'rgba(16,185,129,0.72)' : 'rgba(16,185,129,0.12)', borderColor: '#10B981', fill: type === 'line', tension: 0.3 },
                        { label: 'Restrictive', data: negativeData, backgroundColor: type === 'bar' ? 'rgba(239,68,68,0.72)' : 'rgba(239,68,68,0.12)', borderColor: '#EF4444', fill: type === 'line', tension: 0.3 }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } }
            });
        }

        function updateTable(laws) {
            const tableDiv = $('resultsTable');
            const display = laws.slice(0, 100);

            let html = `<div class="table-scroll"><table>
                <thead><tr>
                    <th>Year</th><th>State</th><th>Jurisdiction</th>
                    <th>Type</th><th>Direction</th><th>Description</th>
                </tr></thead><tbody>`;

            display.forEach(law => {
                const badge = law.posNeg === 1
                    ? '<span class="positive-badge">Positive</span>'
                    : '<span class="negative-badge">Restrictive</span>';

                const location = law.source === 'local' ? (law.city || law.county || '—')
                    : law.source === '287g' ? (law.city || law.county || '287(g)')
                    : 'Statewide';

                const typeName = DATA.typeMap[law.type] || law.type || '—';
                const desc = law.description ? esc(law.description.substring(0, 160)) + (law.description.length > 160 ? '…' : '') : '—';

                html += `<tr>
                    <td class="year-cell">${esc(law.year || '—')}</td>
                    <td class="state-cell">${esc(law.state || '—')}</td>
                    <td>${esc(location)}</td>
                    <td class="type-cell" title="${esc(typeName)}">${esc(law.type || '—')}</td>
                    <td>${badge}</td>
                    <td class="truncate" title="${esc(law.description || '')}">${desc}</td>
                </tr>`;
            });

            html += '</tbody></table></div>';

            if (laws.length > 100) {
                html += `<p class="table-footer">Showing 100 of ${laws.length.toLocaleString()} records. Export CSV for the full dataset.</p>`;
            }

            tableDiv.innerHTML = html;
        }

        function exportCSV() {
            if (currentResults.length === 0) return;

            // Neutralize spreadsheet formula injection: a cell beginning with
            // = + - @ (or a tab/CR) is treated as a formula by Excel/Sheets.
            // Prefix those with a single quote so they render as literal text. (ISSUE-019)
            const csvSafe = (v) => {
                const s = String(v ?? '');
                const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
                return guarded.replace(/"/g, '""');
            };

            const headers = ['Year', 'State', 'County', 'City', 'Source', 'Type', 'PosNeg', 'Tier', 'Description'];
            const rows = currentResults.map(law => [
                law.year || '', law.state || '', law.county || '', law.city || '',
                law.source || '', law.type || '', law.posNeg, law.tier || '',
                law.description || ''
            ]);

            let csv = headers.join(',') + '\n';
            rows.forEach(row => { csv += row.map(c => `"${csvSafe(c)}"`).join(',') + '\n'; });

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ici_export.csv';
            a.click();
            URL.revokeObjectURL(url);
        }

        function applyFilters() {
            const source = $('filterSource').value;
            const state = $('filterState').value;
            const type = $('filterType').value;
            const yearStart = parseInt($('filterYearStart').value) || 1970;
            const yearEnd = parseInt($('filterYearEnd').value) || 2025;
            const direction = $('filterDirection').value;

            let laws = [];
            if (source === 'state' || source === 'all') laws = laws.concat(DATA.stateLaws.map(l => ({ ...l, source: 'state' })));
            if (source === 'local' || source === 'all') laws = laws.concat(DATA.localLaws.map(l => ({ ...l, source: 'local' })));
            if (source === '287g' || source === 'all') laws = laws.concat((DATA.laws287g || []).map(l => ({ ...l, source: '287g' })));

            if (state) laws = laws.filter(l => l.state === state);
            if (type) laws = laws.filter(l => l.type === type);
            if (direction !== '') laws = laws.filter(l => l.posNeg === parseInt(direction));
            laws = laws.filter(l => l.year >= yearStart && l.year <= yearEnd);

            currentResults = laws;

            const parts = [];
            if (state) parts.push(state);
            if (type) parts.push(DATA.typeMap[type] || type);
            if (direction === '1') parts.push('Positive');
            if (direction === '0') parts.push('Restrictive');
            parts.push(`${yearStart}–${yearEnd}`);

            showResults(`Filtered: ${parts.join(' · ')}`, laws, 'byYear');
            addMessage('bot', `Filter applied. Found <strong>${laws.length.toLocaleString()}</strong> matching records.`);
        }

        function clearFilters() {
            $('filterSource').value = 'all';
            $('filterState').value = '';
            $('filterType').value = '';
            $('filterDirection').value = '';
            $('filterYearStart').value = DATA.metadata.yearRange?.[0] || 2005;
            $('filterYearEnd').value = DATA.metadata.yearRange?.[1] || 2020;
        }

        function onSend() {
            const input = $('chatInput');
            const query = input.value.trim();
            if (!query) return;
            addMessage('user', query);
            input.value = '';
            setTimeout(() => { addMessage('bot', processQuery(query)); }, 280);
        }

        function onInputKeypress(e) {
            if (e.key === 'Enter') onSend();
        }

        function onSuggestionClick(e) {
            $('chatInput').value = e.currentTarget.dataset.query;
            onSend();
        }

        const sendBtn = $('sendBtn');
        const chatInput = $('chatInput');
        const applyBtn = $('applyFilters');
        const clearBtn = $('clearFilters');
        const exportBtn = $('exportCsvBtn');
        const suggestions = root.querySelectorAll('.suggestion');

        sendBtn.addEventListener('click', onSend);
        chatInput.addEventListener('keypress', onInputKeypress);
        applyBtn.addEventListener('click', applyFilters);
        clearBtn.addEventListener('click', clearFilters);
        exportBtn.addEventListener('click', exportCSV);
        suggestions.forEach(btn => btn.addEventListener('click', onSuggestionClick));

        loadData();

        return () => {
            sendBtn.removeEventListener('click', onSend);
            chatInput.removeEventListener('keypress', onInputKeypress);
            applyBtn.removeEventListener('click', applyFilters);
            clearBtn.removeEventListener('click', clearFilters);
            exportBtn.removeEventListener('click', exportCSV);
            suggestions.forEach(btn => btn.removeEventListener('click', onSuggestionClick));
            if (resultsChart) resultsChart.destroy();
        };
    }, []);

    return (
        <div className="explorer" ref={rootRef}>
            <div className="container">

                <header>
                    <div className="header-left">
                        <div className="header-wordmark">ICI</div>
                        <div className="header-titles">
                            <h1>Immigrant Climate <span>Index</span></h1>
                            <p>Sub-Federal Immigration Law Database — Interactive Research Explorer</p>
                        </div>
                    </div>
                    <div className="header-meta">
                        <div className="header-authors">
                            <div className="author-names">Huyen Pham &amp; Pham Hoang Van</div>
                            <div className="author-affiliations">Texas A&amp;M University School of Law · Baylor University</div>
                        </div>
                        <div className="header-chips">
                            <span className="header-chip live">Live Database</span>
                            <span className="header-chip">2005 – 2026</span>
                            <span className="header-chip">50 States + DC</span>
                        </div>
                    </div>
                    <nav className="page-nav">
                        <Link to="/" className="back-link">← Home</Link>
                        <Link to="/assistant" className="back-link">AI Assistant</Link>
                        <a href={withBase('research.html')} className="back-link">Research</a>
                    </nav>
                </header>

                <div className="stats-bar">
                    <div className="stat-card"><div className="number" id="totalLaws">—</div><div className="label">Total Laws</div></div>
                    <div className="stat-card"><div className="number" id="stateLaws">—</div><div className="label">State Laws</div></div>
                    <div className="stat-card"><div className="number" id="localLaws">—</div><div className="label">Local Laws</div></div>
                    <div className="stat-card"><div className="number" id="laws287g">—</div><div className="label">287(g) Agreements</div></div>
                    <div className="stat-card"><div className="number" id="positiveLaws">—</div><div className="label">Positive / Pro-Immigrant</div></div>
                    <div className="stat-card"><div className="number" id="negativeLaws">—</div><div className="label">Restrictive / Enforcement</div></div>
                </div>

                <div className="type-strip">
                    <span className="type-strip-label">Law Types</span>
                    <div className="type-strip-items">
                        <div className="type-item"><span className="type-code">B</span><span className="type-name">Benefits</span></div>
                        <div className="type-item"><span className="type-code">P</span><span className="type-name">Policing</span></div>
                        <div className="type-item"><span className="type-code">E</span><span className="type-name">Employment</span></div>
                        <div className="type-item"><span className="type-code">D</span><span className="type-name">Driver's License</span></div>
                        <div className="type-item"><span className="type-code">H</span><span className="type-name">Housing</span></div>
                        <div className="type-item"><span className="type-code">L</span><span className="type-name">Professional Licensing</span></div>
                        <div className="type-item"><span className="type-code">T</span><span className="type-name">In-State Tuition</span></div>
                        <div className="type-item"><span className="type-code">V</span><span className="type-name">Voting / ID</span></div>
                        <div className="type-item"><span className="type-code">W</span><span className="type-name">Welfare</span></div>
                    </div>
                </div>

                <div className="main-content">
                    <div className="left-column">

                        <div className="query-section">
                            <div className="query-header">
                                <div className="query-header-left">
                                    <div className="query-status" />
                                    <span className="query-header-title">Research Query Interface</span>
                                </div>
                                <span className="query-header-right">Natural language · State · Year · Type · Trend</span>
                            </div>
                            <div className="chat-messages" id="chatMessages">
                                <div className="message bot">
                                    <div className="message-label">ICI Database</div>
                                    <div className="message-content">
                                        Welcome to the ICI Research Query Interface. This tool provides structured access to the sub-federal immigration law database covering <strong>2005–2026</strong> across all 50 states and the District of Columbia.
                                        <ul style={{ marginTop: 8 }}>
                                            <li>Query by state, year, law type, or direction</li>
                                            <li>Compare legislative profiles across jurisdictions</li>
                                            <li>Analyze the Trump Effect and post-2017 patterns</li>
                                            <li>Explore 287(g) enforcement agreements by geography</li>
                                            <li>Export filtered datasets to CSV for further analysis</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                            <div className="query-input-area">
                                <div className="query-input-wrapper">
                                    <input type="text" className="chat-input" id="chatInput" placeholder='e.g. "Compare California and Texas" · "Show 2017 Trump effect" · "Policing laws by state"' />
                                    <button className="send-btn" id="sendBtn">Query</button>
                                </div>
                            </div>
                        </div>

                        <div className="results-section" id="resultsSection">
                            <div className="results-toolbar">
                                <div className="results-toolbar-left">
                                    <h3 id="resultsTitle">Results</h3>
                                    <span id="resultsCount">0 records</span>
                                </div>
                                <div className="results-toolbar-right">
                                    <button className="toolbar-btn" id="exportCsvBtn">
                                        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                                        Export CSV
                                    </button>
                                </div>
                            </div>
                            <div className="results-chart-wrap">
                                <div className="results-chart">
                                    <canvas id="resultsChart" />
                                </div>
                            </div>
                            <div className="results-table-wrap">
                                <div className="table-scroll" id="resultsTable" />
                            </div>
                        </div>

                    </div>

                    <div className="sidebar">

                        <Link to="/assistant" className="ai-card">
                            <div className="ai-card-text">
                                <div className="ai-card-title">AI Research Assistant</div>
                                <div className="ai-card-sub">Deep analysis powered by Claude</div>
                            </div>
                            <span className="ai-card-arrow">→</span>
                        </Link>

                        <div className="sidebar-card">
                            <div className="card-header">Quick Queries</div>
                            <div className="card-body" style={{ padding: '8px 10px' }}>
                                <div className="query-list">
                                    <button className="suggestion" data-query="Show summary by state">Summary by state</button>
                                    <button className="suggestion" data-query="Show trends over time">Legislation trends over time</button>
                                    <button className="suggestion" data-query="Show laws by type">Breakdown by law type</button>
                                    <button className="suggestion" data-query="Compare California and Texas">Compare California and Texas</button>
                                    <button className="suggestion" data-query='Show 2017 Trump effect'>The 2017 "Trump Effect"</button>
                                    <button className="suggestion" data-query="Show local sanctuary policies">Local sanctuary policies</button>
                                </div>
                            </div>
                        </div>

                        <div className="sidebar-card">
                            <div className="card-header">Advanced Filters</div>
                            <div className="card-body">
                                <div className="filter-section">
                                    <div className="filter-section-label">Data Source</div>
                                    <div className="filter-group">
                                        <select id="filterSource">
                                            <option value="all">All Laws (State + Local + 287g)</option>
                                            <option value="state">State Laws Only</option>
                                            <option value="local">Local Laws Only</option>
                                            <option value="287g">287(g) Agreements Only</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="filter-section">
                                    <div className="filter-section-label">Geographic</div>
                                    <div className="filter-group">
                                        <label>State</label>
                                        <select id="filterState">
                                            <option value="">All States</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="filter-section">
                                    <div className="filter-section-label">Classification</div>
                                    <div className="filter-group">
                                        <label>Law Type</label>
                                        <select id="filterType">
                                            <option value="">All Types</option>
                                        </select>
                                    </div>
                                    <div className="filter-group">
                                        <label>Direction</label>
                                        <select id="filterDirection">
                                            <option value="">All Directions</option>
                                            <option value="1">Positive (Pro-Immigrant)</option>
                                            <option value="0">Restrictive (Enforcement)</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="filter-section">
                                    <div className="filter-section-label">Time Period</div>
                                    <div className="filter-group">
                                        <label>Year Range</label>
                                        <div className="year-range">
                                            <input type="number" id="filterYearStart" placeholder="From" />
                                            <input type="number" id="filterYearEnd" placeholder="To" />
                                        </div>
                                    </div>
                                </div>
                                <div className="filter-actions">
                                    <button className="apply-btn" id="applyFilters">Apply Filters</button>
                                    <button className="clear-btn" id="clearFilters">Clear</button>
                                </div>
                            </div>
                        </div>

                        <div className="sidebar-card">
                            <div className="card-header">Scoring Methodology</div>
                            <div className="card-body">
                                <table className="tier-table">
                                    <tbody>
                                        <tr>
                                            <td><span className="tier-badge tier-pos">±4</span></td>
                                            <td className="tier-desc">Laws affecting many aspects of daily life — highest impact</td>
                                        </tr>
                                        <tr>
                                            <td><span className="tier-badge tier-pos">±3</span></td>
                                            <td className="tier-desc">Crucial aspects of life that are difficult to avoid or substitute</td>
                                        </tr>
                                        <tr>
                                            <td><span className="tier-badge tier-pos">±2</span></td>
                                            <td className="tier-desc">Important aspects for which alternatives exist</td>
                                        </tr>
                                        <tr>
                                            <td><span className="tier-badge tier-pos">±1</span></td>
                                            <td className="tier-desc">Less significant impacts (e.g., English-only declarations)</td>
                                        </tr>
                                    </tbody>
                                </table>
                                <p className="tier-note">Positive values = pro-immigrant legislation. Negative values = restrictive / enforcement legislation. Tier scores are aggregated at the jurisdiction level to compute the ICI.</p>
                            </div>
                        </div>

                        <div className="sidebar-card">
                            <div className="card-header">About the ICI</div>
                            <div className="card-body">
                                <div className="about-block">
                                    <p>The <strong>Immigrant Climate Index</strong> provides a quantitative measure of the regulatory environment for immigrants across U.S. jurisdictions, from the federal level down to individual cities and counties.</p>
                                    <p>The database catalogs subfederal legislation from <strong>2005 to 2026</strong>, classifying each law by type, jurisdiction, direction, and tier score.</p>
                                    <div className="citation-block">
                                        <div className="citation-label">How to Cite</div>
                                        Pham, Huyen &amp; Pham Hoang Van. <em>The Immigrant Climate Index.</em> Texas A&amp;M University School of Law &amp; Baylor University (2024).
                                    </div>
                                    <div className="about-links">
                                        <a href={withBase('research.html')} className="about-link">Full Research Publication</a>
                                        <a href="https://www.law.tamu.edu/faculty/faculty-profiles/huyen-pham.html" target="_blank" rel="noreferrer" className="about-link">Prof. Huyen Pham — Texas A&amp;M Law</a>
                                        <a href="https://www.baylor.edu/van_pham" target="_blank" rel="noreferrer" className="about-link">Prof. Pham Hoang Van — Baylor</a>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
}

import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Chart from 'chart.js/auto';
import { withBase } from '../utils/withBase';
import './Assistant.css';

// ─────────────────────────────────────────────────────────────────────────────
// ICI AI ASSISTANT — ported near-verbatim from the original standalone
// chatbot-ai.html, for the same reason as DataExplorer: this is an imperative
// chat/canvas/DOM-driven tool (multi-turn conversation state, SQLite-backed
// history sidebar, Chart.js rendering, custom markdown formatting) rather
// than naturally state-driven UI. It's wrapped in one effect operating on
// refs/ids scoped to this component's root element instead of being
// rewritten into React state.
// ─────────────────────────────────────────────────────────────────────────────
export default function Assistant() {
    const rootRef = useRef(null);

    useEffect(() => {
        const root = rootRef.current;
        const $ = (id) => root.querySelector(`#${id}`);

        const API_BASE = /\.github\.io$/.test(location.hostname)
            ? 'https://REPLACE-WITH-RENDER-URL.onrender.com'
            : '';

        Chart.defaults.color = '#A1A1AA';
        Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
        Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";

        let DATA = { stateLaws: [], localLaws: [], laws287g: [], typeMap: {}, metadata: {} };
        let currentResults = [];
        let resultsChart = null;
        let conversationHistory = [];
        let currentChatId = null;
        let vizOpen = false;
        let pendingVizContext = null;
        let _pendingDeleteId = null;

        const DEFAULT_SUGGESTIONS = [
            { label: 'Trends', query: 'What are the main trends in immigration legislation since 2005?' },
            { label: 'Friendly States', query: 'Which states have the most immigrant-friendly policies?' },
            { label: 'Trump Effect', query: 'Explain the Trump Effect on immigration legislation' },
            { label: 'CA vs TX', query: 'Compare sanctuary policies in California vs Texas' },
            { label: 'Law Types', query: 'What types of laws are most common?' },
            { label: 'Policing Laws', query: 'Analyze the policing and enforcement laws' },
        ];

        const STATE_NAMES = {
            california: 'CA', texas: 'TX', florida: 'FL', 'new york': 'NY', arizona: 'AZ',
            illinois: 'IL', georgia: 'GA', colorado: 'CO', washington: 'WA', oregon: 'OR',
            virginia: 'VA', maryland: 'MD', massachusetts: 'MA', 'new jersey': 'NJ',
            pennsylvania: 'PA', ohio: 'OH', michigan: 'MI', minnesota: 'MN', wisconsin: 'WI',
            nevada: 'NV', 'north carolina': 'NC', tennessee: 'TN', utah: 'UT', iowa: 'IA',
        };

        function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

        function generateContextualSuggestions() {
            if (conversationHistory.length === 0) return DEFAULT_SUGGESTIONS;
            const allText = conversationHistory.map(m => m.content).join(' ').toLowerCase();
            const sugs = [];
            const used = new Set();

            const mentioned = [];
            for (const [name, code] of Object.entries(STATE_NAMES)) {
                if (allText.includes(name) || allText.includes(' ' + code.toLowerCase() + ' ')) {
                    mentioned.push({ name, code });
                }
            }

            if (mentioned.length >= 1) {
                const s = mentioned[0];
                const sN = capitalize(s.name);
                sugs.push({ label: `${s.code} Trends`, query: `Show ${sN} legislation trends over time` });
                sugs.push({ label: `${s.code} Cities`, query: `Which cities and counties in ${sN} have sanctuary policies?` });
                if (mentioned.length >= 2) {
                    const s2 = mentioned[1];
                    sugs.push({ label: `${s.code} vs ${s2.code}`, query: `Compare ${sN} and ${capitalize(s2.name)} policing laws by year` });
                } else {
                    sugs.push({ label: `${s.code} vs TX`, query: `Compare ${sN} and Texas immigration policies in detail` });
                }
                used.add(sugs[sugs.length - 1].query);
                used.add(sugs[sugs.length - 2].query);
                used.add(sugs[sugs.length - 3].query);
            }

            if (allText.includes('trump') || allText.includes('2017') || allText.includes('spike')) {
                if (!used.has('q1')) { sugs.push({ label: 'By State 2017', query: 'Which states saw the biggest spike in legislation in 2017?' }); used.add('q1'); }
                if (!used.has('q2')) { sugs.push({ label: 'Pre vs Post', query: 'Compare pre-2017 and post-2017 legislative patterns across states' }); used.add('q2'); }
            }

            if (allText.includes('polic') || allText.includes('sanctuary') || allText.includes('enforcement')) {
                if (!used.has('q3')) { sugs.push({ label: 'Top Sanctuaries', query: 'Which cities have the strongest sanctuary policies?' }); used.add('q3'); }
                if (!used.has('q4')) { sugs.push({ label: '287(g) Map', query: 'Which states have the most 287(g) enforcement agreements?' }); used.add('q4'); }
            }

            if (allText.includes('trend') || allText.includes('over time') || allText.includes('history')) {
                if (!used.has('q5')) { sugs.push({ label: 'Local vs State', query: 'How do local and state legislation trends compare over time?' }); used.add('q5'); }
            }

            if (allText.includes('employment') || allText.includes('worker')) {
                if (!used.has('q6')) { sugs.push({ label: 'Employment', query: 'Which states have the most employment-related immigration laws?' }); used.add('q6'); }
            }

            for (const d of DEFAULT_SUGGESTIONS) {
                if (sugs.length >= 6) break;
                if (!used.has(d.query)) { sugs.push(d); used.add(d.query); }
            }

            return sugs.slice(0, 6);
        }

        function updateDynamicSuggestions() {
            const sugs = generateContextualSuggestions();

            const chipsEl = $('quickChips');
            chipsEl.innerHTML = sugs.map(s =>
                `<button class="suggestion" data-query="${s.query.replace(/"/g, '&quot;')}">${s.label}</button>`
            ).join('');
            attachChipListeners();

            const exListEl = $('exampleList');
            exListEl.innerHTML = sugs.map(s =>
                `<li data-query="${s.query.replace(/"/g, '&quot;')}">${s.query}</li>`
            ).join('');
            attachExampleListeners();
        }

        function attachChipListeners() {
            root.querySelectorAll('#quickChips .suggestion').forEach(btn => {
                btn.addEventListener('click', () => {
                    $('chatInput').value = btn.dataset.query;
                    $('chatInput').focus();
                });
            });
        }

        function attachExampleListeners() {
            root.querySelectorAll('#exampleList li').forEach(li => {
                li.addEventListener('click', () => {
                    $('chatInput').value = li.dataset.query;
                    $('chatInput').focus();
                });
            });
        }

        async function loadChatList() {
            try {
                const resp = await fetch(`${API_BASE}/api/chats`);
                const chats = await resp.json();
                renderChatList(chats);
            } catch { /* server may not be running */ }
        }

        function renderChatList(chats) {
            const el = $('historyList');
            if (!chats.length) {
                el.innerHTML = '<div class="history-empty">No chats yet.<br>Start a conversation!</div>';
                return;
            }
            el.innerHTML = chats.map(c => {
                const isActive = c.id === currentChatId;
                return `
                <div class="chat-item ${isActive ? 'active' : ''}" data-id="${c.id}">
                    <span class="chat-item-name" title="${c.name}">${c.name}</span>
                    <div class="chat-item-actions">
                        <button class="chat-action-btn rename-btn" data-id="${c.id}" title="Rename">✎</button>
                        <button class="chat-action-btn delete-btn" data-id="${c.id}" data-name="${c.name.replace(/"/g, '&quot;')}" title="Delete">✕</button>
                    </div>
                </div>`;
            }).join('');

            root.querySelectorAll('.chat-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.classList.contains('chat-action-btn')) return;
                    loadChatFromDB(item.dataset.id);
                });
            });

            root.querySelectorAll('.rename-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    startRename(btn.dataset.id);
                });
            });

            root.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showDeleteModal(btn.dataset.id, btn.dataset.name);
                });
            });
        }

        async function createNewChat() {
            try {
                const resp = await fetch(`${API_BASE}/api/chats`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New Chat' }) });
                const chat = await resp.json();
                currentChatId = chat.id;
                localStorage.setItem('ici-active-chat', currentChatId);
                return chat.id;
            } catch {
                currentChatId = 'local-' + Date.now();
                localStorage.setItem('ici-active-chat', currentChatId);
                return currentChatId;
            }
        }

        async function loadChatFromDB(chatId) {
            try {
                const resp = await fetch(`${API_BASE}/api/chats/${chatId}`);
                if (!resp.ok) return;
                const chat = await resp.json();

                currentChatId = chatId;
                localStorage.setItem('ici-active-chat', currentChatId);
                conversationHistory = [];
                currentResults = [];
                if (resultsChart) { resultsChart.destroy(); resultsChart = null; }
                pendingVizContext = null;
                setVizOpen(false);

                const msgEl = $('chatMessages');
                msgEl.innerHTML = '';

                if (!chat.messages || chat.messages.length === 0) {
                    msgEl.innerHTML = getEmptyStateHTML();
                    attachEmptyCardListeners();
                } else {
                    for (const msg of chat.messages) {
                        conversationHistory.push({ role: msg.role, content: msg.content });
                        if (msg.role === 'user') {
                            addMessage('user', msg.content);
                        } else {
                            addMessage('bot', formatResponse(msg.content));
                        }
                    }
                }

                updateDynamicSuggestions();
                await loadChatList();
            } catch (err) {
                console.error('Failed to load chat:', err);
            }
        }

        function startNewChat() {
            currentChatId = null;
            localStorage.removeItem('ici-active-chat');
            conversationHistory = [];
            currentResults = [];
            if (resultsChart) { resultsChart.destroy(); resultsChart = null; }
            pendingVizContext = null;
            setVizOpen(false);
            $('chatMessages').innerHTML = getEmptyStateHTML();
            attachEmptyCardListeners();
            root.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
            updateDynamicSuggestions();
            $('chatInput').focus();
        }

        async function deleteChat(chatId) {
            try {
                await fetch(`${API_BASE}/api/chats/${chatId}`, { method: 'DELETE' });
                if (currentChatId === chatId) startNewChat();
                await loadChatList();
            } catch { /* offline mode */ }
        }

        function startRename(chatId) {
            const item = root.querySelector(`.chat-item[data-id="${chatId}"]`);
            if (!item) return;
            const nameEl = item.querySelector('.chat-item-name');
            const currentName = nameEl.textContent;

            const input = document.createElement('input');
            input.className = 'chat-item-input';
            input.value = currentName;
            nameEl.replaceWith(input);
            input.focus();
            input.select();

            item.querySelector('.chat-item-actions').style.display = 'none';

            const finish = async () => {
                const newName = input.value.trim() || currentName;
                try {
                    await fetch(`${API_BASE}/api/chats/${chatId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: newName })
                    });
                } catch { /* offline */ }
                await loadChatList();
            };

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); finish(); }
                if (e.key === 'Escape') { loadChatList(); }
            });
            input.addEventListener('blur', finish);
        }

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
            updateDynamicSuggestions();
            const savedId = localStorage.getItem('ici-active-chat');
            if (savedId) loadChatFromDB(savedId);
        }

        function addMessage(type, content) {
            const es = $('emptyState');
            if (es) es.style.display = 'none';
            const messagesDiv = $('chatMessages');
            const div = document.createElement('div');
            div.className = `message ${type}`;
            div.innerHTML = `<div class="message-content">${content}</div>`;
            messagesDiv.appendChild(div);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function addTypingIndicator() {
            const div = document.createElement('div');
            div.className = 'message bot';
            div.id = 'typingIndicator';
            div.innerHTML = `<div class="message-content typing-indicator"><span></span><span></span><span></span></div>`;
            $('chatMessages').appendChild(div);
            $('chatMessages').scrollTop = 99999;
        }

        function removeTypingIndicator() {
            $('typingIndicator')?.remove();
        }

        function getDataContext(query) {
            const q = query.toLowerCase();
            const allLaws = [...DATA.stateLaws.map(l => ({ ...l, source: 'state' })),
            ...DATA.localLaws.map(l => ({ ...l, source: 'local' })),
            ...(DATA.laws287g || []).map(l => ({ ...l, source: '287g' }))];

            let relevantData = [];
            let summary = {};

            const validStateCodes = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
                'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
                'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
                'VA', 'WA', 'WV', 'WI', 'WY', 'DC', 'PR'];

            const stateNameMap = {
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
                'puerto rico': 'PR', 'district of columbia': 'DC'
            };

            let detectedStates = [];
            for (const [name, code] of Object.entries(stateNameMap)) {
                if (q.includes(name)) detectedStates.push(code);
            }
            const codeMatches = q.matchAll(/(?:in|for|from|of|vs|versus|and|,)\s+([a-z]{2})\b/gi);
            for (const match of codeMatches) {
                if (validStateCodes.includes(match[1].toUpperCase()) && !detectedStates.includes(match[1].toUpperCase())) {
                    detectedStates.push(match[1].toUpperCase());
                }
            }

            const isComparison = q.includes('compare') || q.includes('vs') || q.includes('versus') ||
                (q.includes('and') && detectedStates.length >= 2) || detectedStates.length >= 2;

            if (isComparison && detectedStates.length >= 2) {
                relevantData = allLaws.filter(l => detectedStates.includes(l.state));
                summary.comparisonStates = detectedStates;
                summary.filterType = 'State Comparison';
            } else if (detectedStates.length > 0) {
                relevantData = allLaws.filter(l => l.state === detectedStates[0]);
                summary.filterState = detectedStates[0];
            }

            const yearMatch = q.match(/\b(20\d{2}|19\d{2})\b/);
            if (yearMatch) {
                const year = parseInt(yearMatch[1]);
                if (relevantData.length === 0) relevantData = allLaws.filter(l => l.year === year);
                else relevantData = relevantData.filter(l => l.year === year);
                summary.filterYear = year;
            }

            const isRestrictiveQuery = q.includes('restrictive') || q.includes('unfriendly') ||
                q.includes('anti-immigrant') || q.includes('anti immigrant') ||
                (q.includes('negative') && q.includes('law')) || q.includes('harsh');

            const isSanctuaryQuery = !isRestrictiveQuery && (q.includes('sanctuary') ||
                (q.includes('immigrant') && q.includes('friendly') && !q.includes('unfriendly')) ||
                (q.includes('pro') && q.includes('immigrant')) || q.includes('welcoming'));

            if (!isComparison && isRestrictiveQuery) {
                if (relevantData.length === 0) relevantData = allLaws;
                relevantData = relevantData.filter(l => l.posNeg === 0);
                summary.filterType = 'Restrictive/Negative';
            } else if (!isComparison && isSanctuaryQuery) {
                if (relevantData.length === 0) relevantData = allLaws;
                relevantData = relevantData.filter(l => l.posNeg === 1);
                summary.filterType = 'Sanctuary/Positive';
            }

            if (!isComparison || !q.includes('sanctuary')) {
                if (q.includes('polic') || q.includes('enforcement') || q.includes('detainer') || q.includes('287')) {
                    if (relevantData.length === 0) relevantData = allLaws;
                    relevantData = relevantData.filter(l => l.type === 'P');
                    summary.filterType = 'Policing/Enforcement';
                } else if (q.includes('employment') || q.includes('worker') || q.includes('job')) {
                    if (relevantData.length === 0) relevantData = allLaws;
                    relevantData = relevantData.filter(l => l.type === 'E');
                    summary.filterType = 'Employment';
                } else if (q.includes('benefit')) {
                    if (relevantData.length === 0) relevantData = allLaws;
                    relevantData = relevantData.filter(l => l.type === 'B');
                    summary.filterType = 'Benefits';
                }
            }

            if (relevantData.length === 0) relevantData = allLaws;

            const positive = relevantData.filter(l => l.posNeg === 1).length;
            const negative = relevantData.filter(l => l.posNeg === 0).length;
            const stateLawsCount = relevantData.filter(l => l.source === 'state').length;
            const localLawsCount = relevantData.filter(l => l.source === 'local').length;
            const laws287gCount = relevantData.filter(l => l.source === '287g').length;

            const byYear = {};
            relevantData.forEach(l => {
                if (l.year) {
                    if (!byYear[l.year]) byYear[l.year] = { positive: 0, negative: 0 };
                    if (l.posNeg === 1) byYear[l.year].positive++;
                    else byYear[l.year].negative++;
                }
            });

            const byState = {};
            relevantData.forEach(l => {
                if (l.state) {
                    if (!byState[l.state]) byState[l.state] = { positive: 0, negative: 0, total: 0, stateLevelPositive: 0, stateLevelNegative: 0, localPositive: 0, localNegative: 0 };
                    byState[l.state].total++;
                    if (l.posNeg === 1) {
                        byState[l.state].positive++;
                        if (l.source === 'state') byState[l.state].stateLevelPositive++;
                        else byState[l.state].localPositive++;
                    } else {
                        byState[l.state].negative++;
                        if (l.source === 'state') byState[l.state].stateLevelNegative++;
                        else byState[l.state].localNegative++;
                    }
                }
            });

            const byType = {};
            relevantData.forEach(l => { const t = l.type || 'Unknown'; if (!byType[t]) byType[t] = 0; byType[t]++; });

            let sampleLaws = [];
            if (summary.comparisonStates?.length >= 2) {
                summary.comparisonStates.forEach(sc => {
                    const sl = relevantData.filter(l => l.state === sc);
                    sampleLaws.push(...sl.filter(l => l.posNeg === 1).slice(0, 3).map(l => ({ year: l.year, state: l.state, county: l.county || '', city: l.city || '', source: l.source, type: l.type, direction: 'Positive/Sanctuary', description: l.description?.substring(0, 150) || 'N/A' })));
                    sampleLaws.push(...sl.filter(l => l.posNeg === 0).slice(0, 3).map(l => ({ year: l.year, state: l.state, county: l.county || '', city: l.city || '', source: l.source, type: l.type, direction: 'Restrictive', description: l.description?.substring(0, 150) || 'N/A' })));
                });
            } else {
                const max = summary.filterState ? 25 : 10;
                sampleLaws = relevantData.slice(0, max).map(l => ({ year: l.year, state: l.state, county: l.county || '', city: l.city || '', source: l.source, type: l.type, direction: l.posNeg === 1 ? 'Positive' : 'Restrictive', description: l.description?.substring(0, 150) || 'N/A' }));
            }

            currentResults = relevantData;

            let stateComparison = null;
            if (summary.comparisonStates?.length >= 2) {
                stateComparison = {};
                summary.comparisonStates.forEach(sc => {
                    const sl = relevantData.filter(l => l.state === sc);
                    stateComparison[sc] = { total: sl.length, positive: sl.filter(l => l.posNeg === 1).length, negative: sl.filter(l => l.posNeg === 0).length, byType: {} };
                    sl.forEach(l => { const t = l.type || 'Unknown'; if (!stateComparison[sc].byType[t]) stateComparison[sc].byType[t] = { positive: 0, negative: 0 }; if (l.posNeg === 1) stateComparison[sc].byType[t].positive++; else stateComparison[sc].byType[t].negative++; });
                });
            }

            let localities = null;
            if (summary.filterState || summary.comparisonStates?.length > 0) {
                localities = {};
                relevantData.filter(l => l.source === 'local').forEach(l => {
                    const loc = l.city || l.county || 'Unknown';
                    if (loc && loc !== 'Unknown') {
                        if (!localities[loc]) localities[loc] = { positive: 0, negative: 0, type: l.city ? 'city' : 'county', state: l.state };
                        if (l.posNeg === 1) localities[loc].positive++; else localities[loc].negative++;
                    }
                });
            }

            return { totalLaws: relevantData.length, positive, negative, stateLaws: stateLawsCount, localLaws: localLawsCount, laws287g: laws287gCount, byYear, byState, localities, byType, typeMap: DATA.typeMap, sampleLaws, filters: summary, yearRange: DATA.metadata.yearRange, stateComparison };
        }

        async function sendToGPT(query) {
            const dataContext = getDataContext(query);

            const systemPrompt = `You are an expert analyst for the Immigrant Climate Index (ICI) database. You have access to data about ${dataContext.totalLaws} immigration-related laws in the United States.

The ICI measures the regulatory "climate" for immigrants at federal, state, county, and city levels through a quantitative scoring system:
- Positive laws (posNeg=1): Immigrant-friendly legislation, also known as "sanctuary laws"
- Negative/Restrictive laws (posNeg=0): Restrictive/anti-immigrant legislation

The database contains THREE categories of laws:
- State laws: legislation passed at the state level
- Local laws: city and county ordinances and policies
- 287(g) agreements: formal agreements between local law enforcement agencies and ICE

IMPORTANT RULES:
1. "Sanctuary laws" = positive/immigrant-friendly laws (posNeg=1).
2. "Restrictive laws" = negative laws (posNeg=0).
3. Always report actual numbers even if one state has 0.
4. The byState data includes ALL laws within each state.
5. Use the localities object to name specific cities/counties.
6. Keep responses concise but informative. Use markdown for readability.

Law Types: ${Object.entries(DATA.typeMap).map(([k, v]) => `${k}=${v}`).join(', ')}

Current data context:
${JSON.stringify(dataContext, null, 2)}`;

            const fullMessages = [
                { role: 'system', content: systemPrompt },
                ...conversationHistory,
                { role: 'user', content: query }
            ];

            const response = await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: fullMessages,
                    chatId: currentChatId,
                    newUserContent: query
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || error.error || 'API request failed');
            }

            const data = await response.json();
            return { text: data.content[0].text, dataContext };
        }

        function formatResponse(text) {
            const codeBlocks = [];
            text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
                const idx = codeBlocks.length;
                codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
                return `\x00CODE${idx}\x00`;
            });

            text = text.replace(/(?:(?:\|[^\n]+\|)\n?)+/g, (block) => {
                const rows = block.trim().split('\n');
                const isSep = r => !/[a-zA-Z0-9]/.test(r) && r.includes('|') && r.includes('-');
                const sepIdx = rows.findIndex(isSep);
                let html = '<table>';
                if (sepIdx === 1) {
                    const hCells = rows[0].split('|').slice(1, -1);
                    html += '<thead><tr>' + hCells.map(c => `<th>${c.trim()}</th>`).join('') + '</tr></thead><tbody>';
                    for (let i = 2; i < rows.length; i++) {
                        if (!rows[i].trim()) continue;
                        const cells = rows[i].split('|').slice(1, -1);
                        html += '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
                    }
                } else {
                    html += '<tbody>';
                    rows.filter(r => r.trim() && !isSep(r)).forEach(row => {
                        const cells = row.split('|').slice(1, -1);
                        html += '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
                    });
                }
                html += '</tbody></table>';
                return html;
            });

            text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
            text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
            text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');

            text = text.replace(/^---+$/gm, '<hr>');

            text = text.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
            text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');

            text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');

            text = text.replace(/((?:^[ \t]*[-*] .+(?:\n|$))+)/gm, (block) => {
                const items = block.trim().split('\n').map(l =>
                    `<li>${l.replace(/^[ \t]*[-*] /, '')}</li>`).join('');
                return `<ul>${items}</ul>`;
            });

            text = text.replace(/((?:^\d+\. .+(?:\n|$))+)/gm, (block) => {
                const items = block.trim().split('\n').map(l =>
                    `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
                return `<ol>${items}</ol>`;
            });

            const parts = text.split(/\n{2,}/);
            const wrapped = parts.map(b => {
                const t = b.trim();
                if (!t) return '';
                if (/^<(?:h[1-6]|ul|ol|pre|table|hr|blockquote)/.test(t) || t.includes('\x00CODE')) return t;
                return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
            }).join('\n');

            return wrapped.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[+i]);
        }

        function setVizOpen(open) {
            vizOpen = open;
            const section = $('resultsSection');
            const bar = $('vizToggleBar');
            const badge = $('vizBadge');
            if (open) {
                section.classList.add('active');
                bar.classList.add('open');
                badge.style.display = 'none';
            } else {
                section.classList.remove('active');
                bar.classList.remove('open');
            }
        }

        function showResultsVisualization(dataContext) {
            if (dataContext.totalLaws < 2) return;
            pendingVizContext = dataContext;
            $('vizBadge').style.display = 'inline-flex';
            updateResultsTable(currentResults.slice(0, 50));
        }

        function renderViz(dataContext) {
            if (!dataContext) return;
            $('resultsTitle').textContent =
                `Data: ${dataContext.totalLaws} laws` +
                (dataContext.filters.filterState ? ` in ${dataContext.filters.filterState}` : '') +
                (dataContext.filters.filterYear ? ` (${dataContext.filters.filterYear})` : '');

            if (resultsChart) resultsChart.destroy();
            const ctx = $('resultsChart').getContext('2d');
            const years = Object.keys(dataContext.byYear).sort();

            if (years.length > 3) {
                resultsChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: years,
                        datasets: [
                            { label: 'Positive', data: years.map(y => dataContext.byYear[y].positive), borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.12)', fill: true },
                            { label: 'Restrictive', data: years.map(y => dataContext.byYear[y].negative), borderColor: '#EF4444', backgroundColor: 'rgba(239,68,68,0.12)', fill: true },
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } }
                });
            } else {
                const states = Object.keys(dataContext.byState).sort((a, b) => (dataContext.byState[b].positive + dataContext.byState[b].negative) - (dataContext.byState[a].positive + dataContext.byState[a].negative)).slice(0, 15);
                resultsChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: states,
                        datasets: [
                            { label: 'Positive', data: states.map(s => dataContext.byState[s].positive), backgroundColor: 'rgba(16,185,129,0.75)' },
                            { label: 'Restrictive', data: states.map(s => dataContext.byState[s].negative), backgroundColor: 'rgba(239,68,68,0.75)' },
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { x: { stacked: true }, y: { stacked: true } } }
                });
            }
        }

        function updateResultsTable(laws) {
            const div = $('resultsTable');
            let html = `<table><thead><tr><th>Year</th><th>State</th><th>Type</th><th>Direction</th><th>Description</th></tr></thead><tbody>`;
            laws.forEach(law => {
                const badge = law.posNeg === 1
                    ? '<span class="positive-badge">Positive</span>'
                    : '<span class="negative-badge">Restrictive</span>';
                const desc = law.description ? law.description.substring(0, 100) + '…' : '-';
                html += `<tr><td>${law.year || '-'}</td><td>${law.state || '-'}</td><td>${law.type || '-'}</td><td>${badge}</td><td class="truncate" title="${law.description || ''}">${desc}</td></tr>`;
            });
            html += '</tbody></table>';
            if (currentResults.length > 50) {
                html += `<p style="margin-top:8px;color:var(--text-muted);font-size:0.78rem;">Showing 50 of ${currentResults.length} results</p>`;
            }
            div.innerHTML = html;
        }

        async function handleSend() {
            const input = $('chatInput');
            const query = input.value.trim();
            if (!query) return;

            if (!currentChatId) {
                await createNewChat();
            }

            addMessage('user', query);
            input.value = '';
            input.style.height = 'auto';
            input.disabled = true;
            $('sendBtn').disabled = true;
            addTypingIndicator();

            try {
                const result = await sendToGPT(query);
                removeTypingIndicator();
                addMessage('bot', formatResponse(result.text));

                conversationHistory.push({ role: 'user', content: query });
                conversationHistory.push({ role: 'assistant', content: result.text });

                showResultsVisualization(result.dataContext);
                updateDynamicSuggestions();
                loadChatList();
            } catch (error) {
                removeTypingIndicator();
                addMessage('bot', `<strong>Error:</strong> ${error.message}. Please try again.`);
            } finally {
                input.disabled = false;
                $('sendBtn').disabled = false;
                input.focus();
            }
        }

        function setSidebarCollapsed(collapsed) {
            root.classList.toggle('sidebar-collapsed', collapsed);
            localStorage.setItem('ici-sidebar', collapsed ? '0' : '1');
        }

        function getEmptyStateHTML() {
            return `<div class="empty-state" id="emptyState">
                <p class="empty-state-title">What would you like to explore?</p>
                <div class="empty-cards">
                    <button class="empty-card" data-query="What are the main trends in immigration legislation since 2005?">What are the main trends in immigration legislation since 2005?</button>
                    <button class="empty-card" data-query="Which states have the most immigrant-friendly policies?">Which states have the most immigrant-friendly policies?</button>
                    <button class="empty-card" data-query="Explain the Trump Effect on immigration legislation in 2017">Explain the Trump Effect on immigration legislation in 2017</button>
                    <button class="empty-card" data-query="Compare sanctuary policies in California vs Texas">Compare sanctuary policies in California vs Texas</button>
                </div>
            </div>`;
        }

        function attachEmptyCardListeners() {
            root.querySelectorAll('.empty-card').forEach(btn => {
                btn.addEventListener('click', () => {
                    const input = $('chatInput');
                    input.value = btn.dataset.query;
                    input.dispatchEvent(new Event('input'));
                    input.focus();
                    handleSend();
                });
            });
        }

        function showDeleteModal(chatId, chatName) {
            _pendingDeleteId = chatId;
            $('deleteModalChatName').innerHTML = chatName
                ? `This will permanently delete <strong>${chatName}</strong>.`
                : 'This will permanently delete this chat.';
            $('deleteModal').classList.add('open');
        }

        function closeDeleteModal() {
            $('deleteModal').classList.remove('open');
            _pendingDeleteId = null;
        }

        // ── Event wiring ──────────────────────────────────────────────────────
        const vizToggleBar = $('vizToggleBar');
        const vizHideBtn = $('vizHideBtn');
        const sendBtn = $('sendBtn');
        const chatInput = $('chatInput');
        const newChatBtn = $('newChatBtn');
        const sidebarCollapseBtn = $('sidebarCollapseBtn');
        const iciOpenBtn = $('iciOpenBtn');
        const deleteModal = $('deleteModal');
        const deleteCancelBtn = $('deleteCancelBtn');
        const deleteConfirmBtn = $('deleteConfirmBtn');
        const examplesBtn = $('examplesBtn');
        const examplesMenu = $('examplesMenu');

        const onVizToggle = () => {
            const opening = !vizOpen;
            setVizOpen(opening);
            if (opening && pendingVizContext) renderViz(pendingVizContext);
        };
        const onVizHide = (e) => { e.stopPropagation(); setVizOpen(false); };
        const onKeydownInput = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
        };
        const onSidebarCollapseClick = () => setSidebarCollapsed(!root.classList.contains('sidebar-collapsed'));
        const onIciOpenClick = () => setSidebarCollapsed(false);
        const onDeleteCancel = () => closeDeleteModal();
        const onModalOverlayClick = (e) => { if (e.target === deleteModal) closeDeleteModal(); };
        const onDeleteConfirm = async () => {
            if (_pendingDeleteId) await deleteChat(_pendingDeleteId);
            closeDeleteModal();
        };
        const onExamplesBtnClick = (e) => {
            e.stopPropagation();
            const open = examplesMenu.classList.toggle('open');
            examplesBtn.classList.toggle('open', open);
        };
        const onDocumentClick = () => {
            examplesMenu.classList.remove('open');
            examplesBtn.classList.remove('open');
        };
        const onTextareaInput = () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
        };

        vizToggleBar.addEventListener('click', onVizToggle);
        vizHideBtn.addEventListener('click', onVizHide);
        sendBtn.addEventListener('click', handleSend);
        chatInput.addEventListener('keydown', onKeydownInput);
        chatInput.addEventListener('input', onTextareaInput);
        newChatBtn.addEventListener('click', startNewChat);
        sidebarCollapseBtn.addEventListener('click', onSidebarCollapseClick);
        iciOpenBtn.addEventListener('click', onIciOpenClick);
        deleteCancelBtn.addEventListener('click', onDeleteCancel);
        deleteModal.addEventListener('click', onModalOverlayClick);
        deleteConfirmBtn.addEventListener('click', onDeleteConfirm);
        examplesBtn.addEventListener('click', onExamplesBtnClick);
        document.addEventListener('click', onDocumentClick);

        attachChipListeners();
        attachExampleListeners();
        attachEmptyCardListeners();

        // Mobile defaults to the chats panel closed (it overlays the chat
        // there); desktop restores the user's saved preference. Added directly
        // as a class so the mobile default doesn't overwrite that preference.
        if (localStorage.getItem('ici-sidebar') === '0' || window.matchMedia('(max-width: 900px)').matches) {
            root.classList.add('sidebar-collapsed');
        }

        loadData();
        loadChatList();

        return () => {
            vizToggleBar.removeEventListener('click', onVizToggle);
            vizHideBtn.removeEventListener('click', onVizHide);
            sendBtn.removeEventListener('click', handleSend);
            chatInput.removeEventListener('keydown', onKeydownInput);
            chatInput.removeEventListener('input', onTextareaInput);
            newChatBtn.removeEventListener('click', startNewChat);
            sidebarCollapseBtn.removeEventListener('click', onSidebarCollapseClick);
            iciOpenBtn.removeEventListener('click', onIciOpenClick);
            deleteCancelBtn.removeEventListener('click', onDeleteCancel);
            deleteModal.removeEventListener('click', onModalOverlayClick);
            deleteConfirmBtn.removeEventListener('click', onDeleteConfirm);
            examplesBtn.removeEventListener('click', onExamplesBtnClick);
            document.removeEventListener('click', onDocumentClick);
            if (resultsChart) resultsChart.destroy();
        };
    }, []);

    return (
        <div className="assistant" ref={rootRef}>
            <div className="history-panel" id="historyPanel">
                <div className="history-header">
                    <span className="history-title">Chats</span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button className="new-chat-btn" id="newChatBtn">+ New</button>
                        <button className="sidebar-collapse-btn" id="sidebarCollapseBtn" title="Hide sidebar">‹</button>
                    </div>
                </div>
                <div className="history-list" id="historyList">
                    <div className="history-empty">No chats yet.<br />Start a conversation!</div>
                </div>
            </div>

            <div className="main-wrapper">

                <div className="top-bar">
                    <div className="top-bar-left">
                        <button className="ici-open-btn" id="iciOpenBtn" title="Open sidebar">ICI</button>
                        <Link to="/" className="back-link">← Home</Link>
                        <a href={withBase('research.html')} className="back-link">Research</a>
                    </div>
                    <div className="top-bar-right">
                        <button className="viz-toggle-btn" id="vizToggleBar" title="Toggle data visualization">
                            📊 Chart
                            <span className="viz-badge" id="vizBadge" style={{ display: 'none' }}>New data</span>
                            <span id="vizChevron" style={{ display: 'none' }} />
                        </button>
                        <div className="examples-dropdown">
                            <button className="examples-btn" id="examplesBtn">Examples ▾</button>
                            <div className="examples-menu" id="examplesMenu">
                                <ul className="example-list" id="exampleList">
                                    <li data-query="How did legislation change after 2017?">How did legislation change after 2017?</li>
                                    <li data-query="Which counties have sanctuary policies?">Which counties have sanctuary policies?</li>
                                    <li data-query="What's the breakdown of law types?">What's the breakdown of law types?</li>
                                    <li data-query="Show me employment laws in Florida">Show me employment laws in Florida</li>
                                    <li data-query="Which states have the most 287(g) agreements?">Which states have the most 287(g) agreements?</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="results-section" id="resultsSection">
                    <div className="results-header">
                        <h3 id="resultsTitle">Results</h3>
                        <button className="viz-hide-btn" id="vizHideBtn">Hide ✕</button>
                    </div>
                    <div className="results-chart"><canvas id="resultsChart" /></div>
                    <div id="resultsTable" />
                </div>

                <div className="container">
                    <div className="main-content">
                        <div className="chat-section">
                            <div className="chat-messages" id="chatMessages">
                                <div className="empty-state" id="emptyState">
                                    <p className="empty-state-title">What would you like to explore?</p>
                                    <div className="empty-cards">
                                        <button className="empty-card" data-query="What are the main trends in immigration legislation since 2005?">What are the main trends in immigration legislation since 2005?</button>
                                        <button className="empty-card" data-query="Which states have the most immigrant-friendly policies?">Which states have the most immigrant-friendly policies?</button>
                                        <button className="empty-card" data-query="Explain the Trump Effect on immigration legislation in 2017">Explain the Trump Effect on immigration legislation in 2017</button>
                                        <button className="empty-card" data-query="Compare sanctuary policies in California vs Texas">Compare sanctuary policies in California vs Texas</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="input-zone">
                    <div className="pill-input">
                        <button className="pill-add-btn" title="Add context" tabIndex={-1}>+</button>
                        <textarea className="pill-textarea" id="chatInput" placeholder="Ask about immigration legislation..." rows={1} />
                        <button className="pill-send-btn" id="sendBtn" title="Send">↑</button>
                    </div>
                    <div className="suggestions" id="quickChips" />
                </div>

            </div>

            <div className="modal-overlay" id="deleteModal">
                <div className="modal-card">
                    <p className="modal-title">Delete chat?</p>
                    <div className="modal-body">
                        <span id="deleteModalChatName" />
                        <p className="modal-warning">This chat can't be recovered once deleted.</p>
                    </div>
                    <div className="modal-actions">
                        <button className="modal-cancel-btn" id="deleteCancelBtn">Cancel</button>
                        <button className="modal-delete-btn" id="deleteConfirmBtn">Delete</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

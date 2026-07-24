import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Chart from 'chart.js/auto';
import { withBase } from '../utils/withBase';
import { STATE_NAME_TO_CODE, VALID_STATE_CODES } from '../lib/usStates';
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

        // Same-origin by default: one Node server now serves this app AND the API
        // (Path 2). Only set VITE_API_BASE at build time if the front-end is hosted
        // separately from the backend (e.g. GitHub Pages -> a hosted backend URL).
        const API_BASE = import.meta.env.VITE_API_BASE || '';

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
        let chatCache = [];        // last-fetched chat list, for the ⋯ menu
        let chatMenuTarget = null; // chat (or {__project}) the open ⋯ menu belongs to
        let projectTarget = null;  // chat the project modal is editing
        let archivedOpen = false;  // archived section expanded?
        let currentProjectView = null;   // single-project page currently open, or null
        let projectsOverviewOpen = false; // "Projects" overview list currently open?
        let projectModalMode = 'assign'; // 'assign' (chat → project) | 'renameproj'
        let projectRenameOld = null;     // original name while renaming a project
        let _deleteMode = 'chat';        // delete modal target: 'chat' | 'project'

        const projectNames = () =>
            [...new Set(chatCache.filter(c => c.project).map(c => c.project))].sort();

        const esc = (s) => String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        const DEFAULT_SUGGESTIONS = [
            { label: 'Trends', query: 'What are the main trends in immigration legislation since 2005?' },
            { label: 'Friendly States', query: 'Which states have the most immigrant-friendly policies?' },
            { label: 'Trump Effect', query: 'Explain the Trump Effect on immigration legislation' },
            { label: 'CA vs TX', query: 'Compare sanctuary policies in California vs Texas' },
            { label: 'Law Types', query: 'What types of laws are most common?' },
            { label: 'Policing Laws', query: 'Analyze the policing and enforcement laws' },
        ];

        // State name↔code data comes from the shared module (ISSUE-017).
        const STATE_NAMES = STATE_NAME_TO_CODE;

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

        function chatItemHTML(c) {
            const isActive = c.id === currentChatId;
            return `
            <div class="chat-item ${isActive ? 'active' : ''}${c.archived ? ' is-archived' : ''}" data-id="${c.id}">
                ${c.pinned ? '<span class="pin-mark" title="Pinned">📌</span>' : ''}
                <span class="chat-item-name" title="${esc(c.name)}">${esc(c.name)}</span>
                ${c.project ? `<span class="item-project-tag" title="Project: ${esc(c.project)}">${esc(c.project)}</span>` : ''}
                <div class="chat-item-actions">
                    <button class="chat-action-btn menu-btn" data-id="${c.id}" title="Options">⋯</button>
                </div>
            </div>`;
        }

        // Sidebar stays flat and minimal — Pinned, then a plain "Recents" list,
        // then a collapsible Archived section. Projects are deliberately NOT
        // expanded inline here (that used to make the sidebar unreadable);
        // browsing a project's chats happens on its own page via the
        // "Projects" nav item instead. A small tag still marks which project a
        // chat belongs to, without grouping/expanding anything.
        function renderChatList(chats) {
            chatCache = chats;
            const el = $('historyList');
            if (!chats.length) {
                el.innerHTML = '<div class="history-empty">No chats yet.<br>Start a conversation!</div>';
            } else {
                const activeChats = chats.filter(c => !c.archived);
                const archivedChats = chats.filter(c => c.archived);
                const pinnedChats = activeChats.filter(c => c.pinned);
                const recentChats = activeChats.filter(c => !c.pinned);

                let html = '';
                if (pinnedChats.length) {
                    html += '<div class="list-section">Pinned</div>' + pinnedChats.map(chatItemHTML).join('');
                }
                html += '<div class="list-section">Recents</div>';
                html += recentChats.length ? recentChats.map(chatItemHTML).join('') : '<div class="history-empty small">No recent chats</div>';
                if (archivedChats.length) {
                    html += `<button class="archived-toggle${archivedOpen ? ' open' : ''}" id="archivedToggle">
                                <span>Archived (${archivedChats.length})</span><span class="chev">▾</span>
                             </button>
                             <div class="archived-list${archivedOpen ? ' open' : ''}">` +
                            archivedChats.map(chatItemHTML).join('') + '</div>';
                }
                el.innerHTML = html;

                root.querySelectorAll('.chat-item').forEach(item => {
                    item.addEventListener('click', (e) => {
                        if (e.target.closest('.chat-action-btn')) return;
                        loadChatFromDB(item.dataset.id);
                    });
                });

                root.querySelectorAll('.menu-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const chat = chatCache.find(c => c.id === btn.dataset.id);
                        if (chat) openChatMenu(btn, chat);
                    });
                });

                const archToggle = $('archivedToggle');
                if (archToggle) archToggle.addEventListener('click', () => {
                    archivedOpen = !archivedOpen;
                    renderChatList(chatCache);
                });
            }

            // Keep whichever secondary view is open in sync with the new data
            if (currentProjectView) renderProjectChatList();
            if (projectsOverviewOpen) renderProjectsOverview();
            if ($('searchModal').classList.contains('open')) renderSearchResults($('searchInput').value);
        }

        async function patchChat(chatId, fields) {
            try {
                await fetch(`${API_BASE}/api/chats/${chatId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(fields)
                });
            } catch { /* offline */ }
        }

        // ── ⋯ options menu (pin / project / archive / rename / delete) ───────
        function positionMenu(btnEl) {
            const menu = $('chatMenu');
            const r = btnEl.getBoundingClientRect();
            menu.style.left = Math.min(r.left, window.innerWidth - 205) + 'px';
            menu.style.top = (r.bottom + 6) + 'px';
            menu.classList.add('open');
            // flip upwards if the menu would run off the bottom of the screen
            requestAnimationFrame(() => {
                const mh = menu.offsetHeight;
                if (r.bottom + 6 + mh > window.innerHeight - 8) {
                    menu.style.top = Math.max(8, r.top - mh - 6) + 'px';
                }
            });
        }

        function openChatMenu(btnEl, chat) {
            chatMenuTarget = chat;
            $('chatMenu').innerHTML = `
                <button data-act="pin">${chat.pinned ? 'Unpin' : 'Pin chat'}</button>
                <button data-act="project">${chat.project ? 'Change project' : 'Add to project'}</button>
                ${chat.project ? '<button data-act="unproject">Remove from project</button>' : ''}
                <button data-act="archive">${chat.archived ? 'Unarchive' : 'Archive'}</button>
                <button data-act="rename">Rename</button>
                <div class="menu-sep"></div>
                <button data-act="delete" class="danger">Delete</button>`;
            positionMenu(btnEl);
        }

        function openProjectMenu(btnEl) {
            chatMenuTarget = { __project: currentProjectView };
            $('chatMenu').innerHTML = `
                <button data-act="renameproj">Rename project</button>
                <div class="menu-sep"></div>
                <button data-act="deleteproj" class="danger">Delete project</button>`;
            positionMenu(btnEl);
        }

        function hideChatMenu() {
            $('chatMenu').classList.remove('open');
            chatMenuTarget = null;
        }

        async function onChatMenuAction(e) {
            const act = e.target.dataset.act;
            if (!act || !chatMenuTarget) return;
            e.stopPropagation();

            if (chatMenuTarget.__project) {
                const name = chatMenuTarget.__project;
                hideChatMenu();
                if (act === 'renameproj') showProjectRenameModal(name);
                else if (act === 'deleteproj') showDeleteProjectModal(name);
                return;
            }

            const chat = chatMenuTarget;
            hideChatMenu();

            if (act === 'pin')            { await patchChat(chat.id, { pinned: !chat.pinned }); await loadChatList(); }
            else if (act === 'archive')   { await patchChat(chat.id, { archived: !chat.archived }); await loadChatList(); }
            else if (act === 'unproject') { await patchChat(chat.id, { project: null }); await loadChatList(); }
            else if (act === 'project')   { showProjectModal(chat); }
            else if (act === 'rename')    { startRename(chat.id); }
            else if (act === 'delete')    { showDeleteModal(chat.id, chat.name); }
        }

        // ── project modal — assign a chat, or rename a whole project ─────────
        // The existing-projects dropdown is rebuilt from the live chat list on
        // every open, so renames and deletions are always reflected.
        function populateProjectSelect(selected) {
            const sel = $('projectSelect');
            const names = projectNames();
            sel.innerHTML =
                '<option value="">No project</option>' +
                names.map(n => `<option value="${esc(n)}"${n === selected ? ' selected' : ''}>${esc(n)}</option>`).join('') +
                '<option value="__new__">＋ New project…</option>';
            if (!selected && !names.length) sel.value = '__new__';
        }

        function syncProjectInputVisibility() {
            const isNew = $('projectSelect').value === '__new__';
            $('projectInput').style.display = isNew ? 'block' : 'none';
            if (isNew) setTimeout(() => $('projectInput').focus(), 40);
        }

        function showProjectModal(chat) {
            projectTarget = chat;
            projectModalMode = 'assign';
            $('projectModalTitle').textContent = chat.project ? 'Change project' : 'Add to project';
            $('projectModalHint').textContent = 'Pick an existing project or create a new one. Chats in the same project are grouped together.';
            $('projectSelect').style.display = 'block';
            populateProjectSelect(chat.project || '');
            $('projectInput').value = '';
            syncProjectInputVisibility();
            $('projectModal').classList.add('open');
        }

        function showProjectRenameModal(name) {
            projectModalMode = 'renameproj';
            projectRenameOld = name;
            $('projectModalTitle').textContent = 'Rename project';
            $('projectModalHint').textContent = 'The new name applies to every chat in this project.';
            $('projectSelect').style.display = 'none';
            $('projectInput').style.display = 'block';
            $('projectInput').value = name;
            $('projectModal').classList.add('open');
            setTimeout(() => { $('projectInput').focus(); $('projectInput').select(); }, 60);
        }

        function closeProjectModal() {
            $('projectModal').classList.remove('open');
            projectTarget = null;
            projectRenameOld = null;
        }

        async function saveProject() {
            if (projectModalMode === 'renameproj') {
                const newName = $('projectInput').value.trim();
                if (!newName || !projectRenameOld) { closeProjectModal(); return; }
                try {
                    await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectRenameOld)}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: newName })
                    });
                } catch { /* offline */ }
                if (currentProjectView === projectRenameOld) {
                    currentProjectView = newName;
                    $('projectViewName').textContent = newName;
                    $('projectNewChatInput').placeholder = `New chat in ${newName}`;
                }
                closeProjectModal();
                await loadChatList();
                return;
            }

            if (!projectTarget) return;
            const sel = $('projectSelect').value;
            const value = sel === '__new__' ? $('projectInput').value.trim() : sel;
            await patchChat(projectTarget.id, { project: value || null });
            closeProjectModal();
            await loadChatList();
        }

        // ── project page view ─────────────────────────────────────────────────
        function showProjectView(name) {
            closeProjectsOverview();
            currentProjectView = name;
            $('projectViewName').textContent = name;
            $('projectNewChatInput').placeholder = `New chat in ${name}`;
            $('projectNewChatInput').value = '';
            renderProjectChatList();
            root.classList.add('project-open');
            setVizOpen(false);
        }

        function closeProjectView() {
            currentProjectView = null;
            root.classList.remove('project-open');
        }

        // Closes whichever secondary full-page view (single project or the
        // projects overview) is currently open. Used whenever the user starts
        // or opens a chat, so only one view is ever visible at a time.
        function closeSpecialViews() {
            closeProjectView();
            closeProjectsOverview();
        }

        // ── projects overview — "Projects" nav item ───────────────────────────
        function showProjectsOverview() {
            closeProjectView();
            projectsOverviewOpen = true;
            renderProjectsOverview();
            root.classList.add('projects-open');
            setVizOpen(false);
        }

        function closeProjectsOverview() {
            projectsOverviewOpen = false;
            root.classList.remove('projects-open');
        }

        function renderProjectsOverview() {
            const names = projectNames();
            const el = $('projectsList');
            if (!names.length) {
                el.innerHTML = `
                    <div class="project-empty">
                        <p class="pe-title">No projects yet</p>
                        <p class="pe-sub">Open a chat's ⋯ menu and choose "Add to project" to create one</p>
                    </div>`;
                return;
            }
            el.innerHTML = names.map(n => {
                const count = chatCache.filter(c => c.project === n).length;
                return `
                <button class="project-card" data-name="${esc(n)}">
                    <svg class="project-folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>
                    <span class="project-card-name">${esc(n)}</span>
                    <span class="project-card-count">${count} chat${count === 1 ? '' : 's'}</span>
                </button>`;
            }).join('');
            el.querySelectorAll('.project-card').forEach(btn => {
                btn.addEventListener('click', () => showProjectView(btn.dataset.name));
            });
        }

        // ── search chats — "Search chats" nav item ────────────────────────────
        function openSearchModal() {
            $('searchInput').value = '';
            renderSearchResults('');
            $('searchModal').classList.add('open');
            setTimeout(() => $('searchInput').focus(), 60);
        }

        function closeSearchModal() {
            $('searchModal').classList.remove('open');
        }

        function renderSearchResults(query) {
            const q = query.trim().toLowerCase();
            const pool = chatCache.filter(c => !c.archived);
            const results = q ? pool.filter(c => c.name.toLowerCase().includes(q)) : pool;
            const el = $('searchResults');
            if (!results.length) {
                el.innerHTML = `<div class="search-empty">${q ? 'No chats found' : 'No chats yet'}</div>`;
                return;
            }
            el.innerHTML = results.slice(0, 40).map(c => `
                <button class="search-result" data-id="${c.id}">
                    <span class="sr-name">${c.pinned ? '📌 ' : ''}${esc(c.name)}</span>
                    ${c.project ? `<span class="sr-project">${esc(c.project)}</span>` : ''}
                </button>`).join('');
            el.querySelectorAll('.search-result').forEach(btn => {
                btn.addEventListener('click', () => {
                    loadChatFromDB(btn.dataset.id);
                    closeSearchModal();
                });
            });
        }

        function renderProjectChatList() {
            const listEl = $('projectChatList');
            const chats = chatCache.filter(c => c.project === currentProjectView);
            if (!chats.length) {
                listEl.innerHTML = `
                    <div class="project-empty">
                        <p class="pe-title">No chats yet</p>
                        <p class="pe-sub">Chats in ${esc(currentProjectView || '')} will live here</p>
                    </div>`;
                return;
            }
            listEl.innerHTML = chats.map(c => `
                <div class="project-chat-row${c.archived ? ' is-archived' : ''}" data-id="${c.id}">
                    <div class="row-main">
                        <span class="row-name">${c.pinned ? '📌 ' : ''}${esc(c.name)}</span>
                        <span class="row-date">${new Date(c.updated_at).toLocaleDateString()}</span>
                    </div>
                    <button class="chat-action-btn menu-btn" data-id="${c.id}" title="Options">⋯</button>
                </div>`).join('');

            listEl.querySelectorAll('.project-chat-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('.chat-action-btn')) return;
                    loadChatFromDB(row.dataset.id);
                });
            });
            listEl.querySelectorAll('.menu-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const chat = chatCache.find(c => c.id === btn.dataset.id);
                    if (chat) openChatMenu(btn, chat);
                });
            });
        }

        // "New chat in <project>": creates the chat inside the project; if a
        // message was typed it is sent immediately in the new chat.
        async function startChatInProject() {
            if (!currentProjectView) return;
            const project = currentProjectView;
            const text = $('projectNewChatInput').value.trim();
            const id = await createNewChat();
            await patchChat(id, { project });
            conversationHistory = [];
            currentResults = [];
            $('chatMessages').innerHTML = getEmptyStateHTML();
            attachEmptyCardListeners();
            closeProjectView();
            await loadChatList();
            if (text) {
                $('projectNewChatInput').value = '';
                $('chatInput').value = text;
                await handleSend();
            } else {
                $('chatInput').focus();
            }
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

                closeSpecialViews();
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
            closeSpecialViews();
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
            // User text is raw and untrusted — escape it. Bot content is already
            // HTML produced by formatResponse() (itself sanitized), so pass through.
            const body = type === 'user' ? esc(content) : content;
            div.innerHTML = `<div class="message-content">${body}</div>`;
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

            const validStateCodes = VALID_STATE_CODES;
            const stateNameMap = STATE_NAME_TO_CODE;

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
            // Stage 5: the SERVER owns retrieval — it runs a Claude tool-use loop
            // over the Python pipeline (structured filters + ICI scoring + semantic
            // search). The client no longer builds a system prompt or injects a
            // regex-guessed data blob; it just sends the conversation. This fixes
            // ISSUE-001/002/003/004/005 structurally. `getDataContext` is still
            // computed locally, but only to drive the optional chart panel.
            const dataContext = getDataContext(query);

            const fullMessages = [
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
            // Escape all HTML metacharacters FIRST so any literal markup the model
            // emits (or that arrives via data-context) is rendered inert. Every tag
            // below this line is generated by us from a known markdown subset, so
            // the output stays safe without a heavyweight sanitizer. (ISSUE-011)
            text = esc(text);
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
                const desc = law.description ? esc(law.description.substring(0, 100)) + '…' : '-';
                html += `<tr><td>${esc(law.year || '-')}</td><td>${esc(law.state || '-')}</td><td>${esc(law.type || '-')}</td><td>${badge}</td><td class="truncate" title="${esc(law.description || '')}">${desc}</td></tr>`;
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
            _deleteMode = 'chat';
            _pendingDeleteId = chatId;
            $('deleteModalTitle').textContent = 'Delete chat?';
            $('deleteModalChatName').innerHTML = chatName
                ? `This will permanently delete <strong>${esc(chatName)}</strong>.`
                : 'This will permanently delete this chat.';
            $('deleteModalWarning').textContent = "This chat can't be recovered once deleted.";
            $('deleteModal').classList.add('open');
        }

        function showDeleteProjectModal(name) {
            _deleteMode = 'project';
            _pendingDeleteId = name;
            $('deleteModalTitle').textContent = 'Delete project?';
            $('deleteModalChatName').innerHTML = `This will delete the project <strong>${esc(name)}</strong>.`;
            $('deleteModalWarning').textContent = 'Chats inside are kept — they just leave the project.';
            $('deleteModal').classList.add('open');
        }

        function closeDeleteModal() {
            $('deleteModal').classList.remove('open');
            _pendingDeleteId = null;
            _deleteMode = 'chat';
        }

        // ── Event wiring ──────────────────────────────────────────────────────
        const vizToggleBar = $('vizToggleBar');
        const vizHideBtn = $('vizHideBtn');
        const sendBtn = $('sendBtn');
        const chatInput = $('chatInput');
        const newChatNavBtn = $('newChatNavBtn');
        const searchChatsBtn = $('searchChatsBtn');
        const projectsNavBtn = $('projectsNavBtn');
        const searchModal = $('searchModal');
        const searchInput = $('searchInput');
        const sidebarCollapseBtn = $('sidebarCollapseBtn');
        const iciOpenBtn = $('iciOpenBtn');
        const deleteModal = $('deleteModal');
        const deleteCancelBtn = $('deleteCancelBtn');
        const deleteConfirmBtn = $('deleteConfirmBtn');
        const examplesBtn = $('examplesBtn');
        const examplesMenu = $('examplesMenu');
        const chatMenuEl = $('chatMenu');
        const projectModal = $('projectModal');
        const projectInput = $('projectInput');
        const projectSelect = $('projectSelect');
        const projectCancelBtn = $('projectCancelBtn');
        const projectSaveBtn = $('projectSaveBtn');
        const projectMenuBtn = $('projectMenuBtn');
        const projectNewChatInput = $('projectNewChatInput');
        const projectNewChatSend = $('projectNewChatSend');

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
            if (_pendingDeleteId) {
                if (_deleteMode === 'project') {
                    try {
                        await fetch(`${API_BASE}/api/projects/${encodeURIComponent(_pendingDeleteId)}`, { method: 'DELETE' });
                    } catch { /* offline */ }
                    await loadChatList();
                    showProjectsOverview();
                } else {
                    await deleteChat(_pendingDeleteId);
                }
            }
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
            hideChatMenu();
        };
        const onProjectInputKeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); saveProject(); }
            if (e.key === 'Escape') closeProjectModal();
        };
        const onProjectOverlayClick = (e) => { if (e.target === projectModal) closeProjectModal(); };
        const onProjectSelectChange = () => syncProjectInputVisibility();
        const onProjectMenuBtnClick = (e) => { e.stopPropagation(); openProjectMenu(projectMenuBtn); };
        const onProjectNewChatKeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); startChatInProject(); }
        };
        const onSearchOverlayClick = (e) => { if (e.target === searchModal) closeSearchModal(); };
        const onSearchInput = () => renderSearchResults(searchInput.value);
        const onSearchKeydown = (e) => { if (e.key === 'Escape') closeSearchModal(); };
        const onTextareaInput = () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
        };

        vizToggleBar.addEventListener('click', onVizToggle);
        vizHideBtn.addEventListener('click', onVizHide);
        sendBtn.addEventListener('click', handleSend);
        chatInput.addEventListener('keydown', onKeydownInput);
        chatInput.addEventListener('input', onTextareaInput);
        newChatNavBtn.addEventListener('click', startNewChat);
        searchChatsBtn.addEventListener('click', openSearchModal);
        projectsNavBtn.addEventListener('click', showProjectsOverview);
        searchModal.addEventListener('click', onSearchOverlayClick);
        searchInput.addEventListener('input', onSearchInput);
        searchInput.addEventListener('keydown', onSearchKeydown);
        sidebarCollapseBtn.addEventListener('click', onSidebarCollapseClick);
        iciOpenBtn.addEventListener('click', onIciOpenClick);
        deleteCancelBtn.addEventListener('click', onDeleteCancel);
        deleteModal.addEventListener('click', onModalOverlayClick);
        deleteConfirmBtn.addEventListener('click', onDeleteConfirm);
        examplesBtn.addEventListener('click', onExamplesBtnClick);
        document.addEventListener('click', onDocumentClick);
        chatMenuEl.addEventListener('click', onChatMenuAction);
        projectCancelBtn.addEventListener('click', closeProjectModal);
        projectSaveBtn.addEventListener('click', saveProject);
        projectInput.addEventListener('keydown', onProjectInputKeydown);
        projectModal.addEventListener('click', onProjectOverlayClick);
        projectSelect.addEventListener('change', onProjectSelectChange);
        projectMenuBtn.addEventListener('click', onProjectMenuBtnClick);
        projectNewChatInput.addEventListener('keydown', onProjectNewChatKeydown);
        projectNewChatSend.addEventListener('click', startChatInProject);

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
            newChatNavBtn.removeEventListener('click', startNewChat);
            searchChatsBtn.removeEventListener('click', openSearchModal);
            projectsNavBtn.removeEventListener('click', showProjectsOverview);
            searchModal.removeEventListener('click', onSearchOverlayClick);
            searchInput.removeEventListener('input', onSearchInput);
            searchInput.removeEventListener('keydown', onSearchKeydown);
            sidebarCollapseBtn.removeEventListener('click', onSidebarCollapseClick);
            iciOpenBtn.removeEventListener('click', onIciOpenClick);
            deleteCancelBtn.removeEventListener('click', onDeleteCancel);
            deleteModal.removeEventListener('click', onModalOverlayClick);
            deleteConfirmBtn.removeEventListener('click', onDeleteConfirm);
            examplesBtn.removeEventListener('click', onExamplesBtnClick);
            document.removeEventListener('click', onDocumentClick);
            chatMenuEl.removeEventListener('click', onChatMenuAction);
            projectCancelBtn.removeEventListener('click', closeProjectModal);
            projectSaveBtn.removeEventListener('click', saveProject);
            projectInput.removeEventListener('keydown', onProjectInputKeydown);
            projectModal.removeEventListener('click', onProjectOverlayClick);
            projectSelect.removeEventListener('change', onProjectSelectChange);
            projectMenuBtn.removeEventListener('click', onProjectMenuBtnClick);
            projectNewChatInput.removeEventListener('keydown', onProjectNewChatKeydown);
            projectNewChatSend.removeEventListener('click', startChatInProject);
            if (resultsChart) resultsChart.destroy();
        };
    }, []);

    return (
        <div className="assistant" ref={rootRef}>
            <div className="history-panel" id="historyPanel">
                <div className="history-header">
                    <span className="history-title">ICI Assistant</span>
                    <button className="sidebar-collapse-btn" id="sidebarCollapseBtn" title="Hide sidebar">‹</button>
                </div>

                <div className="side-nav">
                    <button className="side-nav-item" id="newChatNavBtn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                        New chat
                    </button>
                    <button className="side-nav-item" id="searchChatsBtn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                        Search chats
                    </button>
                    <button className="side-nav-item" id="projectsNavBtn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>
                        Projects
                    </button>
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

                {/* Project page — shown instead of the chat when a project is opened */}
                <div className="project-view" id="projectView">
                    <div className="project-view-inner">
                        <div className="project-head">
                            <div className="project-head-left">
                                <svg className="project-folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                                </svg>
                                <h2 id="projectViewName" />
                            </div>
                            <button className="project-menu-btn" id="projectMenuBtn" title="Project options">⋯</button>
                        </div>

                        <div className="project-newchat">
                            <span className="project-newchat-plus">+</span>
                            <input id="projectNewChatInput" placeholder="New chat in project" />
                            <button className="pill-send-btn" id="projectNewChatSend" title="Start chat">↑</button>
                        </div>

                        <div className="project-tabs">
                            <span className="project-tab active">Chats</span>
                        </div>

                        <div className="project-chatlist" id="projectChatList" />
                    </div>
                </div>

                {/* Projects overview — shown when the "Projects" nav item is clicked */}
                <div className="projects-view" id="projectsView">
                    <div className="projects-view-inner">
                        <div className="projects-head">
                            <h2>Projects</h2>
                            <p>Chats organised into a project live on their own page — click one to open it.</p>
                        </div>
                        <div className="projects-grid" id="projectsList" />
                    </div>
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
                    <p className="modal-title" id="deleteModalTitle">Delete chat?</p>
                    <div className="modal-body">
                        <span id="deleteModalChatName" />
                        <p className="modal-warning" id="deleteModalWarning">This chat can't be recovered once deleted.</p>
                    </div>
                    <div className="modal-actions">
                        <button className="modal-cancel-btn" id="deleteCancelBtn">Cancel</button>
                        <button className="modal-delete-btn" id="deleteConfirmBtn">Delete</button>
                    </div>
                </div>
            </div>

            {/* Floating ⋯ options menu for chat items and projects */}
            <div className="chat-menu" id="chatMenu" />

            {/* Add-to-project / rename-project modal */}
            <div className="modal-overlay" id="projectModal">
                <div className="modal-card">
                    <p className="modal-title" id="projectModalTitle">Add to project</p>
                    <div className="modal-body">
                        <select id="projectSelect" className="project-select" />
                        <input id="projectInput" className="project-input" placeholder="New project name — e.g. Sanctuary study" />
                        <p className="modal-warning" id="projectModalHint">Pick an existing project or create a new one.</p>
                    </div>
                    <div className="modal-actions">
                        <button className="modal-cancel-btn" id="projectCancelBtn">Cancel</button>
                        <button className="modal-save-btn" id="projectSaveBtn">Save</button>
                    </div>
                </div>
            </div>

            {/* Search chats modal */}
            <div className="modal-overlay search-overlay" id="searchModal">
                <div className="search-modal-card">
                    <div className="search-input-row">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                        <input id="searchInput" placeholder="Search chats..." autoComplete="off" />
                    </div>
                    <div className="search-results" id="searchResults" />
                </div>
            </div>
        </div>
    );
}

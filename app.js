/* ============================================================
   Defense Prep - App Logic
   ============================================================ */

// Intro Screen
window.addEventListener('load', () => {
    setTimeout(() => {
        const loader = document.getElementById('intro-loader');
        loader.style.opacity = '0';
        setTimeout(() => loader.style.visibility = 'hidden', 400);
    }, 3000);
});

// Sidebar Toggle Logic
function toggleSidebar() {
    document.getElementById('main-sidebar').classList.toggle('active');
    document.getElementById('sidebar-overlay').classList.toggle('active');
}

// Chatbot Toggle
function toggleChatbot() {
    const chatbot = document.getElementById('chatbotPopup');
    const scrim = document.getElementById('chatbotScrim');
    const isOpening = !chatbot.classList.contains('active');

    chatbot.classList.toggle('active');
    if (scrim) scrim.classList.toggle('active');

    // Reset only when OPENING fresh, not closing
    if (isOpening) {
        // Keep chat history — do NOT clear it
        document.getElementById('chatbotInput').value = '';
        setTimeout(() => {
            document.getElementById('chatbotInput').focus();
        }, 300);
    }
}

// Simple debug logger for the browser side.
// Enable verbose logs by opening the console and running: localStorage.setItem('debug', '1')
const dbgLog = (tag, ...args) => {
    if (localStorage.getItem('debug') === '1') {
        console.log(`%c[${tag}]`, 'color:#00c8ff;font-weight:bold', ...args);
    }
};
const dbgError = (tag, ...args) => {
    console.error(`[${tag}]`, ...args);
};

const chapterUploadState = {
    activeChapter: 1,
    chapters: {}
};

function saveChapterState() {
    localStorage.setItem('chapterUploadState', JSON.stringify({
        activeChapter: chapterUploadState.activeChapter,
        chapters: chapterUploadState.chapters
    }));
}

function loadChapterState() {
    try {
        const stored = localStorage.getItem('chapterUploadState');
        if (!stored) return;
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
            chapterUploadState.activeChapter = parsed.activeChapter || 1;
            chapterUploadState.chapters = parsed.chapters || {};
        }
    } catch (error) {
        console.error('Failed to restore chapter state:', error);
    }
}

// ---------------------------------------------------------------------------
// PERSISTENT PROJECT / SESSION STATE (server-side RAG)
// ---------------------------------------------------------------------------
// These identifiers are kept SEPARATE:
//   accessToken    - anonymous project identity / isolation (server-validated)
//   sessionId      - browser conversation/session identity
//   conversationId - persisted conversation identity (from /api/chat)
//
// The browser NEVER holds the SUPABASE_SERVICE_ROLE_KEY or any other
// server-only credential. Only the anonymous `accessToken` is used.
//
// accessToken is generated once and reused across sessions (persisted).
// sessionId is also persisted so a user's conversation can be resumed.
function getAccessToken() {
    try {
        let token = localStorage.getItem('dp_access_token');
        if (!token) {
            token = (window.crypto && crypto.randomUUID)
                ? crypto.randomUUID()
                : 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
            localStorage.setItem('dp_access_token', token);
        }
        return token;
    } catch (e) {
        // localStorage unavailable — fall back to an in-memory token.
        return 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
    }
}

function getSessionId() {
    try {
        let sid = localStorage.getItem('dp_session_id');
        if (!sid) {
            sid = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
            localStorage.setItem('dp_session_id', sid);
        }
        return sid;
    } catch (e) {
        return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }
}

// Persisted conversation id (resumed across page loads for the same session).
let conversationId = null;
function getConversationId() {
    if (conversationId) return conversationId;
    try {
        const saved = localStorage.getItem('dp_conversation_id');
        if (saved) conversationId = saved;
    } catch (e) { /* ignore */ }
    return conversationId;
}
function setConversationId(id) {
    conversationId = id;
    try {
        if (id) localStorage.setItem('dp_conversation_id', id);
        else localStorage.removeItem('dp_conversation_id');
    } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// RESEARCH INGESTION (server-side persistent knowledge base)
// ---------------------------------------------------------------------------
// After a chapter/document is loaded, POST it to /api/ingest so it is
// persistently indexed (sections, chunks, embeddings, citations, references).
// The backend handles checksum/version idempotency — unchanged content is a
// no-op. Ingestion is best-effort and non-blocking: failures surface a status
// but never block the user from continuing.

// Research-index status indicator (index.html element).
function setResearchStatus(state, detail) {
    const el = document.getElementById('researchStatus');
    if (!el) return;
    const states = {
        loading: { text: 'Research loading…', cls: 'research-status-loading' },
        ready: { text: 'Research indexed', cls: 'research-status-ready' },
        updated: { text: 'Research updated', cls: 'research-status-ready' },
        failed: { text: 'Research indexing failed', cls: 'research-status-failed' },
        none: { text: 'No research indexed', cls: 'research-status-loading' }
    };
    const s = states[state] || states.none;
    el.textContent = detail ? `${s.text} — ${detail}` : s.text;
    el.className = 'research-status ' + s.cls;
}

async function ingestChapter(scope, docNumber) {
    const accessToken = getAccessToken();
    const text = (scope && scope.dataDump) ? scope.dataDump : '';
    if (!text) return;

    try {
        const response = await fetch('/api/ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken,
                title: scope.title,
                docNumber,
                fileType: 'txt',
                text
            })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || ('Ingest failed (HTTP ' + response.status + ')'));
        }
        const data = await response.json();
        if (data.skipped) {
            setResearchStatus('ready', `Chapter ${docNumber} unchanged`);
        } else {
            setResearchStatus(data.embeddings ? 'updated' : 'updated', `Chapter ${docNumber} indexed`);
        }
        return data;
    } catch (error) {
        dbgError('ingestChapter', `Failed to index Chapter ${docNumber}:`, error);
        setResearchStatus('failed', `Chapter ${docNumber}`);
        return null;
    }
}

// Queue ingestion for all loaded/available chapters (best-effort, parallel).
async function ingestAllLoadedChapters() {
    const available = [1, 2, 3, 4, 5].filter((n) => isChapterAvailable(n));
    if (available.length === 0) {
        setResearchStatus('none');
        return;
    }
    setResearchStatus('loading', available.length + ' chapter(s)');
    const results = await Promise.all(available.map((n) => ingestChapter(getChapterScope(n), n)));
    const ok = results.filter(Boolean).length;
    setResearchStatus(ok > 0 ? 'ready' : 'failed', ok + ' of ' + available.length + ' indexed');
}

// Single source of truth for chapter component options. Reads from
// chapter-config.js (window.CHAPTER_CONFIG) with a generic fallback so the
// app and the config file can never drift out of sync.
function getChapterOptions(chapterNumber) {
    const cfg = window.CHAPTER_CONFIG || {};
    const chapter = cfg[chapterNumber];
    if (chapter && Array.isArray(chapter.components) && chapter.components.length) {
        return chapter.components;
    }
    return (window.GENERIC_COMPONENTS || [
        { key: 'all', name: 'All Components (Random)', available: true },
        { key: 'introduction', name: 'Introduction', available: true },
        { key: 'research_design', name: 'Research Design', available: true },
        { key: 'respondents', name: 'Respondents', available: true },
        { key: 'method', name: 'Research Method', available: true },
        { key: 'references', name: 'References', available: true }
    ]);
}

// Whether a chapter should appear in the UI at all. Chapters 1-2 are always
// available; 3-5 depend on APP_CONFIG.chapterAutoDetect (default true) and
// the presence of an uploaded file.
function isChapterAvailable(chapterNumber) {
    if (chapterNumber <= 2) return true;
    const autoDetect = window.APP_CONFIG && window.APP_CONFIG.chapterAutoDetect !== false;
    if (!autoDetect) return false;
    return Boolean(chapterUploadState && chapterUploadState.chapters && chapterUploadState.chapters[chapterNumber]);
}

// Multi-select state: Set of selected component keys
let selectedComponents = new Set(['all']);
let generatedCardsCollection = [];
let executionPointerIndex = -1;
let currentDifficulty = 'medium';
let currentComponent = 'all';
let currentChapter = 1;
// Exposed for analytics (index.html trackEvent).
window.currentChapter = currentChapter;
let chatHistory = [];

// Validate flashcard JSON matches the same required fields enforced server-side.
function validateFlashcardCandidate(candidate) {
    if (!candidate || typeof candidate !== 'object') return false;
    if (typeof candidate.question !== 'string' || !candidate.question.trim()) return false;
    if (typeof candidate.answer !== 'string' || !candidate.answer.trim()) return false;
    return true;
}

// Track recently generated questions to avoid repeats in a session.
const recentQuestions = [];

// Simple similarity: how much of the new question's words appear in any
// of the recent questions (case-insensitive). Returns true if it looks
// like a near-duplicate.
function isNearDuplicateQuestion(newQuestion) {
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3);
    const newWords = norm(newQuestion);
    if (newWords.length === 0) return false;
    for (const recent of recentQuestions) {
        const recentWords = norm(recent);
        if (recentWords.length === 0) continue;
        const overlap = newWords.filter(w => recentWords.includes(w)).length;
        const ratio = overlap / newWords.length;
        if (ratio > 0.65) return true;
    }
    return false;
}

function rememberRecentQuestion(question) {
    recentQuestions.push(question);
    if (recentQuestions.length > 20) recentQuestions.shift();
}

// Increase storage limit
const MAX_HISTORY_SIZE = 100;

// Lazy-load a heavy third-party library on first use so it doesn't block
// initial page render. Fetches the script from the given CDN URL and resolves
// once it has loaded. Uses a cached promise so the same library is only ever
// fetched once per session.
const loadedLibraries = {};
function loadLibrary(url) {
    if (loadedLibraries[url]) return loadedLibraries[url];
    loadedLibraries[url] = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${url}"]`);
        if (existing && existing.dataset.loaded) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = () => {
            script.dataset.loaded = '1';
            resolve();
        };
        script.onerror = () => {
            delete loadedLibraries[url];
            reject(new Error(`Failed to load a required library: ${url}`));
        };
        document.head.appendChild(script);
    });
}

// Convenience wrappers matching the libraries referenced throughout the app.
// These point at the same CDN URLs the service worker pre-caches so the app
// still works offline once the library has been fetched once.
function loadHtml2Canvas() {
    return loadLibrary('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
}
function loadJsPdf() {
    return loadLibrary('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
}
function loadMammoth() {
    return loadLibrary('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
}

// Bound the chapter context sent to the AI so we don't blow the token budget.
// The full chapter is retained in memory (chapterUploadState.chapters) but only
// a truncated slice is embedded into the flashcard prompt / network payload.
// IMPORTANT: kept comfortably below the server's MAX_FLASHCARD_PROMPT_CHARS
// (see /api/chat.js) once the instruction wrapper (~2000-2300 chars) is added
// around it - otherwise the server-side cap silently truncates the END of the
// prompt, chopping off the "respond in this JSON format" instruction.
const MAX_FLASHCARD_DUMP_CHARS = 4000;

// Cooldown (ms) between flashcard generations. Prevents back-to-back requests
// from exhausting the Groq free-tier TPM budget and hitting 429s.
const GENERATION_COOLDOWN_MS = 10000;
let lastGenerationAt = 0;

// State for the chapter viewer overlay. Tracks which chapter is open, the
// loaded text content, and which tab (text/pdf/docx) is currently active.
let chapterViewerState = {
    chapterNumber: 1,
    text: '',
    activeTab: 'text'
};

function truncateDump(text, max) {
    const s = String(text || '');
    if (s.length <= max) return s;
    // Try to cut at a sentence boundary near the limit for a cleaner prompt.
    const cut = s.slice(0, max);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.'));
    if (lastStop > max * 0.6) return cut.slice(0, lastStop + 1) + ' [truncated]';
    return cut + ' [truncated]';
}

try {
    const preservedCollection = localStorage.getItem('mcesi_sim_history');
    if (preservedCollection) {
        generatedCardsCollection = JSON.parse(preservedCollection);
        if (generatedCardsCollection.length > 0) {
            executionPointerIndex = generatedCardsCollection.length - 1;
        }
    }

    // Load chat history
    const savedChatHistory = localStorage.getItem('chatHistory');
    if (savedChatHistory) {
        chatHistory = JSON.parse(savedChatHistory);
    }
} catch (e) {
    console.error("Local recovery error:", e);
}

window.addEventListener('DOMContentLoaded', () => {
    // Only load the history list, do not try to sync/show the card surface yet
    if (generatedCardsCollection.length > 0) {
        renderHistoryPanelUI();
    }

    // Load chat history into UI
    loadChapterState();
    currentChapter = chapterUploadState.activeChapter || 1;
    loadChatHistory();
    populateChapterDropdown();
    populateComponentDropdown();
    populateComponentPills(); // Initialize multi-select pills
    loadChapterFilesFromFolder().finally(() => {
        // Re-populate the dropdowns after the folder scan so any newly loaded
        // chapters are reflected in the UI without needing a full reload.
        populateChapterDropdown();
        populateComponentDropdown();
        populateComponentPills();
        populateChapterPreview();
        // Index the loaded chapters into the persistent research knowledge
        // base. Best-effort and non-blocking (the status indicator reflects
        // the outcome; the UI is never blocked).
        ingestAllLoadedChapters();
    });

    bindChapterPreviewClick();
    if (typeof trackEvent === 'function') {
        trackEvent('view', { page: 'index' });
    }

    // Load dark mode preference
    const savedDarkMode = localStorage.getItem('darkMode');
    if (savedDarkMode === 'true') {
        document.documentElement.classList.add('dark-mode');
        document.getElementById('darkModeToggle').textContent = '☀️';
        // Update main content background
        const mainContent = document.querySelector('.main-content');
        mainContent.style.background = '#1a1a1a';
    }

    // Explicitly hide the loader on page load to ensure it's not stuck
    const pageLoader = document.getElementById('loader');
    if (pageLoader) {
        pageLoader.style.display = 'none';
        pageLoader.setAttribute('aria-busy', 'false');
    }
    setDifficulty(currentDifficulty);
});

function selectChapter(chapterNumber) {
    chapterUploadState.activeChapter = chapterNumber;
    currentChapter = chapterNumber;
    window.currentChapter = chapterNumber;
    populateChapterDropdown();
    populateComponentDropdown();
    populateChapterPreview();
}

function populateChapterDropdown() {
    const dropdown = document.getElementById('chapterDropdown');
    if (!dropdown) return;

    const prevValue = currentChapter;
    dropdown.innerHTML = '';
    [1, 2, 3, 4, 5].forEach((chapterNumber) => {
        const opt = document.createElement('option');
        opt.value = chapterNumber;
        const available = isChapterAvailable(chapterNumber);
        opt.textContent = available ? `Chapter ${chapterNumber}` : `Chapter ${chapterNumber} (Unavailable)`;
        opt.disabled = !available;
        dropdown.appendChild(opt);
    });

    // If the current chapter is no longer available, fall back to chapter 1.
    if (!isChapterAvailable(currentChapter)) {
        currentChapter = 1;
        chapterUploadState.activeChapter = 1;
        window.currentChapter = 1;
    }
    dropdown.value = currentChapter;

    // If the dropdown's value changed, we cleared the disabled gate — return
    // to the previous value only if it was still available.
    if (prevValue !== currentChapter) {
        populateComponentDropdown();
        populateChapterPreview();
    }
}

function setChapterFromDropdown() {
    const dropdown = document.getElementById('chapterDropdown');
    const selectedChapter = Number(dropdown.value);
    if (!Number.isNaN(selectedChapter) && isChapterAvailable(selectedChapter)) {
        selectChapter(selectedChapter);
    }
}

function populateComponentDropdown() {
    const dropdown = document.getElementById('componentDropdown');
    const hint = document.getElementById('componentHint');
    if (!dropdown) return;

    const availableOptions = getChapterOptions(currentChapter);
    dropdown.innerHTML = '';

    availableOptions.forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option.key;
        opt.textContent = option.name;
        if (!option.available) {
            opt.disabled = true;
        }
        dropdown.appendChild(opt);
    });

    const hasCurrent = availableOptions.some((option) => option.key === currentComponent && option.available);
    if (!hasCurrent) {
        currentComponent = 'all';
    }
    dropdown.value = currentComponent;

    if (hint) {
        const enabled = availableOptions.filter((o) => o.available && o.key !== 'all');
        const enabledNames = enabled.map((o) => o.name).join(' · ');
        if (enabled.length) {
            hint.textContent = `${enabledNames} are available for this chapter.`;
        } else if (currentChapter <= 2) {
            hint.textContent = `Chapter ${currentChapter} components are ready.`;
        } else {
            hint.textContent = `Chapter ${currentChapter} still needs an uploaded file.`;
        }
    }
}

function normalizeChapterText(text) {
    const rawText = String(text || '').replace(/\r/g, '\n').trim();
    if (!rawText) {
        return '';
    }

    return rawText
        .replace(/^chapter\s*[0-9]+(?:\s*[-–:]\s*)?/gim, '')
        .replace(/^(introduction|review of related literature|methodology|results and discussion|conclusion and recommendations)\s*[-–:]\s*/gim, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getChapterScope(chapterNumber = chapterUploadState.activeChapter) {
    const uploadedEntry = chapterUploadState.chapters?.[chapterNumber];
    const uploadedContent = typeof uploadedEntry === 'string'
        ? uploadedEntry
        : uploadedEntry?.dataDump || uploadedEntry?.content || '';
    // No fallback: content must always come from the uploaded .txt/.docx files only.
    const content = uploadedContent || '';
    const normalizedContent = normalizeChapterText(content);
    const title = (typeof uploadedEntry === 'object' && uploadedEntry?.title)
        ? uploadedEntry.title
        : `Chapter ${chapterNumber} `;

    return {
        title,
        dataDump: normalizedContent,
        pdfPath: typeof uploadedEntry === 'object' ? uploadedEntry.pdfPath : `/data/chapters/chapter-${chapterNumber}.pdf`,
        textPath: typeof uploadedEntry === 'object' ? uploadedEntry.textPath : `/data/chapters/chapter-${chapterNumber}.txt`,
        docxPath: typeof uploadedEntry === 'object' ? uploadedEntry.docxPath : `/data/chapters/chapter-${chapterNumber}.docx`
    };
}

// ---------------------------------------------------------------------------
// SECTION-BASED RETRIEVAL (lightweight RAG)
// ---------------------------------------------------------------------------
// The whole chapter is kept in memory (chapterUploadState.chapters) so nothing
// is forgotten, but we DON'T resend the entire chapter to the AI on every call.
// Instead we split it into sections by heading and inject ONLY the section(s)
// most relevant to the current request. This gives the AI "the whole research
// in mind" (via retrieval over all sections) while spending tokens only on the
// relevant slice - efficient and no forgetting.
//
// The chapter text uses headings marked with **...** (e.g. **INTRODUCTION**,
// **Statement of the Problem**, **Hypothesis**, **Significance of the Study**).
// Some headings (Theoretical Framework, Conceptual Framework) are unmarked, so
// we also treat any all-caps-ish standalone line as a heading boundary.

// Translate a chapter into an ordered list of { heading, keywords, text }.
function splitChapterIntoSections(text) {
    const raw = String(text || '').replace(/\r/g, '\n');
    const lines = raw.split('\n');
    const sections = [];
    let current = null;

    const flush = () => {
        if (current && current.text.trim()) {
            current.text = current.text.trim();
            sections.push(current);
        }
        current = null;
    };

    const isHeading = (line) => {
        const t = line.trim();
        if (!t) return false;
        // Markdown-bold heading: **TITLE**
        const boldMatch = t.match(/^\*\*(.+?)\*\*\s*$/);
        if (boldMatch) return boldMatch[1].trim();
        // All-caps / title-case standalone heading line (short)
        if (t.length <= 60 && /^[A-Z][A-Za-z0-9\s&'’.\-/,()]+$/.test(t) && !t.endsWith('.')) {
            return t;
        }
        return false;
    };

    for (const line of lines) {
        const heading = isHeading(line);
        if (heading) {
            flush();
            current = { heading, keywords: heading.toLowerCase(), text: '' };
        } else if (current) {
            current.text += line + '\n';
        } else {
            // Content before the first heading — treat as its own section.
            if (!sections.length) {
                current = { heading: 'Title', keywords: 'title', text: '' };
            }
            if (current) current.text += line + '\n';
        }
    }
    flush();

    // If nothing was split, fall back to a single section of the whole text.
    if (!sections.length && raw.trim()) {
        sections.push({ heading: 'Chapter', keywords: 'chapter', text: raw.trim() });
    }
    return sections;
}

// Map a component key to search keywords so we can find the matching section.
const COMPONENT_KEYWORDS = {
    title: ['title', 'relationship', 'academic performance'],
    introduction: ['introduction'],
    research_design: ['research design', 'design', 'correlational', 'quantitative', 'methodology'],
    respondents: ['respondents', 'participants', 'sample', 'sampling', 'grade 12'],
    respondents_participants: ['respondents', 'participants', 'sample', 'sampling', 'grade 12'],
    motivation: ['motivation', 'rationale', 'significance', 'benefit'],
    research_gap: ['research gap', 'gap', 'limited', 'further investigation', 'inconsisten'],
    statement: ['statement of the problem', 'problem', 'aims to', 'seek to answer', 'objectives'],
    method: ['method', 'methodology', 'procedure', 'data collection', 'statistical'],
    references: ['references', 'al-', 'al.'],
    instruments: ['instrument', 'questionnaire', 'validated', 'scale'],
    ethical_considerations: ['ethical', 'consent', 'confidential', 'privacy', 'anonym'],
    data_collection: ['data collection', 'gather', 'administer', 'distribute'],
    data_analysis: ['data analysis', 'statistical', 'frequency', 'percentage', 'weighted mean', 'pearson', 'correlation']
};

// Pick the single most relevant section for a flashcard component.
function selectSectionForComponent(scope, componentKey) {
    const sections = splitChapterIntoSections(scope.dataDump);
    const keywords = COMPONENT_KEYWORDS[componentKey];
    if (!keywords || sections.length === 0) return scope.dataDump;

    let best = null;
    let bestScore = 0;
    for (const section of sections) {
        let score = 0;
        for (const kw of keywords) {
            if (section.text.toLowerCase().includes(kw)) score += 1;
            if (section.heading.toLowerCase().includes(kw)) score += 2;
        }
        if (score > bestScore) {
            bestScore = score;
            best = section;
        }
    }
    return best ? best.text : scope.dataDump;
}

// Keyword-overlap retrieval: given a user query, return the top N sections
// whose text shares the most meaningful words with the query.
function selectSectionsForQuery(scope, query, topN = 2) {
    const sections = splitChapterIntoSections(scope.dataDump);
    if (sections.length === 0) return scope.dataDump;

    const stop = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'are', 'for', 'on', 'with', 'their', 'about', 'what', 'how', 'does', 'do', 'can', 'you', 'your', 'it', 'this', 'that', 'will', 'study', 'research']);
    const qWords = (query || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !stop.has(w));

    const scored = sections.map((section) => {
        const secText = section.text.toLowerCase();
        let score = 0;
        for (const w of qWords) {
            if (secText.includes(w)) score += 1;
            if (section.heading.toLowerCase().includes(w)) score += 2;
        }
        return { section, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topN);
    const hasHits = top.some((r) => r.score > 0);

    if (!hasHits) {
        // No strong match — fall back to the most recently read section is not
        // tracked, so just return the first sections (intro/methodology) which
        // usually cover the widest ground.
        return sections.slice(0, topN).map((s) => s.text).join('\n\n');
    }

    return top.map((r) => `[${r.section.heading}]\n${r.section.text}`).join('\n\n');
}

// PREMIUM INLINE FORMATTING: scans an already-escaped HTML string and wraps
// high-value tokens in styled spans so the chapter preview reads like a
// polished academic document. Two passes are used so the tokens are never
// double-wrapped and the regexes never match inside our own inserted tags.
// - Citations: "(Author, 2020)" / "Author (2020)" / "(2020)"
// - Statistics: numbers, percentages, means, correlation coefficients, p-values
// - Key terms: bolded **...** fragments survive as emphasis
function applyPremiumInline(escapedHtml) {
    if (!escapedHtml) return escapedHtml;
    let out = escapedHtml;

    // Citations — author-year combos first, then bare years.
    out = out.replace(
        /(\([A-Z][a-zA-Z''-]+(?:\s+(?:et al\.?|&\s+[A-Z][a-zA-Z''-]+))?(?:,\s*)?(?:\d{4}[a-z]?)?\))/g,
        '<span class="premium-citation">$1</span>'
    );
    out = out.replace(/((?:[A-Z][a-zA-Z''-]+(?:\s+(?:et al\.?|&\s+[A-Z][a-zA-Z''-]+))?)\s*\(\d{4}[a-z]?\))/g,
        '<span class="premium-citation">$1</span>');
    out = out.replace(/(\(\d{4}[a-z]?\))/g, '<span class="premium-citation">$1</span>');

    // Statistics — isolated numbers, percentages, decimals, p-values, r-values.
    out = out.replace(
        /(\b(?:p|r|R)\s*[=<>]\s*\d*\.?\d+|\b\d+(?:\.\d+)?(?:\s*%|\s*percent)?\b)/g,
        '<span class="premium-stat">$1</span>'
    );
    // Weighted-mean / correlation phrases.
    out = out.replace(
        /(\bweighted\s+mean\b|\bPearson[- ]r\b|\bcorrelation\s+coefficient\b)/gi,
        '<span class="premium-stat">$1</span>'
    );

    // Bold emphasis **...** (legacy markdown-style headings in the raw text).
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    return out;
}

// Convert a chapter's raw text into richly formatted, safe HTML.
// All-caps lines are treated as section headings; numbered items become
// ordered lists; everything else becomes a paragraph. All content is escaped
// so no raw HTML from the source file can ever be injected.
function buildStyledChapterText(text) {
    const raw = String(text || '').replace(/\r/g, '').trim();
    if (!raw) {
        return '<div class="chapter-empty">No text content found for this chapter.</div>';
    }

    // Split into lines preserving blank lines so we can detect block breaks.
    const lines = raw.split('\n').map((l) => l.trim());
    const blocks = [];
    let current = [];

    const flush = () => {
        if (current.length) {
            blocks.push(current.join(' '));
            current = [];
        }
    };

    for (const line of lines) {
        if (!line) {
            flush();
            continue;
        }
        // Detect all-caps heading lines (e.g. "INTRODUCTION", "METHODS").
        if (/^[A-Z][A-Z\s&'’.\-/]{2,}$/.test(line) && line.length >= 3 && line.length <= 60) {
            flush();
            blocks.push({ type: 'heading', text: line });
        } else {
            current.push(line);
        }
    }
    flush();

    const html = blocks.map((block) => {
        if (block && block.type === 'heading') {
            return `<h4 class="chapter-styled-heading">${applyPremiumInline(escapeHtml(block.text))}</h4>`;
        }
        const text = block;
        // Numbered list items: "1. text" or "a. text"
        if (/^\s*\d+[.)]\s+/.test(text) || /^\s*[a-d][.)]\s+/.test(text)) {
            const items = text.split(/\n+/).map((part) => part.trim()).filter(Boolean);
            const lis = items.map((item) => `<li>${applyPremiumInline(escapeHtml(item.replace(/^\s*\d+[.)]\s+/, '').replace(/^\s*[a-d][.)]\s+/, '')))}</li>`).join('');
            return `<ol class="chapter-styled-list">${lis}</ol>`;
        }
        return `<p class="chapter-styled-paragraph">${applyPremiumInline(escapeHtml(text))}</p>`;
    }).join('\n');

    return html;
}

// Build a readable text preview that preserves the original line structure of
// the chapter file. Unlike buildStyledChapterText (which treats the whole
// dump as one flow), this splits on blank lines into paragraphs so each
// section reads as its own block instead of one giant blob.
function buildChapterPreviewText(text) {
    const raw = String(text || '').replace(/\r/g, '');
    if (!raw.trim()) {
        return '<div class="chapter-empty">Chapter content is not available yet.</div>';
    }

    // Split into paragraphs on blank lines, then trim each.
    const paragraphs = raw
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);

    const html = paragraphs.map((block) => {
        // Detect all-caps heading lines within the block.
        const lines = block.split('\n').map((l) => l.trim());
        const parts = lines.map((line) => {
            if (/^[A-Z][A-Z\s&'’.\-/]{1,}$/.test(line) && line.length >= 2 && line.length <= 80) {
                return `<h4 class="chapter-styled-heading">${applyPremiumInline(escapeHtml(line))}</h4>`;
            }
            return `<p class="chapter-styled-paragraph">${applyPremiumInline(escapeHtml(line))}</p>`;
        });
        return parts.join('');
    }).join('');

    return html;
}

let chapterPreviewClickBound = false;
function bindChapterPreviewClick() {
    if (chapterPreviewClickBound) return;
    const contentArea = document.getElementById('chapterContentArea');
    if (!contentArea) return;
    contentArea.addEventListener('click', () => {
        openChapterViewer(chapterUploadState.activeChapter);
    });
    chapterPreviewClickBound = true;
}

function populateChapterPreview() {
    const contentArea = document.getElementById('chapterContentArea');
    const pdfList = document.getElementById('chapterPdfList');
    const activeChapter = chapterUploadState.activeChapter;
    const scope = getChapterScope(activeChapter);
    const availableChapters = [1, 2, 3, 4, 5].filter((n) => isChapterAvailable(n));

    // Build the "View Chapter N" buttons — one wide, tappable button per
    // available chapter. Chapters 1-2 are always present so the previews are
    // clickable even before the txt files finish loading; 3-5 appear once
    // their files exist (chapterAutoDetect).
    if (pdfList) {
        pdfList.innerHTML = '';
        availableChapters.forEach((chapterNumber) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-view-pdf' + (chapterNumber === activeChapter ? ' active' : '');
            btn.innerHTML = `<span class="btn-view-pdf-icon">📄</span><span class="btn-view-pdf-label">View Chapter ${chapterNumber}</span>`;
            btn.addEventListener('click', () => openChapterViewer(chapterNumber));
            pdfList.appendChild(btn);
        });
    }

    // Show the chapter's formatted text preview directly in the content area.
    if (contentArea) {
        contentArea.innerHTML = buildChapterPreviewText(scope.dataDump);
        bindChapterPreviewClick();
    }
    saveChapterState();
}

// Render the appropriate content into the chapter viewer based on the active tab.
function renderChapterViewerContent() {
    const content = document.getElementById('chapterViewerContent');
    if (!content) return;
    const state = chapterViewerState;
    const scope = getChapterScope(state.chapterNumber);
    const pdfPath = scope.pdfPath || `/data/chapters/chapter-${state.chapterNumber}.pdf`;
    const docxPath = scope.docxPath || `/data/chapters/chapter-${state.chapterNumber}.docx`;

    // Sync the active tab highlight.
    document.querySelectorAll('.chapter-viewer-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.tab === state.activeTab);
    });

    if (state.activeTab === 'text') {
        content.innerHTML = state.text
            ? buildStyledChapterText(state.text)
            : '<div class="chapter-empty">No text content is available for this chapter.</div>';
        content.dataset.rawText = state.text;
        return;
    }

    if (state.activeTab === 'pdf') {
        content.innerHTML = `
<div class="chapter-preview-meta">PDF preview</div>
<iframe src="${pdfPath}" title="Chapter ${state.chapterNumber} PDF preview" class="chapter-viewer-frame"></iframe>
<div class="chapter-preview-actions">
    <a class="btn-proposal chapter-viewer-copy" href="${pdfPath}" target="_blank" rel="noopener">Open PDF</a>
</div>`;
        content.dataset.rawText = '';
        return;
    }

    if (state.activeTab === 'docx') {
        content.innerHTML = `
<div class="chapter-preview-meta">Original DOCX</div>
<div class="chapter-viewer-docx">
    <p>This chapter is available as a Microsoft Word document.</p>
    <a class="btn-proposal chapter-viewer-copy" href="${docxPath}" target="_blank" rel="noopener">Open DOCX</a>
</div>`;
        content.dataset.rawText = '';
    }
}

// Switch the active tab (text/pdf/docx) and re-render the viewer content.
function setChapterViewerTab(tab) {
    if (!chapterViewerState || !['text', 'pdf', 'docx'].includes(tab)) return;
    chapterViewerState.activeTab = tab;
    renderChapterViewerContent();
}

async function openChapterViewer(chapterNumber = chapterUploadState.activeChapter) {
    const overlay = document.getElementById('chapterViewerOverlay');
    const title = document.getElementById('chapterViewerTitle');
    const subtitle = document.getElementById('chapterViewerSubtitle');
    const content = document.getElementById('chapterViewerContent');
    const scope = getChapterScope(chapterNumber);
    if (!overlay || !title || !content) return;

    chapterUploadState.activeChapter = chapterNumber;
    currentChapter = chapterNumber;
    window.currentChapter = chapterNumber;
    populateChapterDropdown();
    populateComponentDropdown();
    populateChapterPreview();

    // Set viewer state and default to the Text tab.
    chapterViewerState = {
        chapterNumber,
        text: scope.dataDump || '',
        activeTab: 'text'
    };

    title.textContent = scope.title;
    subtitle.textContent = `Previewing Chapter ${chapterNumber} `;
    content.innerHTML = '<div class="chapter-empty">Loading the chapter preview…</div>';
    content.dataset.rawText = '';
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    const textPath = scope.textPath || `/data/chapters/chapter-${chapterNumber}.txt`;
    const pdfPath = scope.pdfPath || `/data/chapters/chapter-${chapterNumber}.pdf`;
    const docxPath = scope.docxPath || `/data/chapters/chapter-${chapterNumber}.docx`;

    // Warm the cache for PDF/DOCX tabs so they load offline after first view.
    fetch(pdfPath, { cache: 'force-cache' }).catch(() => { });
    fetch(docxPath, { cache: 'force-cache' }).catch(() => { });

    // Try to load the freshest text from the .txt file (fall back to cached).
    try {
        const textResponse = await fetch(textPath, { cache: 'no-store' });
        if (textResponse.ok) {
            const freshText = (await textResponse.text()).trim();
            if (freshText) chapterViewerState.text = freshText;
        }
    } catch (error) {
        console.warn('Could not load chapter text preview', error);
    }

    renderChapterViewerContent();
    if (typeof trackEvent === 'function') {
        trackEvent('chapter_view', { chapter: scope.title });
    }
}

function closeChapterViewer() {
    const overlay = document.getElementById('chapterViewerOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    document.body.style.overflow = '';
}

function copyChapterText() {
    const content = document.getElementById('chapterViewerContent');
    if (!content) return;
    const textToCopy = content.dataset.rawText || content.textContent || '';
    navigator.clipboard.writeText(textToCopy).then(() => {
        const button = document.querySelector('.chapter-viewer-copy');
        const original = button?.textContent;
        if (button) {
            button.textContent = 'Copied!';
            setTimeout(() => {
                button.textContent = original;
            }, 1000);
        }
    }).catch(() => {
        alert('Unable to copy chapter text.');
    });
}

async function refreshChapterFiles() {
    const refreshBtn = document.getElementById('refreshChapterBtn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing…';
    }
    try {
        await loadChapterFilesFromFolder();
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh Files';
        }
    }
    populateChapterDropdown();
    populateComponentDropdown();
    populateChapterPreview();
}

// Build the standard list of chapter file paths for chapters 1-5.
function getChapterFilePaths() {
    return [
        { number: 1, textPath: '/data/chapters/chapter-1.txt', pdfPath: '/data/chapters/chapter-1.pdf', docxPath: '/data/chapters/chapter-1.docx' },
        { number: 2, textPath: '/data/chapters/chapter-2.txt', pdfPath: '/data/chapters/chapter-2.pdf', docxPath: '/data/chapters/chapter-2.docx' },
        { number: 3, textPath: '/data/chapters/chapter-3.txt', pdfPath: '/data/chapters/chapter-3.pdf', docxPath: '/data/chapters/chapter-3.docx' },
        { number: 4, textPath: '/data/chapters/chapter-4.txt', pdfPath: '/data/chapters/chapter-4.pdf', docxPath: '/data/chapters/chapter-4.docx' },
        { number: 5, textPath: '/data/chapters/chapter-5.txt', pdfPath: '/data/chapters/chapter-5.pdf', docxPath: '/data/chapters/chapter-5.docx' }
    ];
}

// Lazily ensure a single chapter's content is loaded into memory, then refresh
// the UI. Used by the Refresh Files button and auto-detection so the app only
// fetches what's actually needed instead of all five chapters at once.
async function loadChapterEntry(number) {
    const entry = getChapterFilePaths().find((e) => e.number === number);
    if (!entry) return;
    try {
        const textResponse = await fetch(entry.textPath, { cache: 'no-store' });
        if (textResponse.ok) {
            const text = (await textResponse.text()).trim();
            if (text) {
                chapterUploadState.chapters[number] = {
                    title: `Chapter ${number} `,
                    dataDump: normalizeChapterText(text),
                    pdfPath: entry.pdfPath,
                    textPath: entry.textPath,
                    docxPath: entry.docxPath
                };
                saveChapterState();
                return;
            }
        }
        const docxResponse = await fetch(entry.docxPath, { cache: 'no-store' });
        if (!docxResponse.ok) return;
        await loadMammoth();
        const arrayBuffer = await docxResponse.arrayBuffer();
        const extracted = await mammoth.extractRawText({ arrayBuffer });
        const text = extracted.value || '';
        if (text.trim()) {
            chapterUploadState.chapters[number] = {
                title: `Chapter ${number} `,
                dataDump: normalizeChapterText(text),
                pdfPath: entry.pdfPath,
                textPath: entry.textPath,
                docxPath: entry.docxPath
            };
            saveChapterState();
        }
    } catch (error) {
        console.warn(`Could not load ${entry.textPath} `, error);
    }
}

async function loadChapterFilesFromFolder() {
    const chapterFiles = getChapterFilePaths();

    const loadedChapters = {};
    for (const entry of chapterFiles) {
        try {
            const textResponse = await fetch(entry.textPath, { cache: 'no-store' });
            if (textResponse.ok) {
                const text = (await textResponse.text()).trim();
                if (text) {
                    loadedChapters[entry.number] = {
                        title: `Chapter ${entry.number} `,
                        dataDump: normalizeChapterText(text),
                        pdfPath: entry.pdfPath,
                        textPath: entry.textPath,
                        docxPath: entry.docxPath
                    };
                    continue;
                }
            }

            const docxResponse = await fetch(entry.docxPath, { cache: 'no-store' });
            if (!docxResponse.ok) continue;
            await loadMammoth();
            const arrayBuffer = await docxResponse.arrayBuffer();
            const extracted = await mammoth.extractRawText({ arrayBuffer });
            const text = extracted.value || '';
            if (text.trim()) {
                loadedChapters[entry.number] = {
                    title: `Chapter ${entry.number} `,
                    dataDump: normalizeChapterText(text),
                    pdfPath: entry.pdfPath,
                    textPath: entry.textPath,
                    docxPath: entry.docxPath
                };
            }
        } catch (error) {
            console.warn(`Could not load ${entry.textPath} `, error);
        }
    }

    if (Object.keys(loadedChapters).length) {
        // Merge fresh results into existing state, and PRESERVE the currently
        // selected chapter (if it is still available) instead of always forcing
        // chapter 1. This way a refresh never yanks the user back to the start.
        if (!chapterUploadState.chapters) chapterUploadState.chapters = {};
        Object.assign(chapterUploadState.chapters, loadedChapters);
        if (!isChapterAvailable(chapterUploadState.activeChapter)) {
            for (let n = 1; n <= 5; n++) {
                if (isChapterAvailable(n)) { chapterUploadState.activeChapter = n; break; }
            }
        }
        saveChapterState();
    }
}

function parseDocxChapters(text) {
    const normalized = (text || '').replace(/\r/g, '\n').trim();
    if (!normalized) {
        return {};
    }

    const chapterMatches = [...normalized.matchAll(/\bchapter\s*(i|ii|iii|iv|v|[1-5])\b/gi)];
    if (chapterMatches.length > 0) {
        const parsedChapters = {};
        chapterMatches.forEach((match, index) => {
            const chapterLabel = match[1].toLowerCase();
            const chapterNumber = romanToNumber(chapterLabel) || Number(chapterLabel);
            const startIndex = match.index + match[0].length;
            const endIndex = chapterMatches[index + 1] ? chapterMatches[index + 1].index : normalized.length;
            const content = normalized.slice(startIndex, endIndex).replace(/\s+/g, ' ').trim();
            if (chapterNumber >= 1 && chapterNumber <= 5 && content) {
                parsedChapters[chapterNumber] = content;
            }
        });
        return parsedChapters;
    }

    return { 1: normalized.replace(/\s+/g, ' ').trim() };
}

function romanToNumber(value) {
    const romanMap = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
    return romanMap[value.toLowerCase()] || null;
}

function loadChatHistory() {
    const messagesContainer = document.getElementById('chatbotMessages');
    messagesContainer.innerHTML = '<div class="message bot-message">Hello! I\'m your research assistant. How can I help you today?</div>';

    chatHistory.forEach(msg => {
        addMessageToChat(msg.content, msg.role === 'user' ? 'user' : 'bot');
    });
}

function performFlip() {
    // Always allow flipping, even in the default/pre-generation state
    // (executionPointerIndex === -1), so the card reacts to taps immediately.
    // Once a card is generated, syncCardDisplaySurface() resets the card to
    // the front side and the flip keeps working normally.
    document.getElementById('flashcard').classList.toggle('flipped');
}

function setDifficulty(difficulty) {
    currentDifficulty = difficulty;

    document.querySelectorAll('.btn-difficulty').forEach(btn => {
        btn.style.opacity = '0.7';
        btn.style.transform = 'none';
        btn.style.borderBottomWidth = '4px';
        btn.setAttribute('aria-pressed', 'false');
    });

    const selectedBtn = document.querySelector(`.btn-${difficulty}`);
    if (selectedBtn) {
        selectedBtn.style.opacity = '1';
        selectedBtn.style.transform = 'translateY(2px)';
        selectedBtn.style.borderBottomWidth = '2px';
        selectedBtn.setAttribute('aria-pressed', 'true');
    }
}

// ---------------------------------------------------------------------------
// DYNAMIC MULTI-COMPONENT SELECTOR (pill-based UI)
// ---------------------------------------------------------------------------
// Replaces the static single-select dropdown with a dynamic multi-select
// checkbox pill container generated on-the-fly from the parsed headings
// of the loaded chapter. Students can select multiple sections and get
// combined flashcard questions.

function populateComponentPills() {
    const container = document.getElementById('componentPillsContainer');
    const hint = document.getElementById('componentHint');
    if (!container) return;

    const availableOptions = getChapterOptions(currentChapter);
    container.innerHTML = '';

    availableOptions.forEach((option) => {
        if (!option.available) return;

        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'component-pill';
        pill.dataset.key = option.key;
        pill.textContent = option.name;
        pill.setAttribute('role', 'checkbox');
        pill.setAttribute('aria-checked', selectedComponents.has(option.key) ? 'true' : 'false');

        if (selectedComponents.has(option.key)) {
            pill.classList.add('selected');
        }

        pill.addEventListener('click', () => toggleComponentPill(option.key));
        container.appendChild(pill);
    });

    // Update hint text
    if (hint) {
        const selected = [...selectedComponents];
        if (selected.includes('all') || selected.length === 0) {
            hint.textContent = 'All components selected (random mode).';
        } else {
            const selectedNames = availableOptions
                .filter((o) => selectedComponents.has(o.key))
                .map((o) => o.name)
                .join(', ');
            hint.textContent = `Selected: ${selectedNames}`;
        }
    }
}

function toggleComponentPill(key) {
    if (key === 'all') {
        // "All" is exclusive - selecting it clears everything else
        selectedComponents.clear();
        selectedComponents.add('all');
        currentComponent = 'all';
    } else {
        // Toggle the specific component
        if (selectedComponents.has(key)) {
            selectedComponents.delete(key);
        } else {
            selectedComponents.add(key);
        }
        // Remove 'all' if selecting specific components
        selectedComponents.delete('all');

        // If nothing selected, fall back to 'all'
        if (selectedComponents.size === 0) {
            selectedComponents.add('all');
        }

        // Update currentComponent to first selected (for backward compat)
        currentComponent = [...selectedComponents][0] || 'all';
    }

    // Update pill visual states
    document.querySelectorAll('.component-pill').forEach((pill) => {
        const pillKey = pill.dataset.key;
        const isSelected = selectedComponents.has(pillKey);
        pill.classList.toggle('selected', isSelected);
        pill.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });

    // Update hint
    populateComponentPills();

    dbgLog('toggleComponentPill', 'Selected components:', [...selectedComponents]);
}

function getSelectedComponents() {
    return [...selectedComponents];
}

// Merge text from multiple sections (for multi-select flashcard generation)
function selectSectionsForComponents(scope, componentKeys) {
    if (!componentKeys || componentKeys.length === 0) {
        return scope.dataDump;
    }

    // If 'all' is selected, use the whole chapter
    if (componentKeys.includes('all')) {
        return scope.dataDump;
    }

    const sections = splitChapterIntoSections(scope.dataDump);
    if (sections.length === 0) return scope.dataDump;

    const mergedTexts = [];

    for (const key of componentKeys) {
        const keywords = COMPONENT_KEYWORDS[key];
        if (!keywords) continue;

        let bestSection = null;
        let bestScore = 0;

        for (const section of sections) {
            let score = 0;
            for (const kw of keywords) {
                if (section.text.toLowerCase().includes(kw)) score += 1;
                if (section.heading.toLowerCase().includes(kw)) score += 2;
            }
            if (score > bestScore) {
                bestScore = score;
                bestSection = section;
            }
        }

        if (bestSection) {
            mergedTexts.push(`[${bestSection.heading}]\n${bestSection.text}`);
        }
    }

    if (mergedTexts.length === 0) {
        return scope.dataDump;
    }

    return mergedTexts.join('\n\n');
}

// ---------------------------------------------------------------------------
// CITATION-REFERENCE CROSS-LINKING (sentence-level RAG)
// ---------------------------------------------------------------------------
// Scans for citation patterns (e.g., (Smith, 2020)) in the text and user
// queries, then searches the References section line-by-line to inject
// only the matching citation lines into the AI context.

const CITATION_PATTERNS = [
    // (Author, Year) or (Author Year)
    /\(([A-Z][a-zA-Z''-]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-zA-Z''-]+))?(?:\s*,\s*\d{4}[a-z]?)?)\)/g,
    // Author (Year) - name followed by year in parentheses
    /([A-Z][a-zA-Z''-]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-zA-Z''-]+))?)\s*\((\d{4}[a-z]?)\)/g,
    // Year-only citations like (2020) or (Smith, 2020)
    /\((\d{4}[a-z]?)\)/g
];

// Extract all citation keys from a text
function extractCitations(text) {
    const citations = new Set();
    const patterns = [
        /\(([A-Z][a-zA-Z''-]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-zA-Z''-]+))?(?:\s*,\s*)?(\d{4}[a-z]?)?)\)/g,
        /([A-Z][a-zA-Z''-]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-zA-Z''-]+))?)\s*\((\d{4}[a-z]?)\)/g
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const citation = match[1].trim();
            if (citation.length > 1) {
                citations.add(citation);
            }
        }
    }

    return [...citations];
}

// Find the References section in the chapter text
function findReferencesSection(text) {
    const lines = text.split('\n');
    let inReferences = false;
    const refLines = [];

    for (const line of lines) {
        const trimmed = line.trim();
        // Detect References heading
        if (/^references$/i.test(trimmed) || /^\*\*references\*\*$/i.test(trimmed)) {
            inReferences = true;
            continue;
        }
        // Stop at next major section
        if (inReferences && /^[*]{0,2}\s*[A-Z][A-Z\s]{3,}$/.test(trimmed)) {
            break;
        }
        if (inReferences && trimmed) {
            refLines.push(trimmed);
        }
    }

    return refLines.join('\n');
}

// Match citations to reference lines
function matchCitationsToReferences(text, citations) {
    if (!citations || citations.length === 0) return '';

    const refSection = findReferencesSection(text);
    if (!refSection) return '';

    const refLines = refSection.split('\n').filter((l) => l.trim());
    const matchedLines = [];

    for (const citation of citations) {
        // Extract author name and year from citation
        const authorMatch = citation.match(/^([A-Z][a-zA-Z''-]+)/);
        const yearMatch = citation.match(/(\d{4})/);

        if (!authorMatch) continue;

        const author = authorMatch[1].toLowerCase();
        const year = yearMatch ? yearMatch[1] : null;

        for (const line of refLines) {
            const lineLower = line.toLowerCase();
            // Match by author name
            if (lineLower.includes(author)) {
                // If year is specified, also check for it
                if (!year || lineLower.includes(year)) {
                    matchedLines.push(line);
                    break; // One match per citation
                }
            }
        }
    }

    if (matchedLines.length === 0) return '';

    return '\n\nREFERENCES (relevant):\n' + matchedLines.join('\n');
}

// Inject citation references into the chapter text for AI context
function injectCitationReferences(text, query) {
    // Extract citations from both the chapter text and the query
    const textCitations = extractCitations(text);
    const queryCitations = extractCitations(query);
    const allCitations = [...new Set([...textCitations, ...queryCitations])];

    if (allCitations.length === 0) return text;

    const refs = matchCitationsToReferences(text, allCitations);
    if (!refs) return text;

    return text + refs;
}

function setComponentFromDropdown() {
    const dropdown = document.getElementById('componentDropdown');
    currentComponent = dropdown.value;
}

function getComponentDisplayName() {
    const selected = getChapterOptions(currentChapter).find((option) => option.key === currentComponent);
    return selected?.name || 'the selected component';
}

// Ensure the chapter files have been loaded, then return the scope for the
// currently selected chapter. Throws with a user-friendly message if the
// selected chapter has no file content, so the AI is never asked to improvise.
async function ensureChapterContent() {
    const activeChapter = chapterUploadState.activeChapter;
    dbgLog('ensureChapterContent', 'Checking chapter', activeChapter,
        'loaded chapters:', Object.keys(chapterUploadState.chapters || {}));
    if (!chapterUploadState.chapters || Object.keys(chapterUploadState.chapters).length === 0) {
        dbgLog('ensureChapterContent', 'No chapters cached, loading from folder...');
        await loadChapterFilesFromFolder();
    }
    const scope = getChapterScope(activeChapter);
    dbgLog('ensureChapterContent', 'Chapter', activeChapter,
        'dataDump length:', scope.dataDump ? scope.dataDump.length : 0);
    if (!scope.dataDump) {
        const errMsg =
            `No chapter content found for Chapter ${activeChapter}. Please add ` +
            `/data/chapters/chapter-${activeChapter}.txt (or .docx) and refresh, ` +
            `then select a chapter that has an uploaded file.`;
        dbgError('ensureChapterContent', errMsg);
        throw new Error(errMsg);
    }
    return scope;
}

// Inline, non-blocking spinner state for the "Generate Flashcard" button.
// Replaces the old full-screen overlay so the app never feels "stuck".
function setGenerateButtonBusy(busy, statusText) {
    const btn = document.querySelector('.btn-generate-large');
    if (!btn) return;
    if (busy) {
        if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.innerHTML;
        btn.classList.add('is-loading');
        btn.setAttribute('disabled', 'disabled');
        btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>' +
            '<span class="btn-label">' + (statusText || 'Generating...') + '</span>';
    } else {
        btn.classList.remove('is-loading');
        btn.removeAttribute('disabled');
        if (btn.dataset.origLabel) {
            btn.innerHTML = btn.dataset.origLabel;
            delete btn.dataset.origLabel;
        }
    }
}

// Toggle the opaque cover layer that sits over the flashcard while a new
// question is being generated. This gives clear visual feedback that the
// previous card is being replaced and blocks accidental flips/taps.
// The label behind the spinner switches based on which side of the card is
// currently visible (front = "Generating Question", back = "Generating Answer").
// The card itself is NOT flipped/inverted while the cover is up.
const DEFAULT_COVER_LABEL = 'Generating Question...';
function setCardCover(visible, label) {
    const loader = document.getElementById('loader');
    if (!loader) return;
    loader.style.display = visible ? 'flex' : 'none';
    loader.setAttribute('aria-busy', visible ? 'true' : 'false');
    const labelEl = document.getElementById('loaderLabel');
    if (labelEl) {
        labelEl.textContent = label || DEFAULT_COVER_LABEL;
    }
    // Keep the current card orientation while the cover is up (no inversion).
    // Note: we intentionally do NOT toggle the 'flipped' class here so the
    // card stays exactly as the user left it (front or back) under the cover.
}

async function triggerInterrogation() {
    try {
        // 1. Check if history limit reached
        if (generatedCardsCollection.length >= MAX_HISTORY_SIZE) {
            alert('Your lesson history is getting very full! Please Reset Levels to keep performance fast. Maximum ' + MAX_HISTORY_SIZE + ' items allowed.');
            return;
        }

        // Prevent double-clicks while a request is already in flight.
        const btn = document.querySelector('.btn-generate-large');
        if (btn && btn.classList.contains('is-loading')) return;

        // Cooldown between generations to protect the Groq TPM budget. If the user
        // clicks too soon, show a friendly "warming up" message instead of firing
        // another request that would likely hit a 429.
        const elapsed = Date.now() - lastGenerationAt;
        if (lastGenerationAt > 0 && elapsed < GENERATION_COOLDOWN_MS) {
            const waitSec = Math.ceil((GENERATION_COOLDOWN_MS - elapsed) / 1000);
            showErrorModal('The AI is warming up. Please wait about ' + waitSec + ' second(s) before generating another flashcard.');
            return;
        }

        // Show "Thinking..." on the button and an opaque cover over the flashcard.
        setGenerateButtonBusy(true, 'Thinking...');
        // Detect which side of the card is currently visible so the cover label
        // reads "Generating Answer" when the user is on the answer side.
        const cardIsFlipped = document.getElementById('flashcard').classList.contains('flipped');
        setCardCover(true, cardIsFlipped ? 'Generating Answer...' : 'Generating Question...');

        // 2. Prepare the prompt with difficulty and component
        let scopeMetadata;
        try {
            scopeMetadata = await ensureChapterContent();
        } catch (e) {
            setGenerateButtonBusy(false);
            setCardCover(false);
            showErrorModal(e.message);
            return;
        }

        // Multi-select component handling. The selected pill keys drive which
        // components the server-side retrieval should boost. The full research is
        // indexed in the persistent knowledge base, so the server retrieves the
        // relevant chunks. When "all" is selected we pass it through as-is so the
        // server treats it as cross-component retrieval (no component boost).
        const availableComponents = getChapterOptions(currentChapter)
            .filter((option) => option.available && option.key !== 'all');
        const selectedKeys = getSelectedComponents();
        const hasSpecificSelection = selectedKeys.length > 0 && !selectedKeys.includes('all');
        // The component keys sent to the server for metadata-aware retrieval.
        const selectedComponentsForApi = hasSpecificSelection ? selectedKeys : ['all'];

        // Randomly rotate question angles so consecutive generations stay varied.
        const questionAngles = [
            'ask them to justify a specific choice they made (for example, a design, method, sampling technique, or instrument) and explain why it was appropriate',
            'ask them to explain a key concept or term from the proposal and how it applies to their study',
            'ask them to identify and elaborate on a specific detail such as the number of respondents, the variables, the indicators, or the statistical test used',
            'ask them how they will address a practical concern such as bias, validity, reliability, or respondent honesty',
            'ask them to connect one part of their study (theoretical framework, problem, methodology) to another and justify the link',
            'ask them about the expected contribution, significance, or limitations of their study based only on what they wrote',
            'ask them to clarify the exact procedure or step they will follow for a given activity',
            'challenge them on a potential weakness or inconsistency visible in their proposal and ask how they will defend or address it'
        ];
        const randomAngle = questionAngles[Math.floor(Math.random() * questionAngles.length)];

        let difficultyPrompt = "";
        switch (currentDifficulty) {
            case 'easy':
                difficultyPrompt = "Ask a basic, factual question that focuses on fundamental concepts and data directly stated in the proposal.";
                break;
            case 'medium':
                difficultyPrompt = "Ask a moderate question that tests understanding of the methodology and application of the research data.";
                break;
            case 'hard':
                difficultyPrompt = "Ask a challenging question that requires critical analysis, deeper reasoning, and interpretation of the proposal's methodology and implications.";
                break;
        }

        let componentPrompt = "";
        if (hasSpecificSelection) {
            // Multiple sections selected — tell the AI to draw from all of them.
            const selectedNames = availableComponents
                .filter((option) => selectedKeys.includes(option.key))
                .map((option) => option.name);
            if (selectedNames.length) {
                componentPrompt = `Focus the question on the following sections of the research proposal: ${selectedNames.join(' and ')}. Draw from the combined content of these sections.`;
            } else {
                componentPrompt = "Focus on any key aspect of the research proposal.";
            }
        } else {
            const randomComponent = availableComponents[Math.floor(Math.random() * availableComponents.length)] || { name: 'main aspect' };
            componentPrompt = `Focus the question specifically on the ${randomComponent.name} section of the research proposal.`;
        }


        const instructionPrompt = `You are a strict, highly critical Senior High School research panel defense judge. Your sole source of absolute truth is the retrieved research content provided by the system.

CRITICAL EXECUTION PROTOCOLS:
1. TRUST THE DATA: When evaluating a question, you must read all retrieved sections of the matching proposal.
2. EXTRACTION OVER GUESSING: If the information is present or clearly implied by their methodology / sampling, extract it. Do NOT guess outside information.
3. NO LAZY REFUSALS: You are prohibited from responding with "This information is not explicitly detailed" if the answer can be synthesized from the retrieved text.
4. QUESTION FORMAT: Frame questions as if directly asking the researchers (e.g., "What sampling method did you use?" not "According to your...").
5. ANSWER FORMAT: Frame answers in third person plural ('The researchers...') as if the researchers are responding.
6. CONTEXTUAL LIMITATION: ONLY use information from the retrieved research content provided by the system.
7. RESPONSE FORMAT: Provide ONLY valid JSON in this exact format: { "question": "your question here", "answer": "your answer here" }.
8. VARIETY: The question and answer must be concrete and specific to the retrieved content. Do NOT use generic template questions nor generic template answers. Quote or directly reference specific facts, names, numbers, or methods found in the retrieved research.
9. UNIQUENESS: Generate a fresh, distinct question / answer pair each time. Vary the focus and wording; never repeat the same generic phrasing across generations.

Now, as a panelist, ${randomAngle}. ${difficultyPrompt} ${componentPrompt} Base your question and the researchers' answer (in third person plural 'The researchers...') ONLY on information found in the retrieved research content. Provide the question and answer in JSON format: { "question": "...", "answer": "..." } `;

        let structuredData = null;
        let generationError = null;
        // Only 2 attempts, and a real error (network/429/500/parse failure) now
        // stops the loop immediately instead of trying again - see the `break`
        // in the catch block below. The loop only continues past attempt 1 when
        // the AI returned a perfectly valid answer that happened to be a
        // near-duplicate of a recent question. This, combined with /api/chat.js
        // no longer retrying the same rate-limited model, is what stops a single
        // click from silently firing a dozen-plus requests at Groq.
        const MAX_GENERATION_ATTEMPTS = 2;
        for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
            try {
                const seed = Date.now() + attempt;
                const controller = new AbortController();
                // Fail-fast client cap: 15s. If the request exceeds this the user
                // gets a clear error instantly instead of an endless spinner.
                const timeout = setTimeout(() => controller.abort(), 15000);
                let response;
                try {
                    response = await fetch("/api/chat", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            prompt: instructionPrompt,
                            json: true,
                            seed,
                            accessToken: getAccessToken(),
                            selectedComponents: selectedComponentsForApi,
                            selectedChapter: currentChapter
                        }),
                        signal: controller.signal
                    });
                } catch (err) {
                    clearTimeout(timeout);
                    if (err.name === 'AbortError') {
                        throw new Error('The AI service took too long to respond. Please try again.');
                    }
                    throw err;
                }
                clearTimeout(timeout);

                if (!response.ok) {
                    const errBody = await response.json().catch(() => ({}));
                    throw new Error(`${errBody.error || ('Server error ' + response.status)}`);
                }

                const parsedPackage = await response.json();

                let candidate;
                try {
                    candidate = JSON.parse(parsedPackage.choices[0].message.content);
                } catch (parseError) {
                    const content = parsedPackage.choices[0].message.content;
                    const jsonMatch = content.match(/\{.*\}/s);
                    if (jsonMatch) {
                        candidate = JSON.parse(jsonMatch[0]);
                    } else {
                        throw new Error("Could not extract valid JSON from AI response");
                    }
                }

                if (!validateFlashcardCandidate(candidate)) {
                    throw new Error("AI response missing question or answer");
                }

                // Reject near-duplicate questions so consecutive generations stay fresh.
                if (!isNearDuplicateQuestion(candidate.question)) {
                    structuredData = candidate;
                    rememberRecentQuestion(candidate.question);
                    break;
                }
                dbgLog('triggerInterrogation', `Attempt ${attempt + 1} produced a near-duplicate question; regenerating...`);
            } catch (error) {
                // Fail fast: the server (/api/chat.js) already tried a primary
                // model and a fallback model internally, so a real error here
                // means both failed. Looping again from the client would just
                // fire another full primary+fallback round at an already
                // rate-limited or unavailable service. Surface the error instead.
                generationError = error;
                dbgError('triggerInterrogation', 'AI generation failed on attempt ' + (attempt + 1), error);
                break;
            }
        } // end for loop

        if (!generationError && !structuredData && recentQuestions.length) {
            // Ensure any unexpected error also surfaces as a user-friendly message.
            dbgLog('triggerInterrogation', 'No structured data generated after all attempts');
        }

        if (!structuredData) {
            setGenerateButtonBusy(false);
            setCardCover(false);
            showErrorModal(generationError && generationError.message
                ? generationError.message
                : 'The AI service is currently unavailable. Please try again later.');
            return;
        }

        generatedCardsCollection.push({
            id: Date.now(),
            label: `${scopeMetadata.title.replace(/\s+/g, ' ').trim()}`,
            question: structuredData.question,
            answer: structuredData.answer,
            difficulty: currentDifficulty,
            component: currentComponent,
            timestamp: new Date().toISOString(),
            favorite: false
        });

        executionPointerIndex = generatedCardsCollection.length - 1;
        localStorage.setItem('mcesi_sim_history', JSON.stringify(generatedCardsCollection));

        // Record the completion time so the cooldown gate above prevents rapid
        // back-to-back generations that would trigger Groq 429 rate limits.
        lastGenerationAt = Date.now();

        // Restore the button label and remove the flashcard cover now that the
        // new card is ready to show.
        setGenerateButtonBusy(false);
        setCardCover(false);

        renderHistoryPanelUI();
        syncCardDisplaySurface();
        if (typeof trackEvent === 'function') {
            trackEvent('flashcard', { chapter: scopeMetadata.title, difficulty: currentDifficulty, component: currentComponent });
        }
    } catch (unexpected) {
        dbgError('triggerInterrogation', unexpected);
        setGenerateButtonBusy(false);
        setCardCover(false);
        showErrorModal(unexpected.message || 'Something went wrong. Please try again.');
    }
}


function syncCardDisplaySurface() {
    if (executionPointerIndex === -1) return;
    const cardContext = generatedCardsCollection[executionPointerIndex];
    document.getElementById('flashcard').classList.remove('flipped');
    setTimeout(() => {
        document.getElementById('frontTag').innerText = `${cardContext.label} - ${cardContext.difficulty.charAt(0).toUpperCase() + cardContext.difficulty.slice(1)} `;
        document.getElementById('frontText').innerText = cardContext.question;
        document.getElementById('backText').innerText = cardContext.answer;

        // Update history item active state
        document.querySelectorAll('.history-item').forEach((element, DOMIdx) => {
            element.classList.toggle('active', DOMIdx === executionPointerIndex);
        });

        // Update favorite button state
        updateFavoriteButton();
    }, 150);
}


let currentFilter = 'all';

function filterHistory(filter) {
    currentFilter = filter;

    // Update button states
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Find the clicked button and make it active
    const buttons = document.querySelectorAll('.filter-btn');
    for (let btn of buttons) {
        if (btn.textContent.toLowerCase().includes(filter.toLowerCase())) {
            btn.classList.add('active');
            break;
        }
    }

    renderHistoryPanelUI();
}

// renderHistoryPanelUI() with filtering support (single source of truth)
function renderHistoryPanelUI() {
    const trackingListContainer = document.getElementById('historyList');
    trackingListContainer.innerHTML = '';

    // Build a list of { card, originalIndex } so handlers mutate the correct item
    let items = generatedCardsCollection
        .map((card, originalIndex) => ({ card, originalIndex }));

    if (currentFilter === 'favorites') {
        items = items.filter(({ card }) => card.favorite);
    }

    items.forEach(({ card: cardInstance, originalIndex }, visibleIndex) => {
        const isActive = originalIndex === executionPointerIndex;

        const executionListItem = document.createElement('li');
        executionListItem.className = `history-item ${isActive ? 'active' : ''}`;

        executionListItem.innerHTML = `
    <span class="history-item-label">Q${visibleIndex + 1}: ${cardInstance.label} (${cardInstance.difficulty})</span>
        <button class="delete-btn" onclick="deleteHistoryItem(event, ${originalIndex})">🗑️</button>
        <button class="favorite-btn ${cardInstance.favorite ? 'favorited' : ''}" onclick="toggleFavorite(event, ${originalIndex})">★</button>
        <button class="history-report-btn" onclick="reportCardFromHistory(event, ${originalIndex})" title="Report inaccurate content">🚩</button>
    `;

        executionListItem.onclick = (clickEvent) => {
            if (clickEvent.target.classList.contains('delete-btn') ||
                clickEvent.target.classList.contains('favorite-btn') ||
                clickEvent.target.classList.contains('history-report-btn')) {
                return; // Don't select if clicking delete, favorite, or report
            }

            clickEvent.stopPropagation();
            executionPointerIndex = originalIndex;
            syncCardDisplaySurface();

            // Close sidebar automatically on mobile when a lesson is picked
            if (window.innerWidth < 768) { toggleSidebar(); }
        };

        trackingListContainer.appendChild(executionListItem);
    });
}


function updateFavoriteButton() {
    if (executionPointerIndex === -1) return;
    const card = generatedCardsCollection[executionPointerIndex];
    const favoriteButtons = document.querySelectorAll('.btn-favorite-action');
    favoriteButtons.forEach(btn => {
        btn.textContent = card.favorite ? '★' : '☆';
        btn.style.color = card.favorite ? '#ffc800' : 'white';
    });
}

function toggleFavoriteCurrent(event) {
    event.stopPropagation();
    if (executionPointerIndex === -1) return;

    generatedCardsCollection[executionPointerIndex].favorite =
        !generatedCardsCollection[executionPointerIndex].favorite;
    localStorage.setItem('mcesi_sim_history', JSON.stringify(generatedCardsCollection));
    updateFavoriteButton();
    renderHistoryPanelUI();
}

function toggleFavorite(event, index) {
    event.stopPropagation();
    generatedCardsCollection[index].favorite = !generatedCardsCollection[index].favorite;
    localStorage.setItem('mcesi_sim_history', JSON.stringify(generatedCardsCollection));
    renderHistoryPanelUI();
}

function deleteHistoryItem(event, index) {
    event.stopPropagation();
    if (confirm("Are you sure you want to delete this flashcard?")) {
        generatedCardsCollection.splice(index, 1);
        if (executionPointerIndex >= generatedCardsCollection.length) {
            executionPointerIndex = generatedCardsCollection.length - 1;
        }
        localStorage.setItem('mcesi_sim_history', JSON.stringify(generatedCardsCollection));
        renderHistoryPanelUI();
        syncCardDisplaySurface();
    }
}

function openModal() {
    document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
}

// Generic AI-error modal. Does NOT reveal which provider/model is used.
function showErrorModal(message) {
    const overlay = document.getElementById('error-modal-overlay');
    const textEl = document.getElementById('errorModalText');
    if (!overlay || !textEl) return;
    textEl.textContent = message || 'The AI service is currently unavailable. Please try again later.';
    overlay.style.display = 'flex';
}

function closeErrorModal() {
    const overlay = document.getElementById('error-modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

// Clear favorites only (keeps all other flashcards intact).
function clearFavorites() {
    const favoriteCount = generatedCardsCollection.filter((c) => c.favorite).length;
    if (favoriteCount === 0) {
        alert('No favorites to clear.');
        return;
    }
    if (!confirm(`Remove favorite status from ${favoriteCount} flashcard(s)? The cards themselves will be kept.`)) {
        return;
    }
    generatedCardsCollection.forEach((c) => { c.favorite = false; });
    localStorage.setItem('mcesi_sim_history', JSON.stringify(generatedCardsCollection));
    renderHistoryPanelUI();
    updateFavoriteButton();
    if (typeof trackEvent === 'function') trackEvent('clear_favorites', { count: favoriteCount });
}

function executeReset() {
    if (confirm("Are you sure you want to delete ALL your saved lessons? This cannot be undone.")) {
        localStorage.removeItem('mcesi_sim_history');
        generatedCardsCollection = [];
        executionPointerIndex = -1;
        document.getElementById('historyList').innerHTML = '';
        document.getElementById('frontTag').innerText = "Select Lesson";
        document.getElementById('frontText').innerText = "Choose a proposal above. The panel will ask you a question about your research.";
        document.getElementById('backText').innerText = "The researchers' defense answer will appear here.";
        document.getElementById('flashcard').classList.remove('flipped');
        closeModal();
        toggleSidebar(); // Close sidebar after reset
    }
}

async function exportToPDF() {
    if (generatedCardsCollection.length === 0) {
        alert("No flashcards to export!");
        return;
    }

    // Lazy-load jsPDF on first use so it doesn't block initial render.
    try {
        await loadJsPdf();
    } catch (e) {
        showErrorModal(e.message);
        return;
    }

    // Use jsPDF to create and download PDF
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Compact layout: 9pt font, narrow margins, two columns, tight line spacing,
    // no separator lines. This keeps a large batch of flashcards on as few pages
    // as possible for printing/handouts.
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const marginX = 12;
    const marginY = 12;
    const gutter = 8;                        // gap between the two columns
    const colWidth = (pageWidth - marginX * 2 - gutter) / 2;
    const lineH = 3.4;                       // ~1.0 line spacing at 9pt

    // Track the current column cursor { x, y }.
    const col = { x: marginX, y: marginY };

    const ensureSpace = (needed) => {
        if (col.y + needed > pageHeight - marginY) {
            doc.addPage();
            col.x = marginX;
            col.y = marginY;
        }
    };

    // Move to the next column when the current one runs short on space,
    // preferring the right-hand column before opening a new page.
    const nextCell = () => {
        if (col.x === marginX) {
            col.x += colWidth + gutter;
            col.y = marginY;
        } else {
            col.x = marginX;
            col.y = marginY;
        }
    };

    // Header block spanning the full page width.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Research Defense Practice", pageWidth / 2, marginY, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Exported on: ${new Date().toLocaleDateString()}`, pageWidth / 2, marginY + 5, { align: "center" });
    doc.setFontSize(8);
    doc.text("Group: Gonzales, Manarang, Almario, Bondoc, Casupanan, Dizon", pageWidth / 2, marginY + 10, { align: "center" });

    // Reset cursor below the header.
    col.x = marginX;
    col.y = marginY + 16;

    generatedCardsCollection.forEach((card, index) => {
        const heading = `FLASHCARD #${index + 1} (${(card.difficulty || '').toUpperCase()})`;
        const topic = `Topic: ${card.label}`;
        const question = `Question: ${card.question}`;
        const answer = `Answer: ${card.answer}`;
        const timestamp = `Generated: ${new Date(card.timestamp).toLocaleString()}`;
        const favFlag = card.favorite ? " [Favorite]" : "";

        // Measure how tall this card's column block will be (middle section first,
        // then the two text blocks which can wrap).
        const qLines = doc.splitTextToSize(question, colWidth);
        const aLines = doc.splitTextToSize(answer, colWidth);

        // Heading + 2 bold label lines + question block + empty line + answer
        // block + timestamp line + trailing gap.
        const needed = 3 * lineH + qLines.length * lineH + lineH + aLines.length * lineH + lineH + 2;

        ensureSpace(needed);

        // FLASHCARD # heading (bold).
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(heading + favFlag, col.x, col.y);
        col.y += lineH;

        // Topic line (bold).
        doc.text(topic, col.x, col.y);
        col.y += lineH;

        // Question + answer blocks (normal weight, line-height 1 on the x-axis).
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.text(qLines, col.x, col.y);
        col.y += qLines.length * lineH + lineH;

        doc.text(aLines, col.x, col.y);
        col.y += aLines.length * lineH + lineH;

        doc.setFontSize(7.5);
        doc.setTextColor(120);
        doc.text("Topic · " + timestamp, col.x, col.y);
        doc.setTextColor(0);
        col.y += 2;

        nextCell();
    });

    // Save the PDF
    doc.save(`research-defense-practice-${new Date().toISOString().slice(0, 10)}.pdf`);
    if (typeof trackEvent === 'function') {
        trackEvent('export_pdf', { count: generatedCardsCollection.length });
    }
}

async function captureAndSavePhoto(event) {
    // Prevent the flip when clicking the photo button
    event.stopPropagation();

    if (executionPointerIndex === -1) {
        alert("Please generate a question first before saving a photo!");
        return;
    }

    const photoBtn = document.querySelector('.btn-photo-action');
    const originalText = photoBtn.innerText;
    photoBtn.innerText = "📷";

    const currentCard = generatedCardsCollection[executionPointerIndex];

    document.getElementById('export-title').innerText = `${currentCard.label} Defense Prep`;
    document.getElementById('export-q').innerText = `Q: ${currentCard.question} `;
    document.getElementById('export-a').innerText = `A: ${currentCard.answer} `;

    const exportZone = document.getElementById('photo-export-zone');

    try {
        // Lazy-load html2canvas on first use so it doesn't block initial render.
        try {
            await loadHtml2Canvas();
        } catch (e) {
            alert(e.message);
            return;
        }
        const canvas = await html2canvas(exportZone, { backgroundColor: '#ffffff', scale: 2 });
        const link = document.createElement('a');
        link.download = `ResearchDefense_Q${executionPointerIndex + 1}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        if (typeof trackEvent === 'function') {
            trackEvent('export_photo', { chapter: currentCard.label });
        }
    } catch (error) {
        console.error("Photo Capture Failed:", error);
        alert("Failed to save photo. Please try again.");
    } finally {
        photoBtn.innerText = originalText;
    }
}

function copyText(event, side) {
    event.stopPropagation();
    let textToCopy = "";

    if (side === 'front') {
        const currentCard = generatedCardsCollection[executionPointerIndex];
        if (currentCard) {
            textToCopy = `Topic: ${currentCard.label} \nQ: ${currentCard.question} \nA: ${currentCard.answer} `;
        } else {
            textToCopy = document.getElementById('frontText').innerText;
        }
    } else {
        const currentCard = generatedCardsCollection[executionPointerIndex];
        if (currentCard) {
            textToCopy = `Topic: ${currentCard.label} \nQ: ${currentCard.question} \nA: ${currentCard.answer} `;
        } else {
            textToCopy = document.getElementById('backText').innerText;
        }
    }

    navigator.clipboard.writeText(textToCopy).then(() => {
        // Show feedback on the copy button
        const buttons = document.querySelectorAll('.btn-copy-action');
        buttons.forEach(btn => {
            const originalText = btn.innerText;
            btn.innerText = "✓";
            setTimeout(() => {
                btn.innerText = originalText;
            }, 1000);
        });
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        alert("Failed to copy text to clipboard.");
    });
}

// Report feedback for an inaccurate/incorrect flashcard. Reports are persisted
// to localStorage so the admin dashboard can read them. A confirmation prompt
// collects an optional reason from the user.
//
// A flashcard can only be reported once — the set of already-reported card ids
// is kept in localStorage so repeat reports of the same card are blocked.
const reportedCardIds = new Set(
    (() => {
        try {
            return JSON.parse(localStorage.getItem('reportedCardIds') || '[]');
        } catch (e) {
            return [];
        }
    })()
);

function reportCard(event) {
    event.stopPropagation();
    if (executionPointerIndex === -1) {
        showErrorModal('You need to generate a flashcard first before reporting.');
        return;
    }
    const card = generatedCardsCollection[executionPointerIndex];
    submitCardReport(card, 'Card');
}

// Report a flashcard directly from a history item in the sidebar.
function reportCardFromHistory(event, index) {
    event.stopPropagation();
    const card = generatedCardsCollection[index];
    if (!card) return;
    submitCardReport(card, 'History');
    // Do not switch the selected card / close the sidebar.
}

// Shared reporting logic used by both the on-card 🚩 button and the history
// item 🚩 button. Persists locally AND logs to the centralized backend so all
// users' reports are visible in the admin panel.
function submitCardReport(card, source) {
    // Block duplicate reports of the same flashcard.
    if (reportedCardIds.has(card.id)) {
        showErrorModal('You have already reported this flashcard. Thank you for your feedback!');
        return;
    }

    const reason = prompt(
        'Report this flashcard as inaccurate? (Optional) Tell us what is wrong:',
        ''
    );
    if (reason === null) return; // cancelled

    const report = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        chapter: card.label,
        difficulty: card.difficulty,
        component: card.component,
        question: card.question,
        answer: card.answer,
        reason: (reason || '').trim(),
        source
    };

    // Track this card as reported so it cannot be reported again.
    reportedCardIds.add(card.id);
    try {
        localStorage.setItem('reportedCardIds', JSON.stringify([...reportedCardIds]));
    } catch (e) {
        dbgError('submitCardReport', 'Failed to persist reported card ids', e);
    }

    let reports = [];
    try {
        reports = JSON.parse(localStorage.getItem('cardReports') || '[]');
    } catch (e) {
        reports = [];
    }
    reports.push(report);
    localStorage.setItem('cardReports', JSON.stringify(reports));

    // Also send the full report to the analytics/backend endpoint so it is
    // centralized (all users' reports are stored on the server, not just in
    // each browser's localStorage). The admin panel lists these after login.
    // Best-effort: a failure here must not block the local report from saving.
    try {
        if (typeof trackEvent === 'function') {
            trackEvent('card_report', {
                id: report.id,
                chapter: report.chapter,
                difficulty: report.difficulty,
                component: report.component,
                question: report.question,
                answer: report.answer,
                reason: report.reason,
                source: report.source
            });
        }
    } catch (e) {
        dbgError('submitCardReport', 'Failed to send report to backend', e);
    }

    alert('Thank you! Your report has been logged for review.');
}

// Chatbot functionality
function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

async function sendMessage() {
    const input = document.getElementById('chatbotInput');
    const message = input.value.trim();

    if (!message) return;

    // Add user message to chat
    addMessageToChat(message, 'user');
    input.value = '';

    // Show typing indicator
    const typingIndicator = addMessageToChat('...', 'bot');

    let scopeMetadata;
    try {
        scopeMetadata = await ensureChapterContent();
    } catch (e) {
        typingIndicator.remove();
        addMessageToChat(e.message, 'bot');
        return;
    }

    try {
        // Build the conversation history for memory (last ~10 turns only to
        // keep the token budget low). The chapter content is sent separately
        // as `chapter` so it is NOT re-sent with every message.
        const history = chatHistory.slice(-10).map((msg) => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
        }));
        history.push({ role: 'user', content: message });

        // The server performs retrieval against the persistent knowledge base
        // and injects the relevant context + references into the prompt.

        // Call AI service with memory (messages) + compact chapter context.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        let response;
        try {
            response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: history,
                    accessToken: getAccessToken(),
                    sessionId: getSessionId(),
                    conversationId: getConversationId(),
                    userMessage: message,
                    selectedComponents: ['all'],
                    selectedChapter: currentChapter
                }),
                signal: controller.signal
            });
        } catch (err) {
            clearTimeout(timeout);
            if (err.name === 'AbortError') {
                throw new Error('The AI service took too long to respond. Please try again.');
            }
            throw err;
        }
        clearTimeout(timeout);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${errorData.error || 'Unknown error'}`);
        }

        const data = await response.json();
        // Persist the server-assigned conversation id so later messages in the
        // same session resume the same conversation memory.
        if (data.conversationId) {
            setConversationId(data.conversationId);
        }
        let answer = data.choices[0].message.content;

        // Handle JSON responses
        try {
            const parsedResponse = JSON.parse(answer);
            if (parsedResponse.response) {
                answer = parsedResponse.response;
            } else if (parsedResponse.message) {
                answer = parsedResponse.message;
            }
        } catch (e) {
            // If it's not JSON, use the answer as is
        }

        // Remove typing indicator and add actual response
        typingIndicator.remove();
        addMessageToChat(answer, 'bot');

        // Save to chat history
        chatHistory.push({ role: 'user', content: message });
        chatHistory.push({ role: 'assistant', content: answer });
        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));

        if (typeof trackEvent === 'function') {
            trackEvent('chat', {
                message: message.slice(0, 500),
                botSnippet: answer.slice(0, 500),
                chapter: scopeMetadata.title
            });
        }

    } catch (error) {
        typingIndicator.remove();
        addMessageToChat('Sorry, I could not reach the AI service. Please try again later.', 'bot');
        showErrorModal('The AI service is currently unavailable. Please try again later.');
        console.error('Chatbot error:', error);
    }
}


// Escape HTML to prevent injection, then render a small, safe subset of
// Markdown (bold, italic, inline code, bullet/numbered lists, and line
// breaks) so AI chat replies show up nicely formatted.
function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeHtmlSafe(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderMarkdown(text) {
    if (!text) return '';
    let html = escapeHtmlSafe(text);

    // Code blocks (```...```) -> <pre><code>
    html = html.replace(/```([\s\S]*?)```/g, (m, code) => `<pre class="md-code"><code>${code}</code></pre>`);

    // Inline code `...`
    html = html.replace(/`([^`]+)`/g, (m, code) => `<code class="md-code-inline">${code}</code>`);

    // Bold **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic *text*
    html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

    // Headings (# .. #####)
    html = html.replace(/^#####\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^###\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^##\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^#\s+(.+)$/gm, '<h2>$1</h2>');

    // Unordered lists
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\s*)+)/g, '<ul>$1</ul>');
    // Ordered lists
    html = html.replace(/^\s*(\d+)\.\s+(.+)$/gm, '<li value="$1">$2</li>');
    html = html.replace(/((?:<li value="\d+">.*<\/li>\s*)+)/g, '<ol>$1</ol>');

    // Line breaks
    html = html.replace(/\n{2,}/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    html = `<p>${html}</p>`;
    // Collapse empty paragraphs
    html = html.replace(/<p><\/p>/g, '');
    return html;
}

function addMessageToChat(message, sender) {
    const messagesContainer = document.getElementById('chatbotMessages');
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.classList.add(sender + '-message');

    // Render basic Markdown for bot messages (safe HTML), plain text for user.
    if (sender === 'bot') {
        messageElement.innerHTML = renderMarkdown(message);
    } else {
        messageElement.textContent = message;
    }

    // Add long press copy functionality for bot messages
    if (sender === 'bot') {
        messageElement.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            navigator.clipboard.writeText(message).then(() => {
                // Show temporary feedback
                const originalText = messageElement.textContent;
                messageElement.textContent = "Copied!";
                setTimeout(() => {
                    messageElement.textContent = originalText;
                }, 1000);
            });
        });
    }

    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return messageElement;
}


// Dark Mode Functionality
function toggleDarkMode() {
    const isDarkMode = document.documentElement.classList.toggle('dark-mode');

    // Update button icon
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
        darkModeToggle.textContent = isDarkMode ? '☀️' : '🌙';
    }

    // Persist preference
    localStorage.setItem('darkMode', String(isDarkMode));

    // Update main content background
    const mainContent = document.querySelector('.main-content');
    if (isDarkMode) {
        mainContent.style.background = '#1a1a1a';
    } else {
        mainContent.style.background = '#f7f7f7';
    }
}


// Prevent horizontal scrolling
document.body.style.overflowX = 'hidden';
document.body.style.position = 'relative';

// Add viewport meta tag fix if not present
const viewport = document.querySelector('meta[name="viewport"]');
if (viewport) {
    viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
}
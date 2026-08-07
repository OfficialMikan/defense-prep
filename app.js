/* ============================================================
   Defense Prep - App Logic
   ============================================================ */

// Intro Screen
window.addEventListener('load', () => {
    setTimeout(() => {
        const loader = document.getElementById('intro-loader');
        loader.style.opacity = '0';
        setTimeout(() => loader.style.visibility = 'hidden', 500);
    }, 2500);
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

const chapterComponentOptions = {
    1: [
        { key: 'all', name: 'All Components (Random)', available: true },
        { key: 'title', name: 'Title', available: true },
        { key: 'introduction', name: 'Introduction', available: true },
        { key: 'research_design', name: 'Research Design', available: true },
        { key: 'respondents', name: 'Respondents', available: true },
        { key: 'motivation', name: 'Motivation', available: true },
        { key: 'research_gap', name: 'Research Gap', available: true },
        { key: 'statement', name: 'Statement of Problem', available: true },
        { key: 'method', name: 'Research Method', available: true },
        { key: 'references', name: 'References', available: true }
    ],
    2: [
        { key: 'all', name: 'All Components (Random)', available: true },
        { key: 'research_design', name: 'Research Design', available: true },
        { key: 'respondents_participants', name: 'Respondents/Participants', available: true },
        { key: 'instruments', name: 'Instruments', available: true },
        { key: 'ethical_considerations', name: 'Ethical Considerations', available: true },
        { key: 'data_collection', name: 'Data Collection', available: true },
        { key: 'data_analysis', name: 'Data Analysis/Statistical Treatment of Data', available: true },
        { key: 'references', name: 'References', available: true }
    ],
    3: [
        { key: 'unavailable', name: 'Chapter 3 is unavailable for now', available: false }
    ],
    4: [
        { key: 'unavailable', name: 'Chapter 4 is unavailable for now', available: false }
    ],
    5: [
        { key: 'unavailable', name: 'Chapter 5 is unavailable for now', available: false }
    ]
};

let generatedCardsCollection = [];
let executionPointerIndex = -1;
let currentDifficulty = 'medium';
let currentComponent = 'all';
let currentChapter = 1;
let chatHistory = [];
let favorites = [];

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

    // Load favorites
    const savedFavorites = localStorage.getItem('favorites');
    if (savedFavorites) {
        favorites = JSON.parse(savedFavorites);
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
    loadChapterFilesFromFolder().finally(() => {
        populateChapterPreview();
    });

    // Explicitly hide the loader on page load to ensure it's not stuck
    document.getElementById('loader').style.display = 'none';

    // Load dark mode preference
    const savedDarkMode = localStorage.getItem('darkMode');
    if (savedDarkMode === 'true') {
        document.documentElement.classList.add('dark-mode');
        document.getElementById('darkModeToggle').textContent = '☀️';
        // Update main content background
        const mainContent = document.querySelector('.main-content');
        mainContent.style.background = '#1a1a1a';
    }
});

function selectChapter(chapterNumber) {
    chapterUploadState.activeChapter = chapterNumber;
    currentChapter = chapterNumber;
    populateChapterDropdown();
    populateComponentDropdown();
    populateChapterPreview();
}

function populateChapterDropdown() {
    const dropdown = document.getElementById('chapterDropdown');
    if (!dropdown) return;

    dropdown.innerHTML = '';
    [1, 2, 3, 4, 5].forEach((chapterNumber) => {
        const opt = document.createElement('option');
        opt.value = chapterNumber;
        opt.textContent = `Chapter ${chapterNumber}`;
        if (chapterNumber > 2) {
            opt.disabled = true;
            opt.textContent = `Chapter ${chapterNumber} (Unavailable)`;
        }
        dropdown.appendChild(opt);
    });

    dropdown.value = currentChapter;
}

function setChapterFromDropdown() {
    const dropdown = document.getElementById('chapterDropdown');
    const selectedChapter = Number(dropdown.value);
    if (!Number.isNaN(selectedChapter) && selectedChapter <= 2) {
        selectChapter(selectedChapter);
    }
}

function populateComponentDropdown() {
    const dropdown = document.getElementById('componentDropdown');
    const hint = document.getElementById('componentHint');
    if (!dropdown) return;

    const availableOptions = chapterComponentOptions[currentChapter] || chapterComponentOptions[1];
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
        if (currentChapter === 1) {
            hint.textContent = 'Chapter 1 components are available. Chapter 2 options are also ready.';
        } else if (currentChapter === 2) {
            hint.textContent = 'Chapter 2 components are available. Chapters 3–5 are unavailable for now.';
        } else {
            hint.textContent = 'Chapters 3–5 are unavailable for now.';
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

function populateChapterPreview() {
    const previewTitle = document.getElementById('chapterPreviewTitle');
    const contentArea = document.getElementById('chapterContentArea');
    const statusLabel = document.getElementById('chapterStatus');
    const activeChapter = chapterUploadState.activeChapter;
    const scope = getChapterScope(activeChapter);
    const usingUploadedFiles = Boolean(chapterUploadState.chapters?.[activeChapter]);
    if (previewTitle) previewTitle.textContent = scope.title;
    if (contentArea) {
        if (usingUploadedFiles && scope.pdfPath) {
            // Show the PDF file as the visual preview (no text overview).
            contentArea.innerHTML = `
                <div class="chapter-summary">
                    <div class="chapter-summary-card" style="padding:0; overflow:hidden;">
                        <iframe src="${scope.pdfPath}#toolbar=1&navpanes=0" title="${scope.title} PDF preview"
                            style="width:100%; min-height: 420px; border:none; border-radius:14px;"></iframe>
                    </div>
                    <div class="chapter-preview-actions" style="margin-top:10px;">
                        <a class="btn-proposal chapter-viewer-copy" href="${scope.pdfPath}" target="_blank" rel="noopener">Open PDF</a>
                    </div>
                </div>
            `;
        } else if (activeChapter > 2) {
            contentArea.innerHTML = `<div class="chapter-empty">Chapter ${activeChapter} is unavailable for now. The content for this chapter has not been added yet.</div>`;
        } else {
            contentArea.innerHTML = '<div class="chapter-empty">No uploaded chapter content is available yet. Add chapter-1.txt / chapter-2.txt (and .pdf) to the data/chapters folder.</div>';
        }
    }
    if (statusLabel) {
        statusLabel.textContent = usingUploadedFiles ? 'PDF preview from uploaded chapter files' : 'No uploaded chapter files found';
    }
    saveChapterState();
    document.querySelectorAll('.chapter-btn').forEach((btn) => {
        const chapterNumber = Number(btn.dataset.chapter);
        const isLoaded = Boolean(chapterUploadState.chapters && chapterUploadState.chapters[chapterNumber]);
        btn.classList.toggle('active', chapterNumber === activeChapter);
        btn.classList.toggle('loaded', isLoaded);
        if (isLoaded) {
            btn.textContent = `✓ Chapter ${chapterNumber} `;
        } else {
            btn.textContent = `Chapter ${chapterNumber} `;
        }
    });
}

function buildChapterSummary(text) {
    const cleanText = normalizeChapterText(text);
    if (!cleanText) {
        return '<div class="chapter-empty">This chapter file is empty.</div>';
    }

    const paragraphBlocks = cleanText
        .split(/\n+/)
        .map((part) => part.trim())
        .filter(Boolean);
    const previewText = paragraphBlocks.slice(0, 3).join(' ');
    const clippedText = previewText.length > 1400 ? `${previewText.slice(0, 1400)}…` : previewText;

    return `
    <div class="chapter-summary">
        <div class="chapter-summary-card">
            <p>${clippedText}</p>
        </div>
    </div>
    `;
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
    populateChapterDropdown();
    populateComponentDropdown();
    populateChapterPreview();
    title.textContent = scope.title;
    subtitle.textContent = `Previewing Chapter ${chapterNumber} `;
    content.innerHTML = '<div class="chapter-empty">Loading the chapter preview…</div>';
    content.dataset.rawText = '';
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    const docxPath = scope.docxPath || `/data/chapters/chapter-${chapterNumber}.docx`;
    const pdfPath = scope.pdfPath || `/data/chapters/chapter-${chapterNumber}.pdf`;
    const textPath = scope.textPath || `/data/chapters/chapter-${chapterNumber}.txt`;
    let previewText = '';

    try {
        const textResponse = await fetch(textPath, { cache: 'no-store' });
        if (textResponse.ok) {
            previewText = (await textResponse.text()).trim();
        }
    } catch (error) {
        console.warn('Could not load chapter text preview', error);
    }

    try {
        const response = await fetch(pdfPath, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error('PDF not found');
        }

        content.innerHTML = `
<div class="chapter-preview-meta">PDF preview</div>
<iframe src="${pdfPath}" title="Chapter ${chapterNumber} PDF preview" style="width:100%; min-height: 70vh; border: 1px solid #ddd; border-radius: 12px;"></iframe>
                    <div class="chapter-preview-actions">
                        <a class="btn-proposal chapter-viewer-copy" href="${pdfPath}" target="_blank" rel="noopener">Open PDF</a>
                        <a class="btn-proposal chapter-viewer-copy" href="${docxPath}" target="_blank" rel="noopener">Open original DOCX</a>
                    </div>
        `;

        if (previewText) {
            content.dataset.rawText = previewText;
            content.innerHTML += `
<div class="chapter-preview-meta">Uploaded text</div>
                <div class="chapter-preview-card">${previewText}</div>
                `;
        }
    } catch (error) {
        content.dataset.rawText = scope.dataDump || '';
        content.innerHTML = `
                    <div class="chapter-empty">${scope.dataDump || 'No chapter content is available yet.'}</div>
                    <div class="chapter-preview-actions">
                        <a class="btn-proposal chapter-viewer-copy" href="${docxPath}" target="_blank" rel="noopener">Open source file</a>
                    </div>
                `;
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

async function loadChapterFilesFromFolder() {
    const chapterFiles = [
        { number: 1, textPath: '/data/chapters/chapter-1.txt', pdfPath: '/data/chapters/chapter-1.pdf', docxPath: '/data/chapters/chapter-1.docx' },
        { number: 2, textPath: '/data/chapters/chapter-2.txt', pdfPath: '/data/chapters/chapter-2.pdf', docxPath: '/data/chapters/chapter-2.docx' },
        { number: 3, textPath: '/data/chapters/chapter-3.txt', pdfPath: '/data/chapters/chapter-3.pdf', docxPath: '/data/chapters/chapter-3.docx' },
        { number: 4, textPath: '/data/chapters/chapter-4.txt', pdfPath: '/data/chapters/chapter-4.pdf', docxPath: '/data/chapters/chapter-4.docx' },
        { number: 5, textPath: '/data/chapters/chapter-5.txt', pdfPath: '/data/chapters/chapter-5.pdf', docxPath: '/data/chapters/chapter-5.docx' }
    ];

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
        chapterUploadState.chapters = loadedChapters;
        chapterUploadState.activeChapter = 1;
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
    if (executionPointerIndex !== -1) {
        document.getElementById('flashcard').classList.toggle('flipped');
    }
}

function setDifficulty(difficulty) {
    currentDifficulty = difficulty;

    document.querySelectorAll('.btn-difficulty').forEach(btn => {
        btn.style.opacity = '0.7';
        btn.style.transform = 'none';
        btn.style.borderBottomWidth = '4px';
    });

    const selectedBtn = document.querySelector(`.btn-${difficulty}`);
    if (selectedBtn) {
        selectedBtn.style.opacity = '1';
        selectedBtn.style.transform = 'translateY(2px)';
        selectedBtn.style.borderBottomWidth = '2px';
    }
}

function setComponentFromDropdown() {
    const dropdown = document.getElementById('componentDropdown');
    currentComponent = dropdown.value;
}

function getComponentDisplayName() {
    const selected = (chapterComponentOptions[currentChapter] || chapterComponentOptions[1]).find((option) => option.key === currentComponent);
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

async function triggerInterrogation() {
    // 1. Check if history limit reached
    if (generatedCardsCollection.length >= MAX_HISTORY_SIZE) {
        alert(`Your lesson history is getting very full! Please Reset Levels to keep performance fast.Maximum ${MAX_HISTORY_SIZE} items allowed.`);
        return;
    }

    const screenOverlayLoader = document.getElementById('loader');
    screenOverlayLoader.style.display = 'flex';

    // 2. Prepare the prompt with difficulty and component
    let scopeMetadata;
    try {
        scopeMetadata = await ensureChapterContent();
    } catch (e) {
        screenOverlayLoader.style.display = 'none';
        showErrorModal(e.message);
        return;
    }

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
    const availableComponents = (chapterComponentOptions[currentChapter] || chapterComponentOptions[1])
        .filter((option) => option.available && option.key !== 'all');

    if (currentComponent === 'all') {
        const randomComponent = availableComponents[Math.floor(Math.random() * availableComponents.length)] || { name: 'main aspect' };
        componentPrompt = `Focus the question specifically on the ${randomComponent.name} section of the research proposal.`;
    } else {
        const componentObj = availableComponents.find((option) => option.key === currentComponent);
        if (componentObj) {
            componentPrompt = `Focus the question specifically on the ${componentObj.name} section of the research proposal.`;
        } else {
            componentPrompt = "Focus on any key aspect of the research proposal.";
        }
    }


    const instructionPrompt = `You are a strict, highly critical Senior High School research panel defense judge.Your sole source of absolute truth is the research proposal provided below.

CRITICAL EXECUTION PROTOCOLS:
                    1. TRUST THE DATA: When evaluating a question, you must read all sections of the matching proposal. 
2. EXTRACTION OVER GUESSING: If the information is present or clearly implied by their methodology / sampling, extract it.Do NOT guess outside information.
3. NO LAZY REFUSALS: You are prohibited from responding with "This information is not explicitly detailed" if the answer can be synthesized from the text.
4. QUESTION FORMAT: Frame questions as if directly asking the researchers(e.g., "What sampling method did you use?" not "According to your...")
                    5. ANSWER FORMAT: Frame answers in third person plural('The researchers...') as if the researchers are responding
                    6. CONTEXTUAL LIMITATION: ONLY use information from the provided research proposal
                    7. RESPONSE FORMAT: Provide ONLY valid JSON in this exact format: { "question": "your question here", "answer": "your answer here" }
                    8. VARIETY: The question and answer must be concrete and specific to the actual text below.Do NOT use generic template questions nor generic template answers.Quote or directly reference specific facts, names, numbers, or methods found in the proposal.
        9. UNIQUENESS: Generate a fresh, distinct question / answer pair each time.Vary the focus and wording; never repeat the same generic phrasing across generations.

RESEARCH PROPOSAL:
${scopeMetadata.dataDump || "No research data available."}

                    Now, as a panelist, ${randomAngle}.${difficultyPrompt} ${componentPrompt} Base your question and the researchers' answer (in third person plural 'The researchers...') ONLY on information found in the proposal above.Provide the question and answer in JSON format: { "question": "...", "answer": "..." } `;

    let structuredData = null;
    let generationError = null;
    const MAX_GENERATION_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
        const seed = Date.now() + attempt;
        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: instructionPrompt, json: true, seed })
            });

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

            if (!candidate.question || !candidate.answer) {
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
            generationError = error;
            dbgError('triggerInterrogation', 'AI generation failed on attempt ' + (attempt + 1), error);
        }
    }

    if (!structuredData) {
        screenOverlayLoader.style.display = 'none';
        showErrorModal('The AI service is currently unavailable. Please try again later.');
        return;
    }

    generatedCardsCollection.push({
        id: Date.now(),
        label: `${scopeMetadata.title.replace(/\s+/g, ' ').trim()} - AI Research`,
        question: structuredData.question,
        answer: structuredData.answer,
        difficulty: currentDifficulty,
        component: currentComponent,
        timestamp: new Date().toISOString(),
        favorite: false
    });

    executionPointerIndex = generatedCardsCollection.length - 1;
    localStorage.setItem('mcesi_sim_history', JSON.stringify(generatedCardsCollection));

    renderHistoryPanelUI();
    syncCardDisplaySurface();
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
    <span>Q${visibleIndex + 1}: ${cardInstance.label} (${cardInstance.difficulty})</span>
        <button class="delete-btn" onclick="deleteHistoryItem(event, ${originalIndex})">🗑️</button>
        <button class="favorite-btn ${cardInstance.favorite ? 'favorited' : ''}" onclick="toggleFavorite(event, ${originalIndex})">★</button>
    `;

        executionListItem.onclick = (clickEvent) => {
            if (clickEvent.target.classList.contains('delete-btn') ||
                clickEvent.target.classList.contains('favorite-btn')) {
                return; // Don't select if clicking delete or favorite
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

function exportToPDF() {
    if (generatedCardsCollection.length === 0) {
        alert("No flashcards to export!");
        return;
    }

    // Use jsPDF to create and download PDF
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Add title
    doc.setFontSize(18);
    doc.text("Research Defense Practice", 105, 20, null, null, "center");
    doc.setFontSize(12);
    doc.text(`Exported on: ${new Date().toLocaleDateString()} `, 105, 30, null, null, "center");

    // Add group members
    doc.setFontSize(14);
    doc.text("Group Members:", 20, 45);
    doc.setFontSize(12);
    const members = [
        "Gonzales, Samantha Nicole B.",
        "Manarang, Mikan M.",
        "Almario, Joyce P.",
        "Bondoc, Cassandra D.",
        "Casupanan, Rhian L.",
        "Dizon, Lynx Leonard G."
    ];

    members.forEach((member, index) => {
        doc.text(member, 20, 55 + (index * 7));
    });

    // Add flashcards
    let yPosition = 100;
    const pageHeight = doc.internal.pageSize.height;

    generatedCardsCollection.forEach((card, index) => {
        // Check if we need a new page
        if (yPosition > pageHeight - 80) {
            doc.addPage();
            yPosition = 20;
        }

        // Add flashcard content
        doc.setFontSize(14);
        doc.text(`FLASHCARD ${index + 1} `, 20, yPosition);
        yPosition += 10;

        doc.setFontSize(12);
        doc.text(`Topic: ${card.label} `, 20, yPosition);
        yPosition += 7;

        doc.text(`Difficulty: ${card.difficulty} `, 20, yPosition);
        yPosition += 7;

        doc.text(`Component: ${card.component} `, 20, yPosition);
        yPosition += 7;

        doc.text(`Generated: ${new Date(card.timestamp).toLocaleString()} `, 20, yPosition);
        yPosition += 7;

        doc.text(`Favorite: ${card.favorite ? 'Yes' : 'No'} `, 20, yPosition);
        yPosition += 10;

        // Add question
        doc.setFontSize(12);
        doc.text("QUESTION:", 20, yPosition);
        yPosition += 7;

        const questionLines = doc.splitTextToSize(card.question, 170);
        doc.text(questionLines, 20, yPosition);
        yPosition += questionLines.length * 7 + 5;

        // Add answer
        doc.setFontSize(12);
        doc.text("ANSWER:", 20, yPosition);
        yPosition += 7;

        const answerLines = doc.splitTextToSize(card.answer, 170);
        doc.text(answerLines, 20, yPosition);
        yPosition += answerLines.length * 7 + 10;

        // Add separator
        doc.line(20, yPosition, 190, yPosition);
        yPosition += 15;
    });

    // Save the PDF
    doc.save(`research-defense-practice-${new Date().toISOString().slice(0, 10)}.pdf`);
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
        const canvas = await html2canvas(exportZone, { backgroundColor: '#ffffff', scale: 2 });
        const link = document.createElement('a');
        link.download = `ResearchDefense_Q${executionPointerIndex + 1}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
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
        // Assistant-focused prompt
        const prompt = `You are a helpful research assistant for the currently selected research chapter.

Current chapter: ${scopeMetadata.title}
Chapter content: ${scopeMetadata.dataDump}

User message: "${message}"

        Instructions:
        1. Respond directly as a helpful assistant
        2. Use "I" and "you" language, not third person
        3. Only discuss the research chapter content when relevant
        4. Keep responses concise and helpful
        5. If asked about the research, use only the chapter content provided above
        6. Do not rely on any older data dump once a new DOCX file is uploaded
        7. Respond naturally to general conversation too

Respond directly to the user's message:`;

        // Call AI service
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: prompt })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${errorData.error || 'Unknown error'}`);
        }

        const data = await response.json();
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

    } catch (error) {
        typingIndicator.remove();
        addMessageToChat('Sorry, I could not reach the AI service. Please try again later.', 'bot');
        showErrorModal('The AI service is currently unavailable. Please try again later.');
        console.error('Chatbot error:', error);
    }
}


function addMessageToChat(message, sender) {
    const messagesContainer = document.getElementById('chatbotMessages');
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.classList.add(sender + '-message');
    messageElement.textContent = message;

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

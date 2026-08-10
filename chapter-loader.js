/* ============================================================
   Defense Prep - Chapter Loader & Docx Parser
   ============================================================ */

function getChapterFilePaths() {
    return [
        { number: 1, textPath: '/data/chapters/chapter-1.txt', pdfPath: '/data/chapters/chapter-1.pdf', docxPath: '/data/chapters/chapter-1.docx' },
        { number: 2, textPath: '/data/chapters/chapter-2.txt', pdfPath: '/data/chapters/chapter-2.pdf', docxPath: '/data/chapters/chapter-2.docx' },
        { number: 3, textPath: '/data/chapters/chapter-3.txt', pdfPath: '/data/chapters/chapter-3.pdf', docxPath: '/data/chapters/chapter-3.docx' },
        { number: 4, textPath: '/data/chapters/chapter-4.txt', pdfPath: '/data/chapters/chapter-4.pdf', docxPath: '/data/chapters/chapter-4.docx' },
        { number: 5, textPath: '/data/chapters/chapter-5.txt', pdfPath: '/data/chapters/chapter-5.pdf', docxPath: '/data/chapters/chapter-5.docx' }
    ];
}

function romanToNumber(value) {
    const romanMap = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
    return romanMap[value.toLowerCase()] || null;
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

async function fetchSingleChapterContent(entry) {
    try {
        const textResponse = await fetch(entry.textPath, { cache: 'no-store' });
        if (textResponse.ok) {
            const text = (await textResponse.text()).trim();
            if (text) return text;
        }

        const docxResponse = await fetch(entry.docxPath, { cache: 'no-store' });
        if (!docxResponse.ok) return null;
        if (typeof loadMammoth === 'function') {
            await loadMammoth();
        }
        const arrayBuffer = await docxResponse.arrayBuffer();
        if (typeof mammoth !== 'undefined' && mammoth.extractRawText) {
            const extracted = await mammoth.extractRawText({ arrayBuffer });
            const text = extracted.value || '';
            if (text.trim()) return text;
        }
    } catch (error) {
        console.warn(`Could not load ${entry.textPath}`, error);
    }
    return null;
}

async function loadChapterEntry(number) {
    const entry = getChapterFilePaths().find((e) => e.number === number);
    if (!entry) return;
    const text = await fetchSingleChapterContent(entry);
    if (text) {
        chapterUploadState.chapters[number] = {
            title: `Chapter ${number}`,
            dataDump: typeof normalizeChapterText === 'function' ? normalizeChapterText(text) : text,
            pdfPath: entry.pdfPath,
            textPath: entry.textPath,
            docxPath: entry.docxPath
        };
        if (typeof saveChapterState === 'function') saveChapterState();
    }
}

async function loadChapterFilesFromFolder() {
    const chapterFiles = getChapterFilePaths();
    const loadedChapters = {};
    for (const entry of chapterFiles) {
        const text = await fetchSingleChapterContent(entry);
        if (text) {
            loadedChapters[entry.number] = {
                title: `Chapter ${entry.number}`,
                dataDump: typeof normalizeChapterText === 'function' ? normalizeChapterText(text) : text,
                pdfPath: entry.pdfPath,
                textPath: entry.textPath,
                docxPath: entry.docxPath
            };
        }
    }

    if (Object.keys(loadedChapters).length) {
        if (!chapterUploadState.chapters) chapterUploadState.chapters = {};
        Object.assign(chapterUploadState.chapters, loadedChapters);
        if (typeof isChapterAvailable === 'function' && !isChapterAvailable(chapterUploadState.activeChapter)) {
            for (let n = 1; n <= 5; n++) {
                if (isChapterAvailable(n)) { chapterUploadState.activeChapter = n; break; }
            }
        }
        if (typeof saveChapterState === 'function') saveChapterState();
    }
}

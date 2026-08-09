// ============================================================================
// lib/chunking.js
// ----------------------------------------------------------------------------
// Normalization, heading detection, section splitting, and semantic chunking
// for the research knowledge base ingestion pipeline.
//
// This is the SERVER-SIDE implementation. It mirrors the heading-detection
// heuristics from the client (app.js splitChapterIntoSections) so that what
// the DB indexes matches what the UI shows, but runs deterministically here.
// ============================================================================

// Private-markdown heading: **INTRODUCTION**
const BOLD_HEADING_RE = /^\*\*(.+?)\*\*\s*$/;
// All-caps / title-case standalone heading line (short, does not end with '.')
const TITLE_HEADING_RE = /^[A-Z][A-Za-z0-9\s&'’.+\-/,()[\]{}]+$/;

// Configurable chunking budget (approximate, in characters). The historical
// rule of thumb maps ~4 chars/token for English, so 400-700 tokens ≈ 1600-2800
// chars. We use a generous upper bound and cut on sentence boundaries.
const CHUNK_TARGET_CHARS = 2200;   // ~500-600 tokens
const CHUNK_MIN_CHARS = 900;       // don't make tiny chunks unless unavoidable
const CHUNK_MAX_CHARS = 3200;      // absolute ceiling before forced split
const CHUNK_OVERLAP_CHARS = 400;   // ~80-100 token overlap

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize raw chapter text: strip Windows CR, collapse runs of whitespace to
 * single spaces, and trim. Does NOT rewrite research content — only cleans
 * formatting so downstream parsing is reliable.
 */
function normalizeText(raw) {
    if (!raw) return '';
    return String(raw)
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// ---------------------------------------------------------------------------
// Heading detection / section splitting
// ---------------------------------------------------------------------------

function detectHeading(line) {
    const t = (line || '').trim();
    if (!t) return null;
    const bold = t.match(BOLD_HEADING_RE);
    if (bold) return bold[1].trim();
    if (
        t.length <= 80 &&
        TITLE_HEADING_RE.test(t) &&
        !t.endsWith('.')
    ) {
        return t;
    }
    return null;
}

/**
 * Split normalized chapter text into ordered sections.
 * Returns [{ heading, keywords, text, ord }].
 */
function splitIntoSections(text) {
    const raw = normalizeText(text);
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

    for (const line of lines) {
        const heading = detectHeading(line);
        if (heading) {
            flush();
            current = {
                heading,
                keywords: heading.toLowerCase(),
                text: '',
                ord: sections.length
            };
        } else if (current) {
            current.text += line + '\n';
        } else {
            // Content before the first heading — treat as its own "Title" section.
            if (!sections.length) {
                current = { heading: 'Title', keywords: 'title', text: '', ord: 0 };
            }
            if (current) current.text += line + '\n';
        }
    }
    flush();

    if (!sections.length && raw.trim()) {
        sections.push({ heading: 'Chapter', keywords: 'chapter', text: raw.trim(), ord: 0 });
    }
    return sections;
}

// ---------------------------------------------------------------------------
// Sentence-aware chunking
// ---------------------------------------------------------------------------

// Common abbrevations that end with a period but are NOT sentence boundaries.
const NON_BOUNDARY_ABBREV = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'vs', 'etc', 'fig', 'al', 'vol', 'no',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
]);

function isSentenceBoundary(text, idx) {
    const ch = text[idx];
    if (ch !== '.' && ch !== '!' && ch !== '?') return false;
    // Don't split on decimal numbers (e.g. 3.14) or "3.5%" — check prev char.
    const prev = text[idx - 1];
    if (prev && /\d/.test(prev) && text[idx + 1] && /\d/.test(text[idx + 1])) {
        return false;
    }
    // Don't split on common abbreviations like "Dr." or "et al."
    const before = text.slice(0, idx).toLowerCase();
    const m = before.match(/([a-z\.]+)\.$/);
    if (m && NON_BOUNDARY_ABBREV.has(m[1].replace(/\./g, ''))) {
        return false;
    }
    // A boundary must be followed by whitespace + a capital letter (or end).
    const after = text.slice(idx + 1);
    if (!after.trim()) return true;
    return /^\s+[A-Z"'(]/.test(after);
}

function splitIntoSentences(text) {
    const out = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        if (isSentenceBoundary(text, i)) {
            const sentence = text.slice(start, i + 1).trim();
            if (sentence) out.push(sentence);
            start = i + 1;
        }
    }
    const tail = text.slice(start).trim();
    if (tail) out.push(tail);
    return out;
}

/**
 * Chunk a section's text into overlapping segments that respect paragraph and
 * sentence boundaries. Returns an array of { content, startIndex }.
 */
function chunkSection(rawText) {
    const text = normalizeText(rawText);
    if (!text) return [];

    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
    const chunks = [];
    let buffer = '';
    let startIndex = 0;

    const flush = () => {
        const b = buffer.trim();
        if (b) {
            chunks.push({ content: b, startIndex });
            buffer = '';
            startIndex = 0;
        }
    };

    for (const para of paragraphs) {
        // If adding this paragraph overflows the budget, flush what we have.
        if (buffer && buffer.length + para.length > CHUNK_MAX_CHARS) {
            flush();
        }
        if (buffer) buffer += '\n\n' + para;
        else {
            buffer = para;
            startIndex = 0;
        }

        // If the buffer is large enough, cut on a sentence boundary near target.
        if (buffer.length >= CHUNK_TARGET_CHARS) {
            const sentences = splitIntoSentences(buffer);
            let keep = '';
            let i = 0;
            for (; i < sentences.length; i++) {
                if (keep.length + sentences[i].length > CHUNK_TARGET_CHARS && keep.length >= CHUNK_MIN_CHARS) {
                    break;
                }
                keep += (keep ? ' ' : '') + sentences[i];
            }
            const remainder = sentences.slice(i).join(' ');
            // Push the sentence-cut chunk, preserving overlap via the remainder.
            if (keep.trim()) {
                chunks.push({ content: keep.trim(), startIndex });
                const overlap = keep.trim().slice(-CHUNK_OVERLAP_CHARS);
                buffer = (remainder ? overlap + ' ' + remainder : '').trim();
                startIndex = 0;
            }
        }
    }
    flush();

    // Post-process: if any single chunk is still too large (no sentence boundary
    // found), hard-split at the max boundary.
    const final = [];
    for (const c of chunks) {
        if (c.content.length <= CHUNK_MAX_CHARS) {
            final.push(c);
            continue;
        }
        let body = c.content;
        while (body.length > CHUNK_MAX_CHARS) {
            final.push({ content: body.slice(0, CHUNK_MAX_CHARS).trim(), startIndex: 0 });
            body = body.slice(CHUNK_MAX_CHARS - CHUNK_OVERLAP_CHARS);
        }
        if (body.trim()) final.push({ content: body.trim(), startIndex: 0 });
    }
    return final;
}

module.exports = {
    normalizeText,
    splitIntoSections,
    chunkSection,
    splitIntoSentences,
    CHUNK_TARGET_CHARS,
    CHUNK_MIN_CHARS,
    CHUNK_MAX_CHARS,
    CHUNK_OVERLAP_CHARS
};

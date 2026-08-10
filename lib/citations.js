// ============================================================================
// lib/citations.js
// ----------------------------------------------------------------------------
// Citation detection, reference parsing, and citation<->reference matching for
// the research knowledge base ingestion pipeline.
//
// Mirrors the client-side heuristics from app.js (CITATION_PATTERNS,
// extractCitations, findReferencesSection, matchCitationsToReferences) but
// runs server-side and returns structured rows for DB insertion.
// ============================================================================

// Citation patterns used for detection.
// 1) Parenthetical: (Davis, 1989) or (Davis et al., 1989)
const PAREN_CITATION_RE =
    /\(([A-Z][a-zA-Z''-]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-zA-Z''-]+))?(?:\s*,\s*\d{4}[a-z]?)?)\)/g;
// 2) Narrative: Davis (1989) or Davis et al. (1989)
const NARRATIVE_CITATION_RE =
    /([A-Z][a-zA-Z''-]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-zA-Z''-]+))?)\s*\((\d{4}[a-z]?)\)/g;

// References section heading matchers (standalone).
const REFERENCES_HEADING_RE = /^\*\*?references\*\*?$/i;

/**
 * Detect citations in a block of text.
 * Returns [{ citation_text, author, year, pattern_type }]
 */
function detectCitations(text) {
    const citations = [];
    const seen = new Set();

    const push = (author, year, raw, patternType) => {
        const key = `${author}|${year}|${patternType}`;
        if (seen.has(key)) return;
        seen.add(key);
        citations.push({
            citation_text: `${author}${year ? ', ' + year : ''}`,
            author,
            year: year ? parseInt(year, 10) : null,
            pattern_type: patternType
        });
    };

    if (text) {
        let m;
        PAREN_CITATION_RE.lastIndex = 0;
        while ((m = PAREN_CITATION_RE.exec(text)) !== null) {
            const body = m[1];
            const authorMatch = body.match(/^([A-Z][a-zA-Z''-]+)/);
            const yearMatch = body.match(/(\d{4})/);
            if (authorMatch) {
                push(authorMatch[1], yearMatch ? yearMatch[1] : null, m[0], 'paren');
            }
        }

        NARRATIVE_CITATION_RE.lastIndex = 0;
        while ((m = NARRATIVE_CITATION_RE.exec(text)) !== null) {
            const author = m[1];
            const year = m[2];
            push(author, year, m[0], 'narrative');
        }
    }
    return citations;
}

/**
 * Extract the References section from a full chapter/dump text.
 * Returns the raw joined reference lines (or '' if none).
 */
function findReferencesSection(text) {
    const lines = String(text || '').replace(/\r/g, '\n').split('\n');
    let inReferences = false;
    const refLines = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (REFERENCES_HEADING_RE.test(trimmed)) {
            inReferences = true;
            continue;
        }
        // Stop at the next major all-caps heading after references start
        // (allowing optional leading/trailing asterisks: **CONCLUSION**).
        if (inReferences && /^[*]{0,2}\s*[A-Z][A-Z\s]{3,}[*]{0,2}$/.test(trimmed)) {
            break;
        }
        if (inReferences && trimmed) {
            refLines.push(trimmed);
        }
    }
    return refLines.join('\n');
}

/**
 * Parse the References section into structured reference rows.
 * Returns [{ reference_text, author, year, title, ord }]
 */
function parseReferences(referencesSection) {
    const section = String(referencesSection || '').trim();
    if (!section) return [];
    const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);
    const refs = [];

    // A reference entry is one or more lines. We take each line as its own entry
    // (references are commonly one line each). If a line looks like a continuation
    // (doesn't start with a capital or a citation), append to the previous.
    let current = null;
    for (const line of lines) {
        // Heuristic: a new reference starts with a capital letter (author surname)
        // or a leading number/quote. Continuation lines usually start lowercase.
        const startsNew = /^[A-Z"'(]/.test(line) || /^\d/.test(line);
        if (startsNew || !current) {
            if (current) refs.push(current);
            current = { reference_text: line, ord: refs.length };
        } else {
            current.reference_text += ' ' + line;
        }
    }
    if (current) refs.push(current);

    // Extract author + year from the leading part of each reference for matching.
    return refs.map((r) => {
        const authorMatch = r.reference_text.match(/^([A-Z][a-zA-Z''-]+)/);
        const yearMatch = r.reference_text.match(/\((\d{4})\)/);
        // Title is the text after the year parenthetical (APA style), falling
        // back to the text after the first period if no year is present.
        const titleMatch = r.reference_text.match(/\(\d{4}\)\.\s+([^.]+?)(?:\.|$)/)
            || r.reference_text.match(/\.\s+([^.]+?)(?:\.|$)/);
        return {
            reference_text: r.reference_text,
            author: authorMatch ? authorMatch[1] : null,
            year: yearMatch ? parseInt(yearMatch[1], 10) : null,
            title: titleMatch ? titleMatch[1].trim() : null,
            ord: r.ord
        };
    });
}

/**
 * Match a detected citation to parsed reference entries by author (and year
 * when present). Returns the best matching reference index, or -1.
 */
function matchCitationToReference(citation, references) {
    const author = (citation.author || '').toLowerCase();
    if (!author) return -1;
    for (let i = 0; i < references.length; i++) {
        const ref = references[i];
        const refAuthor = (ref.author || '').toLowerCase();
        if (!refAuthor) continue;
        if (refAuthor === author) {
            if (citation.year == null) return i;
            if (ref.year === citation.year) return i;
        }
    }
    // Fallback: substring match on author name.
    for (let i = 0; i < references.length; i++) {
        if ((references[i].reference_text || '').toLowerCase().includes(author)) {
            return i;
        }
    }
    return -1;
}

module.exports = {
    detectCitations,
    findReferencesSection,
    parseReferences,
    matchCitationToReference
};

// ============================================================================
// lib/components.js
// ----------------------------------------------------------------------------
// Shared source of truth for research component keyword mapping.
//
// This is used by BOTH the ingestion pipeline (to assign a component_key to a
// detected section) and the retrieval pipeline (to boost chunks by the
// selected component(s)). It centralizes the mapping that previously lived
// only in app.js (COMPONENT_KEYWORDS) so client and server never drift.
// ============================================================================

// component_key -> list of keywords used to classify a section's heading/text.
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
    data_analysis: ['data analysis', 'statistical', 'frequency', 'percentage', 'weighted mean', 'pearson', 'correlation'],
    results: ['results', 'findings', 'analysis of data'],
    discussion: ['discussion', 'interpretation', 'implication'],
    conclusion: ['conclusion', 'summary', 'key findings'],
    recommendations: ['recommendations', 'recommendation', 'suggestions']
};

// Default component when a section cannot be classified.
const DEFAULT_COMPONENT_KEY = 'introduction';

/**
 * Classify a section (by its heading/lower text) into a component_key.
 * Returns the best-matching key, or DEFAULT_COMPONENT_KEY.
 */
function classifySection(heading, rawText) {
    const haystack = `${heading || ''} ${rawText || ''}`.toLowerCase();
    let bestKey = DEFAULT_COMPONENT_KEY;
    let bestScore = 0;
    for (const [key, keywords] of Object.entries(COMPONENT_KEYWORDS)) {
        if (key === 'references') continue; // references handled separately
        let score = 0;
        for (const kw of keywords) {
            if (haystack.includes(kw)) score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            bestKey = key;
        }
    }
    return bestKey;
}

/**
 * Expand a list of selected component keys into the union of keywords for
 * query building / retrieval boosting.
 */
function keywordsForComponents(keys) {
    const set = new Set();
    (keys || []).forEach((k) => {
        (COMPONENT_KEYWORDS[k] || []).forEach((w) => set.add(w));
    });
    return [...set];
}

module.exports = {
    COMPONENT_KEYWORDS,
    DEFAULT_COMPONENT_KEY,
    classifySection,
    keywordsForComponents
};

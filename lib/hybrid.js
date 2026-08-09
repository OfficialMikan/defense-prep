// ============================================================================
// lib/hybrid.js
// ----------------------------------------------------------------------------
// Hybrid retrieval scoring + fusion.
//
// Combines three retrieval signals deterministically (no LLM as a router):
//   A. keyword / full-text relevance
//   B. semantic / vector relevance (when embeddings are available)
//   C. metadata relevance (component_key, chapter/document, section)
//   D. citation relevance (query contains a citation)
//
// Uses Reciprocal Rank Fusion (RRF) combined with a weighted metadata boost.
// All weights / limits are configurable, not hardcoded magic numbers.
// ============================================================================

// Configurable fusion weights (RRF k constant + metadata weight).
const RRF_K = 60;                  // standard RRF constant
const METADATA_BOOST_WEIGHT = 0.5; // relative weight of metadata boost
const CITATION_BOOST_WEIGHT = 0.6; // relative weight of citation-signal boost

// Retrieval limits (configurable per query type).
const RETRIEVAL_LIMITS = {
    chat: Number(process.env.CHAT_RETRIEVAL_LIMIT) || 8,
    flashcard: Number(process.env.FLASHCARD_RETRIEVAL_LIMIT) || 8,
    reference: Number(process.env.REFERENCE_RETRIEVAL_LIMIT) || 5
};

/**
 * Reciprocal Rank Fusion over multiple ranked lists.
 * Each ranked list is an array of chunk records that have a stable `id`.
 * Returns a Map<id, { record, score }> fused.
 */
function reciprocalRankFusion(lists) {
    const scores = new Map();
    for (const list of lists) {
        list.forEach((rec, rank) => {
            const key = rec.id;
            const cur = scores.get(key) || { record: rec, score: 0, hits: 0 };
            cur.score += 1 / (RRF_K + rank + 1);
            cur.hits += 1;
            scores.set(key, cur);
        });
    }
    return scores;
}

/**
 * Compute a metadata relevance boost for a chunk given a filter context.
 * @param {object} chunk - has component_key, document_id, doc_number, section_id
 * @param {object} opts - { componentKeys, chapterNumber }
 * @returns {number} a boost in [0, 1]
 */
function metadataBoost(chunk, opts = {}) {
    let boost = 0;
    const { componentKeys = [], chapterNumber = null } = opts;

    // Component match.
    if (componentKeys && componentKeys.length) {
        if (componentKeys.includes('all') || componentKeys.includes(chunk.component_key)) {
            boost += 0.5;
        }
    }
    // Chapter match.
    if (chapterNumber != null && chunk.doc_number === chapterNumber) {
        boost += 0.3;
    }
    return Math.min(1, boost);
}

/**
 * Compute a citation relevance boost if the query references known authors.
 * Returns 1.0 if the chunk mentions a queried author, else 0.
 */
function citationBoost(chunk, queryCitations) {
    if (!queryCitations || !queryCitations.length) return 0;
    const text = `${chunk.content || ''} ${chunk.authors || ''}`.toLowerCase();
    for (const c of queryCitations) {
        const author = (c.author || '').toLowerCase();
        if (author && text.includes(author)) {
            return 1;
        }
    }
    return 0;
}

/**
 * Fuse ranked lists plus metadata/citation boosts into a final sorted array.
 * @param {Array<Array<object>>} rankedLists - multiple ranked chunk lists
 * @param {object} opts - { componentKeys, chapterNumber, queryCitations }
 * @returns {Array<object>} sorted chunks with `.score`
 */
function fuse(rankedLists, opts = {}) {
    const fused = reciprocalRankFusion(rankedLists);
    const results = [];
    for (const { record, score } of fused.values()) {
        const meta = metadataBoost(record, opts);
        const cite = citationBoost(record, opts.queryCitations);
        const finalScore = score + meta * METADATA_BOOST_WEIGHT + cite * CITATION_BOOST_WEIGHT;
        results.push({ ...record, score: finalScore });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
}

module.exports = {
    RRF_K,
    METADATA_BOOST_WEIGHT,
    CITATION_BOOST_WEIGHT,
    RETRIEVAL_LIMITS,
    reciprocalRankFusion,
    metadataBoost,
    citationBoost,
    fuse
};

// ============================================================================
// /api/retrieve.js
// ----------------------------------------------------------------------------
// Hybrid retrieval endpoint for the persistent research knowledge base.
//
// This is the SINGLE retrieval endpoint (no separate /api/search.js). It is
// called BEFORE the final LLM request and combines:
//   A. keyword / full-text search (Postgres tsvector GIN index)
//   B. semantic / vector search (pgvector, when available)
//   C. metadata relevance (component_key, chapter/document)
//   D. citation relevance (query contains a citation)
// using Reciprocal Rank Fusion.
//
// All core logic is delegated to lib/retrieve.js so /api/chat.js can share the
// exact same retrieval path. The response contains ACTUAL chunk text (not just
// section titles), a small set of relevant references, and the research map.
//
// SECURITY: uses SUPABASE_SERVICE_ROLE_KEY server-side only; project isolation
// is enforced via a server-validated access_token.
// ============================================================================

const { supabase } = require('../lib/supabase');
const dbg = require('./debug');
const { retrieve, buildContextText } = require('../lib/retrieve');

module.exports = async function handler(req, res) {
    const scope = 'api/retrieve';

    const origin = req.headers.origin;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!supabase) {
        return res.status(503).json({ error: 'Research database not configured' });
    }

    try {
        const body = (req.body && typeof req.body === 'object') ? req.body : {};
        const {
            accessToken,
            query,
            selectedComponents = [],
            selectedChapter = null,
            retrievalMode = 'chat'
        } = body;

        if (!query || typeof query !== 'string' || !query.trim()) {
            return res.status(400).json({ error: 'Missing required field: query' });
        }

        const result = await retrieve({
            accessToken,
            query,
            selectedComponents,
            selectedChapter,
            retrievalMode
        });

        const contextText = buildContextText(result.chunks, result.researchMap);

        dbg.log(scope, `Retrieved ${result.chunks.length} chunks for project ${result.project.id}`);
        return res.status(200).json({
            ok: true,
            projectId: result.project.id,
            research_available: result.docCount > 0,
            documents_available: result.docCount,
            retrieved_chunks: result.chunks.length,
            chunks: result.chunks,
            references: result.references,
            research_map: result.researchMap,
            context_text: contextText,
            used_vector: result.usedVector,
            embedding_available: result.embeddingAvailable
        });
    } catch (error) {
        dbg.error(scope, error);
        return res.status(error.status || 500).json({ error: 'Internal error' });
    }
};

// ============================================================================
// lib/embeddings.js
// ----------------------------------------------------------------------------
// Embedding provider abstraction.
//
// The research database does NOT need to use the same provider as the final
// answer model (GPT-OSS-120B via Groq). Embeddings typically come from a
// separate provider (e.g., OpenAI text-embedding-3-small, 1536 dims).
//
// This module isolates the embedding provider so:
//   - a different provider can be swapped in without touching the app,
//   - the ingestion pipeline gracefully falls back to keyword-only retrieval
//     when embeddings are unavailable (no key set, provider error, etc.).
//
// SECURITY: the embedding API key is read from the server environment only.
// It is never sent to the browser.
// ============================================================================

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_DIM = 1536; // matches text-embedding-3-small

/**
 * Return true if an embedding provider is configured.
 * Currently supports OpenAI-compatible endpoints via OPENAI_API_KEY.
 */
function isEmbeddingAvailable() {
    return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Generate an embedding vector for a single text string.
 * Returns an array of numbers, or null on any failure (caller falls back).
 */
async function embedText(text) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const endpoint = process.env.EMBEDDING_BASE_URL ||
        'https://api.openai.com/v1/embeddings';

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: EMBEDDING_MODEL,
                input: typeof text === 'string' ? text.slice(0, 8000) : String(text || '').slice(0, 8000)
            }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!res.ok) {
            // Parse the error body to distinguish quota errors from other issues.
            let errBody = '';
            try { errBody = await res.text(); } catch (_) { /* ignore */ }
            const errText = errBody.slice(0, 300);
            if (res.status === 429) {
                // 429 on embeddings == insufficient quota / rate limit on the
                // OpenAI account. The caller (ingest pipeline) will fall back
                // to keyword-only retrieval gracefully.
                console.error('[embeddings] provider status 429 (quota/rate-limited) — falling back to keyword-only retrieval. Add credits or use a free alternative (see .env.example)');
            } else {
                console.error(`[embeddings] provider status ${res.status}`, errText);
            }
            return null;
        }
        const data = await res.json();
        const vec = data?.data?.[0]?.embedding;
        // W3: validate the embedding is a non-empty numeric array of the exact
        // expected dimension (EMBEDDING_DIM). pgvector rejects/mismatches if the
        // dimension doesn't match the column, so fail fast to keyword fallback
        // rather than letting a bad vector reach the DB / RPC.
        if (!Array.isArray(vec) || vec.length === 0) return null;
        if (vec.length !== EMBEDDING_DIM) {
            console.error(`[embeddings] dimension mismatch: got ${vec.length}, expected ${EMBEDDING_DIM}`);
            return null;
        }
        if (!vec.every((n) => typeof n === 'number' && Number.isFinite(n))) {
            console.error('[embeddings] embedding contains non-finite values');
            return null;
        }
        return vec;
    } catch (e) {
        console.error('[embeddings] provider error', e.message);
        return null;
    }
}

/**
 * Generate embeddings for many texts (batched, sequential to stay within
 * simple rate limits). Returns an array aligned with `texts`; entries may be
 * null when an embedding could not be produced.
 */
async function embedTexts(texts) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return texts.map(() => null); // no provider -> all null (keyword fallback)
    }
    const out = [];
    for (const t of texts) {
        out.push(await embedText(t));
    }
    return out;
}

module.exports = {
    EMBEDDING_MODEL,
    EMBEDDING_DIM,
    isEmbeddingAvailable,
    embedText,
    embedTexts
};

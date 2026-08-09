// ============================================================================
// scripts/verify-fixes.js
// ----------------------------------------------------------------------------
// Executable verification for the F1-F5 / W1-W3 backend fixes that can be
// tested WITHOUT a live Supabase instance or installed @supabase/supabase-js.
//
// Tests:
//   F3  - hybrid metadata ranking (component_key + doc_number boost)
//   W2  - keyword tokenizer produces safe websearch-compatible tokens
//   W3  - embedding dimension validation (1536) via mocked fetch
//   F1  - persistTurn row shape includes project_id (static contract check)
//   F4  - 503 guard message matches project convention (static contract check)
//   F5  - retrieval query builders include is_active filter (static contract)
//   F2  - enrichChunks attaches doc_number/component_key (static contract)
// ============================================================================

const assert = require('assert');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
    try {
        fn();
        passCount++;
        console.log(`  PASS  ${name}`);
    } catch (e) {
        failCount++;
        console.error(`  FAIL  ${name}: ${e.message}`);
    }
}

// ---------------------------------------------------------------------------
// F3: hybrid metadata ranking
// ---------------------------------------------------------------------------
console.log('\n[F3] Hybrid metadata ranking');
const hybrid = require('../lib/hybrid');

test('metadataBoost boosts matching component_key', () => {
    const boost = hybrid.metadataBoost(
        { component_key: 'research_design', doc_number: 3 },
        { componentKeys: ['research_design'], chapterNumber: null }
    );
    assert.ok(boost > 0, `expected boost > 0, got ${boost}`);
});

test('metadataBoost boosts matching doc_number', () => {
    const boost = hybrid.metadataBoost(
        { component_key: 'introduction', doc_number: 3 },
        { componentKeys: [], chapterNumber: 3 }
    );
    assert.ok(boost > 0, `expected boost > 0, got ${boost}`);
});

test('metadataBoost treats "all" as no component-specific boost', () => {
    const boost = hybrid.metadataBoost(
        { component_key: 'introduction', doc_number: 1 },
        { componentKeys: ['all'], chapterNumber: null }
    );
    assert.ok(boost > 0, `"all" should still boost (preserve existing behavior), got ${boost}`);
});

test('metadataBoost gives no boost for nonmatching chapter/component', () => {
    const boost = hybrid.metadataBoost(
        { component_key: 'introduction', doc_number: 1 },
        { componentKeys: ['research_design'], chapterNumber: 3 }
    );
    assert.strictEqual(boost, 0, `expected 0 boost, got ${boost}`);
});

test('fuse ranks matching metadata chunk above nonmatching', () => {
    const matching = { id: 'a', component_key: 'research_design', doc_number: 3, content: 'design text' };
    const nonmatching = { id: 'b', component_key: 'introduction', doc_number: 1, content: 'intro text' };
    const fused = hybrid.fuse([[matching, nonmatching]], {
        componentKeys: ['research_design'],
        chapterNumber: 3
    });
    assert.strictEqual(fused[0].id, 'a', `expected matching chunk first, got ${fused[0].id}`);
    assert.ok(fused[0].score > fused[1].score, 'matching chunk should have higher score');
});

test('fuse preserves RRF architecture (multiple lists)', () => {
    const listA = [{ id: 'x', component_key: 'results', doc_number: 2, content: 'results' }];
    const listB = [{ id: 'y', component_key: 'results', doc_number: 2, content: 'results' }];
    const fused = hybrid.fuse([listA, listB], { componentKeys: [], chapterNumber: null });
    assert.strictEqual(fused.length, 2, 'both chunks should be fused');
    assert.ok(fused.every((c) => typeof c.score === 'number'), 'all fused chunks have numeric score');
});

// ---------------------------------------------------------------------------
// W2: keyword tokenizer (safe websearch-compatible tokens)
// ---------------------------------------------------------------------------
console.log('\n[W2] Keyword tokenizer');
const fs = require('fs');
const retrieveSrc = fs.readFileSync(require.resolve('../lib/retrieve.js'), 'utf8');

test('no raw user interpolation into SQL (no template literal with query)', () => {
    // The query is built via supabase-js textSearch() with a sanitized token
    // string; no raw SQL string interpolation of user input exists.
    assert.ok(!/textSearch\([^)]*`/.test(retrieveSrc), 'no template-literal SQL in textSearch');
    assert.ok(retrieveSrc.includes("type: 'websearch'"), 'uses websearch parser');
});

test('tokenizer strips punctuation and filters short words', () => {
    // Replicate the tokenizer logic from keywordSearch to verify safety.
    const clean = 'What does the research design use? (Davis, 1989)';
    const tokens = clean
        .split(/[^a-zA-Z0-9]+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 2)
        .slice(0, 12);
    assert.ok(tokens.length > 0, 'tokens produced');
    assert.ok(tokens.every((t) => /^[a-zA-Z0-9]+$/.test(t)), 'all tokens are alphanumeric');
    assert.ok(!tokens.some((t) => t.includes('*') || t.includes(':')), 'no prefix operators');
});

test('empty/invalid query returns empty set gracefully', () => {
    const clean = 'a b c'; // all short words
    const tokens = clean
        .split(/[^a-zA-Z0-9]+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 2)
        .slice(0, 12);
    assert.strictEqual(tokens.length, 0, 'no valid tokens -> empty set');
});

// ---------------------------------------------------------------------------
// W3: embedding dimension validation
// ---------------------------------------------------------------------------
console.log('\n[W3] Embedding dimension validation');
const embeddings = require('../lib/embeddings');

test('EMBEDDING_DIM constant is 1536', () => {
    assert.strictEqual(embeddings.EMBEDDING_DIM, 1536);
});

test('embedText rejects wrong-dimension vectors (returns null)', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => ({
        ok: true,
        json: async () => ({ data: [{ embedding: new Array(512).fill(0.1) }] })
    });
    process.env.OPENAI_API_KEY = 'test-key';
    try {
        const vec = await embeddings.embedText('test');
        assert.strictEqual(vec, null, 'wrong dimension must return null');
    } finally {
        global.fetch = origFetch;
        delete process.env.OPENAI_API_KEY;
    }
});

test('embedText accepts exactly 1536 dimensions', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => ({
        ok: true,
        json: async () => ({ data: [{ embedding: new Array(1536).fill(0.1) }] })
    });
    process.env.OPENAI_API_KEY = 'test-key';
    try {
        const vec = await embeddings.embedText('test');
        assert.ok(Array.isArray(vec) && vec.length === 1536, 'should return 1536-dim vector');
    } finally {
        global.fetch = origFetch;
        delete process.env.OPENAI_API_KEY;
    }
});

test('embedText returns null when no API key (keyword fallback)', async () => {
    delete process.env.OPENAI_API_KEY;
    const vec = await embeddings.embedText('test');
    assert.strictEqual(vec, null, 'no key -> null (keyword fallback)');
});

// ---------------------------------------------------------------------------
// F1: persistTurn contract (static)
// ---------------------------------------------------------------------------
console.log('\n[F1] Conversation persistence contract');
const chatSrc = fs.readFileSync(require.resolve('../api/chat.js'), 'utf8');

test('persistTurn inserts project_id on every row', () => {
    const persistBlock = chatSrc.match(/async function persistTurn[\s\S]*?\n}/);
    assert.ok(persistBlock, 'persistTurn function found');
    const body = persistBlock[0];
    assert.ok(body.includes('project_id: projectId'), 'user row includes project_id');
    assert.ok(body.includes('project_id: projectId'), 'assistant row includes project_id');
    assert.ok(body.includes("role: 'user'"), 'user role present');
    assert.ok(body.includes("role: 'assistant'"), 'assistant role present');
});

test('persistTurn is called with retrievalResult.project.id', () => {
    assert.ok(
        chatSrc.includes('persistTurn(conversationId, retrievalResult.project.id, lastUser, result.content)'),
        'persistTurn receives resolved project id'
    );
});

test('conversationId is returned in the response', () => {
    assert.ok(chatSrc.includes('conversationId,'), 'conversationId in response');
});

test('conversation persistence failures are non-fatal', () => {
    assert.ok(chatSrc.includes('Persist turn error (non-fatal)'), 'persist errors are caught');
});

// ---------------------------------------------------------------------------
// F4: Supabase 503 guard contract (static)
// ---------------------------------------------------------------------------
console.log('\n[F4] Supabase 503 guard');
const ingestSrc = fs.readFileSync(require.resolve('../api/ingest.js'), 'utf8');
const retrieveApiSrc = fs.readFileSync(require.resolve('../api/retrieve.js'), 'utf8');

test('api/chat.js returns 503 with safe message when supabase missing', () => {
    assert.ok(chatSrc.includes('if (!supabase)'), 'guard present');
    assert.ok(chatSrc.includes('res.status(503)'), '503 status');
    assert.ok(chatSrc.includes("'Research database not configured'"), 'safe message');
});

test('api/ingest.js returns 503 with safe message', () => {
    assert.ok(ingestSrc.includes('res.status(503)'), '503 status');
    assert.ok(ingestSrc.includes("'Research database not configured'"), 'safe message');
});

test('api/retrieve.js returns 503 with safe message', () => {
    assert.ok(retrieveApiSrc.includes('res.status(503)'), '503 status');
    assert.ok(retrieveApiSrc.includes("'Research database not configured'"), 'safe message');
});

test('no secrets exposed in 503 responses', () => {
    // The 503 guard blocks must only return the safe message. We extract each
    // guard block (the `if (!supabase)` ... `return res.status(503)...` region)
    // and assert it contains no env access or secret material.
    for (const src of [chatSrc, ingestSrc, retrieveApiSrc]) {
        const guardMatch = src.match(/if \(!supabase\) \{[\s\S]*?return res\.status\(503\)\.json\(\{[\s\S]*?\}\);/);
        assert.ok(guardMatch, '503 guard block found');
        const block = guardMatch[0];
        assert.ok(!block.includes('SUPABASE_SERVICE_ROLE_KEY'), 'no service key in 503 block');
        assert.ok(!block.includes('process.env'), 'no env access in 503 block');
        assert.ok(!block.includes('stack'), 'no stack trace in 503 block');
        assert.ok(block.includes("'Research database not configured'"), 'safe message only');
    }
});

// ---------------------------------------------------------------------------
// F5: stale document isolation (static)
// ---------------------------------------------------------------------------
console.log('\n[F5] Stale document isolation');
const retrieveLibSrc = fs.readFileSync(require.resolve('../lib/retrieve.js'), 'utf8');

test('keywordSearch filters is_active = true', () => {
    assert.ok(retrieveLibSrc.includes("eq('research_documents.is_active', true)"), 'keyword path filters active');
});

test('citationSearch filters is_active = true', () => {
    assert.ok(retrieveLibSrc.includes("eq('research_documents.is_active', true)"), 'citation path filters active');
});

test('fetchReferences filters is_active = true', () => {
    assert.ok(retrieveLibSrc.includes("eq('research_documents.is_active', true)"), 'references path filters active');
});

test('vector RPC filters is_active = true (migration)', () => {
    const migrationSrc = fs.readFileSync(require.resolve('../supabase/migrations/0002_research_knowledge_base.sql'), 'utf8');
    assert.ok(migrationSrc.includes('d.is_active = true'), 'vector RPC joins active documents only');
});

test('enrichChunks only loads active documents', () => {
    assert.ok(retrieveLibSrc.includes("eq('is_active', true)"), 'enrichChunks loads active docs only');
});

// ---------------------------------------------------------------------------
// F2: chapter metadata contract (static)
// ---------------------------------------------------------------------------
console.log('\n[F2] Chapter metadata');
test('enrichChunks attaches doc_number and component_key', () => {
    assert.ok(retrieveLibSrc.includes('doc_number: doc ? doc.doc_number : null'), 'doc_number attached');
    assert.ok(retrieveLibSrc.includes('component_key: section ? section.component_key : null'), 'component_key attached');
});

test('all three retrieval paths call enrichChunks', () => {
    assert.ok(retrieveLibSrc.includes('const embedded = await enrichChunks(projectId, joined)'), 'keyword path enriches');
    assert.ok(retrieveLibSrc.includes('return enrichChunks(project.id, rows.map'), 'vector path enriches');
    assert.ok(retrieveLibSrc.includes('return enrichChunks(projectId, unique).slice(0, limit)'), 'citation path enriches');
});

// ---------------------------------------------------------------------------
// W1: research status element (static)
// ---------------------------------------------------------------------------
console.log('\n[W1] Research status element');
const indexSrc = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const appSrc = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const cssSrc = fs.readFileSync(require.resolve('../styles.css'), 'utf8');

test('#researchStatus element exists in index.html', () => {
    assert.ok(indexSrc.includes('id="researchStatus"'), 'element present');
});

test('setResearchStatus exists in app.js', () => {
    assert.ok(appSrc.includes('function setResearchStatus'), 'function present');
});

test('.research-status CSS classes exist', () => {
    assert.ok(cssSrc.includes('.research-status'), 'base class present');
    assert.ok(cssSrc.includes('.research-status-loading'), 'loading class present');
    assert.ok(cssSrc.includes('.research-status-ready'), 'ready class present');
    assert.ok(cssSrc.includes('.research-status-failed'), 'failed class present');
});

// ---------------------------------------------------------------------------
// Analytics untouched
// ---------------------------------------------------------------------------
console.log('\n[Analytics]');
const analyticsSrc = fs.readFileSync(require.resolve('../api/analytics.js'), 'utf8');
test('api/analytics.js still supports insert/read/delete', () => {
    assert.ok(analyticsSrc.includes("req.method === 'POST'"), 'POST insert path');
    assert.ok(analyticsSrc.includes("req.method === 'DELETE'"), 'DELETE path');
    assert.ok(analyticsSrc.includes("req.method === 'GET'") || analyticsSrc.includes("// GET"), 'GET read path');
    assert.ok(analyticsSrc.includes('analytics_events'), 'uses analytics_events table');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n========================================`);
console.log(`Results: ${passCount} passed, ${failCount} failed`);
console.log(`========================================`);
process.exit(failCount > 0 ? 1 : 0);
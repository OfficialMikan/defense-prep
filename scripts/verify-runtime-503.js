// ============================================================================
// scripts/verify-runtime-503.js
// ----------------------------------------------------------------------------
// Runtime test of the Missing-Supabase 503 handling. Since SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are NOT SET in this environment, lib/supabase.js
// returns null, so each API handler must return 503 with the safe message
// BEFORE attempting any database operation.
//
// This actually invokes the real handlers with mock req/res objects.
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

// Mock req/res
function makeRes() {
    const res = {
        statusCode: null,
        body: null,
        headers: {},
        status(code) { this.statusCode = code; return this; },
        json(obj) { this.body = obj; return this; },
        setHeader(k, v) { this.headers[k] = v; return this; },
        end() { return this; }
    };
    return res;
}

function makeReq(method, body = {}, headers = {}) {
    return { method, body, headers, socket: { remoteAddress: '127.0.0.1' } };
}

// Verify supabase is actually null (env vars not set)
const { supabase } = require('../lib/supabase');
test('supabase client is null (env vars not set)', () => {
    assert.strictEqual(supabase, null, 'supabase should be null when env vars missing');
});

// --- api/chat.js ---
console.log('\n[Runtime] api/chat.js 503 handling');
const chatHandler = require('../api/chat.js');

test('api/chat.js returns 503 with safe message when supabase missing', async () => {
    const res = makeRes();
    await chatHandler(makeReq('POST', { accessToken: 'x', messages: [{ role: 'user', content: 'hi' }] }), res);
    assert.strictEqual(res.statusCode, 503, `expected 503, got ${res.statusCode}`);
    assert.strictEqual(res.body.error, 'Research database not configured', 'safe message');
    assert.ok(!JSON.stringify(res.body).includes('SUPABASE_SERVICE_ROLE_KEY'), 'no service key');
    assert.ok(!JSON.stringify(res.body).includes('process.env'), 'no env values');
    assert.ok(!JSON.stringify(res.body).includes('stack'), 'no stack trace');
});

test('api/chat.js still rejects non-POST with 405 (before 503 guard)', async () => {
    const res = makeRes();
    await chatHandler(makeReq('GET'), res);
    assert.strictEqual(res.statusCode, 405, `expected 405, got ${res.statusCode}`);
});

// --- api/ingest.js ---
console.log('\n[Runtime] api/ingest.js 503 handling');
const ingestHandler = require('../api/ingest.js');

test('api/ingest.js returns 503 with safe message when supabase missing', async () => {
    const res = makeRes();
    await ingestHandler(makeReq('POST', { accessToken: 'x', docNumber: 1, text: 'hello' }), res);
    assert.strictEqual(res.statusCode, 503, `expected 503, got ${res.statusCode}`);
    assert.strictEqual(res.body.error, 'Research database not configured', 'safe message');
});

// --- api/retrieve.js ---
console.log('\n[Runtime] api/retrieve.js 503 handling');
const retrieveHandler = require('../api/retrieve.js');

test('api/retrieve.js returns 503 with safe message when supabase missing', async () => {
    const res = makeRes();
    await retrieveHandler(makeReq('POST', { accessToken: 'x', query: 'test' }), res);
    assert.strictEqual(res.statusCode, 503, `expected 503, got ${res.statusCode}`);
    assert.strictEqual(res.body.error, 'Research database not configured', 'safe message');
});

// --- Summary ---
console.log(`\n========================================`);
console.log(`Results: ${passCount} passed, ${failCount} failed`);
console.log(`========================================`);
process.exit(failCount > 0 ? 1 : 0);
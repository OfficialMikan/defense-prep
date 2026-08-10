// Script to check environment variables and test call the handler
const dbg = require('../api/debug');
const chatHandler = require('../api/chat.js');

console.log('Environment variables check:');
console.log('OPENAI_API_KEY set:', !!process.env.OPENAI_API_KEY);
console.log('GROQ_API_KEY set:', !!process.env.GROQ_API_KEY);
console.log('SUPABASE_URL set:', !!process.env.SUPABASE_URL);
console.log('SUPABASE_ANON_KEY set:', !!process.env.SUPABASE_ANON_KEY);
console.log('SUPABASE_SERVICE_ROLE_KEY set:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);

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

async function run() {
    console.log('\nSimulating /api/chat invocation...');
    const res = makeRes();
    const req = makeReq('POST', {
        accessToken: 'mock-token',
        prompt: 'test prompt',
        json: true,
        messages: [{ role: 'user', content: 'hello' }]
    });

    try {
        await chatHandler(req, res);
        console.log('Response status:', res.statusCode);
        console.log('Response body:', res.body);
    } catch (e) {
        console.error('Unhandled handler error:', e);
    }
}

run();

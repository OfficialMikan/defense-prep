/**
 * API module tests
 * Loads js/api.js into a sandboxed context with a mocked fetch
 * and exercises api.parseJSON + api.call (no real network).
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { describe, it, beforeEach, assert } = require('./_test-runner');

function loadApiScript({ fetchImpl = () => Promise.reject(new Error('not stubbed')) } = {}) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'api.js'), 'utf8');
    const sandbox = {
        console,
        fetch: fetchImpl,
        AbortController: globalThis.AbortController
    };
    sandbox.global = sandbox;
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    return sandbox;
}

describe('API_CONFIG', () => {
    it('is frozen and points at /api/chat', () => {
        const s = loadApiScript();
        assert.equal(Object.isFrozen(s.API_CONFIG), true);
        assert.equal(s.API_CONFIG.ENDPOINT, '/api/chat');
    });

    it('has a positive timeout', () => {
        const s = loadApiScript();
        assert.ok(s.API_CONFIG.TIMEOUT_MS > 0, 'TIMEOUT_MS should be positive');
    });
});

describe('api.parseJSON', () => {
    let api;
    beforeEach(() => { api = loadApiScript().api; });

    it('parses plain JSON strings', () => {
        assert.deepEqual(api.parseJSON('{"a":1}'), { a: 1 });
    });

    it('strips json-fenced markdown code blocks', () => {
        const input = '```json\n{"question":"Q?","answer":"A."}\n```';
        assert.deepEqual(api.parseJSON(input), { question: 'Q?', answer: 'A.' });
    });

    it('strips plain-fenced code blocks', () => {
        const input = '```\n{"k":42}\n```';
        assert.deepEqual(api.parseJSON(input), { k: 42 });
    });

    it('recovers JSON embedded in prose', () => {
        const input = 'Sure! Here is the JSON: {"foo":"bar"} -- hope it helps';
        assert.deepEqual(api.parseJSON(input), { foo: 'bar' });
    });

    it('throws on non-JSON content', () => {
        assert.throws(() => api.parseJSON('not json at all'), 'AI response was not valid JSON');
    });

    it('throws on non-string input', () => {
        assert.throws(() => api.parseJSON({ not: 'a string' }), 'Invalid content type');
    });
});

describe('api.call (network)', () => {
    it('sends POST with JSON body and returns the message content', async () => {
        let received;
        const fetchImpl = async (url, options) => {
            received = { url, options };
            return {
                ok: true,
                status: 200,
                json: async () => ({ choices: [{ message: { content: 'hello' } }] })
            };
        };
        const s = loadApiScript({ fetchImpl });
        const content = await s.api.call('test prompt');
        assert.equal(content, 'hello');
        assert.equal(received.url, '/api/chat');
        assert.equal(received.options.method, 'POST');
        assert.equal(received.options.headers['Content-Type'], 'application/json');
        const body = JSON.parse(received.options.body);
        assert.equal(body.prompt, 'test prompt');
    });

    it('throws on non-OK responses with the server error message', async () => {
        const fetchImpl = async () => ({
            ok: false,
            status: 500,
            json: async () => ({ error: 'kaboom' })
        });
        const s = loadApiScript({ fetchImpl });
        try {
            await s.api.call('test');
            assert.ok(false, 'expected throw');
        } catch (e) {
            assert.equal(e.message, 'kaboom');
        }
    });

    it('throws on empty AI response', async () => {
        const fetchImpl = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ choices: [] })
        });
        const s = loadApiScript({ fetchImpl });
        try {
            await s.api.call('test');
            assert.ok(false, 'expected throw');
        } catch (e) {
            assert.equal(e.message, 'Empty response from AI service');
        }
    });

    it('aborts the previous request when a new one starts', async () => {
        const abortedSignals = [];
        let callCount = 0;
        const fetchImpl = (url, options) => {
            callCount++;
            abortedSignals.push(options.signal);
            return new Promise((resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            });
        };
        const s = loadApiScript({ fetchImpl });
        const p1 = s.api.call('first');
        const p2 = s.api.call('second');
        try { await p1; } catch (_) { /* expected: aborted */ }
        try { await p2; } catch (_) { /* expected: never resolves in this stub */ }
        assert.equal(callCount, 2);
        assert.equal(abortedSignals[0].aborted, true);
    });
});

// /api/debug.js
// ============================================================
// Shared debugging helpers for the serverless API functions.
//
// HOW TO ENABLE VERBOSE LOGGING:
//   Set the environment variable DEBUG=true (or DEBUG=1) in
//   Vercel / your local shell. When disabled, only important
//   (error / lifecycle) logs are emitted so you can still see
//   what happened in production without log noise.
//
// USAGE:
//   const dbg = require('./debug');
//   dbg.log('api/chat', 'handler started');
//   dbg.debug('api/chat', 'request body', dbg.summarizeBody(body));
//   dbg.error('api/chat', err);
// ============================================================

function now() {
    return new Date().toISOString();
}

function enabled() {
    const value = process.env.DEBUG;
    return value === 'true' || value === '1' || value === 'yes';
}

// Always-on lifecycle log (method, status, milestones).
function log(scope, ...args) {
    console.log(`[${now()}] [${scope}]`, ...args);
}

// Verbose log — only shown when DEBUG=true.
function debug(scope, ...args) {
    if (!enabled()) return;
    console.log(`[${now()}] [DEBUG] [${scope}]`, ...args);
}

// Error log — always shown, includes stack trace when available.
function error(scope, err) {
    const detail = err && err.stack ? err.stack : String(err);
    console.error(`[${now()}] [ERROR] [${scope}]`, detail);
}

// Truncate a payload so logs stay readable (default 500 chars).
function summarizeBody(payload, max = 500) {
    if (payload === undefined || payload === null) return String(payload);
    let str = payload;
    if (typeof payload !== 'string') {
        try {
            str = JSON.stringify(payload);
        } catch (e) {
            str = String(payload);
        }
    }
    if (str.length > max) {
        return `${str.slice(0, max)}... (${str.length} chars total)`;
    }
    return str;
}

module.exports = { now, log, debug, error, summarizeBody, enabled };


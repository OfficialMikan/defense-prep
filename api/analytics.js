// /api/analytics.js
// Serverless endpoint for the analytics/admin panel.
//
// It records visits/events and lets the (authenticated) admin fetch usage data,
// including device type, per-user info, and chat logs.
//
// STORAGE:
//   - Primary: Vercel KV (Upstash) via the `@vercel/kv` package, using the
//     `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars Vercel auto-sets.
//   - Fallback: if KV is not configured, events are logged to the server
//     console only (no persistence). This keeps the app working without a DB.
//
// ENV:
//   ADMIN_PASS  - a secret password for the admin panel (required to view data).
//   KV_REST_API_URL / KV_REST_API_TOKEN - set by Vercel KV integration.
//
// HARDENING:
//   - POST body size is capped (MAX_BODY_BYTES) to stop malicious payloads.
//   - `type` must be in an allowlist; unknown types are dropped.
//   - A simple in-memory per-IP rate limit prevents endpoint spam.
//   - KV keys are stored with a TTL (30 days) so storage never grows unbounded.

const dbg = require('./debug');

let kv = null;
try {
    // eslint-disable-next-line global-require
    kv = require('@vercel/kv');
} catch (e) {
    kv = null;
}

// Hard limits for the public POST endpoint.
const MAX_BODY_BYTES = 20000;          // reject bodies larger than ~20KB
const MAX_DATA_BYTES = 12000;          // cap the `data` object to ~12KB
const ALLOWED_TYPES = new Set([
    'view', 'flashcard', 'chat', 'card_report', 'clear_favorites',
    'chapter_view', 'export_pdf', 'export_photo', 'login'
]);
const EVENT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Simple in-memory rate limiter keyed by IP + window. This is NOT a full
// distributed limiter but is sufficient to stop casual spam against a single
// serverless instance.
const RATE_WINDOW_MS = 60000;      // 1 minute
const RATE_MAX_PER_WINDOW = 120;   // max POSTs per IP per minute
const rateBuckets = new Map();

function isRateLimited(ip) {
    const now = Date.now();
    const bucket = rateBuckets.get(ip);
    if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
        // Fresh window.
        rateBuckets.set(ip, { start: now, count: 1 });
        return false;
    }
    bucket.count += 1;
    if (bucket.count > RATE_MAX_PER_WINDOW) {
        return true;
    }
    // Opportunistic cleanup of stale buckets to keep memory bounded.
    if (rateBuckets.size > 2000) {
        for (const [key, b] of rateBuckets) {
            if (now - b.start > RATE_WINDOW_MS) rateBuckets.delete(key);
        }
    }
    return false;
}

function nowISO() {
    return new Date().toISOString();
}

function getClientInfo(req) {
    const xff = req.headers['x-forwarded-for'];
    const ip = xff ? xff.split(',')[0].trim() : (req.socket && req.socket.remoteAddress) || 'unknown';
    const ua = req.headers['user-agent'] || 'unknown';
    let device = 'desktop';
    if (/mobile|android|iphone|ipad/i.test(ua)) device = 'mobile';
    else if (/tablet|ipad/i.test(ua)) device = 'tablet';
    return { ip, userAgent: ua, device, timestamp: nowISO() };
}

// Keep only whitelisted, small fields so the `data` object can't blow the
// storage or be used to smuggle huge strings through.
function sanitizeData(data) {
    if (!data || typeof data !== 'object') return {};
    const clean = {};
    for (const key of ['chapter', 'difficulty', 'component', 'reason', 'source']) {
        if (typeof data[key] === 'string') clean[key] = data[key].slice(0, 500);
    }
    // Chat snippets: cap length so a single message can't bloat the store.
    if (typeof data.message === 'string') clean.message = data.message.slice(0, 1000);
    if (typeof data.snippet === 'string') clean.snippet = data.snippet.slice(0, 1000);
    if (typeof data.botSnippet === 'string') clean.botSnippet = data.botSnippet.slice(0, 1000);
    if (typeof data.question === 'string') clean.question = data.question.slice(0, 1000);
    if (typeof data.answer === 'string') clean.answer = data.answer.slice(0, 1000);
    if (typeof data.userId === 'string') clean.userId = data.userId.slice(0, 64);
    if (typeof data.sessionId === 'string') clean.sessionId = data.sessionId.slice(0, 64);
    if (typeof data.messages === 'string') clean.messages = data.messages.slice(0, 2000);
    // Counters / booleans pass through unchanged.
    if (typeof data.id === 'number') clean.id = data.id;
    if (typeof data.page === 'string') clean.page = data.page.slice(0, 64);
    return clean;
}

async function recordEvent(req, type, extra = {}) {
    const info = getClientInfo(req);
    const event = { type, ...info, ...extra };
    if (kv && typeof kv.set === 'function') {
        try {
            // Append to a KV list (best-effort). Keys are scoped/sharded by day.
            const day = new Date().toISOString().slice(0, 10);
            const key = `analytics:events:${day}`;
            const existing = (await kv.get(key)) || [];
            existing.push(event);
            if (existing.length > 5000) existing.shift(); // cap per-day list
            await kv.set(key, existing, { ex: EVENT_TTL_SECONDS });
            await kv.set('analytics:latest', event, { ex: EVENT_TTL_SECONDS });
        } catch (e) {
            dbg.error('api/analytics', 'KV write failed');
        }
    } else {
        // Fallback: console only.
        console.log('[analytics]', JSON.stringify(event));
    }
    return event;
}

async function fetchEvents() {
    if (!kv || typeof kv.get !== 'function') return [];
    const events = [];
    try {
        // Use a fixed set of daily keys (last 31 days) instead of an
        // unbounded kv.keys() scan, which is expensive on Upstash.
        const today = new Date();
        for (let i = 0; i < 31; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const key = `analytics:events:${d.toISOString().slice(0, 10)}`;
            const list = (await kv.get(key)) || [];
            events.push(...list);
        }
    } catch (e) {
        dbg.error('api/analytics', 'KV read failed');
    }
    return events;
}

module.exports = async function handler(req, res) {
    const scope = 'api/analytics';
    dbg.log(scope, 'Handler invoked');

    // CORS: reflect the request origin when present (same app + admin panel).
    const origin = req.headers.origin;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    try {
        if (req.method === 'POST') {
            // Record an event (public, no auth needed). Hardened against abuse.
            const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
            if (isRateLimited(ip)) {
                return res.status(429).json({ error: 'Too many requests. Slow down.' });
            }

            // Cap the raw body size.
            const rawLen = (req.headers['content-length'] && Number(req.headers['content-length'])) || 0;
            if (rawLen > MAX_BODY_BYTES) {
                return res.status(413).json({ error: 'Payload too large.' });
            }

            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const type = typeof body.type === 'string' ? body.type : 'view';
            if (!ALLOWED_TYPES.has(type)) {
                // Drop unknown event types (don't persist garbage).
                return res.status(200).json({ ok: true, ignored: true });
            }

            const data = sanitizeData(body.data || {});
            const event = await recordEvent(req, type, data);
            return res.status(200).json({ ok: true, event });
        }

        // GET / DELETE require admin auth.
        const auth = req.headers.authorization || '';
        const token = auth.replace(/^Bearer\s+/i, '');
        const expected = process.env.ADMIN_PASS || '';
        if (!expected || token !== expected) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (req.method === 'DELETE') {
            // Clear stored events (only the fixed daily keys we know about).
            if (kv && typeof kv.set === 'function') {
                try {
                    const today = new Date();
                    for (let i = 0; i < 31; i++) {
                        const d = new Date(today);
                        d.setDate(d.getDate() - i);
                        const key = `analytics:events:${d.toISOString().slice(0, 10)}`;
                        await kv.del(key);
                    }
                    await kv.del('analytics:latest');
                } catch (e) {
                    dbg.error('api/analytics', 'KV clear failed');
                }
            }
            return res.status(200).json({ ok: true, cleared: true });
        }

        // GET: return aggregated + raw events.
        const events = await fetchEvents();
        const byDevice = {};
        const byType = {};
        const byChapter = {};
        const users = {};
        const chatLogs = [];

        for (const ev of events) {
            byDevice[ev.device] = (byDevice[ev.device] || 0) + 1;
            byType[ev.type] = (byType[ev.type] || 0) + 1;
            if (ev.chapter) byChapter[ev.chapter] = (byChapter[ev.chapter] || 0) + 1;

            // Aggregate per-user info by IP (fall back to userId).
            const userKey = ev.userId || ev.ip || 'unknown';
            if (!users[userKey]) {
                users[userKey] = {
                    userId: ev.userId || null,
                    ip: ev.ip || 'unknown',
                    device: ev.device || 'unknown',
                    firstSeen: ev.timestamp,
                    lastSeen: ev.timestamp,
                    chats: 0,
                    flashcards: 0,
                    reports: 0,
                    events: 0
                };
            }
            const u = users[userKey];
            u.events += 1;
            if (ev.timestamp > u.lastSeen) u.lastSeen = ev.timestamp;
            if (ev.timestamp < u.firstSeen) u.firstSeen = ev.timestamp;
            if (ev.type === 'chat') u.chats += 1;
            if (ev.type === 'flashcard') u.flashcards += 1;
            if (ev.type === 'card_report') u.reports += 1;

            // Collect chat log entries.
            if (ev.type === 'chat') {
                chatLogs.push({
                    timestamp: ev.timestamp,
                    userId: ev.userId || ev.ip || 'unknown',
                    device: ev.device || 'unknown',
                    message: ev.message || '',
                    botSnippet: ev.botSnippet || '',
                    chapter: ev.chapter || ''
                });
            }
        }

        return res.status(200).json({
            total: events.length,
            byDevice,
            byType,
            byChapter,
            users: Object.values(users).sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen)),
            chatLogs: chatLogs.slice(-300).reverse(), // last 300 chat messages
            events: events.slice(-500).reverse()      // last 500 raw events
        });

    } catch (error) {
        dbg.error(scope, error);
        return res.status(500).json({ error: 'Internal error' });
    }
};

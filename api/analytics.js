// /api/analytics.js
const { createClient } = require('@supabase/supabase-js');
const dbg = require('./debug');
const { checkAdminAuth } = require('../lib/adminAuth');

// Initialize Supabase Client (only if the URL is a valid HTTP/HTTPS URL —
// otherwise fall back to console-only logging so the endpoint never crashes).
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isValidUrl = (typeof supabaseUrl === 'string') && /^https?:\/\/.+/.test(supabaseUrl);
const supabase = (isValidUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const MAX_BODY_BYTES = 20000;
const ALLOWED_TYPES = new Set([
    'view', 'flashcard', 'chat', 'card_report', 'clear_favorites',
    'chapter_view', 'export_pdf', 'export_photo', 'login'
]);

// In-process sliding-window rate limit for analytics POSTs. Note: on Vercel
// each cold start is a fresh Map, so this is per-warm-instance. The Vercel KV
// dependency is declared in package.json for a future cross-instance limit.
const RATE_WINDOW_MS = 60000;
const RATE_MAX_PER_WINDOW = 120;
const rateBuckets = new Map();

// Stricter rate limit for admin (GET/DELETE) requests. 10 requests per minute
// per IP — ample for a real dashboard, hostile to brute force.
const ADMIN_RATE_WINDOW_MS = 60000;
const ADMIN_RATE_MAX = 10;
const adminRateBuckets = new Map();

function isAdminRateLimited(ip) {
    const now = Date.now();
    const bucket = adminRateBuckets.get(ip);
    if (!bucket || now - bucket.start > ADMIN_RATE_WINDOW_MS) {
        adminRateBuckets.set(ip, { start: now, count: 1 });
        return false;
    }
    bucket.count += 1;
    if (bucket.count > ADMIN_RATE_MAX) return true;
    if (adminRateBuckets.size > 1000) {
        for (const [key, b] of adminRateBuckets) {
            if (now - b.start > ADMIN_RATE_WINDOW_MS) adminRateBuckets.delete(key);
        }
    }
    return false;
}

function isRateLimited(ip) {
    const now = Date.now();
    const bucket = rateBuckets.get(ip);
    if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
        rateBuckets.set(ip, { start: now, count: 1 });
        return false;
    }
    bucket.count += 1;
    if (bucket.count > RATE_MAX_PER_WINDOW) return true;

    if (rateBuckets.size > 2000) {
        for (const [key, b] of rateBuckets) {
            if (now - b.start > RATE_WINDOW_MS) rateBuckets.delete(key);
        }
    }
    return false;
}

function getClientInfo(req) {
    const xff = req.headers['x-forwarded-for'];
    const ip = xff ? xff.split(',')[0].trim() : (req.socket && req.socket.remoteAddress) || 'unknown';
    const ua = req.headers['user-agent'] || 'unknown';
    let device = 'desktop';
    if (/mobile|android|iphone|ipad/i.test(ua)) device = 'mobile';
    else if (/tablet|ipad/i.test(ua)) device = 'tablet';
    return { ip, user_agent: ua, device };
}

function sanitizeData(data) {
    if (!data || typeof data !== 'object') return {};
    const clean = {};
    for (const key of ['chapter', 'difficulty', 'component', 'reason', 'source']) {
        if (typeof data[key] === 'string') clean[key] = data[key].slice(0, 500);
    }
    if (typeof data.message === 'string') clean.message = data.message.slice(0, 1000);
    if (typeof data.snippet === 'string') clean.snippet = data.snippet.slice(0, 1000);
    if (typeof data.botSnippet === 'string') clean.bot_snippet = data.botSnippet.slice(0, 1000);
    if (typeof data.question === 'string') clean.question = data.question.slice(0, 1000);
    if (typeof data.answer === 'string') clean.answer = data.answer.slice(0, 1000);
    if (typeof data.userId === 'string') clean.user_id = data.userId.slice(0, 64);
    if (typeof data.sessionId === 'string') clean.session_id = data.sessionId.slice(0, 64);
    if (typeof data.page === 'string') clean.page = data.page.slice(0, 64);
    return clean;
}

async function recordEvent(req, type, extra = {}) {
    const info = getClientInfo(req);
    const event = { type, ...info, ...extra };

    if (supabase) {
        try {
            const { error } = await supabase.from('analytics_events').insert([event]);
            if (error) dbg.error('api/analytics', `Supabase insert failed: ${error.message}`);
        } catch (e) {
            dbg.error('api/analytics', 'Supabase write error');
        }
    } else {
        console.log('[analytics]', JSON.stringify(event));
    }
    return event;
}

module.exports = async function handler(req, res) {
    const scope = 'api/analytics';

    const origin = req.headers.origin;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(204).end();

    try {
        if (req.method === 'POST') {
            const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
            if (isRateLimited(ip)) {
                return res.status(429).json({ error: 'Too many requests. Slow down.' });
            }

            const rawLen = (req.headers['content-length'] && Number(req.headers['content-length'])) || 0;
            if (rawLen > MAX_BODY_BYTES) {
                return res.status(413).json({ error: 'Payload too large.' });
            }

            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const type = typeof body.type === 'string' ? body.type : 'view';
            if (!ALLOWED_TYPES.has(type)) {
                return res.status(200).json({ ok: true, ignored: true });
            }

            const data = sanitizeData(body.data || {});
            const event = await recordEvent(req, type, data);
            return res.status(200).json({ ok: true, event });
        }

        // Admin authentication — timing-safe compare, length floor, rate-limited.
        const adminIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
        if (isAdminRateLimited(adminIp)) {
            return res.status(429).json({ error: 'Too many admin requests. Slow down.' });
        }
        const authResult = checkAdminAuth(req.headers.authorization || '');
        if (!authResult.ok) {
            if (authResult.reason === 'misconfigured') {
                dbg.error('api/analytics', 'ADMIN_PASS is unset or shorter than 16 chars; admin endpoint refused');
                return res.status(503).json({ error: 'Admin endpoint misconfigured' });
            }
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (req.method === 'DELETE') {
            if (!supabase) {
                return res.status(503).json({ error: 'Database not configured' });
            }
            const { error, count } = await supabase
                .from('analytics_events')
                .delete({ count: 'exact' })
                .gte('created_at', '1970-01-01T00:00:00Z');
            if (error) {
                dbg.error('api/analytics', `Supabase clear failed: ${error.message}`);
                return res.status(502).json({ error: 'Clear failed' });
            }
            return res.status(200).json({ ok: true, cleared: true, count: count || 0 });
        }

        // GET: Query events from Supabase for the last 30 days
        let events = [];
        if (supabase) {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const { data, error } = await supabase
                .from('analytics_events')
                .select('*')
                .gte('created_at', thirtyDaysAgo)
                .order('created_at', { ascending: false });

            if (!error && data) events = data;
        }

        const byDevice = {};
        const byType = {};
        const byChapter = {};
        const users = {};
        const chatLogs = [];

        for (const ev of events) {
            const timestamp = ev.created_at;
            byDevice[ev.device] = (byDevice[ev.device] || 0) + 1;
            byType[ev.type] = (byType[ev.type] || 0) + 1;
            if (ev.chapter) byChapter[ev.chapter] = (byChapter[ev.chapter] || 0) + 1;

            const userKey = ev.user_id || ev.ip || 'unknown';
            if (!users[userKey]) {
                users[userKey] = {
                    userId: ev.user_id || null,
                    ip: ev.ip || 'unknown',
                    device: ev.device || 'unknown',
                    firstSeen: timestamp,
                    lastSeen: timestamp,
                    chats: 0,
                    flashcards: 0,
                    reports: 0,
                    events: 0
                };
            }
            const u = users[userKey];
            u.events += 1;
            if (timestamp > u.lastSeen) u.lastSeen = timestamp;
            if (timestamp < u.firstSeen) u.firstSeen = timestamp;
            if (ev.type === 'chat') u.chats += 1;
            if (ev.type === 'flashcard') u.flashcards += 1;
            if (ev.type === 'card_report') u.reports += 1;

            if (ev.type === 'chat') {
                chatLogs.push({
                    timestamp,
                    userId: ev.user_id || ev.ip || 'unknown',
                    device: ev.device || 'unknown',
                    message: ev.message || '',
                    botSnippet: ev.bot_snippet || '',
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
            chatLogs: chatLogs.slice(0, 300),
            events: events.slice(0, 500)
        });

    } catch (error) {
        dbg.error(scope, error);
        return res.status(500).json({ error: 'Internal error' });
    }
};

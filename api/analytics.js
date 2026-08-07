// /api/analytics.js
// Serverless endpoint for the analytics/admin panel.
//
// It records visits/events and lets the (authenticated) admin fetch usage data,
// including device type and (optionally) chat snippets.
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

const dbg = require('./debug');

let kv = null;
try {
    // eslint-disable-next-line global-require
    kv = require('@vercel/kv');
} catch (e) {
    kv = null;
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

async function recordEvent(req, type, extra = {}) {
    const info = getClientInfo(req);
    const event = { type, ...info, ...extra };
    if (kv && typeof kv.set === 'function') {
        try {
            // Append to a KV list (best-effort). Keys are scoped/sharded by day.
            const key = `analytics:events:${new Date().toISOString().slice(0, 10)}`;
            const existing = (await kv.get(key)) || [];
            existing.push(event);
            if (existing.length > 5000) existing.shift(); // cap per-day list
            await kv.set(key, existing);
            await kv.set('analytics:latest', event);
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
        const keys = await kv.keys('analytics:events:*');
        for (const k of keys || []) {
            const list = (await kv.get(k)) || [];
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

    // CORS for the admin panel (same origin, but keep permissive for dev).
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    try {
        if (req.method === 'POST') {
            // Record an event (public, no auth needed).
            const body = req.body || {};
            const type = typeof body.type === 'string' ? body.type : 'view';
            const extra = body.data || {};
            const event = await recordEvent(req, type, extra);
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
            // Clear stored events.
            if (kv && typeof kv.set === 'function') {
                try {
                    const keys = await kv.keys('analytics:events:*');
                    for (const k of keys || []) await kv.del(k);
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
        for (const ev of events) {
            byDevice[ev.device] = (byDevice[ev.device] || 0) + 1;
            byType[ev.type] = (byType[ev.type] || 0) + 1;
            if (ev.chapter) byChapter[ev.chapter] = (byChapter[ev.chapter] || 0) + 1;
        }
        return res.status(200).json({
            total: events.length,
            byDevice,
            byType,
            byChapter,
            events: events.slice(-500) // last 500 raw events
        });

    } catch (error) {
        dbg.error(scope, error);
        return res.status(500).json({ error: 'Internal error' });
    }
};

// ============================================================================
// lib/adminAuth.js
// ----------------------------------------------------------------------------
// Shared admin authentication helper for serverless endpoints.
//
// Endpoints that expose privileged data (analytics dashboard, raw retrieval
// chunks, future admin actions) all delegate to `checkAdminAuth` so the
// timing-safe compare and minimum-secret-length rule live in exactly one
// place. Bug fixes and rule changes propagate to every caller.
//
// Security model:
//   - The admin password lives in `process.env.ADMIN_PASS` (server-side only).
//   - Callers send `Authorization: Bearer <ADMIN_PASS>`.
//   - The compare uses `crypto.timingSafeEqual` so a brute-forcer cannot
//     time-distinguish a correct prefix from a wrong one.
//   - A 16-character floor on the configured secret prevents accidental
//     short-password deployments from silently granting access.
//   - When misconfigured, `ok: false` with `reason: 'misconfigured'` is
//     returned so the caller can return 503 (don't pretend auth worked).
// ============================================================================

const crypto = require('crypto');

const MIN_ADMIN_PASS_LENGTH = 16;

function checkAdminAuth(authHeader) {
    const expected = process.env.ADMIN_PASS || '';
    if (!expected || expected.length < MIN_ADMIN_PASS_LENGTH) {
        return { ok: false, reason: 'misconfigured' };
    }
    const token = String(authHeader || '').replace(/^Bearer\s+/i, '');
    if (!token) return { ok: false, reason: 'missing' };
    // timingSafeEqual requires equal-length buffers; pad the shorter one to
    // avoid leaking the length via a thrown RangeError.
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    const len = Math.max(a.length, b.length);
    const aPad = Buffer.concat([a, Buffer.alloc(len - a.length)]);
    const bPad = Buffer.concat([b, Buffer.alloc(len - b.length)]);
    const equal = a.length === b.length && crypto.timingSafeEqual(aPad, bPad);
    return { ok: equal, reason: equal ? 'ok' : 'mismatch' };
}

module.exports = {
    checkAdminAuth,
    MIN_ADMIN_PASS_LENGTH
};

/**
 * Service worker - offline support for the Panel Defense Simulator
 * Strategy:
 *   - App shell (HTML, CSS, JS, data): stale-while-revalidate
 *   - API requests (/api/*): network-only (do not cache AI responses)
 *   - External CDN scripts: cache-first with long TTL
 */

const CACHE_VERSION = 'v1';
const APP_SHELL_CACHE = `app-shell-${CACHE_VERSION}`;
const CDN_CACHE = `cdn-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

const APP_SHELL = [
    './',
    'index.html',
    'css/styles.css',
    'js/storage.js',
    'js/toast.js',
    'js/api.js',
    'js/data.js',
    'js/chatbot.js',
    'js/app.js',
    'data/research-proposal.json'
];

const CDN_ASSETS = [
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_SHELL_CACHE)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key !== APP_SHELL_CACHE && key !== CDN_CACHE && key !== RUNTIME_CACHE)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Never cache API requests — they must hit the network fresh
    if (url.pathname.startsWith('/api/')) {
        return; // fall through to default browser handling
    }

    // Cache-first for known CDN assets
    if (CDN_ASSETS.includes(request.url)) {
        event.respondWith(cacheFirst(request, CDN_CACHE));
        return;
    }

    // Stale-while-revalidate for same-origin app shell + same-origin GETs
    if (request.method === 'GET' && url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE));
    }
});

async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        // Offline and not in cache
        return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const networkPromise = fetch(request)
        .then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
        })
        .catch(() => cached);
    return cached || networkPromise;
}

/* ============================================================
   Defense Prep - Service Worker (offline caching)
   ============================================================
   Provides basic offline support:
   - Pre-caches the app shell (HTML, CSS, JS, config).
   - Network-first for dynamic resources (APIs, chapter files) so
     fresh content is preferred, with a cache fallback for offline.
   ============================================================ */

const CACHE_NAME = 'defense-prep-v1';

// App shell to pre-cache on install.
const APP_SHELL = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './chapter-config.js',
    './admin.html'
];

// Install: pre-cache the app shell.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

// Activate: clean up old caches.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// Fetch: network-first with cache fallback for GET requests.
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    // Bypass the service worker for cross-origin CDN requests (let them use HTTP cache).
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(request)
            .then((response) => {
                // Cache successful same-origin responses (only cacheable types).
                const clone = response.clone();
                if (response.ok && (request.destination === 'document' ||
                    request.destination === 'script' ||
                    request.destination === 'style' ||
                    request.destination === 'font')) {
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                }
                return response;
            })
            .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
    );
});

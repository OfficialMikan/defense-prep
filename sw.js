/* ============================================================
   Defense Prep - Service Worker (offline caching)
   ============================================================
   - Pre-caches the app shell (HTML, CSS, JS, config).
   - Cache-first for known CDN libraries (Google Fonts, html2canvas,
     jsPDF, mammoth) so export/docx features work offline.
   - Cache-first for /data/chapters/* (txt/pdf/docx).
   - Network-first with cache fallback for same-origin app assets.
   - Cache version is derived from app shell ETags on install so it
     bumps automatically whenever deployed files change.
   ============================================================ */

const APP_SHELL = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './chapter-config.js',
    './admin.html'
];

const CDN_URLS = [
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf',
    'https://cdnjs.cloudflare.com/ajax/libs/mammoth',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js'
];

const CHAPTER_FILES = [
    '/data/chapters/chapter-1.txt',
    '/data/chapters/chapter-1.pdf',
    '/data/chapters/chapter-1.docx',
    '/data/chapters/chapter-2.txt',
    '/data/chapters/chapter-2.pdf',
    '/data/chapters/chapter-2.docx',
    '/data/chapters/chapter-3.txt',
    '/data/chapters/chapter-3.pdf',
    '/data/chapters/chapter-3.docx',
    '/data/chapters/chapter-4.txt',
    '/data/chapters/chapter-4.pdf',
    '/data/chapters/chapter-4.docx',
    '/data/chapters/chapter-5.txt',
    '/data/chapters/chapter-5.pdf',
    '/data/chapters/chapter-5.docx'
];

let cacheNamePromise = null;

function isCdnUrl(url) {
    return CDN_URLS.some((prefix) => url.href.startsWith(prefix));
}

function isChapterFile(url) {
    return /\/data\/chapters\/chapter-[1-5]\.(txt|pdf|docx)$/.test(url.pathname);
}

// Derive a stable cache name from the ETags/Last-Modified of core app files.
// When any shell file changes on deploy, the cache name changes and old
// caches are purged on activate — no manual version bump needed.
async function resolveCacheName() {
    if (cacheNamePromise) return cacheNamePromise;
    cacheNamePromise = (async () => {
        const tags = [];
        for (const path of ['./app.js', './index.html', './styles.css']) {
            try {
                const res = await fetch(path, { method: 'HEAD', cache: 'no-store' });
                tags.push(res.headers.get('etag') || res.headers.get('last-modified') || path);
            } catch {
                tags.push(path);
            }
        }
        const raw = tags.join('|');
        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) - hash) + raw.charCodeAt(i);
            hash |= 0;
        }
        return 'defense-prep-' + Math.abs(hash).toString(36);
    })();
    return cacheNamePromise;
}

async function openCache() {
    const name = await resolveCacheName();
    return caches.open(name);
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        resolveCacheName()
            .then((name) => caches.open(name))
            .then((cache) => cache.addAll(APP_SHELL).catch(() => Promise.resolve()))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        resolveCacheName()
            .then((currentName) => caches.keys().then((keys) => Promise.all(
                keys.filter((key) => key !== currentName).map((key) => caches.delete(key))
            )))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    if (isCdnUrl(url)) {
        event.respondWith((async () => {
            const cached = await caches.match(request);
            if (cached) return cached;
            try {
                const response = await fetch(request);
                if (response.ok) {
                    try {
                        const cache = await openCache();
                        await cache.put(request, response.clone());
                    } catch { /* ignore cache write failure */ }
                }
                return response;
            } catch {
                return cached;
            }
        })());
        return;
    }

    if (isChapterFile(url)) {
        event.respondWith((async () => {
            const cached = await caches.match(request);
            const network = fetch(request).then(async (response) => {
                if (response.ok) {
                    try {
                        const cache = await openCache();
                        await cache.put(request, response.clone());
                    } catch { /* ignore cache write failure */ }
                }
                return response;
            }).catch(() => cached);
            return cached || network;
        })());
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                if (response.ok && (request.destination === 'document' ||
                    request.destination === 'script' ||
                    request.destination === 'style' ||
                    request.destination === 'font')) {
                    try {
                        const cache = await openCache();
                        await cache.put(request, response.clone());
                    } catch { /* ignore cache write failure */ }
                }
                return response;
            } catch {
                const cached = await caches.match(request);
                return cached || caches.match('./index.html');
            }
        })());
    }
});

/**
 * E — Service Worker
 *
 * Caching strategy:
 *   /_app/immutable/**   → Cache-first (content-hashed, safe to cache forever)
 *   /api/**              → Network-only  (never cache live API responses)
 *   Navigation requests  → Network-first, fall back to cached index.html
 *   Everything else      → Network-first, fall back to cache
 */

const CACHE = 'e-v1';

// App shell: the minimum set of resources needed to render the UI offline.
// SvelteKit's immutable chunk names change each build, so we only pre-cache
// the entry points that are stable by path.
const PRECACHE = ['/', '/E.png', '/manifest.webmanifest'];

// ── Install: pre-cache the app shell ────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // addAll is atomic — one 404 kills the install. Cache each URL individually
      // so a missing optional asset doesn't break the whole SW install.
      await Promise.all(
        PRECACHE.map((url) =>
          fetch(url)
            .then((res) => {
              if (res.ok) cache.put(url, res);
            })
            .catch(() => {
              /* ignore — asset unavailable, skip silently */
            }),
        ),
      );
      await self.skipWaiting(); // activate immediately
    }),
  );
});

// ── Activate: prune old caches ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()), // take control of all open tabs immediately
  );
});

// ── Fetch: route-based caching strategy ─────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // API calls: network-only — never serve stale data from cache
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
    return; // fall through to browser default
  }

  // Immutable assets: cache-first (content-hashed filenames guarantee freshness)
  if (url.pathname.startsWith('/_app/immutable/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Static assets that rarely change
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/tree-sitter/') ||
    url.pathname === '/E.png' ||
    url.pathname === '/E.json' ||
    url.pathname === '/study-bg.jpg'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigation requests (HTML pages): network-first, fall back to index.html
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithSpaFallback(request));
    return;
  }

  // Everything else: network-first
  event.respondWith(networkFirst(request));
});

// ── Strategy: cache-first ────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

// ── Strategy: network-first ──────────────────────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? new Response('Offline', { status: 503 });
  }
}

// ── Strategy: network-first for navigation, SPA fallback ────────────────────
async function networkFirstWithSpaFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Try the exact URL from cache first
    const cached = await caches.match(request);
    if (cached) return cached;
    // SPA fallback: any navigation route can be served by index.html
    const index = await caches.match('/index.html');
    return index ?? new Response('Offline', { status: 503 });
  }
}

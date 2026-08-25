// Cache name is stamped per couple by generate-film-page.js. The cache
// storage is origin-wide while each SW is scoped to /films/<slug>/, so a
// shared name let couples at different template versions delete each
// other's caches during staggered rollouts (audit 2026-06-09).
const CACHE_NAME = 'fi-shell-matt-haley-v23';
const SHELL_ASSETS = [
  './',
  // Pinned to match the couple-page.html Vidstack pin. Precaching the
  // unversioned URLs cached assets the page never requests.
  'https://cdn.vidstack.io/player/theme.css@1.15.5',
  'https://cdn.vidstack.io/player/video.css@1.15.5',
  'https://cdn.vidstack.io/player@1.15.5'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          // Only clean up this couple's stale caches plus the legacy shared
          // fi-shell-vNN names. Never touch other couples' caches.
          .filter((key) =>
            key !== CACHE_NAME &&
            (key.indexOf('fi-shell-matt-haley-') === 0 || /^fi-shell-v\d+$/.test(key))
          )
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-only for HLS segments and playlists (never cache streaming data)
  if (url.pathname.endsWith('.ts') || url.pathname.endsWith('.m3u8')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first for thumbnails
  if (url.pathname.includes('/thumbs/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Cache-first for static assets (fonts, CSS, JS from CDN)
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'cdn.vidstack.io'
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Network-first for everything else (HTML, API calls)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

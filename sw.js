// Runway service worker: keeps every app file in a versioned cache so the app opens offline.
// Every release bumps VERSION (run `node tools/release.js`). A new version installs in the
// background and waits; the app shows "Update available, tap to refresh" and you choose when.
// Your data is in localStorage, which updates never touch.

const VERSION = '1.1.0';
const CACHE = `runway-${VERSION}`;

// Every file the app needs. tests/repo.test.js fails if one is missing.
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/actions.js',
  './js/app.js',
  './js/budget.js',
  './js/cards.js',
  './js/categories.js',
  './js/charts.js',
  './js/csv.js',
  './js/dates.js',
  './js/demo.js',
  './js/explain.js',
  './js/ids.js',
  './js/money.js',
  './js/pay.js',
  './js/recurring.js',
  './js/search.js',
  './js/store.js',
  './js/version.js',
  './js/ui/activity.js',
  './js/ui/backup.js',
  './js/ui/balance-chart.js',
  './js/ui/bills.js',
  './js/ui/brand.js',
  './js/ui/card-sheets.js',
  './js/ui/card.js',
  './js/ui/categories-page.js',
  './js/ui/dom.js',
  './js/ui/explain-sheet.js',
  './js/ui/files.js',
  './js/ui/format.js',
  './js/ui/forms.js',
  './js/ui/home.js',
  './js/ui/icons.js',
  './js/ui/insights.js',
  './js/ui/keypad.js',
  './js/ui/onboarding.js',
  './js/ui/quickadd.js',
  './js/ui/reconcile.js',
  './js/ui/settings.js',
  './js/ui/sheet.js',
  './js/ui/toast.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never mixes in old files.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('runway-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The page sends this when you tap "Update available".
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Opening the app (from the icon or a reload) always gets the cached page, online or not.
    // Other pages in the folder (like the docs) go to the network as usual.
    const scope = new URL(self.registration.scope).pathname;
    if (url.pathname !== scope && url.pathname !== `${scope}index.html`) return;
    event.respondWith(
      caches.match('./index.html', { ignoreSearch: true }).then((cached) => cached || fetch(request)),
    );
    return;
  }
  event.respondWith(caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)));
});

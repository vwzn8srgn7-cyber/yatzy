const CACHE = 'yatzy-v52';
const FILES = ['./', 'index.html', 'style.css?v=52', 'scoring.js?v=52', 'sfx.js?v=52', 'config.js?v=52', 'net.js?v=52', 'dice3d.js?v=52', 'vendor/three.module.min.js?v=52', 'vendor/RoundedBoxGeometry.js', 'app.js?v=52', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Netzwerk zuerst (damit Updates ankommen), Cache als Offline-Fallback
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});

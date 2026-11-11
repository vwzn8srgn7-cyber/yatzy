const CACHE = 'yatzy-v49';
const FILES = ['./', 'index.html', 'style.css?v=49', 'scoring.js?v=49', 'sfx.js?v=49', 'config.js?v=49', 'net.js?v=49', 'dice3d.js?v=49', 'vendor/three.module.min.js?v=49', 'vendor/RoundedBoxGeometry.js', 'app.js?v=49', 'manifest.webmanifest', 'icon.svg'];

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

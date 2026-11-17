const CACHE = 'yatzy-v81';
const FILES = ['./', 'index.html', 'style.css?v=81', 'scoring.js?v=81', 'sfx.js?v=81', 'config.js?v=81', 'net.js?v=81', 'dice3d.js?v=81', 'vendor/three.module.min.js?v=81', 'vendor/RoundedBoxGeometry.js', 'fonts/nunito-latin.woff2', 'avatars/vreni.webp', 'avatars/peter.webp', 'avatars/marco.webp', 'app.js?v=81', 'manifest.webmanifest', 'icon.svg'];

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

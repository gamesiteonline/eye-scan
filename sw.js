const CACHE = 'cybereye-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/camera.js',
  './js/tracker.js',
  './js/hud.js',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Don't cache mediapipe CDN or model
  if (url.hostname.includes('cdn.jsdelivr.net') || url.hostname.includes('googleapis') || url.hostname.includes('gstatic') || url.hostname.includes('mediapipe') || url.hostname.includes('storage.googleapis')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c=>c.put(e.request, copy)).catch(()=>{});
      return res;
    }).catch(()=> cached))
  );
});

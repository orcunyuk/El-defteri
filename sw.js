// Önce ağ, internet yoksa önbellek: güncellemeler hemen görünür, uygulama internetsiz de açılır.
// Kullanıcı verisi burada yoktur (IndexedDB'de şifreli).
const CACHE = 'el-defteri-v7';
const ASSETS = ['./', './index.html', './app.css', './app.js', './db.js', './crypto.js', './extract.js', './manifest.webmanifest',
  './icons/el-defteri-192.png', './icons/el-defteri-512.png', './icons/el-defteri-180.png',
  './vendor/pdfjs/pdf.min.js', './vendor/pdfjs/pdf.worker.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    // Büyük kütüphaneler (OCR vb.) değişmez: önbellekte varsa ağa gitme
    if (url.pathname.includes('/vendor/')) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
    }
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
    }
  }));
});

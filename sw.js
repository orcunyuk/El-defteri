// Uygulama dosyalarını önbelleğe alır; internetsiz çalışır. Kullanıcı verisi burada yoktur (IndexedDB'de şifreli).
const CACHE = 'el-defteri-v5';
const ASSETS = ['./', './index.html', './app.css', './app.js', './db.js', './crypto.js', './extract.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './vendor/pdfjs/pdf.min.js', './vendor/pdfjs/pdf.worker.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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
    const hit = await cache.match(req, { ignoreSearch: true });
    // Büyük kütüphaneler (OCR vb.) değişmez: önbellekte varsa ağa hiç gitme
    if (hit && url.pathname.includes('/vendor/')) return hit;
    // Diğerleri: önce önbellek, arka planda güncelle
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});

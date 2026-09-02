// 홈 화면 설치용 최소 서비스 워커.
// 우리 파일만, 네트워크 우선 + 실패 시 캐시. GitHub Pages 배포 후 오래된 화면이 남지 않게 하려는 것.
const CACHE = 'animal-sticker-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './js/app.js', './js/animals.js', './js/storage.js', './js/sticker.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // CDN 모델은 브라우저 캐시에 맡긴다
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

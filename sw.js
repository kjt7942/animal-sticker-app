// 홈 화면 설치용 최소 서비스 워커.
// 우리 파일만, 네트워크 우선 + 실패 시 캐시. GitHub Pages 배포 후 오래된 화면이 남지 않게 하려는 것.
const CACHE = 'animal-sticker-v1';
const CDN_CACHE = 'animal-sticker-cdn-v1'; // 인식/배경제거 모델은 수십 MB 라 한 번 받으면 계속 재사용
const CDN_HOSTS = [
  'cdn.jsdelivr.net',      // 라이브러리 번들
  'staticimgly.com',       // 배경 제거(isnet) 모델
  'tfhub.dev', 'storage.googleapis.com', 'www.kaggle.com' // MobileNet 가중치
];
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
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== CDN_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // 모델 파일은 캐시 우선. 두 번째 방문부터는 내려받기를 아예 건너뛴다.
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CDN_CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
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

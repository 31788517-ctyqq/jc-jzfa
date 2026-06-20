// Service Worker — 仅缓存静态资源（JS/CSS），页面壳直通网络
// v7: 开发模式检测 — localhost 时完全跳过缓存
const CACHE_NAME = 'jczjfa-static-v12';
const STATIC_EXTENSIONS = /\.(js|css|svg|png|webp|woff2?)$/i;
const IS_DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

// 开发模式：立即注销 SW
if (IS_DEV) {
  self.addEventListener('install', function (e) {
    self.skipWaiting();
  });
  self.addEventListener('activate', function (e) {
    e.waitUntil(
      caches
        .keys()
        .then(function (keys) {
          return Promise.all(
            keys.map(function (k) {
              return caches.delete(k);
            }),
          );
        })
        .then(function () {
          return self.clients.claim();
        }),
    );
  });
  // 开发模式完全不拦截请求
} else {
  // ★ 生产模式：仅缓存静态资源
  self.addEventListener('install', function (e) {
    self.skipWaiting();
  });

  self.addEventListener('activate', function (e) {
    e.waitUntil(
      caches
        .keys()
        .then(function (keys) {
          return Promise.all(
            keys.map(function (k) {
              return caches.delete(k);
            }),
          );
        })
        .then(function () {
          return self.clients.claim();
        }),
    );
  });

  self.addEventListener('fetch', function (e) {
    const url = new URL(e.request.url);
    if (url.origin === self.location.origin && STATIC_EXTENSIONS.test(url.pathname)) {
      e.respondWith(
        caches.open(CACHE_NAME).then(function (cache) {
          return cache.match(e.request).then(function (cached) {
            const network = fetch(e.request).then(function (res) {
              if (res && res.status === 200) cache.put(e.request, res.clone());
              return res;
            });
            return cached || network;
          });
        }),
      );
    }
  });
}

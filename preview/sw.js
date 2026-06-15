// Service Worker — 仅缓存静态资源（JS/CSS），页面壳直通网络
// v6: 移除页面壳缓存（防止 SW 返回旧版 HTML）
var CACHE_NAME = 'jczjfa-static-v6';
var STATIC_EXTENSIONS = /\.(js|css|svg|png|webp|woff2?)$/i;

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  // 仅缓存静态资源
  if (url.origin === self.location.origin && STATIC_EXTENSIONS.test(url.pathname)) {
    e.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(e.request).then(function (cached) {
          var network = fetch(e.request).then(function (res) {
            if (res && res.status === 200) cache.put(e.request, res.clone());
            return res;
          });
          return cached || network;
        });
      })
    );
  }
  // HTML/API 直通网络
});

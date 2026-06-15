// P2-4→P1-2→Phase2: Service Worker — Vite 构建后静态资源离线缓存
// 策略：Stale-While-Revalidate for JS/CSS（内容哈希自动版本控制）
// ★ Phase2: 配合 Vite content-hash，旧缓存自然淘汰
// 注册方式：index.html 中 navigator.serviceWorker.register('/sw.js')

var CACHE_NAME = 'jczjfa-static-v4';
var STATIC_EXTENSIONS = /\.(js|css|svg|png|webp|woff2?)$/i;
var PAGE_SHELL_KEY = '/index.html';

self.addEventListener('install', function (e) {
  // 预缓存页面壳
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.add(PAGE_SHELL_KEY).catch(function () {});
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return k !== CACHE_NAME;
            })
            .map(function (k) {
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
  var url = new URL(e.request.url);

  // ★ Phase2: JS/CSS 静态资源 → Stale-While-Revalidate
  // 内容哈希文件名确保每次构建产生不同 URL，自然淘汰旧缓存
  if (url.origin === self.location.origin && STATIC_EXTENSIONS.test(url.pathname)) {
    e.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(e.request).then(function (cached) {
          var network = fetch(e.request).then(function (res) {
            if (res && res.status === 200) {
              cache.put(e.request, res.clone());
            }
            return res;
          });
          return cached || network;
        });
      }),
    );
  }
  // API 请求直通网络
});

// P2-4→P1-2: Service Worker — 静态资源 + 页面壳离线缓存
// 策略：Cache-First for JS/CSS/页面壳（版本号控制更新）
// 注册方式：index.html 中 navigator.serviceWorker.register()

var CACHE_NAME = 'jczjfa-static-v2';
var STATIC_EXTENSIONS = /\.(js|css|svg|png|webp|woff2?)$/i;
// P1-2: 页面壳缓存（HTML 首页壳，不含动态内容）
var PAGE_SHELL_KEY = '/preview/index.html';

self.addEventListener('install', function (e) {
  // P1-2: 预缓存页面壳
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

  // P1-2: 页面壳 — Stale-While-Revalidate（即时显示壳，后台更新）
  if (url.pathname === '/' || url.pathname.endsWith('/index.html') || url.pathname === '/index.html') {
    e.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(e.request).then(function (cached) {
          var network = fetch(e.request).then(function (res) {
            if (res && res.status === 200) {
              cache.put(e.request, res.clone());
            }
            return res;
          }).catch(function () {
            return cached;
          });
          // 优先返回缓存（壳），后台网络更新
          return cached || network;
        });
      }),
    );
    return;
  }

  // 静态资源缓存
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
  // API 请求不缓存，直通网络
});

// P2-4: Service Worker — 静态资源离线缓存
// 策略：Cache-First for JS/CSS（版本号 v= 控制更新）
// 注册方式：index.html 中 navigator.serviceWorker.register()

var CACHE_NAME = 'jczjfa-static-v1';
var STATIC_EXTENSIONS = /\.(js|css|svg|png|webp|woff2?)$/i;

self.addEventListener('install', function (e) {
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

  // 只缓存同源静态资源
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
          // Cache-First：优先返回缓存，同时后台更新
          return cached || network;
        });
      }),
    );
  }
  // API 请求不缓存，直通网络
});

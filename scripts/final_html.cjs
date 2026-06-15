// Build clean index.html from Phase1 base + needed features
var fs = require('fs');
var html = fs.readFileSync('preview/index_clean.html', 'utf8');

// 1. Clean version stamps
html = html.replace(/\?v=\d{10,12}/g, '');

// 2. Add vendor.js modulepreload (after dns-prefetch)
html = html.replace(
  '<link rel="dns-prefetch" href="https://midou310.com" />',
  '<link rel="dns-prefetch" href="https://midou310.com" />\n    <!-- Phase1: vendor chunk -->\n    <link rel="modulepreload" href="/js/vendor.js" />'
);

// 3. Fix admin-v2.css
html = html.replace(
  /<link rel="stylesheet" href="\/css\/admin-v2\.css[^"]*"[^>]*\/>/g,
  '<link rel="stylesheet" href="/dist/css/admin-v2.css" />'
);

// 4. Remove inline module
html = html.replace(/<script type="module">[\s\S]*?<\/script>/g, '');

// 5. Add navMyBtn before navBack
html = html.replace(
  '<span class="nav-back" id="navBack"',
  '<button class="nav-my-btn" id="navMyBtn" type="button" onclick="switchTab(\'profile\')" style="display:none"><span>我的</span></button><span class="nav-back" id="navBack"'
);

// 6. Add bridge scripts before </body>
html = html.replace('</body>',
  '<script>window._stQ=[];window.switchTab=function(t){if(window._stReal)window._stReal(t);else window._stQ.push(t)};window.goBack=function(){if(window._gbReal)window._gbReal();else window._stQ.push("__goBack__")};window.App=window.App||{};window.App.showNotifications=window.App.showNotifications||function(){};window.App.closeNotifications=window.App.closeNotifications||function(){};window.App.markAllRead=window.App.markAllRead||function(){};window.App.consumeNoti=window.App.consumeNoti||function(){};</script>\n<script type="module" src="/js/main-fusion.js"></script>\n</body>'
);

// Verify
console.log('dist entry:', html.includes('/dist/js/index'));
console.log('main-fusion:', html.includes('main-fusion.js'));
console.log('navMyBtn:', html.includes('navMyBtn'));
console.log('bridge:', html.includes('_stQ'));
console.log('vendor:', html.includes('vendor.js'));
console.log('admin-v2:', html.includes('admin-v2.css'));
console.log('size:', html.length);

// Save as preview/index.html and root index.html
fs.writeFileSync('preview/index.html', html, 'utf8');
fs.writeFileSync('index.html', html, 'utf8');
console.log('Saved preview/index.html and index.html');

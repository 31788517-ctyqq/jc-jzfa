// Final patch: read clean HTML, add missing features, save
var fs = require('fs');
var html = fs.readFileSync('preview/index_clean.html', 'utf8');

// Remove BOM
html = html.replace(/^\uFEFF/, '');

// Clean version stamps
html = html.replace(/\?v=\d{10,12}/g, '');

// Add navMyBtn before navBack
html = html.replace(
  '<span class="nav-back"',
  '<button class="nav-my-btn" id="navMyBtn" type="button" onclick="switchTab(\'profile\')" style="display:none"><span>我的</span></button><span class="nav-back"'
);

// Remove inline module
html = html.replace(/<script type="module">[\s\S]*?<\/script>/g, '');

// Add bridge scripts (only if not present)
if (!html.includes('window._stQ')) {
  html = html.replace('</body>',
    '<script>window._stQ=[];window.switchTab=function(t){if(window._stReal)window._stReal(t);else window._stQ.push(t)};window.goBack=function(){if(window._gbReal)window._gbReal();else window._stQ.push("__goBack__")};window.App=window.App||{};window.App.showNotifications=window.App.showNotifications||function(){};window.App.closeNotifications=window.App.closeNotifications||function(){};window.App.markAllRead=window.App.markAllRead||function(){};window.App.consumeNoti=window.App.consumeNoti||function(){};</script>\n</body>'
  );
}

// Ensure main-fusion.js module script exists
if (!html.includes('<script type="module" src="/js/main-fusion.js">')) {
  html = html.replace('</body>', '<script type="module" src="/js/main-fusion.js"></script>\n</body>');
}

// Fix admin-v2.css path
html = html.replace(/\/css\/admin-v2\.css[^"]*/g, '/dist/css/admin-v2.css');

// Verify no dist/js/index paths
var bad = html.includes('/dist/js/index');
console.log('Vite dist entry:', bad);
console.log('navMyBtn:', html.includes('navMyBtn'));
console.log('bridge:', html.includes('_stQ'));
console.log('main-fusion:', html.includes('main-fusion.js'));
console.log('vendor:', html.includes('vendor.js'));
console.log('admin-v2:', html.includes('/dist/css/admin-v2.css'));
console.log('inline:', html.includes('INLINE-MODULE'));

// Save
fs.writeFileSync('preview/index.html', html, 'utf8');
fs.writeFileSync('index.html', html, 'utf8');

if (bad) {
  console.log('ERROR: Vite dist entry found!');
  process.exit(1);
}

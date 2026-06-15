// Restore features lost in Phase2 rollback
var fs = require('fs');

// ============ 1. Fix index.html ============
var html = fs.readFileSync('preview/index.html', 'utf8');

// 1a. Clean version stamps
html = html.replace(/\?v=\d{10,12}/g, '');

// 1b. Add vendor.js modulepreload (after dns-prefetch line)
html = html.replace(
  '<link rel="dns-prefetch" href="https://midou310.com" />',
  '<link rel="dns-prefetch" href="https://midou310.com" />\n    <!-- Phase1: vendor chunk preload -->\n    <link rel="modulepreload" href="/js/vendor.js" />'
);

// 1c. Replace /css/admin-v2.css?v=... with publicDir version
html = html.replace(/<link rel="stylesheet" href="\/css\/admin-v2\.css[^"]*"[^>]*\/>/g,
  '<link rel="stylesheet" href="/dist/css/admin-v2.css" />');

// 1d. Remove inline module script
html = html.replace(/<script type="module">[\s\S]*?<\/script>/g, '');

// 1e. Add navMyBtn button before navBack
html = html.replace(
  '<span class="nav-back" id="navBack"',
  '<button class="nav-my-btn" id="navMyBtn" type="button" onclick="switchTab(\'profile\')" style="display:none"><span>我的</span></button><span class="nav-back" id="navBack"'
);

// 1f. Add bridge scripts + main-fusion module before </body>
html = html.replace(
  '</body>',
  '<script>window._stQ=[];window.switchTab=function(t){if(window._stReal)window._stReal(t);else window._stQ.push(t)};window.goBack=function(){if(window._gbReal)window._gbReal();else window._stQ.push("__goBack__")};window.App=window.App||{};window.App.showNotifications=window.App.showNotifications||function(){};window.App.closeNotifications=window.App.closeNotifications||function(){};window.App.markAllRead=window.App.markAllRead||function(){};window.App.consumeNoti=window.App.consumeNoti||function(){};</script>\n<script type="module" src="/js/main-fusion.js"></script>\n</body>'
);

fs.writeFileSync('preview/index.html', html, 'utf8');
console.log('index.html: navMyBtn=' + html.includes('navMyBtn') + ' bridge=' + html.includes('_stQ') + ' vendor=' + html.includes('vendor.js'));

// ============ 2. Fix main-fusion.js ============
var mf = fs.readFileSync('preview/js/main-fusion.js', 'utf8');

// 2a. Clean version stamps
mf = mf.replace(/\?v=\d{10,12}/g, '');

// 2b. Add navMyBtn logic in switchTab function (after navBack display logic)
var navBackLogic = "backEl.style.display =\n      tab !== 'home' &&\n      tab !== 'login' &&\n      tab !== 'register' &&\n      tab !== 'contact-invite' &&\n      tab !== 'account-security' &&\n      tab !== 'profile' &&\n      tab !== 'pricing' &&\n      tab !== 'payment-result'\n        ? 'flex'\n        : 'none';\n\n  var navbarEl";
mf = mf.replace(navBackLogic, navBackLogic + "\n\n  // navMyBtn (green)\n  var navMyBtn = document.getElementById('navMyBtn');\n  if (navMyBtn) {\n    var showMy = tab === 'match' || tab === 'plan' || tab === 'rank' || tab === 'hit';\n    navMyBtn.style.display = showMy ? 'flex' : 'none';\n  }\n");

// 2c. Same for switchTabLoad
navBackLogic = "backEl.style.display =\n      tab !== 'home' &&\n      tab !== 'login' &&\n      tab !== 'register' &&\n      tab !== 'contact-invite' &&\n      tab !== 'account-security' &&\n      tab !== 'profile' &&\n      tab !== 'pricing' &&\n      tab !== 'payment-result'\n        ? 'flex'\n        : 'none';\n\n  var navbarEl";
mf = mf.replace(navBackLogic, navBackLogic + "\n\n  // navMyBtn (green)\n  var navMyBtn = document.getElementById('navMyBtn');\n  if (navMyBtn) {\n    var showMy = tab === 'match' || tab === 'plan' || tab === 'rank' || tab === 'hit';\n    navMyBtn.style.display = showMy ? 'flex' : 'none';\n  }\n");

// 2d. Add Phase3 prefetch after switchTab function's home block
var homeBlock = "if (tab === 'home') {\n    setTimeout(function () {\n      var today = formatDate(new Date());\n      api('plan-list', { date: today }).catch(function () {});\n      api('hit-rate-stats', {}).catch(function () {});\n    }, 1200);\n  }\n}";
var prefetchFn = "\nfunction _prefetchTabData(tab) {\n  var today = formatDate(new Date());\n  if (tab === 'plan') { var pd = state.planDate || today; api('plan-list', { date: pd }).catch(function () {}); }\n  else if (tab === 'match') { var sel = state.weekDates[state.selectedWeekIdx]; if (sel && sel.matchDate) api('match-list', { date: sel.matchDate }).catch(function () {}); }\n  else if (tab === 'rank') { api('ranking-list', { date: state.rankDate || today }).catch(function () {}); }\n  else if (tab === 'hit') { api('hit-rate-stats', {}).catch(function () {}); }\n  else if (tab === 'quant-rank') { api('quant-rank', {}).catch(function () {}); }\n  else if (tab === 'income') { api('plan-income', {}).catch(function () {}); }\n  else if (tab === 'filter') { api('filter-leagues', {}).catch(function () {}); }\n  else if (tab === 'backtest') { api('prediction-backtest', {}).catch(function () {}); }\n}";
mf = mf.replace(homeBlock, homeBlock + "\n\n  // Phase3: pre-fetch API data in parallel with module loading\n  _prefetchTabData(tab);\n" + prefetchFn);

// 2e. Add window._stReal/_gbReal and queue replay at the end (before initPage? actually at the very end)
var windowAssign = "window.switchTab = switchTab;\nwindow.goBack = goBack;";
mf = mf.replace(windowAssign, "window.switchTab = switchTab;\nwindow.goBack = goBack;\nwindow._stReal = switchTab;\nwindow._gbReal = goBack;\nif (window._stQ && window._stQ.length) { var q = window._stQ; window._stQ = []; q.forEach(function(t) { if (t === '__goBack__') goBack(); else switchTab(t); }); }");

fs.writeFileSync('preview/js/main-fusion.js', mf, 'utf8');
console.log('main-fusion: navMyBtn=' + mf.includes('navMyBtn') + ' Phase3=' + mf.includes('_prefetchTabData') + ' replay=' + mf.includes('_stReal'));

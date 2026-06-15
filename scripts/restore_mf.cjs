// Restore main-fusion.js features
var fs = require('fs');
var mf = fs.readFileSync('preview/js/main-fusion.js', 'utf8');

// Normalize line endings for consistent matching
var original = mf;
mf = mf.replace(/\r\n/g, '\n');

// 1. Clean version stamps
mf = mf.replace(/\?v=\d{10,12}/g, '');

// 2. Add navMyBtn to switchTab (first occurrence after "none';")
// Find the pattern right before "var navbarEl"
var pattern1 = "      tab !== 'payment-result'\n        ? 'flex'\n        : 'none';\n\n  var navbarEl";
var repl1 = "      tab !== 'payment-result'\n        ? 'flex'\n        : 'none';\n\n  // navMyBtn (green)\n  var nmb1 = document.getElementById('navMyBtn');\n  if (nmb1) {\n    var sm1 = tab === 'match' || tab === 'plan' || tab === 'rank' || tab === 'hit';\n    nmb1.style.display = sm1 ? 'flex' : 'none';\n  }\n\n  var navbarEl";

if (mf.includes(pattern1)) {
  var count = (mf.match(new RegExp(pattern1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  console.log('pattern1 found', count, 'times');
  
  // Replace first occurrence
  mf = mf.replace(pattern1, repl1);
  
  // Replace second occurrence (switchTabLoad)
  mf = mf.replace(pattern1, repl1);
  
  console.log('navMyBtn JS added:', mf.includes('navMyBtn'));
} else {
  console.log('pattern1 NOT FOUND - checking context around "none"');
  var idx = mf.indexOf("tab !== 'payment-result'");
  if (idx >= 0) {
    console.log('FOUND at', idx, mf.substring(idx, idx+100));
  }
}

// 3. Add Phase3 prefetch after switchTab's home block
var homeBlock = "if (tab === 'home') {\n    setTimeout(function () {\n      var today = formatDate(new Date());\n      api('plan-list', { date: today }).catch(function () {});\n      api('hit-rate-stats', {}).catch(function () {});\n    }, 1200);\n  }\n}";
var prefetchFn = "\n\nfunction _prefetchTabData(tab) {\n  var today = formatDate(new Date());\n  if (tab === 'plan') { var pd = state.planDate || today; api('plan-list', { date: pd }).catch(function () {}); }\n  else if (tab === 'match') { var sel = state.weekDates[state.selectedWeekIdx]; if (sel && sel.matchDate) api('match-list', { date: sel.matchDate }).catch(function () {}); }\n  else if (tab === 'rank') { api('ranking-list', { date: state.rankDate || today }).catch(function () {}); }\n  else if (tab === 'hit') { api('hit-rate-stats', {}).catch(function () {}); }\n  else if (tab === 'quant-rank') { api('quant-rank', {}).catch(function () {}); }\n  else if (tab === 'income') { api('plan-income', {}).catch(function () {}); }\n  else if (tab === 'filter') { api('filter-leagues', {}).catch(function () {}); }\n  else if (tab === 'backtest') { api('prediction-backtest', {}).catch(function () {}); }\n}";
mf = mf.replace(homeBlock, homeBlock + "\n\n  // Phase3: pre-fetch API data\n  _prefetchTabData(tab);\n" + prefetchFn);

// 4. Add bridge queue replay
var windowAssign = "window.switchTab = switchTab;\nwindow.goBack = goBack;";
mf = mf.replace(windowAssign, "window.switchTab = switchTab;\nwindow.goBack = goBack;\nwindow._stReal = switchTab;\nwindow._gbReal = goBack;\nif (window._stQ && window._stQ.length) { var q = window._stQ; window._stQ = []; q.forEach(function(t) { if (t === '__goBack__') goBack(); else switchTab(t); }); }");

// Restore line endings
mf = mf.replace(/\n/g, '\r\n');

fs.writeFileSync('preview/js/main-fusion.js', mf, 'utf8');
console.log('navMyBtn JS:', mf.includes('navMyBtn'));
console.log('Phase3:', mf.includes('_prefetchTabData'));
console.log('replay:', mf.includes('_stReal'));

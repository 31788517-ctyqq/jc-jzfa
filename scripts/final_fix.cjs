// Final fix: apply missing features to clean Phase3 baseline
var fs = require('fs');

// ===== 1. Fix index.html =====
var html = fs.readFileSync('preview/index.html', 'utf8');

// 1a. Clean version stamps
html = html.replace(/\?v=\d{10,12}/g, '');

// 1b. Add navMyBtn button before navBack
html = html.replace(
  '<span class="nav-back" id="navBack"',
  '<button class="nav-my-btn" id="navMyBtn" type="button" onclick="switchTab(\'profile\')" style="display:none"><span>我的</span></button><span class="nav-back" id="navBack"'
);

// 1c. Add bridge scripts before </body> (only if not present)
if (!html.includes('window._stQ')) {
  html = html.replace('</body>',
    '<script>window._stQ=[];window.switchTab=function(t){if(window._stReal)window._stReal(t);else window._stQ.push(t)};window.goBack=function(){if(window._gbReal)window._gbReal();else window._stQ.push("__goBack__")};window.App=window.App||{};window.App.showNotifications=window.App.showNotifications||function(){};window.App.closeNotifications=window.App.closeNotifications||function(){};window.App.markAllRead=window.App.markAllRead||function(){};window.App.consumeNoti=window.App.consumeNoti||function(){};</script>\n</body>'
  );
}

// 1d. Remove inline module (if present)
html = html.replace(/<script type="module">[\s\S]*?<\/script>/g, '');

// 1e. Fix admin-v2.css path
html = html.replace(/<link rel="stylesheet" href="\/css\/admin-v2\.css[^"]*"[^>]*\/>/g,
  '<link rel="stylesheet" href="/dist/css/admin-v2.css" />');

fs.writeFileSync('preview/index.html', html, 'utf8');
console.log('index.html: navMyBtn=' + html.includes('navMyBtn') + ' bridge=' + html.includes('_stQ') + ' vendor=' + html.includes('vendor.js'));

// ===== 2. Fix main-fusion.js =====
var mf = fs.readFileSync('preview/js/main-fusion.js', 'utf8');

// 2a. Clean version stamps
mf = mf.replace(/\?v=\d{10,12}/g, '');

// 2b. Add navMyBtn to switchTab: find "none';\n\n  var navbarEl" 
// This pattern appears in switchTab
var p1 = "\n        ? 'flex'\n        : 'none';\n\n  var navbarEl";
var r1 = "\n        ? 'flex'\n        : 'none';\n\n  // ★ navMyBtn\n  var nmb = document.getElementById('navMyBtn');\n  if (nmb) {\n    var sm = tab === 'match' || tab === 'plan' || tab === 'rank' || tab === 'hit';\n    nmb.style.display = sm ? 'flex' : 'none';\n  }\n\n  var navbarEl";

// Check pattern exists
var p1Count = (mf.match(/\? 'flex'\s*:\s*'none';\s*\n\s*\n\s*var navbarEl/g) || []).length;
console.log('pattern1 occurrences:', p1Count);

if (mf.includes(p1)) {
  // Replace first occurrence (switchTab)
  mf = mf.replace(p1, r1);
  // Replace second occurrence (switchTabLoad) - only if it still exists
  if (mf.includes(p1)) {
    mf = mf.replace(p1, r1);
  }
  console.log('navMyBtn JS added');
} else {
  console.log('pattern1 NOT found, trying alternative patterns');
  // Try with different whitespace
  var alt = '\n        ? \'flex\'\n        : \'none\';\n\n  var navbarEl';
  if (mf.includes(alt)) {
    var altR = '\n        ? \'flex\'\n        : \'none\';\n\n  // navMyBtn\n  var nmb = document.getElementById(\'navMyBtn\');\n  if (nmb) {\n    var sm = tab === \'match\' || tab === \'plan\' || tab === \'rank\' || tab === \'hit\';\n    nmb.style.display = sm ? \'flex\' : \'none\';\n  }\n\n  var navbarEl';
    mf = mf.replace(alt, altR);
    if (mf.includes(alt)) mf = mf.replace(alt, altR);
    console.log('navMyBtn JS added (alt)');
  } else {
    console.log('FAIL: cannot find navBack pattern');
  }
}

// 2c. Add _stReal bridge replay
var wsa = "window.switchTab = switchTab;\nwindow.goBack = goBack;\n";
if (mf.includes(wsa) && !mf.includes('window._stReal')) {
  mf = mf.replace(wsa, "window.switchTab = switchTab;\nwindow.goBack = goBack;\nwindow._stReal = switchTab;\nwindow._gbReal = goBack;\nif (window._stQ && window._stQ.length) { var _q = window._stQ; window._stQ = []; _q.forEach(function(_t) { if (_t === '__goBack__') goBack(); else switchTab(_t); }); }\n");
  console.log('bridge replay added');
}

fs.writeFileSync('preview/js/main-fusion.js', mf, 'utf8');
console.log('main-fusion: navMyBtn=' + mf.includes('navMyBtn') + ' Phase3=' + mf.includes('_prefetchTabData') + ' replay=' + mf.includes('_stReal'));

// ===== 3. Syntax check =====
var cp = require('child_process');
var r = cp.spawnSync('node', ['-c', 'preview/js/main-fusion.js'], {encoding: 'utf8'});
if (r.stderr) {
  console.log('SYNTAX CHECK FAILED:');
  console.log(r.stderr.substring(0, 500));
} else {
  console.log('SYNTAX CHECK: OK');
}

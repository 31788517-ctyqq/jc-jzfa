// Precise fix using actual file patterns
var fs = require('fs');
var mf = fs.readFileSync('preview/js/main-fusion.js', 'utf8');

// Clean version stamps
mf = mf.replace(/\?v=\d{10,12}/g, '');

// Pattern for navBack display logic (before var navbarEl)
// Actual: "? 'flex'\r\n        : 'none';\r\n\r\n  var navbarEl"
var pattern = "? 'flex'\r\n        : 'none';\r\n\r\n  var navbarEl";

if (!mf.includes(pattern)) {
  console.log('ERROR: pattern not found');
  process.exit(1);
}

var replacement = "? 'flex'\r\n        : 'none';\r\n\r\n  // navMyBtn (green)\r\n  var nmb = document.getElementById('navMyBtn');\r\n  if (nmb) {\r\n    var sm = tab === 'match' || tab === 'plan' || tab === 'rank' || tab === 'hit';\r\n    nmb.style.display = sm ? 'flex' : 'none';\r\n  }\r\n\r\n  var navbarEl";

// Replace first occurrence (switchTab)
mf = mf.replace(pattern, replacement);

// Find and replace second occurrence (switchTabLoad)
// After first replace, the pattern should still exist once more
if (!mf.includes(pattern)) {
  console.log('ERROR: second pattern not found after first replace');
  process.exit(1);
}
mf = mf.replace(pattern, replacement);

console.log('navMyBtn JS added');

// Add _stReal bridge replay
var wsa = "window.switchTab = switchTab;\r\nwindow.goBack = goBack;\r\n";
if (mf.includes(wsa) && !mf.includes('_stReal')) {
  var replayCode = "window.switchTab = switchTab;\r\nwindow.goBack = goBack;\r\nwindow._stReal = switchTab;\r\nwindow._gbReal = goBack;\r\nif (window._stQ && window._stQ.length) { var _q = window._stQ; window._stQ = []; _q.forEach(function(_t) { if (_t === '__goBack__') goBack(); else switchTab(_t); }); }\r\n";
  mf = mf.replace(wsa, replayCode);
  console.log('bridge replay added');
}

fs.writeFileSync('preview/js/main-fusion.js', mf, 'utf8');

// Syntax check
var cp = require('child_process');
var r = cp.spawnSync('node', ['-c', 'preview/js/main-fusion.js'], {encoding: 'utf8'});
if (r.stderr) {
  console.log('SYNTAX ERROR:', r.stderr.substring(0, 300));
} else {
  console.log('SYNTAX OK');
}

// Verify
console.log('navMyBtn:', mf.includes('navMyBtn'));
console.log('replay:', mf.includes('_stReal'));
console.log('Phase3:', mf.includes('_prefetchTabData'));

// Final verification before deploy
var fs = require('fs'), cp = require('child_process');

function ok(tag, pass) { console.log((pass ? '  PASS' : '  FAIL') + ' [' + tag + ']'); return pass; }

var all = true;

// 1. main-fusion.js syntax
try { cp.execSync('node -c preview/js/main-fusion.js', {encoding:'utf8'}); all = ok('syntax', true) && all; }
catch(e) { all = ok('syntax', false) && all; console.log(e.message.substring(0,200)); }

// 2. main-fusion.js features
var mf = fs.readFileSync('preview/js/main-fusion.js', 'utf8');
all = ok('navMyBtn JS', mf.includes('navMyBtn')) && all;
all = ok('Phase3', mf.includes('_prefetchTabData')) && all;
all = ok('_stReal replay', mf.includes('_stReal')) && all;

// 3. index.html
var html = fs.readFileSync('preview/index.html', 'utf8');
all = ok('no /dist/js/index', !html.includes('/dist/js/index')) && all;
all = ok('navMyBtn HTML', html.includes('navMyBtn')) && all;
all = ok('bridge script', html.includes('_stQ')) && all;
all = ok('main-fusion.js ref', html.includes('main-fusion.js')) && all;

// 4. sw.js
var sw = fs.readFileSync('preview/sw.js', 'utf8');
all = ok('SW v6', sw.includes('v6')) && all;
all = ok('no PAGE_SHELL', !sw.includes('PAGE_SHELL')) && all;

console.log('\n' + (all ? 'ALL PASSED - ready to deploy' : 'SOME FAILED - fix before deploy'));
process.exit(all ? 0 : 1);

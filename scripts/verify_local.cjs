// verify_local.cjs — HTTP 层验证本地服务器
var http = require('http');

function get(path, label) {
  return new Promise(function(resolve) {
    var opts = { hostname: 'localhost', port: 3000, path: path, headers: { 'Cache-Control': 'no-cache' } };
    http.get(opts, function(res) {
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('end', function() {
        var ok = res.statusCode === 200;
        console.log((ok ? '  PASS' : '  FAIL') + ' [' + label + '] status=' + res.statusCode + ' len=' + body.length);
        resolve({ ok: ok, body: body });
      });
    }).on('error', function(e) {
      console.log('  FAIL [' + label + '] ' + e.message);
      resolve({ ok: false, error: e.message });
    });
  });
}

async function main() {
  var allPass = true;
  
  // 1. 首页 HTML
  var home = await get('/', 'index.html');
  if (home.body) {
    var hasDist = home.body.includes('/dist/');
    var hasAdminV2 = home.body.includes('admin-v2.css');
    var correctPath = home.body.includes('/css/admin-v2.css');
    var wrongPath = home.body.includes('/dist/css/admin-v2.css');
    console.log('  INFO: has /dist/=' + hasDist + ' admin-v2=' + hasAdminV2 + ' /css/admin-v2=' + correctPath + ' /dist/css/admin-v2=' + wrongPath);
    if (wrongPath || hasDist) { allPass = false; console.log('  FAIL [/dist/ still in served HTML]'); }
  } else { allPass = false; }
  
  // 2. admin-v2.css
  var css = await get('/css/admin-v2.css', '/css/admin-v2.css');
  if (!css.ok) allPass = false;
  
  // 3. main-fusion.js
  var mf = await get('/js/main-fusion.js', '/js/main-fusion.js');
  if (!mf.ok) allPass = false;
  
  // 4. vendor.js
  var v = await get('/js/vendor.js', '/js/vendor.js');
  if (!v.ok) allPass = false;

  // 5. app.css
  var app = await get('/css/app.css', '/css/app.css');
  if (!app.ok) allPass = false;

  console.log('\n' + (allPass ? 'ALL PASSED' : 'SOME FAILED'));
  process.exit(allPass ? 0 : 1);
}

main();

// scripts/check-deploy-files.cjs
// ★ 部署前验证 deploy.py 中所有文件是否本地存在
// deploy.py 是 UTF-16 LE 编码（Windows Python 默认）

var fs = require('fs');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');

var deployPy = fs.readFileSync(path.join(ROOT, 'deploy.py'), 'utf16le');
var lines = deployPy.split(/\r?\n/);
var files = [];
var inMap = false;

lines.forEach(function(l) {
  var t = l.trim();
  if (t.startsWith('DEPLOY_MAP')) { inMap = true; return; }
  if (!inMap) return;
  if (t === ']') { inMap = false; return; }
  if (t.indexOf('#') === 0 || t === '') return;
  
  var m = l.match(/\('([^']+)'\s*,\s*'(nginx|pm2|both)'\)/);
  if (m) files.push(m[1]);
});

console.log('部署清单条目: ' + files.length + ' 个\n');

var missing = [];
var ok = 0;

files.forEach(function(f) {
  var fp = path.join(ROOT, f);
  if (fs.existsSync(fp)) {
    ok++;
  } else {
    missing.push(f);
  }
});

console.log('本地存在: ' + ok + ' / ' + files.length);

if (missing.length > 0) {
  console.log('\n缺失 ' + missing.length + ' 个:');
  missing.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}

console.log('✅ 全部文件存在\n');

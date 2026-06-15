// audit_dist_refs.cjs — 扫描所有前端文件中残留的 /dist/ 引用
var fs = require('fs'), path = require('path');

var files = [
  'preview/index.html',
  'index.html',
  'preview/sw.js',
  'preview/js/main-fusion.js',
  'preview/css/app.css',
  'preview/adm.html'
];

var totalIssues = 0;
files.forEach(function(f) {
  if (!fs.existsSync(f)) { console.log('SKIP ' + f); return; }
  var c = fs.readFileSync(f, 'utf8');
  
  // 查找 /dist/ 引用 (非注释)
  var lines = c.split(/\r?\n/);
  var issues = 0;
  lines.forEach(function(line, i) {
    if (line.match(/\/dist\//) && !line.trim().match(/^\s*\/\//) && !line.trim().match(/^\s*\*/)) {
      var clean = line.trim().substring(0, 120);
      console.log('  [' + f + ':' + (i+1) + '] ' + clean);
      issues++;
    }
  });
  
  // 查找 admin-v2.css 引用
  var adminV2 = c.match(/admin-v2\.css[^'")]*/gi);
  if (adminV2) {
    adminV2.forEach(function(m) {
      console.log('  [ADMIN-CSS] ' + f + ': ' + m);
      issues++;
    });
  }
  
  if (issues === 0) console.log('OK  ' + f);
  else totalIssues += issues;
});

console.log('\n=== Total issues: ' + totalIssues + ' ===');
process.exit(totalIssues > 0 ? 1 : 0);

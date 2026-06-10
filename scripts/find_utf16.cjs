// 查找项目中所有 UTF-16LE 编码文件
const fs = require('fs');
const path = require('path');

function walk(dir, exts) {
  var r = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
    var p = path.join(dir, d.name);
    if (d.isDirectory() && d.name !== 'node_modules' && d.name !== '.git') {
      r = r.concat(walk(p, exts));
    } else if (exts.some(function (e) { return d.name.endsWith(e); })) {
      r.push(p);
    }
  });
  return r;
}

var files = walk('.', ['.js', '.css', '.json']);
var utf16 = [];

files.forEach(function (f) {
  try {
    var buf = fs.readFileSync(f);
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
      utf16.push(f);
    }
  } catch (e) { /* skip */ }
});

console.log('UTF-16LE files found: ' + utf16.length);
utf16.forEach(function (f) { console.log('  ' + f); });

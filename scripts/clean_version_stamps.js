// 批量移除 preview/ 下所有 JS/HTML 的 ?v= 版本戳
var fs = require('fs');
var path = require('path');

function walk(dir, exts) {
  var files = [];
  var items = fs.readdirSync(dir);
  items.forEach(function(name) {
    var full = path.join(dir, name);
    var st = fs.statSync(full);
    if (st.isDirectory() && name !== 'dist' && name !== 'node_modules' && name !== 'public') {
      files = files.concat(walk(full, exts));
    } else if (st.isFile() && exts.some(function(e) { return full.endsWith(e); })) {
      files.push(full);
    }
  });
  return files;
}

var files = walk('./preview', ['.js', '.html']);
var re = /\?v=\d{10,12}/g;
var count = 0;
files.forEach(function(f) {
  var c = fs.readFileSync(f, 'utf8');
  var n = c.replace(re, '');
  if (n !== c) {
    fs.writeFileSync(f, n, 'utf8');
    count++;
    console.log('cleaned: ' + f);
  }
});
console.log('total: ' + count + ' files cleaned');

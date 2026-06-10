// 将 UTF-16LE 文件转换为 UTF-8
const fs = require('fs');

var files = process.argv.slice(2);
if (files.length === 0) {
  console.log('Usage: node scripts/convert_utf8.cjs <file1> <file2> ...');
  process.exit(1);
}

files.forEach(function (f) {
  var buf = fs.readFileSync(f);
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    var utf8 = buf.toString('utf16le');
    fs.writeFileSync(f, utf8, 'utf8');
    console.log('Converted: ' + f);
  } else {
    console.log('Already UTF-8: ' + f);
  }
});

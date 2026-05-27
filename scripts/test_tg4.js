var h = require('https');
var iconv = require('iconv-lite');

h.get('https://trade.500.com/jczq/?playid=312&g=2&date=2026-05-24', {
  headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9' },
  rejectUnauthorized: false, timeout: 15000,
}, function(res) {
  var chunks = [];
  res.on('data', function(c) { chunks.push(c); });
  res.on('end', function() {
    var buf = Buffer.concat(chunks);
    var html = iconv.decode(buf, 'gbk');
    
    // Check for "总进球" with different encodings
    var t1 = '总进球';
    var t2 = '\u603b\u8fdb\u7403';
    
    console.log('t1 === t2:', t1 === t2);
    console.log('indexOf("总进球"):', html.indexOf('总进球'));
    console.log('indexOf("\\u603b\\u8fdb\\u7403"):', html.indexOf('\u603b\u8fdb\u7403'));
    
    // Check raw bytes around position where "总进球" should be
    // Search for "进" character which is unique
    var jinIdx = html.indexOf('进');
    console.log('jinIdx:', jinIdx);
    if (jinIdx > 0) {
      var ctx = html.substring(jinIdx - 10, jinIdx + 20);
      console.log('Context around "进": [' + ctx + ']');
      
      // Also print char codes
      for (var i = 0; i < ctx.length; i++) {
        console.log('  [' + i + '] ' + ctx[i] + ' (' + ctx.charCodeAt(i).toString(16) + ')');
      }
    }
    
    // Also search for "进球" which is part of "总进球"
    var jqIdx = html.indexOf('进球');
    console.log('\n"进球" occurrences:', (html.match(/进球/g) || []).length);
    
    // Try: maybe HTML has "总进球数" or "总进球" differently
    var allTg = html.match(/总[^\n<>]{0,3}进[^\n<>]{0,3}球/g);
    console.log('allTg:', allTg ? allTg.slice(0, 5) : 'none');
    
    // Try broader pattern
    var broader = html.match(/总.{2,10}球/g);
    console.log('broader:', broader ? broader.slice(0, 5) : 'none');
  });
}).on('error', function(e) { console.log('Error:', e.message); });

var https = require('https');
var iconv = require('iconv-lite');

var options = {
  hostname: 'trade.500.com',
  path: '/jczq/?playid=312&g=2&date=2026-05-24',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': 'https://trade.500.com/jczq/',
  },
  rejectUnauthorized: false,
  timeout: 15000,
};

https.get(options, function(res) {
  var chunks = [];
  res.on('data', function(c) { chunks.push(c); });
  res.on('end', function() {
    var buf = Buffer.concat(chunks);
    var html = iconv.decode(buf, 'gbk');
    
    // Find all "单关" occurrences with context
    var idx = 0;
    var count = 0;
    while ((idx = html.indexOf('单关', idx)) !== -1) {
      var start = Math.max(0, idx - 100);
      var end = Math.min(html.length, idx + 150);
      var context = html.substring(start, end).replace(/\s+/g, ' ').replace(/</g, ' <').replace(/>/g, '> ');
      console.log('[' + count + '] ' + context);
      console.log('---');
      idx++;
      count++;
      if (count > 15) break;
    }

    // Also find "周日010" context
    var matchDay = html.indexOf('周日010');
    if (matchDay > 0) {
      var ctx010 = html.substring(matchDay - 50, matchDay + 500).replace(/\s+/g, ' ').replace(/</g, ' <').replace(/>/g, '> ');
      console.log('\n=== 周日010 context ===');
      console.log(ctx010.substring(0, 500));
    }
  });
}).on('error', function(e) { console.log('Error:', e.message); });

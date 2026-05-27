var h = require('https');
var iconv = require('iconv-lite');

var options = {
  hostname: 'trade.500.com',
  path: '/jczq/?playid=312&g=2&date=2026-05-24',
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': 'https://trade.500.com/jczq/' },
  rejectUnauthorized: false, timeout: 15000,
};

h.get(options, function(res) {
  var chunks = [];
  res.on('data', function(c) { chunks.push(c); });
  res.on('end', function() {
    var html = iconv.decode(Buffer.concat(chunks), 'gbk');
    
    // Find 周日011 segment
    var idx = html.indexOf('周日011');
    if (idx < 0) { console.log('NOT FOUND'); return; }
    var nextIdx = html.indexOf('周日012', idx);
    if (nextIdx < 0) nextIdx = html.indexOf('周一', idx);
    var seg = html.substring(idx, Math.min(nextIdx, idx + 3000));
    
    console.log('=== SEGMENT (first 800 chars) ===');
    console.log(seg.substring(0, 800));
    console.log();
    
    // Test totalGoals extraction
    var tgIdx = seg.indexOf('总进球');
    console.log('总进球 index in segment:', tgIdx);
    if (tgIdx >= 0) {
      var after = seg.substring(tgIdx + 3, Math.min(seg.length, tgIdx + 500));
      var tgNums = (after.match(/(\d{1,3}\.\d{2})/g) || []).map(Number);
      console.log('tgNums:', JSON.stringify(tgNums));
      console.log('tgNums.length:', tgNums.length);
    }
    
    // Also check for <span> tags
    var spanMatch = seg.match(/<span>(\d{1,3}\.\d{2})<\/span>/g);
    console.log('\nspan matches count:', (spanMatch||[]).length);
  });
}).on('error', function(e) { console.log('Error:', e.message); });

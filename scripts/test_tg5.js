var h = require('https');
var iconv = require('iconv-lite');

h.get('https://trade.500.com/jczq/?playid=312&g=2&date=2026-05-24', {
  headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9' },
  rejectUnauthorized: false, timeout: 15000,
}, function(res) {
  var chunks = [];
  res.on('data', function(c) { chunks.push(c); });
  res.on('end', function() {
    var html = iconv.decode(Buffer.concat(chunks), 'gbk');
    
    // Count "总进球" occurrences
    var count = 0, idx = 0;
    while ((idx = html.indexOf('总进球', idx)) !== -1) {
      var before = html.substring(Math.max(0, idx - 200), idx);
      var matchNumMatch = before.match(/(周[一二三四五六日]\d{3})/g);
      var lastMatch = matchNumMatch ? matchNumMatch[matchNumMatch.length - 1] : '?';
      
      var after = html.substring(idx, Math.min(idx + 300, html.length));
      var nums = (after.match(/(\d{1,3}\.\d{2})/g) || []).map(Number);
      
      console.log('[' + count + '] idx=' + idx + ' match=' + lastMatch + ' nums=' + JSON.stringify(nums.slice(0, 8)));
      idx++;
      count++;
      if (count > 35) break;
    }
    console.log('\nTotal 总进球 found:', count);
  });
}).on('error', function(e) { console.log('Error:', e.message); });

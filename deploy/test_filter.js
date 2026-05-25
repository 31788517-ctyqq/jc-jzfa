var http = require('http');

function api(action, data, cb) {
  var body = JSON.stringify({ action: action, data: data || {} });
  var req = http.request({
    hostname: '127.0.0.1', port: 3000, path: '/api', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, function(res) {
    var buf = '';
    res.on('data', function(c) { buf += c; });
    res.on('end', function() { cb(buf); });
  });
  req.write(body);
  req.end();
}

var i = 0;
var tests = [
  { label: 'filter-stats', action: 'filter-stats', data: {} },
  { label: 'filter-leagues(5)', action: 'filter-leagues', data: {} },
  { label: 'hit-rate(default)', action: 'hit-rate-filter', data: {} },
  { label: 'hit-rate(前3)', action: 'hit-rate-filter', data: { rankType: '每场', rankTop: 3 } },
  { label: 'hit-rate(胜平负)', action: 'hit-rate-filter', data: { directionType: '胜平负' } },
  { label: 'hit-rate(让球+前3)', action: 'hit-rate-filter', data: { directionType: '让球', rankType: '每场', rankTop: 3 } },
];

function next() {
  if (i >= tests.length) { console.log('\nDone.'); process.exit(0); return; }
  var t = tests[i++];
  api(t.action, t.data, function(r) {
    var d = JSON.parse(r);
    if (d.code === 1) {
      var info = '';
      if (t.action === 'filter-stats') {
        info = 'matches:' + d.data.matchCount + ' leagues:' + d.data.leagueCount + ' dirs:' + d.data.directionCount;
      } else if (t.action === 'filter-leagues') {
        info = d.data.length + ' leagues, e.g. ' + d.data.slice(0, 5).join(',');
      } else {
        info = 'hitCount:' + d.data.hitCount + ' totalCount:' + d.data.totalCount + ' hitRate:' + d.data.hitRate + '%';
        if (d.data.dailyResults) info += ' dailyResults:' + d.data.dailyResults.length;
      }
      console.log(t.label + ': ' + info);
    } else {
      console.log(t.label + ': ERROR ' + (d.msg || ''));
    }
    setTimeout(next, 300);
  });
}
next();

// Test match-detail and recommend-trend for historical matches
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

var tests = [
  // 5/20 match (周三008 弗赖堡 vs 阿斯顿维拉)
  { label: 'match-detail(5/20)', action: 'match-detail', data: { matchId: '2039855' } },
  // 5/10 match (周日001 蔚山现代 vs 富川FC)
  { label: 'match-detail(5/10)', action: 'match-detail', data: { matchId: '2039624' } },
  // 5/20 recommend-trend
  { label: 'recommend-trend(5/20)', action: 'recommend-trend', data: { matchId: '2039855' } },
  // 5/10 recommend-trend
  { label: 'recommend-trend(5/10)', action: 'recommend-trend', data: { matchId: '2039624' } },
];

var i = 0;
function next() {
  if (i >= tests.length) { console.log('\nDone.'); process.exit(0); return; }
  var t = tests[i++];
  api(t.action, t.data, function(r) {
    var d = JSON.parse(r);
    if (d.code === 1) {
      if (t.action === 'match-detail') {
        var m = d.data || d;
        console.log(t.label + ': ' + (m.homeName || '?') + ' vs ' + (m.visitName || '?') + ' ' + (m.num || '?'));
      } else {
        var td = d.data || {};
        console.log(t.label + ': series=' + (td.series || []).length + ' lastResult=' + (td.lastResult || []).length);
      }
    } else {
      console.log(t.label + ': ERROR ' + (d.msg || ''));
    }
    setTimeout(next, 200);
  });
}
next();

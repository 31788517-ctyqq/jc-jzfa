// Test match-list with historical dates via wrapped data format (frontend standard)
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
  { label: '5/24 via matchDate', action: 'match-list', data: { weekNum: '周日', matchDate: '05-24' } },
  { label: '5/20 via matchDate', action: 'match-list', data: { weekNum: '周三', matchDate: '05-20' } },
  { label: '5/25 via date', action: 'match-list', data: { date: '2026-05-25' } },
  { label: 'week-dates count', action: 'week-dates', data: {} },
];

var i = 0;
function next() {
  if (i >= tests.length) { console.log('\nDone.'); process.exit(0); return; }
  var t = tests[i++];
  api(t.action, t.data, function(r) {
    var d = JSON.parse(r);
    if (d.data && Array.isArray(d.data)) {
      var len = d.data.length;
      var preview = len > 0 ? JSON.stringify(d.data[0]).substring(0, 80) : '';
      console.log(t.label + ': ' + len + ' items ' + preview);
    } else {
      console.log(t.label + ': ' + r.substring(0, 120));
    }
    setTimeout(next, 200);
  });
}
next();

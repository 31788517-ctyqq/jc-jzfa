/** API test script - run on server via: node test_api.js */
var http = require('http');

function api(action, data, cb) {
  var body = JSON.stringify(Object.assign({ action: action }, data || {}));
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
  { label: 'income-60d', action: 'income-stats', data: { days: 60 } },
  { label: 'income-7d', action: 'income-stats', data: { days: 7 } },
  { label: 'ranking', action: 'ranking-list', data: {} },
  { label: 'filter-stats', action: 'filter-stats', data: {} },
  { label: 'filter-leagues', action: 'filter-leagues', data: {} },
  { label: 'match-list', action: 'match-list', data: { date: '2026-05-25' } },
  { label: 'hit-rate', action: 'hit-rate-stats', data: { days: 30 } },
  { label: 'plan-5/24', action: 'plan-list', data: { date: '2026-05-24' } },
  { label: 'plan-5/20', action: 'plan-list', data: { date: '2026-05-20' } },
  { label: 'plan-5/10', action: 'plan-list', data: { date: '2026-05-10' } },
  { label: 'week-dates', action: 'week-dates', data: {} },
];

var i = 0;
function next() {
  if (i >= tests.length) { console.log('\nDone.'); process.exit(0); return; }
  var t = tests[i++];
  api(t.action, t.data, function(r) {
    var short = r.substring(0, 200).replace(/\n/g, ' ');
    console.log(t.label + ': ' + short);
    setTimeout(next, 200);
  });
}
next();

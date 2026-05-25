// Check actual rec types for sample matches
var d = JSON.parse(require('fs').readFileSync('data.json', 'utf8'));
var r = d.r || {};

function fr(mid) { return r['m_' + mid] || r[String(mid)] || []; }

var dates = ['2026-05-10', '2026-05-19', '2026-05-25'];

dates.forEach(function(dt) {
  console.log('\n=== ' + dt + ' ===');
  var samples = [];
  Object.keys(d.m || {}).forEach(function(k) {
    var m = d.m[k];
    if ((m.date || '').slice(0, 10) === dt && samples.length < 3) samples.push(m);
  });
  samples.forEach(function(m) {
    var recs = fr(m.matchId);
    var types = recs.map(function(r) { return r.type + '(' + r.num + ')'; });
    console.log(m.num + ' ' + m.homeName + ' vs ' + m.visitName);
    console.log('  recs(' + recs.length + '): ' + types.join(', '));
  });
});

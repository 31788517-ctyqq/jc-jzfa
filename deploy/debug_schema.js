// Check the actual schema of old vs new recs
var d = JSON.parse(require('fs').readFileSync('data.json', 'utf8'));
var r = d.r || {};

// Find a 5/25 match
var newMatch = null, oldMatch = null;
Object.keys(d.m || {}).forEach(function(k) {
  var m = d.m[k];
  if (!newMatch && (m.date || '').slice(0, 10) === '2026-05-25') newMatch = m;
  if (!oldMatch && (m.date || '').slice(0, 10) === '2026-05-10') oldMatch = m;
});

console.log('=== 5/25 (NEW) rec schema ===');
var newRecs = (r['m_' + newMatch.matchId] || r[newMatch.matchId] || []);
if (newRecs.length > 0) {
  console.log(JSON.stringify(newRecs[0]));
  console.log('Keys:', Object.keys(newRecs[0]));
}

console.log('\n=== 5/10 (OLD) rec schema ===');
var oldRecs = (r['m_' + oldMatch.matchId] || r[oldMatch.matchId] || []);
if (oldRecs.length > 0) {
  console.log(JSON.stringify(oldRecs[0]));
  console.log('Keys:', Object.keys(oldRecs[0]));
}

// Check a few more old recs to confirm
console.log('\n=== Sample old rec values ===');
Object.keys(r).slice(0, 5).forEach(function(k) {
  var recs = r[k];
  if (recs.length > 0) {
    console.log(k + ': ' + JSON.stringify(recs[0]));
  }
});

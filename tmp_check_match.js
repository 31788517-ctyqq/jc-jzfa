var d = require('./core/cache').getDataJson();
var m = d.m;
var keys = ['m_2040002', '2040002'];
for (var i = 0; i < keys.length; i++) {
  var match = m[keys[i]];
  if (match) {
    console.log('key:', keys[i], 'date:', match.date, 'matchStatus:', match.matchStatus, 'score:', JSON.stringify(match.score), 'home:', match.homeName, 'visit:', match.visitName);
    break;
  }
}
if (!match) console.log('NOT FOUND in mMap');

// Also try checking all keys with date 2026-05-28
console.log('\n--- Matches for 2026-05-28 ---');
Object.keys(m).forEach(function(k) {
  var x = m[k];
  if (x && (x.matchId === '2040002' || x.matchId === 2040002 || String(x.matchId) === '2040002')) {
    console.log('Found by matchId:', k, 'matchStatus:', x.matchStatus, 'score:', JSON.stringify(x.score), 'date:', x.date);
  }
});

// Check recommendation data matching
var d = JSON.parse(require('fs').readFileSync('data.json', 'utf8'));

// Sample: 5/20 matches
var matchIds = [];
Object.keys(d.m || {}).forEach(function(k) {
  var m = d.m[k];
  if ((m.date || '').slice(0, 10) === '2026-05-20') matchIds.push(m.matchId);
});
console.log('5/20 matchIds:', matchIds);

// Check if recs exist for these
matchIds.forEach(function(mid) {
  var rk = 'm_' + mid;
  var recs = d.r[rk] || [];
  console.log('  ' + rk + ': ' + recs.length + ' recs');
});

// Check a few rec keys
var rKeys = Object.keys(d.r || {}).slice(0, 10);
console.log('\nFirst 10 rec keys:', rKeys);
console.log('Total rec keys:', Object.keys(d.r || {}).length);

// Check if any rec key matches a 5/20 matchId
var found = false;
matchIds.forEach(function(mid) {
  Object.keys(d.r || {}).forEach(function(rk) {
    if (rk.indexOf(mid) >= 0) {
      console.log('MATCH: ' + rk + ' contains ' + mid);
      found = true;
    }
  });
});
if (!found) console.log('NO rec keys match 5/20 matchIds!');

// Check a sample 5/25 match vs recs
console.log('\n--- 5/25 check ---');
Object.keys(d.m || {}).forEach(function(k) {
  var m = d.m[k];
  if ((m.date || '').slice(0, 10) === '2026-05-25') {
    var rk = 'm_' + m.matchId;
    var recs = d.r[rk] || [];
    console.log(m.num + ' ' + m.matchId + ': ' + recs.length + ' recs, ' + recs.map(function(r){return r.type}).join(','));
  }
});

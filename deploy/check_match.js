// Detailed check: which historical dates have matching recs?
var d = JSON.parse(require('fs').readFileSync('data.json', 'utf8'));

// Build rec matchId set
var recIds = {};
Object.keys(d.r || {}).forEach(function(k) {
  var mid = k.replace(/^m_/, '');
  recIds[mid] = (recIds[mid] || 0) + 1;
});

console.log('Total rec matchIds:', Object.keys(recIds).length);

// Check each date
var dates = {};
Object.keys(d.m || {}).forEach(function(k) {
  var m = d.m[k];
  var dt = (m.date || '').slice(0, 10);
  if (!dt) return;
  if (!dates[dt]) dates[dt] = { total: 0, withRecs: 0 };
  dates[dt].total++;
  if (recIds[m.matchId]) dates[dt].withRecs++;
});

// Show recent dates
var sortedDates = Object.keys(dates).sort().reverse().slice(0, 15);
console.log('\nRecent dates match <-> rec alignment:');
sortedDates.forEach(function(dt) {
  var info = dates[dt];
  var pct = info.total > 0 ? Math.round(info.withRecs / info.total * 100) : 0;
  var status = pct === 100 ? 'OK' : (pct === 0 ? 'EMPTY' : 'PARTIAL');
  console.log('  ' + dt + ': ' + info.withRecs + '/' + info.total + ' matches with recs (' + pct + '%) ' + status);
});

// Check overall stats
var totalMatches = 0, totalWithRecs = 0;
Object.keys(dates).forEach(function(dt) {
  totalMatches += dates[dt].total;
  totalWithRecs += dates[dt].withRecs;
});
console.log('\nOverall: ' + totalWithRecs + '/' + totalMatches + ' matches have recs');

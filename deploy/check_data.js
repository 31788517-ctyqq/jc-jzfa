// Check data on server
var d = JSON.parse(require('fs').readFileSync('data.json', 'utf8'));
var dates = {};
Object.keys(d.m || {}).forEach(function(k) {
  var dt = (d.m[k].date || '').slice(0, 10);
  if (dt) dates[dt] = (dates[dt] || 0) + 1;
});

console.log('Matches by date:');
['2026-05-24', '2026-05-20', '2026-05-10', '2026-05-01'].forEach(function(dt) {
  var count = dates[dt] || 0;
  var sample = null;
  Object.keys(d.m || {}).forEach(function(k) {
    var m = d.m[k];
    if (!sample && (m.date || '').slice(0, 10) === dt) sample = m;
  });
  if (sample) {
    var odds = null;
    try { odds = JSON.parse(require('fs').readFileSync('odds_history/' + dt + '.json', 'utf8')); } catch(e) {}
    var hasOdds = odds ? !!(odds.odds || {})[sample.num] : false;
    console.log('  ' + dt + ': ' + count + ' matches, sample=' + sample.num + ' ' + sample.homeName + ' vs ' + sample.visitName + ', hasOdds=' + hasOdds);
    if (odds) {
      var okeys = Object.keys(odds.odds || {});
      console.log('    odds keys(' + okeys.length + '): ' + okeys.slice(0, 6).join(', ') + (okeys.length > 6 ? '...' : ''));
    }
  } else {
    console.log('  ' + dt + ': ' + count + ' matches, no sample');
  }
});

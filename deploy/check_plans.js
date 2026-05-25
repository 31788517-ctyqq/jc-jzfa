// Check why plans are empty for specific dates
var d = JSON.parse(require('fs').readFileSync('data.json', 'utf8'));
var dates = ['2026-05-20', '2026-05-10'];

dates.forEach(function(dateStr) {
  console.log('\n=== ' + dateStr + ' ===');
  var mList = [];
  Object.keys(d.m || {}).forEach(function(k) {
    var m = d.m[k];
    if (m && (m.date || '').slice(0, 10) === dateStr) mList.push(m);
  });
  console.log('Matches: ' + mList.length);

  // Check odds
  var odds = null;
  try { odds = JSON.parse(require('fs').readFileSync('odds_history/' + dateStr + '.json', 'utf8')); } catch(e) {}
  var hasOdds = !!odds;

  mList.forEach(function(m) {
    var num = m.num || '';
    var oddsOk = hasOdds ? !!(odds.odds || {})[num] : false;
    var recs = (d.r || {})['m_' + m.matchId] || [];
    // Find directions of interest
    var dirSet = {};
    recs.forEach(function(r) {
      if (r.type && r.num > 0) dirSet[r.type] = r.num;
    });
    var hasPP = dirSet['平'] || dirSet['让平'] ? true : false;
    var hasRF = dirSet['让负'] ? true : false;
    var hasRS = dirSet['让胜'] ? true : false;
    var hasGoal = dirSet['总进球-2、3球'] ? true : false;
    var topDirs = Object.keys(dirSet).sort(function(a,b){return dirSet[b]-dirSet[a]}).slice(0,3).map(function(d){return d+'('+dirSet[d]+')'}).join(',');
    console.log('  ' + num + ' ' + m.homeName + ' vs ' + m.visitName + ' odds=' + oddsOk + ' topDirs: ' + topDirs);
  });
});

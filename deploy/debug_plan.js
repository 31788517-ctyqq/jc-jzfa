// Debug why 5/10 plans are empty
var d = JSON.parse(require('fs').readFileSync('data.json', 'utf8'));
var r = d.r || {};

function fr(mid) { return r['m_' + mid] || r[String(mid)] || []; }

var dateStr = process.argv[2] || '2026-05-10';

var mList = [];
Object.keys(d.m || {}).forEach(function(k) {
  var m = d.m[k];
  if ((m.date || '').slice(0, 10) === dateStr) mList.push(m);
});

var odds = null;
try { odds = JSON.parse(require('fs').readFileSync('odds_history/' + dateStr + '.json', 'utf8')); } catch(e) {}

console.log(dateStr + ': ' + mList.length + ' matches, odds=' + !!odds);

var best = { pp: { m: null, c: 0 }, rf: { m: null, c: 0 }, rs: { m: null, c: 0 }, g23: { m: null, c: 0 } };

mList.forEach(function(m) {
  var recs = fr(m.matchId);
  var num = m.num || '';
  var hasOdds = !!(odds && (odds.odds || {})[num]);
  if (!hasOdds) return;

  var pp = 0, rf = 0, rs = 0, g23 = 0;
  recs.forEach(function(r) {
    if (r.type === '平') pp += r.num;
    if (r.type === '让平') pp += r.num;
    if (r.type === '让负') rf += r.num;
    if (r.type === '让胜') rs += r.num;
    if (r.type === '总进球-2、3球') g23 += r.num;
  });

  if (pp > best.pp.c) { best.pp.c = pp; best.pp.m = m; }
  if (rf > best.rf.c) { best.rf.c = rf; best.rf.m = m; }
  if (rs > best.rs.c) { best.rs.c = rs; best.rs.m = m; }
  if (g23 > best.g23.c) { best.g23.c = g23; best.g23.m = m; }
});

console.log('Best PP (平、让平):', best.pp.m ? best.pp.m.num : 'none', 'count:', best.pp.c);
console.log('Best RF (让负):', best.rf.m ? best.rf.m.num : 'none', 'count:', best.rf.c);
console.log('Best RS (让胜):', best.rs.m ? best.rs.m.num : 'none', 'count:', best.rs.c);
console.log('Best G23 (总进球-2、3球):', best.g23.m ? best.g23.m.num : 'none', 'count:', best.g23.c);

// Check if we can form plans
if (best.pp.m && best.rf.m && best.pp.m.matchId !== best.rf.m.matchId) {
  console.log('Plan 1: PP + RF OK');
} else {
  console.log('Plan 1: PP + RF FAILED');
}
if (best.g23.m && best.rf.m && best.g23.m.matchId !== best.rf.m.matchId) {
  console.log('Plan 2: G23 + RF OK');
} else {
  console.log('Plan 2: G23 + RF FAILED');
}
if (best.g23.m && best.rs.m && best.g23.m.matchId !== best.rs.m.matchId) {
  console.log('Plan 3: G23 + RS OK');
} else {
  console.log('Plan 3: G23 + RS FAILED');
}

// Check findRecommends in plan-list matches the same recs
console.log('\nSample findRecommends check:');
if (mList.length > 0) {
  var sm = mList[0];
  var recs = fr(sm.matchId);
  console.log(sm.num + ' ' + sm.matchId + ': ' + recs.length + ' recs');
}

// 快速检查 6/16 方案生成结果
var PG = require('/root/server/core/plan-generator');
var d = JSON.parse(require('fs').readFileSync('/root/server/data.json','utf8'));
var mMap = d.m || {}, rMap = d.r || {};
var odds = JSON.parse(require('fs').readFileSync('/root/server/odds_history/2026-06-16.json','utf8'));
var odMap = (odds && odds.odds) ? odds.odds : odds;

var mList = [], mdm = {};
Object.keys(mMap).forEach(function(k) {
  var m = mMap[k];
  if ((m.date||'').slice(0,10) === '2026-06-16' && (m.leagueName||'').indexOf('世界杯') >= 0)
    mList.push(Object.assign({}, m));
});

mList.forEach(function(m) {
  var raw = rMap['m_' + m.matchId] || rMap[String(m.matchId)] || [];
  var o = odMap[m.num || ''];
  mdm[m.matchId] = {
    match: m,
    recs: (raw||[]).map(function(x) { var r = x.rs !== undefined ? x.rs : x.result; return { type: x.t||x.type, num: x.n||x.num, result: r === 0 || r === 1 ? r : null }; }),
    odds: o ? { spf: o.spf||null, rqspf: o.rqspf||null, totalGoals: o.totalGoals||null, isSingleGame: o.isSingleGame||false } : null
  };
});

var plans = PG.generateExpertPlans(mList, mdm, '2026-06-16');
console.log('6/16 方案数:', plans.length);
console.log('hasRecs:', Object.values(mdm).some(function(md) { return md.recs.length > 0; }));
console.log('hasOdds:', Object.values(mdm).some(function(md) { return !!md.odds; }));
plans.forEach(function(p, i) {
  var mstr = (p.matches||[]).map(function(m) { return m.homeName + ':' + m.direction + '(' + m.expertCount + '人)'; }).join(' × ');
  console.log((i+1) + '. ' + p.planName + ' ' + mstr + ' maxPrize=' + (p.maxPrize||0) + ' passType=' + p.passType + ' status=' + (p.isPlanWon===null&&p.isPlanLose===null?'pending':(p.isPlanWon?'won':'lost')));
});

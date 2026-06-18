/**
 * 重新生成世界杯历史方案 (6/11-6/16) 使用最新规则
 * 运行: cd /root/server && node regen_wc_plans.cjs
 */
var fs = require('fs');
var path = require('path');
var PG = require('/root/server/core/plan-generator');

var dataFile = JSON.parse(fs.readFileSync('/root/server/data.json', 'utf8'));
var mMap = dataFile.m || {};
var rMap = dataFile.r || {};

var dates = ['2026-06-11','2026-06-12','2026-06-13','2026-06-14','2026-06-15','2026-06-16'];

function normalizeRecs(raw) {
  return (raw || []).map(function (x) {
    var r = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
    return { type: x.t || x.type, num: x.n || x.num, result: r === 0 || r === 1 ? r : null };
  });
}

function loadOdds(ds) {
  try {
    var p = '/root/server/odds_history/' + ds + '.json';
    if (!fs.existsSync(p)) return null;
    var json = JSON.parse(fs.readFileSync(p, 'utf8'));
    return (json && json.odds) ? json.odds : json;
  } catch (e) { return null; }
}

var allPlans = {};
var totalProfit = 0, totalCount = 0, totalWon = 0;
var planTypeStats = {};

console.log('═══════════════════════════════════════════');
console.log('  重新生成世界杯方案 (6/11-6/16)');
console.log('═══════════════════════════════════════════\n');

dates.forEach(function (ds) {
  var mList = [];
  var odds = loadOdds(ds);
  
  Object.keys(mMap).forEach(function (k) {
    var m = mMap[k];
    if (m && (m.date || '').slice(0, 10) === ds) {
      var isWC = (m.leagueName || '').indexOf('世界杯') >= 0;
      if (!isWC) return;
      var copy = Object.assign({}, m);
      mList.push(copy);
    }
  });

  if (mList.length === 0) { console.log(ds, ': 无世界杯比赛'); return; }

  var matchDataMap = {};
  mList.forEach(function (m) {
    var raw = rMap['m_' + m.matchId] || rMap[String(m.matchId)] || [];
    var num = m.num || '';
    var od = odds && odds[num] ? odds[num] : null;
    matchDataMap[m.matchId] = {
      match: m,
      recs: normalizeRecs(raw),
      odds: od ? {
        spf: od.spf || null, rqspf: od.rqspf || null,
        totalGoals: od.totalGoals || null, halfFull: od.halfFull || null,
        isSingleGame: od.isSingleGame || false,
      } : null
    };
  });

  var plans = PG.generateExpertPlans(mList, matchDataMap, ds);
  allPlans[ds] = plans;

  var dayProfit = 0;
  var dayNames = [];
  plans.forEach(function (p) {
    totalCount++;
    if (!planTypeStats[p.name]) planTypeStats[p.name] = { total: 0, won: 0, profit: 0 };
    planTypeStats[p.name].total++;

    // ★ 未出结果：计入方案数但不计盈亏
    if (p.isPlanWon === null && p.isPlanLose === null) {
      dayNames.push(p.planName + '(pending+' + (p.maxPrize||0) + ')');
      return;
    }

    var r = '?';
    if (p.isPlanWon === true) {
      totalWon++; planTypeStats[p.name].won++;
      var pf = (p.winningPrize || 0) - 1000;
      dayProfit += pf; planTypeStats[p.name].profit += pf;
      r = '✓';
    } else if (p.isPlanLose === true) {
      dayProfit -= 1000; planTypeStats[p.name].profit -= 1000;
      r = '✗';
    }
    dayNames.push(p.planName + '(' + r + (p.maxPrize || 0) + ')');
  });

  if (dayNames.length > 0) {
    totalProfit += dayProfit;
    console.log(ds + '  ' + mList.length + '场  ' + dayNames.length + '案  ' + (dayProfit >= 0 ? '+' : '') + dayProfit + '  ' + dayNames.join(' '));
  } else {
    console.log(ds + '  ' + mList.length + '场  无方案');
  }

  // 保存方案快照
  PG.savePlanSnapshot(ds, plans, null, new Date().toISOString());
});

console.log('\n═══════════════════════════════════════════');
console.log('  汇总');
console.log('═══════════════════════════════════════════');
console.log('总方案:', totalCount);
console.log('命中:', totalWon);
console.log('命中率:', totalCount > 0 ? ((totalWon / totalCount) * 100).toFixed(1) + '%' : 'N/A');
console.log('总盈利:', totalProfit, '分 (', (totalProfit / 100).toFixed(2), '元)');
console.log('总投入:', totalCount * 1000, '分 (', ((totalCount * 1000) / 100).toFixed(2), '元)');
console.log('ROI:', totalCount > 0 ? ((totalProfit / (totalCount * 1000)) * 100).toFixed(1) + '%' : 'N/A');

console.log('\n── 按方案类型 ──');
var planNames = { plan_1: '方案一', plan_2: '方案二', plan_3: '方案三', plan_4: '方案四', plan_5: '方案五', plan_6: '方案六', plan_7: '方案七', plan_8: '方案八' };
Object.keys(planTypeStats).sort().forEach(function (k) {
  var s = planTypeStats[k];
  console.log((planNames[k] || k).padEnd(8), '总数=' + String(s.total).padEnd(4), '命中=' + String(s.won).padEnd(4), '命中率=' + (s.total > 0 ? ((s.won / s.total) * 100).toFixed(1) + '%' : '-').padEnd(8), '盈利=' + s.profit);
});

console.log('\n方案快照已保存到 /root/server/plan_snapshots/');

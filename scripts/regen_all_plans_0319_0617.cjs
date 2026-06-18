/**
 * 重新生成所有专家博热方案 (2026-03-19 ~ 2026-06-17)
 * 使用最新 split 逻辑：世界杯 + 常规分拆生成
 * 运行: node scripts/regen_all_plans_0319_0617.cjs
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var PG = require('../server/core/plan-generator');

var dataFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'data.json'), 'utf8'));
var mMap = dataFile.m || {};
var rMap = dataFile.r || {};

var AMOUNT = 1000;

// ── 收集日期 ──
var dates = new Set();
Object.keys(mMap).forEach(function (k) {
  var m = mMap[k];
  if (m && m.date) {
    var d = m.date.slice(0, 10);
    if (d >= '2026-03-19' && d <= '2026-06-17') dates.add(d);
  }
});
var sortedDates = Array.from(dates).sort();

console.log('═══════════════════════════════════════════');
console.log('  重新生成方案 (' + sortedDates[0] + ' ~ ' + sortedDates[sortedDates.length - 1] + ')');
console.log('  共 ' + sortedDates.length + ' 天');
console.log('═══════════════════════════════════════════\n');

function normalizeRecs(raw) {
  return (raw || []).map(function (x) {
    var r = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
    return { type: x.t || x.type, num: x.n || x.num, result: r === 0 || r === 1 ? r : null };
  });
}

function loadOdds(ds) {
  try {
    var p = path.join(ROOT, 'server', 'odds_history', ds + '.json');
    if (!fs.existsSync(p)) return null;
    var json = JSON.parse(fs.readFileSync(p, 'utf8'));
    return (json && json.odds) ? json.odds : json;
  } catch (e) { return null; }
}

var totalPlans = 0, totalWon = 0, totalProfit = 0;
var planTypeStats = {};
var pendingCount = 0;

console.log('日期\t\t场次\tWC\t常规\t方案\t日盈\t累计');
console.log('─'.repeat(90));

sortedDates.forEach(function (ds) {
  var mList = [];
  Object.keys(mMap).forEach(function (k) {
    var m = mMap[k];
    if (m && (m.date || '').slice(0, 10) === ds) {
      mList.push(Object.assign({}, m));
    }
  });
  if (mList.length === 0) return;

  var odds = loadOdds(ds);

  var matchDataMap = {};
  mList.forEach(function (m) {
    var raw = rMap['m_' + m.matchId] || rMap[String(m.matchId)] || [];
    var num = m.num || '';
    var od = odds && odds[num] ? odds[num] : null;
    matchDataMap[m.matchId] = {
      match: m,
      recs: normalizeRecs(raw),
      odds: od ? {
        spf: od.spf || null,
        rqspf: od.rqspf || null,
        totalGoals: od.totalGoals || null,
        halfFull: od.halfFull || null,
        isSingleGame: od.isSingleGame || false,
      } : null
    };
  });

  // ★ 使用新的 split 逻辑
  var plans = PG.generateExpertPlans(mList, matchDataMap, ds);

  var wcCount = 0, rgCount = 0;
  var dayProfit = 0, dayPending = 0;

  plans.forEach(function (p) {
    if (p.planName.indexOf('世界杯') >= 0) wcCount++;
    else rgCount++;

    if (!planTypeStats[p.name]) planTypeStats[p.name] = { total: 0, won: 0, profit: 0 };
    planTypeStats[p.name].total++;

    if (p.isPlanWon === null && p.isPlanLose === null) {
      dayPending++;
      return;
    }

    if (p.isPlanWon === true) {
      totalWon++;
      planTypeStats[p.name].won++;
      var pf = (p.winningPrize || 0) - AMOUNT;
      dayProfit += pf;
      planTypeStats[p.name].profit += pf;
    } else if (p.isPlanLose === true) {
      dayProfit -= AMOUNT;
      planTypeStats[p.name].profit -= AMOUNT;
    }
  });

  totalPlans += plans.length;
  pendingCount += dayPending;
  totalProfit += dayProfit;

  var wcStr = wcCount > 0 ? 'wc' + wcCount : '  -';
  var rgStr = rgCount > 0 ? 'rg' + rgCount : '  -';
  console.log(
    ds + '\t' +
    String(mList.length).padEnd(4) +
    wcStr.padEnd(6) +
    rgStr.padEnd(6) +
    String(plans.length).padEnd(4) +
    (dayProfit >= 0 ? '+' : '') + String(dayProfit).padEnd(6) +
    String(totalProfit)
  );

  // 保存方案快照
  try {
    PG.savePlanSnapshot(ds, plans, null, new Date().toISOString());
  } catch (e) {}
});

var resolvedCount = totalPlans - pendingCount;

console.log('\n═══════════════════════════════════════════');
console.log('  汇总');
console.log('═══════════════════════════════════════════');
console.log('总方案数:', totalPlans, '(已出结果:', resolvedCount, ', 待开奖:', pendingCount, ')');
console.log('命中数:', totalWon);
console.log('命中率:', resolvedCount > 0 ? (totalWon / resolvedCount * 100).toFixed(1) + '%' : 'N/A');
console.log('总盈利:', totalProfit, '分 (', (totalProfit / 100).toFixed(2), '元)');
console.log('总投入:', resolvedCount * AMOUNT, '分 (', (resolvedCount * AMOUNT / 100).toFixed(2), '元)');
console.log('ROI:', resolvedCount > 0 ? (totalProfit / (resolvedCount * AMOUNT) * 100).toFixed(1) + '%' : 'N/A');

console.log('\n── 按方案类型 ──');
var planNameMap = {};
// WC plans
for (var i = 1; i <= 8; i++) planNameMap['plan_wc' + i] = '世界杯' + (i < 10 ? '0' + i : i);
// Regular plans
for (var i = 1; i <= 8; i++) {
  var cn = ['', '一', '二', '三', '四', '五', '六', '七', '八'];
  planNameMap['plan_' + i] = '方案' + cn[i];
}

Object.keys(planTypeStats).sort().forEach(function (k) {
  var s = planTypeStats[k];
  var hitRate = s.total > 0 ? (s.won / s.total * 100).toFixed(1) : 'N/A';
  console.log(
    (planNameMap[k] || k).padEnd(10) +
    '总数=' + String(s.total).padEnd(4) +
    '命中=' + String(s.won).padEnd(4) +
    (typeof hitRate === 'string' ? '命中率=' + hitRate.padEnd(8) : '命中率=' + String(hitRate + '%').padEnd(8)) +
    '盈利=' + s.profit
  );
});

console.log('\n方案快照已保存到 server/plan_snapshots/');

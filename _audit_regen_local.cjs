/**
 * 审计脚本：本地 regen → _audit_ground_truth/ + _audit_summary.json
 * 用于生成"正确答案"数据集，后续与服务器快照对比
 * 运行: node _audit_regen_local.cjs
 */
var fs = require('fs');
var path = require('path');

var ROOT = __dirname;
var PG = require('./server/core/plan-generator');

var dataFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'data.json'), 'utf8'));
var mMap = dataFile.m || {};
var rMap = dataFile.r || {};

var AMOUNT = 1000;
var OUT_DIR = path.join(ROOT, '_audit_ground_truth');

// 确保输出目录
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

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
console.log('  审计 regen (' + sortedDates[0] + ' ~ ' + sortedDates[sortedDates.length - 1] + ')');
console.log('  共 ' + sortedDates.length + ' 天  |  rMap: ' + Object.keys(rMap).length + ' 条');
console.log('  输出: _audit_ground_truth/');
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

// ★ 覆写 PG.savePlanSnapshot → 输出到 _audit_ground_truth/
var originalSave = PG.savePlanSnapshot;
PG.savePlanSnapshot = function (dateStr, plans, earliestKickoff, lockedAt) {
  try {
    var snap = {
      lockedAt: lockedAt || new Date().toISOString(),
      earliestKickoff: earliestKickoff,
      date: dateStr,
      plans: plans.map(function (plan) {
        return {
          planId: plan.planId,
          name: plan.name,
          planName: plan.planName,
          playType: plan.playType,
          passType: plan.passType,
          multiplier: plan.multiplier,
          amount: plan.amount,
          matches: (plan.matches || []).map(function (m) {
            return { matchId: m.matchId, direction: m.direction, homeName: m.homeName, visitName: m.visitName, matchNum: m.matchNum };
          }),
        };
      }),
    };
    fs.writeFileSync(path.join(OUT_DIR, dateStr + '.json'), JSON.stringify(snap, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
};

// ── 汇总数据 ──
var totalPlans = 0, totalWon = 0, totalProfit = 0, pendingCount = 0;
var planTypeStats = {};
var dailyBreakdown = [];        // 每日摘要
var allPlanDetails = [];        // 每个方案的详细数据

console.log('日期\t\t场次\t方案\t待开\t命中\t日盈\t累计');
console.log('─'.repeat(85));

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
        spf: od.spf || null, rqspf: od.rqspf || null,
        totalGoals: od.totalGoals || null, halfFull: od.halfFull || null,
        isSingleGame: od.isSingleGame || false,
      } : null
    };
  });

  var plans = PG.generateExpertPlans(mList, matchDataMap, ds);

  var dayProfit = 0, dayPending = 0, dayWon = 0, dayLost = 0;

  plans.forEach(function (p) {
    var isWC = p.planName.indexOf('世界杯') >= 0;

    if (!planTypeStats[p.name]) planTypeStats[p.name] = { total: 0, won: 0, lost: 0, profit: 0 };
    planTypeStats[p.name].total++;

    var status = 'pending';
    if (p.isPlanWon === true) {
      status = 'won';
      totalWon++; dayWon++;
      planTypeStats[p.name].won++;
      var pf = (p.winningPrize || 0) - AMOUNT;
      dayProfit += pf;
      planTypeStats[p.name].profit += pf;
    } else if (p.isPlanLose === true) {
      status = 'lost';
      dayLost++;
      planTypeStats[p.name].lost++;
      dayProfit -= AMOUNT;
      planTypeStats[p.name].profit -= AMOUNT;
    } else {
      dayPending++;
    }

    // 收集每个方案详情
    allPlanDetails.push({
      date: ds,
      planId: p.planId,
      name: p.name,
      planName: p.planName,
      isWC: isWC,
      status: status,
      isPlanWon: p.isPlanWon,
      isPlanLose: p.isPlanLose,
      winningPrize: p.winningPrize || 0,
      multiplier: p.multiplier,
      matchCount: (p.matches || []).length,
    });
  });

  totalPlans += plans.length;
  pendingCount += dayPending;
  totalProfit += dayProfit;

  dailyBreakdown.push({
    date: ds,
    matchCount: mList.length,
    planCount: plans.length,
    won: dayWon,
    lost: dayLost,
    pending: dayPending,
    dayProfit: dayProfit,
    cumulativeProfit: totalProfit,
  });

  console.log(
    ds + '\t' +
    String(mList.length).padEnd(4) +
    String(plans.length).padEnd(4) +
    String(dayPending).padEnd(4) +
    String(dayWon).padEnd(4) +
    (dayProfit >= 0 ? '+' : '') + String(dayProfit).padEnd(6) +
    String(totalProfit)
  );

  // 保存快照到 _audit_ground_truth/
  try { PG.savePlanSnapshot(ds, plans, null, new Date().toISOString()); } catch (e) {}
});

// 恢复原始 savePlanSnapshot
PG.savePlanSnapshot = originalSave;

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
for (var i = 1; i <= 8; i++) planNameMap['plan_wc' + i] = '世界杯' + (i < 10 ? '0' + i : i);
var cn = ['', '一', '二', '三', '四', '五', '六', '七', '八'];
for (var i = 1; i <= 8; i++) planNameMap['plan_' + i] = '方案' + cn[i];

Object.keys(planTypeStats).sort().forEach(function (k) {
  var s = planTypeStats[k];
  var hitRate = s.total > 0 ? (s.won / s.total * 100).toFixed(1) : 'N/A';
  console.log(
    (planNameMap[k] || k).padEnd(10) +
    '总数=' + String(s.total).padEnd(4) +
    '命中=' + String(s.won).padEnd(4) +
    '命中率=' + String(hitRate + '%').padEnd(8) +
    '盈利=' + s.profit
  );
});

// ── 输出审计摘要 JSON ──
var summary = {
  generatedAt: new Date().toISOString(),
  dataSource: 'local data.json (rMap: ' + Object.keys(rMap).length + ', mMap: ' + Object.keys(mMap).length + ')',
  dateRange: sortedDates[0] + ' ~ ' + sortedDates[sortedDates.length - 1],
  totalDays: sortedDates.length,
  totals: {
    totalPlans: totalPlans,
    resolvedCount: resolvedCount,
    pendingCount: pendingCount,
    totalWon: totalWon,
    hitRate: resolvedCount > 0 ? parseFloat((totalWon / resolvedCount * 100).toFixed(1)) : null,
    totalProfit: totalProfit,
    totalInvested: resolvedCount * AMOUNT,
    roi: resolvedCount > 0 ? parseFloat((totalProfit / (resolvedCount * AMOUNT) * 100).toFixed(1)) : null,
  },
  planTypeStats: planTypeStats,
  dailyBreakdown: dailyBreakdown,
  planDetails: allPlanDetails,
};

var summaryFile = path.join(ROOT, '_audit_summary.json');
fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8');
console.log('\n审计摘要已保存: _audit_summary.json (' + allPlanDetails.length + ' 条方案详情)');
console.log('快照已保存: _audit_ground_truth/ (' + sortedDates.length + ' 天)');

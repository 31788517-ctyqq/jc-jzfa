/**
 * 世界杯方案规则回测（强制应用于非世界杯比赛）
 * 2026-03-19 ~ 2026-06-10
 */
const fs = require('fs');
const path = require('path');

const PG = require('../server/core/plan-generator');
const dataFile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'data.json'), 'utf8'));
const mMap = dataFile.m || {};
const rMap = dataFile.r || {};

const START = '2026-03-19';
const END = '2026-06-10';

function normalizeRecs(raw) {
  return (raw || []).map(function (x) {
    var r = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
    return { type: x.t || x.type, num: x.n || x.num, result: r === 0 || r === 1 ? r : null };
  });
}

function loadOdds(ds) {
  try {
    var p = path.join(__dirname, '..', 'server', 'odds_history', ds + '.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

var dates = new Set();
Object.keys(mMap).forEach(function (k) {
  var m = mMap[k];
  if (m && m.date) {
    var d = m.date.slice(0, 10);
    if (d >= START && d <= END) dates.add(d);
  }
});
var sortedDates = Array.from(dates).sort();

var AMOUNT = 1000;
var totalPlans = 0,
  totalWon = 0,
  totalProfit = 0;
var planTypeStats = {};

console.log('日期\t\t场数\t方案\t日盈\t累计');
console.log('─'.repeat(65));

sortedDates.forEach(function (ds) {
  var mList = [];
  Object.keys(mMap).forEach(function (k) {
    var m = mMap[k];
    if (m && (m.date || '').slice(0, 10) === ds) {
      // 深拷贝避免污染 data.json 原始数据
      mList.push(Object.assign({}, m));
    }
  });
  if (mList.length === 0) return;

  // ★ 强制触发世界杯规则：注入虚拟世界杯标签
  if (mList.length > 0) mList[0].leagueName = (mList[0].leagueName || '') + '_世界杯';

  var odds = loadOdds(ds);
  var mdm = {};
  mList.forEach(function (m) {
    var raw = rMap['m_' + m.matchId] || rMap[String(m.matchId)] || [];
    var num = m.num || '';
    var od = odds && odds[num] ? odds[num] : null;
    var oddsObj = od
      ? {
          spf: od.spf || null,
          rqspf: od.rqspf || null,
          totalGoals: od.totalGoals || null,
          halfFull: od.halfFull || null,
          isSingleGame: od.isSingleGame || false,
        }
      : null;
    mdm[m.matchId] = { match: m, recs: normalizeRecs(raw), odds: oddsObj };
  });

  var plans = PG.generateExpertPlans(mList, mdm, ds);
  var dayProfit = 0;

  plans.forEach(function (p) {
    if (p.isPlanWon === null && p.isPlanLose === null) return;
    totalPlans++;
    if (!planTypeStats[p.name]) planTypeStats[p.name] = { total: 0, won: 0, profit: 0 };
    planTypeStats[p.name].total++;

    if (p.isPlanWon === true) {
      totalWon++;
      planTypeStats[p.name].won++;
      var profit = (p.winningPrize || 0) - AMOUNT;
      dayProfit += profit;
      planTypeStats[p.name].profit += profit;
    } else if (p.isPlanLose === true) {
      dayProfit -= AMOUNT;
      planTypeStats[p.name].profit -= AMOUNT;
    }
  });

  if (plans.length > 0) {
    totalProfit += dayProfit;
    console.log(ds + '\t' + mList.length + '\t' + plans.length + '\t' + dayProfit + '\t' + totalProfit);
  }
});

console.log('\n══════════════════════════');
console.log('日期范围:', START, '~', END);
console.log('规则: 世界杯方案一~八（强制应用于所有日期）');
console.log('总方案:', totalPlans);
console.log('命中:', totalWon);
console.log('命中率:', totalPlans > 0 ? ((totalWon / totalPlans) * 100).toFixed(1) + '%' : 'N/A');
console.log('总盈利:', totalProfit, '分 (', (totalProfit / 100).toFixed(2), '元)');
console.log('投入:', totalPlans * AMOUNT, '分 (', ((totalPlans * AMOUNT) / 100).toFixed(2), '元)');
console.log('ROI:', totalPlans > 0 ? ((totalProfit / (totalPlans * AMOUNT)) * 100).toFixed(1) + '%' : 'N/A');

console.log('\n── 按方案类型 ──');
var planNames = {
  plan_1: '方案一',
  plan_2: '方案二',
  plan_3: '方案三',
  plan_4: '方案四',
  plan_5: '方案五',
  plan_6: '方案六',
  plan_7: '方案七',
  plan_8: '方案八',
};
Object.keys(planTypeStats)
  .sort()
  .forEach(function (k) {
    var s = planTypeStats[k];
    console.log(
      planNames[k] || k,
      '\t总数=' + s.total,
      '\t命中=' + s.won,
      '\t命中率=' + (s.total > 0 ? ((s.won / s.total) * 100).toFixed(1) + '%' : '-'),
      '\t盈利=' + s.profit,
    );
  });

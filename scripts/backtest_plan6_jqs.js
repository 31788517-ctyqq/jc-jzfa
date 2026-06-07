/**
 * 方案六回测 — 总进球2、3球 (JQS) — 3D网格搜索版
 * 
 * 规则:
 *   方向: 总进球-2、3球 (Dutch 双选，任一命中即赢)
 *   决胜: L1 方向专家数（平局按遍历顺序取第一个）
 *   赔率缺失: 不生成方案
 *   投注额: 1000 元/期
 * 
 * 网格搜索: 遍历 [日比赛门槛] × [赔率下限]（专家门槛已知无效，固定为1）
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'server', 'data.json');
const ODDS_DIR = path.join(__dirname, '..', 'server', 'odds_history');
const AMOUNT = 1000;
const START_DATE = '2026-03-19';

// ★ 方案六方向 — 总进球
const PLAN6_DIRECTION = '总进球-2、3球';
const TARGET_PARTS = ['总进球-2', '总进球-3'];

// ── 网格搜索范围 ──
const DAY_RANGE  = process.argv[2] ? [parseInt(process.argv[2])] : [2];   // 默认盈利组合: 日≥2
const ODDS_RANGE = process.argv[3] ? [parseFloat(process.argv[3])] : [1.8]; // 默认盈利组合: 合赔≥1.8

// ── 赔率提取 ──
function extractIndividualOdds(oddsObj, direction) {
  if (!oddsObj) return [];
  if (direction.indexOf('总进球-') === 0) {
    const tg = oddsObj.totalGoals;
    if (!tg) return [];
    const nums = direction.replace('总进球-', '').split(/[、,]/);
    const vals = [];
    for (const n of nums) {
      const v = n.replace(/球/g, '').trim();
      if (tg[v] !== undefined) vals.push(tg[v]);
    }
    return vals;
  }
  return [];
}

function dutchOdds(subOdds) {
  if (subOdds.length === 0) return 0;
  if (subOdds.length === 1) return subOdds[0];
  const invSum = subOdds.reduce((s, o) => s + 1 / o, 0);
  return invSum > 0 ? 1 / invSum : 0;
}

// ── 赛果判定 ──
function extractRecResult(recs, direction) {
  const subDirs = direction.split(/[、,]/);
  let anyWon = false, anyLose = false, anyUnknown = false;

  for (const sd of subDirs) {
    const s = sd.trim();
    let found = false;
    for (const r of recs) {
      if (r.type === s) {
        found = true;
        if (r.result === 1) anyWon = true;
        else if (r.result === 0) anyLose = true;
        else anyUnknown = true;
        break;
      }
    }
    if (!found) {
      for (const r of recs) {
        const recSubs = (r.type || '').split(/[、,]/);
        if (recSubs.some(rs => rs.trim() === s)) {
          found = true;
          if (r.result === 1) anyWon = true;
          else if (r.result === 0) anyLose = true;
          else anyUnknown = true;
          break;
        }
      }
    }
    if (!found) anyUnknown = true;
  }

  if (anyUnknown) return { won: null };
  if (anyWon) return { won: true };
  return { won: !anyLose };
}

function hasTG23Odds(oddsObj) {
  if (!oddsObj || !oddsObj.totalGoals) return false;
  const tg = oddsObj.totalGoals;
  return tg['2'] != null && tg['3'] != null;
}

// ── 回测核心函数 ──
function runBacktest(minDayMatches, minExpertCount, minDutchOdds) {
  const results = [];
  let totalPlan6 = 0, totalWon = 0, totalIncome = 0;
  let skippedNoOdds = 0, skippedLowExpert = 0, skippedLowDay = 0;

  for (const ds of allDates) {
    const mList = dateMap[ds];
    const dayMatchCount = mList.length;

    if (dayMatchCount < minDayMatches) { skippedLowDay++; continue; }

    const matchDataMap = {};
    for (const mm of mList) {
      const recsRaw = rMap[String(mm.matchId)] || [];
      const recs = recsRaw.map((x) => ({
        type: x.t || x.type || '',
        num: x.n || x.num || 0,
        result: (x.rs === 0 || x.rs === 1) ? x.rs : null,
      }));
      const oddsObjRaw = getOddsForMatch(ds, mm.num || '');
      let oddsObj = null;
      if (oddsObjRaw) {
        oddsObj = {
          spf: oddsObjRaw.spf || null,
          rqspf: oddsObjRaw.rqspf || null,
          totalGoals: oddsObjRaw.totalGoals || null,
          halfFull: oddsObjRaw.halfFull || null,
          isSingleGame: oddsObjRaw.isSingleGame || false,
        };
      }
      matchDataMap[mm.matchId] = { match: mm, recs, odds: oddsObj };
    }

    // ★ L1 方向专家数决胜
    let bestM6 = null, bestCount6 = 0;

    for (const mm of mList) {
      const md = matchDataMap[mm.matchId];
      if (!md) continue;
      if (!hasTG23Odds(md.odds)) continue;

      let total6 = 0;
      for (const r of md.recs) {
        const rn = r.num || 0;
        for (const tp of TARGET_PARTS) {
          if ((r.type || '').indexOf(tp) >= 0) total6 += rn;
        }
      }

      if (total6 > bestCount6) {
        bestCount6 = total6;
        bestM6 = mm;
      }
    }

    if (bestCount6 < minExpertCount) { skippedLowExpert++; continue; }

    // 赔率检查
    const md6 = matchDataMap[bestM6 ? bestM6.matchId : ''];
    const odds6 = extractIndividualOdds(md6 ? md6.odds : null, PLAN6_DIRECTION);
    const eff6 = dutchOdds(odds6);
    if (odds6.length < 2 || eff6 <= 0) { skippedNoOdds++; continue; }
    if (eff6 < minDutchOdds) { skippedNoOdds++; continue; }

    // 赛果判定
    const recs6 = md6 ? md6.recs : [];
    const result = extractRecResult(recs6, PLAN6_DIRECTION);

    let won = false;
    if (result.won === true) won = true;
    else if (result.won === null) continue;

    totalPlan6++;
    let prize = 0;
    if (won) {
      totalWon++;
      prize = Math.round(AMOUNT * eff6);
      totalIncome += prize - AMOUNT;
    } else {
      totalIncome -= AMOUNT;
    }

    const home = (bestM6.homeName || '').slice(0, 6);
    const visit = (bestM6.visitName || '').slice(0, 6);
    results.push({
      date: ds, num: bestM6.num || '', matchId: bestM6.matchId,
      home, visit,
      expertCount6: bestCount6,
      oddsEff: eff6.toFixed(2), won, profit: won ? (prize - AMOUNT) : -AMOUNT,
    });
  }

  const winRate = totalPlan6 > 0 ? (totalWon / totalPlan6 * 100).toFixed(1) : '0.0';
  return { totalPlan6, totalWon, winRate, totalIncome, skippedLowDay, skippedLowExpert, skippedNoOdds, results };
}

// ══════════════════════════════════════════════════════════════
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║   📊 方案六3D网格 — 日门槛 × 赔率下限 (L1单级决胜)          ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('  方向: ' + PLAN6_DIRECTION + ' (Dutch双选)');
console.log('  专家门槛: 1 (已知无效，固定)');
console.log('  日比赛门槛范围: ' + JSON.stringify(DAY_RANGE));
console.log('  赔率下限范围: ' + JSON.stringify(ODDS_RANGE));
console.log('');

// ── 加载数据 ──
console.log('[1/2] Loading data...');
const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const mMap = raw.m || {};
const rMap = raw.r || {};

const dateMap = {};
Object.keys(mMap).forEach((k) => {
  const m = mMap[k];
  const ds = (m.date || '').slice(0, 10);
  if (!ds || ds < START_DATE) return;
  if (!dateMap[ds]) dateMap[ds] = [];
  dateMap[ds].push(m);
});
const allDates = Object.keys(dateMap).sort();
console.log('  data.json: ' + allDates.length + ' days, ' + allDates[0] + ' ~ ' + allDates[allDates.length - 1]);

const oddsCache = {};
let oddsLoaded = 0;
for (const ds of allDates) {
  const file = path.join(ODDS_DIR, ds + '.json');
  if (fs.existsSync(file)) {
    try { oddsCache[ds] = JSON.parse(fs.readFileSync(file, 'utf8')); oddsLoaded++; }
    catch (e) { /* skip */ }
  }
}
console.log('  odds_history: ' + oddsLoaded + '/' + allDates.length + ' days loaded');

function getOddsForMatch(ds, matchNum) {
  const od = oddsCache[ds];
  if (!od || !od.odds) return null;
  return od.odds[matchNum] || null;
}

// ── 3D网格搜索 ──
console.log('\n[2/2] 3D Grid search (' + DAY_RANGE.length + '×' + ODDS_RANGE.length + ' = ' + (DAY_RANGE.length * ODDS_RANGE.length) + ' combos)...\n');

const grid = [];

for (const minDay of DAY_RANGE) {
  for (const minOdds of ODDS_RANGE) {
    const r = runBacktest(minDay, 1, minOdds);
    grid.push({
      minDay, minOdds,
      total: r.totalPlan6, won: r.totalWon,
      rate: r.winRate, income: r.totalIncome,
      skipDay: r.skippedLowDay, skipOdds: r.skippedNoOdds,
    });
  }
}

// ── 输出表格 ──
console.log('═══ 3D网格结果 (日门槛↓ 赔率下限→) ═══\n');

// 表头：赔率下限列
let header = '日≥ │';
for (const o of ODDS_RANGE) header += ' 合赔≥' + String(o.toFixed(1)).padStart(4);
console.log(header);
console.log('────┼' + '─'.repeat(ODDS_RANGE.length * 10));

let bestGrid = null;

for (const minDay of DAY_RANGE) {
  let row = String(minDay).padStart(3) + ' │';
  for (const minOdds of ODDS_RANGE) {
    const g = grid.find(x => x.minDay === minDay && x.minOdds === minOdds);
    if (g && g.total > 0) {
      const sign = g.income >= 0 ? '+' : '';
      const cell = (sign + g.income).padStart(8);
      row += ' ' + cell;
      if (g.income > 0) row += '✅';
      else row += '  ';
      if (!bestGrid || g.income > bestGrid.income) bestGrid = g;
    } else {
      row += '    ······';
    }
  }
  console.log(row);
}

// ── 汇总 ──
console.log('\n═══ 详情 (日↓ 赔率→ 期数:命中数/命中率/盈亏) ═══\n');
for (const minDay of DAY_RANGE) {
  for (const minOdds of ODDS_RANGE) {
    const g = grid.find(x => x.minDay === minDay && x.minOdds === minOdds);
    if (!g || g.total === 0) continue;
    const mark = g.income > 0 ? ' ✅' : '';
    console.log('  日≥' + String(minDay).padStart(2) + ' | 合赔≥' + String(minOdds.toFixed(1)).padStart(4) +
      ' | ' + String(g.total).padStart(3) + '期 ' +
      String(g.won).padStart(2) + '中 ' +
      String(g.rate).padStart(5) + '% ' +
      (g.income >= 0 ? '+' : '') + g.income + '元' + mark);
  }
}

// ── 最佳组合详情 ──
if (bestGrid) {
  console.log('\n═══ 🏆 最佳组合 ═══');
  console.log('  日比赛门槛 ≥ ' + bestGrid.minDay + ' 场, 合赔 ≥ ' + bestGrid.minOdds.toFixed(1));
  console.log('  期数: ' + bestGrid.total + ' | 命中: ' + bestGrid.won + ' | 命中率: ' + bestGrid.rate + '%');
  const sign = bestGrid.income >= 0 ? '+' : '';
  console.log('  累计盈亏: ' + sign + bestGrid.income + ' 元');

  const bestR = runBacktest(bestGrid.minDay, 1, bestGrid.minOdds);
  if (bestR.results.length > 0) {
    console.log('\n  ── 明细 ──');
    for (const r of bestR.results) {
      const d = r.date.slice(5);
      const n = (r.num || '').padEnd(6);
      const m = (r.home + ' vs ' + r.visit).padEnd(25);
      const e = String(r.expertCount6).padStart(4);
      const o = String(r.oddsEff).padStart(5);
      const h = r.won ? '✅' : '❌';
      const s = r.profit >= 0 ? '+' : '';
      console.log('  ' + d + '  ' + n + m + e + '   ' + o + '   ' + h + '   ' + (s + r.profit).padStart(8));
    }
  }
}

console.log('\n══════════════════════════════════════════════════════════════');

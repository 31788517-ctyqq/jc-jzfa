/**
 * 方案二回测 — 总进球-2、3球 × 让负 (2串1) — 3D网格搜索版
 *
 * 规则:
 *   场次1: 总进球-2、3球 (Dutch 双选)
 *   场次2: 让负 (单选项)
 *   投注: 2串1, 两项都中才赢
 *   投注额: 1000 元/期
 *   决胜: L1 方向专家数
 *
 * 网格搜索: [日比赛门槛] × [合赔下限(product)] × [专家门槛]
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'server', 'data.json');
const ODDS_DIR = path.join(__dirname, '..', 'server', 'odds_history');
const AMOUNT = 1000;
const START_DATE = '2026-03-19';

// ★ 方案二方向
const DIR_A = '总进球-2、3球'; // 场次1 精确匹配（独立方向，非两个方向的组合）
const DIR_B = '让负'; // 场次2 精确匹配

// ── 网格搜索范围 ──
const DAY_RANGE = process.argv[2] ? [parseInt(process.argv[2])] : [2, 3, 4, 5, 6, 7, 8, 9, 10];
const ODDS_RANGE = process.argv[3] ? [parseFloat(process.argv[3])] : [1.0, 1.3, 1.5, 1.8, 2.0, 2.3, 2.5, 2.8, 3.0];

// ── 赔率提取 ──
function extractOdds(oddsObj, direction) {
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
  if (direction === '让负') {
    const rq = oddsObj.rqspf;
    if (rq && rq.away !== undefined) return [rq.away];
    return [];
  }
  return [];
}

function dutchOdds(subOdds) {
  if (subOdds.length === 0) return 0;
  if (subOdds.length === 1) return subOdds[0];
  const invSum = subOdds.reduce((s, o) => s + 1 / o, 0);
  return invSum > 0 ? 1 / invSum : 0;
}

// ── 赔率存在检查 ──
function hasTG23Odds(oddsObj) {
  if (!oddsObj || !oddsObj.totalGoals) return false;
  const tg = oddsObj.totalGoals;
  return tg['2'] != null && tg['3'] != null;
}

function hasRqspfAwayOdds(oddsObj) {
  if (!oddsObj || !oddsObj.rqspf) return false;
  return oddsObj.rqspf.away != null;
}

// ── 赛果判定 ──
function extractRecResult(recs, direction, matchScore) {
  // 单选项
  if (direction === '让负') {
    for (const r of recs) {
      if (r.type === '让负') {
        if (r.result === 1) return { won: true };
        if (r.result === 0) return { won: false };
        return { won: null };
      }
    }
    return { won: null };
  }
  // 多选项 (总进球-2、3球): 优先用比分判定
  const subDirs = direction.split(/[、,]/);

  // ★ 有比分时: 用实际总进球判定，比分是 ground truth
  if (matchScore) {
    const parts = String(matchScore).split(':');
    const totalGoals = parseInt(parts[0]) + parseInt(parts[1]);
    if (!isNaN(totalGoals)) {
      for (const sd of subDirs) {
        const s = sd.trim();
        const goalMatch = s.match(/(\d+)/);
        if (goalMatch && parseInt(goalMatch[1]) === totalGoals) return { won: true };
      }
      return { won: false };
    }
  }

  // 无比分时: 回退 rec 匹配
  let anyWon = false,
    anyLose = false,
    anyUnknown = false;
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
        if (recSubs.some((rs) => rs.trim() === s)) {
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

// ── 回测核心函数 ──
function runBacktest(minDayMatches, minProdOdds) {
  const results = [];
  let totalP2 = 0,
    totalWon = 0,
    totalIncome = 0;
  let skipA = 0,
    skipB = 0,
    skipOdds = 0,
    skipDay = 0;

  for (const ds of allDates) {
    const mList = dateMap[ds];
    const dayMatchCount = mList.length;
    if (dayMatchCount < minDayMatches) {
      skipDay++;
      continue;
    }

    const matchDataMap = {};
    for (const mm of mList) {
      const recsRaw = rMap['m_' + mm.matchId] || rMap[String(mm.matchId)] || [];
      const recs = recsRaw.map((x) => {
        const rawRes = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
        return {
          type: x.t || x.type || '',
          num: x.n || x.num || 0,
          result: rawRes === 0 || rawRes === 1 ? rawRes : null,
        };
      });
      const oddsObjRaw = getOddsForMatch(ds, mm.num || '');
      let oddsObj = null;
      if (oddsObjRaw) {
        oddsObj = {
          spf: oddsObjRaw.spf || null,
          rqspf: oddsObjRaw.rqspf || null,
          totalGoals: oddsObjRaw.totalGoals || null,
          halfFull: oddsObjRaw.halfFull || null,
        };
      }
      matchDataMap[mm.matchId] = { match: mm, recs, odds: oddsObj };
    }

    // ── 场次A：总进球-2、3球 方向专家最多的一场 ──
    let bestMA = null,
      bestCountA = 0;
    for (const mm of mList) {
      const md = matchDataMap[mm.matchId];
      if (!md) continue;
      if (!hasTG23Odds(md.odds)) continue;
      let totalA = 0;
      for (const r of md.recs) {
        if (r.type === DIR_A) totalA += r.num || 0;
      }
      if (totalA > bestCountA) {
        bestCountA = totalA;
        bestMA = mm;
      }
    }
    if (!bestMA) {
      skipA++;
      continue;
    }

    // ── 场次B：让负 方向专家最多的一场（排除场次A） ──
    let bestMB = null,
      bestCountB = 0;
    for (const mm of mList) {
      if (mm.matchId === bestMA.matchId) continue;
      const md = matchDataMap[mm.matchId];
      if (!md) continue;
      if (!hasRqspfAwayOdds(md.odds)) continue;
      let totalB = 0;
      for (const r of md.recs) {
        if (r.type === '让负') totalB += r.num || 0;
      }
      if (totalB > bestCountB) {
        bestCountB = totalB;
        bestMB = mm;
      }
    }
    if (!bestMB) {
      skipB++;
      continue;
    }

    // ── 赔率计算 ──
    const mdA = matchDataMap[bestMA.matchId];
    const mdB = matchDataMap[bestMB.matchId];
    const odA = extractOdds(mdA ? mdA.odds : null, '总进球-2、3球');
    const odB = extractOdds(mdB ? mdB.odds : null, '让负');

    if (odA.length < 2 || odB.length < 1) {
      skipOdds++;
      continue;
    }

    const ddA = dutchOdds(odA);
    const ddB = odB[0];
    if (ddA <= 0 || ddB <= 0) {
      skipOdds++;
      continue;
    }

    const productOdds = ddA * ddB;
    if (productOdds < minProdOdds) {
      skipOdds++;
      continue;
    }

    // ── 赛果判定 ──
    const recsA = mdA ? mdA.recs : [];
    const recsB = mdB ? mdB.recs : [];
    const scoreA = bestMA && bestMA.score ? bestMA.score : null;
    const resultA = extractRecResult(recsA, '总进球-2、3球', scoreA);
    const resultB = extractRecResult(recsB, '让负');

    if (resultA.won === null || resultB.won === null) continue;

    const won = resultA.won && resultB.won;

    totalP2++;
    let prize = 0;
    if (won) {
      totalWon++;
      prize = Math.round(AMOUNT * ddA * ddB);
      totalIncome += prize - AMOUNT;
    } else {
      totalIncome -= AMOUNT;
    }

    const homeA = (bestMA.homeName || '').slice(0, 6);
    const visitA = (bestMA.visitName || '').slice(0, 6);
    const homeB = (bestMB.homeName || '').slice(0, 6);
    const visitB = (bestMB.visitName || '').slice(0, 6);
    results.push({
      date: ds,
      numA: bestMA.num || '',
      numB: bestMB.num || '',
      matchA: homeA + ' vs ' + visitA,
      matchB: homeB + ' vs ' + visitB,
      expertA: bestCountA,
      expertB: bestCountB,
      ddA: ddA.toFixed(2),
      ddB: ddB.toFixed(2),
      product: productOdds.toFixed(2),
      won,
      profit: won ? prize - AMOUNT : -AMOUNT,
    });
  }

  const winRate = totalP2 > 0 ? ((totalWon / totalP2) * 100).toFixed(1) : '0.0';
  return { totalP2, totalWon, winRate, totalIncome, skipDay, skipA, skipB, skipOdds, results };
}

// ══════════════════════════════════════════════════════════════
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║   📊 方案二3D网格 — 日门槛 × 2串1合赔下限                    ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('  场次1: 总进球-2、3球 (Dutch双选)');
console.log('  场次2: 让负 (单选项)');
console.log('  投注: 2串1, 两项都中才赢');
console.log('  日比赛门槛范围: ' + JSON.stringify(DAY_RANGE));
console.log('  合赔下限范围: ' + JSON.stringify(ODDS_RANGE));
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
    try {
      oddsCache[ds] = JSON.parse(fs.readFileSync(file, 'utf8'));
      oddsLoaded++;
    } catch (e) {
      /* skip */
    }
  }
}
console.log('  odds_history: ' + oddsLoaded + '/' + allDates.length + ' days loaded');

function getOddsForMatch(ds, matchNum) {
  const od = oddsCache[ds];
  if (!od || !od.odds) return null;
  return od.odds[matchNum] || null;
}

// ── 网格搜索 ──
console.log(
  '\n[2/2] Grid search (' +
    DAY_RANGE.length +
    '×' +
    ODDS_RANGE.length +
    ' = ' +
    DAY_RANGE.length * ODDS_RANGE.length +
    ' combos)...\n',
);

const grid = [];
for (const minDay of DAY_RANGE) {
  for (const minOdds of ODDS_RANGE) {
    const r = runBacktest(minDay, minOdds);
    grid.push({
      minDay,
      minOdds,
      total: r.totalP2,
      won: r.totalWon,
      rate: r.winRate,
      income: r.totalIncome,
      skipDay: r.skipDay,
      skipOdds: r.skipOdds,
    });
  }
}

// ── 输出矩阵 ──
console.log('═══ 3D网格 (日门槛↓ 合赔下限→) ═══\n');
let header = '日≥ │';
for (const o of ODDS_RANGE) header += ' 合赔≥' + String(o.toFixed(1)).padStart(5);
console.log(header);
console.log('────┼' + '─'.repeat(ODDS_RANGE.length * 11));

let bestGrid = null;
for (const minDay of DAY_RANGE) {
  let row = String(minDay).padStart(3) + ' │';
  for (const minOdds of ODDS_RANGE) {
    const g = grid.find((x) => x.minDay === minDay && x.minOdds === minOdds);
    if (g && g.total > 0) {
      const sign = g.income >= 0 ? '+' : '';
      const cell = (sign + g.income).padStart(9);
      row += ' ' + cell + (g.income > 0 ? '✅' : '  ');
      if (!bestGrid || g.income > bestGrid.income) bestGrid = g;
    } else {
      row += '    ······· ';
    }
  }
  console.log(row);
}

// ── 详情 ──
console.log('\n═══ 详情 ═══\n');
for (const minDay of DAY_RANGE) {
  for (const minOdds of ODDS_RANGE) {
    const g = grid.find((x) => x.minDay === minDay && x.minOdds === minOdds);
    if (!g || g.total === 0) continue;
    const mark = g.income > 0 ? ' ✅' : '';
    console.log(
      '  日≥' +
        String(minDay).padStart(2) +
        ' | 合赔≥' +
        String(minOdds.toFixed(1)).padStart(5) +
        ' | ' +
        String(g.total).padStart(3) +
        '期 ' +
        String(g.won).padStart(2) +
        '中 ' +
        String(g.rate).padStart(5) +
        '% ' +
        (g.income >= 0 ? '+' : '') +
        g.income +
        '元' +
        mark,
    );
  }
}

// ── 最佳组合 ──
if (bestGrid) {
  console.log('\n═══ 🏆 最佳组合 ═══');
  console.log('  日比赛门槛 ≥ ' + bestGrid.minDay + ' 场, 合赔 ≥ ' + bestGrid.minOdds.toFixed(1));
  console.log('  期数: ' + bestGrid.total + ' | 命中: ' + bestGrid.won + ' | 命中率: ' + bestGrid.rate + '%');
  console.log('  累计盈亏: ' + (bestGrid.income >= 0 ? '+' : '') + bestGrid.income + ' 元');

  const bestR = runBacktest(bestGrid.minDay, bestGrid.minOdds);
  if (bestR.results.length > 0) {
    console.log('\n  ── 明细 ──');
    console.log(
      '  日期     场次A(总进球2,3球)            场次B(让负)                  专家A 合赔A 专家B 赔率B 合赔积  命中  盈亏',
    );
    console.log('  ' + '─'.repeat(98));
    for (const r of bestR.results) {
      const d = r.date.slice(5);
      const mA = r.matchA.padEnd(28);
      const mB = r.matchB.padEnd(28);
      const ea = String(r.expertA).padStart(5);
      const da = String(r.ddA).padStart(5);
      const eb = String(r.expertB).padStart(5);
      const db = String(r.ddB).padStart(5);
      const prod = String(r.product).padStart(6);
      const h = r.won ? '✅' : '❌';
      const s = r.profit >= 0 ? '+' : '';
      console.log(
        '  ' +
          d +
          '  ' +
          mA +
          mB +
          ea +
          ' ' +
          da +
          eb +
          ' ' +
          db +
          ' ' +
          prod +
          '  ' +
          h +
          '  ' +
          (s + r.profit).padStart(8),
      );
    }
  }
}

console.log('\n══════════════════════════════════════════════════════════════');

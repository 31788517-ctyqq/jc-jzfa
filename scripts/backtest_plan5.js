/**
 * 方案五回测 — 平、让平 × 总进球-2、3球 (2串1) — 3D网格搜索版
 * 
 * 规则:
 *   场次1: 平、让平 (Dutch 混合双选: SPF-平 + RQSPF-让平)
 *   场次2: 总进球-2、3球 (Dutch 双选)
 *   投注: 2串1, 两项都中才赢
 *   投注额: 1000 元/期
 *   决胜: L1 方向专家数
 *   多方案变体: 备选场次组合生成更多方案
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'server', 'data.json');
const ODDS_DIR = path.join(__dirname, '..', 'server', 'odds_history');
const AMOUNT = 1000;
const START_DATE = '2026-03-19';

// ★ 方案五方向
const DIR_A = ['平', '让平'];  // 场次1: Dutch 混合双选
const DIR_B_SINGLE = '总进球-2、3球';  // 场次2: Dutch 双选

// ── 网格搜索范围 ──
const DAY_RANGE   = process.argv[2] ? [parseInt(process.argv[2])] : [2,3,4,5,6,7,8,9,10];
const ODDS_RANGE  = process.argv[3] ? [parseFloat(process.argv[3])] : [1.0, 1.3, 1.5, 1.8, 2.0, 2.3, 2.5, 2.8, 3.0];
const VARIANT_MAX = 1;  // ★ 最多生成几个方案变体（临时改为1验证单方案盈利）

// ── 赔率提取 ──
function extractOdds(oddsObj, direction) {
  if (!oddsObj) return [];
  
  // 总进球方向
  if (typeof direction === 'string' && direction.indexOf('总进球-') === 0) {
    const tg = oddsObj.totalGoals;
    if (!tg) return [];
    const nums = direction.replace('总进球-', '').split(/[、,]/);
    const vals = [];
    for (const n of nums) {
      const v = n.replace(/球/g, '').trim();
      if (tg[v] !== undefined && tg[v] !== null && tg[v] > 0) vals.push(tg[v]);
    }
    return vals;
  }
  return [];
}

function extractMultiOdds(oddsObj, dirs) {
  if (!oddsObj) return [];
  const vals = [];
  for (const d of dirs) {
    if (d === '平') {
      if (oddsObj.spf && oddsObj.spf.draw != null && oddsObj.spf.draw > 0) vals.push(oddsObj.spf.draw);
    } else if (d === '让平') {
      if (oddsObj.rqspf && oddsObj.rqspf.draw != null && oddsObj.rqspf.draw > 0) vals.push(oddsObj.rqspf.draw);
    }
  }
  return vals;
}

function dutchOdds(subOdds) {
  if (subOdds.length === 0) return 0;
  if (subOdds.length === 1) return subOdds[0];
  const invSum = subOdds.reduce((s, o) => s + 1 / o, 0);
  return invSum > 0 ? 1 / invSum : 0;
}

// ── 赔率存在检查 ──
function hasMultiOdds(oddsObj, dirs) {
  if (!oddsObj) return false;
  for (const d of dirs) {
    if (d === '平') {
      if (oddsObj.spf && oddsObj.spf.draw != null && oddsObj.spf.draw > 0) return true;
    } else if (d === '让平') {
      if (oddsObj.rqspf && oddsObj.rqspf.draw != null && oddsObj.rqspf.draw > 0) return true;
    }
  }
  return false;
}

function hasTG23Odds(oddsObj) {
  if (!oddsObj || !oddsObj.totalGoals) return false;
  const tg = oddsObj.totalGoals;
  return tg['2'] != null && tg['2'] > 0 && tg['3'] != null && tg['3'] > 0;
}

// ── 赛果判定 ──
function extractMultiResult(recs, dirs, matchScore) {
  let anyWon = false, anyLose = false, anyUnknown = false;
  
  for (const d of dirs) {
    let found = false;
    for (const r of recs) {
      if (r.type === d) {
        found = true;
        if (r.result === 1) anyWon = true;
        else if (r.result === 0) anyLose = true;
        else anyUnknown = true;
        break;
      }
    }
    if (!found) anyUnknown = true;
  }
  
  if (anyUnknown) return { won: null };
  if (anyWon) return { won: true };
  return { won: false };
}

function extractRecResult(recs, direction, matchScore) {
  // 总进球判定
  if (typeof direction === 'string' && direction.indexOf('总进球-') === 0) {
    const subDirs = direction.split(/[、,]/);
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
    // 回退rec匹配
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
      if (!found) anyUnknown = true;
    }
    if (anyUnknown) return { won: null };
    return { won: anyWon };
  }
  return { won: null };
}

// ── 回测核心函数 (支持多变体) ──
function runBacktest(minDayMatches, minProdOdds) {
  let totalSchemes = 0, totalWon = 0, totalIncome = 0;
  let skipDay = 0, skipData = 0, skipOdds = 0;
  let variantCount = 0;

  for (const ds of allDates) {
    const mList = dateMap[ds];
    if (mList.length < minDayMatches) { skipDay++; continue; }

    // ── 构建比赛数据 ──
    const matchDataMap = {};
    for (const mm of mList) {
      const recsRaw = rMap['m_' + mm.matchId] || rMap[String(mm.matchId)] || [];
      const recs = recsRaw.map((x) => {
        const rawRes = x.rs !== undefined ? x.rs : (x.result !== undefined ? x.result : null);
        return {
          type: x.t || x.type || '',
          num: x.n || x.num || 0,
          result: (rawRes === 0 || rawRes === 1) ? rawRes : null,
        };
      });
      const oddsObjRaw = getOddsForMatch(ds, mm.num || '');
      let oddsObj = null;
      if (oddsObjRaw) {
        oddsObj = {
          spf: oddsObjRaw.spf || null,
          rqspf: oddsObjRaw.rqspf || null,
          totalGoals: oddsObjRaw.totalGoals || null,
        };
      }
      matchDataMap[mm.matchId] = { match: mm, recs, odds: oddsObj };
    }

    // ── 收集场次A候选 (平、让平) ──
    const candidatesA = [];
    for (const mm of mList) {
      const md = matchDataMap[mm.matchId];
      if (!md || !hasMultiOdds(md.odds, DIR_A)) continue;
      let totalA = 0;
      for (const d of DIR_A) {
        for (const r of md.recs) {
          if (r.type === d) totalA += r.num || 0;
        }
      }
      if (totalA > 0) {
        const ods = extractMultiOdds(md.odds, DIR_A);
        const dd = dutchOdds(ods);
        candidatesA.push({ match: mm, data: md, expertCount: totalA, dutchOdds: dd });
      }
    }
    if (candidatesA.length === 0) { skipData++; continue; }
    candidatesA.sort((a, b) => b.expertCount - a.expertCount);

    // ── 收集场次B候选 (总进球-2、3球) ──
    const candidatesB = [];
    for (const mm of mList) {
      const md = matchDataMap[mm.matchId];
      if (!md || !hasTG23Odds(md.odds)) continue;
      let totalB = 0;
      for (const r of md.recs) {
        if (r.type === DIR_B_SINGLE) totalB += r.num || 0;
      }
      if (totalB > 0) {
        const ods = extractOdds(md.odds, DIR_B_SINGLE);
        const dd = dutchOdds(ods);
        candidatesB.push({ match: mm, data: md, expertCount: totalB, dutchOdds: dd });
      }
    }
    if (candidatesB.length === 0) { skipData++; continue; }
    candidatesB.sort((a, b) => b.expertCount - a.expertCount);

    // ── 生成方案变体: 交叉配对 ──
    let daySchemeCount = 0;
    const usedPairs = new Set();
    
    for (let ai = 0; ai < Math.min(candidatesA.length, VARIANT_MAX); ai++) {
      for (let bi = 0; bi < Math.min(candidatesB.length, VARIANT_MAX); bi++) {
        if (daySchemeCount >= VARIANT_MAX) break;
        
        const ca = candidatesA[ai];
        const cb = candidatesB[bi];
        
        // 不能是同一场
        if (ca.match.matchId === cb.match.matchId) continue;
        
        const pairKey = ca.match.matchId + '_' + cb.match.matchId;
        if (usedPairs.has(pairKey)) continue;
        usedPairs.add(pairKey);

        const productOdds = ca.dutchOdds * cb.dutchOdds;
        if (productOdds < minProdOdds) continue;
        if (ca.dutchOdds <= 1.0 || cb.dutchOdds <= 1.0) continue;

        // ── 赛果判定 ──
        const resultA = extractMultiResult(ca.data.recs, DIR_A, ca.match.score);
        const resultB = extractRecResult(cb.data.recs, DIR_B_SINGLE, cb.match.score);

        if (resultA.won === null || resultB.won === null) continue;

        const won = resultA.won && resultB.won;
        totalSchemes++;
        daySchemeCount++;
        variantCount++;

        if (won) {
          totalWon++;
          const prize = Math.round(AMOUNT * productOdds);
          totalIncome += prize - AMOUNT;
        } else {
          totalIncome -= AMOUNT;
        }
      }
    }

    if (daySchemeCount === 0) skipOdds++;
  }

  const winRate = totalSchemes > 0 ? (totalWon / totalSchemes * 100).toFixed(1) : '0.0';
  return { totalSchemes, totalWon, winRate, totalIncome, skipDay, skipData, skipOdds, variantCount };
}

// ══════════════════════════════════════════════════════════════
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║   📊 方案五3D网格 — 日门槛 × 2串1合赔下限 × 多方案变体        ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('  场次1: 平、让平 (Dutch混合双选: SPF-平 + RQSPF-让平)');
console.log('  场次2: 总进球-2、3球 (Dutch双选)');
console.log('  投注: 2串1, 两项都中才赢');
console.log('  变体: 最高 ' + VARIANT_MAX + ' 个方案/天 (交叉配对最佳候选)');
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

// ── 网格搜索 ──
console.log('\n[2/2] Grid search (' + DAY_RANGE.length + '×' + ODDS_RANGE.length + ' = ' + (DAY_RANGE.length * ODDS_RANGE.length) + ' combos)...\n');

const grid = [];
for (const minDay of DAY_RANGE) {
  for (const minOdds of ODDS_RANGE) {
    const r = runBacktest(minDay, minOdds);
    grid.push({
      minDay, minOdds,
      total: r.totalSchemes, won: r.totalWon,
      rate: r.winRate, income: r.totalIncome,
      skipDay: r.skipDay, skipData: r.skipData, skipOdds: r.skipOdds,
    });
  }
}

// ── 排序: 收入降序, 命中率降序 ──
grid.sort((a, b) => {
  if (b.income !== a.income) return b.income - a.income;
  return parseFloat(b.rate) - parseFloat(a.rate);
});

console.log('┌──────────┬──────────┬─────────┬─────────┬─────────┬───────────┬──────────┐');
console.log('│  日门槛  │  合赔下限│  方案数 │  命中数 │  命中率 │  净收入   │  跳过天数│');
console.log('├──────────┼──────────┼─────────┼─────────┼─────────┼───────────┼──────────┤');

for (let i = 0; i < Math.min(grid.length, 30); i++) {
  const g = grid[i];
  const incomeStr = (g.income > 0 ? '+' : '') + g.income.toLocaleString();
  console.log(
    '│' + String(g.minDay).padStart(9) +
    ' │' + g.minOdds.toFixed(1).padStart(9) +
    ' │' + String(g.total).padStart(8) +
    ' │' + String(g.won).padStart(8) +
    ' │' + String(g.rate + '%').padStart(8) +
    ' │' + String(incomeStr).padStart(10) +
    ' │' + String(g.skipDay + g.skipData + g.skipOdds).padStart(9) + ' │');
}
console.log('└──────────┴──────────┴─────────┴─────────┴─────────┴───────────┴──────────┘');
console.log('');

// ── 推荐 ──
const best = grid[0];
const positive = grid.filter(g => g.income >= 0 && g.total >= 5);
positive.sort((a, b) => b.total - a.total);

console.log('═══ 推荐参数（盈利能力优先） ═══');
if (best) {
  console.log('  最优: 日门槛=' + best.minDay + ' 合赔下限=' + best.minOdds.toFixed(1));
  console.log('  方案数=' + best.total + ' 命中=' + best.won + ' 命中率=' + best.rate + '% 净收入=' + (best.income > 0 ? '+' : '') + best.income.toLocaleString());
}
if (positive.length > 0) {
  const p = positive[0];
  console.log('');
  console.log('  推荐(方案数优先): 日门槛=' + p.minDay + ' 合赔下限=' + p.minOdds.toFixed(1));
  console.log('  方案数=' + p.total + ' 命中=' + p.won + ' 命中率=' + p.rate + '% 净收入=' + (p.income > 0 ? '+' : '') + p.income.toLocaleString());
}
console.log('');
console.log('✅ 可通过命令行参数固定参数: node scripts/backtest_plan5.js <日门槛> <合赔下限>');

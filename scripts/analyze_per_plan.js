/**
 * scripts/analyze_per_plan.js
 *
 * 按方案独立分析盈亏 + 方案六参数网格扫描
 *
 * 用户需求：
 *   1. 验证每个方案（尤其是方案六）是否独立盈利
 *   2. 以方案数量为优先条件，盈利为第二条件
 *   3. 在保障盈利的情况下，生成最多的方案数
 *
 * 用法: node scripts/analyze_per_plan.js
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'server', 'data.json');
const ODDS_DIR = path.join(__dirname, '..', 'server', 'odds_history');
const AMOUNT = 1000;

// ── 工具函数 ──
function fmtDate2(dd) {
  return (
    dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0')
  );
}

// ── 加载 data.json ──
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║          📊 按方案独立参数探测（方案六聚焦）                  ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('[1/5] Loading data.json...');
const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const mMap = raw.m || {};
const rMap = raw.r || {};

// ── 构建日期索引 ──
const dateMap = {};
Object.keys(mMap).forEach((k) => {
  const m = mMap[k];
  const ds = (m.date || '').slice(0, 10);
  if (!ds) return;
  if (!dateMap[ds]) dateMap[ds] = [];
  dateMap[ds].push(m);
});
const allDates = Object.keys(dateMap).sort();
console.log('  dates:', allDates.length, 'matches:', Object.keys(mMap).length);

// ── 预加载 odds_history ──
console.log('[2/5] Loading odds_history...');
const oddsCache = {};
let oddsLoaded = 0;
for (const ds of allDates) {
  const file = path.join(ODDS_DIR, ds + '.json');
  if (fs.existsSync(file)) {
    try {
      const od = JSON.parse(fs.readFileSync(file, 'utf8'));
      oddsCache[ds] = od;
      oddsLoaded++;
    } catch (e) {
      /* skip */
    }
  }
}
console.log('  loaded:', oddsLoaded, '/', allDates.length);

function getOddsForMatch(ds, matchNum) {
  const od = oddsCache[ds];
  if (!od || !od.odds) return null;
  return od.odds[matchNum] || null;
}

// ── 赔率提取函数 ──
function extractOddsVal(oddsObj, direction) {
  if (!oddsObj) return null;
  if (direction === '平') return oddsObj.spf ? oddsObj.spf.draw : null;
  if (direction === '让平') return oddsObj.rqspf ? oddsObj.rqspf.draw : null;
  if (direction === '让负') return oddsObj.rqspf ? oddsObj.rqspf.away : null;
  if (direction === '让胜') return oddsObj.rqspf ? oddsObj.rqspf.home : null;
  if (direction === '胜') return oddsObj.spf ? oddsObj.spf.home : null;
  if (direction === '负') return oddsObj.spf ? oddsObj.spf.away : null;
  const hfMap = {
    胜胜: 'hh',
    平胜: 'dh',
    胜负: 'ha',
    胜平: 'hd',
    平平: 'dd',
    平负: 'da',
    负胜: 'ah',
    负平: 'ad',
    负负: 'aa',
  };
  if (direction.indexOf('半全场-') === 0 && oddsObj.halfFull) {
    const hfName = direction.replace('半全场-', '');
    const hfKey = hfMap[hfName];
    if (hfKey && oddsObj.halfFull[hfKey] !== undefined) return oddsObj.halfFull[hfKey];
  }
  return null;
}

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
  if (direction.indexOf('、') >= 0 || direction.indexOf(',') >= 0) {
    const parts = direction.split(/[、,]/);
    const vals = [];
    for (const p of parts) {
      const sv = extractOddsVal(oddsObj, p.trim());
      if (sv !== null) vals.push(sv);
    }
    return vals;
  }
  const sv = extractOddsVal(oddsObj, direction);
  return sv !== null ? [sv] : [];
}

function dutchOdds(subOdds) {
  if (subOdds.length === 0) return 0;
  if (subOdds.length === 1) return subOdds[0];
  const invSum = subOdds.reduce((s, o) => s + 1 / o, 0);
  return invSum > 0 ? 1 / invSum : 0;
}

// ── 判断单个 match + direction 的赛果 ──
function extractRecResult(matchDataMap, matchId, direction) {
  const md = matchDataMap[matchId];
  const recs = md ? md.recs : [];

  const subDirs = direction.split(/[、,]/);
  let anyWon = false,
    anyLose = false,
    anyUnknown = false;

  for (const sd of subDirs) {
    const s = sd.trim();
    let found = false;
    // 精确匹配
    for (const r of recs) {
      if (r.type === s) {
        found = true;
        if (r.result === 1) anyWon = true;
        else if (r.result === 0) anyLose = true;
        else anyUnknown = true;
        break;
      }
    }
    // 拆分 rec type 匹配
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
    // 半全场特殊处理
    if (!found) {
      const hf = s.match(/^半全场-(.+)$/);
      if (hf) {
        for (const r of recs) {
          if (r.type === s || r.type === hf[1]) {
            found = true;
            if (r.result === 1) anyWon = true;
            else if (r.result === 0) anyLose = true;
            else anyUnknown = true;
            break;
          }
        }
      }
    }
    if (!found) anyUnknown = true;
  }

  if (anyUnknown) return { won: null };
  if (anyWon) return { won: true };
  return { won: !anyLose };
}

// ══════════════════════════════════════════════════════════════
// Part A: 按方案独立基线分析（保持当前线上参数不变）
// ══════════════════════════════════════════════════════════════
console.log('[3/5] Per-scheme baseline analysis (current params)...');
console.log('');

function analyzeAllSchemes(plan6DayThresh, plan6ExpertThresh, returnDetails) {
  // plan6DayThresh: dayMatchCount >= ? for 方案六
  // plan6ExpertThresh: bestCount6 >= ? for 方案六

  const planStats = {
    plan_1: { total: 0, won: 0, income: 0, details: [] },
    plan_2: { total: 0, won: 0, income: 0, details: [] },
    plan_3: { total: 0, won: 0, income: 0, details: [] },
    plan_4: { total: 0, won: 0, income: 0, details: [] },
    plan_5: { total: 0, won: 0, income: 0, details: [] },
    plan_6: { total: 0, won: 0, income: 0, details: [] },
    plan_7: { total: 0, won: 0, income: 0, details: [] },
  };

  for (const ds of allDates) {
    const mList = dateMap[ds];
    const dayMatchCount = mList.length;

    // 构建 matchDataMap
    const matchDataMap = {};
    for (const mm of mList) {
      const recsRaw = rMap[String(mm.matchId)] || [];
      const recs = recsRaw.map((x) => ({
        type: x.t || x.type || '',
        num: x.n || x.num || 0,
        result: x.rs === 0 || x.rs === 1 ? x.rs : null,
      }));
      const num = mm.num || '';
      const oddsObjRaw = getOddsForMatch(ds, num);
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

    // findBest（与线上一致）
    function findBest(directions, excludeIds) {
      let best = null,
        bestCount = 0;
      for (const mm of mList) {
        if (excludeIds && excludeIds.indexOf(mm.matchId) >= 0) continue;
        const md = matchDataMap[mm.matchId];
        if (!md || !md.odds) continue;
        let total = 0;
        for (const r of md.recs) {
          if (directions.indexOf(r.type) >= 0) total += r.num || 0;
        }
        if (total > bestCount) {
          bestCount = total;
          best = mm;
        }
      }
      return best;
    }

    const dayPlans = [];

    // 方案一
    const m1a = findBest(['平', '让平']);
    const m1b = findBest(['让负'], m1a ? [m1a.matchId] : null);
    if (m1a && m1b)
      dayPlans.push({
        name: 'plan_1',
        matches: [
          { m: m1a, dir: '平、让平' },
          { m: m1b, dir: '让负' },
        ],
      });

    // 方案二
    const m2a = findBest(['总进球-2、3球']);
    const m2b = findBest(['让负'], m2a ? [m2a.matchId] : null);
    if (m2a && m2b)
      dayPlans.push({
        name: 'plan_2',
        matches: [
          { m: m2a, dir: '总进球-2、3球' },
          { m: m2b, dir: '让负' },
        ],
      });

    // 方案三
    const m3a = findBest(['胜']);
    const m3b = findBest(['让负'], m3a ? [m3a.matchId] : null);
    if (m3a && m3b)
      dayPlans.push({
        name: 'plan_3',
        matches: [
          { m: m3a, dir: '胜' },
          { m: m3b, dir: '让负' },
        ],
      });

    // ★ 方案六: 使用传入的参数
    if (dayMatchCount >= plan6DayThresh) {
      const targetParts = ['半全场-胜胜', '半全场-平胜'];
      let bestM6 = null,
        bestCount6 = 0;
      for (const k of Object.keys(matchDataMap)) {
        const md = matchDataMap[k];
        let total6 = 0;
        for (const r of md.recs) {
          for (const tp of targetParts) if ((r.type || '') === tp) total6 += r.num || 0;
        }
        if (total6 > bestCount6) {
          bestCount6 = total6;
          bestM6 = md.match;
        }
      }
      if (bestM6 && bestCount6 >= plan6ExpertThresh) {
        dayPlans.push({ name: 'plan_6', matches: [{ m: bestM6, dir: '半全场-胜胜、平胜' }] });
      }
    }

    // 方案四/五
    if (dayMatchCount >= 6) {
      const m4a = findBest(['平', '让平']);
      const m4b = findBest(['胜'], m4a ? [m4a.matchId] : null);
      if (m4a && m4b)
        dayPlans.push({
          name: 'plan_4',
          matches: [
            { m: m4a, dir: '平、让平' },
            { m: m4b, dir: '胜' },
          ],
        });

      const m5a = findBest(['平', '让平']);
      const m5b = findBest(['总进球-2、3球'], m5a ? [m5a.matchId] : null);
      if (m5a && m5b)
        dayPlans.push({
          name: 'plan_5',
          matches: [
            { m: m5a, dir: '平、让平' },
            { m: m5b, dir: '总进球-2、3球' },
          ],
        });
    }

    // 方案七：单关双选
    const singleMatches7 = mList.filter((m) => {
      const md = matchDataMap[m.matchId];
      return md && md.odds && md.odds.isSingleGame === true;
    });
    if (singleMatches7.length > 0) {
      let bestM7 = null,
        bestM7Dir = '',
        bestM7Count = 0;
      for (const sm of singleMatches7) {
        const recs7 = matchDataMap[sm.matchId] ? matchDataMap[sm.matchId].recs : [];
        for (const r of recs7) {
          if ((r.type === '胜平' || r.type === '平负') && r.num > bestM7Count) {
            bestM7Count = r.num;
            bestM7 = sm;
            bestM7Dir = r.type;
          }
        }
      }
      if (bestM7 && bestM7Dir) {
        dayPlans.push({ name: 'plan_7', matches: [{ m: bestM7, dir: bestM7Dir }] });
      }
    }

    // 裁切
    if (dayMatchCount < 5 && dayPlans.length > 2) dayPlans.splice(2);

    // ── 计算每个方案盈亏 ──
    for (const pp of dayPlans) {
      if (pp.matches.length === 0) continue;
      const stat = planStats[pp.name];
      if (!stat) continue;

      let allWon = true,
        anyUnknown = false;
      for (const mi of pp.matches) {
        const res = extractRecResult(matchDataMap, mi.m.matchId, mi.dir);
        if (res.won === null) {
          anyUnknown = true;
          break;
        }
        if (!res.won) allWon = false;
      }
      if (anyUnknown) continue;

      stat.total++;

      if (allWon) {
        stat.won++;
        // 计算奖金
        let prize = 0;
        if (pp.matches.length === 1) {
          const md = matchDataMap[pp.matches[0].m.matchId];
          const odds = extractIndividualOdds(md ? md.odds : null, pp.matches[0].dir);
          const eff = dutchOdds(odds);
          prize = eff > 0 ? Math.round(AMOUNT * eff) : Math.round(AMOUNT * 2.5);
        } else {
          let product = 1,
            hasOdds = true;
          for (const mi of pp.matches) {
            const md = matchDataMap[mi.m.matchId];
            const odds = extractIndividualOdds(md ? md.odds : null, mi.dir);
            const eff = dutchOdds(odds);
            if (eff <= 0) {
              hasOdds = false;
              break;
            }
            product *= eff;
          }
          prize = hasOdds ? Math.round(AMOUNT * product) : Math.round(AMOUNT * 4);
        }
        stat.income += prize - AMOUNT;
      } else {
        stat.income -= AMOUNT;
      }
    }
  }
  return planStats;
}

// ── 打印方案统计 ──
function printPlanStats(planStats, title) {
  console.log('  ' + title);
  console.log('  ' + '-'.repeat(65));
  console.log('  方案       方案数   命中数   命中率      总盈利(元)');
  console.log('  ' + '-'.repeat(65));

  let totalPlans = 0,
    totalIncome = 0;
  const order = ['plan_1', 'plan_2', 'plan_3', 'plan_4', 'plan_5', 'plan_6', 'plan_7'];
  for (const key of order) {
    const s = planStats[key];
    if (!s || s.total === 0) continue;
    const name = key.replace('plan_', '方案');
    const rate = ((s.won / s.total) * 100).toFixed(1);
    const sign = s.income >= 0 ? '+' : '';
    const colorTag = s.income >= 0 ? '✅' : '❌';
    console.log(
      '  ' +
        colorTag +
        ' ' +
        name.padEnd(8) +
        String(s.total).padStart(6) +
        String(s.won).padStart(7) +
        String(rate).padStart(7) +
        '%' +
        String(sign + s.income).padStart(15),
    );
    totalPlans += s.total;
    totalIncome += s.income;
  }
  console.log('  ' + '-'.repeat(65));
  const tSign = totalIncome >= 0 ? '+' : '';
  console.log('  📊 合计     ' + String(totalPlans).padStart(6) + '                        ' + tSign + totalIncome);
  console.log('');
  return { totalPlans, totalIncome };
}

// ═══════════ Part A: 基线分析（当前参数） ═══════════
const baseline = analyzeAllSchemes(4, 1); // day>=4, expert>=1
printPlanStats(baseline, '📋 基线分析（当前参数: 方案六 day>=4, expert>=1）');

// ══════════════════════════════════════════════════════════════
// Part B: 方案六参数网格扫描
// ══════════════════════════════════════════════════════════════
console.log('[4/5] 方案六参数网格扫描...');
console.log('');

const P6_DAY_THRESHOLDS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
const P6_EXPERT_THRESHOLDS = [0, 1, 2, 3, 5, 8, 10, 15, 20, 25, 30];

const scanResults = [];
const totalCombos = P6_DAY_THRESHOLDS.length * P6_EXPERT_THRESHOLDS.length;
let comboDone = 0;

for (const dayT of P6_DAY_THRESHOLDS) {
  for (const expT of P6_EXPERT_THRESHOLDS) {
    comboDone++;
    process.stdout.write(
      '\r  Scanning ' + comboDone + '/' + totalCombos + ' (day>=' + dayT + ', expert>=' + expT + ')...',
    );
    const stats = analyzeAllSchemes(dayT, expT);
    const p6 = stats.plan_6;
    // 同时统计全部方案
    let allTotal = 0,
      allIncome = 0;
    for (const k of Object.keys(stats)) {
      allTotal += stats[k].total;
      allIncome += stats[k].income;
    }
    scanResults.push({
      dayT,
      expT,
      p6_total: p6.total,
      p6_won: p6.won,
      p6_income: p6.income,
      all_total: allTotal,
      all_income: allIncome,
    });
  }
}

console.log('');
console.log('');

// ═══════════ Part C: 汇总排序 ═══════════
console.log('[5/5] Results sorted by priority: profitable → max scheme count');
console.log('');
console.log('='.repeat(100));

// 用户优先级：
// 1. 必须盈利 (p6_income > 0)
// 2. 方案六数量最大化

const p6Profitable = scanResults.filter((r) => r.p6_income > 0);
const p6Loss = scanResults.filter((r) => r.p6_income <= 0);

// 按盈利 + 方案数排序
p6Profitable.sort((a, b) => {
  // 先按方案数降序
  if (b.p6_total !== a.p6_total) return b.p6_total - a.p6_total;
  // 再按盈利降序
  return b.p6_income - a.p6_income;
});

p6Loss.sort((a, b) => {
  if (b.p6_total !== a.p6_total) return b.p6_total - a.p6_total;
  return b.p6_income - a.p6_income;
});

console.log('  🟢 方案六盈利组合 (' + p6Profitable.length + '/' + totalCombos + '):');
console.log('  Rank | day>= | exp>= | 方案六数 | 命中 | 命中率 | 方案六盈利 | 全部方案数 | 全部盈利');
console.log('  ' + '-'.repeat(85));

if (p6Profitable.length > 0) {
  p6Profitable.forEach((r, i) => {
    const rate = r.p6_total > 0 ? ((r.p6_won / r.p6_total) * 100).toFixed(1) : '0.0';
    const p6Sign = r.p6_income >= 0 ? '+' : '';
    const allSign = r.all_income >= 0 ? '+' : '';
    console.log(
      '  ' +
        String(i + 1).padStart(4) +
        ' | ' +
        String(r.dayT).padStart(5) +
        ' | ' +
        String(r.expT).padStart(4) +
        ' | ' +
        String(r.p6_total).padStart(8) +
        ' | ' +
        String(r.p6_won).padStart(4) +
        ' | ' +
        String(rate).padStart(5) +
        '% | ' +
        String(p6Sign + r.p6_income).padStart(10) +
        ' | ' +
        String(r.all_total).padStart(10) +
        ' | ' +
        allSign +
        r.all_income,
    );
  });
} else {
  console.log('  ⚠️  没有找到方案六盈利的参数组合！');
}

console.log('');
console.log('  🔴 方案六亏损组合 (' + p6Loss.length + '/' + totalCombos + '):');
if (p6Loss.length > 0) {
  console.log('  (仅显示前10)');
  p6Loss.slice(0, 10).forEach((r, i) => {
    const rate = r.p6_total > 0 ? ((r.p6_won / r.p6_total) * 100).toFixed(1) : '0.0';
    const p6Sign = r.p6_income >= 0 ? '+' : '';
    console.log(
      '  ' +
        String(i + 1).padStart(4) +
        ' | ' +
        String(r.dayT).padStart(5) +
        ' | ' +
        String(r.expT).padStart(4) +
        ' | ' +
        String(r.p6_total).padStart(8) +
        ' | ' +
        String(r.p6_won).padStart(4) +
        ' | ' +
        String(rate).padStart(5) +
        '% | ' +
        String(p6Sign + r.p6_income).padStart(10),
    );
  });
}

// ═══════════ 最佳建议 ═══════════
console.log('');
console.log('='.repeat(100));
console.log('  🏆 最佳建议（方案数最多 + 盈利）:');

if (p6Profitable.length > 0) {
  const best = p6Profitable[0];
  console.log('');
  console.log('  ★ 方案六参数: dayMatchCount >= ' + best.dayT + ', bestCount6 >= ' + best.expT);
  console.log(
    '  ★ 预期结果: ' +
      best.p6_total +
      ' 个方案六, 命中率 ' +
      (best.p6_total > 0 ? ((best.p6_won / best.p6_total) * 100).toFixed(1) : '0.0') +
      '%, 盈利 +' +
      best.p6_income +
      ' 元',
  );
  console.log(
    '  ★ 全部方案合计: ' +
      best.all_total +
      ' 个, 总盈利 ' +
      (best.all_income >= 0 ? '+' : '') +
      best.all_income +
      ' 元',
  );

  // 对比基线
  const baselineP6 = baseline.plan_6;
  console.log('');
  console.log('  📊 对比基线（当前 day>=4, expert>=1）:');
  console.log(
    '     基线: ' +
      baselineP6.total +
      ' 方案六, 盈利 ' +
      (baselineP6.income >= 0 ? '+' : '') +
      baselineP6.income +
      ' 元',
  );
  console.log('     优化: ' + best.p6_total + ' 方案六, 盈利 +' + best.p6_income + ' 元');
  console.log(
    '     变化: ' +
      (best.p6_total - baselineP6.total >= 0 ? '+' : '') +
      (best.p6_total - baselineP6.total) +
      ' 方案, ' +
      (best.p6_income - baselineP6.income >= 0 ? '+' : '') +
      (best.p6_income - baselineP6.income) +
      ' 元',
  );

  // 显示与最佳方案数接近的前5个选择
  console.log('');
  console.log('  🔝 方案数最多的盈利组合 TOP 5:');
  p6Profitable.slice(0, 5).forEach((r, i) => {
    console.log(
      '     ' +
        (i + 1) +
        '. day>=' +
        r.dayT +
        ', exp>=' +
        r.expT +
        ' → 方案六=' +
        r.p6_total +
        ', 盈利=+' +
        r.p6_income +
        '元',
    );
  });
} else {
  console.log('');
  console.log('  ⚠️  方案六在所有参数组合下均亏损，可能需要检查算法本身。');

  // 显示亏损最少的
  p6Loss.sort((a, b) => b.p6_income - a.p6_income);
  const bestLoss = p6Loss[0];
  console.log(
    '  亏损最少: day>=' +
      bestLoss.dayT +
      ', exp>=' +
      bestLoss.expT +
      ' → ' +
      bestLoss.p6_total +
      ' 个, ' +
      bestLoss.p6_income +
      ' 元',
  );
}

console.log('');
console.log('='.repeat(100));

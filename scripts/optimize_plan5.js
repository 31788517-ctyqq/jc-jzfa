/**
 * 方案五参数优化 — 网格搜索最大化 (投入*0.07 + 盈利)
 * 
 * 可调参数:
 *   minExpertA      场次A专家推荐数下限 (平、让平)
 *   minExpertB      场次B专家推荐数下限 (总进球-2、3球)
 *   minOddsA        场次A荷兰式有效赔率下限
 *   minOddsB        场次B荷兰式有效赔率下限
 *   minProductOdds  交叉配对合赔下限
 */

const fs = require('fs');
const path = require('path');

// ── 工具函数（与 plan-generator.js 完全一致）──

function normalizeRecs(recs) {
  return (recs || []).map(x => {
    const raw = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
    return { type: x.t || x.type, num: x.n || x.num, result: raw === 0 || raw === 1 ? raw : null };
  });
}

function calcEffectiveOdds(odds, direction) {
  const subOdds = [];
  if (direction === '平、让平') {
    if (odds && odds.spf) subOdds.push(odds.spf.draw);
    if (odds && odds.rqspf) subOdds.push(odds.rqspf.draw);
  } else if (direction === '总进球-2、3球') {
    if (odds && odds.totalGoals) {
      if (odds.totalGoals['2']) subOdds.push(odds.totalGoals['2']);
      if (odds.totalGoals['3']) subOdds.push(odds.totalGoals['3']);
    }
  }
  if (subOdds.length === 0) return null;
  const N = subOdds.length;
  if (N === 1) return subOdds[0];
  const invSum = subOdds.reduce((a, b) => a + 1 / b, 0);
  return invSum > 0 ? 1 / invSum : null;
}

function judgeByScore(direction, scoreStr, handicap) {
  if (!scoreStr || !direction) return null;
  const parts = String(scoreStr).replace(/[-:]/g, ':').split(':');
  const hg = parseInt(parts[0]), ag = parseInt(parts[1]);
  if (isNaN(hg) || isNaN(ag)) return null;

  // 平、让平 = SPF平 OR RQSPF让平
  if (direction === '平、让平') {
    const rqHcp = handicap != null ? parseFloat(handicap) || 0 : 0;
    return (hg === ag) || (hg + rqHcp === ag);
  }
  // 总进球-2、3球
  if (direction === '总进球-2、3球') {
    const total = hg + ag;
    return total === 2 || total === 3;
  }
  return null;
}

function getOddsHistory(dateStr) {
  const f = path.join(__dirname, '..', 'server', 'odds_history', dateStr + '.json');
  if (fs.existsSync(f)) {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    return raw.odds || raw;  // odds_history v2 wraps under .odds
  }
  return null;
}

function getRecs(matchId, rMap) {
  const key = String(matchId);
  const raw = rMap['m_' + key] || rMap[key] || [];
  return normalizeRecs(raw);
}

// ── 主逻辑 ──

function evaluatePlan5(params) {
  const { minExpertA, minExpertB, minOddsA, minOddsB, minProductOdds } = params;

  const dataFile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'data.json'), 'utf8'));
  const mMap = dataFile.m || {};
  const rMap = dataFile.r || {};

  const minDate = '2026-03-19';
  const maxDate = '2026-06-06';
  
  let totalInvested = 0, totalIncome = 0, totalPlans = 0, totalWon = 0;
  const details = [];

  const start = new Date(minDate);
  const end = new Date(maxDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);

    // 当天比赛
    const mList = [];
    Object.keys(mMap).forEach(k => {
      const m = mMap[k];
      if (m && (m.date || '').slice(0, 10) === ds) mList.push(m);
    });
    if (mList.length < 6) continue; // 方案五需要 ≥6 场

    // 加载赔率
    const histOdds = getOddsHistory(ds);
    if (!histOdds) continue;

    // 构建 matchDataMap
    const matchDataMap = {};
    for (const m of mList) {
      const num = m.num || '';
      const od = histOdds[num];
      matchDataMap[m.matchId] = {
        match: m,
        recs: getRecs(m.matchId, rMap),
        odds: od || null,
      };
    }

    // 场次A候选
    const candidatesA = [];
    for (const m of mList) {
      const md = matchDataMap[m.matchId];
      if (!md || !md.odds) continue;
      let total = 0;
      for (const r of md.recs) {
        if (r.type === '平、让平') total += r.num || 0;
      }
      if (total < minExpertA) continue;
      const eA = calcEffectiveOdds(md.odds, '平、让平');
      if (!eA || eA < minOddsA) continue;
      candidatesA.push({ match: m, count: total, odds: eA });
    }

    // 场次B候选
    const candidatesB = [];
    for (const m of mList) {
      const md = matchDataMap[m.matchId];
      if (!md || !md.odds || !md.odds.totalGoals) continue;
      const tg = md.odds.totalGoals;
      if (tg['2'] == null || tg['2'] <= 0 || tg['3'] == null || tg['3'] <= 0) continue;
      let total = 0;
      for (const r of md.recs) {
        if (r.type === '总进球-2、3球') total += r.num || 0;
      }
      if (total < minExpertB) continue;
      const eB = calcEffectiveOdds(md.odds, '总进球-2、3球');
      if (!eB || eB < minOddsB) continue;
      candidatesB.push({ match: m, count: total, odds: eB });
    }

    // 交叉配对
    let bestPair = null;
    for (const ca of candidatesA) {
      for (const cb of candidatesB) {
        if (ca.match.matchId === cb.match.matchId) continue;
        const po = ca.odds * cb.odds;
        if (po < minProductOdds) continue;
        if (!bestPair || po > bestPair.productOdds) {
          bestPair = { a: ca.match, b: cb.match, productOdds: po, aOdds: ca.odds, bOdds: cb.odds };
        }
      }
    }

    if (!bestPair) continue;

    // 判定命中
    const am = bestPair.a, bm = bestPair.b;
    const aHcp = (matchDataMap[am.matchId].odds && matchDataMap[am.matchId].odds.rqspf)
      ? matchDataMap[am.matchId].odds.rqspf.handicap : null;
    const aWon = am.matchStatus >= 1 && am.score ? judgeByScore('平、让平', am.score, aHcp) : null;
    const bWon = bm.matchStatus >= 1 && bm.score ? judgeByScore('总进球-2、3球', bm.score, null) : null;

    if (aWon === null || bWon === null) continue; // 未出结果

    totalInvested += 1000;
    totalPlans++;
    const isWon = aWon && bWon;
    const maxPrize = Math.round(1000 * bestPair.productOdds);
    const income = isWon ? maxPrize - 1000 : -1000;
    totalIncome += income;
    if (isWon) totalWon++;

    details.push({
      date: ds,
      a: am.matchNum + ' ' + am.homeName + ' vs ' + am.visitName + ' (' + bestPair.aOdds.toFixed(1) + ')',
      b: bm.matchNum + ' ' + bm.homeName + ' vs ' + bm.visitName + ' (' + bestPair.bOdds.toFixed(1) + ')',
      productOdds: bestPair.productOdds.toFixed(1),
      aWon, bWon, income,
    });
  }

  const objective = Math.round(totalInvested * 0.07 + totalIncome);
  const hitRate = totalPlans > 0 ? Math.round((totalWon / totalPlans) * 100) : 0;

  return {
    params, totalInvested, totalIncome, totalPlans, totalWon, hitRate, objective,
  };
}

// ── 网格搜索 ──

const paramGrid = {
  minExpertA: [0, 1, 2, 3, 5],        // 平、让平 专家推荐数下限
  minExpertB: [0, 1, 2, 3],            // 总进球-2、3球 专家推荐数下限
  minOddsA: [1.0, 1.2, 1.3, 1.5],     // 场次A 赔率下限
  minOddsB: [1.0, 1.2, 1.3, 1.5],     // 场次B 赔率下限
  minProductOdds: [1.5, 1.8, 2.0, 2.2, 2.5], // 合赔下限
};

const results = [];

// 生成所有参数组合
function* cartesian(grid) {
  const keys = Object.keys(grid);
  const values = keys.map(k => grid[k]);
  function* recurse(idx, current) {
    if (idx >= keys.length) { yield { ...current }; return; }
    for (const v of values[idx]) {
      current[keys[idx]] = v;
      yield* recurse(idx + 1, current);
    }
  }
  yield* recurse(0, {});
}

let total = 5 * 4 * 4 * 4 * 5; // 1600 combos
let done = 0;
const startTime = Date.now();

for (const params of cartesian(paramGrid)) {
  const r = evaluatePlan5(params);
  results.push(r);
  done++;
  if (done % 100 === 0) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r  ${done}/${total} (${elapsed}s) ...`);
  }
}
console.log(`\r  ${done}/${total} 完成 (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);

// 排序输出 Top 20
results.sort((a, b) => b.objective - a.objective);

console.log('\n════ 方案五参数优化 Top 20 ════');
console.log('目标 = 投入*7% + 盈利  (越大越好)');
console.log('');

const header = ' 专家A  专家B  赔率A  赔率B  合赔   方案数  命中率  总投入    总盈利   目标';
console.log(header);
console.log('-'.repeat(header.length + 5));

for (let i = 0; i < Math.min(20, results.length); i++) {
  const r = results[i];
  const p = r.params;
  console.log(
    `  ${String(p.minExpertA).padStart(4)}  ${String(p.minExpertB).padStart(4)}` +
    `  ${p.minOddsA.toFixed(1).padStart(5)}  ${p.minOddsB.toFixed(1).padStart(5)}` +
    `  ${p.minProductOdds.toFixed(1).padStart(4)}  ${String(r.totalPlans).padStart(5)}` +
    `  ${String(r.hitRate + '%').padStart(5)}  ${String(r.totalInvested).padStart(6)}` +
    `  ${String(r.totalIncome).padStart(7)}  ${String(r.objective).padStart(6)}`
  );
}

// 当前参数对比
console.log('\n── 当前参数（基线）──');
const current = results.find(r =>
  r.params.minExpertA === 0 && r.params.minExpertB === 0 &&
  r.params.minOddsA === 1.2 && r.params.minOddsB === 1.2 &&
  r.params.minProductOdds === 2.0
);
if (current) {
  console.log(`  方案数: ${current.totalPlans} | 命中率: ${current.hitRate}% | 盈利: ${current.totalIncome} | 目标: ${current.objective}`);
} else {
  console.log('  (未在网格中找到精确匹配)');
}

// 最佳组合
const best = results[0];
console.log('\n── ★ 最佳参数 ★ ──');
console.log(`  minExpertA=${best.params.minExpertA}  minExpertB=${best.params.minExpertB}`);
console.log(`  minOddsA=${best.params.minOddsA}  minOddsB=${best.params.minOddsB}  minProductOdds=${best.params.minProductOdds}`);
console.log(`  方案数: ${best.totalPlans} | 命中率: ${best.hitRate}% | 盈利: ${best.totalIncome} | 目标: ${best.objective}`);

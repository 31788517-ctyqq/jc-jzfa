/**
 * 方案五参数优化 — 使用生产服务器数据
 * 数据源: server/_prod_data.json + server/_prod_odds/
 */
const fs = require('fs'),
  path = require('path');

// ── 工具函数 ──
function normalizeRecs(recs) {
  return (recs || []).map((x) => {
    const raw = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
    return { type: x.t || x.type, num: x.n || x.num, result: raw === 0 || raw === 1 ? raw : null };
  });
}
function getOddsHistory(ds) {
  const f = path.join(__dirname, '..', 'server', '_prod_odds', ds + '.json');
  if (fs.existsSync(f)) {
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    return r.odds || r;
  }
  return null;
}
function calcEffectiveOdds(odds, dir) {
  const sub = [];
  if (dir === '平、让平') {
    if (odds && odds.spf) sub.push(odds.spf.draw);
    if (odds && odds.rqspf) sub.push(odds.rqspf.draw);
  } else if (dir === '总进球-2、3球') {
    if (odds && odds.totalGoals) {
      if (odds.totalGoals['2']) sub.push(odds.totalGoals['2']);
      if (odds.totalGoals['3']) sub.push(odds.totalGoals['3']);
    }
  }
  if (sub.length === 0) return null;
  if (sub.length === 1) return sub[0];
  const inv = sub.reduce((a, b) => a + 1 / b, 0);
  return inv > 0 ? 1 / inv : null;
}
function judgeByScore(dir, score, hcp) {
  if (!score || !dir) return null;
  const p = String(score).replace(/[-:]/g, ':').split(':');
  const h = parseInt(p[0]),
    a = parseInt(p[1]);
  if (isNaN(h) || isNaN(a)) return null;
  if (dir === '平、让平') {
    const rq = hcp != null ? parseFloat(hcp) || 0 : 0;
    return h === a || h + rq === a;
  }
  if (dir === '总进球-2、3球') {
    const t = h + a;
    return t === 2 || t === 3;
  }
  return null;
}

// ── 加载生产数据 ──
const dataFile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', '_prod_data.json'), 'utf8'));
const mMap = dataFile.m || {},
  rMap = dataFile.r || {};

function evaluatePlan5(params) {
  const { minExpertA, minExpertB, minOddsA, minOddsB, minProductOdds } = params;
  let invested = 0,
    income = 0,
    plans = 0,
    won = 0;

  const minDate = '2026-03-19',
    maxDate = '2026-06-06';
  const start = new Date(minDate),
    end = new Date(maxDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    const mList = [];
    Object.keys(mMap).forEach((k) => {
      const m = mMap[k];
      if (m && (m.date || '').slice(0, 10) === ds) mList.push(m);
    });
    if (mList.length < 6) continue;
    const histOdds = getOddsHistory(ds);
    if (!histOdds) continue;
    const mdMap = {};
    for (const m of mList) {
      const num = m.num || '',
        od = histOdds[num];
      const key = String(m.matchId);
      mdMap[m.matchId] = { match: m, recs: normalizeRecs(rMap['m_' + key] || rMap[key] || []), odds: od || null };
    }
    const ca = [],
      cb = [];
    for (const m of mList) {
      const md = mdMap[m.matchId];
      if (!md || !md.odds) continue;
      let t = 0;
      for (const r of md.recs) {
        if (r.type === '平、让平') t += r.num || 0;
      }
      if (t < minExpertA) continue;
      const e = calcEffectiveOdds(md.odds, '平、让平');
      if (!e || e < minOddsA) continue;
      ca.push({ match: m, count: t, odds: e });
    }
    for (const m of mList) {
      const md = mdMap[m.matchId];
      if (!md || !md.odds || !md.odds.totalGoals) continue;
      const tg = md.odds.totalGoals;
      if (tg['2'] == null || tg['2'] <= 0 || tg['3'] == null || tg['3'] <= 0) continue;
      let t = 0;
      for (const r of md.recs) {
        if (r.type === '总进球-2、3球') t += r.num || 0;
      }
      if (t < minExpertB) continue;
      const e = calcEffectiveOdds(md.odds, '总进球-2、3球');
      if (!e || e < minOddsB) continue;
      cb.push({ match: m, count: t, odds: e });
    }
    let best = null;
    for (const a of ca)
      for (const b of cb) {
        if (a.match.matchId === b.match.matchId) continue;
        const po = a.odds * b.odds;
        if (po < minProductOdds) continue;
        if (!best || po > best.pd) best = { a: a.match, b: b.match, pd: po, aO: a.odds, bO: b.odds };
      }
    if (!best) continue;
    const am = best.a,
      bm = best.b;
    const ah = mdMap[am.matchId].odds && mdMap[am.matchId].odds.rqspf ? mdMap[am.matchId].odds.rqspf.handicap : null;
    const aw = am.matchStatus >= 1 && am.score ? judgeByScore('平、让平', am.score, ah) : null;
    const bw = bm.matchStatus >= 1 && bm.score ? judgeByScore('总进球-2、3球', bm.score, null) : null;
    if (aw === null || bw === null) continue;
    invested += 1000;
    plans++;
    const isWon = aw && bw;
    income += isWon ? Math.round(1000 * best.pd) - 1000 : -1000;
    if (isWon) won++;
  }
  const objective = Math.round(invested * 0.07 + income);
  return { params, invested, income, plans, won, hr: plans > 0 ? Math.round((won / plans) * 100) : 0, objective };
}

// ── 网格搜索（生产数据）──
const paramGrid = {
  minExpertA: [0, 1, 2, 3, 5],
  minExpertB: [0, 1, 2, 3],
  minOddsA: [1.0, 1.2, 1.3, 1.5],
  minOddsB: [1.0, 1.2, 1.3, 1.5],
  minProductOdds: [1.5, 1.8, 2.0, 2.2, 2.5],
};

function* cartesian(grid) {
  const keys = Object.keys(grid);
  const values = keys.map((k) => grid[k]);
  function* recurse(idx, current) {
    if (idx >= keys.length) {
      yield { ...current };
      return;
    }
    for (const v of values[idx]) {
      current[keys[idx]] = v;
      yield* recurse(idx + 1, current);
    }
  }
  yield* recurse(0, {});
}

const results = [];
let total = 5 * 4 * 4 * 4 * 5,
  done = 0;
const startTime = Date.now();

console.log('生产数据网格搜索 1600 组合...\n');
for (const params of cartesian(paramGrid)) {
  const r = evaluatePlan5(params);
  results.push(r);
  done++;
  if (done % 100 === 0) {
    process.stdout.write(`\r  ${done}/${total} (${((Date.now() - startTime) / 1000).toFixed(1)}s)...`);
  }
}
console.log(`\r  ${done}/${total} 完成 (${((Date.now() - startTime) / 1000).toFixed(1)}s)\n`);

results.sort((a, b) => b.objective - a.objective);

console.log('════ 生产数据 方案五 Top 20 ════\n');
console.log('专家A 专家B 赔率A 赔率B 合赔  方案 命中率  投入    盈利    目标');
console.log('-'.repeat(62));

for (let i = 0; i < Math.min(20, results.length); i++) {
  const r = results[i],
    p = r.params;
  console.log(
    `  ${String(p.minExpertA).padStart(3)}  ${String(p.minExpertB).padStart(4)}` +
      `  ${p.minOddsA.toFixed(1).padStart(4)}  ${p.minOddsB.toFixed(1).padStart(4)}` +
      `  ${p.minProductOdds.toFixed(1).padStart(4)}  ${String(r.plans).padStart(4)}` +
      `  ${String(r.hr + '%').padStart(4)}  ${String(r.invested).padStart(6)}` +
      `  ${String(r.income).padStart(8)}  ${String(r.objective).padStart(6)}`,
  );
}

// Current baseline
console.log('\n── 当前基线（已在服务器上）──');
const current = results.find(
  (r) =>
    r.params.minExpertA === 2 &&
    r.params.minExpertB === 0 &&
    r.params.minOddsA === 1.0 &&
    r.params.minOddsB === 1.0 &&
    r.params.minProductOdds === 1.5,
);
if (current) {
  console.log(`  方案数=${current.plans} 命中率=${current.hr}% 盈利=${current.income} 目标=${current.objective}`);
} else {
  console.log('  (未找到精确匹配)');
}

// Best
const best = results[0];
console.log(`\n── ★ 最佳（目标=${best.objective}）──`);
console.log(`  minExpertA=${best.params.minExpertA}  minExpertB=${best.params.minExpertB}`);
console.log(
  `  minOddsA=${best.params.minOddsA}  minOddsB=${best.params.minOddsB}  minProductOdds=${best.params.minProductOdds}`,
);
console.log(`  方案数=${best.plans} 命中率=${best.hr}% 盈利=${best.income}`);

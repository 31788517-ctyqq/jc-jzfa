/**
 * 方案三回测 — 胜 × 让负 (2串1) + 参数扫描
 * 场次A: 胜 (单选项)  场次B: 让负 (单选项)
 * 投注: 2串1, 1000元/期
 * 扫描: [日门槛] × [合赔下限] × [专家门槛A] × [专家门槛B]
 */
const fs = require('fs'),
  path = require('path');
const DATA = path.join(__dirname, '..', 'server', 'data.json');
const OD = path.join(__dirname, '..', 'server', 'odds_history');
const AMT = 1000;

const raw = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const mMap = raw.m || {},
  rMap = raw.r || {};
const dateMap = {};
Object.keys(mMap).forEach((k) => {
  const m = mMap[k],
    ds = (m.date || '').slice(0, 10);
  if (ds && !dateMap[ds]) dateMap[ds] = [];
  if (ds) dateMap[ds].push(m);
});
const allDates = Object.keys(dateMap).sort();
const oddsCache = {};
allDates.forEach((ds) => {
  const f = path.join(OD, ds + '.json');
  if (fs.existsSync(f))
    try {
      oddsCache[ds] = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (e) {}
});

function getO(ds, n) {
  const od = oddsCache[ds];
  return od && od.odds ? od.odds[n] || null : null;
}

// 场次A需要 spf.home, 场次B需要 rqspf.away
function hasWinOdds(o) {
  return o && o.spf && o.spf.home != null;
}
function hasRqAway(o) {
  return o && o.rqspf && o.rqspf.away != null;
}

// 赔率提取
function eOdds(o, d) {
  if (!o) return [];
  if (d === '胜' && o.spf && o.spf.home !== undefined) return [o.spf.home];
  if (d === '让负' && o.rqspf && o.rqspf.away !== undefined) return [o.rqspf.away];
  return [];
}

// 赛果判定 (比分优先)
function result(recs, d, score) {
  if (d === '胜') {
    // 比分优先
    if (score) {
      const p = String(score).split(':'),
        h = parseInt(p[0]),
        a = parseInt(p[1]);
      if (!isNaN(h) && !isNaN(a)) return h > a ? { won: true } : { won: false };
    }
    for (const r of recs) {
      if (r.type === '胜') {
        if (r.result === 1) return { won: true };
        if (r.result === 0) return { won: false };
        return { won: null };
      }
    }
    return { won: null };
  }
  if (d === '让负') {
    for (const r of recs) {
      if (r.type === '让负') {
        if (r.result === 1) return { won: true };
        if (r.result === 0) return { won: false };
        return { won: null };
      }
    }
    return { won: null };
  }
  return { won: null };
}

function run(minDay, minOdds, minExpA, minExpB, minExpA2) {
  let t = 0,
    w = 0,
    inc = 0;
  for (const ds of allDates) {
    const ml = dateMap[ds];
    if (ml.length < minDay) continue;
    const mdM = {};
    for (const mm of ml) {
      const rr = rMap['m_' + mm.matchId] || rMap[String(mm.matchId)] || [];
      const recs = rr.map((x) => {
        const rR = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
        return { type: x.t || x.type || '', num: x.n || x.num || 0, result: rR === 0 || rR === 1 ? rR : null };
      });
      const oo = getO(ds, mm.num || '');
      let o = null;
      if (oo) o = { spf: oo.spf || null, rqspf: oo.rqspf || null, totalGoals: oo.totalGoals || null };
      mdM[mm.matchId] = { match: mm, recs, odds: o };
    }
    // 场次A: 胜, 专家最多
    let bA = null,
      bAc = 0;
    for (const mm of ml) {
      const md = mdM[mm.matchId];
      if (!md || !hasWinOdds(md.odds)) continue;
      let tA = 0;
      for (const r of md.recs) {
        if (r.type === '胜') tA += r.num || 0;
      }
      if (tA >= minExpA && tA > bAc) {
        bAc = tA;
        bA = mm;
      }
    }
    if (!bA) continue;
    // 场次B: 让负, 专家最多, 排除A
    let bB = null,
      bBc = 0;
    for (const mm of ml) {
      if (mm.matchId === bA.matchId) continue;
      const md = mdM[mm.matchId];
      if (!md || !hasRqAway(md.odds)) continue;
      let tB = 0;
      for (const r of md.recs) {
        if (r.type === '让负') tB += r.num || 0;
      }
      if (tB >= minExpB && tB > bBc) {
        bBc = tB;
        bB = mm;
      }
    }
    if (!bB) continue;
    // A专家门槛2: 胜专家数>=minExpA2 (可选第二道门槛)
    if (minExpA2 && bAc < minExpA2) continue;
    // 赔率
    const oA = eOdds(mdM[bA.matchId].odds, '胜'),
      oB = eOdds(mdM[bB.matchId].odds, '让负');
    if (oA.length < 1 || oB.length < 1) continue;
    const productOdds = oA[0] * oB[0];
    if (productOdds < minOdds) continue;
    // 赛果
    const rA = result(mdM[bA.matchId].recs, '胜', bA.score);
    const rB = result(mdM[bB.matchId].recs, '让负');
    if (rA.won === null || rB.won === null) continue;
    t++;
    if (rA.won && rB.won) {
      w++;
      inc += Math.round(AMT * productOdds) - AMT;
    } else inc -= AMT;
  }
  return { total: t, won: w, income: inc };
}

// ── 基线 ──
console.log('=== 方案三基线 (当前参数: 无门槛) ===');
const base = run(2, 1.0, 0, 0, 0);
console.log(
  '  日≥2, 合赔≥1.0, 无专家门槛: %d期 %d中 %.1f%% %+d\n',
  base.total,
  base.won,
  (base.won / base.total) * 100,
  base.income,
);

// ── 4维扫描 ──
const days = [2, 3, 5, 8, 10, 12, 15];
const odds = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
const expA = [0, 10, 20, 30]; // 胜专家门槛
const expB = [0, 10, 20, 30]; // 让负专家门槛

const results = [];
let done = 0,
  total = days.length * odds.length * expA.length * expB.length;

for (const d of days) {
  for (const o of odds) {
    for (const ea of expA) {
      for (const eb of expB) {
        done++;
        if (done % 50 === 0) process.stdout.write('\r  ' + done + '/' + total + ' ...');
        const r = run(d, o, ea, eb, 0);
        if (r.total > 0) results.push({ day: d, odds: o, expA: ea, expB: eb, ...r });
      }
    }
  }
}
console.log('\r  扫描完成: ' + results.length + ' 组合\n');

results.sort((a, b) => b.income - a.income);

console.log('=== TOP 15 盈利 ===');
console.log('Rank  日≥  合赔≥  胜≥  让负≥  期数  命中  命中率  盈亏');
console.log('-'.repeat(62));
results.slice(0, 15).forEach((r, i) => {
  const rate = ((r.won / r.total) * 100).toFixed(1);
  console.log(
    '%3d   %3d   %4.1f   %3d   %4d   %4d   %3d   %5s%%  %+d',
    i + 1,
    r.day,
    r.odds,
    r.expA,
    r.expB,
    r.total,
    r.won,
    rate,
    r.income,
  );
});

// 盈利 + 高期数
console.log('\n=== 盈利且期数最多 TOP 15 ===');
const good = results.filter((r) => r.income > 0).sort((a, b) => b.total - a.total || b.income - a.income);
good.slice(0, 15).forEach((r, i) => {
  const rate = ((r.won / r.total) * 100).toFixed(1);
  console.log(
    '  day≥%d  odds≥%.1f  胜≥%d  让负≥%d  →  %d期 %d中 %s%%  %+d',
    r.day,
    r.odds,
    r.expA,
    r.expB,
    r.total,
    r.won,
    rate,
    r.income,
  );
});

// 如果期数不够多，展示亏损最少的高期数组合
if (!good.length || good[0].total < 40) {
  const ok = results.sort((a, b) => b.total - a.total).slice(0, 15);
  console.log('\n=== 期数最多 TOP 15 (含亏损) ===');
  ok.forEach((r, i) => {
    const rate = ((r.won / r.total) * 100).toFixed(1);
    console.log(
      '  day≥%d  odds≥%.1f  胜≥%d  让负≥%d  →  %d期 %d中 %s%%  %+d',
      r.day,
      r.odds,
      r.expA,
      r.expB,
      r.total,
      r.won,
      rate,
      r.income,
    );
  });
}

// 命中率>40% 且期数最多
console.log('\n=== 命中率>=40% 期数最多 ===');
const hr = results.filter((r) => r.won / r.total >= 0.4).sort((a, b) => b.total - a.total);
hr.slice(0, 15).forEach((r, i) => {
  const rate = ((r.won / r.total) * 100).toFixed(1);
  console.log(
    '  day≥%d  odds≥%.1f  胜≥%d  让负≥%d  →  %d期 %d中 %s%%  %+d',
    r.day,
    r.odds,
    r.expA,
    r.expB,
    r.total,
    r.won,
    rate,
    r.income,
  );
});

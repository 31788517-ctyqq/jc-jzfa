/**
 * 方案五详细清单 — 逐日展示所有方案并计算盈亏
 * 日门槛=6, 每天1个最优方案
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'server', 'data.json');
const ODDS_DIR = path.join(__dirname, '..', 'server', 'odds_history');
const AMOUNT = 1000;
const START_DATE = '2026-03-19';
const END_DATE = '2026-06-04';
const MIN_DAY_MATCHES = 6;

const DIR_A = ['平', '让平'];
const DIR_B = '总进球-2、3球';

// ── 加载数据 ──
const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const mMap = raw.m || {};
const rMap = raw.r || {};

const dateMap = {};
Object.keys(mMap).forEach((k) => {
  const m = mMap[k];
  const ds = (m.date || '').slice(0, 10);
  if (!ds || ds < START_DATE || ds > END_DATE) return;
  if (!dateMap[ds]) dateMap[ds] = [];
  dateMap[ds].push(m);
});
const allDates = Object.keys(dateMap).sort();

const oddsCache = {};
for (const ds of allDates) {
  const file = path.join(ODDS_DIR, ds + '.json');
  if (fs.existsSync(file)) {
    try {
      oddsCache[ds] = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      /* skip */
    }
  }
}

function getOddsForMatch(ds, matchNum) {
  const od = oddsCache[ds];
  return od && od.odds ? od.odds[matchNum] || null : null;
}

// ── 赔率提取 ──
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

function extractTG23Odds(oddsObj) {
  if (!oddsObj || !oddsObj.totalGoals) return [];
  const tg = oddsObj.totalGoals;
  const vals = [];
  if (tg['2'] != null && tg['2'] > 0) vals.push(tg['2']);
  if (tg['3'] != null && tg['3'] > 0) vals.push(tg['3']);
  return vals;
}

function dutchOdds(subOdds) {
  if (subOdds.length === 0) return 0;
  if (subOdds.length === 1) return subOdds[0];
  const invSum = subOdds.reduce((s, o) => s + 1 / o, 0);
  return invSum > 0 ? 1 / invSum : 0;
}

// ── 赛果判定 ──
function resultA(recs) {
  let anyWon = false,
    anyUnknown = false;
  for (const d of ['平', '让平']) {
    let found = false;
    for (const r of recs) {
      if (r.type === d) {
        found = true;
        if (r.result === 1) anyWon = true;
        else if (r.result === 0) {
          /* lose */
        } else anyUnknown = true;
        break;
      }
    }
    if (!found) anyUnknown = true;
  }
  if (anyUnknown) return '?';
  return anyWon ? '✓' : '✗';
}

function resultB(recs, score) {
  if (score) {
    const parts = String(score).split(':');
    const total = parseInt(parts[0]) + parseInt(parts[1]);
    if (!isNaN(total)) return total === 2 || total === 3 ? '✓' : '✗';
  }
  let anyWon = false,
    anyUnknown = false;
  for (const d of ['总进球-2', '总进球-3']) {
    let found = false;
    for (const r of recs) {
      if (r.type === d) {
        found = true;
        if (r.result === 1) anyWon = true;
        else if (r.result === 0) {
          /* lose */
        } else anyUnknown = true;
        break;
      }
    }
    if (!found) anyUnknown = true;
  }
  if (anyUnknown) return '?';
  return anyWon ? '✓' : '✗';
}

// ── 主循环 ──
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log(
  '║     方案五详细清单 — ' + START_DATE + ' ~ ' + END_DATE + '（日门槛≥' + MIN_DAY_MATCHES + '场，每天1个）  ║',
);
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
console.log('');

let totalSchemes = 0,
  totalWon = 0,
  totalIncome = 0;
let dayCount = 0,
  skipCount = 0;

for (const ds of allDates) {
  const mList = dateMap[ds];
  if (mList.length < MIN_DAY_MATCHES) {
    skipCount++;
    continue;
  }
  dayCount++;

  // 构建 matchDataMap
  const matchDataMap = {};
  for (const mm of mList) {
    const recsRaw = rMap[String(mm.matchId)] || rMap['m_' + mm.matchId] || [];
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
      };
    }
    matchDataMap[mm.matchId] = { match: mm, recs, odds: oddsObj };
  }

  // 收集场次A候选 (平、让平)
  const candidatesA = [];
  for (const mm of mList) {
    const md = matchDataMap[mm.matchId];
    if (!md || !md.odds) continue;
    const ods = extractMultiOdds(md.odds, DIR_A);
    if (ods.length === 0) continue;
    let totalA = 0;
    for (const r of md.recs) {
      if (r.type === '平' || r.type === '让平') totalA += r.num || 0;
    }
    if (totalA > 0) candidatesA.push({ match: mm, data: md, expertCount: totalA, dutchOdds: dutchOdds(ods) });
  }
  if (candidatesA.length === 0) {
    skipCount++;
    continue;
  }
  candidatesA.sort((a, b) => b.expertCount - a.expertCount);

  // 收集场次B候选 (总进球-2、3球)
  const candidatesB = [];
  for (const mm of mList) {
    const md = matchDataMap[mm.matchId];
    if (!md || !md.odds) continue;
    const ods = extractTG23Odds(md.odds);
    if (ods.length < 2) continue;
    let totalB = 0;
    for (const r of md.recs) {
      if (r.type === DIR_B) totalB += r.num || 0;
    }
    if (totalB > 0) candidatesB.push({ match: mm, data: md, expertCount: totalB, dutchOdds: dutchOdds(ods) });
  }
  if (candidatesB.length === 0) {
    skipCount++;
    continue;
  }
  candidatesB.sort((a, b) => b.expertCount - a.expertCount);

  // 取最优配对（排除同一场）
  let bestPair = null;
  for (const ca of candidatesA) {
    for (const cb of candidatesB) {
      if (ca.match.matchId === cb.match.matchId) continue;
      const productOdds = ca.dutchOdds * cb.dutchOdds;
      if (productOdds <= 1.0) continue;
      bestPair = { a: ca, b: cb, productOdds };
      break;
    }
    if (bestPair) break;
  }
  if (!bestPair) {
    skipCount++;
    continue;
  }

  totalSchemes++;

  const { a, b, productOdds } = bestPair;
  const ra = resultA(a.data.recs);
  const rb = resultB(b.data.recs, b.match.score);

  const won = ra === '✓' && rb === '✓';
  if (won) {
    totalWon++;
    const prize = Math.round(AMOUNT * productOdds);
    totalIncome += prize - AMOUNT;
  } else {
    totalIncome -= AMOUNT;
  }

  const matchA = a.match;
  const matchB = b.match;
  const homeA = matchA.homeName || matchA.home_name || '';
  const awayA = matchA.visitName || matchA.visit_name || '';
  const homeB = matchB.homeName || matchB.home_name || '';
  const awayB = matchB.visitName || matchB.visit_name || '';

  const statusIcon = won ? '✅' : '❌';
  const profitStr = won ? '+' + (Math.round(AMOUNT * productOdds) - AMOUNT) : '-' + AMOUNT;

  console.log(
    statusIcon +
      ' ' +
      ds.padEnd(12) +
      '┃ A:' +
      homeA.padEnd(6) +
      'vs ' +
      awayA.padEnd(6) +
      'B:' +
      homeB.padEnd(6) +
      'vs ' +
      awayB.padEnd(6) +
      '┃ 合赔 ' +
      productOdds.toFixed(2) +
      '┃ 平/让平=' +
      ra +
      '  进球2,3=' +
      rb +
      '┃ ' +
      profitStr +
      '元',
  );
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  📊 汇总: ' + allDates.length + ' 天 | 达标 ' + dayCount + ' 天 | 产出 ' + totalSchemes + ' 个方案');
console.log(
  '  命中 ' + totalWon + ' | 命中率 ' + (totalSchemes > 0 ? ((totalWon / totalSchemes) * 100).toFixed(1) : '0.0') + '%',
);
const sign = totalIncome >= 0 ? '+' : '';
console.log('  总盈亏: ' + sign + totalIncome + ' 元');
console.log('═══════════════════════════════════════════════════════════════');

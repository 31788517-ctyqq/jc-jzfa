/**
 * 世界杯方案定制回测 — 全量日（强制 WC 规则）
 * 规则: 各方案独立参数 + 独立盈利目标
 * 
 * 方案一: 平让平×让负, 2串1, ≥3场, 双前5, ≥10, 平赔有效, 盈≥80%
 * 方案二: 总进球23×让负, 2串1, ≥3场, 双前5, ≥10, ≥2.0, 让负≥10, 盈≥80%
 * 方案三: 胜×让负, 2串1, 不限, 第二前5, 胜≥50, ≥2.0, 盈≥30%
 * 方案四: 平让平×胜, 2串1, ≥3场, 双前5, 胜≥50, 盈≥30%
 * 方案五: 平让平×总进球23, 2串1, ≥4场, 双前5, A≥1.5,B>1.4(赔率), ≥1.8, 交叉, 盈≥80%
 * 方案六: 总进球23, 单关, ≥2场, 前6, tg23有效, 盈≥50%
 * 方案七: 胜平/平负, 单关, ≥1场, 无排行, ≥10, 单关场, 盈≥10%
 * 方案八: 胜, 单关, ≥1场, 前2, ≥50, 单关场, 盈≥5%
 */
const fs = require('fs');
const path = require('path');

const dataFile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'data.json'), 'utf8'));
const mMap = dataFile.m || {};
const rMap = dataFile.r || {};

const START = '2026-03-19';
const END = '2026-06-17';
const AMOUNT = 1000;

// ═══ 方案配置 ═══
const SCHEMES = {
  '1': { name: '方案一', profitPct: 0.10, topN: 7, minRecsA: 10, minRecsB: 10 },
  '2': { name: '方案二', profitPct: 0.80, topN: 5, minRecsA: 10, minRecsB: 10 },
  '3': { name: '方案三', profitPct: 0.30, topN: 5, minRecsA: 50 }, // 胜≥50
  '4': { name: '方案四', profitPct: 0.30, topN: 6, minRecsB: 20 }, // 胜≥20
  '5': { name: '方案五', profitPct: 0, topN: 7, minOddsA: 1.3, minOddsB: 1.3, minProd: 1.5 }, // ★ 无盈利过滤
  '6': { name: '方案六', profitPct: 0.50, topN: 6 },
  '7': { name: '方案七', profitPct: 0.10, topN: 0, minRecsA: 10 }, // 无排行
  '8': { name: '方案八', profitPct: 0.05, topN: 2, minRecsA: 50 }, // 前2, ≥50
};

function meetsSchemeProfit(plan, pct) {
  return plan.maxPrize >= AMOUNT * (1 + pct);
}

// ═══ 数据加载 ═══
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
    var json = JSON.parse(fs.readFileSync(p, 'utf8'));
    return (json && json.odds) ? json.odds : json;
  } catch (e) { return null; }
}

var dates = new Set();
Object.keys(mMap).forEach(function (k) {
  var m = mMap[k];
  if (m && m.date) { var d = m.date.slice(0, 10); if (d >= START && d <= END) dates.add(d); }
});
var sortedDates = Array.from(dates).sort();

// ═══ 工具函数 ═══
function isDirectionTopN(matchId, directions, topN, ranking) {
  if (topN <= 0) return true; // 无排行约束
  var dirs = Array.isArray(directions) ? directions : directions.split(/[、,]/).map(function (s) { return s.trim(); });
  var bestCount = 0;
  for (var i = 0; i < ranking.length; i++) {
    if (ranking[i].matchId === matchId && dirs.indexOf(ranking[i].direction) >= 0)
      bestCount = Math.max(bestCount, ranking[i].count);
  }
  if (bestCount === 0) return false;
  var seenCounts = {};
  for (var j = 0; j < ranking.length; j++) { if (ranking[j].count > bestCount) seenCounts[ranking[j].count] = true; }
  return Object.keys(seenCounts).length < topN;
}

function findBestMatchForDirection(directions, excludeIds, minCount, mList, mdm) {
  var bestMatch = null, bestCount = 0;
  for (var i = 0; i < mList.length; i++) {
    var m = mList[i];
    if (excludeIds && excludeIds.indexOf(m.matchId) >= 0) continue;
    var md = mdm[m.matchId];
    if (!md || !md.odds) continue;
    var total = 0;
    for (var j = 0; j < md.recs.length; j++) {
      if (directions.indexOf(md.recs[j].type) >= 0) total += md.recs[j].num || 0;
    }
    if (total > bestCount) { bestCount = total; bestMatch = m; }
  }
  if (minCount && bestCount < minCount) return null;
  return bestMatch;
}

function extractSubOdds(oddsObj, direction) {
  var vals = [];
  if (!oddsObj) return vals;
  if (direction.indexOf('总进球-') === 0) {
    var tg = oddsObj.totalGoals; if (!tg) return vals;
    var nums = direction.replace('总进球-', '').split(/[、,]/);
    nums.forEach(function (n) { var v = n.replace(/球/g, '').trim(); if (tg[v] !== undefined) vals.push(tg[v]); });
    return vals;
  }
  if (direction.indexOf('、') >= 0 || direction.indexOf(',') >= 0) {
    var parts = direction.split(/[、,]/);
    parts.forEach(function (pd) {
      pd = pd.trim();
      if (pd === '平' && oddsObj.spf) vals.push(oddsObj.spf.draw);
      else if (pd === '胜' && oddsObj.spf) vals.push(oddsObj.spf.home);
      else if (pd === '负' && oddsObj.spf) vals.push(oddsObj.spf.away);
      else if (pd === '让平' && oddsObj.rqspf) vals.push(oddsObj.rqspf.draw);
      else if (pd === '让负' && oddsObj.rqspf) vals.push(oddsObj.rqspf.away);
      else if (pd === '让胜' && oddsObj.rqspf) vals.push(oddsObj.rqspf.home);
    });
    return vals;
  }
  if (direction === '胜平' && oddsObj.spf) { vals.push(oddsObj.spf.home); vals.push(oddsObj.spf.draw); return vals; }
  if (direction === '平负' && oddsObj.spf) { vals.push(oddsObj.spf.draw); vals.push(oddsObj.spf.away); return vals; }
  if (direction === '让平' && oddsObj.rqspf) vals.push(oddsObj.rqspf.draw);
  else if (direction === '平' && oddsObj.spf) vals.push(oddsObj.spf.draw);
  else if (direction === '让负' && oddsObj.rqspf) vals.push(oddsObj.rqspf.away);
  else if (direction === '让胜' && oddsObj.rqspf) vals.push(oddsObj.rqspf.home);
  else if (direction === '胜' && oddsObj.spf) vals.push(oddsObj.spf.home);
  else if (direction === '负' && oddsObj.spf) vals.push(oddsObj.spf.away);
  return vals;
}

function calcEffectiveOdds(direction, oddsObj) {
  var subOdds = extractSubOdds(oddsObj || {}, direction);
  if (subOdds.length === 0) return null;
  if (subOdds.length === 1) return subOdds[0];
  var invSum = subOdds.reduce(function (a, b) { return a + 1 / b; }, 0);
  return invSum > 0 ? 1 / invSum : null;
}

function computePlanResult(matches) {
  var allWon = true, anyLose = false, anyUnknown = false;
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    if (m.isMatchWon === true) continue;
    if (m.isMatchLose === true) { anyLose = true; allWon = false; }
    else { anyUnknown = true; allWon = false; }
  }
  if (anyUnknown) return { isPlanWon: null, isPlanLose: null };
  if (allWon) return { isPlanWon: true, isPlanLose: false };
  return { isPlanWon: false, isPlanLose: true };
}

function getMatchOdds(m) {
  var md = m._md;
  if (md && md.odds) {
    var o = md.odds;
    return {
      spf: o.spf ? { home: o.spf.home, draw: o.spf.draw, away: o.spf.away } : null,
      rqspf: o.rqspf ? { home: o.rqspf.home, draw: o.rqspf.draw, away: o.rqspf.away, handicap: o.rqspf.handicap } : null,
      totalGoals: o.totalGoals || null, halfFull: o.halfFull || null,
    };
  }
  return null;
}

function buildMatchObj(m, direction) {
  var md = m._md, recs = md.recs;
  var expertCount = 0, isMatchWon = null, isMatchLose = null;
  var effectiveDir = direction;
  if (direction === '胜平') effectiveDir = '胜、平';
  else if (direction === '平负') effectiveDir = '平、负';
  var subDirs = effectiveDir.split(/[、,]/);
  var matchedRecsSet = new Set();
  var subResults = [];

  subDirs.forEach(function (subDir) {
    var sd = subDir.trim(); var found = null;
    for (var ri = 0; ri < recs.length; ri++) { if (recs[ri].type === sd) { found = recs[ri]; break; } }
    if (!found) {
      for (var rj = 0; rj < recs.length; rj++) {
        var parts = recs[rj].type.split(/[、,]/);
        if (parts.some(function (p) { return p.trim() === sd; })) { found = recs[rj]; break; }
      }
    }
    if (found) matchedRecsSet.add(found);
    subResults.push({ direction: sd, result: found ? found.result : null });
  });

  var matchedRecs = Array.from(matchedRecsSet);
  expertCount = matchedRecs.reduce(function (s, r) { return s + (r.num || 0); }, 0);

  var anyWon = false, anyLose = false, anyUnknown = false;
  matchedRecs.forEach(function (r) {
    if (r.result === 1) anyWon = true;
    else if (r.result === 0) anyLose = true;
    else anyUnknown = true;
  });
  if (!anyUnknown && matchedRecs.length > 0) { isMatchWon = anyWon; isMatchLose = !anyWon && anyLose; }

  if (isMatchWon === null && isMatchLose === null) {
    if (m.matchStatus >= 1 && m.score) {
      var mOdds = getMatchOdds(m);
      var hcp = mOdds && mOdds.rqspf ? mOdds.rqspf.handicap : null;
      function j(d, s, h) {
        if (d.indexOf('、') >= 0) { var p = d.split(/[、,]/); for (var pi = 0; pi < p.length; pi++) { if (j(p[pi].trim(), s, h)) return true; } return false; }
        var pp = String(s).replace(/[-:]/g, ':').split(':'); var hh = parseInt(pp[0]), aa = parseInt(pp[1]);
        if (isNaN(hh) || isNaN(aa)) return null;
        if (d === '胜') return hh > aa; if (d === '平') return hh === aa; if (d === '负') return hh < aa;
        if (d === '胜平') return hh > aa || hh === aa; if (d === '平负') return hh === aa || hh < aa;
        if (d === '让胜' || d === '让平' || d === '让负') { var ec = hh + (h != null ? parseFloat(h) || 0 : 0); if (d === '让胜') return ec > aa; if (d === '让平') return ec === aa; if (d === '让负') return ec < aa; }
        var gm = d.match(/总进球-(\d+)/); if (gm) return hh + aa === parseInt(gm[1]);
        return null;
      }
      var sr = j(direction, m.score, hcp);
      if (sr !== null) { isMatchWon = sr; isMatchLose = !sr; }
    }
  }
  return {
    matchId: m.matchId, homeName: m.homeName, visitName: m.visitName,
    leagueName: m.leagueName, matchNum: m.num || '', startTime: m.startTime || '',
    matchStatus: m.matchStatus || 0, direction: direction, expertCount: expertCount,
    isMatchWon: isMatchWon, isMatchLose: isMatchLose, subResults: subResults,
    odds: getMatchOdds(m), actualScore: (m.score || '').replace(/:/g, '-'),
  };
}

function make2x1Plan(id, sName, mA, dirA, mB, dirB, ds) {
  var aObj = buildMatchObj(mA, dirA), bObj = buildMatchObj(mB, dirB);
  var e1 = calcEffectiveOdds(dirA, aObj.odds), e2 = calcEffectiveOdds(dirB, bObj.odds);
  var productOdds = e1 && e2 ? e1 * e2 : 0;
  var maxPrize = e1 && e2 ? Math.round(AMOUNT * productOdds) : 0;
  var planResult = computePlanResult([aObj, bObj]);
  return {
    planId: 'plan_' + ds + '_' + id, name: 'plan_' + id, planName: sName,
    matches: [aObj, bObj], amount: AMOUNT, playType: '混合投注', matchCount: 2, passType: '2串1',
    betCount: 250, ticketCount: 10, multiplier: 25,
    maxPrize: maxPrize, winningPrize: planResult.isPlanWon === true ? maxPrize : 0,
    isPlanWon: planResult.isPlanWon, isPlanLose: planResult.isPlanLose,
    productOdds: productOdds,
  };
}

function makeSinglePlan(id, sName, m, direction, ds) {
  var mObj = buildMatchObj(m, direction);
  var subOdds = extractSubOdds(mObj.odds, direction);
  var invSum = subOdds.reduce(function (s, o) { return s + 1 / o; }, 0);
  var maxPrize = invSum > 0 ? Math.round(AMOUNT / invSum) : 0;
  var planResult = computePlanResult([mObj]);
  if (direction === '胜' && mObj.odds && mObj.odds.spf) maxPrize = Math.round(AMOUNT * mObj.odds.spf.home);
  return {
    planId: 'plan_' + ds + '_' + id, name: 'plan_' + id, planName: sName,
    matches: [mObj], amount: AMOUNT, playType: '单关', matchCount: 1, passType: '单关',
    betCount: 250, ticketCount: 10, multiplier: 25,
    maxPrize: maxPrize, winningPrize: planResult.isPlanWon === true ? maxPrize : 0,
    isPlanWon: planResult.isPlanWon, isPlanLose: planResult.isPlanLose,
    productOdds: maxPrize > 0 ? maxPrize / AMOUNT : 0,
  };
}

// ═══ 主回测 ═══
var totalPlans = 0, totalWon = 0, totalProfit = 0;
var planTypeStats = {};
var failedReasons = {};

console.log('══════════════════════════════════════════════════════════════');
console.log('  世界杯方案定制回测 (6月, 仅真实世界杯比赛)');
console.log('  各方案独立参数 + 独立盈利目标');
console.log('══════════════════════════════════════════════════════════════');
  console.log('  方案一: 前7,≥10,盈≥10%  |  方案二: 前5,≥10,≥2.0,盈≥80%');
console.log('  方案三: 前5,胜≥50,≥2.0,盈≥30%  |  方案四: 前6,胜≥20,盈≥30%');
console.log('  方案五: 前7,A≥1.3,B>1.3,≥1.5,无盈滤  |  方案六: 前6,盈≥50%');
console.log('  方案七: ≥10,盈≥10%  |  方案八: 前2,≥50,盈≥5%');
console.log('');
console.log('日期\t\t场\t方案\t日盈\t累计\t方案详情');
console.log('─'.repeat(90));

sortedDates.forEach(function (ds) {
  var mList = [];
  Object.keys(mMap).forEach(function (k) {
    var m = mMap[k];
    if (m && (m.date || '').slice(0, 10) === ds) {
      var copy = Object.assign({}, m);
      copy.leagueName = (copy.leagueName || '') + '_世界杯';
      mList.push(copy);
    }
  });
  if (mList.length === 0) return;

  var matchCount = mList.length;
  var odds = loadOdds(ds);
  var mdm = {};
  mList.forEach(function (m) {
    var raw = rMap['m_' + m.matchId] || rMap[String(m.matchId)] || [];
    var num = m.num || '';
    var od = odds && odds[num] ? odds[num] : null;
    var oddsObj = od ? {
      spf: od.spf || null, rqspf: od.rqspf || null,
      totalGoals: od.totalGoals || null, halfFull: od.halfFull || null,
      isSingleGame: od.isSingleGame || false,
    } : null;
    m._md = { match: m, recs: normalizeRecs(raw), odds: oddsObj };
    mdm[m.matchId] = m._md;
  });

  var ranking = [];
  mList.forEach(function (m) {
    var md = m._md; if (!md || !md.recs) return;
    md.recs.forEach(function (r) { if (!r.type || !r.num) return; ranking.push({ matchId: m.matchId, direction: r.type, count: r.num }); });
  });
  ranking.sort(function (a, b) { return b.count - a.count; });

  var hasRecs = ranking.length > 0;
  var plans = [];
  if (!hasRecs) { failedReasons['no-recs'] = (failedReasons['no-recs']||0)+1; }

  // ═══ 方案一：平、让平 × 让负 ═══
  if (hasRecs && matchCount >= 3) {
    var s1a = findBestMatchForDirection(['平', '让平'], null, SCHEMES['1'].minRecsA, mList, mdm);
    if (s1a) { var o1 = getMatchOdds(s1a); if (!o1 || !o1.spf || !o1.spf.draw || o1.spf.draw <= 0) s1a = null; }
    var s1b = s1a ? findBestMatchForDirection(['让负'], [s1a.matchId], SCHEMES['1'].minRecsB, mList, mdm) : null;
    if (s1a && s1b && isDirectionTopN(s1a.matchId, ['平', '让平'], SCHEMES['1'].topN, ranking) && isDirectionTopN(s1b.matchId, ['让负'], SCHEMES['1'].topN, ranking)) {
      var p1 = make2x1Plan('1', SCHEMES['1'].name, s1a, '平、让平', s1b, '让负', ds);
      if (meetsSchemeProfit(p1, SCHEMES['1'].profitPct)) plans.push(p1);
      else failedReasons['s1-' + Math.round(SCHEMES['1'].profitPct*100) + '%'] = (failedReasons['s1-80%']||0)+1;
    } else failedReasons['s1-no'] = (failedReasons['s1-no']||0)+1;
  }

  // ═══ 方案二：总进球-2、3球 × 让负 ═══
  if (hasRecs && matchCount >= 3) {
    var s2a = findBestMatchForDirection(['总进球-2、3球'], null, SCHEMES['2'].minRecsA, mList, mdm);
    if (s2a) { var tg2 = s2a._md && s2a._md.odds && s2a._md.odds.totalGoals; if (!tg2 || tg2['2'] == null || tg2['2'] <= 0 || tg2['3'] == null || tg2['3'] <= 0) s2a = null; }
    var s2b = s2a ? findBestMatchForDirection(['让负'], [s2a.matchId], SCHEMES['2'].minRecsB, mList, mdm) : null;
    if (s2a && s2b && isDirectionTopN(s2a.matchId, ['总进球-2、3球'], SCHEMES['2'].topN, ranking) && isDirectionTopN(s2b.matchId, ['让负'], SCHEMES['2'].topN, ranking)) {
      var p2 = make2x1Plan('2', SCHEMES['2'].name, s2a, '总进球-2、3球', s2b, '让负', ds);
      if (p2.productOdds >= 2.0 && meetsSchemeProfit(p2, SCHEMES['2'].profitPct)) plans.push(p2);
      else failedReasons['s2-no'] = (failedReasons['s2-no']||0)+1;
    } else failedReasons['s2-no'] = (failedReasons['s2-no']||0)+1;
  }

  // ═══ 方案三：胜 × 让负 ═══
  if (hasRecs) {
    var s3a = findBestMatchForDirection(['胜'], null, SCHEMES['3'].minRecsA, mList, mdm);
    var s3b = s3a ? findBestMatchForDirection(['让负'], [s3a.matchId], 0, mList, mdm) : null;
    if (s3a && s3b && isDirectionTopN(s3b.matchId, ['让负'], SCHEMES['3'].topN, ranking)) {
      var p3 = make2x1Plan('3', SCHEMES['3'].name, s3a, '胜', s3b, '让负', ds);
      if (p3.productOdds >= 2.0 && meetsSchemeProfit(p3, SCHEMES['3'].profitPct)) plans.push(p3);
      else failedReasons['s3-no'] = (failedReasons['s3-no']||0)+1;
    } else failedReasons['s3-no'] = (failedReasons['s3-no']||0)+1;
  }

  // ═══ 方案四：平、让平 × 胜 ═══
  if (hasRecs && matchCount >= 3) {
    var s4a = findBestMatchForDirection(['平', '让平'], null, 0, mList, mdm);
    var s4b = s4a ? findBestMatchForDirection(['胜'], [s4a.matchId], SCHEMES['4'].minRecsB, mList, mdm) : null;
    if (s4a && s4b && isDirectionTopN(s4a.matchId, ['平', '让平'], SCHEMES['4'].topN, ranking) && isDirectionTopN(s4b.matchId, ['胜'], SCHEMES['4'].topN, ranking)) {
      var p4 = make2x1Plan('4', SCHEMES['4'].name, s4a, '平、让平', s4b, '胜', ds);
      if (meetsSchemeProfit(p4, SCHEMES['4'].profitPct)) plans.push(p4);
      else failedReasons['s4-' + Math.round(SCHEMES['4'].profitPct*100) + '%'] = (failedReasons['s4-30%']||0)+1;
    } else failedReasons['s4-no'] = (failedReasons['s4-no']||0)+1;
  }

  // ═══ 方案五：平、让平 × 总进球-2、3球（交叉配对, 赔率门槛） ═══
  if (hasRecs && matchCount >= 4) {
    var candidatesA = [], candidatesB = [];
    mList.forEach(function (ma) {
      var md = ma._md; if (!md || !md.odds) return;
      var aObj = buildMatchObj(ma, '平、让平');
      var eA = calcEffectiveOdds('平、让平', aObj.odds);
      if (!eA || eA < SCHEMES['5'].minOddsA) return;
      var totalA = 0; md.recs.forEach(function (r) { if (r.type === '平' || r.type === '让平') totalA += r.num || 0; });
      if (totalA > 0 && isDirectionTopN(ma.matchId, ['平', '让平'], SCHEMES['5'].topN, ranking))
        candidatesA.push({ match: ma, count: totalA, odds: eA });
    });
    mList.forEach(function (mb) {
      var md = mb._md; if (!md || !md.odds || !md.odds.totalGoals) return;
      var tg = md.odds.totalGoals; if (tg['2'] == null || tg['2'] <= 0 || tg['3'] == null || tg['3'] <= 0) return;
      var bObj = buildMatchObj(mb, '总进球-2、3球');
      var eB = calcEffectiveOdds('总进球-2、3球', bObj.odds);
      if (!eB || eB <= SCHEMES['5'].minOddsB) return;
      var totalB = 0; md.recs.forEach(function (r) { if (r.type === '总进球-2、3球') totalB += r.num || 0; });
      if (totalB > 0 && isDirectionTopN(mb.matchId, ['总进球-2、3球'], SCHEMES['5'].topN, ranking))
        candidatesB.push({ match: mb, count: totalB, odds: eB });
    });
    var bestPair5 = null;
    candidatesA.forEach(function (ca) {
      candidatesB.forEach(function (cb) {
        if (ca.match.matchId === cb.match.matchId) return;
        var prod = ca.odds * cb.odds;
        var minProd = SCHEMES['5'].minProd || 1.8;
        if (prod < minProd) return;
        if (!bestPair5 || prod > bestPair5.productOdds) bestPair5 = { a: ca.match, b: cb.match, productOdds: prod };
      });
    });
    if (bestPair5) {
      var p5 = make2x1Plan('5', SCHEMES['5'].name, bestPair5.a, '平、让平', bestPair5.b, '总进球-2、3球', ds);
      if (meetsSchemeProfit(p5, SCHEMES['5'].profitPct)) plans.push(p5);
      else failedReasons['s5-80%'] = (failedReasons['s5-80%']||0)+1;
    } else failedReasons['s5-no'] = (failedReasons['s5-no']||0)+1;
  }

  // ═══ 方案六：总进球-2、3球 单关 ═══
  if (hasRecs && matchCount >= 2) {
    var bestM6 = null, bestCount6 = 0;
    mList.forEach(function (m) {
      var md = m._md; if (!md || !md.odds || !md.odds.totalGoals) return;
      if (md.odds.totalGoals['2'] == null || md.odds.totalGoals['3'] == null) return;
      var total6 = 0; md.recs.forEach(function (r) { if (r.type === '总进球-2、3球') total6 += r.num || 0; });
      if (total6 > bestCount6) { bestCount6 = total6; bestM6 = m; }
    });
    if (bestM6 && bestCount6 > 0 && isDirectionTopN(bestM6.matchId, ['总进球-2、3球'], SCHEMES['6'].topN, ranking)) {
      var p6 = makeSinglePlan('6', SCHEMES['6'].name, bestM6, '总进球-2、3球', ds);
      if (meetsSchemeProfit(p6, SCHEMES['6'].profitPct)) plans.push(p6);
      else failedReasons['s6-50%'] = (failedReasons['s6-50%']||0)+1;
    } else failedReasons['s6-no'] = (failedReasons['s6-no']||0)+1;
  }

  // ═══ 方案七：胜平/平负 单关 ═══
  if (hasRecs) {
    var singleMatches = mList.filter(function (m) { var md = m._md; return md && md.odds && md.odds.isSingleGame === true; });
    if (singleMatches.length > 0) {
      var bestM7 = null, bestM7Dir = '', bestM7Count = 0;
      singleMatches.forEach(function (sm) {
        sm._md.recs.forEach(function (r) { if ((r.type === '胜平' || r.type === '平负') && r.num > bestM7Count) { bestM7Count = r.num; bestM7 = sm; bestM7Dir = r.type; } });
      });
      if (bestM7 && bestM7Dir && bestM7Count >= SCHEMES['7'].minRecsA) {
        var p7 = makeSinglePlan('7', SCHEMES['7'].name, bestM7, bestM7Dir, ds);
        if (meetsSchemeProfit(p7, SCHEMES['7'].profitPct)) plans.push(p7);
        else failedReasons['s7-10%'] = (failedReasons['s7-10%']||0)+1;
      } else failedReasons['s7-no'] = (failedReasons['s7-no']||0)+1;
    } else failedReasons['s7-no-single'] = (failedReasons['s7-no-single']||0)+1;
  }

  // ═══ 方案八：胜 单关 (前2, ≥50) ═══
  if (hasRecs) {
    var singleM8 = mList.filter(function (m) { var md = m._md; return md && md.odds && md.odds.isSingleGame === true; });
    if (singleM8.length > 0) {
      var bestM8 = null, bestCount8 = 0;
      singleM8.forEach(function (sm) {
        sm._md.recs.forEach(function (r) { if (r.type === '胜' && r.num > bestCount8) { bestCount8 = r.num; bestM8 = sm; } });
      });
      if (bestM8 && bestCount8 >= SCHEMES['8'].minRecsA && isDirectionTopN(bestM8.matchId, ['胜'], SCHEMES['8'].topN, ranking)) {
        var p8 = makeSinglePlan('8', SCHEMES['8'].name, bestM8, '胜', ds);
        if (meetsSchemeProfit(p8, SCHEMES['8'].profitPct)) plans.push(p8);
        else failedReasons['s8-5%'] = (failedReasons['s8-5%']||0)+1;
      } else failedReasons['s8-no'] = (failedReasons['s8-no']||0)+1;
    } else failedReasons['s8-no-single'] = (failedReasons['s8-no-single']||0)+1;
  }

  // 比赛低于5场时最多只保留前2个方案
  if (matchCount < 5 && plans.length > 2) plans.splice(2);

  // 日盈利计算
  var dayProfit = 0;
  var dayPlanNames = [];
  plans.forEach(function (p) {
    if (p.isPlanWon === null && p.isPlanLose === null) return;
    if (!planTypeStats[p.name]) planTypeStats[p.name] = { total: 0, won: 0, profit: 0 };
    planTypeStats[p.name].total++;

    var result = '?';
    if (p.isPlanWon === true) {
      totalWon++; planTypeStats[p.name].won++;
      var profit = (p.winningPrize || 0) - AMOUNT;
      dayProfit += profit; planTypeStats[p.name].profit += profit;
      result = '✓';
    } else if (p.isPlanLose === true) {
      dayProfit -= AMOUNT; planTypeStats[p.name].profit -= AMOUNT;
      result = '✗';
    }
    dayPlanNames.push(p.planName + '(' + result + p.maxPrize + ')');
  });

  if (dayPlanNames.length > 0) {
    totalPlans += dayPlanNames.length;
    totalProfit += dayProfit;
    console.log(ds + '\t' + matchCount + '\t' + dayPlanNames.length + '\t' + dayProfit + '\t' + totalProfit + '\t' + dayPlanNames.join(' '));
  }
});

// ═══ 汇总 ═══
console.log('\n═══════════════════════════════════════════');
console.log('  汇总');
console.log('═══════════════════════════════════════════');
console.log('日期范围:', sortedDates[0], '~', sortedDates[sortedDates.length - 1], '(' + sortedDates.length + '天)');
console.log('总方案:', totalPlans);
console.log('命中:', totalWon);
console.log('命中率:', totalPlans > 0 ? ((totalWon / totalPlans) * 100).toFixed(1) + '%' : 'N/A');
console.log('总盈利:', totalProfit, '分 (', (totalProfit / 100).toFixed(2), '元)');
console.log('总投入:', totalPlans * AMOUNT, '分 (', ((totalPlans * AMOUNT) / 100).toFixed(2), '元)');
console.log('ROI:', totalPlans > 0 ? ((totalProfit / (totalPlans * AMOUNT)) * 100).toFixed(1) + '%' : 'N/A');

console.log('\n── 按方案类型 ──');
var planNames = {};
for (var pk in SCHEMES) planNames['plan_' + pk] = SCHEMES[pk].name;
Object.keys(planTypeStats).sort().forEach(function (k) {
  var s = planTypeStats[k];
  var hitRate = s.total > 0 ? ((s.won / s.total) * 100).toFixed(1) + '%' : '-';
  console.log((planNames[k] || k).padEnd(8), '总数=' + String(s.total).padEnd(4), '命中=' + String(s.won).padEnd(4), '命中率=' + hitRate.padEnd(8), '盈利=' + s.profit);
});

console.log('\n── 失败原因统计 ──');
Object.keys(failedReasons).sort(function (a, b) { return failedReasons[b] - failedReasons[a]; }).forEach(function (r) {
  console.log('  ' + r + ': ' + failedReasons[r] + '次');
});

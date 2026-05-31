/**
 * server/core/plan-generator.js
 * 方案生成共享模块 — 比分方案 + 量化方案的核心算法
 *
 * 供以下 handler 复用：
 *   - score-plan-list  (比分方案展示)
 *   - quant-plan-list  (量化方案展示)
 *   - income-stats     (方案收入统计)
 */

// ═══ 比分方案 ═══

/**
 * 筛选比赛是否满足比分方案生成条件
 * @param {Object} item - { gs: 功守道缓存数据 }
 * @returns {Object|false} 筛选结果或 false
 */
function qualifyMatch(item) {
  var gs = item.gs;
  if (!gs) return false;
  var consensus = gs.fusionConsensus || '';
  if (consensus === 'meltdown') return false;
  var weakThreshold = (consensus === 'weak');
  var stabilityOverall = parseFloat(gs.stabilityOverall) || 0;
  var bigBallRatio = parseFloat(gs.bigBallRatio) || 0;
  var overRate = (gs.goalRange && gs.goalRange.overRate) ? parseFloat(gs.goalRange.overRate) : 0;
  var totalExpect = parseFloat(gs.totalGoalsExpect) || 0;
  var isOver = bigBallRatio > 30 || overRate > 35 || totalExpect >= 2.0;
  if (!isOver) return false;
  var attRaw = parseFloat(gs.attackAdvantageRaw) || 0;
  var defRaw = parseFloat(gs.defenseAdvantageRaw) || 0;
  if (attRaw * defRaw <= 0) return false;
  var attAbs = Math.abs(attRaw), defAbs = Math.abs(defRaw);
  if (attAbs <= 0.03 || defAbs <= 0.005) return false;
  var strongIsHome = attRaw > 0;
  var xgHome = parseFloat(gs.xgHome) || 0;
  var xgAway = parseFloat(gs.xgAway) || 0;
  var xgDiff = Math.abs(xgHome - xgAway);
  if (xgDiff < 0.6) return false;
  if (weakThreshold && (stabilityOverall < 55 || xgDiff < 1.0)) return false;
  var weakXg = strongIsHome ? xgAway : xgHome;
  if (weakXg > 1.5) return false;
  return { strongIsHome: strongIsHome, bigBallRatio: bigBallRatio, xgHome: xgHome, xgAway: xgAway, consensus: consensus, stabilityOverall: stabilityOverall };
}

/**
 * 构建比分概率映射
 */
function buildScorePercentMap(gs) {
  if (!gs || !gs.scores || gs.scores.length === 0) return null;
  var map = {};
  gs.scores.forEach(function(s) { if (s && s.score && typeof s.percent !== 'undefined') map[s.score] = parseFloat(s.percent) || 0; });
  return Object.keys(map).length > 0 ? map : null;
}

/**
 * 荷兰式均分组合生成（2~4 个比分）
 */
function dutchCombinations(oddsMap, totalCapital, strongIsHome, useBfOdds, qual) {
  var scorePercentMap = (qual && qual.scorePercentMap) || null;
  var goalUpper = (qual && qual.goalUpper) || 0;
  var xgHome = (qual && qual.xgHome) || 0, xgAway = (qual && qual.xgAway) || 0;
  var xgDiff = Math.abs(xgHome - xgAway), totalStrength = (qual && qual.totalStrength) || 0, absStrength = Math.abs(totalStrength);
  var weakXg = strongIsHome ? xgAway : xgHome;
  var matchType = 'normal';
  if (absStrength > 0.25 && xgDiff > 1.2) matchType = 'crush';
  else if (absStrength > 0.2 && weakXg > 0.8) matchType = 'attack-crush';
  else if (absStrength <= 0.2 || xgDiff <= 1.0) matchType = 'narrow';
  var preferred = [], drawCandidates = [], allCandidates = [];
  Object.keys(oddsMap).forEach(function(score) {
    var parts = score.split('-'); if (parts.length !== 2) return;
    var h = parseInt(parts[0]), a = parseInt(parts[1]);
    if (isNaN(h) || isNaN(a)) return;
    allCandidates.push(score);
    var strongWin = strongIsHome ? (h - a >= 1) : (a - h >= 1);
    if (strongWin) {
      if (matchType === 'crush') { if ((strongIsHome ? a : h) === 0) preferred.push(score); }
      else if (matchType === 'narrow') { if (Math.abs(h - a) <= 2) preferred.push(score); }
      else { if ((strongIsHome ? a : h) <= 1) preferred.push(score); }
    }
    if (goalUpper >= 4 && h === a && h >= 2) drawCandidates.push(score);
  });
  var candidates = preferred.length >= 2 ? preferred.slice() : allCandidates.slice();
  if (goalUpper >= 4 && drawCandidates.length > 0) { drawCandidates.forEach(function(ds) { if (candidates.indexOf(ds) < 0) candidates.push(ds); }); }
  if (candidates.length < 2) return [];
  candidates.sort(function(a, b) { return (oddsMap[a] || 100) - (oddsMap[b] || 100); });
  var results = [];
  function tryCombos(r, start, chosen) {
    if (chosen.length >= 2 && chosen.length <= 4) {
      var invSum = 0, coverageSum = 0;
      for (var i = 0; i < chosen.length; i++) {
        var odd2 = oddsMap[chosen[i]]; if (!odd2 || odd2 <= 0) return;
        invSum += 1 / odd2;
        if (useBfOdds) coverageSum += 1 / odd2;
        else if (scorePercentMap && typeof scorePercentMap[chosen[i]] !== 'undefined') coverageSum += parseFloat(scorePercentMap[chosen[i]]) || 0;
      }
      if (invSum > 0) {
        var expectedReturn = totalCapital / invSum;
        var minR = useBfOdds ? 1.8 : (chosen.length === 2 ? 2.0 : (chosen.length === 3 ? 1.6 : 1.4));
        var minCoverage = useBfOdds ? 0.30 : 25;
        if (coverageSum >= minCoverage && expectedReturn >= totalCapital * minR && expectedReturn <= totalCapital * 2.5) {
          var combo = chosen.slice(), weights = [];
          for (var j = 0; j < combo.length; j++) {
            var o2 = oddsMap[combo[j]], w = 1 / o2;
            var parts3 = combo[j].split('-');
            if (parts3[0] === parts3[1] && goalUpper >= 4) w *= 0.8;
            weights.push(w);
          }
          var adjInvSum = weights.reduce(function(a, b) { return a + b; }, 0);
          var allocations = [];
          for (var k = 0; k < combo.length; k++) allocations.push(Math.round(totalCapital * weights[k] / adjInvSum));
          var allocSum = allocations.reduce(function(a, b) { return a + b; }, 0);
          if (allocSum !== totalCapital) allocations[allocations.length - 1] += (totalCapital - allocSum);
          results.push({ scores: combo.map(function(s, si) { return { score: s, odds: oddsMap[s], allocation: allocations[si] }; }), expectedReturn: Math.round(expectedReturn), comboLength: combo.length, coverage: coverageSum });
        }
      }
    }
    if (r <= 0 || chosen.length >= 4) return;
    for (var i = start; i < candidates.length; i++) { chosen.push(candidates[i]); tryCombos(r - 1, i + 1, chosen); chosen.pop(); }
  }
  tryCombos(candidates.length, 0, []);
  results.sort(function(a, b) { return a.comboLength === 3 ? -1 : (b.comboLength === 3 ? 1 : a.comboLength - b.comboLength); });
  return results;
}

/**
 * 比分方案多维质量评分
 */
function computeScoreQuality(gs, qual) {
  var score = 0;
  score += Math.min(25, (parseFloat(gs.bigBallRatio) || 0) / 4);
  var xgDiff = Math.abs(qual.xgHome - qual.xgAway);
  score += Math.min(25, xgDiff / 2.0 * 25);
  score += Math.min(20, (parseFloat(gs.stabilityOverall) || 0) / 5);
  var consensus = gs.fusionConsensus || '';
  if (consensus === 'strong') score += 20;
  else if (consensus === 'weak') score += 10;
  else if (consensus === 'none' || !consensus) score += 5;
  if ((parseFloat(gs.leagueAvgGoals) || 0) > 2.85) score += 10;
  else if ((parseFloat(gs.leagueAvgGoals) || 0) > 2.5) score += 5;
  return Math.min(100, Math.round(score));
}

// ═══ 量化方案 ═══

/**
 * 获取比赛赔率（SPF）
 */
function getMatchOdds(m, odArg, allplaysArg) {
  var num = m.num || '';
  if (odArg && odArg[num]) return odArg[num];
  var ap = allplaysArg || {};
  var k = 'num_' + num;
  if (ap[k]) return ap[k];
  if (m.matchId && ap[m.matchId]) return ap[m.matchId];
  return null;
}

/**
 * 冷门方向验证（结合赔率 + 模型信号）
 */
function getColdDirection(modds, gs) {
  var totalStrength = gs && gs.totalStrength != null ? parseFloat(gs.totalStrength) : 0;
  var consensus = gs ? (gs.fusionConsensus || '') : '';
  var directions = [
    { dir: '胜', odds: parseFloat(modds.spf.home), signal: 0 },
    { dir: '平', odds: parseFloat(modds.spf.draw), signal: 0 },
    { dir: '负', odds: parseFloat(modds.spf.away), signal: 0 }
  ];
  if (Math.abs(totalStrength) < 0.15) directions.forEach(function(d) { if (d.dir === '平') d.signal += 2.5; });
  if (consensus.indexOf('weak') >= 0 || consensus.indexOf('弱') >= 0) directions.forEach(function(d) { d.signal += 1.5; });
  if (consensus.indexOf('meltdown') >= 0 || consensus.indexOf('熔断') >= 0) directions.forEach(function(d) { d.signal += 0.5; });
  directions.sort(function(a, b) { return b.odds - a.odds; });
  var highestDir = directions[0];
  var impliedProb = 1 / highestDir.odds;
  var strengthGap = Math.abs(totalStrength);
  if (strengthGap < 0.2 && impliedProb < 0.15) highestDir.signal += 2.0;
  if (strengthGap < 0.1 && highestDir.dir !== '平') highestDir.signal += 1.0;
  directions.sort(function(a, b) { return b.odds - a.odds; });
  var oddsRankScore = [3, 2, 1];
  directions.forEach(function(d, i) { d.finalScore = oddsRankScore[i] * 0.6 + d.signal * 0.4; });
  directions.sort(function(a, b) { return b.finalScore - a.finalScore; });
  return directions[0];
}

/**
 * 多维冷门评分
 */
function computeColdScore(hi, gs, modds, coldDir) {
  var score = 0;
  var totalStrength = gs && gs.totalStrength != null ? parseFloat(gs.totalStrength) : 0;
  var consensus = gs ? (gs.fusionConsensus || '') : '';
  if (hi !== null && hi !== undefined) score += Math.max(0, (0.85 - hi) / 0.85) * 30;
  else score += 15;
  var tsAbs = Math.abs(totalStrength);
  score += Math.max(0, (0.3 - tsAbs) / 0.3) * 25;
  if (consensus.indexOf('weak') >= 0 || consensus.indexOf('弱') >= 0) score += 15;
  if (consensus.indexOf('meltdown') >= 0 || consensus.indexOf('熔断') >= 0) score += 5;
  if (!consensus) score += 8;
  var coldImplied = 1 / coldDir.odds;
  if (coldImplied >= 0.10 && coldImplied <= 0.25) score += 12;
  else if (coldImplied > 0.25 && coldImplied <= 0.35) score += 7;
  else if (coldImplied > 0.08 && coldImplied < 0.10) score += 5;
  else score += 2;
  if (consensus.indexOf('strong') >= 0 || consensus.indexOf('强') >= 0) score += 0;
  else score += 5;
  return Math.min(100, Math.round(score));
}

/**
 * 解析开球时间
 */
function parseKickoffTime(startTime) {
  if (!startTime) return null;
  try { var ts = new Date(startTime.replace('T', ' ')).getTime(); return isNaN(ts) ? null : ts; }
  catch (e) { return null; }
}

/**
 * 组合相关性检测（同一联赛 / 时间接近 / 同一球队）
 */
function checkCorrelation(ca, cb) {
  var warnings = [];
  var leagueA = (ca.leagueName || '').trim(), leagueB = (cb.leagueName || '').trim();
  if (leagueA && leagueB && leagueA === leagueB) warnings.push('同联赛');
  var timeA = parseKickoffTime(ca.startTime), timeB = parseKickoffTime(cb.startTime);
  if (timeA && timeB && Math.abs(timeA - timeB) < 5400000) warnings.push('开球时间接近');
  var homeA = (ca.homeName || '').trim(), awayA = (ca.visitName || '').trim();
  var homeB = (cb.homeName || '').trim(), awayB = (cb.visitName || '').trim();
  if (homeA && homeB && (homeA === homeB || homeA === awayB || awayA === homeB || awayA === awayB)) warnings.push('同一球队');
  var riskLevel = warnings.length >= 2 ? 'high' : warnings.length === 1 ? 'medium' : 'low';
  return { riskLevel: riskLevel, warnings: warnings };
}

/**
 * 量化方案单场结果判定
 * @param {string} matchId
 * @param {string} direction - 冷门方向（"胜"/"平"/"负"）
 * @param {Object} rMap - data.json 的 rMap
 * @param {Function} normalizeRecs - recs 标准化函数
 * @returns {{isWon: boolean|null, isLose: boolean|null}}
 */
function checkMatchResult(matchId, direction, rMap, normalizeRecs) {
  var key = matchId;
  var raw = rMap['m_' + key] || rMap[String(key)] || [];
  var recs = normalizeRecs(raw);
  var isMatchWon = null, isMatchLose = null;

  var effectiveDir = direction;
  if (direction === '胜平') effectiveDir = '胜、平';
  else if (direction === '平负') effectiveDir = '平、负';
  var subDirs = effectiveDir.split(/[、,]/);

  function recContains(recType, sd) {
    if (recType === sd) return true;
    var parts = recType.split(/[、,]/);
    return parts.some(function(p) { return p.trim() === sd; });
  }

  var matchedSet = [];
  for (var si = 0; si < subDirs.length; si++) {
    var sd = subDirs[si].trim();
    var found = null;
    for (var ri = 0; ri < recs.length; ri++) { if (recs[ri].type === sd) { found = recs[ri]; break; } }
    if (!found) { for (var rj = 0; rj < recs.length; rj++) { if (recContains(recs[rj].type, sd)) { found = recs[rj]; break; } } }
    if (found && matchedSet.indexOf(found) < 0) matchedSet.push(found);
    else if (!found) matchedSet.push({ type: sd, result: null });
  }

  if (matchedSet.length === 0) {
    for (var rk = 0; rk < recs.length; rk++) {
      var rt = recs[rk].type || '';
      if (rt.indexOf(direction) >= 0 || direction.indexOf(rt) >= 0) matchedSet.push(recs[rk]);
    }
  }

  var anyWon = false, anyLose = false, anyUnknown = false;
  for (var mi = 0; mi < matchedSet.length; mi++) {
    if (matchedSet[mi].result === 1) anyWon = true;
    else if (matchedSet[mi].result === 0) anyLose = true;
    else anyUnknown = true;
  }
  if (!anyUnknown) { isMatchWon = anyWon; isMatchLose = !anyWon && anyLose; }
  return { isWon: isMatchWon, isLose: isMatchLose };
}

// ═══ 导出 ═══
module.exports = {
  // 比分方案
  qualifyMatch,
  buildScorePercentMap,
  dutchCombinations,
  computeScoreQuality,
  // 量化方案
  getMatchOdds,
  getColdDirection,
  computeColdScore,
  checkCorrelation,
  parseKickoffTime,
  checkMatchResult
};

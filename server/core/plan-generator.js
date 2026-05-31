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
  const gs = item.gs;
  if (!gs) return false;
  const consensus = gs.fusionConsensus || '';
  if (consensus === 'meltdown') return false;
  const weakThreshold = consensus === 'weak';
  const stabilityOverall = parseFloat(gs.stabilityOverall) || 0;
  const bigBallRatio = parseFloat(gs.bigBallRatio) || 0;
  const overRate = gs.goalRange && gs.goalRange.overRate ? parseFloat(gs.goalRange.overRate) : 0;
  const totalExpect = parseFloat(gs.totalGoalsExpect) || 0;
  const isOver = bigBallRatio > 30 || overRate > 35 || totalExpect >= 2.0;
  if (!isOver) return false;
  const attRaw = parseFloat(gs.attackAdvantageRaw) || 0;
  const defRaw = parseFloat(gs.defenseAdvantageRaw) || 0;
  if (attRaw * defRaw <= 0) return false;
  const attAbs = Math.abs(attRaw),
    defAbs = Math.abs(defRaw);
  if (attAbs <= 0.03 || defAbs <= 0.005) return false;
  const strongIsHome = attRaw > 0;
  const xgHome = parseFloat(gs.xgHome) || 0;
  const xgAway = parseFloat(gs.xgAway) || 0;
  const xgDiff = Math.abs(xgHome - xgAway);
  if (xgDiff < 0.6) return false;
  if (weakThreshold && (stabilityOverall < 55 || xgDiff < 1.0)) return false;
  const weakXg = strongIsHome ? xgAway : xgHome;
  if (weakXg > 1.5) return false;
  return {
    strongIsHome: strongIsHome,
    bigBallRatio: bigBallRatio,
    xgHome: xgHome,
    xgAway: xgAway,
    consensus: consensus,
    stabilityOverall: stabilityOverall,
  };
}

/**
 * 构建比分概率映射
 */
function buildScorePercentMap(gs) {
  if (!gs || !gs.scores || gs.scores.length === 0) return null;
  const map = {};
  gs.scores.forEach(function (s) {
    if (s && s.score && typeof s.percent !== 'undefined') map[s.score] = parseFloat(s.percent) || 0;
  });
  return Object.keys(map).length > 0 ? map : null;
}

/**
 * 荷兰式均分组合生成（2~4 个比分）
 */
function dutchCombinations(oddsMap, totalCapital, strongIsHome, useBfOdds, qual) {
  const scorePercentMap = (qual && qual.scorePercentMap) || null;
  const goalUpper = (qual && qual.goalUpper) || 0;
  const xgHome = (qual && qual.xgHome) || 0,
    xgAway = (qual && qual.xgAway) || 0;
  const xgDiff = Math.abs(xgHome - xgAway),
    totalStrength = (qual && qual.totalStrength) || 0,
    absStrength = Math.abs(totalStrength);
  const weakXg = strongIsHome ? xgAway : xgHome;
  let matchType = 'normal';
  if (absStrength > 0.25 && xgDiff > 1.2) matchType = 'crush';
  else if (absStrength > 0.2 && weakXg > 0.8) matchType = 'attack-crush';
  else if (absStrength <= 0.2 || xgDiff <= 1.0) matchType = 'narrow';
  const preferred = [],
    drawCandidates = [],
    allCandidates = [];
  Object.keys(oddsMap).forEach(function (score) {
    const parts = score.split('-');
    if (parts.length !== 2) return;
    const h = parseInt(parts[0]),
      a = parseInt(parts[1]);
    if (isNaN(h) || isNaN(a)) return;
    allCandidates.push(score);
    const strongWin = strongIsHome ? h - a >= 1 : a - h >= 1;
    if (strongWin) {
      if (matchType === 'crush') {
        if ((strongIsHome ? a : h) === 0) preferred.push(score);
      } else if (matchType === 'narrow') {
        if (Math.abs(h - a) <= 2) preferred.push(score);
      } else {
        if ((strongIsHome ? a : h) <= 1) preferred.push(score);
      }
    }
    if (goalUpper >= 4 && h === a && h >= 2) drawCandidates.push(score);
  });
  const candidates = preferred.length >= 2 ? preferred.slice() : allCandidates.slice();
  if (goalUpper >= 4 && drawCandidates.length > 0) {
    drawCandidates.forEach(function (ds) {
      if (candidates.indexOf(ds) < 0) candidates.push(ds);
    });
  }
  if (candidates.length < 2) return [];
  candidates.sort(function (a, b) {
    return (oddsMap[a] || 100) - (oddsMap[b] || 100);
  });
  const results = [];
  function tryCombos(r, start, chosen) {
    if (chosen.length >= 2 && chosen.length <= 4) {
      let invSum = 0,
        coverageSum = 0;
      for (var i = 0; i < chosen.length; i++) {
        const odd2 = oddsMap[chosen[i]];
        if (!odd2 || odd2 <= 0) return;
        invSum += 1 / odd2;
        if (useBfOdds) coverageSum += 1 / odd2;
        else if (scorePercentMap && typeof scorePercentMap[chosen[i]] !== 'undefined')
          coverageSum += parseFloat(scorePercentMap[chosen[i]]) || 0;
      }
      if (invSum > 0) {
        const expectedReturn = totalCapital / invSum;
        const minR = useBfOdds ? 1.8 : chosen.length === 2 ? 2.0 : chosen.length === 3 ? 1.6 : 1.4;
        const minCoverage = useBfOdds ? 0.3 : 25;
        if (
          coverageSum >= minCoverage &&
          expectedReturn >= totalCapital * minR &&
          expectedReturn <= totalCapital * 2.5
        ) {
          const combo = chosen.slice(),
            weights = [];
          for (let j = 0; j < combo.length; j++) {
            let o2 = oddsMap[combo[j]],
              w = 1 / o2;
            const parts3 = combo[j].split('-');
            if (parts3[0] === parts3[1] && goalUpper >= 4) w *= 0.8;
            weights.push(w);
          }
          const adjInvSum = weights.reduce(function (a, b) {
            return a + b;
          }, 0);
          const allocations = [];
          for (let k = 0; k < combo.length; k++) allocations.push(Math.round((totalCapital * weights[k]) / adjInvSum));
          const allocSum = allocations.reduce(function (a, b) {
            return a + b;
          }, 0);
          if (allocSum !== totalCapital) allocations[allocations.length - 1] += totalCapital - allocSum;
          results.push({
            scores: combo.map(function (s, si) {
              return { score: s, odds: oddsMap[s], allocation: allocations[si] };
            }),
            expectedReturn: Math.round(expectedReturn),
            comboLength: combo.length,
            coverage: coverageSum,
          });
        }
      }
    }
    if (r <= 0 || chosen.length >= 4) return;
    for (var i = start; i < candidates.length; i++) {
      chosen.push(candidates[i]);
      tryCombos(r - 1, i + 1, chosen);
      chosen.pop();
    }
  }
  tryCombos(candidates.length, 0, []);
  results.sort(function (a, b) {
    return a.comboLength === 3 ? -1 : b.comboLength === 3 ? 1 : a.comboLength - b.comboLength;
  });
  return results;
}

/**
 * 比分方案多维质量评分
 */
function computeScoreQuality(gs, qual) {
  let score = 0;
  score += Math.min(25, (parseFloat(gs.bigBallRatio) || 0) / 4);
  const xgDiff = Math.abs(qual.xgHome - qual.xgAway);
  score += Math.min(25, (xgDiff / 2.0) * 25);
  score += Math.min(20, (parseFloat(gs.stabilityOverall) || 0) / 5);
  const consensus = gs.fusionConsensus || '';
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
  const num = m.num || '';
  if (odArg && odArg[num]) return odArg[num];
  const ap = allplaysArg || {};
  const k = 'num_' + num;
  if (ap[k]) return ap[k];
  if (m.matchId && ap[m.matchId]) return ap[m.matchId];
  return null;
}

/**
 * 冷门方向验证（结合赔率 + 模型信号）
 */
function getColdDirection(modds, gs) {
  const totalStrength = gs && gs.totalStrength != null ? parseFloat(gs.totalStrength) : 0;
  const consensus = gs ? gs.fusionConsensus || '' : '';
  const directions = [
    { dir: '胜', odds: parseFloat(modds.spf.home), signal: 0 },
    { dir: '平', odds: parseFloat(modds.spf.draw), signal: 0 },
    { dir: '负', odds: parseFloat(modds.spf.away), signal: 0 },
  ];
  if (Math.abs(totalStrength) < 0.15)
    directions.forEach(function (d) {
      if (d.dir === '平') d.signal += 2.5;
    });
  if (consensus.indexOf('weak') >= 0 || consensus.indexOf('弱') >= 0)
    directions.forEach(function (d) {
      d.signal += 1.5;
    });
  if (consensus.indexOf('meltdown') >= 0 || consensus.indexOf('熔断') >= 0)
    directions.forEach(function (d) {
      d.signal += 0.5;
    });
  directions.sort(function (a, b) {
    return b.odds - a.odds;
  });
  const highestDir = directions[0];
  const impliedProb = 1 / highestDir.odds;
  const strengthGap = Math.abs(totalStrength);
  if (strengthGap < 0.2 && impliedProb < 0.15) highestDir.signal += 2.0;
  if (strengthGap < 0.1 && highestDir.dir !== '平') highestDir.signal += 1.0;
  directions.sort(function (a, b) {
    return b.odds - a.odds;
  });
  const oddsRankScore = [3, 2, 1];
  directions.forEach(function (d, i) {
    d.finalScore = oddsRankScore[i] * 0.6 + d.signal * 0.4;
  });
  directions.sort(function (a, b) {
    return b.finalScore - a.finalScore;
  });
  return directions[0];
}

/**
 * 多维冷门评分
 */
function computeColdScore(hi, gs, modds, coldDir) {
  let score = 0;
  const totalStrength = gs && gs.totalStrength != null ? parseFloat(gs.totalStrength) : 0;
  const consensus = gs ? gs.fusionConsensus || '' : '';
  if (hi !== null && hi !== undefined) score += Math.max(0, (0.85 - hi) / 0.85) * 30;
  else score += 15;
  const tsAbs = Math.abs(totalStrength);
  score += Math.max(0, (0.3 - tsAbs) / 0.3) * 25;
  if (consensus.indexOf('weak') >= 0 || consensus.indexOf('弱') >= 0) score += 15;
  if (consensus.indexOf('meltdown') >= 0 || consensus.indexOf('熔断') >= 0) score += 5;
  if (!consensus) score += 8;
  const coldImplied = 1 / coldDir.odds;
  if (coldImplied >= 0.1 && coldImplied <= 0.25) score += 12;
  else if (coldImplied > 0.25 && coldImplied <= 0.35) score += 7;
  else if (coldImplied > 0.08 && coldImplied < 0.1) score += 5;
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
  try {
    const ts = new Date(startTime.replace('T', ' ')).getTime();
    return isNaN(ts) ? null : ts;
  } catch (e) {
    return null;
  }
}

/**
 * 组合相关性检测（同一联赛 / 时间接近 / 同一球队）
 */
function checkCorrelation(ca, cb) {
  const warnings = [];
  const leagueA = (ca.leagueName || '').trim(),
    leagueB = (cb.leagueName || '').trim();
  if (leagueA && leagueB && leagueA === leagueB) warnings.push('同联赛');
  const timeA = parseKickoffTime(ca.startTime),
    timeB = parseKickoffTime(cb.startTime);
  if (timeA && timeB && Math.abs(timeA - timeB) < 5400000) warnings.push('开球时间接近');
  const homeA = (ca.homeName || '').trim(),
    awayA = (ca.visitName || '').trim();
  const homeB = (cb.homeName || '').trim(),
    awayB = (cb.visitName || '').trim();
  if (homeA && homeB && (homeA === homeB || homeA === awayB || awayA === homeB || awayA === awayB))
    warnings.push('同一球队');
  const riskLevel = warnings.length >= 2 ? 'high' : warnings.length === 1 ? 'medium' : 'low';
  return { riskLevel: riskLevel, warnings: warnings };
}

/**
 * 比分直判 fallback — 当推荐数据无 result 时，用比赛比分直接判定方向对错
 * @param {string} direction - 方向（胜/平/负/让胜/让平/让负/胜平/平负/总进球-N等）
 * @param {string} scoreStr  - 比分字符串（如 "5:0" 或 "5-0"）
 * @param {number|string|null} handicap - 让球数（odds.rqspf.handicap），非让球可传 null
 * @returns {boolean|null} true=命中, false=未中, null=无法判定
 */
function judgeByScore(direction, scoreStr, handicap) {
  if (!scoreStr || !direction) return null;
  const parts = String(scoreStr).replace(/[-:]/g, ':').split(':');
  const hg = parseInt(parts[0]);
  const ag = parseInt(parts[1]);
  if (isNaN(hg) || isNaN(ag)) return null;

  // SPF 基础方向
  if (direction === '胜') return hg > ag;
  if (direction === '平') return hg === ag;
  if (direction === '负') return hg < ag;

  // 双选
  if (direction === '胜平') return hg > ag || hg === ag;
  if (direction === '平负') return hg === ag || hg < ag;

  // RQSPF（需要让球数）
  if (direction === '让胜' || direction === '让平' || direction === '让负') {
    const hcp = handicap != null ? parseFloat(handicap) || 0 : 0;
    const effective = hg + hcp;
    if (direction === '让胜') return effective > ag;
    if (direction === '让平') return effective === ag;
    if (direction === '让负') return effective < ag;
  }

  // 总进球（如 "总进球-2", "总进球-3"）
  const goalMatch = direction.match(/总进球-(\d+)/);
  if (goalMatch) {
    return (hg + ag) === parseInt(goalMatch[1]);
  }

  return null;
}

/**
 * 量化方案单场结果判定
 * @param {string} matchId
 * @param {string} direction - 冷门方向（"胜"/"平"/"负"）
 * @param {Object} rMap - data.json 的 rMap
 * @param {Function} normalizeRecs - recs 标准化函数
 * @param {Object} mMap - data.json 的 mMap（用于比分 fallback）
 * @returns {{isWon: boolean|null, isLose: boolean|null}}
 */
function checkMatchResult(matchId, direction, rMap, normalizeRecs, mMap) {
  const key = matchId;
  const raw = rMap['m_' + key] || rMap[String(key)] || [];
  const recs = normalizeRecs(raw);
  let isMatchWon = null,
    isMatchLose = null;

  let effectiveDir = direction;
  if (direction === '胜平') effectiveDir = '胜、平';
  else if (direction === '平负') effectiveDir = '平、负';
  const subDirs = effectiveDir.split(/[、,]/);

  function recContains(recType, sd) {
    if (recType === sd) return true;
    const parts = recType.split(/[、,]/);
    return parts.some(function (p) {
      return p.trim() === sd;
    });
  }

  const matchedSet = [];
  for (let si = 0; si < subDirs.length; si++) {
    const sd = subDirs[si].trim();
    let found = null;
    for (let ri = 0; ri < recs.length; ri++) {
      if (recs[ri].type === sd) {
        found = recs[ri];
        break;
      }
    }
    if (!found) {
      for (let rj = 0; rj < recs.length; rj++) {
        if (recContains(recs[rj].type, sd)) {
          found = recs[rj];
          break;
        }
      }
    }
    if (found && matchedSet.indexOf(found) < 0) matchedSet.push(found);
    else if (!found) matchedSet.push({ type: sd, result: null });
  }

  if (matchedSet.length === 0) {
    for (let rk = 0; rk < recs.length; rk++) {
      const rt = recs[rk].type || '';
      if (rt.indexOf(direction) >= 0 || direction.indexOf(rt) >= 0) matchedSet.push(recs[rk]);
    }
  }

  let anyWon = false,
    anyLose = false,
    anyUnknown = false;
  for (let mi = 0; mi < matchedSet.length; mi++) {
    if (matchedSet[mi].result === 1) anyWon = true;
    else if (matchedSet[mi].result === 0) anyLose = true;
    else anyUnknown = true;
  }
  if (!anyUnknown) {
    isMatchWon = anyWon;
    isMatchLose = !anyWon && anyLose;
  }

  // ★ fallback: 推荐数据无 result 时，用比分直判方向对错
  if (isMatchWon === null && isMatchLose === null) {
    const matchKey = 'm_' + String(matchId);
    const m = mMap ? (mMap[matchKey] || mMap[String(matchId)] || null) : null;
    if (m && m.matchStatus >= 2 && m.score) {
      const scoreResult = judgeByScore(direction, m.score, null);
      if (scoreResult !== null) {
        isMatchWon = scoreResult;
        isMatchLose = !scoreResult;
      }
    }
  }

  return { isWon: isMatchWon, isLose: isMatchLose };
}

// ═══ 增强筛选集成 ═══

/**
 * 使用增强筛选器处理方案
 * @param {Array} selections - 投注项列表
 * @param {Array} passways - 过关方式
 * @param {Object} filters - 筛选配置
 * @param {number} multiplier - 倍数
 * @returns {Object} 筛选结果
 */
function applyEnhancedFilters(selections, passways, filters, multiplier) {
  const betFilters = require('./bet-scheme-filters');
  return betFilters.applySchemeFilters(selections, passways, filters, multiplier);
}

/**
 * 方案风险评估
 * @param {Array} selections - 投注项列表
 * @param {Array} passways - 过关方式
 * @param {Object} scheme - 方案信息
 * @returns {Object} 风险评估结果
 */
function assessSchemeRisk(selections, passways, scheme) {
  const betFilters = require('./bet-scheme-filters');
  const estimate = betFilters.estimateScheme(selections, passways, parseInt(scheme.multiplier || 1));

  const flags = [], explains = [];

  if (estimate.selectionCount <= 0) {
    flags.push('empty_scheme');
    explains.push('方案为空，当前没有可提交的投注项。');
  }
  if (estimate.matchCount >= 6) {
    flags.push('long_combo');
    explains.push('当前方案已达到高串关区间，波动显著增大。');
  }
  if (estimate.matchCount >= 7) {
    flags.push('ultra_long_combo');
    explains.push('方案包含 7+ 串关，建议人工复核。');
  }

  const budgetLimit = parseFloat(scheme.budgetLimit || scheme.budget_limit || 0);
  if (budgetLimit > 0 && estimate.amount > budgetLimit) {
    flags.push('budget_limit_exceeded');
    explains.push('方案预计金额超过预算上限。');
  }

  const lowConfidence = selections.filter(function (s) {
    return parseFloat(s.confidence || 0) < 0.45;
  });
  if (lowConfidence.length > 0) {
    flags.push('low_confidence_selection');
    explains.push('部分投注项置信度偏低 (共' + lowConfidence.length + '个)。');
  }

  const nonPositiveEdge = selections.filter(function (s) {
    return parseFloat(s.edgeValue || s.edge_value || 0) <= 0;
  });
  if (nonPositiveEdge.length > 0) {
    flags.push('non_positive_edge');
    explains.push('部分投注项 edge 非正，建议谨慎下单 (共' + nonPositiveEdge.length + '个)。');
  }

  const fallbackItems = selections.filter(function (s) {
    const ctx = s.context || s.contextJson || {};
    return ctx.fallback;
  });
  if (fallbackItems.length > 0) {
    flags.push('fallback_data_present');
    explains.push('部分投注项仍依赖 fallback 数据。');
  }

  const gateStatus = flags.length === 0 ? 'suggested' : 'pending';

  return {
    schemeId: scheme.schemeId || scheme.scheme_id,
    gateStatus: gateStatus,
    riskFlags: flags,
    summary: {
      matchCount: estimate.matchCount,
      selectionCount: estimate.selectionCount,
      ticketCount: estimate.ticketCount,
      amount: estimate.amount,
      maxBonus: estimate.maxBonus,
      passways: estimate.passways,
    },
    explains: explains.length > 0 ? explains : ['方案结构正常，可以进入人工审批。'],
  };
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
  checkMatchResult,
  judgeByScore,
  // 增强筛选
  applyEnhancedFilters,
  assessSchemeRisk,
};

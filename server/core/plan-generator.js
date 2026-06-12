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
/**
 * 解析共识类型（优先 fusionConsensusType 英文码，降级中文标签映射）
 */
function resolveConsensusType(gs) {
  const ct = gs.fusionConsensusType;
  if (ct === 'strong' || ct === 'weak' || ct === 'meltdown') return ct;
  const cn = gs.fusionConsensus || '';
  if (cn === 'meltdown' || cn.startsWith('熔断')) return 'meltdown';
  if (cn === 'weak' || cn.startsWith('弱一致')) return 'weak';
  if (cn === 'strong' || cn.startsWith('强一致')) return 'strong';
  return '';
}

function qualifyMatch(item) {
  const gs = item.gs;
  if (!gs) return false;
  const consensus = resolveConsensusType(gs);
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
        else if (qual && qual.calibratedScoreMap && typeof qual.calibratedScoreMap[chosen[i]] !== 'undefined')
          // ★ V9.0: 优先使用校准后的比分概率（data-fusion 校准）
          coverageSum += parseFloat(qual.calibratedScoreMap[chosen[i]]) || 0;
        else if (scorePercentMap && typeof scorePercentMap[chosen[i]] !== 'undefined')
          coverageSum += parseFloat(scorePercentMap[chosen[i]]) || 0;
      }
      if (invSum > 0) {
        const baseExpectedReturn = totalCapital / invSum;
        const minR = useBfOdds ? 1.8 : chosen.length === 2 ? 2.0 : chosen.length === 3 ? 1.6 : 1.4;
        const minCoverage = useBfOdds ? 0.3 : 25;
        if (
          coverageSum >= minCoverage &&
          baseExpectedReturn >= totalCapital * minR &&
          baseExpectedReturn <= totalCapital * 2.5
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
            baseExpectedReturn: Math.round(baseExpectedReturn),
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
  const consensus = resolveConsensusType(gs);
  if (consensus === 'strong') score += 20;
  else if (consensus === 'weak') score += 10;
  else if (consensus === 'none' || !consensus) score += 5;
  if ((parseFloat(gs.leagueAvgGoals) || 0) > 2.85) score += 10;
  else if ((parseFloat(gs.leagueAvgGoals) || 0) > 2.5) score += 5;
  return Math.min(100, Math.round(score));
}

// ═══ 量化方案 ═══

/**
 * 获取比赛赔率（优先SP → odds_history → allplays）
 * SPF未开售时返回null，方案生成自然跳过
 */
function getMatchOdds(m, odArg, allplaysArg) {
  const num = m.num || '';
  const date = (m.date || '').slice(0, 10);
  let result = null;

  // 尝试 SP 官方
  try {
    const sp = require('./sp_data_adapter');
    const spOdds = sp.getOdds(num, date);
    if (spOdds) {
      result = {
        spf: spOdds.spf || {},
        rqspf: spOdds.rqspf || {},
        handicap: spOdds.handicap,
        totalGoals: spOdds.jqs || {},
        halfFull: spOdds.bqc || {},
        scores: {},
        source: 'sp_official',
      };
    }
  } catch (e) {}

  // 回退: 传入odds / allplays
  if (!result) {
    if (odArg && odArg[num]) result = odArg[num];
    else {
      const ap = allplaysArg || {};
      const k = 'num_' + num;
      if (ap[k]) result = ap[k];
      else if (m.matchId && ap[m.matchId]) result = ap[m.matchId];
    }
  }

  if (!result || !result.spf || (result.spf.home == null && result.spf.draw == null && result.spf.away == null)) {
    return null; // SPF未开售 → 不参与方案生成
  }

  // 确保三个值都存在
  result.spf.home = result.spf.home != null ? result.spf.home : 1.01;
  result.spf.draw = result.spf.draw != null ? result.spf.draw : 1.01;
  result.spf.away = result.spf.away != null ? result.spf.away : 1.01;

  return result;
}

/**
 * 冷门方向验证（结合赔率 + 模型信号）
 * ★ V9.1: spfStatus=derived/pending 时降级处理
 */
function getColdDirection(modds, gs) {
  if (!modds || !modds.spf) return null;
  const spf = modds.spf;
  const totalStrength = gs && gs.totalStrength != null ? parseFloat(gs.totalStrength) : 0;
  const consensus = gs ? gs.fusionConsensus || '' : '';

  // null-safe odds
  const homeOdds = spf.home != null ? parseFloat(spf.home) : 0;
  const drawOdds = spf.draw != null ? parseFloat(spf.draw) : 0;
  const awayOdds = spf.away != null ? parseFloat(spf.away) : 0;

  if (!homeOdds || !drawOdds || !awayOdds) return null;

  const directions = [
    { dir: '胜', odds: homeOdds, signal: 0 },
    { dir: '平', odds: drawOdds, signal: 0 },
    { dir: '负', odds: awayOdds, signal: 0 },
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

  // ★ 复合方向（含、号，如"平、让平"）：分开判定，任一命中即可
  if (direction.indexOf('、') >= 0) {
    const subParts = direction.split(/[、,]/);
    for (let pi = 0; pi < subParts.length; pi++) {
      const subR = judgeByScore(subParts[pi].trim(), scoreStr, handicap);
      if (subR === true) return true;
    }
    return false;
  }

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
    return hg + ag === parseInt(goalMatch[1]);
  }

  // ★ 总进球复合方向子项（如 "3球"、"4球" — "总进球-2、3球" 拆分后）
  const simpleGoalMatch = direction.match(/^(\d+)球$/);
  if (simpleGoalMatch) {
    return hg + ag === parseInt(simpleGoalMatch[1]);
  }

  // ★ 半全场方向（如 "半全场-平平" → 半场平 + 全场平）
  // 注意: judgeByScore 没有半场比分数据，仅能从全场比分判定平/胜/负
  // 半全场组合需要半场比分才能准确判定，此处返回 null 由调用方 fallback
  const hfMatch = direction.match(/^半全场-(.+)$/);
  if (hfMatch) {
    const pattern = hfMatch[1]; // 如 "平平", "平负", "平胜", "胜胜" 等
    // 仅判定全场部分：pattern 第二个字
    const fullChar = pattern.slice(-1);
    if (fullChar === '胜') return hg > ag;
    if (fullChar === '平') return hg === ag;
    if (fullChar === '负') return hg < ag;
    return null;
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
    const m = mMap ? mMap[matchKey] || mMap[String(matchId)] || null : null;
    if (m && m.matchStatus >= 1 && m.score) {
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

  const flags = [],
    explains = [];

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

// ═══ 专家博热方案 (方案一~七) ═══

/**
 * 生成专家博热方案（方案一~七）— plan-list 和 income-stats 共用
 * @param {Array} mList - 当日比赛列表
 * @param {Object} matchDataMap - { matchId: { match, recs, odds } }
 *   odds 格式: { spf:{home,draw,away}|null, rqspf:{home,draw,away,handicap}|null, totalGoals:{...}|null, halfFull:{...}|null, isSingleGame:bool }
 * @param {string} dateStr - 日期 YYYY-MM-DD
 * @returns {Array} 方案对象数组
 */
function generateExpertPlans(mList, matchDataMap, dateStr) {
  const matchCount = mList.length;
  const plans = [];

  // ── 世界杯检测与方向排行（基于 recs 数据自建排行，无需外部 API）──
  const isWorldCup = mList.some(function (m) {
    return (m.leagueName || '').indexOf('世界杯') >= 0;
  });

  var _wcRankingCache = null;
  function getWCRanking() {
    if (_wcRankingCache) return _wcRankingCache;
    var entries = [];
    for (var mi = 0; mi < mList.length; mi++) {
      var m = mList[mi];
      var md = matchDataMap[m.matchId];
      if (!md || !md.recs) continue;
      for (var ri = 0; ri < md.recs.length; ri++) {
        var r = md.recs[ri];
        if (!r.type || !r.num) continue;
        entries.push({ matchId: m.matchId, direction: r.type, count: r.num });
      }
    }
    entries.sort(function (a, b) {
      return b.count - a.count;
    });
    _wcRankingCache = entries;
    return entries;
  }

  // 检查某场比赛的指定方向是否在当日排行前 topN（基于所有比赛全部方向的推荐人数排序）
  function isDirectionTopN(matchId, directions, topN) {
    var ranking = getWCRanking();
    var dirs = Array.isArray(directions)
      ? directions
      : directions.split(/[、,]/).map(function (s) {
          return s.trim();
        });
    var bestCount = 0;
    for (var i = 0; i < ranking.length; i++) {
      if (ranking[i].matchId === matchId && dirs.indexOf(ranking[i].direction) >= 0) {
        bestCount = Math.max(bestCount, ranking[i].count);
      }
    }
    if (bestCount === 0) return false;
    // 统计比 bestCount 严格大的不同计数值
    var seenCounts = {};
    for (var j = 0; j < ranking.length; j++) {
      if (ranking[j].count > bestCount) seenCounts[ranking[j].count] = true;
    }
    var higherUnique = Object.keys(seenCounts).length;
    return higherUnique < topN;
  }

  // 获取某场比赛指定复合方向的总推荐人数
  function getWCDirectionCount(matchId, directions) {
    var md = matchDataMap[matchId];
    if (!md || !md.recs) return 0;
    var dirs = Array.isArray(directions)
      ? directions
      : directions.split(/[、,]/).map(function (s) {
          return s.trim();
        });
    var total = 0;
    for (var i = 0; i < md.recs.length; i++) {
      if (dirs.indexOf(md.recs[i].type) >= 0) total += md.recs[i].num || 0;
    }
    return total;
  }

  // ── 工具函数 ──

  function findRecommends(matchId) {
    const md = matchDataMap[matchId];
    return md ? md.recs : [];
  }

  // 标准化赔率（供 buildMatchObj.odds 使用）
  function getMatchOdds(match) {
    const md = matchDataMap[match.matchId];
    const od = md && md.odds;
    if (od) {
      return {
        spf: od.spf ? { home: od.spf.home, draw: od.spf.draw, away: od.spf.away } : null,
        rqspf: od.rqspf
          ? { home: od.rqspf.home, draw: od.rqspf.draw, away: od.rqspf.away, handicap: od.rqspf.handicap }
          : null,
        totalGoals: od.totalGoals || null,
        halfFull: od.halfFull || null,
      };
    }
    return null;
  }

  function extractSubOdds(oddsObj, direction) {
    const vals = [];
    if (direction.indexOf('总进球-') === 0) {
      const tg = oddsObj.totalGoals;
      if (!tg) return vals;
      const nums = direction.replace('总进球-', '').split(/[、,]/);
      nums.forEach((n) => {
        const v = n.replace(/球/g, '').trim();
        if (tg[v] !== undefined) vals.push(tg[v]);
      });
      return vals;
    }
    if (direction.indexOf('、') >= 0 || direction.indexOf(',') >= 0) {
      if (direction.indexOf('半全场-') === 0) {
        const hfParts = direction.split(/[、,]/);
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
        hfParts.forEach((pd) => {
          pd = pd.trim();
          if (pd.indexOf('半全场-') === 0) pd = pd.substring(4);
          const hfKey = hfMap[pd];
          if (hfKey && oddsObj.halfFull && oddsObj.halfFull[hfKey] !== undefined) vals.push(oddsObj.halfFull[hfKey]);
        });
        return vals;
      }
      const parts = direction.split(/[、,]/);
      parts.forEach((pd) => {
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
    if (direction === '胜平' && oddsObj.spf) {
      vals.push(oddsObj.spf.home);
      vals.push(oddsObj.spf.draw);
      return vals;
    }
    if (direction === '平负' && oddsObj.spf) {
      vals.push(oddsObj.spf.draw);
      vals.push(oddsObj.spf.away);
      return vals;
    }
    if (direction === '让平' && oddsObj.rqspf) vals.push(oddsObj.rqspf.draw);
    else if (direction === '平' && oddsObj.spf) vals.push(oddsObj.spf.draw);
    else if (direction === '让负' && oddsObj.rqspf) vals.push(oddsObj.rqspf.away);
    else if (direction === '让胜' && oddsObj.rqspf) vals.push(oddsObj.rqspf.home);
    else if (direction === '胜' && oddsObj.spf) vals.push(oddsObj.spf.home);
    else if (direction === '负' && oddsObj.spf) vals.push(oddsObj.spf.away);
    return vals;
  }

  function findBestMatchForDirection(directions, excludeIds, minCount) {
    let bestMatch = null,
      bestCount = 0;
    for (const m of mList) {
      if (excludeIds && excludeIds.indexOf(m.matchId) >= 0) continue;
      const md = matchDataMap[m.matchId];
      if (!md || !md.odds) continue;
      const recs = md.recs;
      let total = 0;
      for (const r of recs) {
        if (directions.indexOf(r.type) >= 0) total += r.num || 0;
      }
      if (total > bestCount) {
        bestCount = total;
        bestMatch = m;
      }
    }
    if (minCount && bestCount < minCount) return null;
    return bestMatch;
  }

  function buildMatchObj(m, direction) {
    const recs = findRecommends(m.matchId);
    let expertCount = 0,
      isMatchWon = null,
      isMatchLose = null;
    let effectiveDir = direction;
    if (direction === '胜平') effectiveDir = '胜、平';
    else if (direction === '平负') effectiveDir = '平、负';
    const subDirs = effectiveDir.split(/[、,]/);
    const matchedRecsSet = new Set();
    const subResults = [];

    function recContains(recType, sd) {
      if (recType === sd) return true;
      const parts = recType.split(/[、,]/);
      return parts.some((p) => p.trim() === sd);
    }

    subDirs.forEach((subDir) => {
      const sd = subDir.trim();
      let found = null;
      for (const r of recs) {
        if (r.type === sd) {
          found = r;
          break;
        }
      }
      if (!found) {
        for (const r of recs) {
          if (recContains(r.type, sd)) {
            found = r;
            break;
          }
        }
      }
      if (!found && sd.indexOf('球') >= 0) {
        const num = sd.replace(/球/g, '');
        for (const r of recs) {
          if (r.type === '总进球-' + num) {
            found = r;
            break;
          }
        }
      }
      if (found) matchedRecsSet.add(found);
      subResults.push({ direction: sd, result: found ? found.result : null });
    });

    if (matchedRecsSet.size === 0) {
      for (const r of recs) {
        const rt = r.type || '';
        if (rt.indexOf(direction) >= 0 || direction.indexOf(rt) >= 0) matchedRecsSet.add(r);
      }
      if (matchedRecsSet.size === 0 && subResults.length === 0) {
        subResults.push({ direction: direction, result: null });
      }
    }

    // 总进球双选：用实际比分拆分子方向命中
    if (direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0 && subResults.length >= 2) {
      const combinedRes = subResults[0].result;
      if (combinedRes === 0) {
        subResults.forEach((sr) => {
          sr.result = 0;
        });
      } else if (combinedRes === 1 && m.score) {
        const scoreParts = String(m.score).replace(/[-:]/g, ':').split(':');
        const totalGoals = parseInt(scoreParts[0]) + parseInt(scoreParts[1]);
        if (!isNaN(totalGoals)) {
          subResults.forEach((sr) => {
            const goalMatch = sr.direction.match(/(\d+)/);
            if (goalMatch && parseInt(goalMatch[1]) === totalGoals) sr.result = 1;
            else sr.result = 0;
          });
        }
      }
    }

    const matchedRecs = Array.from(matchedRecsSet);
    expertCount = matchedRecs.reduce((s, r) => s + (r.num || 0), 0);

    let anyWon = false,
      anyLose = false,
      anyUnknown = false;
    if (direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0 && subResults.length >= 2) {
      let hasKnown = false;
      for (const sr of subResults) {
        if (sr.result === 1) {
          anyWon = true;
          hasKnown = true;
        } else if (sr.result === 0) {
          anyLose = true;
          hasKnown = true;
        } else anyUnknown = true;
      }
      if (!hasKnown) anyWon = false;
    } else {
      matchedRecs.forEach((r) => {
        if (r.result === 1) anyWon = true;
        else if (r.result === 0) anyLose = true;
        else anyUnknown = true;
      });
    }
    if (!anyUnknown && matchedRecs.length > 0) {
      isMatchWon = anyWon;
      isMatchLose = !anyWon && anyLose;
    }

    // fallback: 推荐数据无 result 时，用比分+赔率直判方向对错
    if (isMatchWon === null && isMatchLose === null) {
      if (m && m.matchStatus >= 1 && m.score) {
        const mData = matchDataMap[m.matchId];
        const mOdds = mData ? mData.odds : null;
        const hcp = mOdds && mOdds.rqspf ? mOdds.rqspf.handicap : null;
        function judgeScoreExp(d, s, h) {
          if (d.indexOf('、') >= 0) {
            var parts = d.split(/[、,]/);
            for (var pi = 0; pi < parts.length; pi++) {
              if (judgeScoreExp(parts[pi].trim(), s, h)) return true;
            }
            return false;
          }
          var p = String(s).replace(/[-:]/g, ':').split(':');
          var hh = parseInt(p[0]);
          var aa = parseInt(p[1]);
          if (isNaN(hh) || isNaN(aa)) return null;
          if (d === '胜') return hh > aa;
          if (d === '平') return hh === aa;
          if (d === '负') return hh < aa;
          if (d === '胜平') return hh > aa || hh === aa;
          if (d === '平负') return hh === aa || hh < aa;
          if (d === '让胜' || d === '让平' || d === '让负') {
            var ec = hh + (h != null ? parseFloat(h) || 0 : 0);
            if (d === '让胜') return ec > aa;
            if (d === '让平') return ec === aa;
            if (d === '让负') return ec < aa;
          }
          var gm = d.match(/总进球-(\d+)/);
          if (gm) return hh + aa === parseInt(gm[1]);
          var hfMatch = d.match(/^半全场-(.+)$/);
          if (hfMatch) {
            var fullChar = hfMatch[1].slice(-1);
            if (fullChar === '胜') return hh > aa;
            if (fullChar === '平') return hh === aa;
            if (fullChar === '负') return hh < aa;
            return null;
          }
          return null;
        }
        var scoreResult = judgeScoreExp(direction, m.score, hcp);
        if (scoreResult !== null) {
          isMatchWon = scoreResult;
          isMatchLose = !scoreResult;
          for (var sri2 = 0; sri2 < subResults.length; sri2++) {
            var sd2 = subResults[sri2].direction;
            var sr2 = judgeScoreExp(sd2, m.score, hcp);
            if (sr2 !== null) subResults[sri2].result = sr2 ? 1 : 0;
            else if (sd2 === direction || sd2.indexOf(direction) >= 0 || direction.indexOf(sd2) >= 0)
              subResults[sri2].result = isMatchWon ? 1 : 0;
          }
        }
      }
    }

    // 最终兜底：isMatchWon 已确定但 subResults 仍有 null 时同步
    if (isMatchWon !== null && isMatchLose !== null) {
      var isPlan6Multi = direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0;
      for (var sri3 = 0; sri3 < subResults.length; sri3++) {
        if (subResults[sri3].result === null || subResults[sri3].result === undefined) {
          if (isPlan6Multi && isMatchWon && (!m.score || m.score === '')) {
            subResults[sri3].result = null;
          } else {
            subResults[sri3].result = isMatchWon ? 1 : 0;
          }
        }
      }
    }

    var actualScore = '';
    if (isMatchWon !== null || isMatchLose !== null) {
      actualScore = (m.score || '').replace(/:/g, '-');
    }

    return {
      matchId: m.matchId,
      homeName: m.homeName,
      visitName: m.visitName,
      leagueName: m.leagueName,
      matchNum: m.num || '',
      startTime: m.startTime || '',
      matchStatus: m.matchStatus || 0,
      direction: direction,
      expertCount: expertCount,
      isMatchWon: isMatchWon,
      isMatchLose: isMatchLose,
      subResults: subResults,
      odds: getMatchOdds(m),
      actualScore: actualScore,
    };
  }

  function calcEffectiveOdds(direction, match) {
    const oddsObj = match.odds || {};
    const subOdds = extractSubOdds(oddsObj, direction);
    if (subOdds.length === 0) {
      if (direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0) {
        const nSelections = direction.split(/[、,]/).length || 2;
        return 3.5 / nSelections;
      }
      return null;
    }
    const N = subOdds.length;
    if (N === 1) return subOdds[0];
    const invSum = subOdds.reduce((a, b) => a + 1 / b, 0);
    return invSum > 0 ? 1 / invSum : null;
  }

  function computePlanResult(matches) {
    let allWon = true,
      anyLose = false,
      anyUnknown = false;
    for (const m of matches) {
      if (m.isMatchWon === true) continue;
      if (m.isMatchLose === true) {
        anyLose = true;
        allWon = false;
      } else {
        anyUnknown = true;
        allWon = false;
      }
    }
    if (anyUnknown) return { isPlanWon: null, isPlanLose: null };
    if (allWon) return { isPlanWon: true, isPlanLose: false };
    return { isPlanWon: false, isPlanLose: true };
  }

  function push2MatchPlan(planName, planSuffix, mA, dirA, mB, dirB, betCount, ticketCount, multiplier, minProductOdds) {
    if (!mA || !mB) return;
    const aObj = buildMatchObj(mA, dirA);
    const bObj = buildMatchObj(mB, dirB);
    const e1 = calcEffectiveOdds(dirA, aObj);
    const e2 = calcEffectiveOdds(dirB, bObj);
    const productOdds = e1 && e2 ? e1 * e2 : 0;
    if (minProductOdds && productOdds < minProductOdds) return;
    const maxPrize = e1 && e2 ? Math.round(1000 * productOdds) : 0;

    const planResult = computePlanResult([aObj, bObj]);
    const winningPrize = planResult.isPlanWon === true ? maxPrize : 0;

    plans.push({
      planId: 'plan_' + dateStr + '_' + planSuffix,
      name: 'plan_' + planSuffix,
      planName: planName,
      matches: [aObj, bObj],
      amount: 1000,
      playType: '混合投注',
      matchCount: 2,
      passType: '2串1',
      betCount: betCount,
      ticketCount: ticketCount,
      multiplier: multiplier || 25,
      maxPrize: maxPrize,
      winningPrize: winningPrize,
      isPlanWon: planResult.isPlanWon,
      isPlanLose: planResult.isPlanLose,
    });
  }

  // ── 生成方案 ──

  if (isWorldCup) {
    // ═══ 世界杯方案一：平、让平 × 让负（≤3场，双场均前3，各≥10，平赔率有效）═══
    if (matchCount <= 3) {
      var _wc1a = findBestMatchForDirection(['平', '让平'], null, 10);
      // 平赔率门禁：spf.draw 必须有效
      if (_wc1a) {
        var _wc1Odds = getMatchOdds(_wc1a);
        if (!_wc1Odds || !_wc1Odds.spf || !_wc1Odds.spf.draw || _wc1Odds.spf.draw <= 0) _wc1a = null;
      }
      var _wc1b = findBestMatchForDirection(['让负'], _wc1a ? [_wc1a.matchId] : null, 10);
      if (
        _wc1a &&
        _wc1b &&
        isDirectionTopN(_wc1a.matchId, ['平', '让平'], 3) &&
        isDirectionTopN(_wc1b.matchId, ['让负'], 3)
      ) {
        push2MatchPlan('方案一', '1', _wc1a, '平、让平', _wc1b, '让负', 250, 10);
      }
    }

    // ═══ 世界杯方案二：总进球-2、3球 × 让负（≤3场，双场均前3，各≥10，合赔≥2.0）═══
    if (matchCount <= 3) {
      var _wc2a = findBestMatchForDirection(['总进球-2、3球'], null, 10);
      // totalGoals[2][3] 赔率有效性检查
      if (_wc2a) {
        var _wc2md = matchDataMap[_wc2a.matchId];
        var _wc2tg = _wc2md && _wc2md.odds && _wc2md.odds.totalGoals;
        if (!_wc2tg || _wc2tg['2'] == null || _wc2tg['2'] <= 0 || _wc2tg['3'] == null || _wc2tg['3'] <= 0) _wc2a = null;
      }
      var _wc2b = findBestMatchForDirection(['让负'], _wc2a ? [_wc2a.matchId] : null, 10);
      if (
        _wc2a &&
        _wc2b &&
        isDirectionTopN(_wc2a.matchId, ['总进球-2、3球'], 3) &&
        isDirectionTopN(_wc2b.matchId, ['让负'], 3)
      ) {
        push2MatchPlan('方案二', '2', _wc2a, '总进球-2、3球', _wc2b, '让负', 250, 10, 25, 2.0);
      }
    }

    // ═══ 世界杯方案三：胜 × 让负（第二场前3，胜≥35，合赔≥2.0）═══
    var _wc3a = findBestMatchForDirection(['胜'], null, 35);
    var _wc3b = findBestMatchForDirection(['让负'], _wc3a ? [_wc3a.matchId] : null);
    if (_wc3a && _wc3b && isDirectionTopN(_wc3b.matchId, ['让负'], 3)) {
      push2MatchPlan('方案三', '3', _wc3a, '胜', _wc3b, '让负', 250, 10, 25, 2.0);
    }
  } else {
    // ═══ 常规方案一～三 ═══
    const m1a = findBestMatchForDirection(['平', '让平']);
    const m1b = findBestMatchForDirection(['让负'], m1a ? [m1a.matchId] : null);
    const m2a = findBestMatchForDirection(['总进球-2、3球']);
    const m2b = findBestMatchForDirection(['让负'], m2a ? [m2a.matchId] : null, 10);
    const m3a = findBestMatchForDirection(['胜'], null, 35);
    const m3b = findBestMatchForDirection(['让负'], m3a ? [m3a.matchId] : null);

    push2MatchPlan('方案一', '1', m1a, '平、让平', m1b, '让负', 250, 10);
    push2MatchPlan('方案二', '2', m2a, '总进球-2、3球', m2b, '让负', 250, 10, 25, 2.0);
    push2MatchPlan('方案三', '3', m3a, '胜', m3b, '让负', 250, 10, 25, 2.0);
  }

  // 方案六：当天专家推"总进球-2、3球"数最多的一场，单关荷兰式投注
  if (isWorldCup ? matchCount >= 2 : matchCount >= 2) {
    const targetDir6 = '总进球-2、3球';
    let bestM6 = null,
      bestCount6 = 0;
    for (const m of mList) {
      const recs = findRecommends(m.matchId);
      const md = matchDataMap[m.matchId];
      if (!md || !md.odds || !md.odds.totalGoals) continue;
      if (md.odds.totalGoals['2'] == null || md.odds.totalGoals['3'] == null) continue;
      let total6 = 0;
      for (const r of recs) {
        if (r.type === targetDir6) total6 += r.num || 0;
      }
      if (total6 > bestCount6) {
        bestCount6 = total6;
        bestM6 = m;
      }
    }
    // 世界杯：该场方向需排前3
    if (bestM6 && bestCount6 > 0 && (!isWorldCup || isDirectionTopN(bestM6.matchId, [targetDir6], 3))) {
      const m6Obj = buildMatchObj(bestM6, targetDir6);
      const subOdds6 = extractSubOdds(m6Obj.odds, targetDir6);
      if (subOdds6.length === 2) {
        const invSum6 = subOdds6.reduce((s, o) => s + 1 / o, 0);
        const maxPrize6 = invSum6 > 0 ? Math.round(1000 / invSum6) : 0;
        const plan6Result = computePlanResult([m6Obj]);
        plans.push({
          planId: 'plan_' + dateStr + '_6',
          name: 'plan_6',
          planName: '方案六',
          matches: [m6Obj],
          amount: 1000,
          playType: '单关',
          matchCount: 1,
          passType: '单关',
          betCount: 250,
          ticketCount: 10,
          multiplier: 25,
          maxPrize: maxPrize6,
          winningPrize: plan6Result.isPlanWon === true ? maxPrize6 : 0,
          isPlanWon: plan6Result.isPlanWon,
          isPlanLose: plan6Result.isPlanLose,
        });
      }
    }
  }

  // ═══ 方案四～五 ═══
  if (isWorldCup) {
    // 世界杯方案四：平、让平 × 胜（≥3场，双场均前3，胜≥25）
    if (matchCount >= 3) {
      var _wc4a = findBestMatchForDirection(['平', '让平']);
      var _wc4b = findBestMatchForDirection(['胜'], _wc4a ? [_wc4a.matchId] : null, 25);
      if (
        _wc4a &&
        _wc4b &&
        isDirectionTopN(_wc4a.matchId, ['平', '让平'], 3) &&
        isDirectionTopN(_wc4b.matchId, ['胜'], 3)
      ) {
        push2MatchPlan('方案四', '4', _wc4a, '平、让平', _wc4b, '胜', 250, 10);
      }
    }

    // 世界杯方案五：平、让平 × 总进球-2、3球（≥6场，双场均前5，交叉配对，合赔≥1.5）
    if (matchCount >= 6) {
      var _candidatesA = [];
      for (var _mi5 = 0; _mi5 < mList.length; _mi5++) {
        var _m5a = mList[_mi5];
        var _md5a = matchDataMap[_m5a.matchId];
        if (!_md5a || !_md5a.odds) continue;
        var _total5a = 0;
        for (var _ri5 = 0; _ri5 < _md5a.recs.length; _ri5++) {
          var _r5a = _md5a.recs[_ri5];
          if (_r5a.type === '平' || _r5a.type === '让平') _total5a += _r5a.num || 0;
        }
        if (_total5a >= 3 && isDirectionTopN(_m5a.matchId, ['平', '让平'], 5)) {
          var _aObj5 = buildMatchObj(_m5a, '平、让平');
          var _eA5 = calcEffectiveOdds('平、让平', _aObj5);
          if (_eA5 && _eA5 >= 1.0) _candidatesA.push({ match: _m5a, count: _total5a, obj: _aObj5, odds: _eA5 });
        }
      }
      _candidatesA.sort(function (a, b) {
        return b.count - a.count;
      });

      var _candidatesB = [];
      for (var _mj5 = 0; _mj5 < mList.length; _mj5++) {
        var _m5b = mList[_mj5];
        var _md5b = matchDataMap[_m5b.matchId];
        if (!_md5b || !_md5b.odds || !_md5b.odds.totalGoals) continue;
        var _tg5 = _md5b.odds.totalGoals;
        if (_tg5['2'] == null || _tg5['2'] <= 0 || _tg5['3'] == null || _tg5['3'] <= 0) continue;
        var _total5b = 0;
        for (var _rj5 = 0; _rj5 < _md5b.recs.length; _rj5++) {
          if (_md5b.recs[_rj5].type === '总进球-2、3球') _total5b += _md5b.recs[_rj5].num || 0;
        }
        if (_total5b > 0 && isDirectionTopN(_m5b.matchId, ['总进球-2、3球'], 5)) {
          var _bObj5 = buildMatchObj(_m5b, '总进球-2、3球');
          var _eB5 = calcEffectiveOdds('总进球-2、3球', _bObj5);
          if (_eB5 && _eB5 >= 1.0) _candidatesB.push({ match: _m5b, count: _total5b, obj: _bObj5, odds: _eB5 });
        }
      }
      _candidatesB.sort(function (a, b) {
        return b.count - a.count;
      });

      var _bestPair5 = null;
      for (var _ai5 = 0; _ai5 < _candidatesA.length; _ai5++) {
        for (var _bi5 = 0; _bi5 < _candidatesB.length; _bi5++) {
          var _ca5 = _candidatesA[_ai5];
          var _cb5 = _candidatesB[_bi5];
          if (_ca5.match.matchId === _cb5.match.matchId) continue;
          var _prodOdds5 = _ca5.odds * _cb5.odds;
          if (_prodOdds5 < 1.5) continue;
          if (!_bestPair5 || _prodOdds5 > _bestPair5.productOdds) {
            _bestPair5 = { a: _ca5.match, b: _cb5.match, productOdds: _prodOdds5 };
          }
        }
      }
      if (_bestPair5) {
        push2MatchPlan('方案五', '5', _bestPair5.a, '平、让平', _bestPair5.b, '总进球-2、3球', 250, 10, 25, 1.5);
      }
    }
  } else {
    // 常规方案四～五：仅在 ≥6 场时生成
    if (matchCount >= 6) {
      const m4a = findBestMatchForDirection(['平', '让平']);
      const m4b = findBestMatchForDirection(['胜'], m4a ? [m4a.matchId] : null);
      push2MatchPlan('方案四', '4', m4a, '平、让平', m4b, '胜', 250, 10);

      // 方案五：平、让平 × 总进球-2、3球 — 交叉配对取最优合赔
      const candidatesA = [];
      for (const m of mList) {
        const md = matchDataMap[m.matchId];
        if (!md || !md.odds) continue;
        const recs = md.recs;
        let total = 0;
        for (const r of recs) {
          if (r.type === '平、让平') total += r.num || 0;
        }
        if (total >= 3) {
          const aObj = buildMatchObj(m, '平、让平');
          const eA = calcEffectiveOdds('平、让平', aObj);
          if (eA && eA >= 1.0) candidatesA.push({ match: m, count: total, obj: aObj, odds: eA });
        }
      }
      candidatesA.sort(function (a, b) {
        return b.count - a.count;
      });

      const candidatesB = [];
      for (const m of mList) {
        const md = matchDataMap[m.matchId];
        if (!md || !md.odds || !md.odds.totalGoals) continue;
        const tg = md.odds.totalGoals;
        if (tg['2'] == null || tg['2'] <= 0 || tg['3'] == null || tg['3'] <= 0) continue;
        const recs = md.recs;
        let total = 0;
        for (const r of recs) {
          if (r.type === '总进球-2、3球') total += r.num || 0;
        }
        if (total > 0) {
          const bObj = buildMatchObj(m, '总进球-2、3球');
          const eB = calcEffectiveOdds('总进球-2、3球', bObj);
          if (eB && eB >= 1.0) candidatesB.push({ match: m, count: total, obj: bObj, odds: eB });
        }
      }
      candidatesB.sort(function (a, b) {
        return b.count - a.count;
      });

      // 交叉配对：选合赔乘积最高的组合
      let bestPair = null;
      for (let ai = 0; ai < candidatesA.length; ai++) {
        for (let bi = 0; bi < candidatesB.length; bi++) {
          const ca = candidatesA[ai];
          const cb = candidatesB[bi];
          if (ca.match.matchId === cb.match.matchId) continue;
          const productOdds = ca.odds * cb.odds;
          if (productOdds < 1.5) continue;
          if (!bestPair || productOdds > bestPair.productOdds) {
            bestPair = { a: ca.match, b: cb.match, productOdds: productOdds };
          }
        }
      }
      if (bestPair) {
        push2MatchPlan('方案五', '5', bestPair.a, '平、让平', bestPair.b, '总进球-2、3球', 250, 10, 25, 1.5);
      }
    }
  }

  // ═══ 方案七：单关双选（胜平/平负）═══
  // 世界杯：推荐人数≥5；常规：无人数下限
  var _wc7minCount = isWorldCup ? 5 : 0;
  const singleMatches = mList.filter((m) => {
    const md = matchDataMap[m.matchId];
    return md && md.odds && md.odds.isSingleGame === true;
  });
  if (singleMatches.length > 0) {
    let bestM7 = null,
      bestM7Dir = '',
      bestM7Count = 0;
    for (const sm of singleMatches) {
      const recs = matchDataMap[sm.matchId].recs;
      for (const r of recs) {
        if ((r.type === '胜平' || r.type === '平负') && r.num > bestM7Count) {
          bestM7Count = r.num;
          bestM7 = sm;
          bestM7Dir = r.type;
        }
      }
    }
    if (bestM7 && bestM7Dir && bestM7Count >= _wc7minCount) {
      const m7Obj = buildMatchObj(bestM7, bestM7Dir);
      const subOdds7 = extractSubOdds(m7Obj.odds, bestM7Dir);
      const invSum7 = subOdds7.reduce((s, o) => s + 1 / o, 0);
      const maxPrize7 = invSum7 > 0 ? Math.round(1000 / invSum7) : 0;
      const plan7Result = computePlanResult([m7Obj]);
      plans.push({
        planId: 'plan_' + dateStr + '_7',
        name: 'plan_7',
        planName: '方案七',
        matches: [m7Obj],
        amount: 1000,
        playType: '单关',
        matchCount: 1,
        passType: '单关',
        betCount: 250,
        ticketCount: 10,
        multiplier: 25,
        maxPrize: maxPrize7,
        winningPrize: plan7Result.isPlanWon === true ? maxPrize7 : 0,
        isPlanWon: plan7Result.isPlanWon,
        isPlanLose: plan7Result.isPlanLose,
      });
    }
  }

  // ═══ 方案八：胜（单关）— 仅世界杯 ═══
  if (isWorldCup) {
    var _singleMatches8 = mList.filter((m) => {
      var _md8 = matchDataMap[m.matchId];
      return _md8 && _md8.odds && _md8.odds.isSingleGame === true;
    });
    if (_singleMatches8.length > 0) {
      var _bestM8 = null,
        _bestCount8 = 0;
      for (var _si8 = 0; _si8 < _singleMatches8.length; _si8++) {
        var _sm8 = _singleMatches8[_si8];
        var _recs8 = matchDataMap[_sm8.matchId].recs;
        for (var _ri8 = 0; _ri8 < _recs8.length; _ri8++) {
          if (_recs8[_ri8].type === '胜' && _recs8[_ri8].num > _bestCount8) {
            _bestCount8 = _recs8[_ri8].num;
            _bestM8 = _sm8;
          }
        }
      }
      if (_bestM8 && _bestCount8 >= 100) {
        var _m8Obj = buildMatchObj(_bestM8, '胜');
        var _m8Odds = _m8Obj.odds;
        var _e8 = _m8Odds && _m8Odds.spf ? _m8Odds.spf.home : null;
        var _maxPrize8 = _e8 && _e8 > 0 ? Math.round(1000 * _e8) : 0;
        var _plan8Result = computePlanResult([_m8Obj]);
        plans.push({
          planId: 'plan_' + dateStr + '_8',
          name: 'plan_8',
          planName: '方案八',
          matches: [_m8Obj],
          amount: 1000,
          playType: '单关',
          matchCount: 1,
          passType: '单关',
          betCount: 250,
          ticketCount: 10,
          multiplier: 25,
          maxPrize: _maxPrize8,
          winningPrize: _plan8Result.isPlanWon === true ? _maxPrize8 : 0,
          isPlanWon: _plan8Result.isPlanWon,
          isPlanLose: _plan8Result.isPlanLose,
        });
      }
    }
  }

  // 比赛低于5场时最多只保留前2个方案
  if (matchCount < 5 && plans.length > 2) {
    plans.splice(2);
  }

  return plans;
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
  // 专家博热方案
  generateExpertPlans,
};

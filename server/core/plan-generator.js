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
 * @param {string} [halfScoreStr] - 半场比分字符串（如 "2:0"），用于精确判定半全场
 * @returns {boolean|null} true=命中, false=未中, null=无法判定
 */
function judgeByScore(direction, scoreStr, handicap, halfScoreStr) {
  if (!scoreStr || !direction) return null;

  // ★ 复合方向（含、号，如"平、让平"）：分开判定，任一命中即可
  if (direction.indexOf('、') >= 0) {
    const subParts = direction.split(/[、,]/);
    for (let pi = 0; pi < subParts.length; pi++) {
      const subR = judgeByScore(subParts[pi].trim(), scoreStr, handicap, halfScoreStr);
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
    if (handicap == null) return null; // ★ 无让球数据 → 无法判定
    const hcp = parseFloat(handicap);
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
  // 有 halfScoreStr 时精确判定半场+全场；无则仅判全场部分（近似，由 L2 sporttery 补偿）
  const hfMatch = direction.match(/^半全场-(.+)$/);
  if (hfMatch) {
    const pattern = hfMatch[1]; // 如 "平平", "平负", "平胜", "胜胜" 等
    const halfChar = pattern.charAt(0); // 半场结果
    const fullChar = pattern.charAt(1); // 全场结果

    // 全场部分判定
    let fullResult = null;
    if (fullChar === '胜') fullResult = hg > ag;
    else if (fullChar === '平') fullResult = hg === ag;
    else if (fullChar === '负') fullResult = hg < ag;
    if (fullResult === null) return null;

    // 有半场比分时精确判定半场部分
    if (halfScoreStr) {
      const hParts = String(halfScoreStr).replace(/[-:]/g, ':').split(':');
      const hHg = parseInt(hParts[0]);
      const hAg = parseInt(hParts[1]);
      if (isNaN(hHg) || isNaN(hAg)) return null;
      let halfResult = null;
      if (halfChar === '胜') halfResult = hHg > hAg;
      else if (halfChar === '平') halfResult = hHg === hAg;
      else if (halfChar === '负') halfResult = hHg < hAg;
      if (halfResult === null) return null;
      return halfResult && fullResult;
    }

    // 无半场比分：仅判全场部分（近似值，可能误判）
    return fullResult;
  }

  return null;
}

/**
 * ★ V16: sporttery lotteryResult 权威判定（比 midou310 result 更权威）
 * 从 sporttery_odds/{matchId}.json 读取开奖结果，判定 direction 是否命中
 * @param {string} matchId
 * @param {string} direction - 投注方向（"胜"/"让平"/"总进球-2"/"半全场-平平" 等）
 * @returns {boolean|null} true=命中, false=未中, null=无法判定
 */
const SP_ODDS_DIR = __dirname + '/../sporttery_odds';
const _spCache = {}; // matchId → lotteryResult object
const _spCacheMiss = {}; // matchId → true (file doesn't exist)
function judgeBySporttery(matchId, direction) {
  if (!matchId || !direction) return null;
  try {
    let sp = _spCache[matchId];
    if (sp === undefined && !_spCacheMiss[matchId]) {
      const fs = require('fs');
      const spFile = SP_ODDS_DIR + '/' + matchId + '.json';
      if (!fs.existsSync(spFile)) {
        _spCacheMiss[matchId] = true;
        return null;
      }
      sp = JSON.parse(fs.readFileSync(spFile, 'utf8'));
      _spCache[matchId] = sp;
    }
    if (!sp) return null;
    const lr = sp.lotteryResult;
    if (!lr) return null;

    // 复合方向（含、号）: 分开判定，任一命中即可
    // ★ V16.1: 传播玩法前缀，防止子项丢失前缀被误判为其他玩法
    if (direction.indexOf('、') >= 0) {
      const rawParts = direction.split(/[、,]/);
      // 检测原始方向玩法前缀
      const isHF = direction.indexOf('半全场-') === 0;
      const isTG = direction.indexOf('总进球-') === 0;
      const subParts = rawParts.map(function (p) {
        p = p.trim();
        if (isHF && p.indexOf('半全场-') !== 0) return '半全场-' + p;
        if (isTG && p.indexOf('总进球-') !== 0) {
          // 去除后缀"球"统一为 "总进球-N" 格式
          const bare = p.replace(/球$/, '');
          if (/^\d+$/.test(bare)) return '总进球-' + bare;
          return '总进球-' + p;
        }
        return p;
      });
      for (let pi = 0; pi < subParts.length; pi++) {
        const subR = judgeBySporttery(matchId, subParts[pi]);
        if (subR === true) return true;
      }
      return false;
    }

    // 1. SPF 方向 (胜/平/负/胜平/平负)
    const spfOutcome = lr['胜平负'] && lr['胜平负'].outcome;
    if (spfOutcome && spfOutcome !== '--') {
      if (direction === '胜') return spfOutcome === '胜';
      if (direction === '平') return spfOutcome === '平';
      if (direction === '负') return spfOutcome === '负';
      if (direction === '胜平') return spfOutcome === '胜' || spfOutcome === '平';
      if (direction === '平负') return spfOutcome === '平' || spfOutcome === '负';
    }

    // 2. RQSPF 方向 (让胜/让平/让负)
    const rqspfOutcome = lr['让球胜平负'] && lr['让球胜平负'].outcome;
    if (rqspfOutcome && rqspfOutcome !== '--') {
      // sporttery 格式: "(-1)胜" → 去掉handicap部分 → "胜"
      const cleanRQ = rqspfOutcome.replace(/^\([^)]+\)/, '').trim();
      if (direction === '让胜') return cleanRQ === '胜';
      if (direction === '让平') return cleanRQ === '平';
      if (direction === '让负') return cleanRQ === '负';
    }

    // 3. 总进球 (总进球-X 或 X球)
    const jqOutcome = lr['总进球'] && lr['总进球'].outcome;
    if (jqOutcome && jqOutcome !== '--') {
      const goalMatch = direction.match(/总进球-(\d+)/);
      if (goalMatch) return jqOutcome === goalMatch[1];
      const simpleGoalMatch = direction.match(/^(\d+)球$/);
      if (simpleGoalMatch) return jqOutcome === simpleGoalMatch[1];
    }

    // 4. 半全场 (半全场-XX)
    const bqcOutcome = lr['半全场胜平负'] && lr['半全场胜平负'].outcome;
    if (bqcOutcome && bqcOutcome !== '--') {
      const hfMatch = direction.match(/^半全场-(.+)$/);
      if (hfMatch) {
        // sporttery 半全场格式: "胜胜"/"平负" 等，与 direction 子方向对齐
        return bqcOutcome === hfMatch[1];
      }
    }

    return null;
  } catch (e) {
    return null;
  }
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

  // ★ V16 fallback: 推荐数据无 result 时
  //   ② sporttery lotteryResult → ③ judgeByScore 比分直判兜底
  if (isMatchWon === null && isMatchLose === null) {
    // ② sporttery lotteryResult 权威判定
    const spResult = judgeBySporttery(matchId, direction);
    if (spResult !== null) {
      isMatchWon = spResult;
      isMatchLose = !spResult;
    }
  }
  if (isMatchWon === null && isMatchLose === null) {
    // ③ judgeByScore 比分直判 (最终兜底)
    const matchKey = 'm_' + String(matchId);
    const m = mMap ? mMap[matchKey] || mMap[String(matchId)] || null : null;
    if (m && m.matchStatus >= 1 && m.score) {
      const scoreResult = judgeByScore(direction, m.score, null, m.halfScore || '');
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

// ═══ 专家博热方案 (方案一~七 / 世界杯01~08) ═══

/**
 * 生成专家博热方案（方案一~七 + 世界杯01~08）— plan-list 和 income-stats 共用
 *
 * 同一天可能存在世界杯标签比赛 + 非世界杯标签比赛：
 *   - 世界杯标签场次 → 世界杯方案推荐规则（命名：世界杯01~08）
 *   - 非世界杯标签场次 → 专家方案生成条件（命名：方案一~七）
 *   - 世界杯方案总是排在常规方案前面
 *
 * @param {Array} mList - 当日比赛列表
 * @param {Object} matchDataMap - { matchId: { match, recs, odds } }
 * @param {string} dateStr - 日期 YYYY-MM-DD
 * @returns {Array} 方案对象数组
 */
function generateExpertPlans(mList, matchDataMap, dateStr) {
  // ── 按世界杯标签拆分比赛 ──
  const wcMatches = [];
  const regularMatches = [];
  for (let i = 0; i < mList.length; i++) {
    if ((mList[i].leagueName || '').indexOf('世界杯') >= 0) {
      wcMatches.push(mList[i]);
    } else {
      regularMatches.push(mList[i]);
    }
  }

  const allPlans = [];

  // 世界杯方案（命名：世界杯01~08，排在前面）
  if (wcMatches.length > 0) {
    const wcPlans = generatePlansForGroup(wcMatches, matchDataMap, dateStr, true, '世界杯');
    for (let wi = 0; wi < wcPlans.length; wi++) allPlans.push(wcPlans[wi]);
  }

  // 常规方案（命名：方案一~七，排在后面）
  if (regularMatches.length > 0) {
    const regularPlans = generatePlansForGroup(regularMatches, matchDataMap, dateStr, false, '方案');
    for (let ri = 0; ri < regularPlans.length; ri++) allPlans.push(regularPlans[ri]);
  }

  return allPlans;
}

/**
 * 为指定比赛组生成方案（世界杯量级 / 常规量级）
 * @param {Array} mList - 该组比赛列表
 * @param {Object} matchDataMap - 全局 { matchId: { match, recs, odds } }
 * @param {string} dateStr - 日期 YYYY-MM-DD
 * @param {boolean} isWC - 是否世界杯组
 * @param {string} planPrefix - 方案名前缀（"世界杯" 或 "方案"）
 * @returns {Array} 方案对象数组
 */
function generatePlansForGroup(mList, matchDataMap, dateStr, isWC, planPrefix) {
  const matchCount = mList.length;
  const plans = [];

  // ── 方案名工具 ──
  function _planDisplayName(idx) {
    if (isWC) return planPrefix + (idx < 10 ? '0' + idx : String(idx));
    const cn = ['零', '一', '二', '三', '四', '五', '六', '七', '八'];
    return planPrefix + (cn[idx] || idx);
  }
  function _planSuffix(idx) {
    return isWC ? 'wc' + idx : String(idx);
  }

  // ── 世界杯方向排行（基于 recs 数据自建排行，免外部 API，仅 WC 组使用）──
  let _wcRankingCache = null;
  function getWCRanking() {
    if (_wcRankingCache) return _wcRankingCache;
    const entries = [];
    for (let mi = 0; mi < mList.length; mi++) {
      const m = mList[mi];
      const md = matchDataMap[m.matchId];
      if (!md || !md.recs) continue;
      for (let ri = 0; ri < md.recs.length; ri++) {
        const r = md.recs[ri];
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

  function isDirectionTopN(matchId, directions, topN) {
    const ranking = getWCRanking();
    const dirs = Array.isArray(directions)
      ? directions
      : directions.split(/[、,]/).map(function (s) {
          return s.trim();
        });
    let bestCount = 0;
    for (let i = 0; i < ranking.length; i++) {
      if (ranking[i].matchId === matchId && dirs.indexOf(ranking[i].direction) >= 0) {
        bestCount = Math.max(bestCount, ranking[i].count);
      }
    }
    if (bestCount === 0) return false;
    const seenCounts = {};
    for (let j = 0; j < ranking.length; j++) {
      if (ranking[j].count > bestCount) seenCounts[ranking[j].count] = true;
    }
    return Object.keys(seenCounts).length < topN;
  }

  function getWCDirectionCount(matchId, directions) {
    const md = matchDataMap[matchId];
    if (!md || !md.recs) return 0;
    const dirs = Array.isArray(directions)
      ? directions
      : directions.split(/[、,]/).map(function (s) {
          return s.trim();
        });
    let total = 0;
    for (let i = 0; i < md.recs.length; i++) {
      if (dirs.indexOf(md.recs[i].type) >= 0) total += md.recs[i].num || 0;
    }
    return total;
  }

  // ── 工具函数 ──

  function findRecommends(matchId) {
    const md = matchDataMap[matchId];
    return md ? md.recs : [];
  }

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
      nums.forEach(function (n) {
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
        hfParts.forEach(function (pd) {
          pd = pd.trim();
          if (pd.indexOf('半全场-') === 0) pd = pd.substring(4);
          const hfKey = hfMap[pd];
          if (hfKey && oddsObj.halfFull && oddsObj.halfFull[hfKey] !== undefined) vals.push(oddsObj.halfFull[hfKey]);
        });
        return vals;
      }
      const parts = direction.split(/[、,]/);
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

  function findBestMatchForDirection(directions, excludeIds, minCount, poolMode) {
    let bestMatch = null,
      bestCount = 0;
    for (let mi = 0; mi < mList.length; mi++) {
      const m = mList[mi];
      if (excludeIds && excludeIds.indexOf(m.matchId) >= 0) continue;
      const md = matchDataMap[m.matchId];
      if (!md || !md.odds) continue;
      const recs = md.recs;
      let total = 0;
      for (let ri = 0; ri < recs.length; ri++) {
        if (directions.indexOf(recs[ri].type) >= 0) total += recs[ri].num || 0;
      }
      // ★ poolMode: 累加模式，多个方向的人数为它们的和（如 胜+平→胜平）
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
      return parts.some(function (p) {
        return p.trim() === sd;
      });
    }

    subDirs.forEach(function (subDir) {
      const sd = subDir.trim();
      let found = null;
      for (let i = 0; i < recs.length; i++) {
        if (recs[i].type === sd) {
          found = recs[i];
          break;
        }
      }
      if (!found) {
        for (let j = 0; j < recs.length; j++) {
          if (recContains(recs[j].type, sd)) {
            found = recs[j];
            break;
          }
        }
      }
      if (!found && sd.indexOf('球') >= 0) {
        const num = sd.replace(/球/g, '');
        for (let k = 0; k < recs.length; k++) {
          if (recs[k].type === '总进球-' + num) {
            found = recs[k];
            break;
          }
        }
      }
      if (found) matchedRecsSet.add(found);
      subResults.push({ direction: sd, result: found ? found.result : null });
    });

    if (matchedRecsSet.size === 0) {
      for (let ri = 0; ri < recs.length; ri++) {
        const rt = recs[ri].type || '';
        if (rt.indexOf(direction) >= 0 || direction.indexOf(rt) >= 0) matchedRecsSet.add(recs[ri]);
      }
      if (matchedRecsSet.size === 0 && subResults.length === 0) subResults.push({ direction: direction, result: null });
    }

    // 总进球双选：用实际比分拆分子方向命中
    if (direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0 && subResults.length >= 2) {
      const combinedRes = subResults[0].result;
      if (combinedRes === 0) {
        subResults.forEach(function (sr) {
          sr.result = 0;
        });
      } else if (combinedRes === 1 && m.score) {
        var scoreParts = String(m.score).replace(/[-:]/g, ':').split(':');
        var totalGoals = parseInt(scoreParts[0]) + parseInt(scoreParts[1]);
        if (!isNaN(totalGoals)) {
          subResults.forEach(function (sr) {
            const goalMatch = sr.direction.match(/(\d+)/);
            if (goalMatch && parseInt(goalMatch[1]) === totalGoals) sr.result = 1;
            else sr.result = 0;
          });
        }
      }
    }

    const matchedRecs = Array.from(matchedRecsSet);
    expertCount = matchedRecs.reduce(function (s, r) {
      return s + (r.num || 0);
    }, 0);

    let anyWon = false,
      anyLose = false,
      anyUnknown = false;
    if (direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0 && subResults.length >= 2) {
      let hasKnown = false;
      for (let si = 0; si < subResults.length; si++) {
        if (subResults[si].result === 1) {
          anyWon = true;
          hasKnown = true;
        } else if (subResults[si].result === 0) {
          anyLose = true;
          hasKnown = true;
        } else anyUnknown = true;
      }
      if (!hasKnown) anyWon = false;
    } else {
      matchedRecs.forEach(function (r) {
        if (r.result === 1) anyWon = true;
        else if (r.result === 0) anyLose = true;
        else anyUnknown = true;
      });
    }
    if (!anyUnknown && matchedRecs.length > 0) {
      isMatchWon = anyWon;
      isMatchLose = !anyWon && anyLose;
    }

    // fallback: 推荐数据无 result 时，用比分直判方向对错
    if (isMatchWon === null && isMatchLose === null) {
      if (m && m.matchStatus >= 1 && m.score) {
        const mData = matchDataMap[m.matchId];
        const mOdds = mData ? mData.odds : null;
        var hcp =
          mOdds && mOdds.rqspf && mOdds.rqspf.handicap != null
            ? mOdds.rqspf.handicap
            : m.concede != null
              ? m.concede
              : null;
        function judgeScoreExp(d, s, h) {
          if (d.indexOf('、') >= 0) {
            const parts = d.split(/[、,]/);
            for (let pi = 0; pi < parts.length; pi++) {
              if (judgeScoreExp(parts[pi].trim(), s, h)) return true;
            }
            return false;
          }
          const p = String(s).replace(/[-:]/g, ':').split(':');
          const hh = parseInt(p[0]),
            aa = parseInt(p[1]);
          if (isNaN(hh) || isNaN(aa)) return null;
          if (d === '胜') return hh > aa;
          if (d === '平') return hh === aa;
          if (d === '负') return hh < aa;
          if (d === '胜平') return hh > aa || hh === aa;
          if (d === '平负') return hh === aa || hh < aa;
          if (d === '让胜' || d === '让平' || d === '让负') {
            if (h == null) return null; // ★ 无让球数据 → 无法判定
            const ec = hh + parseFloat(h);
            if (d === '让胜') return ec > aa;
            if (d === '让平') return ec === aa;
            if (d === '让负') return ec < aa;
          }
          const gm = d.match(/总进球-(\d+)/);
          if (gm) return hh + aa === parseInt(gm[1]);
          const hfMatch = d.match(/^半全场-(.+)$/);
          if (hfMatch) {
            const fullChar = hfMatch[1].slice(-1);
            if (fullChar === '胜') return hh > aa;
            if (fullChar === '平') return hh === aa;
            if (fullChar === '负') return hh < aa;
            return null;
          }
          return null;
        }
        const scoreResult = judgeScoreExp(direction, m.score, hcp);
        if (scoreResult !== null) {
          isMatchWon = scoreResult;
          isMatchLose = !scoreResult;
          for (let sri2 = 0; sri2 < subResults.length; sri2++) {
            const sd2 = subResults[sri2].direction;
            const sr2 = judgeScoreExp(sd2, m.score, hcp);
            if (sr2 !== null) subResults[sri2].result = sr2 ? 1 : 0;
            else if (sd2 === direction || sd2.indexOf(direction) >= 0 || direction.indexOf(sd2) >= 0)
              subResults[sri2].result = isMatchWon ? 1 : 0;
          }
        }
      }
    }

    // 最终兜底
    if (isMatchWon !== null && isMatchLose !== null) {
      const isPlan6Multi = direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0;
      // ★ V17: 总进球多选有比分 → 重拆子方向（覆盖 midou310 可能把多个子方向都标为 1）
      if (isPlan6Multi && m.score && subResults.length >= 2) {
        var scoreParts = String(m.score).replace(/[-:]/g, ':').split(':');
        var totalGoals = parseInt(scoreParts[0]) + parseInt(scoreParts[1]);
        if (!isNaN(totalGoals)) {
          for (var sri3 = 0; sri3 < subResults.length; sri3++) {
            const goalMatch = subResults[sri3].direction.match(/(\d+)/);
            subResults[sri3].result = goalMatch && parseInt(goalMatch[1]) === totalGoals ? 1 : 0;
          }
        }
      } else {
        for (var sri3 = 0; sri3 < subResults.length; sri3++) {
          if (subResults[sri3].result === null || subResults[sri3].result === undefined) {
            // ★ V17: 让球方向缺 hcp 且比赛已结束 → 无法判定（-1）
            const _sd = subResults[sri3].direction;
            const _isRQdir = _sd === '让胜' || _sd === '让平' || _sd === '让负';
            if (_isRQdir && m.score && hcp == null) {
              subResults[sri3].result = -1;
            } else if (isPlan6Multi && isMatchWon && (!m.score || m.score === '')) {
              subResults[sri3].result = null;
            } else {
              subResults[sri3].result = isMatchWon ? 1 : 0;
            }
          }
        }
      }
    }

    let actualScore = '';
    if (isMatchWon !== null || isMatchLose !== null) actualScore = (m.score || '').replace(/:/g, '-');

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
    if (subOdds.length === 1) return subOdds[0];
    const invSum = subOdds.reduce(function (a, b) {
      return a + 1 / b;
    }, 0);
    return invSum > 0 ? 1 / invSum : null;
  }

  function computePlanResult(matches) {
    let allWon = true,
      anyLose = false,
      anyUnknown = false;
    for (let i = 0; i < matches.length; i++) {
      if (matches[i].isMatchWon === true) continue;
      if (matches[i].isMatchLose === true) {
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

  function push2MatchPlan(
    displaySuffix,
    localSuffixNum,
    mA,
    dirA,
    mB,
    dirB,
    betCount,
    ticketCount,
    multiplier,
    minProductOdds,
    minProfitPct,
  ) {
    if (!mA || !mB) return;
    const aObj = buildMatchObj(mA, dirA);
    const bObj = buildMatchObj(mB, dirB);
    const e1 = calcEffectiveOdds(dirA, aObj);
    const e2 = calcEffectiveOdds(dirB, bObj);
    const productOdds = e1 && e2 ? e1 * e2 : 0;
    if (minProductOdds && productOdds < minProductOdds) return;
    const maxPrize = e1 && e2 ? Math.round(1000 * productOdds) : 0;
    if (minProfitPct && maxPrize < 1000 * (1 + minProfitPct)) return;

    const planResult = computePlanResult([aObj, bObj]);
    const winningPrize = planResult.isPlanWon === true ? maxPrize : 0;

    plans.push({
      planId: 'plan_' + dateStr + '_' + _planSuffix(localSuffixNum),
      name: 'plan_' + _planSuffix(localSuffixNum),
      planName: _planDisplayName(localSuffixNum),
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

  // ═══════════════════════════════════════════
  // 方案生成逻辑
  // ═══════════════════════════════════════════

  if (isWC) {
    // ── 世界杯方案（无排行约束，靠高人数+盈利门槛替代）──

    // 方案一 V16.3: 平、让平 × 让负（≥3场，各≥15人，平赔率有效，盈≥80%）
    if (matchCount >= 3) {
      let _wc1a = findBestMatchForDirection(['平', '让平'], null, 15);
      if (_wc1a) {
        const _wc1Odds = getMatchOdds(_wc1a);
        if (!_wc1Odds || !_wc1Odds.spf || !_wc1Odds.spf.draw || _wc1Odds.spf.draw <= 0) _wc1a = null;
      }
      const _wc1b = findBestMatchForDirection(['让负'], _wc1a ? [_wc1a.matchId] : null, 15);
      if (_wc1a && _wc1b) {
        push2MatchPlan('01', 1, _wc1a, '平、让平', _wc1b, '让负', 250, 10, 25, 0, 0.8);
      }
    }

    // 方案二 V16.3: 总进球-2、3球 × 让负（A≥10/B≥25，盈≥300%）
    if (matchCount >= 3) {
      let _wc2a = findBestMatchForDirection(['总进球-2、3球'], null, 10);
      if (_wc2a) {
        const _wc2md = matchDataMap[_wc2a.matchId];
        const _wc2tg = _wc2md && _wc2md.odds && _wc2md.odds.totalGoals;
        if (!_wc2tg || _wc2tg['2'] == null || _wc2tg['2'] <= 0 || _wc2tg['3'] == null || _wc2tg['3'] <= 0) _wc2a = null;
      }
      const _wc2b = findBestMatchForDirection(['让负'], _wc2a ? [_wc2a.matchId] : null, 25);
      if (_wc2a && _wc2b) {
        push2MatchPlan('02', 2, _wc2a, '总进球-2、3球', _wc2b, '让负', 250, 10, 25, 0, 2.0);
      }
    }

    // 方案三 V16.3: 胜 × 让负（A≥10/B≥20，盈≥300%）
    const _wc3a = findBestMatchForDirection(['胜'], null, 10);
    const _wc3b = findBestMatchForDirection(['让负'], _wc3a ? [_wc3a.matchId] : null, 20);
    if (_wc3a && _wc3b) {
      push2MatchPlan('03', 3, _wc3a, '胜', _wc3b, '让负', 250, 10, 25, 0, 2.0);
    }
  } else {
    // ── 常规方案一～三（对齐 专家方案生成条件.md）──

    // ★ V16.3: 方案一—优化门禁+盈利门槛（回测最优: A≥20/B≥30/盈≥2.2x, 58方案 +13,667 ROI 23.6%）
    const _rg1a = findBestMatchForDirection(['平', '让平'], null, 20);
    const _rg1b = findBestMatchForDirection(['让负'], _rg1a ? [_rg1a.matchId] : null, 30);

    const _rg2a = findBestMatchForDirection(['总进球-2、3球'], null, 5);
    const _rg2b = findBestMatchForDirection(['让负'], _rg2a ? [_rg2a.matchId] : null, 15);

    const _rg3a = findBestMatchForDirection(['胜'], null, 60);
    const _rg3b = findBestMatchForDirection(['让负'], _rg3a ? [_rg3a.matchId] : null, 50);

    push2MatchPlan('一', 1, _rg1a, '平、让平', _rg1b, '让负', 250, 10, 25, 0, 1.2);
    push2MatchPlan('二', 2, _rg2a, '总进球-2、3球', _rg2b, '让负', 250, 10, 25, 0, 2.0);
    push2MatchPlan('三', 3, _rg3a, '胜', _rg3b, '让负', 250, 10, 25, 0, 2.0);
  }

  // ═══ 方案六：总进球-2、3球 单关（专家驱动）═══
  const _tgVariants = [
    { suffix: '6a', planName: _planDisplayName(6), dir: '总进球-2、3球', goals: ['2', '3'], minProfit: 1100 },
  ];
  for (let tvi = 0; tvi < _tgVariants.length; tvi++) {
    const _tv = _tgVariants[tvi];
    const _minCountTV = isWC ? 0 : 1;
    const _minProfitTV = isWC ? 1300 : _tv.minProfit;
    const _topN = isWC ? 6 : 0;
    if (matchCount >= (isWC ? 2 : 2)) {
      const _candidatesTV = [];
      for (let mi6 = 0; mi6 < mList.length; mi6++) {
        const _m6 = mList[mi6];
        const _recs6 = findRecommends(_m6.matchId);
        const _md6 = matchDataMap[_m6.matchId];
        if (!_md6 || !_md6.odds || !_md6.odds.totalGoals) continue;
        const _tg6 = _md6.odds.totalGoals;
        let _allGoalsOk = true;
        for (let _gi = 0; _gi < _tv.goals.length; _gi++) {
          if (_tg6[_tv.goals[_gi]] == null || _tg6[_tv.goals[_gi]] <= 0) {
            _allGoalsOk = false;
            break;
          }
        }
        if (!_allGoalsOk) continue;
        // ★ 专家人数：优先用 expertPool 池化，否则用 dir 精确匹配
        const _poolDirs = _tv.expertPool ? _tv.expertPool : [_tv.dir];
        let total6 = 0;
        for (let ri6 = 0; ri6 < _recs6.length; ri6++) {
          if (_poolDirs.indexOf(_recs6[ri6].type) >= 0) total6 += _recs6[ri6].num || 0;
        }
        if (total6 <= 0) continue;
        if (_minCountTV && total6 < _minCountTV) continue;
        const _m6Obj = buildMatchObj(_m6, _tv.dir);
        const _subOdds6 = extractSubOdds(_m6Obj.odds, _tv.dir);
        if (_subOdds6.length < 2) continue;
        const _invSum6 = _subOdds6.reduce(function (s, o) {
          return s + 1 / o;
        }, 0);
        const _maxPrize6 = _invSum6 > 0 ? Math.round(1000 / _invSum6) : 0;
        if (_maxPrize6 < _minProfitTV) continue;
        _candidatesTV.push({ match: _m6, obj: _m6Obj, maxPrize: _maxPrize6, count: total6 });
      }
      if (_candidatesTV.length > 0) {
        _candidatesTV.sort(function (a, b) {
          return b.maxPrize - a.maxPrize;
        });
        const _best = _candidatesTV[0];
        const plan6Result = computePlanResult([_best.obj]);
        plans.push({
          planId: 'plan_' + dateStr + '_' + _tv.suffix,
          name: 'plan_' + _tv.suffix,
          planName: _tv.planName,
          matches: [_best.obj],
          amount: 1000,
          playType: '单关',
          matchCount: 1,
          passType: '单关',
          betCount: 250,
          ticketCount: 10,
          multiplier: 25,
          maxPrize: _best.maxPrize,
          winningPrize: plan6Result.isPlanWon === true ? _best.maxPrize : 0,
          isPlanWon: plan6Result.isPlanWon,
          isPlanLose: plan6Result.isPlanLose,
        });
      }
    }
  }

  // ═══ 方案A123/A345：总进球三选单关（AI驱动）═══
  // 用 AI 比分预测 + 大小球判定，不依赖专家推荐
  // 当日符合条件的全部产出，不限个数。命名：方案A123-01, A123-02, ...
  const _aiVariants = [
    { goalsCode: '123', dir: '总进球-1、2、3球', goals: ['1', '2', '3'], minProfit: 1300 },
    { goalsCode: '345', dir: '总进球-3、4、5球', goals: ['3', '4', '5'], minProfit: 1300 },
  ];
  let _aiCache = null;
  try {
    _aiCache = JSON.parse(require('fs').readFileSync(__dirname + '/../ai_cache.json', 'utf8'));
  } catch (e) {
    _aiCache = {};
  }

  function _aiGoalCheck(matchId, goalSet) {
    // 返回 overlap 分数（≥1=命中，分数越高=概率越高）
    const entry = _aiCache[matchId];
    if (!entry) return 0;
    const c = entry.content || entry;
    const ycs = c['预测建议'];
    if (!ycs || !Array.isArray(ycs)) return 0;
    const goals = [];
    ycs.forEach(function (y) {
      if (y['玩法'] === '比分预测' && y['建议方向']) {
        const scores = y['建议方向'].split(/[、,，]/);
        scores.forEach(function (s) {
          const m = s.trim().match(/(\d+)\s*[-:：]\s*(\d+)/);
          if (m) {
            const g = parseInt(m[1]) + parseInt(m[2]);
            if (goals.indexOf(g) < 0) goals.push(g);
          }
        });
      }
      if (y['玩法'] === '大小球' && y['建议方向']) {
        const bs = y['建议方向'].replace('球', '').trim();
        if (bs === '大') {
          for (var gi = 3; gi <= 7; gi++) {
            if (goals.indexOf(gi) < 0) goals.push(gi);
          }
        } else if (bs === '小') {
          for (var gi = 0; gi <= 2; gi++) {
            if (goals.indexOf(gi) < 0) goals.push(gi);
          }
        }
      }
    });
    // 计算重叠数 = 概率分（比分预测命中权重更高）
    let score = 0;
    for (let gi = 0; gi < goalSet.length; gi++) {
      if (goals.indexOf(parseInt(goalSet[gi])) >= 0) score++;
    }
    return score;
  }

  for (let avi = 0; avi < _aiVariants.length; avi++) {
    const _av = _aiVariants[avi];
    if (matchCount < 2) break;
    const _candAI = [];
    for (let ami = 0; ami < mList.length; ami++) {
      const _m = mList[ami];
      const _md = matchDataMap[_m.matchId];
      if (!_md || !_md.odds || !_md.odds.totalGoals) continue;
      const _tg = _md.odds.totalGoals;
      let allOk = true;
      for (let gi = 0; gi < _av.goals.length; gi++) {
        if (_tg[_av.goals[gi]] == null || _tg[_av.goals[gi]] <= 0) {
          allOk = false;
          break;
        }
      }
      if (!allOk) continue;
      const _aiScore = _aiGoalCheck(_m.matchId, _av.goals);
      if (_aiScore <= 0) continue;
      const _subOdds = extractSubOdds(_md.odds, _av.dir);
      if (_subOdds.length < 2) continue;
      const _invSum = _subOdds.reduce(function (s, o) {
        return s + 1 / o;
      }, 0);
      const _maxPrize = _invSum > 0 ? Math.round(1000 / _invSum) : 0;
      if (_maxPrize < _av.minProfit) continue;
      _candAI.push({ match: _m, obj: buildMatchObj(_m, _av.dir), maxPrize: _maxPrize, aiScore: _aiScore });
    }
    // ★ 按概率分降序取前2个（每个方向不超过2方案）
    _candAI.sort(function (a, b) {
      return b.aiScore - a.aiScore || b.maxPrize - a.maxPrize;
    });
    const _limit = Math.min(2, _candAI.length);
    for (let ci = 0; ci < _limit; ci++) {
      const _aiItem = _candAI[ci];
      const _aiResult = computePlanResult([_aiItem.obj]);
      const _seq = String(ci + 1).padStart(2, '0');
      const _suffix = 'a' + _av.goalsCode + '_' + _seq;
      const _planName = '方案A' + _av.goalsCode + '-' + _seq;
      plans.push({
        planId: 'plan_' + dateStr + '_' + _suffix,
        name: 'plan_' + _suffix,
        planName: _planName,
        matches: [_aiItem.obj],
        amount: 1000,
        playType: '单关',
        matchCount: 1,
        passType: '单关',
        betCount: 250,
        ticketCount: 10,
        multiplier: 25,
        maxPrize: _aiItem.maxPrize,
        winningPrize: _aiResult.isPlanWon === true ? _aiItem.maxPrize : 0,
        isPlanWon: _aiResult.isPlanWon,
        isPlanLose: _aiResult.isPlanLose,
      });
    }
  }

  // ── 方案四～五 ──
  if (isWC) {
    // 世界杯方案四 V16.3: 平、让平 × 胜（A≥15/B≥35，盈≥300%）
    if (matchCount >= 3) {
      const _wc4a = findBestMatchForDirection(['平', '让平'], null, 15);
      const _wc4b = findBestMatchForDirection(['胜'], _wc4a ? [_wc4a.matchId] : null, 35);
      if (_wc4a && _wc4b) {
        push2MatchPlan('04', 4, _wc4a, '平、让平', _wc4b, '胜', 250, 10, 25, 0, 2.0);
      }
    }

    // 世界杯方案五：平、让平 × 总进球-2、3球（≥4场，A≥1.3,B>1.4，交叉配对选最低合赔≥1.5）
    if (matchCount >= 4) {
      const _candidatesA = [];
      for (let _mi5 = 0; _mi5 < mList.length; _mi5++) {
        const _m5a = mList[_mi5];
        const _md5a = matchDataMap[_m5a.matchId];
        if (!_md5a || !_md5a.odds) continue;
        let _total5a = 0;
        for (let _ri5 = 0; _ri5 < _md5a.recs.length; _ri5++) {
          const _r5a = _md5a.recs[_ri5];
          if (_r5a.type === '平' || _r5a.type === '让平') _total5a += _r5a.num || 0;
        }
        if (_total5a > 0) {
          const _aObj5 = buildMatchObj(_m5a, '平、让平');
          const _eA5 = calcEffectiveOdds('平、让平', _aObj5);
          if (_eA5 && _eA5 >= 1.3) _candidatesA.push({ match: _m5a, count: _total5a, obj: _aObj5, odds: _eA5 });
        }
      }
      _candidatesA.sort(function (a, b) {
        return b.count - a.count;
      });

      const _candidatesB = [];
      for (let _mj5 = 0; _mj5 < mList.length; _mj5++) {
        const _m5b = mList[_mj5];
        const _md5b = matchDataMap[_m5b.matchId];
        if (!_md5b || !_md5b.odds || !_md5b.odds.totalGoals) continue;
        const _tg5 = _md5b.odds.totalGoals;
        if (_tg5['2'] == null || _tg5['2'] <= 0 || _tg5['3'] == null || _tg5['3'] <= 0) continue;
        let _total5b = 0;
        for (let _rj5 = 0; _rj5 < _md5b.recs.length; _rj5++) {
          if (_md5b.recs[_rj5].type === '总进球-2、3球') _total5b += _md5b.recs[_rj5].num || 0;
        }
        if (_total5b > 0) {
          const _bObj5 = buildMatchObj(_m5b, '总进球-2、3球');
          const _eB5 = calcEffectiveOdds('总进球-2、3球', _bObj5);
          if (_eB5 && _eB5 > 1.4) _candidatesB.push({ match: _m5b, count: _total5b, obj: _bObj5, odds: _eB5 });
        }
      }
      _candidatesB.sort(function (a, b) {
        return b.count - a.count;
      });

      // ★ 选最低合赔（博稳策略），≥1.5
      let _bestPair5 = null;
      for (let _ai5 = 0; _ai5 < _candidatesA.length; _ai5++) {
        for (let _bi5 = 0; _bi5 < _candidatesB.length; _bi5++) {
          const _ca5 = _candidatesA[_ai5],
            _cb5 = _candidatesB[_bi5];
          if (_ca5.match.matchId === _cb5.match.matchId) continue;
          const _prodOdds5 = _ca5.odds * _cb5.odds;
          if (_prodOdds5 < 1.5) continue;
          if (!_bestPair5 || _prodOdds5 < _bestPair5.productOdds) {
            _bestPair5 = { a: _ca5.match, b: _cb5.match, productOdds: _prodOdds5 };
          }
        }
      }
      if (_bestPair5) {
        push2MatchPlan('05', 5, _bestPair5.a, '平、让平', _bestPair5.b, '总进球-2、3球', 250, 10, 25, 1.5);
      }
    }
  } else {
    // ★ 常规方案四 V16.3: ≥6场 + 平/让平≥20人 + 胜≥60人 + 盈≥230%
    if (matchCount >= 6) {
      const _rg4a = findBestMatchForDirection(['平', '让平'], null, 20);
      const _rg4b = findBestMatchForDirection(['胜'], _rg4a ? [_rg4a.matchId] : null, 60);
      push2MatchPlan('四', 4, _rg4a, '平、让平', _rg4b, '胜', 250, 10, 25, 0, 1.3);
    }

    // ★ 方案五 V16.3: 胜平 × 平负 (2串1，≥4场，A≥5胜平/B≥1平负，盈≥200%)
    if (matchCount >= 4) {
      const _rg5a = findBestMatchForDirection(['胜平'], null, 5);
      const _rg5b = findBestMatchForDirection(['平负'], _rg5a ? [_rg5a.matchId] : null, 1);
      push2MatchPlan('五', 5, _rg5a, '胜平', _rg5b, '平负', 250, 10, 25, 0, 1.0);
    }
  }

  // ── 方案七：单关双选（胜平/平负）──
  // ★ 方案七 V16.3: WC≥10人 + 盈≥10%；常规≥5人 + 盈≥50%
  const _minCount7 = isWC ? 10 : 5;
  const singleMatches = [];
  for (let smi = 0; smi < mList.length; smi++) {
    const _sm = mList[smi];
    const _smd = matchDataMap[_sm.matchId];
    if (_smd && _smd.odds && _smd.odds.isSingleGame === true) singleMatches.push(_sm);
  }
  if (singleMatches.length > 0) {
    let bestM7 = null,
      bestM7Dir = '',
      bestM7Count = 0;
    for (let si7 = 0; si7 < singleMatches.length; si7++) {
      const _sm7 = singleMatches[si7];
      const _r7 = matchDataMap[_sm7.matchId].recs;
      for (let ri7 = 0; ri7 < _r7.length; ri7++) {
        if ((_r7[ri7].type === '胜平' || _r7[ri7].type === '平负') && _r7[ri7].num > bestM7Count) {
          bestM7Count = _r7[ri7].num;
          bestM7 = _sm7;
          bestM7Dir = _r7[ri7].type;
        }
      }
    }
    if (bestM7 && bestM7Dir && bestM7Count >= _minCount7) {
      const m7Obj = buildMatchObj(bestM7, bestM7Dir);
      const subOdds7 = extractSubOdds(m7Obj.odds, bestM7Dir);
      const invSum7 = subOdds7.reduce(function (s, o) {
        return s + 1 / o;
      }, 0);
      const maxPrize7 = invSum7 > 0 ? Math.round(1000 / invSum7) : 0;
      // ★ 盈≥10%(WC) / 盈≥50%(常规 V16.3)
      const _minPrize7 = isWC ? 1100 : 1500;
      if (maxPrize7 >= _minPrize7) {
        const plan7Result = computePlanResult([m7Obj]);
        plans.push({
          planId: 'plan_' + dateStr + '_' + _planSuffix(7),
          name: 'plan_' + _planSuffix(7),
          planName: _planDisplayName(7),
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
  }

  // ── 方案八：胜（单关）— 仅世界杯，≥80人，盈≥5% ──
  if (isWC) {
    const _singleMatches8 = [];
    for (let _smi8 = 0; _smi8 < mList.length; _smi8++) {
      const _sm8c = mList[_smi8];
      const _smd8 = matchDataMap[_sm8c.matchId];
      if (_smd8 && _smd8.odds && _smd8.odds.isSingleGame === true) _singleMatches8.push(_sm8c);
    }
    if (_singleMatches8.length > 0) {
      let _bestM8 = null,
        _bestCount8 = 0;
      for (let _si8 = 0; _si8 < _singleMatches8.length; _si8++) {
        const _sm8 = _singleMatches8[_si8];
        const _recs8 = matchDataMap[_sm8.matchId].recs;
        for (let _ri8 = 0; _ri8 < _recs8.length; _ri8++) {
          if (_recs8[_ri8].type === '胜' && _recs8[_ri8].num > _bestCount8) {
            _bestCount8 = _recs8[_ri8].num;
            _bestM8 = _sm8;
          }
        }
      }
      if (_bestM8 && _bestCount8 >= 80) {
        const _m8Obj = buildMatchObj(_bestM8, '胜');
        const _m8Odds = _m8Obj.odds;
        const _e8 = _m8Odds && _m8Odds.spf ? _m8Odds.spf.home : null;
        const _maxPrize8 = _e8 && _e8 > 0 ? Math.round(1000 * _e8) : 0;
        // ★ 盈≥5%
        if (_maxPrize8 >= 1050) {
          const _plan8Result = computePlanResult([_m8Obj]);
          plans.push({
            planId: 'plan_' + dateStr + '_' + _planSuffix(8),
            name: 'plan_' + _planSuffix(8),
            planName: _planDisplayName(8),
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
  }

  // ── 比赛低于5场时最多只保留前2个方案 ──
  if (matchCount < 5 && plans.length > 2) {
    plans.splice(2);
  }

  return plans;
}

// ═══ 方案快照（用于锁定后固化方案身份） ═══
const SNAPSHOT_DIR = require('path').join(__dirname, '..', 'plan_snapshots');

/**
 * 提取方案身份（仅 matches+directions，不含结果/赔率）
 */
function snapshotPlanIdentity(plan) {
  return {
    planId: plan.planId,
    name: plan.name,
    planName: plan.planName,
    playType: plan.playType,
    passType: plan.passType,
    multiplier: plan.multiplier,
    amount: plan.amount,
    matches: (plan.matches || []).map(function (m) {
      return {
        matchId: m.matchId,
        direction: m.direction,
        homeName: m.homeName,
        visitName: m.visitName,
        matchNum: m.matchNum,
      };
    }),
  };
}

/**
 * 保存方案快照
 */
function savePlanSnapshot(dateStr, plans, earliestKickoff, lockedAt) {
  try {
    const fs = require('fs');
    const path = require('path');
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const snap = {
      lockedAt: lockedAt || new Date().toISOString(),
      earliestKickoff: earliestKickoff,
      date: dateStr,
      plans: plans.map(snapshotPlanIdentity),
    };
    fs.writeFileSync(path.join(SNAPSHOT_DIR, dateStr + '.json'), JSON.stringify(snap, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 加载方案快照
 */
function loadPlanSnapshot(dateStr) {
  try {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(SNAPSHOT_DIR, dateStr + '.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

// ═══ 模块级赔率提取（供 hydrateSnapshotWithResults 复用）═══

/**
 * 提取子方向赔率（从 generatePlansForGroup 提升到模块级）
 */
function extractSubOdds(oddsObj, direction) {
  const vals = [];
  if (direction.indexOf('总进球-') === 0) {
    const tg = oddsObj.totalGoals;
    if (!tg) return vals;
    const nums = direction.replace('总进球-', '').split(/[、,]/);
    nums.forEach(function (n) {
      const v = n.replace(/球/g, '').trim();
      if (tg[v] !== undefined) vals.push(tg[v]);
    });
    return vals;
  }
  if (direction.indexOf('、') >= 0 || direction.indexOf(',') >= 0) {
    if (direction.indexOf('半全场-') === 0) {
      const hfParts = direction.split(/[、,]/);
      // ★ V16.1: 对齐 odds_history 中文拼音键名 (ss=胜胜, sp=胜平, ...)
      const hfMap = {
        胜胜: 'ss',
        胜平: 'sp',
        胜负: 'sf',
        平胜: 'ps',
        平平: 'pp',
        平负: 'pf',
        负胜: 'fs',
        负平: 'fp',
        负负: 'ff',
      };
      hfParts.forEach(function (pd) {
        pd = pd.trim();
        if (pd.indexOf('半全场-') === 0) pd = pd.substring(4);
        const hfKey = hfMap[pd];
        if (hfKey && oddsObj.halfFull && oddsObj.halfFull[hfKey] !== undefined) vals.push(oddsObj.halfFull[hfKey]);
      });
      return vals;
    }
    const parts = direction.split(/[、,]/);
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
  // ★ 单方向半全场 (如 "半全场-胜胜" / "半全场-负平") — odds 中文拼音键
  const singleHF = direction.match(/^半全场-(.+)$/);
  if (singleHF && oddsObj.halfFull) {
    const hfKM = {
      胜胜: 'ss',
      胜平: 'sp',
      胜负: 'sf',
      平胜: 'ps',
      平平: 'pp',
      平负: 'pf',
      负胜: 'fs',
      负平: 'fp',
      负负: 'ff',
    };
    const hfK2 = hfKM[singleHF[1]];
    if (hfK2 && oddsObj.halfFull[hfK2] !== undefined) vals.push(oddsObj.halfFull[hfK2]);
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

/**
 * 将快照身份 + 当前推荐结果 → 带有结果的方案对象
 * 供 income-stats 使用：方案身份用快照，结果从 data.json.r 回填
 */
function hydrateSnapshotWithResults(snapshot, mMap, rMap, histOdds) {
  if (!snapshot || !snapshot.plans) return [];
  const dateStr = snapshot.date;
  return snapshot.plans.map(function (sp) {
    const matches = (sp.matches || []).map(function (sm) {
      const m = mMap['m_' + sm.matchId] || mMap[sm.matchId] || {};
      const raw = rMap['m_' + sm.matchId] || rMap[sm.matchId] || [];
      let rec = null;
      // ★ 两遍扫描：优先精确匹配（如"平、让平"），再接受子串匹配（如"平"）
      for (let i = 0; i < raw.length; i++) {
        const rt = raw[i].t || raw[i].type;
        if (rt === sm.direction) { rec = raw[i]; break; }
      }
      if (!rec) {
        for (let i = 0; i < raw.length; i++) {
          const rt = raw[i].t || raw[i].type;
          if (sm.direction.indexOf(rt) >= 0 || (rt && rt.indexOf(sm.direction) >= 0)) {
            rec = raw[i]; break;
          }
        }
      }
      // ★ V16 三层判定：① midou310 result → ② sporttery lotteryResult → ③ judgeByScore 兜底
      let midouResult = null;
      if (rec) {
        // 第①层: midou310 result (主力，覆盖面最广)
        const mr = rec.result !== undefined ? rec.result : null;
        midouResult = mr === 0 || mr === 1 ? mr : null;
      }
      let result = midouResult; // 默认用 midou310

      // 第②层: sporttery lotteryResult (权威，替代旧 rs/比分直判)
      let sportteryResult = null;
      if (result === null && m && m.matchId) {
        sportteryResult = judgeBySporttery(m.matchId, sm.direction);
        if (sportteryResult === true) result = 1;
        else if (sportteryResult === false) result = 0;
      }

      // 第③层: judgeByScore 比分直判 (最终兜底)
      if (result === null && m && m.score && m.matchStatus >= 1) {
        const _sf = judgeByScore(sm.direction, m.score, null, m.halfScore || '');
        if (_sf !== null) result = _sf ? 1 : 0;
      }

      // ★ 交叉印证: midou310 和 sporttery 都有值时对比
      if (midouResult !== null && sportteryResult !== null) {
        const spAsInt = sportteryResult === true ? 1 : 0;
        if (midouResult !== spAsInt) {
          // 不一致 → 以 sporttery 为准（更权威），但记录差异
          result = spAsInt;
          if (typeof console !== 'undefined' && console.warn) {
            console.warn(
              '[cross-check] midou/sporttery 不一致: matchId=' +
                m.matchId +
                ' dir=' +
                sm.direction +
                ' midou=' +
                midouResult +
                ' sporttery=' +
                spAsInt +
                ' → 以sporttery为准',
            );
          }
        }
      }

      const isMatchWon = result === 1 ? true : result === 0 ? false : null;
      const isMatchLose = result === 0 ? true : result === 1 ? false : null;
      const num = sm.matchNum || m.num || '';
      let oddsObj = null;
      if (histOdds && histOdds[num]) {
        const od = histOdds[num];
        oddsObj = {
          spf: od.spf || null,
          rqspf: od.rqspf || null,
          totalGoals: od.totalGoals || null,
          halfFull: od.halfFull || null,
        };
      }
      // ★ V16.1: 复合方向拆分为独立 subResults，前端按子项匹配颜色
      let subResults;
      if (sm.direction.indexOf('、') >= 0 || sm.direction.indexOf(',') >= 0) {
        const subDirs = sm.direction.split(/[、,]/);
        subResults = subDirs.map(function (sd) {
          sd = sd.trim();
          let sdResult = null;
          // 逐个判定子方向结果
          const spSub = judgeBySporttery(sm.matchId || (m ? m.matchId : null), sd);
          if (spSub === true) sdResult = 1;
          else if (spSub === false) sdResult = 0;
          else {
            let subRec = null;
            for (let sri = 0; sri < raw.length; sri++) {
              const srt = raw[sri].t || raw[sri].type || '';
              if (srt === sd || srt.indexOf(sd) >= 0 || sd.indexOf(srt) >= 0) {
                subRec = raw[sri];
                break;
              }
            }
            if (subRec) {
              const srRaw = subRec.result !== undefined ? subRec.result : null;
              sdResult = srRaw === 0 || srRaw === 1 ? srRaw : null;
            }
            // ★ V17: 总进球多选 → 始终用比分判定（midou310 可能把多个子方向都标为 1）
            const isTGMulti = sm.direction.indexOf('总进球-') === 0 && sm.direction.indexOf('、') > 0;
            // ★ V17: 让球/总进球子方向通过比分判定（传入 m.concede 兜底让球数）
            const hcpFallback = m && m.concede != null ? m.concede : null;
            if (isTGMulti && m && m.score && m.matchStatus >= 1) {
              var sdSf = judgeByScore(sd, m.score, hcpFallback, m.halfScore || '');
              if (sdSf !== null) sdResult = sdSf ? 1 : 0;
            } else if (sdResult === null && m && m.score && m.matchStatus >= 1) {
              var sdSf = judgeByScore(sd, m.score, hcpFallback, m.halfScore || '');
              if (sdSf !== null) sdResult = sdSf ? 1 : 0;
            }
            // ★ V17: 比赛已结束但仍无法判定 → 标记为 -1（区别于 null 的"未开赛"）
            if (sdResult === null && m && m.score && m.matchStatus >= 1) {
              sdResult = -1;
            }
          }
          return { direction: sd, result: sdResult };
        });
      } else {
        subResults = [{ direction: sm.direction, result: result }];
      }
      return {
        matchId: sm.matchId,
        homeName: sm.homeName || m.homeName || '',
        visitName: sm.visitName || m.visitName || '',
        matchNum: sm.matchNum || m.num || '',
        direction: sm.direction,
        isMatchWon: isMatchWon,
        isMatchLose: isMatchLose,
        subResults: subResults,
        odds: oddsObj,
        actualScore: (m.score || '').replace(/:/g, '-'),
      };
    });

    let allWon = true,
      anyLose = false,
      anyUnknown = false;
    for (let j = 0; j < matches.length; j++) {
      const mm = matches[j];
      if (mm.isMatchWon === true) continue;
      if (mm.isMatchLose === true) {
        anyLose = true;
        allWon = false;
      } else {
        anyUnknown = true;
        allWon = false;
      }
    }
    const isPlanWon = anyUnknown ? null : allWon;
    const isPlanLose = anyUnknown ? null : !allWon && anyLose;

    // ★ 对齐 push2MatchPlan 的奖金计算（支持复合方向 + 荷兰式 + 整数舍入）
    let maxPrize = 0;
    if (sp.amount && sp.multiplier) {
      let productOdds = 1;
      const isSingleMatch = matches.length === 1;
      for (let k = 0; k < matches.length; k++) {
        const od = matches[k].odds;
        if (!od) {
          productOdds = 0;
          break;
        }
        const dir = matches[k].direction;
        // 使用 extractSubOdds + calcEffectiveOdds 处理复合方向
        const subOdds = extractSubOdds(od, dir);
        if (subOdds.length === 0) {
          productOdds = 0;
          break;
        }
        if (subOdds.length === 1) {
          productOdds *= subOdds[0];
        } else {
          // 荷兰式均分（双选等）
          const invSum = subOdds.reduce(function (s, o) {
            return s + 1 / o;
          }, 0);
          productOdds *= invSum > 0 ? 1 / invSum : 0;
        }
      }
      if (productOdds > 0) {
        if (isSingleMatch && matches[0].direction.indexOf('总进球-') === 0 && matches[0].direction.indexOf('、') > 0) {
          // 单关多选（如 总进球-2、3球）：荷兰式均分
          const subOdds2 = extractSubOdds(matches[0].odds, matches[0].direction);
          if (subOdds2.length >= 2) {
            const invSum2 = subOdds2.reduce(function (s, o) {
              return s + 1 / o;
            }, 0);
            maxPrize = invSum2 > 0 ? Math.round(sp.amount / invSum2) : 0;
          }
        } else if (isSingleMatch && (matches[0].direction === '胜平' || matches[0].direction === '平负')) {
          // 单关双选（如 胜平）：荷兰式均分
          const subOdds3 = extractSubOdds(matches[0].odds, matches[0].direction);
          if (subOdds3.length >= 2) {
            const invSum3 = subOdds3.reduce(function (s, o) {
              return s + 1 / o;
            }, 0);
            maxPrize = invSum3 > 0 ? Math.round(sp.amount / invSum3) : 0;
          }
        } else {
          // 2串1：标准乘法
          maxPrize = Math.round(sp.amount * productOdds);
        }
      }
    }

    return {
      planId: sp.planId,
      name: sp.name,
      planName: sp.planName,
      playType: sp.playType,
      passType: sp.passType,
      multiplier: sp.multiplier || 25,
      amount: sp.amount || 1000,
      matches: matches,
      matchCount: matches.length,
      isPlanWon: isPlanWon,
      isPlanLose: isPlanLose,
      maxPrize: maxPrize,
      winningPrize: isPlanWon === true ? maxPrize : 0,
    };
  });
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
  judgeBySporttery,
  extractSubOdds,
  // 增强筛选
  applyEnhancedFilters,
  assessSchemeRisk,
  // 专家博热方案
  generateExpertPlans,
  // 方案快照
  snapshotPlanIdentity,
  savePlanSnapshot,
  loadPlanSnapshot,
  hydrateSnapshotWithResults,
  SNAPSHOT_DIR,
};

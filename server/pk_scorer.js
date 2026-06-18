/**
 * server/pk_scorer.js
 * PK 融合评分逻辑 — 从 match-pk-fusion.js 迁移到服务端
 *
 * 每天凌晨/赛前由 scheduler 触发 computeAndSave()
 */

const fs = require('fs');
const path = require('path');
const predictionLog = require('./prediction_log');
// V2.0 新增模块
const oddsMovement = require('./core/odds-movement');
const leagueHeat = require('./core/league-heat-profile');
const matchDataPack = require('./core/match-data-pack');

// ═══════════════════════════════════════
//  PK Scorer 版本管理 — 每次优化修改此处
// ═══════════════════════════════════════
const PK_SCORER_VERSION = 'pk_v2.0'; // ★ 版本号，修改算法时递增
const PK_SCORER_HASH = ''; // 可选：算法内容哈希（CI 自动计算）
const EXPERIMENT_ID = ''; // 实验 ID（空 = 非实验模式）
const EXPERIMENT_GROUP = ''; // 'control' 或 'treatment'

// ═══════════════════════════════════════
//  评分算法（从前端迁移）
// ═══════════════════════════════════════

function normalize(val, min, max) {
  if (max - min < 0.0001) return 50;
  return parseFloat((((val - min) / (max - min)) * 100).toFixed(1));
}

function calcPowerScores(list) {
  const gds = list.map(function (x) {
    return parseFloat(x.gdScore) || 0;
  });
  const cvs = list.map(function (x) {
    return parseFloat(x.crossValue) || 0;
  });
  const pws = list.map(function (x) {
    return parseFloat(x.pwScore) || 0;
  });
  const ads = list.map(function (x) {
    return parseFloat(x.adCombined) || 0;
  });

  const gdMin = Math.min.apply(null, gds),
    gdMax = Math.max.apply(null, gds);
  const cvMin = Math.min.apply(null, cvs),
    cvMax = Math.max.apply(null, cvs);
  const pwMin = Math.min.apply(null, pws),
    pwMax = Math.max.apply(null, pws);
  const adMin = Math.min.apply(null, ads),
    adMax = Math.max.apply(null, ads);

  return list.map(function (item, i) {
    return parseFloat(
      (
        normalize(gds[i], gdMin, gdMax) * 0.25 +
        normalize(cvs[i], cvMin, cvMax) * 0.15 +
        normalize(pws[i], pwMin, pwMax) * 0.35 +
        normalize(ads[i], adMin, adMax) * 0.25
      ).toFixed(1),
    );
  });
}

function calcGoalScores(list) {
  const bbrs = list.map(function (x) {
    return parseFloat(x.bigBallRatio) || 50;
  });
  const atts = list.map(function (x) {
    return parseFloat(x.attDefGoal) || 0;
  });
  const h2hs = list.map(function (x) {
    return parseFloat(x.headToHeadGoal) || 2.5;
  });
  const bkas = list.map(function (x) {
    return parseFloat(x.breakArmor) || 0;
  });

  const bbMin = Math.min.apply(null, bbrs),
    bbMax = Math.max.apply(null, bbrs);
  const atMin = Math.min.apply(null, atts),
    atMax = Math.max.apply(null, atts);
  const h2Min = Math.min.apply(null, h2hs),
    h2Max = Math.max.apply(null, h2hs);
  const bkMin = Math.min.apply(null, bkas),
    bkMax = Math.max.apply(null, bkas);

  return list.map(function (item, i) {
    return parseFloat(
      (
        normalize(bbrs[i], bbMin, bbMax) * 0.35 +
        normalize(atts[i], atMin, atMax) * 0.25 +
        normalize(h2hs[i], h2Min, h2Max) * 0.2 +
        normalize(bkas[i], bkMin, bkMax) * 0.2
      ).toFixed(1),
    );
  });
}

function calcHeatScores(list) {
  return list.map(function (item) {
    const hi = parseFloat(item.heatIndex);
    if (isNaN(hi) || hi <= 0) return 50;
    const delta = Math.abs(1.0 - hi);
    const score = 100 - 100 * Math.pow(delta, 1.5);
    return parseFloat(Math.max(0, Math.min(100, score)).toFixed(1));
  });
}

function calcHealthScores(list) {
  return list.map(function (item) {
    const c = item.fusionConsensus;
    if (c === 'strong') return 100;
    if (c === 'weak') return 70;
    // V2.0: 熔断不再给0分，保留最低基础分20（模型仍输出预测，仅供参考）
    if (c === 'meltdown') return 20;
    return 50;
  });
}

/**
 * ★ V9.0 赢盘率评分维度（第7维）
 * 取 homeWinPan / 2 × 100 作为赢盘率评分（0=全输, 50=均衡, 100=全赢）
 */
function calcWinPanScores(list) {
  return list.map(function (item) {
    const wp = parseFloat(item.homeWinPan);
    if (isNaN(wp)) return 50;
    // 赢盘率 / 2 × 100（文档: 0最低 2最高）
    return parseFloat(Math.max(0, Math.min(100, (wp / 2) * 100)).toFixed(1));
  });
}

function calcStabilityScores(list) {
  return list.map(function (item) {
    const s = parseFloat(item.stabilityOverall);
    return isNaN(s) ? 50 : parseFloat(Math.max(0, Math.min(100, s)).toFixed(1));
  });
}

function calcVerificationScores(list) {
  // ★ V9.1 ZQ-03: 预热离散度数据（批量加载 JczqBasic）
  let discreteCache = null;
  try {
    const { loadBasic, discreteWarning } = require('./core/data-fusion');
    // 预取第一场比赛的日期用于离散度检测
    if (list.length > 0 && list[0].date) {
      const firstDate = list[0].date.slice(0, 10);
      // 批量计算所有比赛的离散度
      discreteCache = {};
    }
  } catch (e) {
    /* data-fusion 不可用 */
  }

  return list.map(function (item) {
    let score = 100;
    const details = [];
    const ll = item.ladderLevel || 0;
    const hAward = parseFloat(item.homeWinAward) || 0;
    const aAward = parseFloat(item.awayWinAward) || 0;
    const winPan = parseFloat(item.homeWinPan) || 0;
    const awayWinPan = parseFloat(item.awayWinPan) || 0;
    const pw = parseFloat(item.pwScore) || 0;
    const sg = parseFloat(item.strengthGoal) || 0;
    const adg = parseFloat(item.attDefGoal) || 0;

    if (ll >= 2 && pw < 0) {
      score -= 15;
      details.push('ladder disagrees with PW');
    }
    if (sg > 1.5 && adg < 2.0) {
      score -= 10;
      details.push('strength vs attDef conflict');
    }
    if (hAward > 0 && aAward > 0) {
      if (pw > 0.15 && aAward < hAward) {
        score -= 12;
        details.push('odds favor away');
      }
      if (pw < -0.15 && hAward < aAward) {
        score -= 12;
        details.push('odds favor home');
      }
    }
    if (winPan > 0 && awayWinPan > 0) {
      if (pw > 0.1 && awayWinPan > winPan + 5) {
        score -= 8;
        details.push('pan favors away');
      }
    }
    const bbr = parseFloat(item.bigBallRatio) || 50;
    const lob = item.leagueOverBaseline || 55;
    if (bbr > 70 && lob < 50) {
      score -= 10;
      details.push('bigBall vs league mismatch');
    }

    // ═══ V9.1 ZQ-03: 离散度预警检测 ═══
    try {
      const { loadBasic, discreteWarning } = require('./core/data-fusion');
      const dateStr = (item.date || '').slice(0, 10);
      const matchNum = String(item.num || '').replace(/^[^\\d]*/, '');
      if (dateStr && matchNum) {
        const basic = loadBasic(dateStr, matchNum);
        if (basic) {
          const discrete = discreteWarning(null, basic);
          if (discrete.flagLevel === 'warning' && pw > 0.15) {
            score -= 10;
            details.push('discrete expanded with PW bias');
          } else if (discrete.flagLevel === 'caution') {
            score -= 5;
            details.push('discrete slightly expanded');
          }
        }
      }
    } catch (e) {
      /* skip discrete check */
    }

    // ═══ V2.0: P4 盘口位移验证 ═══
    const openHome = parseFloat(item.openHomeAward) || 0;
    const openDraw = parseFloat(item.openDrawAward) || 0;
    const openAway = parseFloat(item.openAwayAward) || 0;
    const liveHome = hAward;
    const liveDraw = parseFloat(item.drawAward) || 0;
    const liveAway = aAward;

    if (openHome > 1.0 && liveHome > 1.0) {
      const moveResult = oddsMovement.analyzeMovement(
        { home: openHome, draw: openDraw, away: openAway },
        { home: liveHome, draw: liveDraw, away: liveAway },
        pw,
      );
      if (moveResult.penalty > 0) {
        score -= moveResult.penalty;
        details.push('odds movement: ' + moveResult.direction + ' (shift=' + moveResult.probShift.toFixed(3) + ')');
      }

      // ★ V9.1 ZQ-03: 盘口位移与 pw 方向一致 → bonus
      if (moveResult.penalty === 0 && moveResult.severity !== 'none') {
        const isSameDirection = (pw > 0 && moveResult.probShift > 0) || (pw < 0 && moveResult.probShift < 0);
        if (isSameDirection) {
          score += 5;
          details.push('movement aligns with PW (+5)');
        }
      }
    }

    // ═══ V2.0: P4 欧亚一致性检测 ═══
    const rq = parseFloat(item.rq) || parseFloat(item.handicap) || 0;
    if (hAward > 1.0 && aAward > 1.0) {
      const euroAsia = oddsMovement.checkEuroAsiaConsistency({ home: hAward, draw: liveDraw, away: aAward }, rq, pw);
      if (euroAsia.penalty > 0) {
        score -= euroAsia.penalty;
        details.push(euroAsia.detail);
      }
    }

    return { score: parseFloat(Math.max(0, score).toFixed(1)), details: details };
  });
}

function calcAgeWeight(dataAge, dataType) {
  if (dataAge < 0) return 1.0;
  const halfLife = { odds: 15, heat: 30, ai: 60, stats: 360 };
  const h = halfLife[dataType] || 120;
  return Math.pow(0.5, dataAge / h);
}

// ═══ V2.0: 按玩法切换评分权重 Profile ═══
// ★ V9.0: 新增第7维 winPan（赢盘率），各玩法微调权重
const SCORE_PROFILES = {
  spf: { power: 0.35, goal: 0.1, heat: 0.1, health: 0.1, stability: 0.1, verify: 0.15, winPan: 0.1 },
  overUnder: { power: 0.1, goal: 0.3, heat: 0.05, health: 0.2, stability: 0.15, verify: 0.1, winPan: 0.1 },
  handicap: { power: 0.35, goal: 0.05, heat: 0.05, health: 0.1, stability: 0.1, verify: 0.25, winPan: 0.1 },
  default: { power: 0.25, goal: 0.15, heat: 0.1, health: 0.15, stability: 0.1, verify: 0.15, winPan: 0.1 },
};

function calcCompositeScore(pwr, goal, heat, health, stab, verif, winPan, playType) {
  const p = SCORE_PROFILES[playType] || SCORE_PROFILES.default;
  return parseFloat(
    (
      p.power * pwr +
      p.goal * goal +
      p.heat * heat +
      p.health * health +
      p.stability * stab +
      p.verify * verif +
      p.winPan * winPan
    ).toFixed(1),
  );
}

function computeAllScores(list) {
  const powerScores = calcPowerScores(list);
  const goalScores = calcGoalScores(list);
  const heatScores = calcHeatScores(list);
  const healthScores = calcHealthScores(list);
  const stabilityScores = calcStabilityScores(list);
  const winPanScores = calcWinPanScores(list);
  const verificationResults = calcVerificationScores(list);
  const verificationScores = verificationResults.map(function (v) {
    return v.score;
  });

  return list.map(function (item, i) {
    const pwr = powerScores[i];
    const goal = goalScores[i];
    const heat = heatScores[i];
    const health = healthScores[i];
    const stab = stabilityScores[i];
    const verif = verificationScores[i];
    const winPan = winPanScores[i];
    const da = item.dataAge;
    const heatAdj = heat * calcAgeWeight(da, 'heat');
    const stabAdj = stab * calcAgeWeight(da, 'stats');
    let comp = calcCompositeScore(pwr, goal, heatAdj, health, stabAdj, verif, winPan);
    if (da > 240) comp = Math.max(0, comp - 5);
    else if (da > 120) comp = Math.max(0, comp - 3);
    // ★ pk_v2.0: strong 共识 + 验证高分 → 奖励 +3
    if (item.fusionConsensus === 'strong' && verif >= 85 && comp < 95) comp += 3;
    return {
      item: item,
      powerScore: pwr,
      goalScore: goal,
      heatScore: heat,
      healthScore: health,
      stabilityScore: stab,
      verificationScore: verif,
      verificationDetails: verificationResults[i].details,
      winPanScore: winPan,
      compositeScore: parseFloat(comp.toFixed(1)),
      stars: Math.round(comp / 20),
    };
  });
}

// ═══════════════════════════════════════
//  裁判层标准字段（M2 开发落地）
// ═══════════════════════════════════════

function normalizeFinalDirection(dir) {
  const text = String(dir || '').trim();
  if (!text || /观望|避开|数据不足/.test(text)) return 'watch';
  return text;
}

function resolveExpectedValue(advice) {
  if (!advice || !advice.ev) return null;
  const dir = String(advice.dir || '');
  if (dir.indexOf('主胜') === 0) return advice.ev.evHome;
  if (dir.indexOf('客胜') === 0) return advice.ev.evAway;
  if (dir.indexOf('平') === 0) return advice.ev.evDraw;
  return null;
}

function buildDecisionNarrative(advice, decisionLevel, riskLevel, degradeReasons) {
  const dirText = normalizeFinalDirection(advice && advice.dir) === 'watch' ? '观望' : advice.dir;
  const riskText = riskLevel === 'red' ? '高' : riskLevel === 'yellow' ? '中' : '低';
  const reason = (advice && advice.desc) || '基于 PK 综合评分输出';
  let text = 'PK裁判：' + dirText + '，评级' + decisionLevel + '，风险' + riskText + '。理由：' + reason;
  if (Array.isArray(degradeReasons) && degradeReasons.length > 0) text += '；降级原因：' + degradeReasons.join('、');
  return text;
}

function applyStandardDecisionFields(scored, advice) {
  const item = (scored && scored.item) || {};
  const riskTags = [];
  const degradeReasons = [];
  const expectedValue = resolveExpectedValue(advice);
  const stars = Math.max(0, Math.min(5, parseInt((advice && advice.stars) || 0, 10) || 0));
  const finalDirection = normalizeFinalDirection(advice && advice.dir);

  if (item.fusionConsensus === 'meltdown') {
    riskTags.push('模型熔断');
    degradeReasons.push('功守道融合熔断，禁止主推');
  }
  if (advice && advice.heatZ && advice.heatZ.isOverheat) {
    riskTags.push('热度过高');
    degradeReasons.push('热度过高，建议降级观察');
  }
  if (advice && advice.valueTag === '⚠️负期望') {
    riskTags.push('负期望');
    degradeReasons.push('EV 为负，不升为主推');
  }
  if (item.dataAge > 240) {
    riskTags.push('数据陈旧');
    degradeReasons.push('数据更新时间超过 240 分钟');
  } else if (item.dataAge > 120) {
    riskTags.push('数据偏旧');
    degradeReasons.push('数据更新时间超过 120 分钟');
  }
  if (scored && scored.verificationScore < 70) {
    riskTags.push('验证分偏低');
    degradeReasons.push('盘口/交叉验证分偏低');
  }
  if (finalDirection === 'watch') {
    riskTags.push('建议观望');
  }

  let riskLevel = 'green';
  if (item.fusionConsensus === 'meltdown' || finalDirection === 'watch' || riskTags.length >= 3) riskLevel = 'red';
  else if (riskTags.length > 0 || stars <= 2) riskLevel = 'yellow';

  let decisionLevel = '观望';
  if (finalDirection !== 'watch') {
    if (stars >= 5) decisionLevel = '主推';
    else if (stars >= 3) decisionLevel = '可做';
    else if (stars >= 2) decisionLevel = '谨慎';
  }
  if (decisionLevel === '主推' && degradeReasons.length > 0) decisionLevel = '可做';
  if (item.fusionConsensus === 'meltdown' && decisionLevel !== '观望') decisionLevel = '谨慎';

  advice.playType = advice.playType || 'spf';
  advice.finalDirection = finalDirection;
  advice.decisionLevel = decisionLevel;
  advice.riskLevel = riskLevel;
  advice.riskTags = riskTags;
  advice.degradeReasons = degradeReasons;
  advice.decisionNarrative = buildDecisionNarrative(advice, decisionLevel, riskLevel, degradeReasons);
  advice.expectedValue = expectedValue;
  advice.valueEdge = null;
  advice.finalDecision =
    decisionLevel === '主推'
      ? 'main_pick'
      : decisionLevel === '可做'
        ? 'playable'
        : decisionLevel === '谨慎'
          ? 'cautious'
          : 'watch';
  return advice;
}

// ═══════════════════════════════════════
//  方向推荐（从前端迁移）
// ═══════════════════════════════════════

function getDirectionAdvice(scored, ranked) {
  const item = scored && scored.item ? scored.item : {};
  const pw = parseFloat(item.pwScore) || 0;
  const hi = parseFloat(item.heatIndex);
  const meltdown = item.fusionConsensus === 'meltdown';
  const isWeak = item.fusionConsensus === 'weak';
  const isNaNHi = isNaN(hi) || hi <= 0;

  // ═══ V2.0 P5: 联赛自适应热度阈值 ═══
  const leagueName = item.leagueName || '';
  let heatZ = null;
  let isOverheat = false;
  let isCold = false;
  if (!isNaNHi) {
    heatZ = leagueHeat.computeHeatZScore(hi, leagueName);
    isOverheat = heatZ.isOverheat;
    isCold = heatZ.isCold;
  }

  let result;

  // V2.0: 熔断改为降级 — 保留模型预测但强制降星
  if (meltdown) {
    if (pw >= 0.08) {
      result = { dir: '主胜（参考）', stars: 2, desc: '模型分歧较大，预测仅供参考' };
    } else if (pw <= -0.08) {
      result = { dir: '客胜（参考）', stars: 2, desc: '模型分歧较大，预测仅供参考' };
    } else {
      result = { dir: '观望/避开', stars: 0, desc: '模型分歧较大且无明确方向' };
    }
  } else if (pw >= 0.25 && !isNaNHi && !isOverheat) {
    result = { dir: '主胜', stars: 5, desc: '绝对优势' };
  } else if (pw >= 0.08 && !meltdown) {
    if (!isNaNHi && isOverheat) {
      result = { dir: '主胜（防冷）', stars: 3, desc: '过热预警(HI-Z=' + (heatZ ? heatZ.zScore : '?') + ')' };
    } else {
      result = { dir: '主胜', stars: 4, desc: '明显优势' };
      if (!isNaNHi && isCold)
        result = { dir: '主胜', stars: 4, desc: '冷门高赔(HI-Z=' + (heatZ ? heatZ.zScore : '?') + ')' };
    }
  } else if (pw <= -0.25 && !isNaNHi && !isOverheat) {
    result = { dir: '客胜', stars: 5, desc: '绝对优势' };
  } else if (pw <= -0.08 && !meltdown) {
    if (!isNaNHi && isOverheat) {
      result = { dir: '客胜（防冷）', stars: 3, desc: '过热预警(HI-Z=' + (heatZ ? heatZ.zScore : '?') + ')' };
    } else {
      result = { dir: '客胜', stars: 4, desc: '明显优势' };
    }
  } else if (pw > -0.08 && pw < 0.08) {
    if (meltdown) {
      result = { dir: '观望/避开', stars: 0, desc: '模型打架' };
    } else if (isWeak) {
      result = { dir: '胜/平双选', stars: 2, desc: '弱一致' };
    } else {
      result = { dir: '胜/平双选', stars: 2, desc: '实力均衡' };
    }
  }

  result = result || { dir: '观望/避开', stars: 1, desc: '数据不足' };

  // HCP direction
  const crossHcpWin = parseFloat(item.crossHcpWin) || 0;
  const crossHcpLose = parseFloat(item.crossHcpLose) || 0;
  if (crossHcpWin > crossHcpLose + 0.05) result.hcpDir = '主队让球胜';
  else if (crossHcpLose > crossHcpWin + 0.05) result.hcpDir = '客队让球胜';
  else result.hcpDir = '';

  // Goal direction
  let totalGoals = parseFloat(item.attDefGoal);
  if (isNaN(totalGoals) || totalGoals <= 0) totalGoals = parseFloat(item.headToHeadGoal) || 0;
  if (totalGoals > 6.5 && parseFloat(item.fusionFinalTotal) > 0) totalGoals = parseFloat(item.fusionFinalTotal);
  if (totalGoals > 3.0) {
    result.goalDir = '大球';
    result.goalStars = 4;
  } else if (totalGoals >= 2.5) {
    // ★ V9.1 fix: >= 2.5 应为倾向大球
    result.goalDir = '倾向大球';
    result.goalStars = 3;
  } else {
    result.goalDir = '小球';
    result.goalStars = 3;
  }

  // ═══ V2.0 P3: EV 期望值计算 ═══
  const hAward = parseFloat(item.homeWinAward) || 0;
  const aAward = parseFloat(item.awayWinAward) || 0;
  const drawAward = parseFloat(item.drawAward) || 0;

  result.ev = null;
  result.valueTag = '';
  result.valueScore = 0;

  if (hAward > 1.0 && aAward > 1.0 && drawAward > 1.0) {
    // ★ V9.1: sigmoid 校准 — 陡峭度从 6→3.5，使 pWin 更接近实际命中率
    // pw=0.25 → pWin≈0.68（原 0.82 过度乐观）
    // pw=0.08 → pWin≈0.56（原 0.62）
    const sigmoid = function (x) {
      return 1 / (1 + Math.exp(-x * 3.5));
    };
    // 从 [0.5, 1] 重新映射到 [0.33, 0.80]，使 baseline 合理
    const rawPWin = sigmoid(pw);
    const pWin = +(0.33 + (rawPWin - 0.5) * 0.94).toFixed(4); // [0.33, ~0.80]
    // 平局概率基于实力均衡度估算
    const pDraw = +Math.max(0.18, Math.min(0.32, 0.25 - Math.abs(pw) * 0.25)).toFixed(4);
    const pLose = +(1 - pWin - pDraw).toFixed(4);

    const evHome = +(pWin * hAward - 1).toFixed(3);
    const evDraw = +(pDraw * drawAward - 1).toFixed(3);
    const evAway = +(pLose * aAward - 1).toFixed(3);

    result.ev = { evHome, evDraw, evAway, pWin: +pWin.toFixed(4), pDraw: +pDraw.toFixed(4), pAway: +pLose.toFixed(4) };

    // 价值标签
    if (result.dir.indexOf('主胜') === 0) {
      if (evHome > 0.15) {
        result.valueTag = '💰超值';
        result.valueScore = 30;
      } else if (evHome > 0.05) {
        result.valueTag = '✅正期望';
        result.valueScore = 15;
      } else if (evHome > -0.05) {
        result.valueTag = '📊合理';
        result.valueScore = 5;
      } else {
        result.valueTag = '⚠️负期望';
        result.valueScore = -10;
      }
    } else if (result.dir.indexOf('客胜') === 0) {
      if (evAway > 0.15) {
        result.valueTag = '💰超值';
        result.valueScore = 30;
      } else if (evAway > 0.05) {
        result.valueTag = '✅正期望';
        result.valueScore = 15;
      } else if (evAway > -0.05) {
        result.valueTag = '📊合理';
        result.valueScore = 5;
      } else {
        result.valueTag = '⚠️负期望';
        result.valueScore = -10;
      }
    }
  }

  // ═══ V2.0 P5: 联赛热度 Z-Score 附加信息 ═══
  result.heatZ = heatZ;

  return applyStandardDecisionFields(scored, result);
}

// ═══════════════════════════════════════
//  主入口：为指定日期比赛计算PK评分并存入 prediction_logs
// ═══════════════════════════════════════

function loadGSFields(gsCache, matchId) {
  const gsMap = (gsCache && gsCache._global) || gsCache || {};
  const cleanId = String(matchId || '').replace(/^m_/, '');
  const gs = gsMap[matchId] || gsMap['m_' + cleanId] || gsMap[cleanId];
  if (!gs) return {};

  // ★ V9.1 修复: 字段名映射对齐 GS cache 实际 key
  // crossValue 不在 GS 中，从 hWins/hLosses/aWins/aLosses 计算
  const crossValue =
    gs.hWins !== undefined && gs.aLosses !== undefined && gs.hLosses !== undefined && gs.aWins !== undefined
      ? gs.hWins + gs.aLosses - gs.hLosses - gs.aWins
      : 0;

  // dataAge 从 computedAt 计算（分钟数）
  const dataAge = gs.computedAt ? Math.round((Date.now() - new Date(gs.computedAt).getTime()) / 60000) : -1;

  // ★ V9.1: heatIndex 从 jczq_change_cache 加载
  let heatIndex = gs.heatIndex || gs.heatScore || '1.00';
  try {
    if (heatIndex === '1.00') {
      const changeCachePath = path.join(__dirname, 'jczq_change_cache.json');
      if (fs.existsSync(changeCachePath)) {
        const changeCache = JSON.parse(fs.readFileSync(changeCachePath, 'utf8'));
        const entry = changeCache[matchId] || changeCache['m_' + matchId];
        if (entry && entry.heatIndex != null) {
          heatIndex = String(entry.heatIndex);
        }
      }
    }
  } catch (e) {
    /* ignore */
  }

  return {
    gdScore: gs.gdQ !== undefined ? gs.gdQ : 0, // ★ gdQ, not gdScore
    crossValue: crossValue, // ★ 从原始字段计算
    pwScore: gs.totalStrength !== undefined ? gs.totalStrength : 0, // ★ totalStrength, not pwScore
    adCombined: gs.adWeightedComposite !== undefined ? gs.adWeightedComposite : 0, // ★ adWeightedComposite, not adCombined
    bigBallRatio: gs.bigBallRatio !== undefined ? gs.bigBallRatio : 50,
    attDefGoal: gs.attDefGoal !== undefined ? gs.attDefGoal : 0,
    headToHeadGoal: gs.h2hGoalAvg !== undefined ? gs.h2hGoalAvg : 2.5, // ★ h2hGoalAvg, not headToHeadGoal
    breakArmor: gs.breakArmorSum !== undefined ? gs.breakArmorSum : 0, // ★ breakArmorSum, not breakArmor
    heatIndex: heatIndex,
    fusionConsensus: gs.fusionConsensusType || gs.fusionConsensus || '', // ★ 优先用英文代码
    dataAge: dataAge, // ★ 从 computedAt 计算
    stabilityOverall: gs.stabilityOverall !== undefined ? gs.stabilityOverall : 50,
    ladderLevel: gs.ladderLevel || 0,
    homeWinAward: gs.homeWinAward || 0,
    awayWinAward: gs.awayWinAward || 0,
    drawAward: gs.drawAward || 0,
    homeWinPan: gs.homeWinPanRate || 0, // homeWinPanRate → homeWinPan
    awayWinPan: gs.awayWinPanRate || 0, // awayWinPanRate → awayWinPan
    strengthGoal: gs.strengthGoal || 0,
    leagueCalibration: gs.leagueCalibration || 1.0,
    leagueAvgGoals: gs.leagueAvgGoals || 2.65,
    leagueOverBaseline: gs.leagueOverBaseline || 55,
    attackPattern: gs.attackPattern || '',
    crossSpfWin: gs.crossSpfWin || 0,
    crossSpfLose: gs.crossSpfLose || 0,
    crossHcpWin: gs.crossHcpWin || 0,
    crossHcpLose: gs.crossHcpLose || 0,
    fusionFinalHome: gs.fusionFinalHome,
    fusionFinalAway: gs.fusionFinalAway,
    fusionFinalTotal: gs.fusionFinalTotal,
    xgHome: gs.xgHome || 0,
    xgAway: gs.xgAway || 0,
    _rawAttDefGoal: gs._rawAttDefGoal,
    // ★ 补充: 传递原始 win/loss 统计供 crossValue 验算
    hWins: gs.hWins,
    hLosses: gs.hLosses,
    aWins: gs.aWins,
    aLosses: gs.aLosses,
  };
}

function computeAndSave(dateStr) {
  return new Promise(function (resolve, reject) {
    try {
      if (!predictionLog.isReady()) {
        console.log('[pk_scorer] prediction_log not ready');
        resolve({ ok: 0, msg: 'DB not ready' });
        return;
      }

      // Load matches for date
      const dataFile = path.join(__dirname, 'data.json');
      if (!fs.existsSync(dataFile)) {
        resolve({ ok: 0, msg: 'no data.json' });
        return;
      }
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      const mMap = data.m || {};

      // Load GS cache
      let gsCache = {};
      const gsFile = path.join(__dirname, 'gongshoudao', 'cache.json');
      if (fs.existsSync(gsFile)) {
        try {
          gsCache = JSON.parse(fs.readFileSync(gsFile, 'utf8'));
        } catch (e) {}
      }

      // Filter matches for date
      const matches = [];
      Object.keys(mMap).forEach(function (k) {
        const m = mMap[k];
        if (!m || !m.date) return;
        const md = m.date.slice(0, 10);
        if (dateStr && md !== dateStr) return;
        matches.push(m);
      });

      if (matches.length === 0) {
        console.log('[pk_scorer] ' + (dateStr || 'today') + ' no matches');
        resolve({ ok: 0, msg: 'no matches' });
        return;
      }

      // Build list with GS fields + P1 统一数据包
      const list = matches.map(function (m) {
        const mid = String(m.matchId || '');
        const gsFields = loadGSFields(gsCache, mid);
        const pack = matchDataPack.getMatchDataPack({ match: m, date: (m.date || '').slice(0, 10) });
        const item = Object.assign({}, m, gsFields);
        item.matchId = mid;
        item._dataPack = pack || null;
        return item;
      });

      // Run scoring
      const scored = computeAllScores(list);

      // Rank by composite score
      const ranked = scored.slice().sort(function (a, b) {
        return b.compositeScore - a.compositeScore;
      });

      // Save to prediction_logs
      let saved = 0;
      scored.forEach(function (s, idx) {
        try {
          var item = s.item;
          const adv = getDirectionAdvice(s, ranked);
          predictionLog.upsertPK(item.matchId, {
            date: (item.date || '').slice(0, 10),
            homeName: item.homeName || '',
            visitName: item.visitName || '',
            leagueName: item.leagueName || '',
            matchNum: item.num || '',
            compositeScore: s.compositeScore,
            powerScore: s.powerScore,
            goalScore: s.goalScore,
            heatScore: s.heatScore,
            stabilityScore: s.stabilityScore,
            healthScore: s.healthScore, // V2.0: 健康评分单独存储
            direction: adv.dir,
            directionStars: adv.stars,
            directionDesc: adv.desc,
            hcpDirection: adv.hcpDir || '',
            goalDirection: adv.goalDir || '',
            goalStars: adv.goalStars || 0,
            fusionConsensus: item.fusionConsensus || '',
            batchDate: dateStr || new Date().toISOString().slice(0, 10),
            handicap: item.handicap !== undefined ? item.handicap : item.rq !== undefined ? item.rq : undefined,
            // V2.0: EV 价值字段
            evHome: adv.ev ? adv.ev.evHome : null,
            evDraw: adv.ev ? adv.ev.evDraw : null,
            evAway: adv.ev ? adv.ev.evAway : null,
            valueTag: adv.valueTag || '',
            valueScore: adv.valueScore || 0,
            // V2.0: 联赛热度 Z-Score
            heatZScore: adv.heatZ ? adv.heatZ.zScore : null,
            heatZOverheat: adv.heatZ ? (adv.heatZ.isOverheat ? 1 : 0) : 0,
            // M2: PK 裁判标准字段
            finalDirection: adv.finalDirection,
            decisionLevel: adv.decisionLevel,
            riskLevel: adv.riskLevel,
            riskTags: adv.riskTags,
            degradeReasons: adv.degradeReasons,
            decisionNarrative: adv.decisionNarrative,
            featureSnapshotId:
              'pkfs_' +
              String(item.matchId || '').replace(/^m_/, '') +
              '_' +
              String(item.date || '')
                .slice(0, 10)
                .replace(/-/g, '') +
              '_' +
              PK_SCORER_VERSION,
            featureSnapshot: {
              matchId: String(item.matchId || '').replace(/^m_/, ''),
              playType: adv.playType || 'spf',
              finalDirection: adv.finalDirection || adv.dir || 'watch',
              decisionLevel: adv.decisionLevel || '观望',
              riskLevel: adv.riskLevel || 'yellow',
              stars: adv.stars || 0,
              compositeScore: s.compositeScore,
              scores: {
                power: s.powerScore,
                goal: s.goalScore,
                heat: s.heatScore,
                stability: s.stabilityScore,
                health: s.healthScore,
                verify: s.verificationScore,
                winPan: s.winPanScore,
              },
              sourceSnapshot: item._dataPack && item._dataPack.sourceSnapshot ? item._dataPack.sourceSnapshot : null,
              coverage: item._dataPack && item._dataPack.coverage ? item._dataPack.coverage : null,
              capturedAt: new Date().toISOString(),
            },
            conflictType:
              item.fusionConsensus === 'meltdown'
                ? 'gs_meltdown'
                : adv.finalDecision === 'watch'
                  ? 'watch'
                  : adv.degradeReasons && adv.degradeReasons.length
                    ? 'degraded'
                    : 'aligned',
            valueEdge: adv.valueEdge,
            expectedValue: adv.expectedValue,
            // ★ 版本追踪
            pkScorerVersion: PK_SCORER_VERSION,
            experimentId: EXPERIMENT_ID,
            experimentGroup: EXPERIMENT_GROUP,
          });
          saved++;
        } catch (e) {
          console.error('[pk_scorer] save error for ' + item.matchId + ': ' + e.message);
        }
      });

      console.log('[pk_scorer] ' + (dateStr || 'today') + ': ' + saved + '/' + matches.length + ' matches saved');
      resolve({ ok: saved, total: matches.length });
    } catch (e) {
      console.error('[pk_scorer] error:', e.message);
      reject(e);
    }
  });
}

// ── CLI: 版本查询 ──
if (require.main === module && process.argv.includes('--version')) {
  console.log('PK_SCORER_VERSION=' + PK_SCORER_VERSION);
  console.log('EXPERIMENT_ID=' + EXPERIMENT_ID);
  console.log('EXPERIMENT_GROUP=' + EXPERIMENT_GROUP);
  process.exit(0);
}

module.exports = {
  computeAllScores,
  getDirectionAdvice,
  computeAndSave,
  _loadGSFields: loadGSFields,
  PK_SCORER_VERSION,
  PK_SCORER_HASH,
  EXPERIMENT_ID,
  EXPERIMENT_GROUP,
};

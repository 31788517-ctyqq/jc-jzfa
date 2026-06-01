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
        normalize(gds[i], gdMin, gdMax) * 0.3 +
        normalize(cvs[i], cvMin, cvMax) * 0.2 +
        normalize(pws[i], pwMin, pwMax) * 0.3 +
        normalize(ads[i], adMin, adMax) * 0.2
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
        normalize(bbrs[i], bbMin, bbMax) * 0.3 +
        normalize(atts[i], atMin, atMax) * 0.3 +
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

function calcStabilityScores(list) {
  return list.map(function (item) {
    const s = parseFloat(item.stabilityOverall);
    return isNaN(s) ? 50 : parseFloat(Math.max(0, Math.min(100, s)).toFixed(1));
  });
}

function calcVerificationScores(list) {
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

    // ═══ V2.0: P4 盘口位移验证 ═══
    // 如果数据中有初盘/即时盘数据，进行位移分析
    const openHome = parseFloat(item.openHomeAward) || 0;
    const openDraw = parseFloat(item.openDrawAward) || 0;
    const openAway = parseFloat(item.openAwayAward) || 0;
    const liveHome = hAward; // 当前赔率即即时盘
    const liveDraw = parseFloat(item.drawAward) || 0;
    const liveAway = aAward;

    // 有初盘数据时才做位移分析
    if (openHome > 1.0 && liveHome > 1.0) {
      const moveResult = oddsMovement.analyzeMovement(
        { home: openHome, draw: openDraw, away: openAway },
        { home: liveHome, draw: liveDraw, away: liveAway },
        pw
      );
      if (moveResult.penalty > 0) {
        score -= moveResult.penalty;
        details.push('odds movement: ' + moveResult.direction + ' (shift=' + moveResult.probShift.toFixed(3) + ')');
      }
    }

    // ═══ V2.0: P4 欧亚一致性检测 ═══
    const rq = parseFloat(item.rq) || parseFloat(item.handicap) || 0;
    if (hAward > 1.0 && aAward > 1.0) {
      const euroAsia = oddsMovement.checkEuroAsiaConsistency(
        { home: hAward, draw: liveDraw, away: aAward },
        rq,
        pw
      );
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
const SCORE_PROFILES = {
  spf: { power: 0.40, goal: 0.10, heat: 0.10, health: 0.10, stability: 0.10, verify: 0.20 },         // 胜平负：实力+验证权重高
  overUnder: { power: 0.10, goal: 0.35, heat: 0.05, health: 0.25, stability: 0.15, verify: 0.10 },  // 大小球：进球+健康权重高
  handicap: { power: 0.40, goal: 0.05, heat: 0.05, health: 0.10, stability: 0.10, verify: 0.30 },    // 让球：实力+验证权重高
  default: { power: 0.30, goal: 0.15, heat: 0.10, health: 0.15, stability: 0.15, verify: 0.15 },     // 默认维衡
};

function calcCompositeScore(pwr, goal, heat, health, stab, verif, playType) {
  const p = SCORE_PROFILES[playType] || SCORE_PROFILES.default;
  return parseFloat(
    (p.power * pwr + p.goal * goal + p.heat * heat + p.health * health + p.stability * stab + p.verify * verif).toFixed(1)
  );
}

function computeAllScores(list) {
  const powerScores = calcPowerScores(list);
  const goalScores = calcGoalScores(list);
  const heatScores = calcHeatScores(list);
  const healthScores = calcHealthScores(list);
  const stabilityScores = calcStabilityScores(list);
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
    const da = item.dataAge;
    const heatAdj = heat * calcAgeWeight(da, 'heat');
    const stabAdj = stab * calcAgeWeight(da, 'stats');
    let comp = calcCompositeScore(pwr, goal, heatAdj, health, stabAdj, verif);
    if (da > 240) comp = Math.max(0, comp - 5);
    else if (da > 120) comp = Math.max(0, comp - 3);
    return {
      item: item,
      powerScore: pwr,
      goalScore: goal,
      heatScore: heat,
      healthScore: health,
      stabilityScore: stab,
      verificationScore: verif,
      verificationDetails: verificationResults[i].details,
      compositeScore: parseFloat(comp.toFixed(1)),
      stars: Math.round(comp / 20),
    };
  });
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
      if (!isNaNHi && isCold) result = { dir: '主胜', stars: 4, desc: '冷门高赔(HI-Z=' + (heatZ ? heatZ.zScore : '?') + ')' };
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
  } else if (totalGoals > 2.5) {
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
    // sigmoid 映射 pwScore → 主胜概率
    const sigmoid = function (x) { return 1 / (1 + Math.exp(-x * 6)); };
    const pWin = sigmoid(pw);
    // 平局概率基于实力均衡度估算
    const pDraw = Math.max(0.18, Math.min(0.32, 0.25 - Math.abs(pw) * 0.3));
    const pLose = 1 - pWin - pDraw;

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

  return result;
}

// ═══════════════════════════════════════
//  主入口：为指定日期比赛计算PK评分并存入 prediction_logs
// ═══════════════════════════════════════

function loadGSFields(gsCache, matchId) {
  const gs = (gsCache._global || {})[matchId];
  if (!gs) return {};

  return {
    gdScore: gs.gdScore !== undefined ? gs.gdScore : 0,
    crossValue: gs.crossValue !== undefined ? gs.crossValue : 0,
    pwScore: gs.pwScore !== undefined ? gs.pwScore : 0,
    adCombined: gs.adCombined !== undefined ? gs.adCombined : 0,
    bigBallRatio: gs.bigBallRatio !== undefined ? gs.bigBallRatio : 50,
    attDefGoal: gs.attDefGoal !== undefined ? gs.attDefGoal : 0,
    headToHeadGoal: gs.headToHeadGoal !== undefined ? gs.headToHeadGoal : 2.5,
    breakArmor: gs.breakArmor !== undefined ? gs.breakArmor : 0,
    heatIndex: gs.heatIndex || '1.00',
    fusionConsensus: gs.fusionConsensus || '',
    dataAge: gs.dataAge !== undefined ? gs.dataAge : -1,
    stabilityOverall: gs.stabilityOverall !== undefined ? gs.stabilityOverall : 50,
    ladderLevel: gs.ladderLevel || 0,
    homeWinAward: gs.homeWinAward || 0,
    awayWinAward: gs.awayWinAward || 0,
    drawAward: gs.drawAward || 0,
    homeWinPan: gs.homeWinPanRate || 0,
    awayWinPan: gs.awayWinPanRate || 0,
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

      // Build list with GS fields
      const list = matches.map(function (m) {
        const mid = String(m.matchId || '');
        const gsFields = loadGSFields(gsCache, mid);
        const item = Object.assign({}, m, gsFields);
        item.matchId = mid;
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
            handicap: item.handicap !== undefined ? item.handicap : (item.rq !== undefined ? item.rq : undefined),
            // V2.0: EV 价值字段
            evHome: adv.ev ? adv.ev.evHome : null,
            evDraw: adv.ev ? adv.ev.evDraw : null,
            evAway: adv.ev ? adv.ev.evAway : null,
            valueTag: adv.valueTag || '',
            valueScore: adv.valueScore || 0,
            // V2.0: 联赛热度 Z-Score
            heatZScore: adv.heatZ ? adv.heatZ.zScore : null,
            heatZOverheat: adv.heatZ ? (adv.heatZ.isOverheat ? 1 : 0) : 0,
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

module.exports = { computeAllScores, getDirectionAdvice, computeAndSave };

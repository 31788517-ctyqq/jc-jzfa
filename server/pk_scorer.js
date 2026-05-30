/**
 * server/pk_scorer.js
 * PK 融合评分逻辑 — 从 match-pk-fusion.js 迁移到服务端
 * 
 * 每天凌晨/赛前由 scheduler 触发 computeAndSave()
 */

var fs = require('fs');
var path = require('path');
var predictionLog = require('./prediction_log');

// ═══════════════════════════════════════
//  评分算法（从前端迁移）
// ═══════════════════════════════════════

function normalize(val, min, max) {
  if (max - min < 0.0001) return 50;
  return parseFloat((((val - min) / (max - min)) * 100).toFixed(1));
}

function calcPowerScores(list) {
  var gds = list.map(function (x) { return parseFloat(x.gdScore) || 0; });
  var cvs = list.map(function (x) { return parseFloat(x.crossValue) || 0; });
  var pws = list.map(function (x) { return parseFloat(x.pwScore) || 0; });
  var ads = list.map(function (x) { return parseFloat(x.adCombined) || 0; });

  var gdMin = Math.min.apply(null, gds), gdMax = Math.max.apply(null, gds);
  var cvMin = Math.min.apply(null, cvs), cvMax = Math.max.apply(null, cvs);
  var pwMin = Math.min.apply(null, pws), pwMax = Math.max.apply(null, pws);
  var adMin = Math.min.apply(null, ads), adMax = Math.max.apply(null, ads);

  return list.map(function (item, i) {
    return parseFloat((normalize(gds[i], gdMin, gdMax) * 0.3 + normalize(cvs[i], cvMin, cvMax) * 0.2 +
      normalize(pws[i], pwMin, pwMax) * 0.3 + normalize(ads[i], adMin, adMax) * 0.2).toFixed(1));
  });
}

function calcGoalScores(list) {
  var bbrs = list.map(function (x) { return parseFloat(x.bigBallRatio) || 50; });
  var atts = list.map(function (x) { return parseFloat(x.attDefGoal) || 0; });
  var h2hs = list.map(function (x) { return parseFloat(x.headToHeadGoal) || 2.5; });
  var bkas = list.map(function (x) { return parseFloat(x.breakArmor) || 0; });

  var bbMin = Math.min.apply(null, bbrs), bbMax = Math.max.apply(null, bbrs);
  var atMin = Math.min.apply(null, atts), atMax = Math.max.apply(null, atts);
  var h2Min = Math.min.apply(null, h2hs), h2Max = Math.max.apply(null, h2hs);
  var bkMin = Math.min.apply(null, bkas), bkMax = Math.max.apply(null, bkas);

  return list.map(function (item, i) {
    return parseFloat((normalize(bbrs[i], bbMin, bbMax) * 0.3 + normalize(atts[i], atMin, atMax) * 0.3 +
      normalize(h2hs[i], h2Min, h2Max) * 0.2 + normalize(bkas[i], bkMin, bkMax) * 0.2).toFixed(1));
  });
}

function calcHeatScores(list) {
  return list.map(function (item) {
    var hi = parseFloat(item.heatIndex);
    if (isNaN(hi) || hi <= 0) return 50;
    var delta = Math.abs(1.0 - hi);
    var score = 100 - 100 * Math.pow(delta, 1.5);
    return parseFloat(Math.max(0, Math.min(100, score)).toFixed(1));
  });
}

function calcHealthScores(list) {
  return list.map(function (item) {
    var c = item.fusionConsensus;
    if (c === 'strong') return 100;
    if (c === 'weak') return 70;
    if (c === 'meltdown') return 0;
    return 50;
  });
}

function calcStabilityScores(list) {
  return list.map(function (item) {
    var s = parseFloat(item.stabilityOverall);
    return isNaN(s) ? 50 : parseFloat(Math.max(0, Math.min(100, s)).toFixed(1));
  });
}

function calcVerificationScores(list) {
  return list.map(function (item) {
    var score = 100;
    var details = [];
    var ll = item.ladderLevel || 0;
    var hAward = parseFloat(item.homeWinAward) || 0;
    var aAward = parseFloat(item.awayWinAward) || 0;
    var winPan = parseFloat(item.homeWinPan) || 0;
    var awayWinPan = parseFloat(item.awayWinPan) || 0;
    var pw = parseFloat(item.pwScore) || 0;
    var sg = parseFloat(item.strengthGoal) || 0;
    var adg = parseFloat(item.attDefGoal) || 0;

    if (ll >= 2 && pw < 0) { score -= 15; details.push('ladder disagrees with PW'); }
    if (sg > 1.5 && adg < 2.0) { score -= 10; details.push('strength vs attDef conflict'); }
    if (hAward > 0 && aAward > 0) {
      if (pw > 0.15 && aAward < hAward) { score -= 12; details.push('odds favor away'); }
      if (pw < -0.15 && hAward < aAward) { score -= 12; details.push('odds favor home'); }
    }
    if (winPan > 0 && awayWinPan > 0) {
      if (pw > 0.1 && awayWinPan > winPan + 5) { score -= 8; details.push('pan favors away'); }
    }
    var bbr = parseFloat(item.bigBallRatio) || 50;
    var lob = item.leagueOverBaseline || 55;
    if (bbr > 70 && lob < 50) { score -= 10; details.push('bigBall vs league mismatch'); }

    return { score: parseFloat(Math.max(0, score).toFixed(1)), details: details };
  });
}

function calcAgeWeight(dataAge, dataType) {
  if (dataAge < 0) return 1.0;
  var halfLife = { odds: 15, heat: 30, ai: 60, stats: 360 };
  var h = halfLife[dataType] || 120;
  return Math.pow(0.5, dataAge / h);
}

function calcCompositeScore(pwr, goal, heat, health, stab, verif) {
  return parseFloat((0.30 * pwr + 0.15 * goal + 0.10 * heat + 0.15 * health + 0.15 * stab + 0.15 * verif).toFixed(1));
}

function computeAllScores(list) {
  var powerScores = calcPowerScores(list);
  var goalScores = calcGoalScores(list);
  var heatScores = calcHeatScores(list);
  var healthScores = calcHealthScores(list);
  var stabilityScores = calcStabilityScores(list);
  var verificationResults = calcVerificationScores(list);
  var verificationScores = verificationResults.map(function (v) { return v.score; });

  return list.map(function (item, i) {
    var pwr = powerScores[i];
    var goal = goalScores[i];
    var heat = heatScores[i];
    var health = healthScores[i];
    var stab = stabilityScores[i];
    var verif = verificationScores[i];
    var da = item.dataAge;
    var heatAdj = heat * calcAgeWeight(da, 'heat');
    var stabAdj = stab * calcAgeWeight(da, 'stats');
    var comp = calcCompositeScore(pwr, goal, heatAdj, health, stabAdj, verif);
    if (da > 240) comp = Math.max(0, comp - 5);
    else if (da > 120) comp = Math.max(0, comp - 3);
    return {
      item: item,
      powerScore: pwr, goalScore: goal, heatScore: heat, healthScore: health,
      stabilityScore: stab, verificationScore: verif, verificationDetails: verificationResults[i].details,
      compositeScore: parseFloat(comp.toFixed(1)), stars: Math.round(comp / 20)
    };
  });
}

// ═══════════════════════════════════════
//  方向推荐（从前端迁移）
// ═══════════════════════════════════════

function getDirectionAdvice(scored, ranked) {
  var item = scored && scored.item ? scored.item : {};
  var pw = parseFloat(item.pwScore) || 0;
  var hi = parseFloat(item.heatIndex);
  var meltdown = item.fusionConsensus === 'meltdown';
  var isWeak = item.fusionConsensus === 'weak';
  var isNaNHi = isNaN(hi) || hi <= 0;
  var result;

  if (meltdown) return { dir: '观望/避开', stars: 0, desc: '模型熔断', hcpDir: '', goalDir: '小球', goalStars: 3 };

  if (pw >= 0.25 && !isNaNHi && hi < 1.40) {
    result = { dir: '主胜', stars: 5, desc: '绝对优势' };
  } else if (pw >= 0.08 && !meltdown) {
    if (!isNaNHi && hi >= 1.40) {
      result = { dir: '主胜（防冷）', stars: 3, desc: '过热预警' };
    } else {
      result = { dir: '主胜', stars: 4, desc: '明显优势' };
      if (!isNaNHi && hi > 0 && hi <= 0.85) result = { dir: '主胜', stars: 4, desc: '冷门高赔' };
    }
  } else if (pw <= -0.25 && !isNaNHi && hi < 1.40) {
    result = { dir: '客胜', stars: 5, desc: '绝对优势' };
  } else if (pw <= -0.08 && !meltdown) {
    if (!isNaNHi && hi >= 1.40) {
      result = { dir: '客胜（防冷）', stars: 3, desc: '过热预警' };
    } else {
      result = { dir: '客胜', stars: 4, desc: '明显优势' };
    }
  } else if (pw > -0.08 && pw < 0.08) {
    if (meltdown) { result = { dir: '观望/避开', stars: 0, desc: '模型打架' }; }
    else if (isWeak) { result = { dir: '胜/平双选', stars: 2, desc: '弱一致' }; }
    else { result = { dir: '胜/平双选', stars: 2, desc: '实力均衡' }; }
  }

  result = result || { dir: '观望/避开', stars: 1, desc: '数据不足' };

  // HCP direction
  var crossHcpWin = parseFloat(item.crossHcpWin) || 0;
  var crossHcpLose = parseFloat(item.crossHcpLose) || 0;
  if (crossHcpWin > crossHcpLose + 0.05) result.hcpDir = '主队让球胜';
  else if (crossHcpLose > crossHcpWin + 0.05) result.hcpDir = '客队让球胜';
  else result.hcpDir = '';

  // Goal direction
  var totalGoals = parseFloat(item.attDefGoal);
  if (isNaN(totalGoals) || totalGoals <= 0) totalGoals = parseFloat(item.headToHeadGoal) || 0;
  if (totalGoals > 6.5 && parseFloat(item.fusionFinalTotal) > 0) totalGoals = parseFloat(item.fusionFinalTotal);
  if (totalGoals > 3.0) { result.goalDir = '大球'; result.goalStars = 4; }
  else if (totalGoals > 2.5) { result.goalDir = '倾向大球'; result.goalStars = 3; }
  else { result.goalDir = '小球'; result.goalStars = 3; }

  return result;
}

// ═══════════════════════════════════════
//  主入口：为指定日期比赛计算PK评分并存入 prediction_logs
// ═══════════════════════════════════════

function loadGSFields(gsCache, matchId) {
  var gs = (gsCache._global || {})[matchId];
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
    _rawAttDefGoal: gs._rawAttDefGoal
  };
}

function computeAndSave(dateStr) {
  return new Promise(function(resolve, reject) {
    try {
      if (!predictionLog.isReady()) {
        console.log('[pk_scorer] prediction_log not ready');
        resolve({ ok: 0, msg: 'DB not ready' });
        return;
      }

      // Load matches for date
      var dataFile = path.join(__dirname, 'data.json');
      if (!fs.existsSync(dataFile)) { resolve({ ok: 0, msg: 'no data.json' }); return; }
      var data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      var mMap = data.m || {};

      // Load GS cache
      var gsCache = {};
      var gsFile = path.join(__dirname, 'gongshoudao', 'cache.json');
      if (fs.existsSync(gsFile)) {
        try { gsCache = JSON.parse(fs.readFileSync(gsFile, 'utf8')); } catch (e) {}
      }

      // Filter matches for date
      var matches = [];
      Object.keys(mMap).forEach(function(k) {
        var m = mMap[k];
        if (!m || !m.date) return;
        var md = m.date.slice(0, 10);
        if (dateStr && md !== dateStr) return;
        matches.push(m);
      });

      if (matches.length === 0) {
        console.log('[pk_scorer] ' + (dateStr || 'today') + ' no matches');
        resolve({ ok: 0, msg: 'no matches' });
        return;
      }

      // Build list with GS fields
      var list = matches.map(function(m) {
        var mid = String(m.matchId || '');
        var gsFields = loadGSFields(gsCache, mid);
        var item = Object.assign({}, m, gsFields);
        item.matchId = mid;
        return item;
      });

      // Run scoring
      var scored = computeAllScores(list);

      // Rank by composite score
      var ranked = scored.slice().sort(function(a, b) { return b.compositeScore - a.compositeScore; });

      // Save to prediction_logs
      var saved = 0;
      scored.forEach(function(s, idx) {
        try {
          var item = s.item;
          var adv = getDirectionAdvice(s, ranked);
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
            direction: adv.dir,
            directionStars: adv.stars,
            directionDesc: adv.desc,
            hcpDirection: adv.hcpDir || '',
            goalDirection: adv.goalDir || '',
            goalStars: adv.goalStars || 0,
            fusionConsensus: item.fusionConsensus || '',
            batchDate: dateStr || new Date().toISOString().slice(0, 10)
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

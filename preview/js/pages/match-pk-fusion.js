import { api } from '../api.js';

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function shortTeam(name) { if (!name) return '--'; return name.length > 3 ? name.slice(0, 3) + '..' : name; }

/** 归一化 fusionConsensus 中文→英文（服务端返回中文，前端统一用英文比较） */
function normalizeConsensus(raw) {
  var c = String(raw || '');
  if (c.indexOf('强一致') !== -1) return 'strong';
  if (c.indexOf('弱一致') !== -1) return 'weak';
  if (c.indexOf('熔断') !== -1)   return 'meltdown';
  return '';
}

// ═══════════════════════════════════════════
//  V5.0 三维度融合PK — 实战投注决策辅助
// ═══════════════════════════════════════════

/** 打开多场PK弹窗（不再区分 tab，融合三维度） */
export function openPKMulti(pickedList) {
  var overlay = document.getElementById('pkOverlay');
  if (!overlay || pickedList.length < 2) return;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  var modal = document.getElementById('pkModal');
  if (!modal) return;
  modal.innerHTML = '<div style="text-align:center;padding:80px 20px;color:var(--cyan)"><div style="font-size:36px;margin-bottom:12px">⚔️</div><div style="font-size:14px;font-weight:600">三维度融合分析中...</div></div>';

  // 为每场补全 GS 数据（带 5 秒超时保护）
  var promises = pickedList.map(function (item) {
    if (item.hasGS && item.pwScore !== undefined) return Promise.resolve(item);
    return Promise.race([
      api('gongshoudao', { matchId: item.matchId }).then(function (gs) {
        return Object.assign({}, item, buildGSFields(gs));
      }),
      new Promise(function (resolve) { setTimeout(function () { resolve(item); }, 5000); })
    ]).catch(function () { return item; });
  });

  var totalTimeout = new Promise(function (resolve) {
    setTimeout(function () { resolve(null); }, 8000);
  });
  Promise.race([Promise.all(promises), totalTimeout]).then(function (fullList) {
    if (!fullList) fullList = pickedList;
    // ★ 容错：渲染失败时显示错误而非卡住
    try {
      renderFusionPK(modal, fullList);
    } catch (e) {
      console.error('[openPKMulti] renderFusionPK crash:', e.message);
      modal.innerHTML = '<div style="text-align:center;padding:80px 20px;color:#EF4444"><div style="font-size:36px;margin-bottom:12px">⚠️</div><div style="font-size:14px;font-weight:600">PK分析渲染失败</div><div style="font-size:12px;color:#999;margin-top:8px">' + esc(e.message) + '</div></div>';
    }
  });
}

function buildGSFields(gs) {
  gs = gs || {};
  // attDefGoal 已在后端限制 ≤6.5，此处兜底再限一次
  var attDefGoalVal = parseFloat(gs.attDefGoal) || 0;
  if (attDefGoalVal > 7.0) attDefGoalVal = 0; // 异常值丢弃

  // totalSum: 进球维度综合指标（V25修正：只累加合理范围内的进球相关值）
  var totalSumVal = function () {
    var bbr = Math.min(100, Math.max(0, Math.abs(gs.bigBallRatio || 0)));  // 0-100
    var adg = Math.min(6.5, Math.abs(attDefGoalVal));                        // 0-6.5
    var h2h = Math.min(5.0, Math.abs(gs.h2hGoalAvg || 0));                  // 0-5
    var ba  = Math.min(8.0, Math.abs(gs.breakArmorSum || 0));               // 0-8
    return parseFloat((bbr + adg * 10 + h2h * 8 + ba * 3).toFixed(1));
  }();

  // 熔断后融合总进球（作为备用指标）
  var fusionTotal = 0;
  var fHome = parseFloat(gs.fusionFinalHome);
  var fAway = parseFloat(gs.fusionFinalAway);
  if (!isNaN(fHome) && !isNaN(fAway)) {
    fusionTotal = parseFloat((fHome + fAway).toFixed(2));
  }

  return {
    totalAdvantage: gs.totalAdvantage || '-',
    totalAdvantageValue: gs.totalAdvantageValue || 0,
    attackPattern: gs.attackPattern || '',
    xgHome: gs.xgHome != null ? gs.xgHome : 0,
    xgAway: gs.xgAway != null ? gs.xgAway : 0,
    adWeightedComposite: gs.adWeightedComposite != null ? gs.adWeightedComposite : 0,
    totalStrength: gs.totalStrength != null ? gs.totalStrength : 0,
    crossSpfWin: gs.crossSpfWin || '-',
    crossSpfDraw: gs.crossSpfDraw || '-',
    crossSpfLose: gs.crossSpfLose || '-',
    crossHcpWin: gs.crossHcpWin || '-',
    crossHcpDraw: gs.crossHcpDraw || '-',
    crossHcpLose: gs.crossHcpLose || '-',
    fusionConsensus: normalizeConsensus(gs.fusionConsensus || ''),
    fusionFinalHome: fHome,
    fusionFinalAway: fAway,
    fusionFinalTotal: fusionTotal,
    bigBallRatio: gs.bigBallRatio != null ? gs.bigBallRatio : 0,
    attDefGoal: attDefGoalVal,
    headToHeadGoal: gs.h2hGoalAvg != null ? gs.h2hGoalAvg : 0,
    breakArmor: gs.breakArmorSum != null ? gs.breakArmorSum : 0,
    totalSum: totalSumVal,
    hasGS: !!(gs.attackPattern),
    gdScore: gs.gdQ != null ? gs.gdQ : 0,
    crossValue: (gs.hWins != null && gs.aLosses != null) ? (gs.hWins + gs.aLosses - gs.hLosses - gs.aWins) : 0,
    pwScore: gs.totalStrength != null ? parseFloat(gs.totalStrength.toFixed(4)) : 0,
    adCombined: gs.adWeightedComposite != null ? parseFloat(gs.adWeightedComposite.toFixed(4)) : 0,
    computedAt: gs.computedAt || gs._timestamp || null,
    dataAge: (gs.computedAt || gs._timestamp)
      ? Math.round((Date.now() - new Date(gs.computedAt || gs._timestamp).getTime()) / 60000)
      : -1,
    // V27 新增: 稳定性
    goalStabilityHome: gs.goalStabilityHome != null ? gs.goalStabilityHome : 50,
    goalStabilityAway: gs.goalStabilityAway != null ? gs.goalStabilityAway : 50,
    defStabilityHome: gs.defStabilityHome != null ? gs.defStabilityHome : 50,
    defStabilityAway: gs.defStabilityAway != null ? gs.defStabilityAway : 50,
    stabilityOverall: gs.stabilityOverall != null ? gs.stabilityOverall : 50,
    // V27 新增: 联赛校准
    leagueCalibration: gs.leagueCalibration != null ? gs.leagueCalibration : 1.0,
    leagueAvgGoals: gs.leagueAvgGoals || 2.65,
    leagueOverBaseline: gs.leagueOverBaseline || 55,
    leagueName: gs.leagueName || '',
    // V27 新增: 赢盘率 & 赔率（交叉验证用）
    homeWinPan: gs.homeWinPanRate != null ? parseFloat(gs.homeWinPanRate) : 0,
    awayWinPan: gs.awayWinPanRate != null ? parseFloat(gs.awayWinPanRate) : 0,
    homeWinAward: gs.homeWinAward != null ? parseFloat(gs.homeWinAward) : 0,
    awayWinAward: gs.awayWinAward != null ? parseFloat(gs.awayWinAward) : 0,
    drawAward: gs.drawAward != null ? parseFloat(gs.drawAward) : 0,
    // V27 新增: 实力进球 & 实力阶梯（交叉验证用）
    strengthGoal: gs.strengthGoal != null ? parseFloat(gs.strengthGoal) : 0,
    ladderLevel: gs.ladderLevel != null ? gs.ladderLevel : 0
  };
}

// ═══════════════════════════════════════════
//  评分算法
// ═══════════════════════════════════════════

/** 归一化值到 [0,100] 区间 */
function normalize(val, min, max) {
  if (max - min < 0.0001) return 50;
  return parseFloat((((val - min) / (max - min)) * 100).toFixed(1));
}

/** 计算实力评分 0-100（按指定权重） */
function calcPowerScores(list) {
  // 净胜球量化×30% + 胜平负交叉×20% + 综合实力×30% + 攻守实力×20%
  var gds = list.map(function (x) { return parseFloat(x.gdScore) || 0; });
  var cvs = list.map(function (x) { return parseFloat(x.crossValue) || 0; });
  var pws = list.map(function (x) { return parseFloat(x.pwScore) || 0; });
  var ads = list.map(function (x) { return parseFloat(x.adCombined) || 0; });

  var gdMin = Math.min.apply(null, gds), gdMax = Math.max.apply(null, gds);
  var cvMin = Math.min.apply(null, cvs), cvMax = Math.max.apply(null, cvs);
  var pwMin = Math.min.apply(null, pws), pwMax = Math.max.apply(null, pws);
  var adMin = Math.min.apply(null, ads), adMax = Math.max.apply(null, ads);

  return list.map(function (item, i) {
    var sgd = normalize(gds[i], gdMin, gdMax);
    var scv = normalize(cvs[i], cvMin, cvMax);
    var spw = normalize(pws[i], pwMin, pwMax);
    var sad = normalize(ads[i], adMin, adMax);
    return parseFloat((sgd * 0.3 + scv * 0.2 + spw * 0.3 + sad * 0.2).toFixed(1));
  });
}

/** 计算进球评分 0-100（按指定权重） */
function calcGoalScores(list) {
  // 综合大球比例×30% + 攻防进球×30% + 交锋进球×20% + 破甲和×20%
  var bbrs = list.map(function (x) { return parseFloat(x.bigBallRatio) || (x.bigBallRatio === '-' ? 0 : 50); });
  var atts = list.map(function (x) { return parseFloat(x.attDefGoal) || (x.attDefGoal === '-' ? 0 : 0); });
  var h2hs = list.map(function (x) { return parseFloat(x.headToHeadGoal) || (x.headToHeadGoal === '-' ? 0 : 2.5); });
  var bkas = list.map(function (x) { return parseFloat(x.breakArmor) || (x.breakArmor === '-' ? 0 : 0); });

  var bbMin = Math.min.apply(null, bbrs), bbMax = Math.max.apply(null, bbrs);
  var atMin = Math.min.apply(null, atts), atMax = Math.max.apply(null, atts);
  var h2Min = Math.min.apply(null, h2hs), h2Max = Math.max.apply(null, h2hs);
  var bkMin = Math.min.apply(null, bkas), bkMax = Math.max.apply(null, bkas);

  return list.map(function (item, i) {
    var sbb = normalize(bbrs[i], bbMin, bbMax);
    var sat = normalize(atts[i], atMin, atMax);
    var sh2 = normalize(h2hs[i], h2Min, h2Max);
    var sbk = normalize(bkas[i], bkMin, bkMax);
    return parseFloat((sbb * 0.3 + sat * 0.3 + sh2 * 0.2 + sbk * 0.2).toFixed(1));
  });
}

/** 计算热度评分 0-100（1.0 最优，非对称惩罚：过热比过冷更危险） */
function calcHeatScores(list) {
  return list.map(function (item) {
    var hi = parseFloat(item.heatIndex);
    if (isNaN(hi) || hi <= 0) return 50;
    var delta = Math.abs(1.0 - hi);
    var score = 100 - 100 * Math.pow(delta, 1.5);
    return parseFloat(Math.max(0, Math.min(100, score)).toFixed(1));
  });
}

/** 计算健康评分 0-100 */
function calcHealthScores(list) {
  return list.map(function (item) {
    var c = item.fusionConsensus;
    if (c === 'strong') return 100;
    if (c === 'weak') return 70;
    if (c === 'meltdown') return 0;
    return 50;
  });
}

/** V27 新增: 计算稳定性评分 0-100 */
function calcStabilityScores(list) {
  return list.map(function (item) {
    var s = parseFloat(item.stabilityOverall);
    return isNaN(s) ? 50 : parseFloat(Math.max(0, Math.min(100, s)).toFixed(1));
  });
}

/** V27 新增: 计算多维交叉验证评分 0-100（初始100分，每个分歧扣N分） */
function calcVerificationScores(list) {
  return list.map(function (item) {
    var score = 100;
    var details = [];

    // 交叉验证1: ladderLevel vs 赔率方向
    var ll = item.ladderLevel || 0;
    var hAward = parseFloat(item.homeWinAward) || 0;
    var aAward = parseFloat(item.awayWinAward) || 0;
    if (ll >= 2 && hAward > 0 && aAward > 0 && hAward > aAward * 1.3) {
      score -= 15; details.push('赔率与实力阶梯矛盾(主强但赔率高)');
    } else if (ll <= -2 && aAward > 0 && hAward > 0 && aAward > hAward * 1.3) {
      score -= 15; details.push('赔率与实力阶梯矛盾(客强但赔率高)');
    }

    // 交叉验证2: 赢盘率 vs 实力方向
    var winPan = parseFloat(item.homeWinPan) || 0;
    var awayWinPan = parseFloat(item.awayWinPan) || 0;
    var pw = parseFloat(item.pwScore) || 0;
    if (pw > 0.1 && awayWinPan > winPan + 15) {
      score -= 10; details.push('赢盘率与实力方向矛盾');
    } else if (pw < -0.1 && winPan > awayWinPan + 15) {
      score -= 10; details.push('赢盘率与实力方向矛盾');
    }

    // 交叉验证3: strengthGoal vs attDefGoal 差异>1球
    var sg = parseFloat(item.strengthGoal) || 0;
    var adg = parseFloat(item.attDefGoal) || 0;
    if (sg > 0 && adg > 0 && Math.abs(sg - adg) > 1.0) {
      score -= 15; details.push('实力进球与攻防进球背离(' + sg.toFixed(1) + ' vs ' + adg.toFixed(1) + ')');
    }

    // 交叉验证4: bigBallRatio高但联赛大球率低 → 异常
    var bbr = parseFloat(item.bigBallRatio) || 50;
    var lob = item.leagueOverBaseline || 55;
    if (bbr > 70 && lob < 50) {
      score -= 10; details.push('大球率偏高但与联赛特性不符');
    }

    return {
      score: parseFloat(Math.max(0, score).toFixed(1)),
      details: details
    };
  });
}

/** V27 重构: 按维度时效衰减（替换一刀切惩罚） */
function calcAgeWeight(dataAge, dataType) {
  if (dataAge < 0) return 1.0;
  var halfLife = { odds: 15, heat: 30, ai: 60, stats: 360 };
  var h = halfLife[dataType] || 120;
  return Math.pow(0.5, dataAge / h);
}

/** V27重构: 计算综合信心分（加入稳定性+验证） */
function calcCompositeScore(pwr, goal, heat, health, stab, verif) {
  return parseFloat((0.30 * pwr + 0.15 * goal + 0.10 * heat + 0.15 * health + 0.15 * stab + 0.15 * verif).toFixed(1));
}

/** V27重构: 为 pickedList 每个元素附加评分对象（含稳定性+验证+时效衰减） */
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

    // V27 时效衰减: 按维度分别衰减
    var da = item.dataAge;
    var ageW_heat = calcAgeWeight(da, 'heat');
    var ageW_stats = calcAgeWeight(da, 'stats');

    // 分维度时效衰减
    var heatAdj = heat * ageW_heat;
    var stabAdj = stab * ageW_stats;

    // V27: 综合信心分 = 30%实力 + 15%进球 + 10%热度(衰减) + 15%健康 + 15%稳定性(衰减) + 15%验证
    var comp = calcCompositeScore(pwr, goal, heatAdj, health, stabAdj, verif);

    // 数据陈旧度兜底惩罚（>240分钟扣5分，>120分钟扣3分，已由分维度衰减分担大部分）
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
      stars: Math.round(comp / 20)
    };
  });
}

// ═══════════════════════════════════════════
//  方向推荐
// ═══════════════════════════════════════════

/** P0-①/② + P2-⑥/⑦/⑧ + P1-④: 增强方向推荐 */
function getDirectionAdvice(scored, ranked) {
  var item = scored.item;
  var pw = parseFloat(item.pwScore) || 0;
  var hi = parseFloat(item.heatIndex);
  var meltdown = item.fusionConsensus === 'meltdown';
  var isWeak = item.fusionConsensus === 'weak';
  var isNaNHi = isNaN(hi) || hi <= 0;
  var result;

  // P0-②: 熔断返回0星
  if (meltdown) return { dir: '观望/避开', stars: 0, cls: 'dir-avoid', desc: '模型熔断', weak: false, xgOk: true, crossOk: true, xgDetail: '', crossDetail: '' };

  // ── 基础方向推荐 ──
  if (pw >= 0.25 && !isNaNHi && hi < 1.40) {
    result = { dir: '主胜', stars: 5, cls: 'dir-home', desc: '绝对优势' };
  } else if (pw >= 0.08 && !meltdown) {
    if (!isNaNHi && hi >= 1.40) {
      result = { dir: '主胜（防冷）', stars: 3, cls: 'dir-home-caut', desc: '过热预警' };
    } else {
      result = { dir: '主胜', stars: 4, cls: 'dir-home', desc: '明显优势' };
      // P2-⑦: 主队过冷 → 高赔机会
      if (!isNaNHi && hi > 0 && hi < 0.85) {
        result.desc = (result.desc ? result.desc + '；' : '') + '市场低估';
        result.stars = Math.min(5, result.stars + 1);
      }
    }
  } else if (pw > -0.08 && pw < 0.08) {
    // P3-⑩: 细化双选粒度
    if (Math.abs(pw) < 0.03) {
      if (pw >= 0) result = { dir: '谨慎胜/平', stars: 1, cls: 'dir-draw', desc: '极度均衡偏主' };
      else result = { dir: '谨慎平/负', stars: 1, cls: 'dir-draw', desc: '极度均衡偏客' };
    } else {
      if (pw > 0) result = { dir: '胜/平双选', stars: 2, cls: 'dir-draw', desc: '实力均衡偏主' };
      else result = { dir: '平/负双选', stars: 2, cls: 'dir-draw', desc: '实力均衡偏客' };
    }
  } else if (pw <= -0.08 && !meltdown) {
    if (pw <= -0.25 && !isNaNHi && hi < 0.85) {
      result = { dir: '客胜（博冷）', stars: 4, cls: 'dir-away-cold', desc: '高赔机会' };
    } else {
      result = { dir: '客胜', stars: 3, cls: 'dir-away', desc: '客队优势' };
    }
    // P2-⑦: 客队过热 → 防冷
    if (!isNaNHi && hi >= 1.40) {
      result.dir = '客胜（防冷）';
      result.stars = Math.max(1, result.stars - 1);
      result.cls = 'dir-away-cold';
      result.desc = (result.desc ? result.desc + '；' : '') + '过热预警';
    }
  } else {
    result = { dir: '数据不足', stars: 1, cls: 'dir-avoid', desc: '' };
  }

  // P0-①: 弱一致降星（最低保留1星）
  result.weak = isWeak;
  if (isWeak && result.stars > 1) {
    result.stars -= 1;
    result.desc = (result.desc ? result.desc + '；' : '') + '弱一致降星';
  }

  // P2-⑥: 相对排名补偿（集合内 |pwScore| Top 25% 且 |pw| ≥ 0.03）
  if (ranked && ranked.length >= 3 && !meltdown) {
    var absPwList = ranked.map(function (s) { return Math.abs(parseFloat(s.item.pwScore) || 0); });
    absPwList.sort(function (a, b) { return b - a; });
    var top25Idx = Math.max(0, Math.ceil(ranked.length * 0.25) - 1);
    var top25Pw = absPwList[top25Idx] || 0;
    if (Math.abs(pw) >= Math.max(0.03, top25Pw) && result.stars < 5 && Math.abs(pw) >= 0.03) {
      result.stars = Math.min(5, result.stars + 1);
      result.desc = (result.desc ? result.desc + '；' : '') + '相对排名补偿';
    }
  }

  // P2-⑧: 交叉验证（SPF/让球盘一致性）
  var crossSpfWin = parseFloat(item.crossSpfWin);
  var crossSpfLose = parseFloat(item.crossSpfLose);
  var crossHcpWin = parseFloat(item.crossHcpWin);
  var crossHcpLose = parseFloat(item.crossHcpLose);
  result.crossOk = true;
  result.crossDetail = '';
  if (!isNaN(crossSpfWin) && !isNaN(crossSpfLose)) {
    if (result.dir.indexOf('主胜') === 0) {
      if (crossSpfLose > crossSpfWin && crossSpfLose > 30) {
        result.crossOk = false;
        result.crossDetail = 'SPF交叉矛盾（客胜' + crossSpfLose.toFixed(0) + '% vs 主胜' + crossSpfWin.toFixed(0) + '%）';
      }
      if (!isNaN(crossHcpLose) && !isNaN(crossHcpWin) && crossHcpLose > crossHcpWin && crossHcpLose > 40) {
        result.crossOk = false;
        result.crossDetail = (result.crossDetail || '') + (result.crossDetail ? '；' : '') + '让球盘不看好主队';
      }
    } else if (result.dir.indexOf('客胜') === 0) {
      if (crossSpfWin > crossSpfLose && crossSpfWin > 30) {
        result.crossOk = false;
        result.crossDetail = 'SPF交叉矛盾（主胜' + crossSpfWin.toFixed(0) + '% vs 客胜' + crossSpfLose.toFixed(0) + '%）';
      }
      if (!isNaN(crossHcpWin) && !isNaN(crossHcpLose) && crossHcpWin > crossHcpLose && crossHcpWin > 40) {
        result.crossOk = false;
        result.crossDetail = (result.crossDetail || '') + (result.crossDetail ? '；' : '') + '让球盘看好主队';
      }
    }
  }

  // P1-④: xg一致性检查
  var xgHome = parseFloat(item.xgHome) || 0;
  var xgAway = parseFloat(item.xgAway) || 0;
  var xgDiff = xgHome - xgAway;
  result.xgOk = true;
  result.xgDetail = '';
  if (xgHome > 0 || xgAway > 0) {
    if (result.dir.indexOf('主胜') === 0 && xgDiff < -0.1) {
      result.xgOk = false;
      result.xgDetail = 'xg矛盾（客' + xgAway.toFixed(1) + ' > 主' + xgHome.toFixed(1) + '）';
    } else if (result.dir.indexOf('客胜') === 0 && xgDiff > 0.1) {
      result.xgOk = false;
      result.xgDetail = 'xg矛盾（主' + xgHome.toFixed(1) + ' > 客' + xgAway.toFixed(1) + '）';
    } else {
      result.xgDetail = 'xg一致 主' + xgHome.toFixed(1) + ':客' + xgAway.toFixed(1);
    }
  }

  // V27: 赔率隐含概率校准
  var hAward = parseFloat(item.homeWinAward) || 0;
  var aAward = parseFloat(item.awayWinAward) || 0;
  var dAward = parseFloat(item.drawAward) || 0;
  result.marketConsistent = true;
  result.marketDetail = '';
  if (hAward > 0 && aAward > 0 && dAward > 0) {
    var invSum = 1/hAward + 1/dAward + 1/aAward;
    var pMarketHome = (1/hAward) / invSum;
    var pMarketAway = (1/aAward) / invSum;
    if (result.dir.indexOf('主胜') === 0 && pMarketAway > pMarketHome + 0.1) {
      result.marketConsistent = false;
      result.marketDetail = '市场不看好主胜(赔率:' + hAward.toFixed(2) + '/' + aAward.toFixed(2) + ')';
    } else if (result.dir.indexOf('客胜') === 0 && pMarketHome > pMarketAway + 0.1) {
      result.marketConsistent = false;
      result.marketDetail = '市场不看好客胜(赔率:' + hAward.toFixed(2) + '/' + aAward.toFixed(2) + ')';
    } else {
      result.marketDetail = '市场一致(赔率:' + hAward.toFixed(2) + '/' + dAward.toFixed(2) + '/' + aAward.toFixed(2) + ')';
    }
  }

  return result;
}

/** P4-⑪: 进球方向+方向推荐联动，|pw|>0.25时大球信心增强 */
function getGoalDirection(scored, dirAdvice) {
  var item = scored.item;
  var bbr = parseFloat(item.bigBallRatio) || 50;

  // 总进球期望（V25修正：attDefGoal 已由后端保障 ≤6.5，作为主指标）
  // 备选：headToHeadGoal 作为交锋进球参考，fusionFinalHome + fusionFinalAway 作为熔断后修正
  var totalGoals = parseFloat(item.attDefGoal);
  if (isNaN(totalGoals) || totalGoals <= 0) {
    totalGoals = parseFloat(item.headToHeadGoal) || 0;
  }

  // 熔断后融合值作为兜底（更保守的估计）
  var fusionTotal = 0;
  if (!isNaN(parseFloat(item.fusionFinalHome)) && !isNaN(parseFloat(item.fusionFinalAway))) {
    fusionTotal = parseFloat(item.fusionFinalHome) + parseFloat(item.fusionFinalAway);
  }

  // 如果 attDefGoal 异常（>6），切到融合值
  if (totalGoals > 6.0 && fusionTotal > 0) {
    totalGoals = fusionTotal;
  }

  // 默认进球参考值（数据库平均值）
  if (totalGoals <= 0) totalGoals = 2.5;

  var pattern = item.attackPattern;

  // ── ⚠️ V26 矛盾检测（优先）：历史大球率与实际预期球严重背离时，以实际预期为准 ──
  if (bbr >= 65 && totalGoals > 0 && totalGoals < 2.0) {
    return { dir: '倾向小球', stars: 3, cls: 'dir-small',
      desc: '历史大球率高(' + bbr.toFixed(0) + '%)但当前预期仅' + totalGoals.toFixed(1) + '球，模型降级' };
  }
  if (bbr <= 40 && totalGoals >= 3.5) {
    return { dir: '倾向大球', stars: 3, cls: 'dir-big',
      desc: '历史小球率高但当前预期' + totalGoals.toFixed(1) + '球，关注临场变化' };
  }

  // ── 双高确认大球 ──
  if (bbr >= 70 && totalGoals >= 3.0) return applyDirLink({ dir: '大球', stars: 4, cls: 'dir-big', desc: '进球预期高' }, scored);
  if (bbr >= 65 && totalGoals >= 2.5) return applyDirLink({ dir: '大球', stars: 3, cls: 'dir-big', desc: '倾向大球' }, scored);

  // ── 双低确认小球 ──
  if (bbr <= 35 && totalGoals < 2.0) return { dir: '小球', stars: 4, cls: 'dir-small', desc: '进球预期极低' };
  if (bbr <= 50 && totalGoals < 2.5) return { dir: '小球', stars: 3, cls: 'dir-small', desc: '倾向小球' };

  // ── 格局优先（加 totalGoals 验证）──
  if (pattern === '对攻为主') {
    if (totalGoals >= 3.0) return applyDirLink({ dir: '大球', stars: 4, cls: 'dir-big', desc: '对攻+高预期' }, scored);
    if (totalGoals >= 2.0) return applyDirLink({ dir: '大球', stars: 3, cls: 'dir-big', desc: '对攻格局' }, scored);
    return { dir: '略偏小球', stars: 2, cls: 'dir-small', desc: '对攻形态但预期偏低(' + totalGoals.toFixed(1) + '球)' };
  }
  if (pattern === '防守为主') {
    if (totalGoals < 2.5) return { dir: '小球', stars: 4, cls: 'dir-small', desc: '防守+低预期' };
    return { dir: '小球', stars: 3, cls: 'dir-small', desc: '防守格局' };
  }

  // ── 单边强信号（加 totalGoals 约束）──
  if (bbr >= 70 && totalGoals >= 2.0) return { dir: '略偏大球', stars: 2, cls: 'dir-big', desc: '大球率高' };
  if (bbr >= 70) return { dir: '略偏小球', stars: 2, cls: 'dir-small', desc: '大球率高但预期仅' + totalGoals.toFixed(1) + '球' };
  if (bbr <= 35 && totalGoals < 3.0) return { dir: '略偏小球', stars: 2, cls: 'dir-small', desc: '小球倾向' };
  if (bbr <= 35) return { dir: '略偏大球', stars: 2, cls: 'dir-big', desc: '小球率高但预期' + totalGoals.toFixed(1) + '球' };

  // ── 剩余信号兜底 ──
  if (totalGoals > 3.0) return applyDirLink({ dir: '略偏大球', stars: 2, cls: 'dir-big', desc: '预期偏高' }, scored);
  if (totalGoals < 2.0) return { dir: '略偏小球', stars: 2, cls: 'dir-small', desc: '预期偏低' };
  if (bbr > 50 && totalGoals >= 2.0) return { dir: '略偏大球', stars: 2, cls: 'dir-big', desc: '' };
  if (bbr > 50) return { dir: '略偏小球', stars: 2, cls: 'dir-small', desc: '历史大球但预期' + totalGoals.toFixed(1) + '球偏低' };
  return { dir: '略偏小球', stars: 2, cls: 'dir-small', desc: '' };
}

/** P4-⑪ 辅助: 实力碾压（|pw|>0.25）+ 推荐大球 → +1星加成 */
function applyDirLink(goalResult, scored) {
  var pwAbs = Math.abs(parseFloat((scored.item && scored.item.pwScore) || 0));
  if (pwAbs > 0.25 && goalResult.dir.indexOf('大球') !== -1 && goalResult.stars < 5) {
    goalResult.stars = Math.min(5, goalResult.stars + 1);
    goalResult.desc = (goalResult.desc ? goalResult.desc + '；' : '') + '实力碾压利好大球';
  }
  return goalResult;
}

/** P0-②: 熔断(0星)返回空字符串，其余1-5星正常显示 */
function starStr(n) { return n > 0 ? '⭐'.repeat(Math.max(1, Math.min(5, n))) : ''; }

// ═══════════════════════════════════════════
//  主渲染函数
// ═══════════════════════════════════════════

function renderFusionPK(modal, list) {
  var n = list.length;
  var scoredList = computeAllScores(list);
  // 按综合分降序排列
  var ranked = scoredList.slice().sort(function (a, b) { return b.compositeScore - a.compositeScore; });

  var html = '';
  html += '<div class="pk3-header">' +
    '<span class="pk3-title">三维度融合 PK 分析（' + n + '场）</span>' +
    '<span class="pk3-close" onclick="closePK()">✕</span>' +
    '</div>';

  // ── 全局熔断预警横幅（P2）──
  var meltCount = ranked.filter(function (s) { return s.item.fusionConsensus === 'meltdown'; }).length;
  if (meltCount > 0) {
    html += '<div class="pk3-global-alert">' +
      '<span class="pk3-alert-icon">⚠️</span>' +
      '<span class="pk3-alert-msg">' + meltCount + '场模型熔断 — 建议观望/避开或极小注博冷</span>' +
      '</div>';
  }

  // ── 模块一：场次综合评分卡 ──
  html += '<div class="pk3-section-label">📊 场次综合评分卡</div>';
  html += '<div class="pk3-score-cards">';
  ranked.forEach(function (scored, idx) {
    html += renderScoreCard(scored, idx + 1, ranked);
  });
  html += '</div>';

  // ── 模块二：横向对比总览表 ──
  html += '<div class="pk3-section-label">📈 横向对比总览（按综合信心分排序）</div>';
  html += renderComparisonTable(ranked);

  // ── P3-⑨: 今日焦点战（综合分最高且无风险）──
  html += renderFocusMatch(ranked);

  // ── 模块三：投注建议 ──
  html += '<div class="pk3-section-label">🔮 每场投注建议</div>';
  html += renderBettingAdviceList(ranked);

  // ── 模块四：串关推荐 ──
  html += renderComboRecommendations(ranked);

  // ── 模块五：风险预警 ──
  html += renderRiskPanel(ranked);

  // ── 底部按钮 ──
  html += '<div class="pk3-footer"><button class="pk3-done-btn" onclick="closePK()">关闭</button></div>';

  modal.innerHTML = html;
}

// ═══════════════════════════════════════════
//  模块一：场次综合评分卡
// ═══════════════════════════════════════════

function renderScoreCard(scored, rank, ranked) {
  var item = scored.item;
  var pwr = scored.powerScore;
  var goal = scored.goalScore;
  var heat = scored.heatScore;
  var comp = scored.compositeScore;

  var pwrBar = barHtml(pwr, pwr >= 50 ? 'bar-cyan' : 'bar-red');
  var goalBar = barHtml(goal, goal >= 50 ? 'bar-green' : 'bar-red');
  var heatBar = barHtml(heat, heat >= 60 ? 'bar-blue' : 'bar-amber');

  // 标签
  var pw = parseFloat(item.pwScore) || 0;
  var tags = [];
  if (pw >= 0.25) tags.push('<span class="pk3-tag-t">🔥绝对优势</span>');
  if (item.fusionConsensus === 'meltdown') tags.push('<span class="pk3-tag-t tag-red">⚠️模型打架</span>');
  if (pw >= -0.08 && pw <= 0.08) tags.push('<span class="pk3-tag-t tag-green">🎯实力均衡</span>');
  var hi = parseFloat(item.heatIndex);
  if (!isNaN(hi) && hi >= 1.40) tags.push('<span class="pk3-tag-t tag-amber">💰过热风险</span>');
  if (!isNaN(hi) && hi > 0 && hi <= 0.85) tags.push('<span class="pk3-tag-t tag-blue">🧊冷门潜质</span>');
  if (item.attackPattern === '对攻为主') tags.push('<span class="pk3-tag-t tag-orange">⚡对攻大战</span>');
  if (item.attackPattern === '防守为主') tags.push('<span class="pk3-tag-t tag-indigo">🛡️防守大战</span>');

  var dirAdvice = getDirectionAdvice(scored, ranked);
  var goalAdvice = getGoalDirection(scored, dirAdvice);

  // 预期进球显示：优先攻防进球(attDefGoal)，其次交锋进球(headToHeadGoal)，兜底熔断融合值
  var totalGoalsExpect = parseFloat(item.attDefGoal);
  if (isNaN(totalGoalsExpect) || totalGoalsExpect <= 0) {
    totalGoalsExpect = parseFloat(item.headToHeadGoal) || 0;
  }
  // 异常值保护（>6.5球视为数据异常，使用熔断融合值替代）
  if (totalGoalsExpect > 6.5) {
    var ft = parseFloat(item.fusionFinalTotal) || 0;
    if (ft > 0) totalGoalsExpect = ft;
    else totalGoalsExpect = parseFloat(item.headToHeadGoal) || 2.5;
  }
  // 兜底默认值
  if (totalGoalsExpect <= 0) totalGoalsExpect = 2.5;
  var goalLabel = '（预期 ' + totalGoalsExpect.toFixed(1) + '球）';

  var fusionBadge = '';
  var consensus = item.fusionConsensus;
  if (consensus === 'strong') fusionBadge = '<span class="pk3-fusion-tag fusion-ok">✅强一致</span>';
  else if (consensus === 'weak') fusionBadge = '<span class="pk3-fusion-tag fusion-warn">⚠️弱一致</span>';
  else if (consensus === 'meltdown') fusionBadge = '<span class="pk3-fusion-tag fusion-bad">🔴熔断</span>';

  var rankBadge = rank <= 3 ? '<span class="pk3-rank-badge r' + rank + '">🥇</span>' : '';

  return '<div class="pk3-score-card">' +
    '<div class="pk3-sc-head">' +
      rankBadge +
      '<span class="pk3-sc-match">' + esc(shortTeam(item.homeName)) + ' vs ' + esc(shortTeam(item.visitName)) + '</span>' +
      '<span class="pk3-sc-comp">' + comp + '<small>分</small></span>' +
    '</div>' +
    '<div class="pk3-sc-body">' +
      '<div class="pk3-sc-row"><span class="pk3-sc-label">实力</span><span class="pk3-sc-bar">' + pwrBar + '</span><span class="pk3-sc-val">' + pwr + '</span></div>' +
      '<div class="pk3-sc-row"><span class="pk3-sc-label">进球</span><span class="pk3-sc-bar">' + goalBar + '</span><span class="pk3-sc-val">' + goal + '</span></div>' +
      '<div class="pk3-sc-row"><span class="pk3-sc-label">热度</span><span class="pk3-sc-bar">' + heatBar + '</span><span class="pk3-sc-val">' + heat + '</span></div>' +
      // V27: 稳定性评分行
      '<div class="pk3-sc-row pk3-sc-stability"><span class="pk3-sc-label">稳定性</span>' +
        barHtml(scored.stabilityScore, scored.stabilityScore >= 65 ? 'bar-green' : scored.stabilityScore >= 40 ? 'bar-amber' : 'bar-red') +
        '<span class="pk3-sc-val">' + scored.stabilityScore + '</span></div>' +
    '</div>' +
    '<div class="pk3-sc-foot">' +
      '<div class="pk3-sc-advice">' +
        '<span class="pk3-sc-dir ' + dirAdvice.cls + '">→ ' + dirAdvice.dir + ' ' + starStr(dirAdvice.stars) + '</span>' +
        '<span class="pk3-sc-goal ' + goalAdvice.cls + '">🎯 ' + goalAdvice.dir + ' ' + goalLabel + '</span>' +
      '</div>' +
      (tags.length ? '<div class="pk3-sc-tags">' + tags.join('') + '</div>' : '') +
      (fusionBadge ? '<div class="pk3-sc-fusion">' + fusionBadge + '</div>' : '') +
      // V27: 联赛归一化标签
      (function() {
        var lc = parseFloat(item.leagueCalibration) || 1.0;
        var la = item.leagueAvgGoals || 2.65;
        if (lc > 1.08) return '<div class="pk3-sc-fusion"><span class="pk3-fusion-tag pk3-tag-league">🏟️ 高进球联赛(场均' + la.toFixed(1) + '球)</span></div>';
        if (lc < 0.93) return '<div class="pk3-sc-fusion"><span class="pk3-fusion-tag pk3-tag-league pk3-tag-league-low">🏟️ 低进球联赛(场均' + la.toFixed(1) + '球)</span></div>';
        return '';
      })() +
    '</div>' +
    '</div>';
}

function barHtml(score, colorCls) {
  return '<div class="pk3-bar-bg"><div class="pk3-bar-fill ' + colorCls + '" style="width:' + score + '%"></div></div>';
}

// ═══════════════════════════════════════════
//  P3-⑨: 今日焦点战
// ═══════════════════════════════════════════

function renderFocusMatch(ranked) {
  // 筛选条件: 综合分最高 + 无熔断/弱一致 + HI 0.85~1.30 + dataAge≤120min
  var focusMatch = null;
  for (var i = 0; i < ranked.length; i++) {
    var s = ranked[i];
    var hi = parseFloat(s.item.heatIndex);
    var da = s.item.dataAge || -1;
    var consensus = s.item.fusionConsensus;
    if (consensus !== 'meltdown' && consensus !== 'weak'
      && (!isNaN(hi) && hi >= 0.85 && hi <= 1.30)
      && (da <= 120 || da < 0)) {
      focusMatch = s;
      break;
    }
  }
  if (!focusMatch) return '';

  var item = focusMatch.item;
  var dirAdvice = getDirectionAdvice(focusMatch, ranked);
  var goalAdvice = getGoalDirection(focusMatch, dirAdvice);
  var hi = parseFloat(item.heatIndex);
  var hiLabel = isNaN(hi) ? '-' : hi.toFixed(2);

  return '<div class="pk3-section-label">⭐ 今日焦点战</div>' +
    '<div class="pk3-focus-card">' +
      '<div class="pk3-focus-head">' +
        '<span class="pk3-focus-icon">🏆</span>' +
        '<span class="pk3-focus-match">' + esc(shortTeam(item.homeName)) + ' vs ' + esc(shortTeam(item.visitName)) + '</span>' +
        '<span class="pk3-focus-comp">综合 ' + focusMatch.compositeScore + '分 ' + starStr(focusMatch.stars) + '</span>' +
      '</div>' +
      '<div class="pk3-focus-body">' +
        '<div class="pk3-focus-row">' +
          '<span class="pk3-focus-label">推荐方向</span>' +
          '<span class="pk3-focus-val ' + dirAdvice.cls + '">' + dirAdvice.dir + ' ' + starStr(dirAdvice.stars) + '</span>' +
          '<span class="pk3-focus-desc">' + dirAdvice.desc + '</span>' +
        '</div>' +
        '<div class="pk3-focus-row">' +
          '<span class="pk3-focus-label">进球预期</span>' +
          '<span class="pk3-focus-val ' + goalAdvice.cls + '">' + goalAdvice.dir + ' ' + starStr(goalAdvice.stars) + '</span>' +
          '<span class="pk3-focus-desc">' + (goalAdvice.desc || '') + '</span>' +
        '</div>' +
        '<div class="pk3-focus-meta">' +
          '<span>实力 ' + focusMatch.powerScore + '分</span>' +
          '<span>进球 ' + focusMatch.goalScore + '分</span>' +
          '<span>热度 ' + hiLabel + '</span>' +
          '<span>健康 ' + focusMatch.healthScore + '分</span>' +
          '<span>稳定性 ' + focusMatch.stabilityScore + '分</span>' +
        '</div>' +
        (dirAdvice.xgDetail ? '<div class="pk3-focus-extra ' + (dirAdvice.xgOk ? '' : 'pk3-adv-warn') + '">' + (dirAdvice.xgOk ? '✅ ' : '⚠️ ') + dirAdvice.xgDetail + '</div>' : '') +
        (!dirAdvice.crossOk ? '<div class="pk3-focus-extra pk3-adv-warn">⚠️ ' + dirAdvice.crossDetail + '</div>' : '') +
      '</div>' +
    '</div>';
}

// ═══════════════════════════════════════════
//  模块二：横向对比总览表
// ═══════════════════════════════════════════

function renderComparisonTable(ranked) {
  var html = '<div class="pk3-table-wrap"><table class="pk3-compare-table"><thead><tr>' +
    '<th>排名</th><th>对阵</th><th>实力</th><th>进球</th><th>热度</th><th>综合</th><th>方向推荐</th><th>进球预期</th>' +
    '</tr></thead><tbody>';

  ranked.forEach(function (scored, i) {
    var item = scored.item;
    var dirAdvice = getDirectionAdvice(scored, ranked);
    var goalAdvice = getGoalDirection(scored, dirAdvice);
    // 预期进球（与评分卡保持一致）
    var totalGoals = parseFloat(item.attDefGoal);
    if (isNaN(totalGoals) || totalGoals <= 0) totalGoals = parseFloat(item.headToHeadGoal) || 0;
    if (totalGoals > 6.5 && parseFloat(item.fusionFinalTotal) > 0) totalGoals = parseFloat(item.fusionFinalTotal);
    if (totalGoals <= 0) totalGoals = 2.5;

    var rankEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    var rowCls = scored.compositeScore >= 65 ? 'row-high' : scored.compositeScore >= 45 ? 'row-mid' : 'row-low';
    var heatCls = scored.heatScore >= 70 ? 'val-good' : scored.heatScore >= 50 ? 'val-warn' : 'val-bad';

    html += '<tr class="' + rowCls + '">' +
      '<td class="col-rank">' + rankEmoji + '</td>' +
      '<td class="col-match"><span class="cmp-home">' + esc(shortTeam(item.homeName)) + '</span><span class="cmp-vs">vs</span><span class="cmp-away">' + esc(shortTeam(item.visitName)) + '</span></td>' +
      '<td class="col-num ' + (scored.powerScore >= 50 ? 'val-good' : 'val-bad') + '">' + scored.powerScore + '</td>' +
      '<td class="col-num ' + (scored.goalScore >= 50 ? 'val-good' : 'val-bad') + '">' + scored.goalScore + '</td>' +
      '<td class="col-num ' + heatCls + '">' + scored.heatScore + '</td>' +
      '<td class="col-comp"><b>' + scored.compositeScore + '</b><span class="star-row">' + starStr(scored.stars) + '</span></td>' +
      '<td class="col-dir ' + dirAdvice.cls + '">' + dirAdvice.dir + '</td>' +
      '<td class="col-goal ' + goalAdvice.cls + '">' + goalAdvice.dir + ' ' + totalGoals.toFixed(1) + '球</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

// ═══════════════════════════════════════════
//  模块三：投注建议列表
// ═══════════════════════════════════════════

function renderBettingAdviceList(ranked) {
  var html = '<div class="pk3-advice-list">';
  ranked.forEach(function (scored, i) {
    var item = scored.item;
    var dirAdvice = getDirectionAdvice(scored, ranked);
    var goalAdvice = getGoalDirection(scored, dirAdvice);
    var pw = parseFloat(item.pwScore) || 0;
    var hi = parseFloat(item.heatIndex);
    var heatLabel = isNaN(hi) ? '-' : hi.toFixed(2);
    var meltdown = item.fusionConsensus === 'meltdown';
    var isWeak = item.fusionConsensus === 'weak';
    var da = item.dataAge;
    var daLabel = (da >= 0) ? (da > 180 ? '⚠️ ' + da + '分钟未刷新' : da > 60 ? '🕐 ' + da + '分钟前' : '') : '';
    var daWarn = da > 180;
    var daInfo = da > 60 && da <= 180;

    // P2-⑦: HI 精细化标签
    var hiInfo = '';
    if (!isNaN(hi) && hi > 0) {
      if (hi < 0.85) hiInfo = '<div class="pk3-adv-row pk3-adv-info">💡 热度指数 ' + heatLabel + ' — 市场冷藏，可能是高赔逆向机会</div>';
      else if (hi >= 1.40) hiInfo = '<div class="pk3-adv-row pk3-adv-warn">⚠️ 热度指数 ' + heatLabel + ' — 过热预警，降低信心1级</div>';
      else if (hi > 1.15) hiInfo = '<div class="pk3-adv-row pk3-adv-hint">📊 热度指数 ' + heatLabel + ' — 关注度偏高</div>';
      else hiInfo = '<div class="pk3-adv-row pk3-adv-hint">📊 热度指数 ' + heatLabel + ' — 关注度正常</div>';
    }

    // P2-⑧: 交叉验证
    var crossWarn = '';
    if (!dirAdvice.crossOk && dirAdvice.crossDetail) {
      crossWarn = '<div class="pk3-adv-row pk3-adv-warn">⚠️ ' + dirAdvice.crossDetail + '</div>';
    }

    // P1-④: xg一致性
    var xgRow = '';
    if (dirAdvice.xgDetail) {
      xgRow = '<div class="pk3-adv-row ' + (dirAdvice.xgOk ? 'pk3-adv-info' : 'pk3-adv-warn') + '">' +
        (dirAdvice.xgOk ? '✅ ' : '⚠️ ') + dirAdvice.xgDetail + '</div>';
    }

    // P1-⑤: dataAge 时效
    var ageRow = '';
    if (daWarn) ageRow = '<div class="pk3-adv-row pk3-adv-warn">⚠️ 数据时效：' + daLabel + '</div>';
    else if (daInfo) ageRow = '<div class="pk3-adv-row pk3-adv-info">🕐 数据时效：' + daLabel + '</div>';

    // P1-③: 弱一致警告
    var weakWarn = (isWeak && !meltdown) ? '<div class="pk3-adv-row pk3-adv-warn">⚠️ 模型弱一致 — 参考价值打折，建议降低注码</div>' : '';

    // V27: 赔率市场一致性
    var marketRow = !dirAdvice.marketConsistent
      ? '<div class="pk3-adv-row pk3-adv-warn">⚠️ ' + (dirAdvice.marketDetail || '市场分歧') + '</div>'
      : (dirAdvice.marketDetail ? '<div class="pk3-adv-row pk3-adv-info">📊 ' + dirAdvice.marketDetail + '</div>' : '');

    // V27: 稳定性低预警
    var stabRow = '';
    if (scored.stabilityScore < 35) {
      stabRow = '<div class="pk3-adv-row pk3-adv-warn">⚠️ 进球分布不稳定(' + scored.stabilityScore + '分) — 预测可信度降低</div>';
    }

    // V27: 多维验证分歧
    var verifDetails = scored.verificationDetails || [];
    var verifRow = '';
    if (verifDetails.length > 0) {
      verifRow = '<div class="pk3-adv-row pk3-adv-warn">🔍 ' + verifDetails.join('；') + '</div>';
    }

    html += '<div class="pk3-advice-card ' + dirAdvice.cls + '">' +
      '<div class="pk3-adv-head">' +
        '<span class="pk3-adv-match">' + esc(shortTeam(item.homeName)) + ' vs ' + esc(shortTeam(item.visitName)) + '</span>' +
        '<span class="pk3-adv-comp">综合 ' + scored.compositeScore + '分 ' + starStr(scored.stars) + '</span>' +
      '</div>' +
      '<div class="pk3-adv-body">' +
        '<div class="pk3-adv-row">' +
          '<span class="pk3-adv-label">方向</span>' +
          '<span class="pk3-adv-val ' + dirAdvice.cls + '">' + dirAdvice.dir + ' <small>' + starStr(dirAdvice.stars) + '</small></span>' +
          '<span class="pk3-adv-desc">' + dirAdvice.desc + '</span>' +
        '</div>' +
        '<div class="pk3-adv-row">' +
          '<span class="pk3-adv-label">进球</span>' +
          '<span class="pk3-adv-val ' + goalAdvice.cls + '">' + goalAdvice.dir + ' <small>' + starStr(goalAdvice.stars) + '</small></span>' +
          '<span class="pk3-adv-desc">' + goalAdvice.desc + '</span>' +
        '</div>' +
        (meltdown ? '<div class="pk3-adv-row pk3-adv-warn">⚠️ 模型熔断 — 建议避开或极小注博冷</div>' : '') +
        weakWarn +
        hiInfo +
        xgRow +
        crossWarn +
        ageRow +
        marketRow +
        stabRow +
        verifRow +
      '</div>' +
    '</div>';
  });
  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════
//  模块四：串关推荐
// ═══════════════════════════════════════════

function renderComboRecommendations(ranked) {
  var n = ranked.length;
  if (n < 2) return '';

  /** 计算组合置信度：取topN的最小综合分（木桶原理） */
  function calcComboConf(items, N) {
    var comps = items.map(function (x) { return x.comp; }).sort(function (a, b) { return b - a; });
    var topN = comps.slice(0, N);
    var minComp = Math.min.apply(null, topN);
    var avgComp = Math.round(topN.reduce(function (s, v) { return s + v; }, 0) / N);
    return { min: minComp, avg: avgComp, stars: Math.round(avgComp / 20) };
  }

  // 为每场准备辅助信息
  var withInfo = ranked.map(function (scored) {
    var item = scored.item;
    var pw = parseFloat(item.pwScore) || 0;
    var hi = parseFloat(item.heatIndex);
    var meltdown = item.fusionConsensus === 'meltdown';
    var isWeak = item.fusionConsensus === 'weak';
    var isOverheat = !isNaN(hi) && hi >= 1.40;
    var name = esc(shortTeam(item.homeName));
    var dirAdvice = getDirectionAdvice(scored, ranked);
    return {
      scored: scored, pw: pw, hi: isNaN(hi) ? 1.0 : hi,
      meltdown: meltdown, weak: isWeak, overheat: isOverheat,
      name: name, comp: scored.compositeScore, dir: dirAdvice.dir,
      balanced: pw >= -0.08 && pw <= 0.08
    };
  });

  // ── P1: 正路：综合分≥55，无熔断/弱一致，HI<1.4 ──
  var positive = withInfo.filter(function (x) {
    return !x.meltdown && !x.weak && x.hi < 1.40 && x.comp >= 55;
  }).sort(function (a, b) { return b.comp - a.comp; });
  // 兜底：放宽到 comp≥40 + HI<2.0（仍保留安全底线）
  if (positive.length < 2) {
    positive = withInfo.filter(function (x) {
      return !x.meltdown && !x.weak && x.comp >= 40 && x.hi < 2.0;
    }).sort(function (a, b) { return b.comp - a.comp; });
  }

  // ── P1: 博冷：HI<0.85，无熔断 ──
  var cold = withInfo.filter(function (x) {
    return !x.meltdown && x.hi > 0 && x.hi < 0.85;
  }).sort(function (a, b) { return a.hi - b.hi; });
  if (cold.length < 2) {
    cold = withInfo.filter(function (x) {
      return !x.meltdown && x.hi < 1.0;
    }).sort(function (a, b) { return a.hi - b.hi; });
  }

  // ── P1+P2: 稳健：无熔断/过热，实力均衡 ──
  var steady = withInfo.filter(function (x) {
    return !x.meltdown && !x.overheat && x.balanced;
  }).sort(function (a, b) { return Math.abs(a.pw) - Math.abs(b.pw); });
  // 兜底：仅保留熔断排除（允许过热但保留均衡属性）
  if (steady.length < 2) {
    steady = withInfo.filter(function (x) {
      return !x.meltdown && x.balanced;
    }).sort(function (a, b) { return Math.abs(a.pw) - Math.abs(b.pw); });
  }

  // ── P2: 三向互斥去重（优先级：正路 > 博冷 > 稳健）──
  var usedNames = [];
  function pickTop2(source, count) {
    var result = [];
    for (var i = 0; i < source.length && result.length < count; i++) {
      if (usedNames.indexOf(source[i].name) === -1) {
        result.push(source[i]);
        usedNames.push(source[i].name);
      }
    }
    // V27: 赔率隐含概率校准
  var hAward = parseFloat(item.homeWinAward) || 0;
  var aAward = parseFloat(item.awayWinAward) || 0;
  var dAward = parseFloat(item.drawAward) || 0;
  result.marketConsistent = true;
  result.marketDetail = '';
  if (hAward > 0 && aAward > 0 && dAward > 0) {
    var invSum = 1/hAward + 1/dAward + 1/aAward;
    var pMarketHome = (1/hAward) / invSum;
    var pMarketAway = (1/aAward) / invSum;
    if (result.dir.indexOf('主胜') === 0 && pMarketAway > pMarketHome + 0.1) {
      result.marketConsistent = false;
      result.marketDetail = '市场不看好主胜(赔率:' + hAward.toFixed(2) + '/' + aAward.toFixed(2) + ')';
    } else if (result.dir.indexOf('客胜') === 0 && pMarketHome > pMarketAway + 0.1) {
      result.marketConsistent = false;
      result.marketDetail = '市场不看好客胜(赔率:' + hAward.toFixed(2) + '/' + aAward.toFixed(2) + ')';
    } else {
      result.marketDetail = '市场一致(赔率:' + hAward.toFixed(2) + '/' + dAward.toFixed(2) + '/' + aAward.toFixed(2) + ')';
    }
  }

  return result;
  }

  var posPick = pickTop2(positive, 2);
  var coldPick = pickTop2(cold, 2);
  var steadyPick = pickTop2(steady, 2);

  var hasAny = posPick.length >= 2 || coldPick.length >= 2 || steadyPick.length >= 2;
  if (!hasAny) return '';

  // ── P3: 组合置信度辅助函数 ──
  function comboBadge(items, N, label) {
    if (items.length < N) return '';
    var conf = calcComboConf(items, N);
    return '<span class="pk3-combo-score">' + label + ': 均分' + conf.avg + ' · 最弱' + conf.min + '分 ' + starStr(conf.stars) + '</span>';
  }

  var html = '<div class="pk3-section-label">🤝 串关推荐</div><div class="pk3-combo-wrap">';

  if (posPick.length >= 2) {
    html += '<div class="pk3-combo-card combo-positive">' +
      '<span class="pk3-combo-tag">🎯 正路 2串1</span>' +
      '<span class="pk3-combo-teams">' + posPick.map(function (x) { return x.name + '（<b>' + x.dir + '</b>）'; }).join(' + ') + '</span>' +
      comboBadge(posPick, 2, '信心') +
      '<span class="pk3-combo-hint">综合信心最高 · 低风险</span></div>';
  }

  // ── P4: 正路 3串1（≥3场正路时额外推荐）──
  if (posPick.length >= 3) {
    html += '<div class="pk3-combo-card combo-positive" style="border-left-color:#ff9800">' +
      '<span class="pk3-combo-tag">🎯 正路 3串1</span>' +
      '<span class="pk3-combo-teams">' + posPick.map(function (x) { return x.name + '（<b>' + x.dir + '</b>）'; }).join(' + ') + '</span>' +
      comboBadge(posPick, 3, '信心') +
      '<span class="pk3-combo-hint">三场正路 · 更高赔率组合</span></div>';
  }

  if (coldPick.length >= 2) {
    html += '<div class="pk3-combo-card combo-cold">' +
      '<span class="pk3-combo-tag">⚡ 博冷 2串1</span>' +
      '<span class="pk3-combo-teams">' + coldPick.map(function (x) { return x.name + '（<b>' + x.dir + '</b>）'; }).join(' + ') + '</span>' +
      comboBadge(coldPick, 2, '信心') +
      '<span class="pk3-combo-hint">热度异常 · 高赔关注</span></div>';
  }

  if (steadyPick.length >= 2) {
    var steadyRisk = steadyPick.some(function (x) { return x.overheat; }) ? '注意' : '容错';
    html += '<div class="pk3-combo-card combo-steady">' +
      '<span class="pk3-combo-tag">🛡️ 稳健 2串1</span>' +
      '<span class="pk3-combo-teams">' + steadyPick.map(function (x) { return x.name + '（<b>' + x.dir + '</b>）'; }).join(' + ') + '</span>' +
      comboBadge(steadyPick, 2, '信心') +
      '<span class="pk3-combo-hint">实力均衡 · 双选' + steadyRisk + '</span></div>';
  }

  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════
//  模块五：风险预警面板
// ═══════════════════════════════════════════

function renderRiskPanel(ranked) {
  var risks = [];
  ranked.forEach(function (scored) {
    var item = scored.item;
    var name = esc(shortTeam(item.homeName));
    var hi = parseFloat(item.heatIndex);

    if (item.fusionConsensus === 'meltdown') {
      risks.push({ level: 'danger', text: '🔴 ' + name + ': 模型熔断 — 强烈建议避开', severity: 5 });
    }
    if (!isNaN(hi) && hi >= 1.40) {
      risks.push({ level: 'warn', text: '🟡 ' + name + ': 过热预警 (HI=' + hi.toFixed(2) + ') — 降低信心1级', severity: 3 });
    }
    if (!isNaN(hi) && hi > 0 && hi <= 0.85) {
      risks.push({ level: 'info', text: '🔵 ' + name + ': 市场冷藏 (HI=' + hi.toFixed(2) + ') — 逆向思维机会', severity: 2 });
    }
    if (item.fusionConsensus === 'weak') {
      risks.push({ level: 'warn', text: '🟡 ' + name + ': 模型弱一致 — 参考价值打折', severity: 2 });
    }

    // 数据时效性检查（P6：超过60分钟未刷新告警）
    if (scored.item.dataAge !== undefined && scored.item.dataAge > 60) {
      risks.push({ level: 'warn', text: '🟠 ' + name + ': 数据已超过 ' + scored.item.dataAge + ' 分钟未刷新', severity: 2 });
    }

    // attDefGoal 异常丢弃告警
    var adg = parseFloat(item.attDefGoal);
    if (item._rawAttDefGoal !== undefined && item._rawAttDefGoal > 7.0 && (!isNaN(adg) && adg === 0)) {
      risks.push({ level: 'warn', text: '🟠 ' + name + ': 攻防进球异常（原始 >7.0 已丢弃）', severity: 3 });
    }

    // V27: 稳定性风险
    if (scored.stabilityScore < 30) {
      risks.push({ level: 'warn', text: '🟡 ' + name + ': 进球分布极不稳定(' + scored.stabilityScore + '分)', severity: 3 });
    }
    // V27: 验证分歧风险
    var vd = scored.verificationDetails || [];
    if (vd.length >= 2) {
      risks.push({ level: 'warn', text: '🟠 ' + name + ': 多维交叉验证出现' + vd.length + '处分歧', severity: 4 });
    }
  });

  // ── 交叉风险检测（P4：熔断+过热双杀）──
  var doubleKill = ranked.filter(function (s) {
    var hi = parseFloat(s.item.heatIndex);
    return s.item.fusionConsensus === 'meltdown' && !isNaN(hi) && hi >= 1.40;
  });
  if (doubleKill.length > 0) {
    risks.unshift({
      level: 'danger',
      text: '💀 熔断+过热双杀：' + doubleKill.map(function (s) { return esc(shortTeam(s.item.homeName)); }).join(', ') + ' — 强烈建议放弃这组选择',
      severity: 5
    });
  }

  // ── 整体健康度 ──
  var meltCount = ranked.filter(function (s) { return s.item.fusionConsensus === 'meltdown'; }).length;
  var weakCount = ranked.filter(function (s) { return s.item.fusionConsensus === 'weak'; }).length;
  var healthPct = ranked.length > 0 ? Math.round((1 - (meltCount + weakCount * 0.5) / ranked.length) * 100) : 100;

  // ── 风险总分（P3：风险严重度打分体系）──
  var overheatCount = ranked.filter(function (s) { var h = parseFloat(s.item.heatIndex); return !isNaN(h) && h >= 1.40; }).length;
  var coldCount = ranked.filter(function (s) { var h = parseFloat(s.item.heatIndex); return !isNaN(h) && h > 0 && h <= 0.85; }).length;
  var totalRisk = meltCount * 5 + overheatCount * 3 + weakCount * 2 + coldCount * 2;
  var maxRisk = ranked.length * 5;
  var riskPct = Math.round((totalRisk / Math.max(1, maxRisk)) * 100);
  var riskLabel = riskPct >= 50 ? '🔴 高风险，建议谨慎投注' : riskPct >= 25 ? '🟡 中风险，注意控制仓位' : '🟢 低风险';

  var html = '<div class="pk3-section-label">⚠️ 风险预警</div>';
  html += '<div class="pk3-risk-panel">';

  if (risks.length > 0) {
    html += '<div class="pk3-risk-list">';
    risks.forEach(function (r) {
      html += '<div class="pk3-risk-item ' + r.level + '">' + r.text + '</div>';
    });
    html += '</div>';
  } else {
    html += '<div class="pk3-risk-clear">✅ 所有场次均无异常风险</div>';
  }

  html += '<div class="pk3-risk-health">' +
    '<span>整体健康度：</span>' +
    '<span class="' + (healthPct >= 80 ? 'val-good' : healthPct >= 50 ? 'val-warn' : 'val-bad') + '">' + healthPct + '%</span>' +
    (meltCount > 0 ? ' <small style="color:#ef5350">(' + meltCount + '场熔断)</small>' : '') +
    '</div>';

  html += '<div class="pk3-risk-health" style="margin-top:4px">' +
    '<span>风险指数：</span>' +
    '<span class="' + (riskPct < 25 ? 'val-good' : riskPct < 50 ? 'val-warn' : 'val-bad') + '">' + riskPct + '%</span>' +
    ' <small>' + riskLabel + '</small>' +
    '</div>';

  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════
//  综合评估面板
// ═══════════════════════════════════════════

function renderFusionSummary(ranked) {
  var n = ranked.length;
  if (n === 0) return '';

  var avgComp = parseFloat((ranked.reduce(function (s, x) { return s + x.compositeScore; }, 0) / n).toFixed(1));
  var avgPwr = parseFloat((ranked.reduce(function (s, x) { return s + x.powerScore; }, 0) / n).toFixed(1));

  var homeAdvCount = ranked.filter(function (s) {
    var pw = parseFloat(s.item.pwScore) || 0; return pw > 0;
  }).length;
  var homeRatio = Math.round(homeAdvCount / n * 100);

  var meltdownCount = ranked.filter(function (s) { return s.item.fusionConsensus === 'meltdown'; }).length;
  var healthScore = Math.round((1 - meltdownCount / n) * 100);

  var heatDevCount = ranked.filter(function (s) {
    var hi = parseFloat(s.item.heatIndex); return !isNaN(hi) && (hi > 1.2 || (hi > 0 && hi < 0.8));
  }).length;

  return '<div class="pk3-section-label">📊 综合评估</div>' +
    '<div class="pk3-summary-panel">' +
      '<div class="pk3-summary-row">' +
        '<span class="pk3-summary-label">平均综合信心分</span>' +
        '<span class="pk3-summary-value ' + (avgComp >= 60 ? 'val-good' : avgComp >= 40 ? 'val-warn' : 'val-bad') + '">' + avgComp + '分 ' + starStr(Math.round(avgComp / 20)) + '</span>' +
      '</div>' +
      '<div class="pk3-summary-row">' +
        '<span class="pk3-summary-label">平均实力评分</span>' +
        '<span class="pk3-summary-value">' + avgPwr + '分</span>' +
      '</div>' +
      '<div class="pk3-summary-row">' +
        '<span class="pk3-summary-label">主队优势率</span>' +
        '<span class="pk3-summary-value">' + homeRatio + '%（' + homeAdvCount + '/' + n + '场）</span>' +
      '</div>' +
      '<div class="pk3-summary-row">' +
        '<span class="pk3-summary-label">模型健康度</span>' +
        '<span class="pk3-summary-value ' + (healthScore >= 80 ? 'val-good' : healthScore >= 50 ? 'val-warn' : 'val-bad') + '">' + healthScore + '%' +
        (meltdownCount > 0 ? ' <small style="color:#ef5350">⚠️' + meltdownCount + '场熔断</small>' : '') + '</span>' +
      '</div>' +
      (heatDevCount > 0 ? '<div class="pk3-summary-row">' +
        '<span class="pk3-summary-label">热度偏离场次</span>' +
        '<span class="pk3-summary-value val-warn">' + heatDevCount + '场异常</span>' +
      '</div>' : '') +
    '</div>';
}

// ═══════════════════════════════════════════
//  关闭弹窗
// ═══════════════════════════════════════════

export function closePK() {
  var overlay = document.getElementById('pkOverlay');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

export function openPK() {}

/**
 * 第四阶段：阵之第二维 · 和差归一大小球博弈算法（V24 修订版）
 *
 * 按照 gongshoudao-quan.md 新公式重写：
 *   主客权重 W_h = sigmoid(S), W_a = 1 - W_h
 *   场地烈度 Intensity = 主场场均得失球 + 客场场均得失球
 *   全局总进球期望 λ_total = W_h × Intensity_home + W_a × Intensity_away
 *   三维收敛锁
 *   xG 计算
 */
const F = 4;
const fusion = require('./fusion');
const modelWeights = require('./model-weights');

function round(v, n) {
  const m = Math.pow(10, n);
  return Math.round(v * m) / m;
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

// ==================== 4.1 主客权重（sigmoid 杠杆放大器）====================

function calcWeights(S) {
  // W_h = e^S / (1 + e^S), W_a = 1 - W_h
  const wHome = round(sigmoid(S), F);
  const wAway = round(1 - wHome, F);
  return { home: Math.max(0.05, Math.min(0.95, wHome)), away: Math.max(0.05, Math.min(0.95, wAway)) };
}

// ==================== 4.2 场地烈度 ====================

function calcFieldIntensity(vars) {
  const hFGoal = vars.homeFieldGoalAvg || vars.homeRecentGoalAvg || 1;
  const hFLose = vars.homeFieldLoseAvg || vars.homeRecentLoseAvg || 1;
  const aFGoal = vars.awayFieldGoalAvg || vars.awayRecentGoalAvg || 1;
  const aFLose = vars.awayFieldLoseAvg || vars.awayRecentLoseAvg || 1;

  return {
    home: round(hFGoal + hFLose, 2),
    away: round(aFGoal + aFLose, 2),
    total: round(hFGoal + hFLose + aFGoal + aFLose, F),
  };
}

// ==================== 4.3 全局总进球期望 λ_total ====================

function calcTotalGoalExpect(intensity, weights) {
  // λ_total = W_h × Intensity_home + W_a × Intensity_away
  return round(weights.home * intensity.home + weights.away * intensity.away, F);
}

// ==================== 4.4 进球数弹性区间（三维收敛锁）====================

function calcGoalRange(vars, totalExpect) {
  const homeOR = vars.homeOverRate || 0;
  const awayOR = vars.awayOverRate || 0;

  // 交锋大球率：近3-6次交锋中总进球≥3球的场次比例
  const jiaoFenScores = vars.jiaoFenScores || [];
  let h2hOverRate = (homeOR + awayOR) / 2; // fallback
  if (jiaoFenScores.length > 0) {
    const overCount = jiaoFenScores.filter(function (s) {
      return s && s.h + s.a >= 3;
    }).length;
    h2hOverRate = overCount / jiaoFenScores.length;
  }

  // 综合期望线 λ_gene = 0.4×主大球率×5 + 0.4×客大球率×5 + 0.2×交锋大球率×5
  // 大球率(0~1) ×5 放大到进球尺度(0~5)
  const lambdaGene = round(0.4 * homeOR * 5 + 0.4 * awayOR * 5 + 0.2 * h2hOverRate * 5, F);

  // 实际复刻基因：最近两次交锋进球数均值
  let lambdaActual = totalExpect;
  if (jiaoFenScores.length > 0) {
    const sum = jiaoFenScores.reduce((s, sc) => s + (sc ? sc.h + sc.a : 0), 0);
    lambdaActual = round(sum / jiaoFenScores.length, F);
  }

  const compositeLine = round(lambdaGene * 0.4 + lambdaActual * 0.3 + totalExpect * 0.3, F);

  let lowerLock = Math.max(0, Math.floor(compositeLine) - 1);
  let upperLock = Math.ceil(compositeLine) + 1;

  // 下限锁：若 λ_gene < 1.8 且 λ_actual < 1.5 → 总进球锁定 ≤ 2 球
  if (lambdaGene < 1.8 && lambdaActual < 1.5) {
    upperLock = Math.min(upperLock, 2);
  }
  // 上限锁：若 λ_gene > 2.5 → 总进球 ≥ 2.5 球（下限至少 2）
  if (lambdaGene > 2.5) {
    lowerLock = Math.max(lowerLock, 2);
  }

  upperLock = Math.max(2, Math.min(6, upperLock));
  lowerLock = Math.max(0, lowerLock);

  return {
    range: lowerLock + '-' + upperLock + '球',
    lower: lowerLock,
    upper: upperLock,
    compositeLine: round(compositeLine, 2),
    overRate: round(((homeOR + awayOR) / 2) * 100, 1),
    lambdaGene,
    lambdaActual,
    homeOverRate: round(homeOR, F),
    awayOverRate: round(awayOR, F),
    h2hOverRate: round(h2hOverRate, F),
  };
}

// ==================== 4.5 主客近期进球期望（xG）====================

/**
 * 贝叶斯收缩：将极端 β 值向 0.5 收缩
 * @param {number} betaRaw 原始 β
 * @param {number} nMatches 比赛场次（越大越信任原始值）
 * @param {number} shrinkageStrength 收缩强度，默认 3（β 在 3 场比赛后开始显著偏离 0.5）
 */
function shrinkBeta(betaRaw, nMatches, shrinkageStrength) {
  shrinkageStrength = shrinkageStrength || 3;
  nMatches = Math.max(1, nMatches || 5);
  const w = nMatches / (nMatches + shrinkageStrength);
  return w * betaRaw + (1 - w) * 0.5;
}

// ==================== V7.0 时间衰减权重 ====================

/**
 * 指数衰减权重函数
 * 近期比赛权重远大于远期比赛
 *
 * 衰减方案：
 *   - 最近3场: 60% 权重
 *   - 最近4-6场: 25% 权重
 *   - 最近7-10场: 15% 权重
 *
 * 实际使用位置衰减（假设 vars 中数据按最近→最远排列）
 *
 * @param {number} totalMatches 近N场总数
 * @param {number} halfLifeK 半衰位置（默认3，表示第3场权重减半）
 * @returns {number[]} 归一化权重数组 [w0, w1, ...]
 */
function timeDecayWeights(totalMatches, halfLifeK) {
  halfLifeK = halfLifeK || 3;
  totalMatches = Math.max(1, totalMatches || 10);
  const raw = [];
  let sum = 0;
  for (let k = 0; k < totalMatches; k++) {
    const w = Math.pow(2, -k / halfLifeK);
    raw.push(w);
    sum += w;
  }
  return raw.map(function (w) { return w / sum; });
}

/**
 * 将等权场均数据转换为时间衰减加权场均
 * 假设原始场均数据是最近 totalMatches 场的简单平均值，
 * 此处用三段式权重近似：60%→25%→15%
 *
 * @param {number} flatAvg 等权场均值
 * @param {number} totalMatches 比赛场次
 * @param {number} recentRatio 最近3场的偏离比例（>1=近期表现更好, <1=近期表现更差）
 * @returns {number} 时间衰减后的加权均值
 */
function applyTimeDecayToAvg(flatAvg, totalMatches, recentRatio) {
  if (!flatAvg || totalMatches < 4) return flatAvg;
  recentRatio = recentRatio || 1.0;

  // 三段式：最近1/3场次占60%，中间1/3占25%，最远1/3占15%
  // 假设近期表现与整体均值的偏差为 recentRatio
  // timeDecayedAvg = flatAvg * [0.6*recentRatio + 0.25*1.0 + 0.15*(1/recentRatio)]
  const invertedRatio = 1 / Math.max(0.5, recentRatio);
  const blendFactor = 0.6 * recentRatio + 0.25 * 1.0 + 0.15 * invertedRatio;

  return +(flatAvg * blendFactor).toFixed(4);
}

/**
 * 从净胜球分布推断近期表现趋势
 * 如果近期赢大比分多 → 近期状态好 (ratio > 1)
 * 如果近期输大比分多 → 近期状态差 (ratio < 1)
 *
 * @param {Object} vars parser 标准变量
 * @param {string} side 'home' | 'away'
 * @returns {number} 近期偏离比例
 */
function inferRecentTrendRatio(vars, side) {
  const prefix = side === 'home' ? 'home' : 'away';
  const w2 = vars[prefix + 'WinGap_2'] || 0;
  const w1 = vars[prefix + 'WinGap_1'] || 0;
  const draws = vars[prefix + 'Draw'] || 0;
  const l1 = vars[prefix + 'LoseGap_1'] || 0;
  const l2 = vars[prefix + 'LoseGap_2'] || 0;

  // 加权分：大胜+2, 小胜+1, 平0, 小负-1, 大败-2
  const weightedScore = w2 * 2 + w1 * 1 - l1 * 1 - l2 * 2;
  const total = w2 + w1 + draws + l1 + l2 || 1;

  // 归一化到 [-1, 1] 再映射到 [0.7, 1.3]
  const normalizedScore = weightedScore / total;
  return 1.0 + normalizedScore * 0.3; // 范围 [0.7, 1.3]
}

function calcExpectedGoals(vars, totalExpect, weights) {
  const ghRaw = vars.homeRecentGoalAvg || 1;
  const gaRaw = vars.awayRecentGoalAvg || 1;
  const eh = vars.homeAttackEfficiency || 0.1;
  const ea = vars.awayAttackEfficiency || 0.1;
  const lhRaw = vars.homeRecentLoseAvg || 1;
  const laRaw = vars.awayRecentLoseAvg || 1;
  const dh = Math.max(vars.homeDefendEfficiency, 0.01);
  const da = Math.max(vars.awayDefendEfficiency, 0.01);

  // ── V7.0 时间衰减：近期比赛权重高于远期 ──
  // 推断近期趋势 + 应用三段式加权
  const homeTotalMatches =
    (vars.homeWinGap_1 || 0) +
    (vars.homeWinGap_2 || 0) +
    (vars.homeLoseGap_1 || 0) +
    (vars.homeLoseGap_2 || 0) +
    (vars.homeDraw || 0);
  const awayTotalMatches =
    (vars.awayWinGap_1 || 0) +
    (vars.awayWinGap_2 || 0) +
    (vars.awayLoseGap_1 || 0) +
    (vars.awayLoseGap_2 || 0) +
    (vars.awayDraw || 0);

  const homeTrendRatio = inferRecentTrendRatio(vars, 'home');
  const awayTrendRatio = inferRecentTrendRatio(vars, 'away');

  // 应用时间衰减（仅当比赛场次≥4时有效）
  const gh = homeTotalMatches >= 4
    ? applyTimeDecayToAvg(ghRaw, homeTotalMatches, homeTrendRatio)
    : ghRaw;
  const ga = awayTotalMatches >= 4
    ? applyTimeDecayToAvg(gaRaw, awayTotalMatches, awayTrendRatio)
    : gaRaw;
  const lh = homeTotalMatches >= 4
    ? applyTimeDecayToAvg(lhRaw, homeTotalMatches, homeTrendRatio > 1 ? 1 / homeTrendRatio : homeTrendRatio)
    : lhRaw;
  const la = awayTotalMatches >= 4
    ? applyTimeDecayToAvg(laRaw, awayTotalMatches, awayTrendRatio > 1 ? 1 / awayTrendRatio : awayTrendRatio)
    : laRaw;
  // ── 时间衰减结束 ──

  // 还原底层攻防次数（分母 +0.001 防除零）
  const atkH = gh / (eh + 0.001);
  const shotAgainstH = lh / (dh + 0.001);
  const atkA = ga / (ea + 0.001);
  const shotAgainstA = la / (da + 0.001);

  // 计算比赛样本量用于 β 收缩
  const nMatches = Math.max(5, Math.round((homeTotalMatches + awayTotalMatches) / 2));

  // 四维呼吸权重（带收缩 + 缩尾）
  const beta1Raw = atkH / (atkH + shotAgainstA) || 0.5;
  const beta2Raw = atkA / (atkA + shotAgainstH) || 0.5;

  // 缩尾处理：限制极端 β 值
  const beta1Capped = Math.min(0.85, Math.max(0.15, beta1Raw));
  const beta2Capped = Math.min(0.85, Math.max(0.15, beta2Raw));

  // 贝叶斯收缩：小样本拉向 0.5
  const beta1 = shrinkBeta(beta1Capped, nMatches);
  const beta2 = shrinkBeta(beta2Capped, nMatches);

  // 效率方向修正：如果效率符号指示球队趋势，微调 β
  // 例如：主队进攻效率高于均值 → 轻微增加主队进攻权重
  let beta1Adj = beta1,
    beta2Adj = beta2;
  if (vars.homeAttackEffRaw !== undefined) {
    beta1Adj += vars.homeAttackEffRaw > 0 ? 0.03 : -0.03;
    beta1Adj = Math.min(0.9, Math.max(0.1, beta1Adj));
  }
  if (vars.awayAttackEffRaw !== undefined) {
    beta2Adj += vars.awayAttackEffRaw > 0 ? 0.03 : -0.03;
    beta2Adj = Math.min(0.9, Math.max(0.1, beta2Adj));
  }

  const hfGoal = vars.homeFieldGoalAvg || vars.homeRecentGoalAvg || 1;
  const hfLose = vars.homeFieldLoseAvg || vars.homeRecentLoseAvg || 1;
  const afGoal = vars.awayFieldGoalAvg || vars.awayRecentGoalAvg || 1;
  const afLose = vars.awayFieldLoseAvg || vars.awayRecentLoseAvg || 1;

  const beta3 = (hfGoal - hfLose) / (hfGoal + hfLose + 1);
  const beta4 = (afGoal - afLose) / (afGoal + afLose + 1);

  // 终极进球期望（使用收缩后的 β 值）
  const xgHomeRaw = beta1Adj * gh + beta3 * hfGoal;
  const xgAwayRaw = beta2Adj * ga + beta4 * afGoal;

  // 安全上限（足球单场每队 xG 极少超过 4.5，总和极少超过 6.5）
  const xgHome = round(Math.min(4.5, Math.max(0.1, xgHomeRaw)), 2);
  const xgAway = round(Math.min(4.5, Math.max(0.1, xgAwayRaw)), 2);

  // ── GD_q: 净胜球量化（新公式） ──
  // Phase 1: 还原底层攻防次数 (atkH, atkA, shotAgainstH, shotAgainstA 已计算)
  // Phase 2: 四维呼吸权重（使用稳定化后的 β）
  const expGh = beta1Adj * hfGoal + (1 - beta1Adj) * afLose;
  const expGa = beta2Adj * afGoal + (1 - beta2Adj) * hfLose;
  const gdQ = round(expGh - expGa, 4);

  return {
    xgHome: round(Math.max(0.1, xgHome), 2),
    xgAway: round(Math.max(0.1, xgAway), 2),
    gdQ: gdQ, // 净胜球量化 GD_q = ExpG_h - ExpG_a
    hConversion: round(beta1, F), // 稳定化后的主队进攻转换率
    aConversion: round(beta2, F), // 稳定化后的客队进攻转换率
    _atkH: atkH,
    _atkA: atkA,
    _shotAgainstH: shotAgainstH,
    _shotAgainstA: shotAgainstA,
    _beta1Raw: round(beta1Raw, F), // 原始 β（调试用）
    _beta2Raw: round(beta2Raw, F),
    _beta1Stabilized: round(beta1, F), // 稳定化后的 β
    _beta2Stabilized: round(beta2, F),
  };
}

// ==================== 主入口 ====================

function analyze(vars, S) {
  const weights = calcWeights(S);
  const intensity = calcFieldIntensity(vars);
  const totalExpect = calcTotalGoalExpect(intensity, weights);
  const goalRange = calcGoalRange(vars, totalExpect);
  const xg = calcExpectedGoals(vars, totalExpect, weights);

  // ── 四重一致性验证与熔断（zs.md 第6节）──
  // ★ V9.1 ZQ-01: P_asia 优先从 JczqBasic 取 dxqLastPan，fallback 保持旧逻辑
  // matchInfo 为可选第3参数({date, num})，由 index.js computeSingleMatch 传入
  let pAsia = 2.5;
  try {
    const matchInfo = arguments[2]; // optional 3rd param
    if (matchInfo && matchInfo.date && matchInfo.num) {
      const database = require('../database');
      if (database.isAvailable && database.isAvailable()) {
        const dateStr = matchInfo.date.slice(0, 10);
        const matchNum = String(matchInfo.num).replace(/^[^\d]*/, '');
        const basic = database.getJczqBasic(dateStr, matchNum);
        if (basic && basic.dxqLastPan != null) {
          pAsia = parseFloat(basic.dxqLastPan);
        }
      }
    }
  } catch (e) { /* fallback below */ }
  if (pAsia === 2.5) {
    pAsia = vars.rq ? (vars.rq > 0 ? 2.0 : 3.0) : 2.5; // fallback: 基于让球数推测
  }
  // V2.0: 获取动态权重
  let dynWeights;
  try {
    const predLog = require('../prediction_log');
    dynWeights = modelWeights.getWeights(predLog);
  } catch (e) {
    dynWeights = modelWeights.DEFAULT_WEIGHTS;
  }
  const consensus = fusion.fuse(vars, { home: xg.xgHome, away: xg.xgAway }, pAsia, dynWeights);

  const hGoal = vars.homeRecentGoalAvg || 1;
  const hLose = vars.homeRecentLoseAvg || 1;
  const aGoal = vars.awayRecentGoalAvg || 1;
  const aLose = vars.awayRecentLoseAvg || 1;

  // ── 进球预测维度按 PK.md 文档公式计算 ──

  // 攻防进球 (M3_A) = xgHome + xgAway（安全上限 6.5球，足球单场极少超过）
  const attDefGoal = round(Math.min(6.5, Math.max(0.3, xg.xgHome + xg.xgAway)), 2);

  // 破甲和 = 主队进攻次数/(客队被射次数+0.5) + 客队进攻次数/(主队被射次数+0.5)
  // 安全上限 8.0（这是一个攻防穿透力比值，极少超过 8）
  const atkH = xg._atkH || 0;
  const atkA = xg._atkA || 0;
  const shotAgainstH = xg._shotAgainstH || 0;
  const shotAgainstA = xg._shotAgainstA || 0;
  const breakArmorSum = round(Math.min(8.0, atkH / (shotAgainstA + 0.5) + atkA / (shotAgainstH + 0.5)), F);

  // 交锋大球率 = 近3-6次交锋中总进球≥3球的场次比例
  const jiaoFenScores = vars.jiaoFenScores || [];
  let jiaoFenOverRate = 0;
  if (jiaoFenScores.length > 0) {
    const overCount = jiaoFenScores.filter(function (s) {
      return s && s.h + s.a >= 3;
    }).length;
    jiaoFenOverRate = overCount / jiaoFenScores.length;
  }

  // 综合大球比例 = (主队大球比例 + 客队大球比例 + 交锋大球比例) / 3（百分比）
  const bigBallRatio = round(((vars.homeOverRate + vars.awayOverRate + jiaoFenOverRate) / 3) * 100, 1);

  // 交锋进球 = 最近3-6次交锋场均总进球
  let h2hGoalAvg = 2.5;
  if (jiaoFenScores.length > 0) {
    const sum = jiaoFenScores.reduce(function (s, sc) {
      return s + (sc ? sc.h + sc.a : 0);
    }, 0);
    h2hGoalAvg = round(sum / jiaoFenScores.length, 2);
  }

  // ═══ V27 新增: 进球分布稳定性评分 ═══
  function calcGoalStability(g0, g1, g2p) {
    const total = g0 + g1 + g2p;
    if (total === 0) return 50;
    const p0 = Math.max(g0 / total, 0.001);
    const p1 = Math.max(g1 / total, 0.001);
    const p2 = Math.max(g2p / total, 0.001);
    const entropy = -(p0 * Math.log(p0) + p1 * Math.log(p1) + p2 * Math.log(p2));
    return round(Math.max(0, Math.min(100, (1 - entropy / 1.099) * 100)), 1);
  }
  const homeGoalStability = calcGoalStability(vars.homeGoal0, vars.homeGoal1, vars.homeGoal2Plus);
  const awayGoalStability = calcGoalStability(vars.awayGoal0, vars.awayGoal1, vars.awayGoal2Plus);
  const homeDefStability = calcGoalStability(vars.homeLose0, vars.homeLose1, vars.homeLose2Plus);
  const awayDefStability = calcGoalStability(vars.awayLose0, vars.awayLose1, vars.awayLose2Plus);
  const stabilityOverall = round((homeGoalStability + awayGoalStability + homeDefStability + awayDefStability) / 4, 1);

  return {
    // 主客权重
    homeWeight: round(weights.home * 100, 1) + '%',
    awayWeight: round(weights.away * 100, 1) + '%',
    // 得失球对比
    goalDiffHome: round(hGoal, 1) + '/' + round(hLose, 1),
    goalDiffAway: round(aGoal, 1) + '/' + round(aLose, 1),
    // 场地烈度
    intensityHome: intensity.home.toFixed(2) + '球',
    intensityAway: intensity.away.toFixed(2) + '球',
    // 进球失球和
    goalSumHome: round(hGoal, 2).toFixed(2) + '球',
    goalSumAway: round(aGoal, 2).toFixed(2) + '球',
    loseSumHome: round(hLose, 2).toFixed(2) + '球',
    loseSumAway: round(aLose, 2).toFixed(2) + '球',
    // 总进球期望
    totalGoalsExpect: totalExpect.toFixed(2),
    totalGoalsValue: Math.round((totalExpect / 6) * 100),
    // 弹窗区间
    goalRange,
    // xG (B2 模型原始值)
    xgHome: xg.xgHome,
    xgAway: xg.xgAway,
    gdQ: xg.gdQ, // 净胜球量化 GD_q = ExpG_h - ExpG_a
    // 四重熔断后最终值（替代 λ_total 供下游使用）
    fusionConsensus: consensus.consensus,
    fusionConsensusType: consensus.consensusType, // V2.0: strong/weak/meltdown
    fusionConsensusScore: consensus.consensusScore || 0, // V9.1: 连续置信度 [0, 1]
    fusionFused: consensus.fused,
    fusionFinalTotal: consensus.total,
    fusionFinalHome: consensus.home,
    fusionFinalAway: consensus.away,
    fusionDetails: consensus._details,
    fusionWeights: consensus._details ? consensus._details.weights : null, // V2.0: 使用的动态权重
    fieldIntensity: intensity.total,
    // ★ 进球预测维度（PK.md 进球数预测公式）
    attDefGoal: attDefGoal, // 攻防进球 = xgHome + xgAway
    breakArmorSum: breakArmorSum, // 破甲和 = atkH/(shotAgainstA+0.5) + atkA/(shotAgainstH+0.5)
    bigBallRatio: bigBallRatio, // 综合大球比例 = (H+A+J)/3 × 100
    h2hGoalAvg: h2hGoalAvg, // 交锋进球 = H2H场均总进球
    homeRecentGoalAvg: hGoal, // 主队近期场均进球（供实力进球计算）
    awayRecentGoalAvg: aGoal, // 客队近期场均进球（供实力进球计算）
    jiaoFenOverRate: jiaoFenOverRate, // 交锋大球率
    // ★ V27 新增: 进球分布稳定性
    goalStabilityHome: homeGoalStability,
    goalStabilityAway: awayGoalStability,
    defStabilityHome: homeDefStability,
    defStabilityAway: awayDefStability,
    stabilityOverall: stabilityOverall,
    // ★ V9.0 大小球交叉验证（市场数据 vs 功守道自算）
    dxqValidation: null,
    // 子维度
    _weights: weights,
    _xg: xg,
  };
}

module.exports = { analyze, timeDecayWeights, applyTimeDecayToAvg, inferRecentTrendRatio };

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
    total: round(hFGoal + hFLose + aFGoal + aFLose, F)
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
    const overCount = jiaoFenScores.filter(function(s) {
      return s && (s.h + s.a) >= 3;
    }).length;
    h2hOverRate = overCount / jiaoFenScores.length;
  }

  // 综合期望线 λ_gene = 0.4×主大球率×5 + 0.4×客大球率×5 + 0.2×交锋大球率×5
  // 大球率(0~1) ×5 放大到进球尺度(0~5)
  const lambdaGene = round(
    0.4 * homeOR * 5 + 0.4 * awayOR * 5 + 0.2 * h2hOverRate * 5,
    F
  );

  // 实际复刻基因：最近两次交锋进球数均值
  let lambdaActual = totalExpect;
  if (jiaoFenScores.length > 0) {
    const sum = jiaoFenScores.reduce((s, sc) => s + (sc ? (sc.h + sc.a) : 0), 0);
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
    overRate: round((homeOR + awayOR) / 2 * 100, 1),
    lambdaGene,
    lambdaActual,
    homeOverRate: round(homeOR, F),
    awayOverRate: round(awayOR, F),
    h2hOverRate: round(h2hOverRate, F)
  };
}

// ==================== 4.5 主客近期进球期望（xG）====================

function calcExpectedGoals(vars, totalExpect, weights) {
  const gh = vars.homeRecentGoalAvg || 1;
  const ga = vars.awayRecentGoalAvg || 1;
  const eh = vars.homeAttackEfficiency || 0.1;
  const ea = vars.awayAttackEfficiency || 0.1;
  const lh = vars.homeRecentLoseAvg || 1;
  const la = vars.awayRecentLoseAvg || 1;
  const dh = Math.max(vars.homeDefendEfficiency, 0.01);
  const da = Math.max(vars.awayDefendEfficiency, 0.01);

  // 还原底层攻防次数（分母 +0.001 防除零）
  const atkH = gh / (eh + 0.001);
  const shotAgainstH = lh / (dh + 0.001);
  const atkA = ga / (ea + 0.001);
  const shotAgainstA = la / (da + 0.001);

  // 四维呼吸权重
  const beta1 = atkH / (atkH + shotAgainstA) || 0.5;
  const beta2 = atkA / (atkA + shotAgainstH) || 0.5;

  const hfGoal = vars.homeFieldGoalAvg || vars.homeRecentGoalAvg || 1;
  const hfLose = vars.homeFieldLoseAvg || vars.homeRecentLoseAvg || 1;
  const afGoal = vars.awayFieldGoalAvg || vars.awayRecentGoalAvg || 1;
  const afLose = vars.awayFieldLoseAvg || vars.awayRecentLoseAvg || 1;

  const beta3 = (hfGoal - hfLose) / (hfGoal + hfLose + 1);
  const beta4 = (afGoal - afLose) / (afGoal + afLose + 1);

  // 终极进球期望（严格按文档公式，不做额外缩放）
  const xgHome = round(beta1 * atkH + beta3 * hfGoal, 2);
  const xgAway = round(beta2 * atkA + beta4 * afGoal, 2);

  // ── GD_q: 净胜球量化（新公式） ──
  // Phase 1: 还原底层攻防次数 (atkH, atkA, shotAgainstH, shotAgainstA 已计算)
  // Phase 2: 四维呼吸权重
  //   W_HA = atkH/(atkH+shotAgainstA)  = beta1,  W_AD = shotAgainstA/(atkH+shotAgainstA) = 1-beta1
  //   W_AA = atkA/(atkA+shotAgainstH)  = beta2,  W_HD = shotAgainstH/(atkA+shotAgainstH) = 1-beta2
  // Phase 4: 预期进球（使用主/客场特化场均，非近期场均）
  //   ExpG_h = (G_home_s × W_HA) + (C_away_s × W_AD) = hfGoal×beta1 + afLose×(1-beta1)
  //   ExpG_a = (G_away_s × W_AA) + (C_home_s × W_HD) = afGoal×beta2 + hfLose×(1-beta2)
  // GD_q = ExpG_h - ExpG_a
  const expGh = beta1 * hfGoal + (1 - beta1) * afLose;
  const expGa = beta2 * afGoal + (1 - beta2) * hfLose;
  const gdQ = round(expGh - expGa, 4);

  return {
    xgHome: round(Math.max(0.1, xgHome), 2),
    xgAway: round(Math.max(0.1, xgAway), 2),
    gdQ: gdQ,                          // 净胜球量化 GD_q = ExpG_h - ExpG_a
    hConversion: round(beta1, F),
    aConversion: round(beta2, F),
    _atkH: atkH,
    _atkA: atkA,
    _shotAgainstH: shotAgainstH,
    _shotAgainstA: shotAgainstA
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
  const pAsia = vars.rq ? (vars.rq > 0 ? 2.0 : 3.0) : 2.5; // fallback: 基于让球数推测盘口
  const consensus = fusion.fuse(vars, { home: xg.xgHome, away: xg.xgAway }, pAsia);

  const hGoal = vars.homeRecentGoalAvg || 1;
  const hLose = vars.homeRecentLoseAvg || 1;
  const aGoal = vars.awayRecentGoalAvg || 1;
  const aLose = vars.awayRecentLoseAvg || 1;

  // ── 进球预测维度按 PK.md 文档公式计算 ──

  // 攻防进球 (M3_A) = xgHome + xgAway
  const attDefGoal = round(xg.xgHome + xg.xgAway, 2);

  // 破甲和 = 主队进攻次数/(客队被射次数+0.5) + 客队进攻次数/(主队被射次数+0.5)
  const atkH = xg._atkH || 0;
  const atkA = xg._atkA || 0;
  const shotAgainstH = xg._shotAgainstH || 0;
  const shotAgainstA = xg._shotAgainstA || 0;
  const breakArmorSum = round(atkH / (shotAgainstA + 0.5) + atkA / (shotAgainstH + 0.5), F);

  // 交锋大球率 = 近3-6次交锋中总进球≥3球的场次比例
  const jiaoFenScores = vars.jiaoFenScores || [];
  let jiaoFenOverRate = 0;
  if (jiaoFenScores.length > 0) {
    const overCount = jiaoFenScores.filter(function(s) { return s && (s.h + s.a) >= 3; }).length;
    jiaoFenOverRate = overCount / jiaoFenScores.length;
  }

  // 综合大球比例 = (主队大球比例 + 客队大球比例 + 交锋大球比例) / 3（百分比）
  const bigBallRatio = round((vars.homeOverRate + vars.awayOverRate + jiaoFenOverRate) / 3 * 100, 1);

  // 交锋进球 = 最近3-6次交锋场均总进球
  let h2hGoalAvg = 2.5;
  if (jiaoFenScores.length > 0) {
    const sum = jiaoFenScores.reduce(function(s, sc) { return s + (sc ? (sc.h + sc.a) : 0); }, 0);
    h2hGoalAvg = round(sum / jiaoFenScores.length, 2);
  }

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
    totalGoalsValue: Math.round(totalExpect / 6 * 100),
    // 弹窗区间
    goalRange,
    // xG (B2 模型原始值)
    xgHome: xg.xgHome,
    xgAway: xg.xgAway,
    gdQ: xg.gdQ,                         // 净胜球量化 GD_q = ExpG_h - ExpG_a
    // 四重熔断后最终值（替代 λ_total 供下游使用）
    fusionConsensus: consensus.consensus,
    fusionFused: consensus.fused,
    fusionFinalTotal: consensus.total,
    fusionFinalHome: consensus.home,
    fusionFinalAway: consensus.away,
    fusionDetails: consensus._details,
    fieldIntensity: intensity.total,
    // ★ 进球预测维度（PK.md 进球数预测公式）
    attDefGoal: attDefGoal,           // 攻防进球 = xgHome + xgAway
    breakArmorSum: breakArmorSum,     // 破甲和 = atkH/(shotAgainstA+0.5) + atkA/(shotAgainstH+0.5)
    bigBallRatio: bigBallRatio,       // 综合大球比例 = (H+A+J)/3 × 100
    h2hGoalAvg: h2hGoalAvg,           // 交锋进球 = H2H场均总进球
    homeRecentGoalAvg: hGoal,         // 主队近期场均进球（供实力进球计算）
    awayRecentGoalAvg: aGoal,         // 客队近期场均进球（供实力进球计算）
    jiaoFenOverRate: jiaoFenOverRate, // 交锋大球率
    // 子维度
    _weights: weights,
    _xg: xg
  };
}

module.exports = { analyze };

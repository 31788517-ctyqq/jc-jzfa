/**
 * 第五阶段：让球分析 (7-Match Threshold & Hard Power Analysis) V24 修订版
 *
 * 按照 gongshoudao-quan.md 新公式重写：
 *   Diff_exp = xgHome - xgAway
 *   Static = (homePower - awayPower) / (homePower + awayPower)
 *   Dyn = V6.4: (WinGap_2×2 + WinGap_1×1.75 + Draw×0.5 + LoseGap_1×0.25) 差值对比
 *   Total_战 = 0.7 × Static + 0.3 × Dyn_diff（V6.4 动态计分直接得出 Dyn_diff）
 *   Anchor 动态锚点
 *   7场硬性阈值判定
 *   三者一致共振裁决
 */
const F = 4;

function round(v, n) {
  const m = Math.pow(10, n);
  return Math.round(v * m) / m;
}

// ==================== 5.1 主队赢球期望值 Diff_exp ====================

function calcDiffXG(xgHome, xgAway) {
  return round(xgHome - xgAway, F);
}

// ==================== 5.2 双轨实力量化 Total_战 ====================

/**
 * 静态实力：Static = (homePower - guestPower) / (homePower + guestPower)
 */
function calcStaticStrength(vars) {
  const hPower = vars.homePower || 50;
  const aPower = vars.awayPower || 50;
  return round((hPower - aPower) / (hPower + aPower), F);
}

/**
 * 动态状态（V6.4 动态计分规则）
 *
 *   Dynamic_Score = (WinGap_2 × 2) + (WinGap_1 × 1.75) + (Draws × 0.5) + (LoseGap_1 × 0.25)
 *   Dynamic_Diff = (Dyn_home - Dyn_away) / (Dyn_home + Dyn_away)
 */
function calcDynamicState(vars) {
  const dynH = vars.homeWinGap_2 * 2 + vars.homeWinGap_1 * 1.75 + vars.homeDraw * 0.5 + vars.homeLoseGap_1 * 0.25;
  const dynA = vars.awayWinGap_2 * 2 + vars.awayWinGap_1 * 1.75 + vars.awayDraw * 0.5 + vars.awayLoseGap_1 * 0.25;
  const denom = dynH + dynA || 0.01;
  return round((dynH - dynA) / denom, F);
}

/**
 * 综合实力量化：Total_战 = 0.7 × Static + 0.3 × Dyn（V6.4）
 */
function calcTotalStrength(vars) {
  const staticStr = calcStaticStrength(vars);
  const dynState = calcDynamicState(vars);

  return {
    static: round(staticStr, F),
    dynamic: round(dynState, F),
    normalized: round(0.7 * staticStr + 0.3 * dynState, F),
  };
}

// ==================== Anchor 锚点锁定 ====================

/**
 * 根据 Total_战 锁定锚点
 *   ≥ 0.2: 主队强势盘面, anchor = 0.3
 *   -0.2 ~ 0.2: 均势, anchor = 0.0
 *   ≤ -0.2: 客队强势, anchor = -0.3
 */
function calcAnchor(totalStrength) {
  const t = totalStrength.normalized;
  if (t >= 0.2) return { anchor: 0.3, label: '主队强势盘面', judgment: '主强' };
  if (t <= -0.2) return { anchor: -0.3, label: '客队强势盘面', judgment: '客强' };
  return { anchor: 0.0, label: '双方均势/胶着盘面', judgment: '均势' };
}

// ==================== 5.3 Beta-Binomial 概率化阈值判定（V7.0） ====================

/**
 * Beta-Binomial 后验概率计算
 *
 * 相比旧版硬阈值（≥7=通过），用贝叶斯后验概率给出更精确的穿盘概率：
 *
 *   P(穿盘) = (α + successes) / (α + β + total)
 *   where α=2, β=2 (均匀先验)
 *
 * 解决的问题：
 *   - 7/10 vs 7/30 意义完全不同，但旧版被同等对待
 *   - 小样本时先验起主导作用（回归保守）
 *   - 大样本时后验趋近于频率估计
 *
 * @param {number} successes 正向场次（主赢∩客输）
 * @param {number} total     总场次（近N场全部比赛）
 * @param {number} alphaPrior Beta先验 α（默认2）
 * @param {number} betaPrior  Beta先验 β（默认2）
 * @returns {{ prob: number, probPct: string, label: string, passed: boolean, confidence: string }}
 */
function betaBinomialProb(successes, total, alphaPrior, betaPrior) {
  alphaPrior = alphaPrior || 2;
  betaPrior = betaPrior || 2;
  total = Math.max(0, total || 0);
  successes = Math.max(0, Math.min(total, successes));

  const alphaPost = alphaPrior + successes;
  const betaPost = betaPrior + total - successes;
  const mean = alphaPost / (alphaPost + betaPost);

  // 概率限制在 [5%, 95%] 区间
  const prob = Math.min(0.95, Math.max(0.05, mean));
  const probPct = (prob * 100).toFixed(1) + '%';

  // 置信度：total越大，后验越远离先验均值0.5，越可信
  let confidence;
  if (total >= 20) confidence = '极高';
  else if (total >= 14) confidence = '高';
  else if (total >= 8) confidence = '中等';
  else confidence = '低（小样本）';

  // 标签
  let label;
  let passed;
  if (prob >= 0.75) {
    label = '🔥 极高概率(' + probPct + ')';
    passed = true;
  } else if (prob >= 0.60) {
    label = '📊 高概率(' + probPct + ')';
    passed = true;
  } else if (prob >= 0.50) {
    label = '⚖️ 边际概率(' + probPct + ')';
    passed = false;
  } else if (prob >= 0.40) {
    label = '⚠️ 低概率(' + probPct + ')';
    passed = false;
  } else {
    label = '🚫 极低概率(' + probPct + ')';
    passed = false;
  }

  return { prob: round(prob, 4), probPct, label, passed, confidence, raw: { successes, total, mean: round(mean, 4) } };
}

// ==================== 5.3 7场硬性阈值全分布交叉统计（V7.0 升级为概率化） ====================

/**
 * 维度一：【主赢 ∩ 客输】正向期望赢盘组合判定
 *   主强或均势 (Total_战 ≥ -0.2):
 *     主: gd ≥ 1, 客: gd ≤ -1
 *   主弱 (Total_战 < -0.2):
 *     主: gd ≥ 0, 客: gd ≤ 0
 */
function calcWinLoseCross(totalStrength, homeSeries, awaySeries) {
  let hCount = 0;
  let aCount = 0;

  const isWeak = totalStrength.normalized < -0.2;

  for (const gd of homeSeries) {
    if (isWeak) {
      if (gd >= 0) hCount++;
    } else {
      if (gd >= 1) hCount++;
    }
  }

  for (const gd of awaySeries) {
    if (isWeak) {
      if (gd <= 0) aCount++;
    } else {
      if (gd <= -1) aCount++;
    }
  }

  const total = hCount + aCount;

  // ★ V7.0: Beta-Binomial 概率化替代硬阈值
  const bb = betaBinomialProb(total, homeSeries.length + awaySeries.length);

  // 同时保留旧版字段作为回退
  const oldPassed = total >= 7;

  return {
    hCount,
    aCount,
    total,
    // V7.0 新增概率化字段
    prob: bb.prob,
    probPct: bb.probPct,
    passed: bb.passed,
    label: bb.label,
    confidence: bb.confidence,
    // 旧版兼容
    _oldPassed: oldPassed,
    _oldLabel: oldPassed ? '🔥 符合期望' : '⚠️ 未通过',
  };
}

/**
 * 维度二：【主输 ∩ 客赢】逆向防守咬盘组合判定
 *   主强或均势 (Total_战 ≥ -0.2):
 *     主: gd ≤ -1, 客: gd ≥ 1
 *   主弱 (Total_战 < -0.2):
 *     主: gd ≤ 0, 客: gd ≥ 0
 */
function calcLoseWinCross(totalStrength, homeSeries, awaySeries) {
  let hCount = 0;
  let aCount = 0;

  const isWeak = totalStrength.normalized < -0.2;

  for (const gd of homeSeries) {
    if (isWeak) {
      if (gd <= 0) hCount++;
    } else {
      if (gd <= -1) hCount++;
    }
  }

  for (const gd of awaySeries) {
    if (isWeak) {
      if (gd >= 0) aCount++;
    } else {
      if (gd >= 1) aCount++;
    }
  }

  const total = hCount + aCount;

  // ★ V7.0: Beta-Binomial 概率化替代硬阈值
  const bb = betaBinomialProb(total, homeSeries.length + awaySeries.length);

  // 同时保留旧版字段作为回退
  const oldPassed = total >= 7;

  return {
    hCount,
    aCount,
    total,
    // V7.0 新增概率化字段
    prob: bb.prob,
    probPct: bb.probPct,
    passed: bb.passed,
    label: bb.label,
    confidence: bb.confidence,
    // 旧版兼容
    _oldPassed: oldPassed,
    _oldLabel: oldPassed ? '🛡️ 弱方韧性' : '⚠️ 未通过',
  };
}

// ==================== 5.4 三者一致共振裁决（V9.1: 增加市场面共振纬度） ====================

function calcResonance(diffXG, totalStrength, dim1, dim2, marketContext) {
  const diffPositive = diffXG > 0;
  const totalStrong = totalStrength.normalized >= 0.2;
  const totalWeak = totalStrength.normalized <= -0.2;

  // ★ V7.0: 使用概率化判定（>=0.60 视为通过）
  const dim1Passed = dim1.passed && dim1.prob >= 0.55;
  const dim2Passed = dim2.passed && dim2.prob >= 0.55;

  // ★ V9.1 ZQ-02: 市场面共振纬度
  let marketResonance = 0; // -1=背离, 0=中性, 1=共振
  if (marketContext) {
    const panShift = marketContext.panShift || 0;
    const spImpHome = marketContext.spImpHome || 0.33;
    // 盘口位移与实力方向一致 → 市场共振
    if (diffPositive && panShift > 0 && spImpHome > 0.45) marketResonance = 1;
    else if (!diffPositive && panShift < 0 && spImpHome < 0.35) marketResonance = 1;
    // 盘口位移与实力方向相反 → 市场背离
    else if (diffPositive && panShift < 0) marketResonance = -1;
    else if (!diffPositive && panShift > 0) marketResonance = -1;
  }

  // 主队共振提振: Diff_exp > 0 && Total_战 ≥ 0.2 && 维度一高概率通过
  if (diffPositive && totalStrong && dim1Passed) {
    const label = marketResonance === 1
      ? '🔥 四维共振：主队穿盘+市场验证 (' + dim1.probPct + ')'
      : '🔥 三者共振：主队穿盘概率极高 (' + dim1.probPct + ')';
    return { verdict: label, level: marketResonance === 1 ? 'strong_home_verified' : 'strong_home' };
  }

  // 客队共振提振: Diff_exp < 0 && Total_战 ≤ -0.2 && 维度二高概率通过
  if (!diffPositive && totalWeak && dim2Passed) {
    const label = marketResonance === 1
      ? '🛡️ 四维共振：客队不败+市场验证 (' + dim2.probPct + ')'
      : '🛡️ 三者共振：客队不败稳健 (' + dim2.probPct + ')';
    return { verdict: label, level: marketResonance === 1 ? 'strong_away_verified' : 'strong_away' };
  }

  if (dim1.passed) {
    // 市场背离时降级
    if (marketResonance === -1) {
      return { verdict: '主队盘路偏强(' + dim1.probPct + ')，但市场背离⚠️', level: 'weak_home_divergent' };
    }
    return { verdict: '主队盘路偏强(' + dim1.probPct + ')，但需谨慎', level: 'weak_home' };
  }
  if (dim2.passed) {
    if (marketResonance === -1) {
      return { verdict: '客队韧性(' + dim2.probPct + ')，但市场背离⚠️', level: 'weak_away_divergent' };
    }
    return { verdict: '客队韧性(' + dim2.probPct + ')，但需谨慎', level: 'weak_away' };
  }

  return { verdict: '回归常态：基本面对冲，无明确方向', level: 'neutral' };
}

// ==================== 主入口 ====================

function analyze(vars, xgHome, xgAway) {
  // 5.1
  const diffXG = calcDiffXG(xgHome, xgAway);

  // 5.2
  const totalStrength = calcTotalStrength(vars);

  // Anchor
  const anchor = calcAnchor(totalStrength);

  // 5.3 7场阈值
  const homeSeries = vars.homeGoalDiffSeries || [];
  const awaySeries = vars.awayGoalDiffSeries || [];
  const dim1 = calcWinLoseCross(totalStrength, homeSeries, awaySeries);
  const dim2 = calcLoseWinCross(totalStrength, homeSeries, awaySeries);

  // 5.4 共振裁决（V9.1: 传入市场上下文做四维共振判定）
  const resonance = calcResonance(diffXG, totalStrength, dim1, dim2, null /* market context filled by index.js */);

  // Total_战 百分比化显示
  const totalPct = round(totalStrength.normalized * 100, 1);

  // ★ 实力进球 (M3_B) = 0.5 × (主队静态进球能力 + 客队静态进球能力) × (1 + 0.2 × Total_战)
  const hGoalAbility = vars.homeRecentGoalAvg || 1;
  const aGoalAbility = vars.awayRecentGoalAvg || 1;
  const strengthGoal = round(0.5 * (hGoalAbility + aGoalAbility) * (1 + 0.2 * totalStrength.normalized), F);

  return {
    // 主队赢球期望
    homeWinExpect: (diffXG >= 0 ? '+' : '') + diffXG.toFixed(2),
    homeWinValue: Math.round(50 + diffXG * 10),

    // 功守道战力 Total_战（百分比化）
    totalAdvantage2: (totalPct >= 0 ? '+' : '') + totalPct + '%',
    totalAdvantage2Value: Math.round(50 + totalStrength.normalized * 100),
    totalAdvantage2Raw: round(totalStrength.normalized, F),

    // 锚点
    anchor,

    // 7场验证
    verifyResult: dim1.passed ? '✓ 通过' : dim2.passed ? '⚠ 逆向通过' : '✗ 未通过',
    verifyValue: dim1.passed ? 80 : dim2.passed ? 50 : 20,
    sevenMatch: {
      dimension1: dim1,
      dimension2: dim2,
    },

    // 共振
    resonance,

    // 净胜球分布数据
    goalCount: diffXG >= 0.5 ? '≥1' : diffXG <= -0.5 ? '≤-1' : '±0',
    goalCountValue: Math.round(50 + diffXG * 25),

    // 内部数据
    _totalStrength: totalStrength,
    _diffXG: diffXG,

    // ★ 实力进球（供进球预测排行榜使用）
    strengthGoal: strengthGoal,
  };
}

module.exports = { analyze, calcResonance, betaBinomialProb };

/**
 * 第五阶段：让球分析 (7-Match Threshold & Hard Power Analysis) V24 修订版
 *
 * 按照 gongshoudao-quan.md 新公式重写：
 *   Diff_exp = xgHome - xgAway
 *   Static = (homePower - guestPower) / 100
 *   Dyn_h = (3×H_win + 1×PG_h) / 30, Dyn_a = (3×A_win + 1×PG_a) / 30
 *   Total_战 = 0.7 × Static + 0.3 × (Dyn_h - Dyn_a)
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
 * 动态状态（P6/P3/P1 分阶加权，无细分数据时用近10场近似）
 *
 *   P_n = (3×W_n + D_n) / (3×n)    // 得分率
 *   状态值 = 0.5×P6 + 0.3×P3 + 0.2×P1
 *   DynAdv = (状态值_主 - 状态值_客) / (状态值_主 + 状态值_客)
 */
function calcDynamicState(vars) {
  const hWins = vars.homeWinGap_2 + vars.homeWinGap_1;
  const aWins = vars.awayWinGap_2 + vars.awayWinGap_1;
  const hDraws = vars.homeDraw;
  const aDraws = vars.awayDraw;
  const hTotal = hWins + hDraws + vars.homeLoseGap_1 + vars.homeLoseGap_2 || 10;
  const aTotal = aWins + aDraws + vars.awayLoseGap_1 + vars.awayLoseGap_2 || 10;

  // 按比例从10场近似6/3/1场
  function stateVal(wins, draws, total) {
    const wRate = wins / total;
    const dRate = draws / total;
    const p6 = (3 * wRate * 6 + 1 * dRate * 6) / 18;
    const p3 = (3 * wRate * 3 + 1 * dRate * 3) / 9;
    const p1 = (3 * wRate * 1 + 1 * dRate * 1) / 3;
    return 0.5 * p6 + 0.3 * p3 + 0.2 * p1;
  }

  const stateH = stateVal(hWins, hDraws, hTotal);
  const stateA = stateVal(aWins, aDraws, aTotal);
  const sum = stateH + stateA || 0.01;
  return round((stateH - stateA) / sum, F);
}

/**
 * 综合实力量化：Total_战 = 0.6 × Static + 0.4 × Dyn
 */
function calcTotalStrength(vars) {
  const staticStr = calcStaticStrength(vars);
  const dynState = calcDynamicState(vars);

  return {
    static: round(staticStr, F),
    dynamic: round(dynState, F),
    normalized: round(0.6 * staticStr + 0.4 * dynState, F)
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
  if (t >= 0.2)  return { anchor: 0.3,  label: '主队强势盘面', judgment: '主强' };
  if (t <= -0.2) return { anchor: -0.3, label: '客队强势盘面', judgment: '客强' };
  return { anchor: 0.0, label: '双方均势/胶着盘面', judgment: '均势' };
}

// ==================== 5.3 7场硬性阈值全分布交叉统计 ====================

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
  const passed = total >= 7;

  return {
    hCount, aCount, total, passed,
    label: passed ? '🔥 符合期望' : '⚠️ 未通过'
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
  const passed = total >= 7;

  return {
    hCount, aCount, total, passed,
    label: passed ? '🛡️ 弱方韧性' : '⚠️ 未通过'
  };
}

// ==================== 5.4 三者一致共振裁决 ====================

function calcResonance(diffXG, totalStrength, dim1, dim2) {
  const diffPositive = diffXG > 0;
  const totalStrong = totalStrength.normalized >= 0.2;
  const totalWeak = totalStrength.normalized <= -0.2;

  // 主队共振提振: Diff_exp > 0 && Total_战 ≥ 0.2 && 维度一通过
  if (diffPositive && totalStrong && dim1.passed) {
    return { verdict: '🔥 三者共振：主队穿盘概率极高', level: 'strong_home' };
  }

  // 客队共振提振: Diff_exp < 0 && Total_战 ≤ -0.2 && 维度二通过
  if (!diffPositive && totalWeak && dim2.passed) {
    return { verdict: '🛡️ 三者共振：客队不败稳健', level: 'strong_away' };
  }

  if (dim1.passed) {
    return { verdict: '主队盘路偏强，但需谨慎', level: 'weak_home' };
  }
  if (dim2.passed) {
    return { verdict: '客队韧性强，但需谨慎', level: 'weak_away' };
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

  // 5.4 共振裁决
  const resonance = calcResonance(diffXG, totalStrength, dim1, dim2);

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
    verifyResult: dim1.passed ? '✓ 通过' : (dim2.passed ? '⚠ 逆向通过' : '✗ 未通过'),
    verifyValue: dim1.passed ? 80 : (dim2.passed ? 50 : 20),
    sevenMatch: {
      dimension1: dim1,
      dimension2: dim2
    },

    // 共振
    resonance,

    // 净胜球分布数据
    goalCount: diffXG >= 0.5 ? '≥1' : (diffXG <= -0.5 ? '≤-1' : '±0'),
    goalCountValue: Math.round(50 + diffXG * 25),

    // 内部数据
    _totalStrength: totalStrength,
    _diffXG: diffXG,

    // ★ 实力进球（供进球预测排行榜使用）
    strengthGoal: strengthGoal
  };
}

module.exports = { analyze };

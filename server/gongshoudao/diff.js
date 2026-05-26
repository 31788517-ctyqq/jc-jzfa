/**
 * 第五阶段：让球分析 (7-Match Threshold & Hard Power Analysis)
 *
 * 计算：
 *   预期净胜球差 Diff_xG
 *   双轨实力量化 Total_战
 *   Anchor 动态锚点
 *   7场硬性通过判定
 *   三者一致共振裁决
 */
const F = 4;

// ==================== 5.1 主队赢球期望值 Diff_xG ====================
function calcDiffXG(xgHome, xgAway) {
  return round(xgHome - xgAway, F);
}

// ==================== 5.2 双轨实力量化 Total_战 ====================

/**
 * 静态实力：基于 power 值的标准化
 */
function calcStaticStrength(vars) {
  const hPower = vars.homePower || 50;
  const aPower = vars.awayPower || 50;
  // 差值映射到 ±100 范围
  return round((hPower - aPower) / 5, F); // 10分差 ≈ 2净胜球优势
}

/**
 * 动态状态：基于近期攻防表现
 */
function calcDynamicState(vars) {
  // 攻防综合指标
  const hDyn = (vars.homeAttackEfficiency - vars.homeDefendEfficiency) * 10;
  const aDyn = (vars.awayAttackEfficiency - vars.awayDefendEfficiency) * 10;

  // 近期进球差
  const hRecentDiff = (vars.homeRecentGoalAvg || 1) - (vars.homeRecentLoseAvg || 1);
  const aRecentDiff = (vars.awayRecentGoalAvg || 1) - (vars.awayRecentLoseAvg || 1);

  // 综合动态状态
  return round((hDyn - aDyn) + (hRecentDiff - aRecentDiff), F);
}

/**
 * 综合实力量化 Total_战
 */
function calcTotalStrength(vars) {
  const staticStrength = calcStaticStrength(vars);
  const dynamicState = calcDynamicState(vars);

  // 40% 静态 + 60% 动态
  const total = round(staticStrength * 0.4 + dynamicState * 0.6, F);

  // 归一化：映射到净胜球预期范围
  // 正值=主队优势，负值=客队优势
  return {
    total: total,
    static: staticStrength,
    dynamic: dynamicState,
    normalized: round(total, F)
  };
}

// ==================== 5.3 Anchor 锚点锁定 ====================

/**
 * 根据 Total_战 锁定锚点
 */
function calcAnchor(diffXG) {
  if (diffXG >= 0.5) return { anchor: 'A', label: '主队强势盘面', judgment: '主强' };
  if (diffXG <= -0.5) return { anchor: 'C', label: '客队强势/逆风盘面', judgment: '客强' };
  return { anchor: 'B', label: '双方均势/胶着盘面', judgment: '均势' };
}

// ==================== 5.4 7场硬性阈值全分布交叉统计 ====================

/**
 * 维度一：【主赢 ∩ 客输】正向期望赢盘组合判定
 */
function calcWinLoseCross(anchor, homeSeries, awaySeries) {
  let hCount = 0;
  let aCount = 0;

  const isHomeStrongOrBalanced = (anchor.judgment === '主强' || anchor.judgment === '均势');

  for (const gd of homeSeries) {
    if (isHomeStrongOrBalanced) {
      if (gd >= 0) hCount++;
    } else {
      if (gd > 0) hCount++;
    }
  }

  for (const gd of awaySeries) {
    if (isHomeStrongOrBalanced) {
      if (gd <= 0) aCount++;
    } else {
      if (gd < 0) aCount++;
    }
  }

  const total = hCount + aCount;
  const passed = total >= 7;

  return {
    hCount, aCount, total, passed,
    label: passed ? '🔥 符合期望（主队盘路强势）' : '➖ 未达阈值'
  };
}

/**
 * 维度二：【主输 ∩ 客赢】逆向防守咬盘组合判定
 */
function calcLoseWinCross(anchor, homeSeries, awaySeries) {
  let hCount = 0;
  let aCount = 0;

  const isHomeStrongOrBalanced = (anchor.judgment === '主强' || anchor.judgment === '均势');

  for (const gd of homeSeries) {
    if (isHomeStrongOrBalanced) {
      if (gd < 0) hCount++;
    } else {
      if (gd <= 0) hCount++;
    }
  }

  for (const gd of awaySeries) {
    if (isHomeStrongOrBalanced) {
      if (gd > 0) aCount++;
    } else {
      if (gd >= 0) aCount++;
    }
  }

  const total = hCount + aCount;
  const passed = total >= 7;

  return {
    hCount, aCount, total, passed,
    label: passed ? '🛡️ 弱方韧性（客队盘路强势）' : '➖ 未达阈值'
  };
}

// ==================== 5.5 三者一致共振裁决 ====================

function calcResonance(diffXG, totalStrength, dimension1, dimension2) {
  const diffPositive = diffXG > 0;
  const totalPositive = totalStrength.normalized > 0;

  // 主队共振
  if (diffPositive && totalPositive && dimension1.passed) {
    return {
      verdict: '🔥 三者共振：主队穿盘概率极高',
      level: 'strong_home'
    };
  }

  // 客队共振
  if (!diffPositive && !totalPositive && dimension2.passed) {
    return {
      verdict: '🛡️ 三者共振：客队不败稳健',
      level: 'strong_away'
    };
  }

  // 部分通过
  if (dimension1.passed) {
    return {
      verdict: '主队盘路偏强，但需谨慎（期望/实力未完全共振）',
      level: 'weak_home'
    };
  }

  if (dimension2.passed) {
    return {
      verdict: '客队韧性强，但需谨慎（期望/实力未完全共振）',
      level: 'weak_away'
    };
  }

  return {
    verdict: '回归常态：基本面对冲，无明确方向',
    level: 'neutral'
  };
}

// ==================== 主入口 ====================

function analyze(vars, xgHome, xgAway) {
  // 5.1
  const diffXG = calcDiffXG(xgHome, xgAway);

  // 5.2
  const totalStrength = calcTotalStrength(vars);

  // Anchor
  const anchor = calcAnchor(diffXG);

  // 5.3 7场阈值
  const homeSeries = vars.homeGoalDiffSeries || [];
  const awaySeries = vars.awayGoalDiffSeries || [];
  const dim1 = calcWinLoseCross(anchor, homeSeries, awaySeries);
  const dim2 = calcLoseWinCross(anchor, homeSeries, awaySeries);

  // 5.4 共振裁决
  const resonance = calcResonance(diffXG, totalStrength, dim1, dim2);

  return {
    // 主队赢球期望
    homeWinExpect: (diffXG >= 0 ? '+' : '') + diffXG.toFixed(2),
    homeWinValue: Math.round(50 + diffXG * 10), // 进度条映射
    // 综合实力量化
    totalAdvantage2: (totalStrength.normalized >= 0 ? '+' : '') + totalStrength.normalized.toFixed(2),
    totalAdvantage2Value: Math.round(50 + totalStrength.normalized * 10),
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
    _diffXG: diffXG
  };
}

function round(v, n) {
  const m = Math.pow(10, n);
  return Math.round(v * m) / m;
}

module.exports = { analyze };

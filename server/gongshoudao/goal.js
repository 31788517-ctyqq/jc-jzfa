/**
 * 第四阶段：阵之第二维 · 和差归一大小球博弈算法
 *
 * 计算：
 *   总进球期望 E_total
 *   主客预期进球 xG_home / xG_away
 *   进球数弹性区间（三维收敛锁）
 */
const F = 4;

// ==================== 4.1 主客权重（杠杆放大器）====================

function calcWeights(totalAdvantagePct) {
  // P_total 已经是百分比化值（如 +5.2 表示主队优5.2%）
  const homeWeight = round((1 + totalAdvantagePct / 100) / 2, F);
  const awayWeight = round((1 - totalAdvantagePct / 100) / 2, F);
  return { home: Math.max(0.1, Math.min(0.9, homeWeight)), away: Math.max(0.1, Math.min(0.9, awayWeight)) };
}

// ==================== 4.2 场地烈度 ====================

function calcFieldIntensity(vars) {
  // 主场场均得失球 + 客场场均得失球
  const homeField = (vars.homeFieldGoalAvg || 0) + (vars.homeFieldLoseAvg || 0);
  const awayField = (vars.awayFieldGoalAvg || 0) + (vars.awayFieldLoseAvg || 0);

  // 如果没有场地数据，回退到近期数据
  const hFGoal = vars.homeFieldGoalAvg || vars.homeRecentGoalAvg || 1;
  const hFLose = vars.homeFieldLoseAvg || vars.homeRecentLoseAvg || 1;
  const aFGoal = vars.awayFieldGoalAvg || vars.awayRecentGoalAvg || 1;
  const aFLose = vars.awayFieldLoseAvg || vars.awayRecentLoseAvg || 1;

  return round(hFGoal + hFLose + aFGoal + aFLose, F);
}

// ==================== 4.3 全局总进球期望 ====================

function calcTotalGoalExpect(fieldIntensity, weights) {
  // E_total = fieldIntensity * (w_home * 攻击比重 + w_away * 防守比重)
  const homeContribution = fieldIntensity * weights.home * 0.5;
  const awayContribution = fieldIntensity * weights.away * 0.5;
  return round(homeContribution + awayContribution, F);
}

// ==================== 4.4 进球数弹性区间（三维收敛锁）====================

function calcGoalRange(vars, totalExpect) {
  // 1. 大盘近期基因：大球率 → 等效期望
  const overRate = (vars.homeOverRate + vars.awayOverRate) / 2; // 0~1
  const overAdjusted = 2 + overRate * 2; // 将大球率映射到进球数（约2-4球）

  // 2. 交锋基因：基于交锋比分均值
  const jiaoFenScores = vars.jiaoFenScores || [];
  let jfAvg = 0;
  if (jiaoFenScores.length > 0) {
    const sum = jiaoFenScores.reduce((s, sc) => s + (sc ? (sc.h + sc.a) : 0), 0);
    jfAvg = sum / jiaoFenScores.length;
  }

  // 3. 综合期望线
  const compositeLine = (overAdjusted * 0.4 + (jfAvg || totalExpect) * 0.3 + totalExpect * 0.3);

  // 下限锁：基于综合期望线动态计算
  let lowerLock = Math.max(0, Math.floor(compositeLine) - 1);
  // 双方攻击力都弱 → 保底至少1球
  if (overRate < 0.3 && (vars.homeAttackEfficiency + vars.awayAttackEfficiency) < 0.5) {
    lowerLock = 1;
  }

  // 上限锁：综合期望线 + 缓冲
  let upperLock = Math.ceil(compositeLine) + 1;
  if (jfAvg > 0 && jfAvg < 2) {
    upperLock = Math.min(upperLock, 3); // 交锋低比分 → 上限限制
  }
  upperLock = Math.max(2, Math.min(6, upperLock));

  return {
    range: lowerLock + '-' + upperLock + '球',
    lower: lowerLock,
    upper: upperLock,
    compositeLine: round(compositeLine, 2),
    overRate: round(overRate * 100, 1),
    jfAvg: round(jfAvg, 2)
  };
}

// ==================== 4.5 主客近期进球期望（xG）====================

function calcExpectedGoals(vars, totalExpect, weights) {
  // 1. 还原底层攻防频次
  // 进攻次数 ≈ 场均进球 * 10 * 进攻效率系数
  const hAttacks = (vars.homeRecentGoalAvg || 1) * 10 * (1 + vars.homeAttackEfficiency);
  const hDefFaced = (vars.homeRecentLoseAvg || 1) * 10 * (1 + vars.homeDefendEfficiency);
  const aAttacks = (vars.awayRecentGoalAvg || 1) * 10 * (1 + vars.awayAttackEfficiency);
  const aDefFaced = (vars.awayRecentLoseAvg || 1) * 10 * (1 + vars.awayDefendEfficiency);

  // 2. 四维呼吸权重
  // 主队进攻 vs 客队防守 → 主队射门转化率
  const hConversion = (hAttacks / (aDefFaced + 1)) * 0.1; // 归一化
  const aConversion = (aAttacks / (hDefFaced + 1)) * 0.1;

  // 3. 终极进球期望
  const xgHome = round(totalExpect * weights.home * (1 + hConversion) / (1 + hConversion + aConversion), 2);
  const xgAway = round(totalExpect * weights.away * (1 + aConversion) / (1 + hConversion + aConversion), 2);

  return {
    xgHome: Math.max(0.1, xgHome),
    xgAway: Math.max(0.1, xgAway),
    hConversion: round(hConversion, F),
    aConversion: round(aConversion, F)
  };
}

// ==================== 主入口 ====================

function analyze(vars, totalAdvantagePct) {
  const weights = calcWeights(totalAdvantagePct);
  const fieldIntensity = calcFieldIntensity(vars);
  const totalExpect = calcTotalGoalExpect(fieldIntensity, weights);
  const goalRange = calcGoalRange(vars, totalExpect);
  const xg = calcExpectedGoals(vars, totalExpect, weights);

  return {
    // 主客权重
    homeWeight: round(weights.home * 100, 1) + '%',
    awayWeight: round(weights.away * 100, 1) + '%',
    // 得失球对比
    goalDiffHome: round(vars.homeRecentGoalAvg, 1) + '/' + round(vars.homeRecentLoseAvg, 1),
    goalDiffAway: round(vars.awayRecentGoalAvg, 1) + '/' + round(vars.awayRecentLoseAvg, 1),
    // 总进球期望
    totalGoalsExpect: totalExpect.toFixed(1),
    totalGoalsValue: Math.round(totalExpect / 6 * 100), // 0~6球映射到 0~100
    // 弹窗区间
    goalRange,
    // xG
    xgHome: xg.xgHome,
    xgAway: xg.xgAway,
    fieldIntensity,
    // 子维度
    _weights: weights,
    _xg: xg
  };
}

function round(v, n) {
  const m = Math.pow(10, n);
  return Math.round(v * m) / m;
}

module.exports = { analyze };

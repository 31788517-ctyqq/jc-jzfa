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
  const overRate = (vars.homeOverRate + vars.awayOverRate) / 2;
  // 综合期望线 λ_gene = 0.4×主大球率 + 0.4×客大球率 + 0.2×交锋大球率
  // 大球率放大到进球尺度
  const lambdaGene = 0.4 * overRate * 5 + 0.4 * overRate * 5 + 0.2 * overRate * 5; // 简化：用同一overRate
  // 实际复刻基因：最近两次交锋进球数均值
  const jiaoFenScores = vars.jiaoFenScores || [];
  let lambdaActual = totalExpect;
  if (jiaoFenScores.length > 0) {
    const sum = jiaoFenScores.reduce((s, sc) => s + (sc ? (sc.h + sc.a) : 0), 0);
    lambdaActual = sum / jiaoFenScores.length;
  }

  const compositeLine = lambdaGene * 0.4 + lambdaActual * 0.3 + totalExpect * 0.3;

  let lowerLock = Math.max(0, Math.floor(compositeLine) - 1);
  let upperLock = Math.ceil(compositeLine) + 1;

  // 下限锁
  if (lambdaGene < 1.8 && lambdaActual < 1.5) {
    upperLock = Math.min(upperLock, 2);
  }
  // 上限锁
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
    overRate: round(overRate * 100, 1),
    lambdaGene: round(lambdaGene, 2),
    lambdaActual: round(lambdaActual, 2)
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

  // 还原底层攻防次数
  const atkH = gh / eh;
  const shotAgainstH = lh / dh;
  const atkA = ga / ea;
  const shotAgainstA = la / da;

  // 四维呼吸权重
  const beta1 = atkH / (atkH + shotAgainstA + 0.1);
  const beta2 = atkA / (atkA + shotAgainstH + 0.1);

  const hfGoal = vars.homeFieldGoalAvg || vars.homeRecentGoalAvg || 1;
  const hfLose = vars.homeFieldLoseAvg || vars.homeRecentLoseAvg || 1;
  const afGoal = vars.awayFieldGoalAvg || vars.awayRecentGoalAvg || 1;
  const afLose = vars.awayFieldLoseAvg || vars.awayRecentLoseAvg || 1;

  const beta3 = (hfGoal - hfLose) / (hfGoal + hfLose + 1);
  const beta4 = (afGoal - afLose) / (afGoal + afLose + 1);

  // 终极进球期望
  const xgHome = round(beta1 * atkH + beta3 * hfGoal, 2);
  const xgAway = round(beta2 * atkA + beta4 * afGoal, 2);

  // 缩放到总期望
  const totalXg = xgHome + xgAway;
  if (totalXg > 0.01) {
    const scale = totalExpect / totalXg;
    return {
      xgHome: round(Math.max(0.1, xgHome * scale), 2),
      xgAway: round(Math.max(0.1, xgAway * scale), 2),
      hConversion: round(beta1, F),
      aConversion: round(beta2, F)
    };
  }

  return {
    xgHome: round(totalExpect * weights.home, 2),
    xgAway: round(totalExpect * weights.away, 2),
    hConversion: 0,
    aConversion: 0
  };
}

// ==================== 主入口 ====================

function analyze(vars, S) {
  const weights = calcWeights(S);
  const intensity = calcFieldIntensity(vars);
  const totalExpect = calcTotalGoalExpect(intensity, weights);
  const goalRange = calcGoalRange(vars, totalExpect);
  const xg = calcExpectedGoals(vars, totalExpect, weights);

  const hGoal = vars.homeRecentGoalAvg || 1;
  const hLose = vars.homeRecentLoseAvg || 1;
  const aGoal = vars.awayRecentGoalAvg || 1;
  const aLose = vars.awayRecentLoseAvg || 1;

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
    // xG
    xgHome: xg.xgHome,
    xgAway: xg.xgAway,
    fieldIntensity: intensity.total,
    // 子维度
    _weights: weights,
    _xg: xg
  };
}

module.exports = { analyze };

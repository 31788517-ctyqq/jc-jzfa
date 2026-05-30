/**
 * 第六阶段：阵之第三维 · 比分矩阵合围与八阵裂变算法
 *
 * 核心防幻觉防线：任何比分格子必须同时穿过三把物理锁
 * 算法：
 *   1. 泊松联合概率 P(h,a) = Poisson(h|λh) × Poisson(a|λa)
 *   2. 三重物理锁软化（Sigmoid 连续衰减，替代硬截断）
 *   3. 十字对冲历史场次修正
 *   4. 实力防御锁提振
 *   5. 归一化排序，TOP8 输出
 */
const F = 4;

// ==================== Sigmoid 软化函数 ====================

/**
 * 用连续衰减替代硬截断
 * @param {number} x 当前值
 * @param {number} threshold 阈值
 * @param {number} slope 斜率（越大越陡峭）
 * @returns {number} 0.3~1.0 的惩罚因子
 */
function softThreshold(x, threshold, slope) {
  slope = slope || 10;
  const s = 1 / (1 + Math.exp(-slope * (x - threshold)));
  return 0.3 + 0.7 * s; // 范围 [0.3, 1.0]
}

// ==================== 泊松概率计算 ====================

// 预计算 log(k!) 查找表（0-20）
const logFactorialCache = (() => {
  const arr = [0]; // log(0!) = 0
  for (let i = 1; i <= 25; i++) {
    arr[i] = arr[i - 1] + Math.log(i);
  }
  return arr;
})();

/**
 * 泊松分布概率 P(X=k | λ)
 * 使用对数空间避免溢出
 */
function poissonProb(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k > 20) return 0; // 超过20球概率几乎为0
  const logP = k * Math.log(lambda) - lambda - logFactorialCache[k] || 0;
  return Math.exp(logP);
}

// ==================== Dixon-Coles 低比分修正 ====================

/**
 * Dixon-Coles 修正因子 τ(h, a)
 * 修正独立泊松假设在低比分区域（0:0, 1:0, 0:1, 1:1）的偏差。
 * 足球比赛中这些比分的实际频率与独立泊松预测有系统性差异。
 * 
 * 参考: Dixon & Coles (1997) "Modelling Association Football Scores"
 * 
 * @param {number} h 主队进球
 * @param {number} a 客队进球
 * @param {number} lambdaH 主队 xG
 * @param {number} lambdaA 客队 xG
 * @param {number} rho 依赖参数 ρ（默认 -0.05，典型足球取值范围 [-0.1, 0]）
 * @returns {number} τ 修正因子 0.85~1.15
 */
function dixonColesCorrection(h, a, lambdaH, lambdaA, rho) {
  rho = rho || -0.05;

  if (h === 0 && a === 0) {
    return 1 - lambdaH * lambdaA * rho;
  }
  if (h === 1 && a === 0) {
    return 1 + lambdaH * rho;
  }
  if (h === 0 && a === 1) {
    return 1 + lambdaA * rho;
  }
  if (h === 1 && a === 1) {
    return 1 - rho;
  }
  return 1.0; // 其他比分不作修正
}

/**
 * 条件概率补偿：一方大比分领先后，另一方进球概率变化
 * 模拟比赛中的"反扑效应"和"垃圾时间"效应
 * 
 * @param {number} ownGoals 已方进球数
 * @param {number} oppGoals 对方进球数
 * @param {number} oppLambda 对方 xG
 * @returns {number} 对方 λ 调整系数
 */
function conditionalGoalAdjust(ownGoals, oppGoals, oppLambda) {
  // 落后 2 球以上 → 反扑效应：对方进攻增强 15%
  if (ownGoals >= oppGoals + 2) {
    return 1.15;
  }
  // 落后 1 球 → 反扑效应 8%
  if (ownGoals >= oppGoals + 1) {
    return 1.08;
  }
  // 领先 3+ 球 → 垃圾时间，双方都可能松懈
  if (oppGoals >= ownGoals + 3) {
    return 0.85;
  }
  return 1.0;
}

// ==================== 三重物理锁（软化版） ====================

/**
 * 锁一：总进球范围锁（保留硬过滤 — 超出区间几乎不可能）
 */
function totalGoalsLock(h, a, goalRange) {
  const total = h + a;
  return total >= goalRange.lower && total <= goalRange.upper;
}

/**
 * 锁二：主客单队进球范围锁 — 软化版
 * 用 Sigmoid 连续衰减替代硬截断，避免阈值边缘"一刀切"
 * 
 * 强力破甲 (Pen ≥ 1.2): 单队下限 1球（penalty 从 0.3→1.0 渐变）
 * 防线哑火 (Pen ≤ 0.7): 单队上限 1球（penalty 从 1.0→0.3 渐变）
 * 
 * @returns {number} penalty 因子 0.3~1.0
 */
function singleTeamPenalty(h, a, vars) {
  const gh = vars.homeRecentGoalAvg || 1;
  const ga = vars.awayRecentGoalAvg || 1;
  const lh = vars.homeRecentLoseAvg || 1;
  const la = vars.awayRecentLoseAvg || 1;
  const eh = (vars.homeAttackEfficiency || 0) + 0.001;
  const ea = (vars.awayAttackEfficiency || 0) + 0.001;
  const dh = (vars.homeDefendEfficiency || 0) + 0.001;
  const da = (vars.awayDefendEfficiency || 0) + 0.001;

  // 还原攻防次数
  const atkH = gh / eh;
  const atkA = ga / ea;
  const shotAgainstH = lh / dh;
  const shotAgainstA = la / da;

  // 破甲系数
  const penH = atkH / (shotAgainstA + 0.5);
  const penA = atkA / (shotAgainstH + 0.5);

  let penalty = 1.0;

  // 主队 — 强力破甲：penH ≥ 1.2 时 h=0 应受惩罚
  if (penH >= 1.2) {
    // sigmoid: h=0→大惩罚, h=1→边界, h≥2→正常
    penalty *= softThreshold(h, 0.5, 5); // h=0→0.32, h=1→0.92, h=2→0.999
  } else if (penH <= 0.7) {
    // 防线哑火：h≥2 应受惩罚
    penalty *= 1 - 0.7 * (1 / (1 + Math.exp(-8 * (1.5 - h)))); // h=0,1→~1.0, h=2→0.48, h=3→0.30
  } else {
    // 常规区间：h>3 应受轻微惩罚
    penalty *= h <= 3 ? 1.0 : softThreshold(7 - h, 3, 2);
  }

  // 客队 — 同逻辑
  if (penA >= 1.2) {
    penalty *= softThreshold(a, 0.5, 5);
  } else if (penA <= 0.7) {
    penalty *= 1 - 0.7 * (1 / (1 + Math.exp(-8 * (1.5 - a))));
  } else {
    penalty *= a <= 3 ? 1.0 : softThreshold(7 - a, 3, 2);
  }

  return Math.max(0.2, Math.min(1.0, penalty));
}

/**
 * [旧版保留] 锁二硬截断（仅用于 generateValidCells 的粗筛）
 * @deprecated 精准打分阶段已改用 singleTeamPenalty
 */
function singleTeamLock(h, a, vars) {
  const gh = vars.homeRecentGoalAvg || 1;
  const ga = vars.awayRecentGoalAvg || 1;
  const lh = vars.homeRecentLoseAvg || 1;
  const la = vars.awayRecentLoseAvg || 1;
  const eh = (vars.homeAttackEfficiency || 0) + 0.001;
  const ea = (vars.awayAttackEfficiency || 0) + 0.001;
  const dh = (vars.homeDefendEfficiency || 0) + 0.001;
  const da = (vars.awayDefendEfficiency || 0) + 0.001;

  const atkH = gh / eh;
  const atkA = ga / ea;
  const shotAgainstH = lh / dh;
  const shotAgainstA = la / da;

  const penH = atkH / (shotAgainstA + 0.5);
  const penA = atkA / (shotAgainstH + 0.5);

  // 放宽硬过滤：仅在极端情况下过滤
  if (penH >= 2.0 && h === 0) return false;  // 极度破甲才硬过滤
  if (penH <= 0.3 && h >= 3) return false;   // 极度哑火才硬过滤
  if (h > 6) return false;  // 单队6+球几乎不可能

  if (penA >= 2.0 && a === 0) return false;
  if (penA <= 0.3 && a >= 3) return false;
  if (a > 6) return false;

  return true;
}

/**
 * 锁三：净胜球分布锁 — 软化版
 * 用 sigmoid 衰减替代硬边界
 * 
 * @returns {number} penalty 因子 0.35~1.0
 */
function goalDiffPenalty(h, a, ladderLevel) {
  const gd = h - a;
  const absLv = Math.abs(ladderLevel);

  if (absLv >= 3) {
    // 👑 极端优势
    if (ladderLevel > 0) {
      return softThreshold(gd, 0.5, 3);  // 净胜≥1时较高, 平局和输球惩罚
    } else {
      return softThreshold(-gd, 0.5, 3);
    }
  }

  if (absLv >= 2) {
    // ⚔ 中等优势
    if (ladderLevel > 0) {
      return softThreshold(gd, -0.5, 3); // 平局轻微惩罚, 输球较重惩罚
    } else {
      return softThreshold(-gd, -0.5, 3);
    }
  }

  if (absLv >= 1) {
    // 🔍 微弱优势 — 宽容区间
    if (ladderLevel > 0) {
      return softThreshold(gd + 1, 0.5, 2); // gd≥-1 基本无惩罚
    } else {
      return softThreshold(-gd + 1, 0.5, 2);
    }
  }

  // ⚖️ 均衡 — 宽区间，极端净胜球轻微惩罚
  if (Math.abs(gd) <= 2) return 1.0;
  return softThreshold(5 - Math.abs(gd), 2, 2);

  return 1.0;
}

/**
 * [旧版保留] 锁三硬截断（仅用于 generateValidCells 粗筛）
 * @deprecated 精准打分阶段已改用 goalDiffPenalty
 */
function goalDiffLock(h, a, ladderLevel) {
  const gd = h - a;
  // 放宽硬过滤边界
  if (Math.abs(ladderLevel) >= 3) return Math.abs(gd) >= -1; // 极端优势允许平局
  if (Math.abs(ladderLevel) >= 2) return Math.abs(gd) >= -2; // 中等优势允许小负
  return Math.abs(gd) <= 3; // 均衡允许 3 球差
}

// ==================== 十字对冲历史修正 ====================

/**
 * 2D 联合分布历史修正（升级版）
 * 
 * 相比旧版的独立维度加成，新增：
 *   1. (h,a) 联合频次加权：同时考虑主客进球数的联合分布
 *   2. jiaoFenExtended 扩展交锋统计：从 jiaoFenDesc 提取的更多字段
 *   3. 非线性频次密度映射：出现多次的比分得到更强提振
 * 
 * @returns {number} 修正因子 0.8~2.5
 */
function historyCorrection(h, a, vars) {
  let boost = 1.0;

  // ── 第一层：独立维度分布匹配（保留旧版逻辑）──
  // 主队进球分布匹配
  if (h === 0) boost *= (1 + vars.homeGoal0 * 0.05);
  else if (h === 1) boost *= (1 + vars.homeGoal1 * 0.05);
  else if (h >= 2) boost *= (1 + vars.homeGoal2Plus * 0.05);

  // 客队进球分布匹配
  if (a === 0) boost *= (1 + vars.awayGoal0 * 0.03);
  else if (a === 1) boost *= (1 + vars.awayGoal1 * 0.03);
  else if (a >= 2) boost *= (1 + vars.awayGoal2Plus * 0.03);

  // ── 第二层：2D 联合分布 — 交锋历史精确匹配 ──
  const jfScores = vars.jiaoFenScores || [];
  const matchCount = jfScores.filter(s => s && s.h === h && s.a === a).length;
  if (matchCount >= 2) {
    // 历史交锋中出现 2+ 次 → 强提振
    boost *= 1 + matchCount * 0.15; // 2次→1.3, 3次→1.45
  } else if (matchCount === 1) {
    boost *= 1.15; // 出现过1次 → 轻微提振（旧版是1.2）
  }

  // ── 第三层：jiaoFenExtended 扩展统计 ──
  const jfExt = vars.jiaoFenExtended;
  if (jfExt && jfExt.parsed) {
    // 总进球数接近历史交锋均值 → 微幅提振
    if (jfExt.goalsFor + jfExt.goalsAgainst > 0) {
      const h2hAvg = (jfExt.goalsFor + jfExt.goalsAgainst) / Math.max(1, jfExt.totalMatches);
      const actualTotal = h + a;
      // 如果比分总进球接近交锋均值，略微提振
      const distFromAvg = Math.abs(actualTotal - h2hAvg);
      if (distFromAvg <= 0.5) {
        boost *= 1.08;
      } else if (distFromAvg <= 1.0) {
        boost *= 1.04;
      }
    }

    // 历史交锋中大球率高 → 适当提振高进球比分
    if (jfExt.totalMatches > 0 && jfExt.overCount > 0) {
      const h2hOverRate = jfExt.overCount / jfExt.totalMatches;
      if (h2hOverRate >= 0.5 && (h + a) >= 3) {
        boost *= 1 + h2hOverRate * 0.1; // 交锋大球率≥50%时提振大比分
      }
    }
  }

  return Math.min(boost, 2.5);
}

// ==================== 实力防御锁 ====================

function powerBoost(h, a, ladderLevel) {
  const gd = h - a;
  const homeStrength = ladderLevel > 0;

  // 顺应战力的比分提振
  if (Math.abs(ladderLevel) >= 3) {
    // 极端优势：净胜2+球提振1.5倍
    if (homeStrength && gd >= 2) return 1.5;
    if (!homeStrength && gd <= -2) return 1.5;
  }

  if (Math.abs(ladderLevel) >= 2) {
    if (homeStrength && gd >= 1) return 1.2;
    if (!homeStrength && gd <= -1) return 1.2;
  }

  // 冷门削弱
  if (homeStrength && ladderLevel >= 2 && gd < 0) return 0.5;
  if (!homeStrength && ladderLevel <= -2 && gd > 0) return 0.5;

  return 1.0;
}

// ==================== 格点生成 ====================

/**
 * 生成合法的比分格点（经过三重锁）
 */
function generateValidCells(xgHome, xgAway, vars, goalRange, ladderLevel) {
  const cells = [];

  // 球数上限：取 goalRange.upper 和合理性上限的较小值
  const maxGoals = Math.min(goalRange.upper + 1, 8);

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      // 🔒 锁一
      if (!totalGoalsLock(h, a, goalRange)) continue;
      // 🔒 锁二
      if (!singleTeamLock(h, a, vars)) continue;
      // 🔒 锁三
      if (!goalDiffLock(h, a, ladderLevel)) continue;

      cells.push({ h, a });
    }
  }
  return cells;
}

// ==================== 主入口 ====================

/**
 * 从 match-level 赔率提取市场隐含的胜平负方向概率
 * @returns {{ home: number, draw: number, away: number, overround: number }}
 */
function marketDirection(vars) {
  const hAward = vars.homeWinAward || 0;
  const dAward = vars.drawAward || 0;
  const aAward = vars.awayWinAward || 0;
  if (hAward <= 1 || dAward <= 1 || aAward <= 1) {
    // 赔率无效 → 不校准
    return { home: 1/3, draw: 1/3, away: 1/3, valid: false };
  }
  const rawH = 1 / hAward;
  const rawD = 1 / dAward;
  const rawA = 1 / aAward;
  const total = rawH + rawD + rawA;
  return {
    home: round(rawH / total, 4),
    draw: round(rawD / total, 4),
    away: round(rawA / total, 4),
    valid: true,
    overround: round(total - 1, 4)
  };
}

/**
 * 市场赔率贝叶斯校准
 * 对每个比分格点，按其结果方向（主胜/平/客胜）用市场隐含概率做加权融合
 * 
 * @param {number} h 主队进球
 * @param {number} a 客队进球
 * @param {Object} marketDir marketDirection() 的输出
 * @param {number} alpha 融合强度 0~1，默认 0.25（25%市场 + 75%模型）
 * @returns {number} 校准因子 0.85~1.25
 */
function marketCalibration(h, a, marketDir, alpha) {
  if (!marketDir.valid) return 1.0;
  alpha = alpha || 0.25;

  // 确定比分的结果方向
  let resultProb;
  if (h > a)      resultProb = marketDir.home;  // 主胜
  else if (h < a) resultProb = marketDir.away;   // 客胜
  else            resultProb = marketDir.draw;   // 平局

  // 均匀先验 = 1/3，偏离越大概率调整越大
  const deviation = resultProb / (1/3);
  // 用 alpha 控制向市场靠拢的程度
  return round(1 + alpha * (deviation - 1), 4);
}

function analyze(vars, xgHome, xgAway, goalRange, ladderLevel) {
  // 0. 市场赔率校准因子（全局）
  const marketDir = marketDirection(vars);
  // 1. 生成合法格点（粗筛阶段用放宽后的硬过滤）
  const cells = generateValidCells(xgHome, xgAway, vars, goalRange, ladderLevel);

  // 2. 计算泊松联合概率 + 软锁修正 + 历史修正 + 实力修正
  const scored = [];
  for (const { h, a } of cells) {
    const pPoisson = poissonProb(h, xgHome) * poissonProb(a, xgAway);
    const pDixonColes = dixonColesCorrection(h, a, xgHome, xgAway);  // DC低比分修正
    const pCondH = conditionalGoalAdjust(h, a, xgAway);  // 主队反扑效应
    const pCondA = conditionalGoalAdjust(a, h, xgHome);  // 客队反扑效应
    const pConditional = pCondH * pCondA;
    const pLock2 = singleTeamPenalty(h, a, vars);        // 🔒 锁二软化
    const pLock3 = goalDiffPenalty(h, a, ladderLevel);    // 🔒 锁三软化
    const pHistory = historyCorrection(h, a, vars);
    const pPower = powerBoost(h, a, ladderLevel);
    const pMarket = marketCalibration(h, a, marketDir, 0.25); // 📊 市场赔率校准（25%权重）
    const pFinal = pPoisson * pDixonColes * pConditional * pHistory * pPower * pLock2 * pLock3 * pMarket;
    scored.push({ score: h + '-' + a, h, a, pmf: pFinal,
      _raw: { poisson: round(pPoisson, 6), dc: round(pDixonColes, 4), cond: round(pConditional, 3),
              lock2: round(pLock2, 3), lock3: round(pLock3, 3),
              history: round(pHistory, 3), power: round(pPower, 3), market: round(pMarket, 3) }
    });
  }

  // 3. 归一化
  const totalP = scored.reduce((s, c) => s + c.pmf, 0);
  if (totalP > 0) {
    scored.forEach(c => { c.percent = round(c.pmf / totalP * 100, 1); });
  } else {
    scored.forEach(c => { c.percent = 0; });
  }

  // 4. 降序排序，取 TOP8
  scored.sort((a, b) => b.percent - a.percent);
  const top = scored.slice(0, 8);

  // 格式化输出
  return top.map(c => ({
    score: c.score,
    percent: c.percent.toFixed(1) + '%'
  }));
}

function round(v, n) {
  const m = Math.pow(10, n);
  return Math.round(v * m) / m;
}

module.exports = { analyze };

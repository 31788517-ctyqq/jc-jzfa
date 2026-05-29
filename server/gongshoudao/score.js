/**
 * 第六阶段：阵之第三维 · 比分矩阵合围与八阵裂变算法
 *
 * 核心防幻觉防线：任何比分格子必须同时穿过三把物理锁
 * 算法：
 *   1. 泊松联合概率 P(h,a) = Poisson(h|λh) × Poisson(a|λa)
 *   2. 三重物理锁过滤
 *   3. 十字对冲历史场次修正
 *   4. 实力防御锁提振
 *   5. 归一化排序，TOP8 输出
 */
const F = 4;

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

// ==================== 三重物理锁 ====================

/**
 * 锁一：总进球范围锁
 */
function totalGoalsLock(h, a, goalRange) {
  const total = h + a;
  return total >= goalRange.lower && total <= goalRange.upper;
}

/**
 * 锁二：主客单队进球范围锁（双向破甲硬截断）
 * Pen_h = Atk_h / (ShotAgainst_a + 0.5)
 * Pen_a = Atk_a / (ShotAgainst_h + 0.5)
 * 
 * 强力破甲 (Pen ≥ 1.2): 单队下限 1球
 * 防线哑火 (Pen ≤ 0.7): 单队上限 1球
 * 常规均衡 (0.7 < Pen < 1.2): [0, 3] 区间
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

  // 还原攻防次数
  const atkH = gh / eh;
  const atkA = ga / ea;
  const shotAgainstH = lh / dh;
  const shotAgainstA = la / da;

  // 破甲系数
  const penH = atkH / (shotAgainstA + 0.5);
  const penA = atkA / (shotAgainstH + 0.5);

  // 主队限制
  if (penH >= 1.2 && h < 1) return false;
  if (penH <= 0.7 && h > 1) return false;
  if (penH > 0.7 && penH < 1.2 && h > 3) return false;

  // 客队限制
  if (penA >= 1.2 && a < 1) return false;
  if (penA <= 0.7 && a > 1) return false;
  if (penA > 0.7 && penA < 1.2 && a > 3) return false;

  return true;
}

/**
 * 锁三：净胜球分布锁（实力阶梯映射）
 */
function goalDiffLock(h, a, ladderLevel) {
  const gd = h - a;
  switch (ladderLevel) {
    case 3:  return gd >= 1;   // 👑 主队绝对大优势：必须净胜≥1
    case 2:  return gd >= 0;   // ⚔ 主队中等优势：不能输
    case 1:  return gd >= -1;  // 🔍 主队微弱优势
    case 0:  return Math.abs(gd) <= 1; // ⚖️ 均衡：最多1球差
    case -1: return gd <= 1;   // 客队微弱（等贵反转）
    case -2: return gd <= 0;   // 客队中等
    case -3: return gd <= -1;  // 客队绝对
    default: return Math.abs(gd) <= 2;
  }
}

// ==================== 十字对冲历史修正 ====================

/**
 * 基于历史进球分布修正概率
 * 如果历史上经常出现该比分，略微提振
 */
function historyCorrection(h, a, vars) {
  let boost = 1.0;

  // 主队进球分布匹配
  if (h === 0) boost *= (1 + vars.homeGoal0 * 0.05);
  else if (h === 1) boost *= (1 + vars.homeGoal1 * 0.05);
  else if (h >= 2) boost *= (1 + vars.homeGoal2Plus * 0.05);

  // 客队进球分布匹配
  if (a === 0) boost *= (1 + vars.awayGoal0 * 0.03);
  else if (a === 1) boost *= (1 + vars.awayGoal1 * 0.03);
  else if (a >= 2) boost *= (1 + vars.awayGoal2Plus * 0.03);

  // 交锋历史匹配
  const jfScores = vars.jiaoFenScores || [];
  for (const s of jfScores) {
    if (s && s.h === h && s.a === a) {
      boost *= 1.2; // 出现过该比分 → 提振
      break;
    }
  }

  return Math.min(boost, 2.0);
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

function analyze(vars, xgHome, xgAway, goalRange, ladderLevel) {
  // 1. 生成合法格点
  const cells = generateValidCells(xgHome, xgAway, vars, goalRange, ladderLevel);

  // 2. 计算泊松联合概率 + 修正
  const scored = [];
  for (const { h, a } of cells) {
    const pPoisson = poissonProb(h, xgHome) * poissonProb(a, xgAway);
    const pHistory = historyCorrection(h, a, vars);
    const pPower = powerBoost(h, a, ladderLevel);
    const pFinal = pPoisson * pHistory * pPower;
    scored.push({ score: h + '-' + a, h, a, pmf: pFinal });
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

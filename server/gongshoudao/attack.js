/**
 * 第二+第三阶段：实力分析引擎
 *
 * 计算：
 *   进攻相对优势度 Adv_off（3个子维度合成）
 *   防守相对优势度 Adv_def（3个子维度合成）
 *   综合攻守优势 Adv_total（权重切分+格局划分）
 *   实力阶梯标签 + 边界锁
 *
 * 所有百分比保留1位小数，浮点运算保留4位
 */
const F = 4; // 浮点精度

// ==================== 第二维度 2.1：进攻优势 ====================

/**
 * 子维度一：赢球格局得分对冲
 * 基于赢球差分布的加权得分对比
 */
function winGapScore(vars) {
  // 主队赢球得分：赢2+球得2分，赢1球得1分
  const hScore = vars.homeWinGap_2 * 2 + vars.homeWinGap_1 * 1;
  // 客队赢球得分
  const aScore = vars.awayWinGap_2 * 2 + vars.awayWinGap_1 * 1;

  const total = hScore + aScore;
  if (total === 0) return { hPct: 50, aPct: 50, advantage: 0 };

  const hPct = round((hScore / total) * 100, 1);
  const aPct = round((aScore / total) * 100, 1);
  const advantage = round(hPct - 50, F);

  return { hPct, aPct, advantage, label: '赢球格局' };
}

/**
 * 子维度二：攻击力纯能效对冲
 * 对比攻防效率差
 */
function attackEfficiencyScore(vars) {
  // 主队进攻效率 vs 客队防守效率
  const hEff = vars.homeAttackEfficiency;
  const aDefEff = vars.awayDefendEfficiency;
  // 客队进攻效率 vs 主队防守效率
  const aEff = vars.awayAttackEfficiency;
  const hDefEff = vars.homeDefendEfficiency;

  // 主队破防能力 = 主攻效率 - 客防守效率（正值=主队能攻破客队防线）
  const hPenetrate = Math.max(0, hEff - aDefEff);
  // 客队破防能力
  const aPenetrate = Math.max(0, aEff - hDefEff);

  const total = hPenetrate + aPenetrate;
  if (total < 0.001) return { hPct: 50, aPct: 50, advantage: 0 };

  const hPct = round((hPenetrate / total) * 100, 1);
  const aPct = round((aPenetrate / total) * 100, 1);
  const advantage = round(hPct - 50, F);

  return { hPct, aPct, advantage, label: '攻击能效' };
}

/**
 * 子维度三：进球厚度分布对冲
 * 基于进球分布（0/1/2+球）的得分能力对比
 */
function goalDistributionScore(vars) {
  // 加权利润率：进2+球得2分、进1球得1分、进0球得0分
  const hScore = vars.homeGoal2Plus * 2 + vars.homeGoal1 * 1;
  const aScore = vars.awayGoal2Plus * 2 + vars.awayGoal1 * 1;

  // 同时考虑近期场均进球
  const hAvgGoal = vars.homeRecentGoalAvg || 1;
  const aAvgGoal = vars.awayRecentGoalAvg || 1;

  // 综合得分（50%历史分布 + 50%近期场均）
  const hComposite = hScore + hAvgGoal * 5;  // 5场放大到10场尺度
  const aComposite = aScore + aAvgGoal * 5;

  const total = hComposite + aComposite;
  if (total === 0) return { hPct: 50, aPct: 50, advantage: 0 };

  const hPct = round((hComposite / total) * 100, 1);
  const aPct = round((aComposite / total) * 100, 1);
  const advantage = round(hPct - 50, F);

  return { hPct, aPct, advantage, label: '进球厚度' };
}

// ==================== 合成进攻优势 ====================

function calcAttackAdvantage(vars) {
  const gap = winGapScore(vars);
  const eff = attackEfficiencyScore(vars);
  const dist = goalDistributionScore(vars);

  // 权重：赢球格局 35%、攻击能效 30%、进球厚度 35%
  const weights = { gap: 0.35, eff: 0.30, dist: 0.35 };
  const compositeAdv = round(
    gap.advantage * weights.gap +
    eff.advantage * weights.eff +
    dist.advantage * weights.dist,
    F
  );

  return {
    composite: compositeAdv,
    subDimensions: { gap, eff, dist },
    display: round(50 + compositeAdv, 1)
  };
}

// ==================== 第二维度 2.2：防守优势 ====================

/**
 * 子维度一：输球空间与容错对冲
 * 基于输球差分布
 */
function loseGapScore(vars) {
  // 主队输球风险分（加权：输2+球得-2分，输1球得-1分，越低越好）
  const hLoseScore = vars.homeLoseGap_2 * 2 + vars.homeLoseGap_1 * 1;
  const aLoseScore = vars.awayLoseGap_2 * 2 + vars.awayLoseGap_1 * 1;

  // 防守得分 = 总分(20) - 输球风险分（理想情况是0输球分→满分20）
  const maxRisk = 20; // 10场*2分
  const hDefScore = maxRisk - hLoseScore;
  const aDefScore = maxRisk - aLoseScore;

  const total = hDefScore + aDefScore;
  if (total === 0) return { hPct: 50, aPct: 50, advantage: 0 };

  const hPct = round((hDefScore / total) * 100, 1);
  const aPct = round((aDefScore / total) * 100, 1);
  const advantage = round(hPct - 50, F);

  return { hPct, aPct, advantage, label: '输球容错' };
}

/**
 * 子维度二：防御纯能效对冲
 */
function defenseEfficiencyScore(vars) {
  // 防守能力 = 对方进攻效率 - 已方防守效率的对比
  // 主队防守：面对客队进攻时
  const hDefAbility = vars.homeDefendEfficiency;
  const aDefAbility = vars.awayDefendEfficiency;

  // 低防守效率 = 更好的防守（失球少）
  // 防守得分逆向：差值越小防线越稳
  const hScore = Math.max(0, 1 - hDefAbility);  // 效率越低越好
  const aScore = Math.max(0, 1 - aDefAbility);

  const total = hScore + aScore;
  if (total < 0.001) return { hPct: 50, aPct: 50, advantage: 0 };

  const hPct = round((hScore / total) * 100, 1);
  const aPct = round((aScore / total) * 100, 1);
  const advantage = round(hPct - 50, F);

  return { hPct, aPct, advantage, label: '防御能效' };
}

/**
 * 子维度三：失球厚度与零封率对冲
 */
function concedeDistributionScore(vars) {
  // 失0球得2分、失1球得1分、失2+球得0分
  const hDefScore = vars.homeLose0 * 2 + vars.homeLose1 * 1;
  const aDefScore = vars.awayLose0 * 2 + vars.awayLose1 * 1;

  const total = hDefScore + aDefScore;
  if (total === 0) return { hPct: 50, aPct: 50, advantage: 0 };

  const hPct = round((hDefScore / total) * 100, 1);
  const aPct = round((aDefScore / total) * 100, 1);
  const advantage = round(hPct - 50, F);

  return { hPct, aPct, advantage, label: '零封能力' };
}

// ==================== 合成防守优势 ====================

function calcDefenseAdvantage(vars) {
  const gap = loseGapScore(vars);
  const eff = defenseEfficiencyScore(vars);
  const dist = concedeDistributionScore(vars);

  // 权重：输球容错 35%、防御能效 30%、零封能力 35%
  const weights = { gap: 0.35, eff: 0.30, dist: 0.35 };
  const compositeAdv = round(
    gap.advantage * weights.gap +
    eff.advantage * weights.eff +
    dist.advantage * weights.dist,
    F
  );

  return {
    composite: compositeAdv,
    subDimensions: { gap, eff, dist },
    display: round(50 + compositeAdv, 1)
  };
}

// ==================== 第二维度 2.3：格局划分与综合攻守优势 ====================

/**
 * 权重切分：根据攻防相对态势自动分配权重
 */
function calcWeights(attResult, defResult) {
  const attStrength = Math.abs(attResult.composite);
  const defStrength = Math.abs(defResult.composite);

  const total = attStrength + defStrength;
  if (total < 0.001) return { attack: 0.5, defense: 0.5 };

  // 哪一方更强就给它更多权重
  const attWeight = round(attStrength / total, F);
  const defWeight = round(defStrength / total, F);

  return { attack: attWeight, defense: defWeight };
}

/**
 * 格局状态机：判定攻守格局
 */
function calcPattern(attResult, defResult) {
  const attAdv = attResult.composite;
  const defAdv = defResult.composite;

  // 双方进攻和防守都强 → 对攻为主
  // 双方进攻弱但防守强 → 防守为主
  // 其余 → 攻守平衡
  const attRatio = attAdv / (Math.abs(defAdv) + 0.001);

  if (attAdv > 3 && attRatio > 1.5) return '对攻为主';
  if (defAdv > 3 && attRatio < 0.5) return '防守为主';
  return '攻守平衡';
}

// ==================== 第三阶段：实力阶梯映射 ====================

/**
 * 7档实力阶梯判定
 */
const STRENGTH_LADDERS = [
  { min: 15, label: '👑 主队绝对大优势', level: 3, key: 'home_big' },
  { min: 5,  label: '⚔️ 主队中等优势', level: 2, key: 'home_mid' },
  { min: 1,  label: '🔍 主队微弱优势', level: 1, key: 'home_sml' },
  { min: -1, label: '⚖️ 双方实力接近', level: 0, key: 'balance' },
  { min: -5, label: '🔍 客队微弱优势', level: -1, key: 'away_sml' },
  { min: -15,label: '⚔️ 客队中等优势', level: -2, key: 'away_mid' },
  { min: -Infinity, label: '👑 客队绝对大优势', level: -3, key: 'away_big' }
];

function calcStrengthLadder(totalAdvantagePct) {
  for (const ladder of STRENGTH_LADDERS) {
    if (totalAdvantagePct >= ladder.min) {
      return {
        label: ladder.label,
        level: ladder.level,
        boundLock: calcBoundLock(ladder.level),
        key: ladder.key
      };
    }
  }
  return { label: '⚖️ 双方实力接近', level: 0, boundLock: 0, key: 'balance' };
}

function calcBoundLock(level) {
  const absLevel = Math.abs(level);
  if (absLevel >= 3) return 1.5;   // 极端提振/削弱
  if (absLevel >= 2) return 1.2;   // 中等提振
  if (absLevel >= 1) return 0.7;   // 微弱调整(冷门格子折扣)
  return 0;                        // 均衡无调整
}

// ==================== 工具函数 ====================

function round(v, n) {
  const m = Math.pow(10, n);
  return Math.round(v * m) / m;
}

// ==================== 主入口 ====================

/**
 * 执行完整的实力分析
 * @param {Object} vars 解析后的标准变量
 * @returns {Object} 实力分析结果
 */
function analyze(vars) {
  // 1. 进攻优势
  const attackResult = calcAttackAdvantage(vars);

  // 2. 防守优势
  const defenseResult = calcDefenseAdvantage(vars);

  // 3. 权重切分
  const weights = calcWeights(attackResult, defenseResult);

  // 4. 格局
  const pattern = calcPattern(attackResult, defenseResult);

  // 5. 综合攻守优势（加权合成）
  const totalComputed = round(
    attackResult.composite * weights.attack +
    defenseResult.composite * weights.defense,
    F
  );
  const totalDisplay = round(50 + totalComputed, 1);

  // 6. 实力阶梯
  const ladder = calcStrengthLadder(totalDisplay - 50);

  // 7. 胜平负交叉分布（基于历史10场）
  const cross = calcCrossDistribution(vars);

  return {
    // 进攻
    attackAdvantage: totalDisplay > 50 ? '+' + (totalDisplay - 50).toFixed(1) + '%' : (totalDisplay - 50).toFixed(1) + '%',
    attackAdvantageValue: Math.round(totalDisplay),
    // 防守
    defenseAdvantage: defenseResult.composite > 0 ? '+' + defenseResult.composite.toFixed(1) + '%' : defenseResult.composite.toFixed(1) + '%',
    defenseAdvantageValue: Math.round(50 + defenseResult.composite),
    // 格局
    attackPattern: pattern,
    // 进攻权重
    attackWeightHome: round(weights.attack * 100, 1) + '%',
    attackWeightAway: round(weights.defense * 100, 1) + '%',
    // 防守权重
    defenseWeightHome: round((1 - weights.attack) * 100, 1) + '%',
    defenseWeightAway: round((1 - weights.defense) * 100, 1) + '%',
    // 综合攻守优势
    totalAdvantage: totalDisplay > 50 ? '+' + (totalDisplay - 50).toFixed(1) + '%' : '-' + (50 - totalDisplay).toFixed(1) + '%',
    totalAdvantageValue: Math.round(totalDisplay),
    totalAdvantagePct: round(totalDisplay - 50, F),
    // 实力阶梯
    ladder,
    // 交叉分布
    cross,
    // 子维度细节
    _attackSub: attackResult.subDimensions,
    _defenseSub: defenseResult.subDimensions
  };
}

/**
 * 胜平负交叉分布（Fourth section of Stage 2）
 */
function calcCrossDistribution(vars) {
  const hWins = vars.homeWinGap_2 + vars.homeWinGap_1;
  const hDraws = vars.homeDraw;
  const hLosses = vars.homeLoseGap_1 + vars.homeLoseGap_2;
  const aWins = vars.awayWinGap_2 + vars.awayWinGap_1;
  const aDraws = vars.awayDraw;
  const aLosses = vars.awayLoseGap_1 + vars.awayLoseGap_2;

  // 主胜·客负交叉
  const crossWin = Math.min(hWins, aLosses);
  // 平局交叉
  const crossDraw = Math.min(hDraws, aDraws);
  // 主负·客胜交叉
  const crossLose = Math.min(hLosses, aWins);

  // 让球盘交叉（简化版，基于 rq）
  const rq = vars.rq || 0;

  return {
    crossWin, crossDraw, crossLose,
    hWins, hDraws, hLosses,
    aWins, aDraws, aLosses,
    rq,
    handicapSuggestion: rq > 0 ? '客队让' + rq + '球' : rq < 0 ? '主队让' + Math.abs(rq) + '球' : '平手盘'
  };
}

module.exports = { analyze, calcAttackAdvantage, calcDefenseAdvantage, calcStrengthLadder };

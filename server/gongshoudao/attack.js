/**
 * 第二+第三阶段：实力分析引擎（V24 修订版）
 *
 * 按照 gongshoudao-quan.md 新公式重写：
 *   进攻相对优势度 Adv_进攻（3个子维度合成，归一化到 [-1, +1]）
 *   防守相对优势度 Adv_防守（3个子维度合成，归一化到 [-1, +1]）
 *   综合攻守优势 S = (Adv_进攻 + Adv_防守) / 2
 *   实力阶梯映射（基于 S 值 7 档阈值）
 *   sigmoid 维度权重
 *
 * 所有浮点运算保留 4 位小数
 */
const F = 4;

// ==================== 工具函数 ====================

function round(v, n) {
  const m = Math.pow(10, n);
  return Math.round(v * m) / m;
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ==================== 2.1：进攻相对优势度 ====================

/**
 * 子维度一：赢球格局得分对冲
 * WinScore = 2×WG2 + 1×WG1 + 0.5×PG
 * 对冲 = (WinScore_h - WinScore_a) / 10
 */
function winGapHedge(vars) {
  const wsH = vars.homeWinGap_2 * 2 + vars.homeWinGap_1 * 1 + vars.homeDraw * 0.5;
  const wsA = vars.awayWinGap_2 * 2 + vars.awayWinGap_1 * 1 + vars.awayDraw * 0.5;
  return round((wsH - wsA) / 10, F);
}

/**
 * 子维度二：攻击力纯能效对冲
 * AtkEff = 近期场均进球 × 攻击效率
 * 对冲 = (AtkEff_h - AtkEff_a) / max(AtkEff_h, AtkEff_a, 0.01)
 */
function atkEffHedge(vars) {
  const gh = vars.homeRecentGoalAvg || 1;
  const ga = vars.awayRecentGoalAvg || 1;
  const eh = vars.homeAttackEfficiency || 0;
  const ea = vars.awayAttackEfficiency || 0;

  const atkH = gh * eh;
  const atkA = ga * ea;
  const denom = Math.max(atkH, atkA, 0.01);
  return round((atkH - atkA) / denom, F);
}

/**
 * 子维度三：进球厚度分布对冲
 * Thick = 0×Q0 + 1×Q1 + 2×Q2p
 * 对冲 = (Thick_h - Thick_a) / 10
 */
function thickGoalHedge(vars) {
  const th = vars.homeGoal1 * 1 + vars.homeGoal2Plus * 2;
  const ta = vars.awayGoal1 * 1 + vars.awayGoal2Plus * 2;
  return round((th - ta) / 10, F);
}

/**
 * 合成进攻优势
 * Adv_进攻 = 0.4×赢球格局 + 0.35×攻击能效 + 0.25×进球厚度
 */
function calcAttackAdvantage(vars) {
  const w = winGapHedge(vars);
  const e = atkEffHedge(vars);
  const t = thickGoalHedge(vars);

  const adv = round(0.4 * w + 0.35 * e + 0.25 * t, F);

  return {
    composite: adv,
    subDimensions: {
      gap: { value: w, label: '赢球格局' },
      eff: { value: e, label: '攻击能效' },
      dist: { value: t, label: '进球厚度' }
    }
  };
}

// ==================== 2.2：防守相对优势度 ====================

/**
 * 子维度一：输球空间与容错对冲
 * LossScore = 2×LG2 + 1×LG1
 * 对冲 = (LossScore_a - LossScore_h) / 10
 * 注意：客队输球多 → 主队防守优势大 → 正值利好主队防守
 */
function loseGapHedge(vars) {
  const lsH = vars.homeLoseGap_2 * 2 + vars.homeLoseGap_1 * 1;
  const lsA = vars.awayLoseGap_2 * 2 + vars.awayLoseGap_1 * 1;
  return round((lsA - lsH) / 10, F);
}

/**
 * 子维度二：防御纯能效对冲
 * DefEff = 近期场均失球 × 防守效率
 * 对冲 = (DefEff_a - DefEff_h) / max(DefEff_h, DefEff_a, 0.01)
 * 注意：DefEff 越低防守越好；用 a-h 让客队失球效率高于主队时返回正值（利好主队）
 */
function defEffHedge(vars) {
  const lh = vars.homeRecentLoseAvg || 1;
  const la = vars.awayRecentLoseAvg || 1;
  const dh = vars.homeDefendEfficiency || 0;
  const da = vars.awayDefendEfficiency || 0;

  const defH = lh * dh;
  const defA = la * da;
  const denom = Math.max(defH, defA, 0.01);
  return round((defA - defH) / denom, F);
}

/**
 * 子维度三：失球厚度与零封率对冲
 * ConcededThick = 0×C0 + 1×C1 + 2×C2p
 * 对冲 = (ConcededThick_a - ConcededThick_h) / 10
 */
function concedeHedge(vars) {
  const ch = vars.homeLose1 * 1 + vars.homeLose2Plus * 2;
  const ca = vars.awayLose1 * 1 + vars.awayLose2Plus * 2;
  return round((ca - ch) / 10, F);
}

/**
 * 合成防守优势
 * Adv_防守 = 0.4×输球空间 + 0.35×防御能效 + 0.25×失球厚度
 */
function calcDefenseAdvantage(vars) {
  const l = loseGapHedge(vars);
  const e = defEffHedge(vars);
  const c = concedeHedge(vars);

  const adv = round(0.4 * l + 0.35 * e + 0.25 * c, F);

  return {
    composite: adv,
    subDimensions: {
      gap: { value: l, label: '输球空间' },
      eff: { value: e, label: '防御能效' },
      dist: { value: c, label: '零封能力' }
    }
  };
}

// ==================== 2.3：格局划分与综合攻守优势 ====================

/**
 * 综合攻守优势 S = (Adv_进攻 + Adv_防守) / 2
 */
function calcTotalAdvantage(attAdv, defAdv) {
  return round((attAdv + defAdv) / 2, F);
}

/**
 * 格局状态机
 * - 若 Adv_进攻 > 0.15 且 Adv_防守 > -0.05 → 对攻为主
 * - 若 Adv_防守 > 0.15 且 Adv_进攻 > -0.05 → 防守为主
 * - 否则 → 攻守平衡
 */
function calcPattern(attAdv, defAdv) {
  if (attAdv > 0.15 && defAdv > -0.05) return '对攻为主';
  if (defAdv > 0.15 && attAdv > -0.05) return '防守为主';
  return '攻守平衡';
}

/**
 * 进攻权重: w_进攻 = sigmoid(Adv_进攻)
 * 防守权重: w_防守 = 1 - w_进攻
 */
function calcWeights(attAdv) {
  const wAtt = round(sigmoid(attAdv), F);
  const wDef = round(1 - wAtt, F);
  return { attack: wAtt, defense: wDef };
}

// ==================== 第三阶段：实力阶梯映射 ====================

/**
 * 基于 S 值的 7 档实力阶梯（严格按文档区间匹配）
 *
 * │ S ≥ 0.30         → 👑 主队绝对大优势  level  3
 * │ 0.15 ≤ S < 0.30  → ⚔️ 主队中等优势   level  2
 * │ 0.05 ≤ S < 0.15  → 🔍 主队微弱优势   level  1
 * │ -0.05 < S < 0.05 → ⚖️ 双方实力接近   level  0
 * │ -0.15 < S ≤ -0.05→ 🔍 客队微弱优势   level -1
 * │ -0.30 < S ≤ -0.15→ ⚔️ 客队中等优势   level -2
 * │ S ≤ -0.30        → 👑 客队绝对大优势  level -3
 */
function calcStrengthLadder(S) {
  if (S >= 0.30)  return makeLadder('👑 主队绝对大优势',   3, 'home_big');
  if (S >= 0.15)  return makeLadder('⚔️ 主队中等优势',    2, 'home_mid');
  if (S >= 0.05)  return makeLadder('🔍 主队微弱优势',    1, 'home_sml');
  if (S > -0.05)  return makeLadder('⚖️ 双方实力接近',    0, 'balance');
  if (S >= -0.15) return makeLadder('🔍 客队微弱优势',   -1, 'away_sml');
  if (S > -0.30)  return makeLadder('⚔️ 客队中等优势',   -2, 'away_mid');
  return                  makeLadder('👑 客队绝对大优势', -3, 'away_big');
}

function makeLadder(label, level, key) {
  return { label, level, boundLock: calcBoundLock(level), key };
}

function calcBoundLock(level) {
  const absLevel = Math.abs(level);
  if (absLevel >= 3) return 1.5;
  if (absLevel >= 2) return 1.2;
  if (absLevel >= 1) return 0.7;
  return 0;
}

// ==================== 胜平负交叉分布（让 + 让球数） ====================

/**
 * 不让球 胜平负交叉
 * Cross_win  = (H_win + A_loss) / 20
 * Cross_draw = (PG_h + PG_a) / 20
 * Cross_loss = (H_loss + A_win) / 20
 */
function calcSpfCross(vars) {
  const hWins = vars.homeWinGap_2 + vars.homeWinGap_1;
  const hDraws = vars.homeDraw;
  const hLosses = vars.homeLoseGap_1 + vars.homeLoseGap_2;
  const aWins = vars.awayWinGap_2 + vars.awayWinGap_1;
  const aDraws = vars.awayDraw;
  const aLosses = vars.awayLoseGap_1 + vars.awayLoseGap_2;

  return {
    win:  round((hWins + aLosses) / 20, F),
    draw: round((hDraws + aDraws) / 20, F),
    lose: round((hLosses + aWins) / 20, F),
    hWins, hDraws, hLosses,
    aWins, aDraws, aLosses
  };
}

/**
 * 让球 让胜/让平/让负交叉
 * 合并两队近20场净胜球分布（5档），按让球数 R 偏移后统计
 *
 * 合并分布（主队视角）：
 *   +2: WG2_h + LG2_a     +1: WG1_h + LG1_a
 *    0: PG_h + PG_a
 *   -1: LG1_h + WG1_a     -2: LG2_h + WG2_a
 *
 * 让胜 = 净胜球 - R > 0  的场次 / 20
 * 让平 = 净胜球 - R = 0  的场次 / 20
 * 让负 = 净胜球 - R < 0  的场次 / 20
 */
function calcHandicapCross(vars) {
  const rq = vars.rq || 0;

  // 合并净胜球分布（5档，共20场）
  const dist = {};
  dist[2]  = vars.homeWinGap_2  + vars.awayLoseGap_2;
  dist[1]  = vars.homeWinGap_1  + vars.awayLoseGap_1;
  dist[0]  = vars.homeDraw      + vars.awayDraw;
  dist[-1] = vars.homeLoseGap_1 + vars.awayWinGap_1;
  dist[-2] = vars.homeLoseGap_2 + vars.awayWinGap_2;

  let hcpWin = 0, hcpDraw = 0, hcpLose = 0;

  // 按 rq 偏移统计
  [-2, -1, 0, 1, 2].forEach(d => {
    const count = dist[d] || 0;
    const adjusted = d - rq;  // 让球偏移后的调整值
    if (adjusted > 0)      hcpWin  += count;
    else if (adjusted === 0) hcpDraw += count;
    else                   hcpLose += count;
  });

  return {
    win:  round(hcpWin / 20, F),
    draw: round(hcpDraw / 20, F),
    lose: round(hcpLose / 20, F)
  };
}

/**
 * 交叉分布总入口：同时返回不让球组 + 让球组
 */
function calcCrossDistribution(vars) {
  const spf   = calcSpfCross(vars);
  const hcp   = calcHandicapCross(vars);
  const rq    = vars.rq || 0;

  return {
    // 不让球组
    spf: { win: spf.win, draw: spf.draw, lose: spf.lose },
    // 让球组（R=0 时与不让球相同）
    handicap: { win: hcp.win, draw: hcp.draw, lose: hcp.lose },
    // 让球数
    rq,
    // 原始统计场次（供前端计算）
    hWins: spf.hWins, hDraws: spf.hDraws, hLosses: spf.hLosses,
    aWins: spf.aWins, aDraws: spf.aDraws, aLosses: spf.aLosses
  };
}

// ==================== 主入口 ====================

/**
 * 执行完整的实力分析
 * @param {Object} vars 解析后的标准变量
 * @returns {Object} 实力分析结果
 */
function analyze(vars) {
  // 1. 进攻优势 Adv_进攻
  const attackResult = calcAttackAdvantage(vars);
  const attAdv = attackResult.composite;

  // 2. 防守优势 Adv_防守
  const defenseResult = calcDefenseAdvantage(vars);
  const defAdv = defenseResult.composite;

  // 3. 综合攻守优势 S = (Adv_进攻 + Adv_防守) / 2
  const S = calcTotalAdvantage(attAdv, defAdv);

  // 4. 格局
  const pattern = calcPattern(attAdv, defAdv);

  // 5. 权重（sigmoid）
  const weights = calcWeights(attAdv);

  // 6. 实力阶梯
  const ladder = calcStrengthLadder(S);

  // 7. 胜平负交叉分布
  const cross = calcCrossDistribution(vars);

  // --- 格式化显示值 ---
  // S 百分比化: S_% = S × 100%
  const sPct = round(S * 100, 1);

  return {
    // 进攻优势（归一化值，范围约 ±1）
    attackAdvantage: attAdv >= 0 ? '+' + round(attAdv * 100, 1) + '%' : round(attAdv * 100, 1) + '%',
    attackAdvantageValue: clamp(Math.round(50 + attAdv * 100), 0, 100),
    attackAdvantageRaw: round(attAdv, F),

    // 防守优势（归一化值，范围约 ±1）
    defenseAdvantage: defAdv >= 0 ? '+' + round(defAdv * 100, 1) + '%' : round(defAdv * 100, 1) + '%',
    defenseAdvantageValue: clamp(Math.round(50 + defAdv * 100), 0, 100),
    defenseAdvantageRaw: round(defAdv, F),

    // 格局
    attackPattern: pattern,

    // 维度权重（sigmoid 映射）
    attackDimWeight: round(weights.attack * 100, 1) + '%',
    defenseDimWeight: round(weights.defense * 100, 1) + '%',
    attackWeightHome: round(weights.attack * 100, 1) + '%',
    attackWeightAway: round(weights.defense * 100, 1) + '%',
    defenseWeightHome: round((1 - weights.attack) * 100, 1) + '%',
    defenseWeightAway: round((1 - weights.defense) * 100, 1) + '%',

    // 综合攻守优势 S
    totalAdvantageRaw: round(S, F),                              // 原始归一化值（4位小数）
    totalAdvantage: sPct >= 0 ? '+' + sPct + '%' : sPct + '%',   // 百分比显示字符串
    totalAdvantageValue: clamp(Math.round(50 + sPct), 0, 100),    // 进度条值（0-100）
    totalAdvantagePct: round(S * 100, F),                         // 百分比值（4位小数）

    // ★ 攻守实力（sigmoid 加权合成）：w_进攻 × Adv_进攻 + w_防守 × Adv_防守
    adWeightedComposite: round(weights.attack * attAdv + weights.defense * defAdv, F),

    // 实力阶梯
    ladder,

    // 交叉分布
    cross,

    // 子维度细节
    _attackSub: attackResult.subDimensions,
    _defenseSub: defenseResult.subDimensions
  };
}

module.exports = { analyze, calcAttackAdvantage, calcDefenseAdvantage, calcStrengthLadder, calcCrossDistribution, calcHandicapCross };

/**
 * 四重一致性验证与熔断（zs.md 第四阶段第6节）
 *
 * 模型A：射门还原法
 * 模型B：攻守权重法（复用 goal.js 中 B2 模型结果）
 * 模型C：交锋预测法
 * P_asia：亚指盘口基准（dxqLastPan）
 *
 * 一致性判定：
 *   - 三者两两差值均 ≤ 0.3 → 强一致：三者平均
 *   - 恰好两对差值 ≤ 0.3 → 弱一致：剔除分歧值取平均
 *   - 否则（≤1对一致）→ 熔断：跟随盘口 P_asia
 */
const F = 4;

function round(v, n) {
  const m = Math.pow(10, n);
  return Math.round(v * m) / m;
}

// ==================== 模型A：射门还原法 ====================

function calcModelA(vars) {
  const gh = vars.homeRecentGoalAvg || 1;
  const ga = vars.awayRecentGoalAvg || 1;
  const lh = vars.homeRecentLoseAvg || 1;
  const la = vars.awayRecentLoseAvg || 1;
  const eh = (vars.homeAttackEfficiency || 0) + 0.001;
  const ea = (vars.awayAttackEfficiency || 0) + 0.001;
  const dh = (vars.homeDefendEfficiency || 0) + 0.001;
  const da = (vars.awayDefendEfficiency || 0) + 0.001;

  // 主进攻次数 = Gh×10 / Eff_atk,h
  const atkH = gh * 10 / eh;
  // 客进攻次数 = Ga×10 / Eff_atk,a
  const atkA = ga * 10 / ea;
  // 主被射次数 = Gha×10 / Eff_def,h
  const defH = lh * 10 / dh;
  // 客被射次数 = Gah×10 / Eff_def,a
  const defA = la * 10 / da;

  const alpha = atkH / (atkH + atkA + 0.001);
  const beta  = defH / (defH + defA + 0.001);

  const effH = vars.homeAttackEfficiency || 0;
  const effA = vars.awayAttackEfficiency || 0;
  const effDefH = vars.homeDefendEfficiency || 0;
  const effDefA = vars.awayDefendEfficiency || 0;

  // E_h^(A) = α×Eff_atk,h + β×Eff_def,a  (效率值×10 缩放至进球尺度)
  const ehA = round((alpha * effH + beta * effDefA) * 10, 2);
  // E_a^(A) = (1-α)×Eff_atk,a + (1-β)×Eff_def,h
  const eaA = round(((1 - alpha) * effA + (1 - beta) * effDefH) * 10, 2);

  return {
    total: round(ehA + eaA, F),
    home: round(Math.max(0.1, ehA), 2),
    away: round(Math.max(0.1, eaA), 2)
  };
}

// ==================== 模型C：交锋预测法 ====================

function calcModelC(vars) {
  const jiaoFenScores = vars.jiaoFenScores || [];
  const desc = vars.jiaoFenDesc || '';

  // 从 jiaoFenDesc 提取近6次总进球
  // 格式: "进7球,失7" → G_6 = 7+7 = 14
  let g6 = 2.5;
  const goalMatch = desc.match(/进(\d+)球.*?失(\d+)/);
  if (goalMatch) {
    g6 = (parseInt(goalMatch[1]) + parseInt(goalMatch[2])) / 6;
  }

  // 近2次交锋总进球均值
  let g2 = 2.5;
  if (jiaoFenScores.length >= 2) {
    const sum = jiaoFenScores.reduce(function(s, sc) { return s + (sc ? (sc.h + sc.a) : 0); }, 0);
    g2 = sum / jiaoFenScores.length;
  }

  const total = round(0.3 * g6 + 0.7 * g2, F);

  return { total, g6: round(g6, F), g2: round(g2, F) };
}

// ==================== 一致性判定与熔断 ====================

/**
 * 执行四重一致性验证
 * @param {Object} vars 标准变量
 * @param {Object} modelB { home: xgHome, away: xgAway } (来自 goal.js B2 模型)
 * @param {number} pAsia  亚指盘口基准 dxqLastPan (若缺失则 fallback 到 λ_total)
 * @returns {{ total: number, home: number, away: number, consensus: string, fused: boolean }}
 */
function fuse(vars, modelB, pAsia) {
  const mA = calcModelA(vars);
  const mC = calcModelC(vars);
  const mB = { total: round(modelB.home + modelB.away, F), home: modelB.home, away: modelB.away };

  const totals = [mA.total, mB.total, mC.total];
  const names = ['ModelA(射门还原)', 'ModelB(攻守权重)', 'ModelC(交锋预测)'];

  // 两两比较
  const pairs = [
    { i: 0, j: 1, diff: Math.abs(totals[0] - totals[1]) },
    { i: 0, j: 2, diff: Math.abs(totals[0] - totals[2]) },
    { i: 1, j: 2, diff: Math.abs(totals[1] - totals[2]) }
  ];
  const consistent = pairs.filter(function(p) { return p.diff <= 0.3; });
  const nConsistent = consistent.length;

  let finalTotal, consensusLabel, fused;

  if (nConsistent >= 3) {
    // 强一致
    finalTotal = round((totals[0] + totals[1] + totals[2]) / 3, F);
    consensusLabel = '强一致(三模型融合)';
    fused = true;
  } else if (nConsistent === 2) {
    // 弱一致：剔除分歧值
    const divergentIdx = [0, 1, 2].find(function(k) {
      return !consistent.some(function(c) { return c.i === k || c.j === k; });
    });
    const keepIdx = [0, 1, 2].filter(function(k) { return k !== divergentIdx; });
    finalTotal = round((totals[keepIdx[0]] + totals[keepIdx[1]]) / 2, F);
    consensusLabel = '弱一致(剔除' + names[divergentIdx] + ')';
    fused = true;
  } else {
    // 熔断
    finalTotal = round(pAsia || 2.5, F);
    consensusLabel = '熔断(模型打架，跟随盘口)';
    fused = false;
  }

  // 按 B2 模型比例拆分主客
  const splitRatio = (modelB.home + modelB.away) > 0
    ? modelB.home / (modelB.home + modelB.away)
    : 0.5;
  const finalHome = round(Math.max(0.1, finalTotal * splitRatio), 2);
  const finalAway = round(Math.max(0.1, finalTotal * (1 - splitRatio)), 2);

  return {
    total: finalTotal,
    home: finalHome,
    away: finalAway,
    consensus: consensusLabel,
    fused,
    _details: {
      modelA: mA,
      modelB: mB,
      modelC: mC,
      pAsia: round(pAsia || 2.5, F),
      nConsistent,
      pairs: pairs.map(function(p) { return round(p.diff, F); })
    }
  };
}

module.exports = { fuse, calcModelA, calcModelC };

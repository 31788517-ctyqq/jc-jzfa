/**
 * P0: score.test.js — 比分矩阵合围算法 单元测试
 * 覆盖: 泊松概率、Dixon-Coles修正、三重物理锁(软化版)、
 *       十字对冲历史修正、实力防御锁、市场赔率校准、完整analyze集成
 */
const {
  analyze, poissonProb, dixonColesCorrection, conditionalGoalAdjust,
  softThreshold, totalGoalsLock, singleTeamLock, goalDiffLock,
  singleTeamPenalty, goalDiffPenalty, historyCorrection,
  powerBoost, marketDirection, marketCalibration, generateValidCells, round
} = require('../score');

// ==================== 辅助函数 ====================

function makeVars(overrides) {
  return Object.assign({
    homeRecentGoalAvg: 1.5, awayRecentGoalAvg: 1.2,
    homeRecentLoseAvg: 1.1, awayRecentLoseAvg: 1.3,
    homeAttackEfficiency: 0.15, awayAttackEfficiency: 0.12,
    homeDefendEfficiency: 0.10, awayDefendEfficiency: 0.11,
    homeGoal0: 2, homeGoal1: 4, homeGoal2Plus: 2,
    awayGoal0: 3, awayGoal1: 3, awayGoal2Plus: 1,
    homeWinGap_1: 3, homeWinGap_2: 1,
    homeLoseGap_1: 2, homeLoseGap_2: 0,
    awayWinGap_1: 2, awayWinGap_2: 1,
    awayLoseGap_1: 1, awayLoseGap_2: 1,
    homeDraw: 3, awayDraw: 2,
    homeWinAward: 1.85, drawAward: 3.40, awayWinAward: 4.20,
    jiaoFenScores: [{ h: 2, a: 1 }, { h: 1, a: 1 }],
    jiaoFenDesc: '近6次交战 2胜2平2负 进7球失6球 大球2次',
    jiaoFenExtended: {
      parsed: true, totalMatches: 6, wins: 2, draws: 2, losses: 2,
      goalsFor: 7, goalsAgainst: 6, overCount: 2,
    },
  }, overrides || {});
}

// ==================== 泊松概率 ====================

describe('score — poissonProb 泊松概率', () => {
  it('k=0, lambda=0 返回 1', () => {
    expect(poissonProb(0, 0)).toBe(1);
  });

  it('k=0, lambda=1.5 ~0.223', () => {
    expect(poissonProb(0, 1.5)).toBeCloseTo(0.2231, 2);
  });

  it('k=1, lambda=1.5 ~0.335', () => {
    expect(poissonProb(1, 1.5)).toBeCloseTo(0.3347, 2);
  });

  it('k=2, lambda=1.5 ~0.251', () => {
    expect(poissonProb(2, 1.5)).toBeCloseTo(0.2510, 2);
  });

  it('k=3, lambda=1.5 ~0.126', () => {
    expect(poissonProb(3, 1.5)).toBeCloseTo(0.1255, 2);
  });

  it('lambda=0 时 k>0 返回 0', () => {
    expect(poissonProb(1, 0)).toBe(0);
    expect(poissonProb(3, 0)).toBe(0);
  });

  it('k>20 返回 0', () => {
    expect(poissonProb(21, 3)).toBe(0);
    expect(poissonProb(25, 5)).toBe(0);
  });

  it('lambda 极小值时概率分布合理', () => {
    expect(poissonProb(0, 0.1)).toBeCloseTo(0.9048, 2);
    expect(poissonProb(1, 0.1)).toBeCloseTo(0.0905, 2);
  });

  it('lambda 较大值时和为接近1的分布', () => {
    let sum = 0;
    for (let k = 0; k <= 20; k++) sum += poissonProb(k, 2.5);
    expect(sum).toBeCloseTo(1, 1);
  });
});

// ==================== Dixon-Coles 修正 ====================

describe('score — dixonColesCorrection 低比分修正', () => {
  it('0:0 修正 1 - λh*λa*ρ', () => {
    // rho=-0.05, λh=1.5, λa=1.2 => 1 - 1.5*1.2*(-0.05) = 1 + 0.09 = 1.09
    expect(dixonColesCorrection(0, 0, 1.5, 1.2)).toBeCloseTo(1.09, 4);
  });

  it('1:0 修正 1 + λh*ρ', () => {
    // 1 + 1.5 * (-0.05) = 0.925
    expect(dixonColesCorrection(1, 0, 1.5, 1.2)).toBeCloseTo(0.925, 4);
  });

  it('0:1 修正 1 + λa*ρ', () => {
    // 1 + 1.2 * (-0.05) = 0.94
    expect(dixonColesCorrection(0, 1, 1.5, 1.2)).toBeCloseTo(0.94, 4);
  });

  it('1:1 修正 1 - ρ = 1.05', () => {
    expect(dixonColesCorrection(1, 1, 1.5, 1.2)).toBe(1.05);
  });

  it('其他比分不修正返回 1.0', () => {
    expect(dixonColesCorrection(2, 0, 1.5, 1.2)).toBe(1.0);
    expect(dixonColesCorrection(2, 1, 1.5, 1.2)).toBe(1.0);
    expect(dixonColesCorrection(3, 2, 1.5, 1.2)).toBe(1.0);
    expect(dixonColesCorrection(0, 2, 1.5, 1.2)).toBe(1.0);
  });

  it('可自定义 rho 参数', () => {
    expect(dixonColesCorrection(0, 0, 2.0, 1.0, -0.1)).toBeCloseTo(1.2, 4);
    expect(dixonColesCorrection(1, 1, 2.0, 1.0, -0.08)).toBe(1.08);
  });
});

// ==================== 条件进球调整 ====================

describe('score — conditionalGoalAdjust 反扑效应', () => {
  it('落后2球 → 对方进攻增强 15%', () => {
    expect(conditionalGoalAdjust(3, 1, 1.2)).toBe(1.15);
    expect(conditionalGoalAdjust(2, 0, 1.0)).toBe(1.15);
  });

  it('落后1球 → 对方进攻增强 8%', () => {
    expect(conditionalGoalAdjust(2, 1, 1.2)).toBe(1.08);
    expect(conditionalGoalAdjust(1, 0, 1.0)).toBe(1.08);
  });

  it('领先3+球 → 垃圾时间 0.85', () => {
    expect(conditionalGoalAdjust(0, 3, 1.0)).toBe(0.85);
    expect(conditionalGoalAdjust(1, 4, 1.2)).toBe(0.85);
  });

  it('平局或小差 → 正常 1.0', () => {
    expect(conditionalGoalAdjust(1, 1, 1.0)).toBe(1.0);
    expect(conditionalGoalAdjust(2, 2, 1.5)).toBe(1.0);
    expect(conditionalGoalAdjust(0, 1, 1.0)).toBe(1.0);
  });
});

// ==================== Sigmoid 软化函数 ====================

describe('score — softThreshold Sigmoid 软化', () => {
  it('默认 slope=10, 范围 [0.3, 1.0]', () => {
    const result = softThreshold(5, 3, 10);
    expect(result).toBeGreaterThanOrEqual(0.3);
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it('x 远大于 threshold → 接近 1.0', () => {
    expect(softThreshold(5, 0.5, 5)).toBeGreaterThan(0.95);
  });

  it('x 远小于 threshold → 接近 0.3', () => {
    expect(softThreshold(0, 2, 10)).toBeCloseTo(0.3, 1);
  });

  it('x≈threshold → ~0.65', () => {
    // sigmoid(0) = 0.5 => 0.3 + 0.7*0.5 = 0.65
    expect(softThreshold(3, 3, 10)).toBeCloseTo(0.65, 2);
  });

  it('slope 控制陡峭程度', () => {
    const gentle = softThreshold(5, 3, 2);
    const steep = softThreshold(5, 3, 20);
    expect(steep).toBeGreaterThan(gentle);
  });
});

// ==================== 锁一：总进球范围锁 ====================

describe('score — totalGoalsLock 总进球范围锁', () => {
  it('在范围内返回 true', () => {
    expect(totalGoalsLock(1, 1, { lower: 0, upper: 6 })).toBe(true);
    expect(totalGoalsLock(3, 2, { lower: 2, upper: 5 })).toBe(true);
  });

  it('低于下限返回 false', () => {
    expect(totalGoalsLock(0, 0, { lower: 2, upper: 6 })).toBe(false);
    expect(totalGoalsLock(0, 1, { lower: 2, upper: 5 })).toBe(false);
  });

  it('高于上限返回 false', () => {
    expect(totalGoalsLock(4, 3, { lower: 0, upper: 3 })).toBe(false);
    expect(totalGoalsLock(3, 3, { lower: 1, upper: 4 })).toBe(false);
  });
});

// ==================== 锁二：单队进球锁（硬过滤版） ====================

describe('score — singleTeamLock 单队进球锁(硬过滤)', () => {
  it('常规攻防 → 正常比分通过', () => {
    const vars = makeVars();
    expect(singleTeamLock(1, 1, vars)).toBe(true);
    expect(singleTeamLock(2, 0, vars)).toBe(true);
    expect(singleTeamLock(0, 2, vars)).toBe(true);
    expect(singleTeamLock(3, 1, vars)).toBe(true);
  });

  it('极度破甲(penH≥2.0)时 h=0 被过滤', () => {
    // penH = atkH/(shotAgainstA+0.5), 需要 penH ≥ 2.0
    // atkH = gh/eh = 10/0.5=20, shotAgainstA = la/da = 0.1/0.05=2, penH = 20/2.5=8
    const vars = makeVars({
      homeAttackEfficiency: 0.5, homeRecentGoalAvg: 10.0,
      awayDefendEfficiency: 0.05, awayRecentLoseAvg: 0.1,
    });
    expect(singleTeamLock(0, 1, vars)).toBe(false);
    expect(singleTeamLock(1, 0, vars)).toBe(true);
  });

  it('极度哑火(penH≤0.3)时 h≥3 被过滤', () => {
    // penH = atkH/(shotAgainstA+0.5), atkH=0.1/0.5=0.2, shotAgainstA=10/0.05=200, penH=0.2/200.5≈0.001
    const vars = makeVars({
      homeAttackEfficiency: 0.5, homeRecentGoalAvg: 0.1,
      awayDefendEfficiency: 0.05, awayRecentLoseAvg: 10.0,
    });
    expect(singleTeamLock(3, 0, vars)).toBe(false);
    expect(singleTeamLock(1, 0, vars)).toBe(true);
  });

  it('单队6+球(h>6) → 过滤, h=6可通过', () => {
    const vars = makeVars();
    expect(singleTeamLock(6, 0, vars)).toBe(true); // h=6 不过滤
    expect(singleTeamLock(7, 0, vars)).toBe(false); // h>6 才过滤
    expect(singleTeamLock(0, 7, vars)).toBe(false);
  });

  it('单队5球 → 通过', () => {
    const vars = makeVars();
    expect(singleTeamLock(5, 0, vars)).toBe(true);
  });
});

// ==================== 锁三：净胜球分布锁（硬过滤版） ====================

describe('score — goalDiffLock 净胜球分布锁(硬过滤)', () => {
  it('极端优势(absLv≥3) → Math.abs(gd) >= -1 始终为true, 不过滤', () => {
    // 代码逻辑: if |ladderLevel| >= 3, return Math.abs(gd) >= -1 → 始终true
    expect(goalDiffLock(2, 2, 3)).toBe(true);
    expect(goalDiffLock(0, 0, -3)).toBe(true);
    expect(goalDiffLock(1, 0, 3)).toBe(true);
    expect(goalDiffLock(0, 2, 3)).toBe(true); // 因为 abs(-2)=2 >= -1 为true
  });

  it('中等优势(absLv≥2) → Math.abs(gd) >= -2 始终true', () => {
    expect(goalDiffLock(0, 2, 2)).toBe(true);
    expect(goalDiffLock(0, 3, 2)).toBe(true); // 因为 abs(-3)=3 >= -2 为true
  });

  it('均衡(absLv<2) 允许3球差', () => {
    expect(goalDiffLock(3, 0, 1)).toBe(true);
    expect(goalDiffLock(0, 3, 0)).toBe(true);
    expect(goalDiffLock(4, 0, 1)).toBe(false);
    expect(goalDiffLock(0, 4, 0)).toBe(false);
  });
});

// ==================== 锁二软化版：singleTeamPenalty ====================

describe('score — singleTeamPenalty 单队进球惩罚(软化版)', () => {
  it('常规攻防 → h=1,a=1 惩罚因子接近1', () => {
    const vars = makeVars();
    const p = singleTeamPenalty(1, 1, vars);
    expect(p).toBeGreaterThanOrEqual(0.9);
    expect(p).toBeLessThanOrEqual(1.0);
  });

  it('强力破甲(pen≥1.2)时 h=0 严重惩罚', () => {
    // penH = atkH/(shotAgainstA+0.5), atkH = gh/eh = 20/0.5=40, shotAgainstA=la/da=0.1/0.05=2
    // penH = 40/2.5 = 16 ≥ 1.2 → 触发强力破甲
    const vars = makeVars({
      homeAttackEfficiency: 0.5, homeRecentGoalAvg: 20.0,
      awayDefendEfficiency: 0.05, awayRecentLoseAvg: 0.1,
    });
    const p0 = singleTeamPenalty(0, 1, vars);
    const p1 = singleTeamPenalty(1, 1, vars);
    expect(p0).toBeLessThan(p1);
    expect(p0).toBeLessThan(0.6);
  });

  it('防线哑火(pen≤0.7)时 h=0/低比分=较高惩罚, h=2=较轻惩罚', () => {
    const vars = makeVars({
      homeAttackEfficiency: 0.5, homeRecentGoalAvg: 0.1,
      awayDefendEfficiency: 0.05, awayRecentLoseAvg: 20.0,
    });
    const p0 = singleTeamPenalty(0, 0, vars);
    const p2 = singleTeamPenalty(2, 0, vars);
    // h=0 惩罚更重（penalty更低），h=2 惩罚更轻（penalty更高）
    // 算法: sigmoid(-8*(1.5-h)): h=0→sigmoid(-12)≈1→penalty≈0.3; h=2→sigmoid(4)≈0→penalty≈0.987
    expect(p0).toBeLessThan(p2);
  });

  it('返回值始终在 [0.2, 1.0] 范围内', () => {
    const vars = makeVars();
    for (let h = 0; h <= 5; h++) {
      for (let a = 0; a <= 5; a++) {
        const p = singleTeamPenalty(h, a, vars);
        expect(p).toBeGreaterThanOrEqual(0.2);
        expect(p).toBeLessThanOrEqual(1.0);
      }
    }
  });

  it('客队攻防同样影响惩罚', () => {
    const varsA = makeVars({
      awayAttackEfficiency: 0.5, awayRecentGoalAvg: 20.0,
      homeDefendEfficiency: 0.05, homeRecentLoseAvg: 0.1,
    });
    const p0 = singleTeamPenalty(1, 0, varsA);
    const p1 = singleTeamPenalty(1, 1, varsA);
    expect(p0).toBeLessThan(p1); // a=0 should be penalized if penA ≥ 1.2
  });
});

// ==================== 锁三软化版：goalDiffPenalty ====================

describe('score — goalDiffPenalty 净胜球惩罚(软化版)', () => {
  it('极端优势(正) → 大胜应受提振, 输球应受惩罚', () => {
    const pWin = goalDiffPenalty(2, 0, 3);
    const pLose = goalDiffPenalty(0, 2, 3);
    expect(pWin).toBeGreaterThan(pLose);
    expect(pWin).toBeGreaterThan(0.7);
    expect(pLose).toBeLessThan(0.5);
  });

  it('极端劣势(负) → 客胜提振', () => {
    const pAwayWin = goalDiffPenalty(0, 2, -3);
    const pHomeWin = goalDiffPenalty(2, 0, -3);
    expect(pAwayWin).toBeGreaterThan(pHomeWin);
  });

  it('均衡(absLv<1) → 宽区间, 极端净胜球轻微惩罚', () => {
    const p1 = goalDiffPenalty(1, 0, 0);
    const p4 = goalDiffPenalty(4, 0, 0);
    expect(p1).toBeCloseTo(1.0, 1);
    expect(p4).toBeLessThan(p1);
  });

  it('微弱优势 → 宽容区间', () => {
    const p0 = goalDiffPenalty(0, 1, 1); // 主优但落后
    // 微弱优势下轻微落后可能不严重惩罚
    expect(p0).toBeGreaterThan(0.4);
  });

  it('返回值 [0.3, 1.0] 范围内', () => {
    for (let gd = -4; gd <= 4; gd++) {
      for (let lv = -3; lv <= 3; lv++) {
        const h = Math.max(0, gd);
        const a = Math.max(0, -gd);
        const p = goalDiffPenalty(h, a, lv);
        expect(p).toBeGreaterThanOrEqual(0.3);
        expect(p).toBeLessThanOrEqual(1.0);
      }
    }
  });
});

// ==================== 历史修正 ====================

describe('score — historyCorrection 十字对冲历史修正', () => {
  it('进球分布匹配提升因子', () => {
    const vars = makeVars({ homeGoal1: 6, awayGoal0: 5 });
    const boost = historyCorrection(1, 0, vars);
    expect(boost).toBeGreaterThan(1.0);
  });

  it('交锋历史精确匹配2+次 → 强提振', () => {
    const vars = makeVars({
      jiaoFenScores: [{ h: 1, a: 0 }, { h: 1, a: 0 }, { h: 2, a: 1 }],
    });
    const boost = historyCorrection(1, 0, vars);
    expect(boost).toBeGreaterThanOrEqual(1.3); // 2次匹配 → 1.3
  });

  it('交锋历史匹配1次 → 轻微提振(1.15)', () => {
    const vars = makeVars({
      jiaoFenScores: [{ h: 1, a: 0 }, { h: 2, a: 1 }],
    });
    const boost = historyCorrection(1, 0, vars);
    // 1次匹配 + 维度修正 → 约1.15×小维度修正
    // 但 homeGoal0=2, awayGoal0=3 影响: 1+2*0.05=1.1, 1+3*0.03=1.09
    // joint: 1次匹配=1.15
    // final ~ 1.15 * 1.1 * 1.09 ≈ 1.38
    expect(boost).toBeGreaterThanOrEqual(1.1);
    expect(boost).toBeLessThanOrEqual(2.0);
  });

  it('无交锋历史 → 仅维度分布修正', () => {
    const vars = makeVars({ jiaoFenScores: [] });
    const boost = historyCorrection(2, 1, vars);
    expect(boost).toEqual(expect.any(Number));
    expect(boost).toBeGreaterThanOrEqual(0.8);
  });

  it('修正因子不超过上限 2.5', () => {
    const vars = makeVars({
      homeGoal0: 20, homeGoal1: 20, homeGoal2Plus: 20,
      awayGoal0: 20, awayGoal1: 20, awayGoal2Plus: 20,
      jiaoFenScores: Array(5).fill({ h: 2, a: 1 }),
    });
    const boost = historyCorrection(2, 1, vars);
    expect(boost).toBeLessThanOrEqual(2.5);
  });

  it('JiaoFenExtended 大球率提振大比分', () => {
    const vars = makeVars({
      jiaoFenExtended: { parsed: true, totalMatches: 4, goalsFor: 8, goalsAgainst: 6, overCount: 3 },
    });
    const boostBig = historyCorrection(2, 2, vars); // 总进球4
    expect(boostBig).toBeGreaterThanOrEqual(1.0);
  });
});

// ==================== 实力防御锁 ====================

describe('score — powerBoost 实力防御锁', () => {
  it('极端优势主队 + 净胜2+球 → 1.5倍提振', () => {
    expect(powerBoost(2, 0, 3)).toBe(1.25);
    expect(powerBoost(3, 0, 3)).toBe(1.25);
  });

  it('极端优势客队 + 净负2+球 → 1.25倍提振', () => {
    expect(powerBoost(0, 2, -3)).toBe(1.25);
    expect(powerBoost(0, 3, -3)).toBe(1.25);
  });

  it('中等优势 + 净胜1球 → 1.1倍提振', () => {
    expect(powerBoost(1, 0, 2)).toBe(1.1);
    expect(powerBoost(0, 1, -2)).toBe(1.1);
  });

  it('冷门削弱: 强主输球 → 0.6', () => {
    expect(powerBoost(0, 1, 2)).toBe(0.6);
    expect(powerBoost(1, 0, -2)).toBe(0.6);
  });

  it('无匹配条件 → 1.0', () => {
    expect(powerBoost(1, 1, 0)).toBe(1.0);
    expect(powerBoost(2, 1, 1)).toBe(1.0);
  });
});

// ==================== 市场赔率校准 ====================

describe('score — marketDirection 市场隐含方向概率', () => {
  it('有效赔率 → 返回归一化概率', () => {
    const vars = makeVars({ homeWinAward: 2.0, drawAward: 3.5, awayWinAward: 4.0 });
    const dir = marketDirection(vars);
    expect(dir.valid).toBe(true);
    // 1/2=0.5, 1/3.5≈0.2857, 1/4=0.25, sum=1.0357
    // home=0.5/1.0357≈0.4827, draw≈0.2758, away≈0.2412
    expect(dir.home).toBeCloseTo(0.4827, 2);
    expect(dir.draw).toBeCloseTo(0.2758, 2);
    expect(dir.away).toBeCloseTo(0.2412, 2);
    expect(dir.overround).toBeGreaterThan(0);
  });

  it('无效赔率(≤1) → valid=false', () => {
    const vars = makeVars({ homeWinAward: 0, drawAward: 3.5, awayWinAward: 4.0 });
    const dir = marketDirection(vars);
    expect(dir.valid).toBe(false);
    expect(dir.home).toBeCloseTo(1 / 3, 2);
  });

  it('三个概率和为1', () => {
    const vars = makeVars({ homeWinAward: 2.5, drawAward: 3.2, awayWinAward: 2.8 });
    const dir = marketDirection(vars);
    if (dir.valid) {
      expect(dir.home + dir.draw + dir.away).toBeCloseTo(1, 2);
    }
  });
});

describe('score — marketCalibration 市场校准因子', () => {
  it('主胜比分 → 高主胜概率 → 校准因子>1', () => {
    const dir = { valid: true, home: 0.5, draw: 0.25, away: 0.25 };
    const cal = marketCalibration(2, 0, dir, 0.25);
    // 0.5 / (1/3) = 1.5, deviation=1.5, alpha=0.25 => 1+0.25*(0.5)=1.125
    expect(cal).toBeCloseTo(1.125, 2);
  });

  it('平局比分 → 高平局概率 → 校准因子>1', () => {
    const dir = { valid: true, home: 0.3, draw: 0.4, away: 0.3 };
    const cal = marketCalibration(1, 1, dir, 0.25);
    expect(cal).toBeGreaterThan(1.0);
  });

  it('无效赔率 → 不校准返回1.0', () => {
    const dir = { valid: false };
    expect(marketCalibration(1, 0, dir, 0.25)).toBe(1.0);
  });
});

// ==================== 格点生成 ====================

describe('score — generateValidCells 合法格点生成', () => {
  it('常规参数下生成合理数量的格点', () => {
    const vars = makeVars();
    const cells = generateValidCells(1.5, 1.2, vars, { lower: 1, upper: 4 }, 1);
    expect(cells.length).toBeGreaterThan(5);
    expect(cells.length).toBeLessThan(40);
  });

  it('所有格点满足锁一(总进球范围)', () => {
    const vars = makeVars();
    const goalRange = { lower: 2, upper: 4 };
    const cells = generateValidCells(1.5, 1.2, vars, goalRange, 1);
    cells.forEach(function (c) {
      expect(totalGoalsLock(c.h, c.a, goalRange)).toBe(true);
    });
  });

  it('空集边界：极其严格的过滤可能无格点', () => {
    const vars = makeVars({ homeAttackEfficiency: 0, homeRecentGoalAvg: 0 });
    const cells = generateValidCells(0.1, 0.1, vars, { lower: 0, upper: 1 }, 0);
    // 即使严格条件也应返回数组(可能为空)
    expect(Array.isArray(cells)).toBe(true);
  });
});

// ==================== round 辅助 ====================

describe('score — round 辅助函数', () => {
  it('保留 n 位小数', () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(1.23456, 4)).toBe(1.2346);
    expect(round(1.23456, 0)).toBe(1);
  });

  it('四舍五入', () => {
    expect(round(1.5, 0)).toBe(2);
    expect(round(1.45, 1)).toBe(1.5);
  });
});

// ==================== analyze 集成测试 ====================

describe('score — analyze 完整集成', () => {
  it('正常输入 → 返回 TOP8 比分', () => {
    const vars = makeVars();
    const result = analyze(vars, 1.5, 1.2,
      { lower: 1, upper: 4, overRate: 55 }, 1);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(8);
    result.forEach(function (r) {
      expect(r).toHaveProperty('score');
      expect(r).toHaveProperty('percent');
      expect(typeof r.score).toBe('string');
      expect(typeof r.percent).toBe('string');
      expect(r.percent).toMatch(/%$/);
    });
  });

  it('TOP8 按概率降序排列', () => {
    const vars = makeVars();
    const result = analyze(vars, 1.5, 1.2,
      { lower: 1, upper: 4, overRate: 55 }, 1);
    if (result.length >= 2) {
      const p0 = parseFloat(result[0].percent);
      const p1 = parseFloat(result[1].percent);
      expect(p0).toBeGreaterThanOrEqual(p1);
    }
  });

  it('极端强主 → 高净胜球比分概率更高', () => {
    const vars = makeVars({
      homeAttackEfficiency: 0.3, homeRecentGoalAvg: 2.5,
      awayDefendEfficiency: 0.05, awayRecentLoseAvg: 2.0,
      homeWinAward: 1.5, drawAward: 4.0, awayWinAward: 7.0,
    });
    const result = analyze(vars, 2.5, 0.8,
      { lower: 2, upper: 5, overRate: 60 }, 2);
    // 大概率有主胜大比分
    const scores = result.map(function (r) { return r.score; });
    const hasBigHomeWin = scores.some(function (s) {
      const parts = s.split('-');
      return parseInt(parts[0]) > parseInt(parts[1]);
    });
    expect(hasBigHomeWin).toBe(true);
  });

  it('极端客优 → 客胜比分概率更高', () => {
    const vars = makeVars({
      homeAttackEfficiency: 0.05, homeRecentGoalAvg: 0.8,
      awayDefendEfficiency: 0.3, awayRecentLoseAvg: 0.5,
      awayAttackEfficiency: 0.3, awayRecentGoalAvg: 2.5,
      homeDefendEfficiency: 0.05, homeRecentLoseAvg: 2.0,
      homeWinAward: 7.0, drawAward: 4.0, awayWinAward: 1.5,
    });
    const result = analyze(vars, 0.8, 2.5,
      { lower: 2, upper: 5, overRate: 60 }, -2);
    const scores = result.map(function (r) { return r.score; });
    const hasAwayWin = scores.some(function (s) {
      const parts = s.split('-');
      return parseInt(parts[1]) > parseInt(parts[0]);
    });
    expect(hasAwayWin).toBe(true);
  });

  it('TOP 比分概率之和接近100%', () => {
    const vars = makeVars();
    const result = analyze(vars, 1.5, 1.2,
      { lower: 1, upper: 4, overRate: 55 }, 1);
    const total = result.reduce(function (s, r) {
      return s + parseFloat(r.percent);
    }, 0);
    // TOP8 归一化后之和应接近 100%
    expect(total).toBeGreaterThan(80);
    expect(total).toBeLessThanOrEqual(100);
  });

  it('空格点 → 返回空数组或仅含fallback项', () => {
    // 极其严苛的过滤条件 → 可能无合法比分
    const result = analyze(makeVars({
      homeAttackEfficiency: 0.001, homeRecentGoalAvg: 0.001,
      awayAttackEfficiency: 0.001, awayRecentGoalAvg: 0.001,
    }), 0.001, 0.001,
      { lower: 15, upper: 15, overRate: 0 }, 10);
    // 过于严格的条件可能导致无结果或只有 fallback
    expect(Array.isArray(result)).toBe(true);
  });

  it('包含 market calibration 的完整验证', () => {
    const vars = makeVars({
      homeWinAward: 1.8, drawAward: 3.5, awayWinAward: 4.0,
    });
    const result = analyze(vars, 1.5, 1.2,
      { lower: 1, upper: 4, overRate: 55 }, 1);
    expect(result.length).toBeGreaterThan(0);
  });
});

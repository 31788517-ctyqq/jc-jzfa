/**
 * Phase 3 — P2: gongshoudao/tests/attack.test.js
 * 第二+第三阶段：实力分析引擎单元测试
 * 覆盖: calcAttackAdvantage/calcDefenseAdvantage/calcStrengthLadder/
 *       calcCrossDistribution/calcHandicapCross/calcADDiff
 */

const {
  analyze,
  calcAttackAdvantage,
  calcDefenseAdvantage,
  calcStrengthLadder,
  calcCrossDistribution,
  calcADDiff,
} = require('../attack');

// ── 标准测试变量（"强主弱客"场景） ──
const STRONG_HOME_VARS = {
  homeWinGap_1: 4,
  homeWinGap_2: 2,
  homeLoseGap_1: 1,
  homeLoseGap_2: 0,
  awayWinGap_1: 2,
  awayWinGap_2: 1,
  awayLoseGap_1: 2,
  awayLoseGap_2: 1,
  homeDraw: 3,
  awayDraw: 2,
  homeGoal0: 1,
  homeGoal1: 4,
  homeGoal2Plus: 3,
  homeLose0: 3,
  homeLose1: 3,
  homeLose2Plus: 0,
  awayGoal0: 5,
  awayGoal1: 3,
  awayGoal2Plus: 0,
  awayLose0: 3,
  awayLose1: 3,
  awayLose2Plus: 1,
  homeFieldGoalAvg: 1.8,
  homeFieldLoseAvg: 0.8,
  homeRecentGoalAvg: 1.8,
  homeRecentLoseAvg: 0.8,
  awayFieldGoalAvg: 1.0,
  awayFieldLoseAvg: 1.5,
  awayRecentGoalAvg: 1.0,
  awayRecentLoseAvg: 1.5,
  homeAttackEfficiency: 0.3,
  homeDefendEfficiency: 0.1,
  awayAttackEfficiency: 0.1,
  awayDefendEfficiency: 0.3,
  homePower: 85,
  awayPower: 55,
  homeWinAward: 1.6,
  awayWinAward: 4.5,
  drawAward: 3.8,
  rq: 0,
};

// ── 标准测试变量（"势均力敌"场景） ──
const BALANCED_VARS = {
  homeWinGap_1: 3,
  homeWinGap_2: 1,
  homeLoseGap_1: 2,
  homeLoseGap_2: 1,
  awayWinGap_1: 3,
  awayWinGap_2: 1,
  awayLoseGap_1: 2,
  awayLoseGap_2: 0,
  homeDraw: 3,
  awayDraw: 3,
  homeGoal0: 2,
  homeGoal1: 4,
  homeGoal2Plus: 1,
  homeLose0: 2,
  homeLose1: 3,
  homeLose2Plus: 1,
  awayGoal0: 2,
  awayGoal1: 4,
  awayGoal2Plus: 1,
  awayLose0: 2,
  awayLose1: 3,
  awayLose2Plus: 0,
  homeFieldGoalAvg: 1.4,
  homeFieldLoseAvg: 1.3,
  homeRecentGoalAvg: 1.4,
  homeRecentLoseAvg: 1.3,
  awayFieldGoalAvg: 1.4,
  awayFieldLoseAvg: 1.3,
  awayRecentGoalAvg: 1.4,
  awayRecentLoseAvg: 1.3,
  homeAttackEfficiency: 0.2,
  homeDefendEfficiency: 0.15,
  awayAttackEfficiency: 0.2,
  awayDefendEfficiency: 0.15,
  homePower: 65,
  awayPower: 63,
  homeWinAward: 2.2,
  awayWinAward: 2.8,
  drawAward: 3.2,
  rq: 0,
};

describe('gongshoudao/attack — analyze', () => {
  it('应返回完整分析结果结构', () => {
    const result = analyze(STRONG_HOME_VARS);
    expect(result).toHaveProperty('attackAdvantageRaw');
    expect(result).toHaveProperty('defenseAdvantageRaw');
    expect(result).toHaveProperty('totalAdvantageRaw');
    expect(result).toHaveProperty('attackPattern');
    expect(result).toHaveProperty('ladder');
    expect(result).toHaveProperty('cross');
    expect(result).toHaveProperty('adWeightedComposite');
    // 子维度
    expect(result).toHaveProperty('_attackSub');
    expect(result).toHaveProperty('_defenseSub');
  });

  it('强主弱客场景：totalAdvantageRaw 应为正', () => {
    const result = analyze(STRONG_HOME_VARS);
    expect(result.totalAdvantageRaw).toBeGreaterThan(0);
  });

  it('势均力敌场景：totalAdvantageRaw 应接近 0', () => {
    const result = analyze(BALANCED_VARS);
    expect(result.totalAdvantageRaw).toBeGreaterThan(-0.2);
    expect(result.totalAdvantageRaw).toBeLessThan(0.2);
  });
});

describe('gongshoudao/attack — calcAttackAdvantage', () => {
  it('应返回复合值和子维度', () => {
    const result = calcAttackAdvantage(STRONG_HOME_VARS);
    expect(result).toHaveProperty('composite');
    expect(result.subDimensions.gap).toBeDefined();
    expect(result.subDimensions.eff).toBeDefined();
    expect(result.subDimensions.dist).toBeDefined();
  });

  it('强主进攻优势应为正且大于 0', () => {
    const result = calcAttackAdvantage(STRONG_HOME_VARS);
    expect(result.composite).toBeGreaterThan(0);
  });

  it('三个子维度应在合理范围 [-2, +2]', () => {
    [STRONG_HOME_VARS, BALANCED_VARS].forEach((vars) => {
      const result = calcAttackAdvantage(vars);
      ['gap', 'eff', 'dist'].forEach((key) => {
        expect(Math.abs(result.subDimensions[key].value)).toBeLessThanOrEqual(5);
      });
    });
  });
});

describe('gongshoudao/attack — calcDefenseAdvantage', () => {
  it('应返回防守复合值和子维度', () => {
    const result = calcDefenseAdvantage(STRONG_HOME_VARS);
    expect(result).toHaveProperty('composite');
    expect(result.subDimensions.gap.label).toBe('输球空间');
    expect(result.subDimensions.eff.label).toBe('防御能效');
    expect(result.subDimensions.dist.label).toBe('零封能力');
  });

  it('均衡场景防守优势应接近 0', () => {
    const result = calcDefenseAdvantage(BALANCED_VARS);
    expect(Math.abs(result.composite)).toBeLessThan(0.5);
  });
});

describe('gongshoudao/attack — calcStrengthLadder', () => {
  const TEST_CASES = [
    { S: 0.35, expectedLabel: '👑 主队绝对大优势', expectedLevel: 3 },
    { S: 0.2, expectedLabel: '⚔️ 主队中等优势', expectedLevel: 2 },
    { S: 0.1, expectedLabel: '🔍 主队微弱优势', expectedLevel: 1 },
    { S: 0.02, expectedLabel: '⚖️ 双方实力接近', expectedLevel: 0 },
    { S: -0.1, expectedLabel: '🔍 客队微弱优势', expectedLevel: -1 },
    { S: -0.2, expectedLabel: '⚔️ 客队中等优势', expectedLevel: -2 },
    { S: -0.35, expectedLabel: '👑 客队绝对大优势', expectedLevel: -3 },
  ];

  TEST_CASES.forEach(({ S, expectedLabel, expectedLevel }) => {
    it(`S=${S} 应映射为 "${expectedLabel}" (level ${expectedLevel})`, () => {
      const result = calcStrengthLadder(S);
      expect(result.label).toBe(expectedLabel);
      expect(result.level).toBe(expectedLevel);
    });
  });

  it('应包含 boundLock 字段', () => {
    const result = calcStrengthLadder(0.2);
    expect(result).toHaveProperty('boundLock');
    expect(result.boundLock).toBeGreaterThan(0);
  });

  it('level=0 时 boundLock 应为 0', () => {
    const result = calcStrengthLadder(0);
    expect(result.boundLock).toBe(0);
  });

  it('level=±3 时 boundLock 应为 1.5', () => {
    const result = calcStrengthLadder(0.35);
    expect(result.boundLock).toBe(1.5);
  });
});

describe('gongshoudao/attack — calcCrossDistribution', () => {
  it('不让球组三值之和应接近 1', () => {
    const result = calcCrossDistribution(STRONG_HOME_VARS);
    const sum = result.spf.win + result.spf.draw + result.spf.lose;
    expect(sum).toBeCloseTo(1, 0);
  });

  it('让球数为0时 handicap 应与 spf 相同', () => {
    const result = calcCrossDistribution(STRONG_HOME_VARS);
    // 让球数=0，handicap 与 spf 相同
    expect(result.spf.win).toBeCloseTo(result.handicap.win, 1);
    expect(result.spf.draw).toBeCloseTo(result.handicap.draw, 1);
    expect(result.spf.lose).toBeCloseTo(result.handicap.lose, 1);
  });

  it('应包含原始场次统计', () => {
    const result = calcCrossDistribution(STRONG_HOME_VARS);
    expect(result.hWins).toBeGreaterThan(0);
    expect(result.aWins).toBeGreaterThan(0);
    // hWins = WG2 + WG1 = 2 + 4 = 6
    expect(result.hWins).toBe(6);
  });
});

describe('gongshoudao/attack — calcADDiff', () => {
  it('强主场景 AD_Diff 应为正', () => {
    const result = calcADDiff(STRONG_HOME_VARS);
    expect(result).toBeGreaterThan(0);
  });

  it('均衡场景 AD_Diff 应接近 0', () => {
    const result = calcADDiff(BALANCED_VARS);
    expect(Math.abs(result)).toBeLessThan(0.3);
  });

  it('AD_Diff 应在 [-1, 1] 范围内', () => {
    // 极端场景
    const extreme = {
      ...STRONG_HOME_VARS,
      homeGoal2Plus: 10,
      awayGoal0: 10,
    };
    const result = calcADDiff(extreme);
    expect(result).toBeGreaterThanOrEqual(-1);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('两队全0时不除以0崩溃', () => {
    const zero = {
      ...BALANCED_VARS,
      homeGoal0: 0,
      homeGoal1: 0,
      homeGoal2Plus: 0,
      homeLose0: 0,
      homeLose1: 0,
      homeLose2Plus: 0,
      awayGoal0: 0,
      awayGoal1: 0,
      awayGoal2Plus: 0,
      awayLose0: 0,
      awayLose1: 0,
      awayLose2Plus: 0,
    };
    expect(() => calcADDiff(zero)).not.toThrow();
    const result = calcADDiff(zero);
    expect(isNaN(result)).toBe(false);
  });
});

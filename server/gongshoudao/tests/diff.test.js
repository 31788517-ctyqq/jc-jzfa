/**
 * Phase 3 — P2: gongshoudao/tests/diff.test.js
 * 第五阶段：让球分析单元测试
 * 入口: diff.analyze(vars, xgHome, xgAway)
 * 实际返回: homeWinExpect/totalAdvantage2/anchor/sevenMatch/resonance/strengthGoal
 */
const diff = require('../diff');
const attack = require('../attack');
const goal = require('../goal');

const VARS = {
  homePower: 85,
  awayPower: 55,
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
  awayFieldGoalAvg: 1.0,
  awayFieldLoseAvg: 1.5,
  homeRecentGoalAvg: 1.6,
  homeRecentLoseAvg: 1.0,
  awayRecentGoalAvg: 1.2,
  awayRecentLoseAvg: 1.3,
  homeAttackEfficiency: 0.3,
  homeDefendEfficiency: 0.1,
  awayAttackEfficiency: 0.15,
  awayDefendEfficiency: 0.25,
  homeWinAward: 1.6,
  awayWinAward: 4.5,
  homeOverRate: 0.6,
  awayOverRate: 0.5,
  homeWinPanRate: 0.65,
  awayWinPanRate: 0.58,
  rq: 0,
  jiaoFenDesc: '近6次交战 2胜3平1负',
  homeGoalDiffSeries: [2, 1, 1, 1, 1, 0, 0, 0, -1, -1],
  awayGoalDiffSeries: [2, 1, 1, 1, 0, -1, -1, -2, -2, -2],
};

const BALANCED_VARS = {
  homePower: 65,
  awayPower: 63,
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
  awayFieldGoalAvg: 1.4,
  awayFieldLoseAvg: 1.3,
  homeRecentGoalAvg: 1.4,
  homeRecentLoseAvg: 1.3,
  awayRecentGoalAvg: 1.4,
  awayRecentLoseAvg: 1.3,
  homeAttackEfficiency: 0.2,
  homeDefendEfficiency: 0.15,
  awayAttackEfficiency: 0.2,
  awayDefendEfficiency: 0.15,
  homeWinAward: 2.2,
  awayWinAward: 2.8,
  homeOverRate: 0.5,
  awayOverRate: 0.5,
  homeWinPanRate: 0.5,
  awayWinPanRate: 0.5,
  rq: 0,
  jiaoFenDesc: '近6次交战 2胜2平2负',
  homeGoalDiffSeries: [2, 1, 1, 1, 0, 0, -1, -1, -2, -2],
  awayGoalDiffSeries: [2, 1, 1, 0, 0, -1, -1, -2, -2, -2],
};

describe('gongshoudao/diff — analyze', () => {
  it('应导出 analyze 函数', () => {
    expect(typeof diff.analyze).toBe('function');
  });

  it('应返回核心让球分析字段', () => {
    const S = attack.analyze(VARS).totalAdvantageRaw;
    const goalRes = goal.analyze(VARS, S);
    const result = diff.analyze(VARS, goalRes.xgHome, goalRes.xgAway);

    // 实际返回的关键字段
    expect(result).toHaveProperty('homeWinExpect');
    expect(result).toHaveProperty('totalAdvantage2');
    expect(result).toHaveProperty('anchor');
    expect(result).toHaveProperty('sevenMatch');
    expect(result).toHaveProperty('resonance');
    expect(result).toHaveProperty('strengthGoal');
  });

  describe('homeWinExpect', () => {
    it('应为字符串格式 (带符号)', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const goalRes = goal.analyze(VARS, S);
      const result = diff.analyze(VARS, goalRes.xgHome, goalRes.xgAway);
      expect(typeof result.homeWinExpect).toBe('string');
      expect(result.homeWinExpect).toMatch(/^[+\-]?\d+\.\d{2}$/);
    });
  });

  describe('totalAdvantage2 (战力百分比)', () => {
    it('应为带符号百分比字符串', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const goalRes = goal.analyze(VARS, S);
      const result = diff.analyze(VARS, goalRes.xgHome, goalRes.xgAway);
      expect(result.totalAdvantage2).toContain('%');
    });

    it('应有数字值版本', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const goalRes = goal.analyze(VARS, S);
      const result = diff.analyze(VARS, goalRes.xgHome, goalRes.xgAway);
      expect(typeof result.totalAdvantage2Raw).toBe('number');
      expect(typeof result.totalAdvantage2Value).toBe('number');
    });
  });

  describe('anchor', () => {
    it('应有结构', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const goalRes = goal.analyze(VARS, S);
      const result = diff.analyze(VARS, goalRes.xgHome, goalRes.xgAway);
      expect(result.anchor).toBeDefined();
    });
  });

  describe('sevenMatch (7场验证)', () => {
    it('应包含 dimension1 和 dimension2', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const goalRes = goal.analyze(VARS, S);
      const result = diff.analyze(VARS, goalRes.xgHome, goalRes.xgAway);
      expect(result.sevenMatch).toHaveProperty('dimension1');
      expect(result.sevenMatch).toHaveProperty('dimension2');
    });

    it('应有 verifyResult 描述', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const goalRes = goal.analyze(VARS, S);
      const result = diff.analyze(VARS, goalRes.xgHome, goalRes.xgAway);
      expect(typeof result.verifyResult).toBe('string');
      expect(typeof result.verifyValue).toBe('number');
    });
  });

  describe('resonance (共振裁决)', () => {
    it('应有结构', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const goalRes = goal.analyze(VARS, S);
      const result = diff.analyze(VARS, goalRes.xgHome, goalRes.xgAway);
      expect(result.resonance).toBeDefined();
    });
  });

  describe('strengthGoal (实力进球)', () => {
    it('应为数字', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const goalRes = goal.analyze(VARS, S);
      const result = diff.analyze(VARS, goalRes.xgHome, goalRes.xgAway);
      expect(typeof result.strengthGoal).toBe('number');
    });
  });

  describe('均衡场景', () => {
    it('totalAdvantage2Raw 应接近0', () => {
      const S = attack.analyze(BALANCED_VARS).totalAdvantageRaw;
      const goalRes = goal.analyze(BALANCED_VARS, S);
      const result = diff.analyze(BALANCED_VARS, goalRes.xgHome, goalRes.xgAway);
      expect(Math.abs(result.totalAdvantage2Raw)).toBeLessThan(0.3);
    });
  });

  describe('边界条件', () => {
    it('极端 xG 值不崩溃', () => {
      expect(() => diff.analyze(VARS, 5, 0.1)).not.toThrow();
      expect(() => diff.analyze(VARS, 0.1, 5)).not.toThrow();
      expect(() => diff.analyze(VARS, 0, 0)).not.toThrow();
    });

    it('缺失 VARS 不崩溃', () => {
      expect(() => diff.analyze({}, 1.0, 1.0)).not.toThrow();
    });
  });
});

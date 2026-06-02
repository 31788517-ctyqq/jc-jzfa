/**
 * Phase 3 — P2: gongshoudao/tests/goal.test.js
 * 第四阶段：大小球博弈算法单元测试
 * 入口: goal.analyze(vars, S)
 */
const goal = require('../goal');
const attack = require('../attack');

const VARS = {
  homeFieldGoalAvg: 1.8,
  homeFieldLoseAvg: 0.8,
  homeRecentGoalAvg: 1.6,
  homeRecentLoseAvg: 1.0,
  awayFieldGoalAvg: 1.0,
  awayFieldLoseAvg: 1.5,
  awayRecentGoalAvg: 1.2,
  awayRecentLoseAvg: 1.3,
  homeAttackEfficiency: 0.3,
  homeDefendEfficiency: 0.1,
  awayAttackEfficiency: 0.15,
  awayDefendEfficiency: 0.25,
  homePower: 85,
  awayPower: 55,
  homeWinAward: 1.6,
  awayWinAward: 4.5,
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
  homeOverRate: 0.6,
  awayOverRate: 0.5,
  homeWinPanRate: 0.65,
  awayWinPanRate: 0.58,
  jiaoFenOverRate: 0.4,
};

describe('gongshoudao/goal — analyze', () => {
  it('应导出 analyze 函数', () => {
    expect(typeof goal.analyze).toBe('function');
  });

  it('应返回核心大小球分析字段', () => {
    const S = attack.analyze(VARS).totalAdvantageRaw;
    const result = goal.analyze(VARS, S);

    // 实际返回的关键字段
    expect(result).toHaveProperty('totalGoalsExpect');
    expect(result).toHaveProperty('xgHome');
    expect(result).toHaveProperty('xgAway');
    expect(result).toHaveProperty('goalRange');
    expect(result).toHaveProperty('fieldIntensity');
  });

  describe('totalGoalsExpect', () => {
    it('应为数字字符串格式', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const result = goal.analyze(VARS, S);
      expect(typeof result.totalGoalsExpect).toBe('string');
      expect(parseFloat(result.totalGoalsExpect)).toBeGreaterThan(0);
    });
  });

  describe('xgHome / xgAway', () => {
    it('xgHome 应为正数', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const result = goal.analyze(VARS, S);
      expect(result.xgHome).toBeGreaterThan(0);
    });

    it('xgAway 应为正数', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const result = goal.analyze(VARS, S);
      expect(result.xgAway).toBeGreaterThan(0);
    });
  });

  describe('goalRange', () => {
    it('应包含 lower/upper/range', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const result = goal.analyze(VARS, S);
      expect(result.goalRange).toHaveProperty('lower');
      expect(result.goalRange).toHaveProperty('upper');
      expect(result.goalRange).toHaveProperty('range');
    });

    it('lower <= upper', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const result = goal.analyze(VARS, S);
      expect(result.goalRange.lower).toBeLessThanOrEqual(result.goalRange.upper);
    });
  });

  describe('fieldIntensity', () => {
    it('应为正数', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const result = goal.analyze(VARS, S);
      expect(result.fieldIntensity).toBeGreaterThan(0);
    });
  });

  describe('fusion (四重熔断) 字段', () => {
    it('应包含 fusionConsensus 和 fusionFinalTotal', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const result = goal.analyze(VARS, S);
      expect(result).toHaveProperty('fusionConsensus');
      expect(result).toHaveProperty('fusionFinalTotal');
    });
  });

  describe('内部权重 _weights', () => {
    it('应包含 home/away', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const result = goal.analyze(VARS, S);
      expect(result._weights).toHaveProperty('home');
      expect(result._weights).toHaveProperty('away');
    });

    it('S>0 时 wHome > 0.5', () => {
      const result = goal.analyze(VARS, 0.5);
      expect(result._weights.home).toBeGreaterThan(0.5);
    });

    it('S<0 时 wHome < 0.5', () => {
      const result = goal.analyze(VARS, -0.5);
      expect(result._weights.home).toBeLessThan(0.5);
    });
  });

  describe('攻防进球 attDefGoal', () => {
    it('应为正数', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const result = goal.analyze(VARS, S);
      expect(result.attDefGoal).toBeGreaterThan(0);
    });
  });

  describe('进球分布稳定性', () => {
    it('应包含稳定性字段', () => {
      const S = attack.analyze(VARS).totalAdvantageRaw;
      const result = goal.analyze(VARS, S);
      expect(result).toHaveProperty('goalStabilityHome');
      expect(result).toHaveProperty('goalStabilityAway');
      expect(result).toHaveProperty('stabilityOverall');
    });
  });

  describe('边界条件', () => {
    it('极端 S 值不崩溃', () => {
      [10, -10, 0].forEach((S) => {
        expect(() => goal.analyze(VARS, S)).not.toThrow();
      });
    });

    it('缺失数据不崩溃', () => {
      expect(() => goal.analyze({}, 0)).not.toThrow();
    });

    it('负数进球不应崩溃', () => {
      const bad = { ...VARS, homeFieldGoalAvg: -1 };
      expect(() => goal.analyze(bad, 0)).not.toThrow();
    });
  });
});

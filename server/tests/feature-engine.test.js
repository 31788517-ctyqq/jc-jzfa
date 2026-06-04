/**
 * P2: feature-engine.test.js — 特征工程引擎单元测试
 */
const { FeatureEngine } = require('../core/feature-engine');

describe('FeatureEngine — 实例化', () => {
  it('创建 FeatureEngine 实例', () => {
    const engine = new FeatureEngine();
    expect(engine).toBeDefined();
    expect(engine.featureVersion).toBeDefined();
  });

  it('featureVersion 应为 v1.0', () => {
    const engine = new FeatureEngine();
    expect(engine.featureVersion).toBe('v1.0');
  });
});

describe('FeatureEngine — _parseRecentResults 近期战绩解析', () => {
  let engine;
  beforeEach(function () {
    engine = new FeatureEngine();
  });

  it('空数组 → 返回全 null', () => {
    const result = engine._parseRecentResults([]);
    expect(result.winRate).toBe(null);
    expect(result.avgGoals).toBe(null);
    expect(result.avgConceded).toBe(null);
    expect(result.formScore).toBe(null);
  });

  it('非数组 → 返回全 null', () => {
    const result = engine._parseRecentResults(null);
    expect(result.winRate).toBe(null);
  });

  it('正常 6 场战绩 (3W2D1L)', () => {
    const recent = [
      { result: 'win', goalsFor: 2, goalsAgainst: 0 },
      { result: 'win', goalsFor: 3, goalsAgainst: 1 },
      { result: 'draw', goalsFor: 1, goalsAgainst: 1 },
      { result: 'win', goalsFor: 1, goalsAgainst: 0 },
      { result: 'loss', goalsFor: 0, goalsAgainst: 2 },
      { result: 'draw', goalsFor: 2, goalsAgainst: 2 },
    ];
    const result = engine._parseRecentResults(recent);
    expect(result.winRate).toBe(3 / 6);
    expect(result.avgGoals).toBeCloseTo(9 / 6, 2);
    expect(result.avgConceded).toBeCloseTo(6 / 6, 2);
    // formScore = (3*3 + 2*1)/(6*3) = 11/18
    expect(result.formScore).toBeCloseTo(11 / 18, 2);
  });

  it('超过 6 场只取最近 6 场', () => {
    const recent = Array.from({ length: 10 }, function (_, i) {
      return { result: 'win', goalsFor: 1, goalsAgainst: 0 };
    });
    const result = engine._parseRecentResults(recent);
    expect(result.winRate).toBe(1);
    expect(result.formScore).toBe(1);
  });

  it('全败战绩', () => {
    const recent = [
      { result: 'loss', goalsFor: 0, goalsAgainst: 3 },
      { result: 'loss', goalsFor: 1, goalsAgainst: 4 },
    ];
    const result = engine._parseRecentResults(recent);
    expect(result.winRate).toBe(0);
    expect(result.formScore).toBe(0);
  });

  it('W/L/D 简写兼容', () => {
    const recent = [
      { result: 'W', goalsFor: 2, goalsAgainst: 0 },
      { result: 'D', goalsFor: 1, goalsAgainst: 1 },
      { result: 'L', goalsFor: 0, goalsAgainst: 1 },
    ];
    const result = engine._parseRecentResults(recent);
    expect(result.winRate).toBe(1 / 3);
  });
});

describe('FeatureEngine — _calcEntropy 推荐熵计算', () => {
  let engine;
  beforeEach(function () {
    engine = new FeatureEngine();
  });

  it('总数为 0 → null', () => {
    expect(engine._calcEntropy(0, 0, 0, 0)).toBe(null);
  });

  it('完全一致 → 熵为 0', () => {
    const ent = engine._calcEntropy(5, 0, 0, 5);
    expect(ent).toBeCloseTo(0, 5);
  });

  it('均匀分布 → 熵接近 log2(3) = 1.585', () => {
    const ent = engine._calcEntropy(1, 1, 1, 3);
    expect(ent).toBeCloseTo(Math.log2(3), 1);
  });

  it('不均衡分布 → 熵 < 均匀分布', () => {
    const entBalanced = engine._calcEntropy(1, 1, 1, 3);
    const entSkewed = engine._calcEntropy(5, 2, 1, 8);
    expect(entSkewed).toBeLessThan(entBalanced);
  });
});

describe('FeatureEngine — _daysBetween 日期差计算', () => {
  let engine;
  beforeEach(function () {
    engine = new FeatureEngine();
  });

  it('正常 7 天差', () => {
    expect(engine._daysBetween('2026-06-01', '2026-06-08')).toBe(7);
  });

  it('同日 → 0', () => {
    expect(engine._daysBetween('2026-06-01', '2026-06-01')).toBe(0);
  });

  it('非法日期 → NaN (Invalid Date)', () => {
    const result = engine._daysBetween('not-a-date', '2026-06-01');
    expect(isNaN(result)).toBe(true);
  });
});

describe('FeatureEngine — getFeatures DB 未就绪', () => {
  it('db 为 null → 返回 {}', () => {
    const engine = new FeatureEngine();
    expect(engine.getFeatures('001', '2026-06-01', null)).toEqual({});
  });

  it('db 为 undefined → 返回 {}', () => {
    const engine = new FeatureEngine();
    expect(engine.getFeatures('001', '2026-06-01', undefined)).toEqual({});
  });
});

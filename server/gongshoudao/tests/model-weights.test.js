/**
 * P2: model-weights.test.js — 动态模型权重引擎 单元测试
 * 覆盖: computeDynamicWeights、getWeights、DEFAULT_WEIGHTS
 */
const { computeDynamicWeights, getWeights, DEFAULT_WEIGHTS } = require('../model-weights');

// ==================== DEFAULT_WEIGHTS ====================

describe('model-weights — DEFAULT_WEIGHTS 默认等权', () => {
  it('等权占比为 1/3', () => {
    expect(DEFAULT_WEIGHTS.wA).toBe(1 / 3);
    expect(DEFAULT_WEIGHTS.wB).toBe(1 / 3);
    expect(DEFAULT_WEIGHTS.wC).toBe(1 / 3);
  });

  it('三权重之和为 1', () => {
    const sum = DEFAULT_WEIGHTS.wA + DEFAULT_WEIGHTS.wB + DEFAULT_WEIGHTS.wC;
    expect(Math.abs(sum - 1)).toBeLessThan(0.001);
  });
});

// ==================== computeDynamicWeights ====================

describe('model-weights — computeDynamicWeights 动态权重计算', () => {
  // 辅助：创建模拟 predLog
  function mockPredLog(items) {
    return {
      queryBacktest: function () {
        return { items: items || [] };
      },
    };
  }

  function makeRow(overrides) {
    return Object.assign(
      {
        actual_home_goals: 2,
        actual_away_goals: 1,
        gs_modelA_total: 2.5,
        gs_modelB_total: 2.8,
        gs_modelC_total: 3.0,
      },
      overrides || {},
    );
  }

  it('predLog 为 null → 回退等权 (rows为空→insufficient)', () => {
    const result = computeDynamicWeights(null);
    expect(result.wA).toBe(DEFAULT_WEIGHTS.wA);
    expect(result.wB).toBe(DEFAULT_WEIGHTS.wB);
    expect(result.wC).toBe(DEFAULT_WEIGHTS.wC);
    // null→条件跳过→rows=[]→insufficient
    expect(result.source).toBe('insufficient');
  });

  it('predLog 无 queryBacktest 方法 → 回退等权', () => {
    const result = computeDynamicWeights({});
    // {} 无 queryBacktest → rows=[] → insufficient
    expect(result.source).toBe('insufficient');
    expect(result.wA).toBe(DEFAULT_WEIGHTS.wA);
  });

  it('样本不足20场 → 回退等权', () => {
    const rows = [];
    for (let i = 0; i < 10; i++) {
      rows.push(makeRow());
    }
    const result = computeDynamicWeights(mockPredLog(rows));
    expect(result.source).toBe('insufficient');
    expect(result.wA).toBe(1 / 3);
  });

  it('queryBacktest 抛出异常 → 回退等权', () => {
    const badPredLog = {
      queryBacktest: function () {
        throw new Error('DB error');
      },
    };
    const result = computeDynamicWeights(badPredLog);
    expect(result.source).toBe('fallback');
  });

  it('足够样本 (≥20) → 计算动态权重, source=dynamic_v3', () => {
    const rows = [];
    // actual = 2+1 = 3 goals total
    // ModelB: gs_modelB_total=2.8 → |2.8-3|=0.2 → HIT
    // ModelC: gs_modelC_total=3.0 → |3.0-3|=0.0 → HIT
    // ModelA: gs_modelA_total=2.5 → |2.5-3|=0.5 → HIT
    for (let i = 0; i < 30; i++) {
      rows.push(
        makeRow({
          gs_modelA_total: 2.5 + (i % 5) * 0.2,
          gs_modelB_total: 2.8 + (i % 3) * 0.1,
          gs_modelC_total: 3.0,
        }),
      );
    }
    const result = computeDynamicWeights(mockPredLog(rows));
    expect(result.source).toBe('dynamic_v3');
    expect(typeof result.wA).toBe('number');
    expect(typeof result.wB).toBe('number');
    expect(typeof result.wC).toBe('number');
    // 权重之和约等于 1
    expect(Math.abs(result.wA + result.wB + result.wC - 1)).toBeLessThan(0.01);
  });

  it('权重在 [0, 1] 范围内', () => {
    const rows = [];
    for (let i = 0; i < 30; i++) {
      rows.push(makeRow());
    }
    const result = computeDynamicWeights(mockPredLog(rows));
    expect(result.wA).toBeGreaterThanOrEqual(0);
    expect(result.wA).toBeLessThanOrEqual(1);
    expect(result.wB).toBeGreaterThanOrEqual(0);
    expect(result.wB).toBeLessThanOrEqual(1);
    expect(result.wC).toBeGreaterThanOrEqual(0);
    expect(result.wC).toBeLessThanOrEqual(1);
  });

  it('命中率被缩尾在 [0.3, 0.7] 之间 (B/C命中→0.7, A不命中→0.3)', () => {
    // ModelA: gs_modelA_total=10 vs actual=3 (|10-3|=7 > 0.5) → 不命中 → accuracy=0→缩尾至0.3
    // ModelB: gs_modelB_total=2.8 vs actual=3 (|2.8-3|=0.2 ≤ 0.5) → 命中 → accuracy=1.0→缩尾至0.7
    // ModelC: gs_modelC_total=3.0 vs actual=3 (|3.0-3|=0.0 ≤ 0.5) → 命中 → accuracy=1.0→缩尾至0.7
    const rows = [];
    for (let i = 0; i < 30; i++) {
      rows.push(
        makeRow({
          gs_modelA_total: 10,
          gs_modelB_total: 2.8,
          gs_modelC_total: 3.0,
        }),
      );
    }
    const result = computeDynamicWeights(mockPredLog(rows));
    // 权重范围为 [0, 1]
    expect(result.wA).toBeGreaterThan(0);
    expect(result.wA).toBeLessThan(0.5);
    expect(result.wB).toBeGreaterThan(0.3);
    expect(result.wC).toBeGreaterThan(0.3);
    // 三个权重之和为1
    expect(Math.abs(result.wA + result.wB + result.wC - 1)).toBeLessThan(0.01);
  });

  it('全未命中 → accuracy 缩尾到 0.3', () => {
    const rows = [];
    for (let i = 0; i < 30; i++) {
      rows.push(
        makeRow({
          gs_modelA_total: 10,
          gs_modelB_total: 10,
          gs_modelC_total: 10,
        }),
      );
    }
    const result = computeDynamicWeights(mockPredLog(rows));
    // accuracy 全部缩尾到 0.3，Softmax 后权重应该相等
    expect(Math.abs(result.wA - 0.3333)).toBeLessThan(0.02);
  });

  it('返回 stats 统计数据', () => {
    const rows = [];
    for (let i = 0; i < 25; i++) {
      rows.push(makeRow());
    }
    const result = computeDynamicWeights(mockPredLog(rows));
    expect(result.stats).not.toBe(null);
    expect(result.stats.modelA).toHaveProperty('accuracy');
    expect(result.stats.modelB).toHaveProperty('accuracy');
    expect(result.stats.modelC).toHaveProperty('accuracy');
  });

  it('无 actual_home_goals 的行被跳过统计', () => {
    const rows = [];
    for (let i = 0; i < 30; i++) {
      rows.push(
        makeRow({
          actual_home_goals: null,
          actual_away_goals: null,
          gs_modelA_total: null,
          gs_modelB_total: null,
          gs_modelC_total: null,
        }),
      );
    }
    // 所有行都被跳过 → model A/B/C total=0，样本不足 → partial
    const result = computeDynamicWeights(mockPredLog(rows));
    expect(result.source).toBe('partial');
  });

  it('自定义 days 参数', () => {
    const predLog = mockPredLog([makeRow(), makeRow()]);
    // 传入 days=60 仍会因为样本不足回退
    const result = computeDynamicWeights(predLog, 60);
    expect(result.source).toBe('insufficient');
  });
});

// ==================== getWeights ====================

describe('model-weights — getWeights 缓存权重获取', () => {
  // 注意: getWeights 使用模块级缓存变量，测试间可能互相影响
  // 这里测试 forceRefresh=true 和异常回退行为

  it('forceRefresh=true → 重新计算', () => {
    const predLog = {
      queryBacktest: function () {
        return { items: [] };
      },
    };
    // 样本不足 → insufficient
    const result = getWeights(predLog, true);
    expect(result.source).toBe('insufficient');
  });

  it('predLog 抛出异常 → 回退 default 权重', () => {
    const badPredLog = {
      queryBacktest: function () {
        throw new Error('boom');
      },
    };
    const result = getWeights(badPredLog, true);
    // computeDynamicWeights 内部 catch → fallback
    // getWeights 外层 catch → 缓存为空则 default
    expect(result.wA).toBe(1 / 3);
  });
});

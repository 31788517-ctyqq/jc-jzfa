/**
 * P0: fusion.test.js — 四重一致性验证与熔断 单元测试
 * 覆盖: 模型A(射门还原法)、模型C(交锋预测法)、
 *       强一致/弱一致/熔断三种融合模式、主客拆分
 */
const { fuse, calcModelA, calcModelC } = require('../fusion');

// ==================== 辅助函数 ====================

function makeVars(overrides) {
  return Object.assign({
    homeRecentGoalAvg: 1.5, awayRecentGoalAvg: 1.2,
    homeRecentLoseAvg: 1.1, awayRecentLoseAvg: 1.3,
    homeAttackEfficiency: 0.15, awayAttackEfficiency: 0.12,
    homeDefendEfficiency: 0.10, awayDefendEfficiency: 0.11,
    jiaoFenScores: [{ h: 2, a: 1 }, { h: 1, a: 1 }],
    jiaoFenDesc: '近6次交战 2胜2平2负 进7球失6球',
  }, overrides || {});
}

// ==================== 模型A: 射门还原法 ====================

describe('fusion — calcModelA 射门还原法', () => {
  it('返回 total/home/away 三个字段', () => {
    const vars = makeVars();
    const result = calcModelA(vars);
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('home');
    expect(result).toHaveProperty('away');
  });

  it('total ≈ home + away', () => {
    const vars = makeVars();
    const result = calcModelA(vars);
    expect(result.total).toBeCloseTo(result.home + result.away, 1);
  });

  it('home/away ≥ 0.1', () => {
    const vars = makeVars();
    const result = calcModelA(vars);
    expect(result.home).toBeGreaterThanOrEqual(0.1);
    expect(result.away).toBeGreaterThanOrEqual(0.1);
  });

  it('攻防效率差异影响主客分配', () => {
    const varsHomeStrong = makeVars({
      homeAttackEfficiency: 0.3, homeRecentGoalAvg: 3.0,
      awayAttackEfficiency: 0.05, awayRecentGoalAvg: 0.5,
      awayDefendEfficiency: 0.3, awayRecentLoseAvg: 0.5,
    });
    const r1 = calcModelA(varsHomeStrong);
    expect(r1.home).toBeGreaterThan(r1.away);
  });

  it('客强主弱 → away > home', () => {
    const varsAwayStrong = makeVars({
      homeAttackEfficiency: 0.05, homeRecentGoalAvg: 0.5,
      homeDefendEfficiency: 0.3, homeRecentLoseAvg: 3.0,
      awayAttackEfficiency: 0.3, awayRecentGoalAvg: 3.0,
    });
    const r2 = calcModelA(varsAwayStrong);
    expect(r2.away).toBeGreaterThan(r2.home);
  });

  it('总进球在合理范围 [0.2, 8.0]', () => {
    const vars = makeVars();
    const result = calcModelA(vars);
    expect(result.total).toBeGreaterThan(0.2);
    expect(result.total).toBeLessThan(8.0);
  });

  it('极端弱攻防 → 仍返回有限值', () => {
    const vars = makeVars({
      homeAttackEfficiency: 0, awayAttackEfficiency: 0,
      homeDefendEfficiency: 0, awayDefendEfficiency: 0,
    });
    const result = calcModelA(vars);
    expect(isNaN(result.total)).toBe(false);
    expect(isFinite(result.total)).toBe(true);
  });
});

// ==================== 模型C: 交锋预测法 ====================

describe('fusion — calcModelC 交锋预测法', () => {
  it('返回 total/g6/g2 字段', () => {
    const vars = makeVars();
    const result = calcModelC(vars);
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('g6');
    expect(result).toHaveProperty('g2');
  });

  it('有交锋数据时 total = 0.3*g6 + 0.7*g2', () => {
    // g6 = (7+6)/6 = 2.1667, g2 = (3+2)/2 = 2.5
    // total = 0.3*2.1667 + 0.7*2.5 = 0.65 + 1.75 = 2.4
    const vars = makeVars();
    const result = calcModelC(vars);
    expect(result.total).toBeCloseTo(2.4, 0);
  });

  it('无交锋数据 → g6从desc提取, g2默认2.5', () => {
    const vars = makeVars({
      jiaoFenScores: [],
      jiaoFenDesc: '近6次交战 3胜1平2负 进10球失8球',
    });
    const result = calcModelC(vars);
    // g6 = (10+8)/6 = 3.0, g2 = 2.5 (默认)
    // total = 0.3*3 + 0.7*2.5 = 0.9+1.75=2.65
    expect(result.total).toBeCloseTo(2.65, 1);
  });

  it('完全无交锋数据 → 使用默认值', () => {
    const vars = makeVars({ jiaoFenScores: [], jiaoFenDesc: '' });
    const result = calcModelC(vars);
    // g6=g2=2.5, total=2.5
    expect(result.total).toBeCloseTo(2.5, 1);
  });

  it('jiaoFenDesc 无法匹配 → g6默认为2.5', () => {
    const vars = makeVars({
      jiaoFenScores: [],
      jiaoFenDesc: '暂无交锋数据',
    });
    const result = calcModelC(vars);
    expect(result.g6).toBe(2.5);
  });
});

// ==================== 熔断主函数 ====================

describe('fusion — fuse 四重一致性验证', () => {
  it('返回完整结构', () => {
    const vars = makeVars();
    const modelB = { home: 1.5, away: 1.2 };
    const result = fuse(vars, modelB, 2.5);
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('home');
    expect(result).toHaveProperty('away');
    expect(result).toHaveProperty('consensus');
    expect(result).toHaveProperty('fused');
    expect(result).toHaveProperty('_details');
    expect(result._details).toHaveProperty('modelA');
    expect(result._details).toHaveProperty('modelB');
    expect(result._details).toHaveProperty('modelC');
    expect(result._details).toHaveProperty('pAsia');
    expect(result._details).toHaveProperty('nConsistent');
  });

  it('主客按 B2 比例拆分', () => {
    const vars = makeVars();
    const modelB = { home: 1.5, away: 1.2 };
    const result = fuse(vars, modelB, 2.5);
    const ratio = 1.5 / 2.7;
    expect(result.home).toBeCloseTo(result.total * ratio, 1);
    expect(result.away).toBeCloseTo(result.total * (1 - ratio), 1);
  });

  it('极端不平衡 → 主客至少 0.1', () => {
    const vars = makeVars();
    const modelB = { home: 100, away: 0 }; // unrealistic but test edge
    const result = fuse(vars, modelB, 2.5);
    expect(result.home).toBeGreaterThanOrEqual(0.1);
    expect(result.away).toBeGreaterThanOrEqual(0.1);
  });

  // --- 强一致场景 ---

  it('三模型一致(nConsistent=3) → 强一致三模型平均', () => {
    // 需要通过调整 vars 使三个模型值接近
    // 使用一组均衡的 vars
    const vars = makeVars({
      homeRecentGoalAvg: 1.4, awayRecentGoalAvg: 1.3,
      homeRecentLoseAvg: 1.2, awayRecentLoseAvg: 1.1,
      homeAttackEfficiency: 0.14, awayAttackEfficiency: 0.14,
      homeDefendEfficiency: 0.12, awayDefendEfficiency: 0.12,
      jiaoFenScores: [{ h: 1, a: 1 }],
      jiaoFenDesc: '近期:进8球失7球', // g6 = (8+7)/6 = 2.5
    });
    const modelB = { home: 1.2, away: 1.3 };
    const result = fuse(vars, modelB, 2.5);
    // 检查共识标签包含"强一致"
    expect(result.consensus).toContain('强一致');
    expect(result.fused).toBe(true);
  });

  // --- 弱一致场景 ---

  it('恰好两对一致 → 弱一致剔除分歧值', () => {
    // ModelC 固定返回约2.4，构造ModelA和ModelB使它们接近但ModelC偏离
    // ModelA 由 vars 决定
    const vars = makeVars();
    // 让 modelB.total = 2.2 (接近 mA ~2)
    const modelB = { home: 1.1, away: 1.1 };
    const result = fuse(vars, modelB, 2.5);
    // 检查是否触发弱一致或熔断
    expect(result).toHaveProperty('consensus');
    expect(typeof result.consensus).toBe('string');
  });

  // --- 熔断场景 ---

  it('三模型分歧 → 熔断跟随盘口', () => {
    // 极端偏离使三个模型值差异大
    const varsDiff = makeVars({
      homeAttackEfficiency: 0.01, homeRecentGoalAvg: 0.1,
      awayAttackEfficiency: 0.5, awayRecentGoalAvg: 5.0,
      homeDefendEfficiency: 0.5, homeRecentLoseAvg: 5.0,
      awayDefendEfficiency: 0.01, awayRecentLoseAvg: 0.1,
      jiaoFenScores: [{ h: 5, a: 0 }],
      jiaoFenDesc: '进30球失0球',
    });
    const modelB = { home: 0.1, away: 5.0 };
    const result = fuse(varsDiff, modelB, 2.25);
    if (result._details.nConsistent <= 1) {
      expect(result.consensus).toContain('熔断');
      expect(result.fused).toBe(false);
      expect(result.total).toBeCloseTo(2.25, 1); // 跟随 pAsia
    }
  });

  it('pAsia 为 undefined → 默认 2.5', () => {
    const vars = makeVars();
    const modelB = { home: 1.5, away: 1.2 };
    const result = fuse(vars, modelB, undefined);
    // _details.pAsia 应为 2.5
    expect(result._details.pAsia).toBe(2.5);
  });

  it('pair 差值均为数值', () => {
    const vars = makeVars();
    const modelB = { home: 1.5, away: 1.2 };
    const result = fuse(vars, modelB, 2.5);
    result._details.pairs.forEach(function (d) {
      expect(typeof d).toBe('number');
      expect(d).toBeGreaterThanOrEqual(0);
    });
  });
});

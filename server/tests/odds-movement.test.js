/**
 * P2: odds-movement.test.js — 盘口变化检测 单元测试
 * 覆盖: analyzeMovement、checkEuroAsiaConsistency
 */
const { analyzeMovement, checkEuroAsiaConsistency } = require('../core/odds-movement');

// ==================== analyzeMovement ====================

describe('odds-movement — analyzeMovement 盘口位移检测', () => {
  it('无效赔率 (≤1.0) → 返回默认结果 (盘口稳定)', () => {
    const result = analyzeMovement(
      { home: 1.0, draw: 3.0, away: 4.0 },
      { home: 1.0, draw: 3.0, away: 4.0 },
      0
    );
    expect(result.direction).toBe('盘口稳定');
    expect(result.penalty).toBe(0);
    expect(result.severity).toBe('none');
  });

  it('参数为 null → 返回默认结果', () => {
    const result = analyzeMovement(null, { home: 2.0, draw: 3.0, away: 4.0 }, 0);
    expect(result.direction).toBe('盘口稳定');
    expect(result.penalty).toBe(0);
  });

  it('参数为 undefined → 返回默认结果', () => {
    const result = analyzeMovement(undefined, undefined, 0);
    expect(result.direction).toBe('盘口稳定');
  });

  it('盘口稳定 (probShift < 0.02) → direction=盘口稳定', () => {
    const result = analyzeMovement(
      { home: 2.10, draw: 3.20, away: 3.50 },
      { home: 2.08, draw: 3.25, away: 3.45 },
      0.1
    );
    expect(result.direction).toBe('盘口稳定');
    expect(result.severity).toBe('none');
    expect(result.penalty).toBe(0);
  });

  it('主胜微降水 (0.02 < probShift ≤ 0.05, pwScore≥0) → 无penalty', () => {
    // 初盘→即时盘小幅变化 (probShift ≈ 0.025)
    const result = analyzeMovement(
      { home: 2.20, draw: 3.20, away: 3.30 },
      { home: 2.08, draw: 3.30, away: 3.45 },
      0.15 // 模型也看好主队，不矛盾
    );
    expect(result.direction).toBe('主胜微降水');
    expect(result.penalty).toBe(0);
  });

  it('主胜微降水 + 模型看客胜 (pwScore < -0.08) → penalty=8', () => {
    // 小幅变化但方向与模型相反
    const result = analyzeMovement(
      { home: 2.30, draw: 3.20, away: 3.10 },
      { home: 2.15, draw: 3.30, away: 3.25 },
      -0.15 // 模型看客胜，矛盾
    );
    expect(result.direction).toBe('主胜微降水');
    expect(result.penalty).toBe(8);
  });

  it('主胜降水 (probShift > 0.05, pwScore≥0) → direction标记市场看好', () => {
    const result = analyzeMovement(
      { home: 3.00, draw: 3.20, away: 2.30 },
      { home: 1.80, draw: 3.50, away: 4.50 },
      0.1
    );
    expect(result.direction).toBe('主胜降水（市场看好主队）');
    expect(result.penalty).toBe(0);
  });

  it('主胜降水 + 模型看客胜 (pwScore < -0.1) → penalty=15, severity=significant', () => {
    const result = analyzeMovement(
      { home: 3.00, draw: 3.20, away: 2.30 },
      { home: 1.80, draw: 3.50, away: 4.50 },
      -0.2
    );
    expect(result.direction).toBe('主胜降水（市场看好主队）');
    expect(result.penalty).toBe(15);
    expect(result.severity).toBe('significant');
  });

  it('主胜升水 (probShift < -0.05, pwScore≤0) → 市场看衰主队', () => {
    const result = analyzeMovement(
      { home: 2.00, draw: 3.20, away: 3.80 },
      { home: 3.00, draw: 3.20, away: 2.30 },
      -0.1
    );
    expect(result.direction).toBe('主胜升水（市场看衰主队）');
    expect(result.penalty).toBe(0);
  });

  it('主胜升水 + 模型看主胜 (pwScore > 0.1) → penalty=15', () => {
    const result = analyzeMovement(
      { home: 2.00, draw: 3.20, away: 3.80 },
      { home: 3.00, draw: 3.20, away: 2.30 },
      0.2
    );
    expect(result.direction).toBe('主胜升水（市场看衰主队）');
    expect(result.penalty).toBe(15);
    expect(result.severity).toBe('significant');
  });

  it('主胜微升水 (probShift < -0.02, pwScore≤0) → 无penalty', () => {
    // 小幅反方向变化，不超过 0.04 → severity 由末尾规则判定
    const result = analyzeMovement(
      { home: 2.30, draw: 3.20, away: 3.00 },
      { home: 2.50, draw: 3.20, away: 2.80 },
      -0.05
    );
    expect(result.direction).toBe('主胜微升水');
    expect(result.penalty).toBe(0);
  });

  it('主胜微升水 + pwScore > 0.08 → penalty=8', () => {
    const result = analyzeMovement(
      { home: 2.20, draw: 3.20, away: 3.20 },
      { home: 2.50, draw: 3.20, away: 2.80 },
      0.12
    );
    expect(result.direction).toBe('主胜微升水');
    expect(result.penalty).toBe(8);
    expect(result.severity).toBe('moderate');
  });

  it('返回隐含概率和位移值', () => {
    const result = analyzeMovement(
      { home: 2.00, draw: 3.20, away: 4.00 },
      { home: 1.80, draw: 3.50, away: 5.00 },
      0.1
    );
    expect(result.openHomeWinProb).toBeGreaterThan(0);
    expect(result.liveHomeWinProb).toBeGreaterThan(0);
    expect(typeof result.probShift).toBe('number');
    expect(typeof result.waterChange).toBe('number');
  });

  it('大幅变化 → severity=significant', () => {
    const result = analyzeMovement(
      { home: 3.50, draw: 3.20, away: 2.10 },
      { home: 1.60, draw: 4.00, away: 5.50 },
      0
    );
    expect(result.severity).toBe('significant');
    expect(['主胜降水（市场看好主队）']).toContain(result.direction);
  });
});

// ==================== checkEuroAsiaConsistency ====================

describe('odds-movement — checkEuroAsiaConsistency 欧亚一致性', () => {
  it('无效赔率 → 返回默认 (consistent=true)', () => {
    const result = checkEuroAsiaConsistency(null, 0.5, 0.1);
    expect(result.consistent).toBe(true);
    expect(result.penalty).toBe(0);
  });

  it('home赔率≤1.0 → 返回默认', () => {
    const result = checkEuroAsiaConsistency({ home: 1.0, draw: 3.0, away: 4.0 }, 0.5, 0.1);
    expect(result.consistent).toBe(true);
  });

  it('欧亚一致 (欧赔看好主队 + 亚盘主让) → consistent=true', () => {
    const result = checkEuroAsiaConsistency(
      { home: 1.80, draw: 3.50, away: 4.50 },
      0.5, // 主让半球
      0.15 // 模型也看好主队
    );
    expect(result.consistent).toBe(true);
    expect(result.detail).toContain('欧亚一致');
    expect(result.penalty).toBe(0);
  });

  it('欧亚不一致 (欧赔看好主队 + 亚盘客让) → consistent=false, penalty=12', () => {
    const result = checkEuroAsiaConsistency(
      { home: 1.80, draw: 3.50, away: 4.50 },
      -0.5, // 客让半球 → 亚盘看好客队
      0
    );
    expect(result.consistent).toBe(false);
    expect(result.detail).toContain('欧亚不一致');
    expect(result.penalty).toBe(12);
  });

  it('欧亚不一致 (欧赔看好客队 + 亚盘主让) → consistent=false', () => {
    const result = checkEuroAsiaConsistency(
      { home: 4.50, draw: 3.50, away: 1.80 },
      0.5, // 主让 → 亚盘看好主队，欧赔看好客队
      0
    );
    expect(result.consistent).toBe(false);
    expect(result.detail).toContain('欧亚不一致');
    expect(result.penalty).toBe(12);
  });

  it('欧亚一致 + 模型方向与市场不一致 (pwScore>0.1, 市场看客队) → penalty=10', () => {
    const result = checkEuroAsiaConsistency(
      { home: 4.50, draw: 3.50, away: 1.80 },
      0, // 平手盘
      0.2 // 模型看好主队 → 与市场方向不一致
    );
    expect(result.consistent).toBe(true);
    expect(result.detail).toContain('不一致');
    expect(result.penalty).toBe(10);
  });

  it('平手盘 (rq=0) → 亚盘无方向，欧赔方向决定', () => {
    const result = checkEuroAsiaConsistency(
      { home: 2.50, draw: 3.20, away: 2.80 },
      0,
      0
    );
    // 欧赔 home<away → 看好主队，亚盘 rq=0 → 不看好主队 → 不一致
    // 但 asianFavorsHome = rq>0 = false, euroFavorsHome = true → 不一致
    expect(result.consistent).toBe(false);
  });

  it('极端赔率边界 → 不崩溃', () => {
    const result = checkEuroAsiaConsistency(
      { home: 15.0, draw: 8.0, away: 1.15 },
      2.5,
      -0.5
    );
    expect(typeof result.consistent).toBe('boolean');
    expect(typeof result.penalty).toBe('number');
  });
});

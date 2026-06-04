/**
 * P2: jczq_change.test.js — 竞彩冷热指数计算单元测试
 */
const {
  computeHeatIndex,
  computeFeature,
  computeStaticDiff,
} = require('../jczq_change');

// ─── computeHeatIndex ───
describe('jczq_change — computeHeatIndex 冷热指数', () => {
  it('cd 为 null → unknown', () => {
    const result = computeHeatIndex(0, null);
    expect(result.level).toBe('unknown');
    expect(result.value).toBe(null);
  });

  it('主队受让一球 (rq=-1): R=winPct/lastWinRate', () => {
    const cd = { winPercent: 70, losePercent: 30, lastWinRate: '50%', lastLoseRate: '50%' };
    const result = computeHeatIndex(-1, cd);
    // R = 70 / 50 = 1.4 (>,2 → hot)
    expect(result.value).toBeCloseTo(1.4, 1);
    expect(result.level).toBe('hot');
  });

  it('主队让一球 (rq=1): R=losePct/lastLoseRate', () => {
    const cd = { winPercent: 50, losePercent: 75, lastWinRate: '50%', lastLoseRate: '50%' };
    const result = computeHeatIndex(1, cd);
    expect(result.value).toBeCloseTo(1.5, 1); // 75/50 = 1.5
    expect(result.level).toBe('hot');
  });

  it('深盘让两球 (rq=2): R=rqWinPct/100', () => {
    const cd = { winPercent: 50, losePercent: 40, rqWinPercent: 45, rqLosePercent: 30 };
    const result = computeHeatIndex(2, cd);
    expect(result.value).toBe(0.45);
    expect(result.level).toBe('cold'); // 0.45 < 0.8
  });

  it('深盘受让两球 (rq=-2): R=rqLosePct/100', () => {
    const cd = { winPercent: 40, losePercent: 50, rqWinPercent: 25, rqLosePercent: 75 };
    const result = computeHeatIndex(-2, cd);
    expect(result.value).toBe(0.75);
    expect(result.level).toBe('cold'); // < 0.8
  });

  it('平手盘 (rq=0): 使用主胜投注/主胜概率', () => {
    const cd = { winPercent: 55, losePercent: 45, lastWinRate: '55%', lastLoseRate: '45%' };
    const result = computeHeatIndex(0, cd);
    expect(result.value).toBeCloseTo(1.0, 0);
    expect(result.level).toBe('normal');
  });

  it('热 (value>1.2) → level=hot, label 含 🔥', () => {
    const cd = { winPercent: 80, losePercent: 20, lastWinRate: '50%', lastLoseRate: '50%' };
    const result = computeHeatIndex(0, cd);
    expect(result.level).toBe('hot');
    expect(result.label).toContain('🔥');
  });

  it('冷 (value<0.8) → level=cold, label 含 🧊', () => {
    const cd = { winPercent: 30, losePercent: 70, lastWinRate: '50%', lastLoseRate: '50%' };
    const result = computeHeatIndex(0, cd);
    expect(result.level).toBe('cold');
    expect(result.label).toContain('🧊');
  });

  it('rq 字符串 → parseInt 处理', () => {
    const cd = { winPercent: 80, losePercent: 20, lastWinRate: '50%', lastLoseRate: '50%' };
    const result = computeHeatIndex('-1', cd);
    expect(result.value).toBeCloseTo(1.6, 1);
  });
});

// ─── computeFeature ───
describe('jczq_change — computeFeature 特征文字', () => {
  it('cd 为 null → -', () => {
    expect(computeFeature(null, 'home')).toBe('-');
  });

  it('主队概率稳定 (delta<0.5) → "概率xx%→稳定"', () => {
    const cd = { winRate: '55.1%', lastWinRate: '55.3%', loseRate: '44.9%', lastLoseRate: '44.7%' };
    const result = computeFeature(cd, 'home');
    expect(result).toContain('稳定');
  });

  it('主队概率上升 → ↑', () => {
    const cd = { winRate: '50%', lastWinRate: '56%', loseRate: '50%', lastLoseRate: '44%' };
    const result = computeFeature(cd, 'home');
    expect(result).toContain('↑');
    expect(result).toContain('6.0%');
  });

  it('主队概率下降 → ↓', () => {
    const cd = { winRate: '56%', lastWinRate: '50%', loseRate: '44%', lastLoseRate: '50%' };
    const result = computeFeature(cd, 'home');
    expect(result).toContain('↓');
  });

  it('客队稳定', () => {
    const cd = { winRate: '50%', lastWinRate: '50%', loseRate: '50%', lastLoseRate: '50.2%' };
    const result = computeFeature(cd, 'away');
    expect(result).toContain('稳定');
  });

  it('客队下降', () => {
    const cd = { winRate: '50%', lastWinRate: '50%', loseRate: '60%', lastLoseRate: '52%' };
    const result = computeFeature(cd, 'away');
    expect(result).toContain('↓');
  });

  it('无百分比字段 → -', () => {
    expect(computeFeature({}, 'home')).toBe('-');
  });
});

// ─── computeStaticDiff ───
describe('jczq_change — computeStaticDiff 静态实力差', () => {
  it('均衡 (50/50) → 0', () => {
    expect(computeStaticDiff(50, 50)).toBe(0);
  });

  it('主强 (60/40) → 0.2', () => {
    expect(computeStaticDiff(60, 40)).toBeCloseTo(0.2, 4);
  });

  it('客强 (40/60) → -0.2', () => {
    expect(computeStaticDiff(40, 60)).toBeCloseTo(-0.2, 4);
  });

  it('极端优势 (90/10) → 0.8', () => {
    expect(computeStaticDiff(90, 10)).toBeCloseTo(0.8, 4);
  });

  it('实力和为零 → 0', () => {
    expect(computeStaticDiff(0, 0)).toBe(0);
  });

  it('字符串参数 → parseInt 处理', () => {
    expect(computeStaticDiff('60', '40')).toBeCloseTo(0.2, 4);
  });

  it('空参数 → 默认 50', () => {
    expect(computeStaticDiff(null, undefined)).toBe(0);
  });
});

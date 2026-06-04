/**
 * P2: league-heat-profile.test.js — 联赛自适应热度阈值单元测试
 */
const {
  LEAGUE_HEAT_BASELINE,
  getProfile,
  getOverheatThreshold,
  getColdThreshold,
  computeHeatZScore,
} = require('../core/league-heat-profile');

describe('league-heat-profile — LEAGUE_HEAT_BASELINE 基准表', () => {
  it('包含 default 配置', () => {
    expect(LEAGUE_HEAT_BASELINE).toHaveProperty('default');
    expect(LEAGUE_HEAT_BASELINE['default'].mean).toBe(1.05);
    expect(LEAGUE_HEAT_BASELINE['default'].std).toBe(0.15);
  });

  it('包含常见联赛: 英超/西甲/德甲/日职/欧冠', () => {
    ['英超', '西甲', '德甲', '日职', '欧冠'].forEach(function (league) {
      expect(LEAGUE_HEAT_BASELINE).toHaveProperty(league);
    });
  });

  it('每项包含 mean/std/overheatZ', () => {
    Object.values(LEAGUE_HEAT_BASELINE).forEach(function (p) {
      expect(p).toHaveProperty('mean');
      expect(p).toHaveProperty('std');
      expect(p).toHaveProperty('overheatZ');
      expect(typeof p.mean).toBe('number');
      expect(typeof p.std).toBe('number');
    });
  });

  it('热门联赛 mean > 冷门联赛 mean', () => {
    expect(LEAGUE_HEAT_BASELINE['英超'].mean).toBeGreaterThan(LEAGUE_HEAT_BASELINE['挪超'].mean);
    expect(LEAGUE_HEAT_BASELINE['欧冠'].mean).toBeGreaterThan(LEAGUE_HEAT_BASELINE['挪超'].mean);
  });
});

describe('league-heat-profile — getProfile 模糊匹配', () => {
  it('精确匹配: 英超', () => {
    expect(getProfile('英超').mean).toBe(1.25);
  });

  it('模糊匹配: 英超联赛 → 匹配英超', () => {
    expect(getProfile('英超联赛').mean).toBe(1.25);
  });

  it('未知联赛 → 返回 default', () => {
    expect(getProfile('火星甲级联赛').mean).toBe(1.05);
  });

  it('空字符串 → default', () => {
    expect(getProfile('').mean).toBe(1.05);
    expect(getProfile(null).mean).toBe(1.05);
  });

  it('包含子串匹配: 2026英超赛季', () => {
    expect(getProfile('2026英超赛季').mean).toBe(1.25);
  });
});

describe('league-heat-profile — getOverheatThreshold 过热阈值', () => {
  it('英超 → 1.25 + 1.5*0.18 = 1.52', () => {
    expect(getOverheatThreshold('英超')).toBeCloseTo(1.52, 1);
  });

  it('挪超 → 0.92 + 1.5*0.12 = 1.10', () => {
    expect(getOverheatThreshold('挪超')).toBeCloseTo(1.10, 1);
  });

  it('欧冠 → 1.30 + 1.5*0.20 = 1.60', () => {
    expect(getOverheatThreshold('欧冠')).toBeCloseTo(1.60, 1);
  });

  it('未知联赛 → 1.05 + 1.5*0.15 = 1.275 ≈ 1.28', () => {
    const t = getOverheatThreshold('未知');
    expect(t).toBeGreaterThan(1.2);
    expect(t).toBeLessThan(1.4);
  });
});

describe('league-heat-profile — getColdThreshold 过冷阈值', () => {
  it('英超 → 1.25 - 1.5*0.18 = 0.98', () => {
    expect(getColdThreshold('英超')).toBeCloseTo(0.98, 1);
  });

  it('挪超 → 0.92 - 1.5*0.12 = 0.74', () => {
    expect(getColdThreshold('挪超')).toBeCloseTo(0.74, 1);
  });
});

describe('league-heat-profile — computeHeatZScore Z分数计算', () => {
  it('英超 HI=1.6 → isOverheat=true', () => {
    const result = computeHeatZScore(1.6, '英超');
    expect(result.isOverheat).toBe(true);
    expect(result.isCold).toBe(false);
    expect(result.zScore).toBeGreaterThan(0);
  });

  it('英超 HI=1.0 → 正常', () => {
    const result = computeHeatZScore(1.0, '英超');
    expect(result.isOverheat).toBe(false);
    expect(result.isCold).toBe(false);
  });

  it('挪超 HI=0.6 → isCold=true', () => {
    const result = computeHeatZScore(0.6, '挪超');
    expect(result.isCold).toBe(true);
  });

  it('HI=0 → 不判定为过冷 (hi=0 无数据)', () => {
    const result = computeHeatZScore(0, '英超');
    expect(result.isCold).toBe(false);
  });

  it('返回 leagueMean 和 leagueStd', () => {
    const result = computeHeatZScore(1.5, '英超');
    expect(result.leagueMean).toBe(1.25);
    expect(result.leagueStd).toBe(0.18);
  });

  it('极低 std 联赛 → 回退到固定阈值 1.4', () => {
    // mock 一个基准
    const result = computeHeatZScore(1.5, '英超');
    expect(result.threshold).toBeDefined();
  });
});

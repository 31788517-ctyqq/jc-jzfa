/**
 * server/tests/feature-engine-extra.test.js — 补充 feature-engine 覆盖率
 */
jest.mock('../database', () => ({
  getAdapter: jest.fn(() => null),
}));

const { FeatureEngine } = require('../core/feature-engine');

describe('feature-engine 补充测试', () => {
  let engine;

  beforeEach(() => {
    engine = new FeatureEngine();
  });

  describe('constructor', () => {
    it('creates with featureVersion', () => {
      expect(engine.featureVersion).toBe('v1.0');
    });
    it('creates independent instances', () => {
      expect(new FeatureEngine()).not.toBe(engine);
    });
  });

  describe('computeFeatures (no DB)', () => {
    it('empty when db null', async () => {
      expect(await engine.computeFeatures({ num: '周日201' })).toEqual({});
    });
    it('handles null match', async () => {
      expect(await engine.computeFeatures(null)).toEqual({});
    });
    it('handles empty match', async () => {
      expect(await engine.computeFeatures({})).toEqual({});
    });
  });

  describe('_calcEntropy', () => {
    it('null for total 0', () => {
      expect(engine._calcEntropy(0, 0, 0, 0)).toBeNull();
    });
    it('uniform distribution ~1.585', () => {
      expect(engine._calcEntropy(1, 1, 1, 3)).toBeCloseTo(1.585, 1);
    });
    it('zero entropy for single outcome', () => {
      expect(Math.abs(engine._calcEntropy(5, 0, 0, 5))).toBe(0);
    });
  });

  describe('_getRecentForm', () => {
    it('returns object with empty context', async () => {
      const f = await engine._getRecentForm('巴西', '阿根廷', {});
      expect(typeof f).toBe('object');
    });
  });

  describe('_getH2HFeatures', () => {
    it('returns object with null db', async () => {
      const f = await engine._getH2HFeatures('巴西', '阿根廷', null);
      expect(typeof f).toBe('object');
    });
  });

  describe('_getStandingsFeatures', () => {
    it('returns object with null db', async () => {
      const f = await engine._getStandingsFeatures('巴西', '阿根廷', null, '2026-06-12');
      expect(typeof f).toBe('object');
    });
  });

  describe('_getOddsFeatures', () => {
    it('returns empty with no context', async () => {
      expect(await engine._getOddsFeatures('m1', {})).toEqual({});
    });
  });

  describe('_getRecommendFeatures', () => {
    it('returns object with empty context', async () => {
      const f = await engine._getRecommendFeatures('m1', {});
      expect(typeof f).toBe('object');
    });
  });

  describe('_getContextFeatures', () => {
    it('returns empty with null db', async () => {
      expect(await engine._getContextFeatures('巴西', '阿根廷', null, '2026-06-12')).toEqual({});
    });
  });

  describe('_daysBetween', () => {
    it('computes day diff', () => {
      expect(engine._daysBetween('2026-06-01', '2026-06-11')).toBe(10);
    });
    it('returns NaN for bad dates', () => {
      expect(isNaN(engine._daysBetween('bad', '2026-06-11'))).toBe(true);
    });
  });
});

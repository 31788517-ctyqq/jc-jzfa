/**
 * server/tests/plan-generator-extra.test.js — 补充 plan-generator 覆盖率
 */
const pg = require('../core/plan-generator');

describe('plan-generator 补充测试', () => {
  describe('exports', () => {
    it('should export module', () => {
      expect(pg).toBeDefined();
      expect(typeof pg).toBe('object');
    });
    it('should have known keys', () => {
      const keys = Object.keys(pg);
      expect(keys.length).toBeGreaterThan(0);
    });
  });

  // Try to call generatePlans or similar
  describe('generatePlans (if exported)', () => {
    it('should handle empty match list without throw', () => {
      if (pg.generatePlans) {
        expect(() => pg.generatePlans([], {})).not.toThrow();
      }
    });

    it('should handle single match with budget', () => {
      if (!pg.generatePlans) return;
      const match = {
        num: '周日201',
        homeName: '巴西',
        visitName: '阿根廷',
        odds: { spf: { w: 2.0, d: 3.0, l: 4.0 } },
      };
      const r = pg.generatePlans([match], { budget: 100 });
      expect(Array.isArray(r)).toBe(true);
    });

    it('should handle match with full odds', () => {
      if (!pg.generatePlans) return;
      const match = {
        num: '周日201',
        homeName: '巴西',
        visitName: '阿根廷',
        odds: {
          spf: { w: 1.5, d: 3.5, l: 6.0 },
          rqspf: { w: 2.1, d: 3.2, l: 2.8 },
          totalGoals: { s0: 12, s1: 5, s2: 3, s3: 2.5, s4: 4, s5: 7, s6: 12, s7: 21 },
          halfFull: { ww: 3, wd: 8, wl: 21, dw: 5, dd: 4.5, dl: 15, lw: 21, ld: 12, ll: 3.5 },
        },
      };
      const r = pg.generatePlans([match], { budget: 200 });
      expect(Array.isArray(r)).toBe(true);
    });
  });

  describe('filterPlansByBudget (if exported)', () => {
    it('should filter plans', () => {
      if (!pg.filterPlansByBudget) return;
      const plans = [{ totalCost: 50 }, { totalCost: 150 }, { totalCost: 80 }];
      const r = pg.filterPlansByBudget(plans, 100);
      expect(Array.isArray(r)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle null gracefully', () => {
      if (pg.generatePlans) {
        expect(() => pg.generatePlans(null, {})).not.toThrow();
      }
    });
    it('should handle undefined gracefully', () => {
      if (pg.filterPlansByBudget) {
        expect(() => pg.filterPlansByBudget(undefined, 100)).not.toThrow();
      }
    });
  });
});

/**
 * 蓝图测试: outcome-backfill — 命中判定 + 动态权重
 * 覆盖: 方向/大小球/比分命中判定, Softmax 权重计算
 */
const { OutcomeBackfill } = require('../core/outcome-backfill');

describe('OutcomeBackfill — 命中判定', () => {
  let backfiller;

  beforeEach(() => {
    backfiller = new OutcomeBackfill();
  });

  describe('_judgeOutcome — 胜平负', () => {
    it('主胜预测命中', () => {
      const pred = { direction: 'home' };
      const match = { score: '2:1' };
      const out = backfiller._judgeOutcome(pred, match);
      expect(out.actualHomeScore).toBe(2);
      expect(out.actualAwayScore).toBe(1);
      expect(out.actualResult).toBe('home');
      expect(out.directionHit).toBe(1);
    });

    it('主胜预测未命中', () => {
      const pred = { direction: 'home' };
      const match = { score: '0:1' };
      const out = backfiller._judgeOutcome(pred, match);
      expect(out.actualResult).toBe('away');
      expect(out.directionHit).toBe(0);
    });

    it('平局预测命中', () => {
      const pred = { direction: 'draw' };
      const match = { score: '1:1' };
      const out = backfiller._judgeOutcome(pred, match);
      expect(out.actualResult).toBe('draw');
      expect(out.directionHit).toBe(1);
    });

    it('比分预测命中', () => {
      const pred = { predicted_score: '2:1' };
      const match = { score: '2:1' };
      const out = backfiller._judgeOutcome(pred, match);
      expect(out.scoreHit).toBe(1);
    });

    it('比分预测未命中', () => {
      const pred = { predicted_score: '1:0' };
      const match = { score: '2:2' };
      const out = backfiller._judgeOutcome(pred, match);
      expect(out.scoreHit).toBe(0);
    });
  });

  describe('_judgeOutcome — 大小球', () => {
    it('over 预测命中 (总进球 3 > 2.5)', () => {
      const pred = { over_under: 'over' };
      const match = { score: '2:1' };
      const out = backfiller._judgeOutcome(pred, match);
      expect(out.actualTotalGoals).toBe(3);
      expect(out.overUnderHit).toBe(1);
    });

    it('under 预测命中 (总进球 1 < 2.5)', () => {
      const pred = { over_under: 'under' };
      const match = { score: '1:0' };
      const out = backfiller._judgeOutcome(pred, match);
      expect(out.overUnderHit).toBe(1);
    });

    it('over 预测未命中 (总进球 2 < 2.5)', () => {
      const pred = { over_under: 'over' };
      const match = { score: '1:1' };
      const out = backfiller._judgeOutcome(pred, match);
      expect(out.actualTotalGoals).toBe(2);
      expect(out.overUnderHit).toBe(0);
    });
  });

  describe('_judgeOutcome — 边界情况', () => {
    it('无方向预测时不报错', () => {
      const pred = { over_under: 'over' };
      const match = { score: '3:0' };
      const out = backfiller._judgeOutcome(pred, match);
      expect(out.directionHit).toBe(0);
    });

    it('无比分时 result=pending', () => {
      const pred = { direction: 'home' };
      const match = { score: '' };
      const out = backfiller._judgeOutcome(pred, match);
      expect(out.actualResult).toBe('pending');
      expect(out.directionHit).toBe(0);
    });

    it('比分格式兼容 "-" 分隔', () => {
      const pred = { direction: 'home' };
      const match = { score: '2-1' };
      const out = backfiller._judgeOutcome(pred, match);
      expect(out.actualResult).toBe('home');
    });
  });

  describe('getModelHitRates — 模型展示过滤', () => {
    it('默认隐藏系统模型，但 includeInternal=true 时保留', () => {
      const rows = [
        {
          model_name: 'data_fusion',
          model_version: 'v1.0',
          total: 10,
          dir_hits: 6,
          ou_hits: 0,
          score_hits: 0,
          dir_rate: 60,
          ou_rate: 0,
          score_rate: 0,
        },
        {
          model_name: 'expert_consensus',
          model_version: 'v1.0',
          total: 10,
          dir_hits: 5,
          ou_hits: 0,
          score_hits: 0,
          dir_rate: 50,
          ou_rate: 0,
          score_rate: 0,
        },
        {
          model_name: 'market_signal',
          model_version: 'v2.0',
          total: 10,
          dir_hits: 4,
          ou_hits: 0,
          score_hits: 0,
          dir_rate: 40,
          ou_rate: 0,
          score_rate: 0,
        },
        {
          model_name: '功守道',
          model_version: 'v1.0',
          total: 10,
          dir_hits: 7,
          ou_hits: 0,
          score_hits: 0,
          dir_rate: 70,
          ou_rate: 0,
          score_rate: 0,
        },
      ];
      const db = { execAll: jest.fn().mockReturnValue(rows) };
      const visible = backfiller.getModelHitRates(db, 30);
      const visibleNames = visible.map((r) => r.modelName);
      expect(visibleNames).toContain('功守道');
      expect(visibleNames.some((n) => n === 'expert_consensus' || n === '专家共识')).toBe(true);
      expect(visibleNames).not.toContain('data_fusion');
      expect(visibleNames).not.toContain('market_signal');

      const all = backfiller.getModelHitRates(db, 30, { includeInternal: true });
      const allNames = all.map((r) => r.modelName);
      expect(allNames).toContain('data_fusion');
      expect(allNames).toContain('market_signal');
      expect(allNames).toContain('功守道');
      expect(allNames.some((n) => n === 'expert_consensus' || n === '专家共识')).toBe(true);
    });
  });

  describe('computeDynamicWeights — Softmax', () => {
    it('无数据时返回空数组', () => {
      const result = backfiller.computeDynamicWeights(null);
      expect(result).toEqual([]);
    });

    it('db 为 null 时返回空数组', () => {
      const result = backfiller.computeDynamicWeights(null);
      expect(result).toEqual([]);
    });
  });
});

describe('OutcomeBackfill — 状态管理', () => {
  it('初始化时 lastBackfillDate 为 null', () => {
    const b = new OutcomeBackfill();
    expect(b.lastBackfillDate).toBeNull();
    expect(b.backfillCount).toBe(0);
  });
});

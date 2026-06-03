/**
 * 蓝图测试: prediction-fusion — 融合引擎
 * 覆盖: 模型注册、共识判定、维度融合、动态权重
 */
const { PredictionFusionEngine } = require('../core/prediction-fusion');

// Mock database
jest.mock('../database', () => ({
  getAdapter: () => ({
    execOne: jest.fn().mockReturnValue(null),
    execAll: jest.fn().mockReturnValue([]),
    execRun: jest.fn().mockReturnValue({ changes: 1 }),
  }),
}));

describe('PredictionFusionEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new PredictionFusionEngine();
  });

  describe('init — 模型注册', () => {
    it('init 后注册 6 个模型', () => {
      engine.init();
      expect(engine.adapters.size).toBe(6);
    });

    it('getModels 返回模型列表', () => {
      engine.init();
      const models = engine.getModels();
      expect(models.length).toBe(6);
      expect(models[0]).toHaveProperty('modelName');
      expect(models[0]).toHaveProperty('dimensions');
    });
  });

  describe('_assessConsensus — 共识判定', () => {
    function mockPred(model, direction) {
      return { modelName: model, direction };
    }

    it('6/6 一致 → strong', () => {
      const preds = [
        mockPred('a', 'home'), mockPred('b', 'home'), mockPred('c', 'home'),
        mockPred('d', 'home'), mockPred('e', 'home'), mockPred('f', 'home'),
      ];
      const result = engine._assessConsensus(preds);
      expect(result.level).toBe('strong');
      expect(result.agreeCount).toBe(6);
      expect(result.agreeRatio).toBe(1.0);
    });

    it('5/6 一致 → strong (≥80%)', () => {
      const preds = [
        mockPred('a', 'home'), mockPred('b', 'home'), mockPred('c', 'home'),
        mockPred('d', 'home'), mockPred('e', 'home'), mockPred('f', 'away'),
      ];
      const result = engine._assessConsensus(preds);
      expect(result.level).toBe('strong');
    });

    it('4/6 一致 → weak (≥60%)', () => {
      const preds = [
        mockPred('a', 'home'), mockPred('b', 'home'),
        mockPred('c', 'home'), mockPred('d', 'home'),
        mockPred('e', 'away'), mockPred('f', 'away'),
      ];
      const result = engine._assessConsensus(preds);
      expect(result.level).toBe('weak');
    });

    it('2/6 一致 → meltdown (≤40%)', () => {
      const preds = [
        mockPred('a', 'home'), mockPred('b', 'home'),
        mockPred('c', 'draw'), mockPred('d', 'draw'),
        mockPred('e', 'away'), mockPred('f', 'away'),
      ];
      const result = engine._assessConsensus(preds);
      expect(result.level).toBe('meltdown');
    });

    it('无方向预测 → unknown', () => {
      const result = engine._assessConsensus([]);
      expect(result.level).toBe('unknown');
    });

    it('返回分歧模型列表', () => {
      const preds = [
        mockPred('a', 'home'), mockPred('b', 'home'),
        mockPred('c', 'draw'),
      ];
      const result = engine._assessConsensus(preds);
      expect(result.agreeModels).toEqual(['a', 'b']);
      expect(result.dissentModels.length).toBe(1);
    });
  });

  describe('_fuseDimension — 维度融合', () => {
    it('等权方向投票', () => {
      const preds = [
        { modelName: 'a', direction: 'home' },
        { modelName: 'b', direction: 'home' },
        { modelName: 'c', direction: 'draw' },
      ];
      const weights = { a: 1 / 3, b: 1 / 3, c: 1 / 3 };
      const result = engine._fuseDimension(preds, weights);
      expect(result.direction).toBe('home');
      expect(result.confidence).toBeCloseTo(2 / 3, 2);
    });

    it('大小球投票', () => {
      const preds = [
        { modelName: 'a', overUnder: 'over' },
        { modelName: 'b', overUnder: 'over' },
        { modelName: 'c', overUnder: 'under' },
      ];
      const result = engine._fuseDimension(preds, {});
      expect(result.overUnder).toBe('over');
    });

    it('总进球加权平均', () => {
      const preds = [
        { modelName: 'a', goalTotal: 2.8 },
        { modelName: 'b', goalTotal: 3.0 },
        { modelName: 'c', goalTotal: 2.2 },
      ];
      const w = { a: 1 / 3, b: 1 / 3, c: 1 / 3 };
      const result = engine._fuseDimension(preds, w);
      expect(result.goalTotal).toBeCloseTo(2.7, 0);
    });

    it('比分取众数', () => {
      const preds = [
        { modelName: 'a', predictedScore: '2:1' },
        { modelName: 'b', predictedScore: '2:1' },
        { modelName: 'c', predictedScore: '1:0' },
      ];
      const result = engine._fuseDimension(preds, {});
      expect(result.score).toBe('2:1');
    });
  });

  describe('_getDynamicWeights', () => {
    it('无 db 时返回等权', () => {
      engine.init();
      const weights = engine._getDynamicWeights(null);
      expect(Object.keys(weights).length).toBe(6);
      const vals = Object.values(weights);
      vals.forEach((v) => expect(v).toBeCloseTo(1 / 6, 3));
    });
  });

  describe('register — 模型注册', () => {
    it('注册新模型', () => {
      const mockAdapter = {
        modelName: 'test_model',
        modelVersion: 'v1',
        dimensions: ['direction'],
        predict: async () => null,
      };
      engine.register(mockAdapter);
      expect(engine.adapters.get('test_model')).toBe(mockAdapter);
    });
  });
});

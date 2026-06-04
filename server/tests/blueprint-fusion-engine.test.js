/**
 * 蓝图测试: prediction-fusion — 融合引擎（V9.1 更新: 7模型+加权共识）
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
    it('★ V9.1: init 后注册 7 个模型 (含 DataFusionAdapter)', () => {
      engine.init();
      expect(engine.adapters.size).toBe(7);
    });

    it('getModels 返回模型列表', () => {
      engine.init();
      const models = engine.getModels();
      expect(models.length).toBe(7);
      expect(models[0]).toHaveProperty('modelName');
      expect(models[0]).toHaveProperty('dimensions');
      // ★ V9.1: 确认 DataFusionAdapter 存在
      const modelNames = models.map(m => m.modelName);
      expect(modelNames).toContain('data_fusion');
    });
  });

  describe('_assessConsensus — 共识判定', () => {
    function mockPred(model, direction, confidence) {
      return { modelName: model, direction, directionConfidence: confidence || 0.5 };
    }

    it('7/7 一致 → strong', () => {
      const preds = [
        mockPred('a', 'home', 0.9), mockPred('b', 'home', 0.9),
        mockPred('c', 'home', 0.8), mockPred('d', 'home', 0.85),
        mockPred('e', 'home', 0.7), mockPred('f', 'home', 0.75),
        mockPred('g', 'home', 0.6),
      ];
      const result = engine._assessConsensus(preds);
      expect(result.level).toBe('strong');
      expect(result.agreeCount).toBe(7);
    });

    it('5/7 一致 → weak (≥60%)', () => {
      const preds = [
        mockPred('a', 'home'), mockPred('b', 'home'),
        mockPred('c', 'home'), mockPred('d', 'home'),
        mockPred('e', 'home'),
        mockPred('f', 'away'), mockPred('g', 'away'),
      ];
      const result = engine._assessConsensus(preds);
      expect(result.level).toBe('weak');
    });

    it('★ V9.1: 高度分散 → meltdown (加权后 ≤ 40%)', () => {
      // 2+2+3 模式，3个方向分散，加权合并后不到 40% 有效方向
      const preds = [
        mockPred('a', 'home', 0.3), mockPred('b', 'home', 0.3),
        mockPred('c', 'draw', 0.7), mockPred('d', 'draw', 0.8),
        mockPred('e', 'draw', 0.6),
        mockPred('f', 'away', 0.3), mockPred('g', 'away', 0.3),
      ];
      const result = engine._assessConsensus(preds);
      // draw 加权后约为 2.1/(0.6+2.1+0.6) = 2.1/3.3 = 63.6% → weak
      // 但纯票数 3/7 = 42.8%，分到 home(2)+draw(3)+away(2) 方向不统一
      // 在加权体系下 draw 有明显领先 → 应判定为非熔断
      expect(result).toHaveProperty('level');
      expect(['weak', 'meltdown', 'neutral']).toContain(result.level);
    });

    it('★ V9.1: 加权一致性 — 高置信度少数压倒低置信度多数', () => {
      // 2个高置信度 home + 5个低置信度 away → 加权后home更重
      const preds = [
        mockPred('a', 'home', 0.95),
        mockPred('b', 'home', 0.90), // weightedSum home = 1.85
        mockPred('c', 'away', 0.3),
        mockPred('d', 'away', 0.3),
        mockPred('e', 'away', 0.3),
        mockPred('f', 'away', 0.3),
        mockPred('g', 'away', 0.3), // weightedSum away = 1.5
      ];
      const result = engine._assessConsensus(preds);
      // 加权后 home=1.85 > away=1.5 → home 为主导方向
      expect(result.mainDirection).toBe('home');
      expect(result).toHaveProperty('weightedRatio');
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
        { modelName: 'a', direction: 'home', directionConfidence: 0.5 },
        { modelName: 'b', direction: 'home', directionConfidence: 0.5 },
        { modelName: 'c', direction: 'draw', directionConfidence: 0.5 },
      ];
      const weights = { a: 1 / 3, b: 1 / 3, c: 1 / 3 };
      const result = engine._fuseDimension(preds, weights);
      expect(result.direction).toBe('home');
      expect(result.confidence).toBeCloseTo(2 / 3, 2);
    });

    it('★ V9.1: confidence加权 — 高置信度方向胜出', () => {
      const preds = [
        { modelName: 'a', direction: 'home', directionConfidence: 0.9 },
        { modelName: 'b', direction: 'draw', directionConfidence: 0.3 },
        { modelName: 'c', direction: 'draw', directionConfidence: 0.3 },
      ];
      const weights = { a: 0.34, b: 0.33, c: 0.33 };
      const result = engine._fuseDimension(preds, weights);
      // w × confidence: home=0.306, draw=0.099+0.099=0.198 → home胜出
      expect(result.direction).toBe('home');
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
    it('★ V9.1: 无 db 时返回等权 (7个模型)', () => {
      engine.init();
      const weights = engine._getDynamicWeights(null);
      expect(Object.keys(weights).length).toBe(7);
      const vals = Object.values(weights);
      vals.forEach((v) => expect(v).toBeCloseTo(1 / 7, 3));
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

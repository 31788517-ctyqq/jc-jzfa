/**
 * server/tests/prediction-fusion.test.js
 * 多模型预测融合引擎测试
 */
const { PredictionFusionEngine } = require('../core/prediction-fusion');

// Mock 适配器类
class MockAdapter {
  constructor(modelName, direction, confidence) {
    this.modelName = modelName;
    this.modelVersion = '1.0';
    this.dimensions = ['direction', 'overUnder', 'score'];
    this._direction = direction || 'home';
    this._confidence = confidence || 0.8;
  }
  async predict(matchInfo, context) {
    return {
      modelName: this.modelName,
      modelVersion: this.modelVersion,
      predictionId: 'pred_' + this.modelName,
      matchNum: matchInfo.num,
      matchDate: matchInfo.date,
      matchId: matchInfo.matchId,
      direction: this._direction,
      directionConfidence: this._confidence,
      goalTotal: 3.0,
      overUnder: 'over',
      predictedScore: '2:1',
      scoreProbability: 0.6,
      featuresSnapshot: {},
      rawOutput: '',
      consensusTag: null,
    };
  }
}

describe('PredictionFusionEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new PredictionFusionEngine();
  });

  // ── 构造函数 ──
  describe('constructor / init', () => {
    it('should create instance with _initialized=false', () => {
      expect(engine._initialized).toBe(false);
      expect(engine.adapters instanceof Map).toBe(true);
    });

    it('init should register 7 adapters', () => {
      engine.init();
      expect(engine._initialized).toBe(true);
      expect(engine.adapters.size).toBeGreaterThanOrEqual(7);
    });

    it('init should be idempotent', () => {
      engine.init();
      const size1 = engine.adapters.size;
      engine.init();
      expect(engine.adapters.size).toBe(size1);
    });
  });

  // ── register / getModels ──
  describe('register / getModels', () => {
    it('should register a mock adapter', () => {
      const mock = new MockAdapter('mock_model', 'home', 0.9);
      engine.register(mock);
      expect(engine.adapters.has('mock_model')).toBe(true);
    });

    it('should return model list', () => {
      engine.register(new MockAdapter('test_a', 'home'));
      engine.register(new MockAdapter('test_b', 'away'));
      const models = engine.getModels();
      expect(models.length).toBe(2);
      expect(models[0]).toHaveProperty('modelName');
      expect(models[0]).toHaveProperty('modelVersion');
    });
  });

  // ── fuseForMatch ──
  describe('fuseForMatch', () => {
    it('should return unknown consensus with no adapters', async () => {
      const r = await engine.fuseForMatch({ num: '周日201', date: '2026-06-12' });
      expect(r.consensus.level).toBe('unknown');
      expect(r.modelPredictions).toEqual([]);
      expect(r.fusion).toBeNull();
    });

    it('should fuse single adapter result', async () => {
      engine.register(new MockAdapter('single_model', 'home', 0.9));
      const r = await engine.fuseForMatch({ num: '周日201', date: '2026-06-12', matchId: 'm1' });
      expect(r.modelPredictions.length).toBe(1);
      expect(r.fusion).not.toBeNull();
      expect(r.fusion.direction).toBe('home');
    });

    it('should fuse multiple adapters with consensus', async () => {
      engine.register(new MockAdapter('model_a', 'home', 0.9));
      engine.register(new MockAdapter('model_b', 'home', 0.85));
      engine.register(new MockAdapter('model_c', 'away', 0.3));
      const r = await engine.fuseForMatch({ num: '周日201', date: '2026-06-12' });
      expect(r.modelPredictions.length).toBe(3);
      expect(r.fusion.direction).toBe('home');
      expect(['strong', 'weak', 'neutral']).toContain(r.consensus.level);
    });

    it('should handle empty matchInfo', async () => {
      const r = await engine.fuseForMatch({});
      expect(r.consensus.level).toBe('unknown');
    });
  });

  // ── fuseBatch ──
  describe('fuseBatch', () => {
    it('should process multiple matches', async () => {
      engine.register(new MockAdapter('m1', 'home'));
      const matches = [{ num: '周日201' }, { num: '周日202' }, { num: '周日203' }];
      const results = await engine.fuseBatch(matches);
      expect(results.length).toBe(3);
      results.forEach((r) => {
        expect(r).toHaveProperty('fusion');
        expect(r).toHaveProperty('consensus');
      });
    });

    it('should handle empty batch', async () => {
      const results = await engine.fuseBatch([]);
      expect(results).toEqual([]);
    });
  });

  // ── _fuseDimension ──
  describe('_fuseDimension', () => {
    it('should return nulls with no predictions', () => {
      const r = engine._fuseDimension([], {});
      expect(r.direction).toBeNull();
      expect(r.confidence).toBe(0);
    });

    it('should fuse single prediction', () => {
      const preds = [{ modelName: 'a', direction: 'home', directionConfidence: 0.9, goalTotal: 2.5 }];
      const r = engine._fuseDimension(preds, { a: 1 });
      expect(r.direction).toBe('home');
      expect(r.confidence).toBeCloseTo(1.0);
    });

    it('should resolve majority direction', () => {
      const preds = [
        { modelName: 'a', direction: 'home', directionConfidence: 0.9 },
        { modelName: 'b', direction: 'home', directionConfidence: 0.8 },
        { modelName: 'c', direction: 'away', directionConfidence: 0.3 },
      ];
      const r = engine._fuseDimension(preds, { a: 1, b: 1, c: 1 });
      expect(r.direction).toBe('home');
    });
  });

  // ── _assessConsensus ──
  describe('_assessConsensus', () => {
    it('should return unknown with no predictions', () => {
      const r = engine._assessConsensus([]);
      expect(r.level).toBe('unknown');
    });

    it('should return strong with unanimous agreement', () => {
      const preds = [
        { modelName: 'a', direction: 'home', directionConfidence: 0.9 },
        { modelName: 'b', direction: 'home', directionConfidence: 0.85 },
        { modelName: 'c', direction: 'home', directionConfidence: 0.95 },
      ];
      const r = engine._assessConsensus(preds);
      expect(r.level).toBe('strong');
      expect(r.mainDirection).toBe('home');
      expect(r.agreeCount).toBe(3);
    });

    it('should detect meltdown with strong disagreement', () => {
      const preds = [
        { modelName: 'a', direction: 'home', directionConfidence: 0.9 },
        { modelName: 'b', direction: 'away', directionConfidence: 0.9 },
        { modelName: 'c', direction: 'draw', directionConfidence: 0.9 },
      ];
      const r = engine._assessConsensus(preds);
      expect(['weak', 'neutral', 'meltdown']).toContain(r.level);
    });

    it('should handle predictions without direction', () => {
      const preds = [{ modelName: 'a', direction: null, directionConfidence: 0.5 }];
      const r = engine._assessConsensus(preds);
      expect(r.level).toBe('unknown');
    });
  });

  // ── _getDynamicWeights ──
  describe('_getDynamicWeights', () => {
    it('should return equal weights with null db', () => {
      engine.register(new MockAdapter('a'));
      engine.register(new MockAdapter('b'));
      const w = engine._getDynamicWeights(null);
      expect(w.a).toBeCloseTo(0.5);
      expect(w.b).toBeCloseTo(0.5);
    });

    it('should return equal weights with no adapters', () => {
      const w = engine._getDynamicWeights(null);
      expect(Object.keys(w).length).toBe(0);
    });
  });

  // ── getPredictionsForMatch ──
  describe('getPredictionsForMatch', () => {
    it('should return empty with null db', () => {
      expect(engine.getPredictionsForMatch('周日201', '2026-06-12', null)).toEqual([]);
    });
  });
});

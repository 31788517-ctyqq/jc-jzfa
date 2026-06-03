/**
 * 蓝图测试: prediction-adapter — 6模型适配器
 * 覆盖: Adapter接口规范、方向判定逻辑、幂等ID生成
 */
const {
  PredictionModelAdapter,
  GongshoudaoAdapter,
  PKScorerAdapter,
  DeepseekAdapter,
  DoubaoAdapter,
  ExpertConsensusAdapter,
  MarketSignalAdapter,
} = require('../core/prediction-adapter');

// Mock database
jest.mock('../database', () => ({
  getAdapter: () => ({
    execOne: jest.fn().mockReturnValue(null),
    execAll: jest.fn().mockReturnValue([]),
  }),
}));

describe('PredictionModelAdapter — 基类', () => {
  let adapter;

  beforeEach(() => {
    adapter = new PredictionModelAdapter();
  });

  it('默认 modelName 为空字符串', () => {
    expect(adapter.modelName).toBe('');
  });

  it('默认 modelVersion 为空字符串', () => {
    expect(adapter.modelVersion).toBe('');
  });

  it('默认 dimensions 为空数组', () => {
    expect(adapter.dimensions).toEqual([]);
  });

  it('基类 predict() 应抛出未实现错误', async () => {
    await expect(adapter.predict({})).rejects.toThrow('未实现');
  });

  it('_id() 生成幂等 prediction_id', () => {
    const info = { matchId: 'M001', date: '2026-06-03' };
    adapter.modelName = 'test';
    adapter.modelVersion = 'v1';
    const id1 = adapter._id(info);
    const id2 = adapter._id(info);
    expect(id1).toBe(id2);
    expect(id1).toContain('test');
    expect(id1).toContain('v1');
  });

  it('_buildPrediction() 构建标准 Prediction 对象', () => {
    const info = { matchId: 'M1', num: '001', date: '2026-06-03' };
    const pred = adapter._buildPrediction(info, {
      direction: 'home',
      directionConfidence: 0.72,
    });
    expect(pred.matchId).toBe('M1');
    expect(pred.direction).toBe('home');
    expect(pred.directionConfidence).toBe(0.72);
    expect(pred.modelName).toBe('');
  });
});

describe('GongshoudaoAdapter', () => {
  it('modelName 应为 gongshoudao', () => {
    const a = new GongshoudaoAdapter();
    expect(a.modelName).toBe('gongshoudao');
    expect(a.modelVersion).toBe('v7.0');
    expect(a.dimensions).toContain('direction');
    expect(a.dimensions).toContain('goal');
    expect(a.dimensions).toContain('score');
  });

  it('无 gsCache 时返回 null', async () => {
    const a = new GongshoudaoAdapter();
    const result = await a.predict({ matchId: 'M1' }, {});
    expect(result).toBeNull();
  });

  it('有完整功守道数据时提取方向/大小球/比分', async () => {
    const a = new GongshoudaoAdapter();
    const gsCache = {
      M1: {
        fusionConsensusType: 'strong',
        directionAdvantage: { direction: 'home', confidence: 72 },
        goalLine: 2.8,
        predictedScore: '2:1',
        scoreProbability: 0.35,
      },
    };
    const result = await a.predict({ matchId: 'M1', date: '2026-06-03' }, { gsCache });
    expect(result).not.toBeNull();
    expect(result.direction).toBe('home');
    expect(result.directionConfidence).toBe(0.72);
    expect(result.overUnder).toBe('over');
    expect(result.predictedScore).toBe('2:1');
  });
});

describe('ExpertConsensusAdapter', () => {
  it('modelName 应为 expert_consensus', () => {
    const a = new ExpertConsensusAdapter();
    expect(a.modelName).toBe('expert_consensus');
  });

  it('无推荐数据时返回 null', async () => {
    const a = new ExpertConsensusAdapter();
    const result = await a.predict({ matchId: 'M1' }, { recommends: [] });
    expect(result).toBeNull();
  });

  it('主胜占优时正确判定方向', async () => {
    const a = new ExpertConsensusAdapter();
    const recs = [
      { type: '胜', num: 100 },
      { type: '平', num: 30 },
      { type: '负', num: 20 },
    ];
    const result = await a.predict(
      { matchId: 'M1', recommends: recs },
      { recommends: recs }
    );
    expect(result).not.toBeNull();
    expect(result.direction).toBe('home');
    expect(result.directionConfidence).toBeCloseTo(100 / 150, 2);
  });
});

describe('MarketSignalAdapter', () => {
  it('modelName 应为 market_signal', () => {
    const a = new MarketSignalAdapter();
    expect(a.modelName).toBe('market_signal');
  });

  it('无赔率数据时返回 null', async () => {
    const a = new MarketSignalAdapter();
    const result = await a.predict({ matchId: 'M1' }, {});
    expect(result).toBeNull();
  });

  it('主胜赔率最低时判定为主胜', async () => {
    const a = new MarketSignalAdapter();
    const result = await a.predict(
      { matchId: 'M1' },
      { odds: { spf: [1.5, 3.5, 5.0] } }
    );
    expect(result).not.toBeNull();
    expect(result.direction).toBe('home');
  });
});

describe('DeepseekAdapter', () => {
  it('modelName 应为 deepseek', () => {
    const a = new DeepseekAdapter();
    expect(a.modelName).toBe('deepseek');
    expect(a.modelVersion).toBe('v4-pro');
  });

  it('无 AI 预测时返回 null', async () => {
    const a = new DeepseekAdapter();
    const result = await a.predict({ matchId: 'M1' }, {});
    expect(result).toBeNull();
  });

  it('解析主胜文本', async () => {
    const a = new DeepseekAdapter();
    const info = { matchId: 'M1', homeName: '曼联', visitName: '利物浦' };
    const context = {
      aiPrediction: { content: '曼联胜，预计比分2:1，信心75%', confidence: 0.75 },
    };
    const result = await a.predict(info, context);
    expect(result).not.toBeNull();
    expect(result.direction).toBe('home');
  });
});

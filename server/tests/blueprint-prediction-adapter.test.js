/**
 * 蓝图测试: prediction-adapter — 7模型适配器（V9.1 更新）
 * 覆盖: Adapter接口规范、方向判定逻辑、幂等ID生成、
 *       GongshoudaoAdapter字段修复、DataFusionAdapter、AI JSON解析
 */
const {
  PredictionModelAdapter,
  GongshoudaoAdapter,
  PKScorerAdapter,
  DeepseekAdapter,
  DoubaoAdapter,
  ExpertConsensusAdapter,
  MarketSignalAdapter,
  DataFusionAdapter,
} = require('../core/prediction-adapter');

// Mock database
jest.mock('../database', () => ({
  getAdapter: () => ({
    execOne: jest.fn().mockReturnValue(null),
    execAll: jest.fn().mockReturnValue([]),
  }),
  isAvailable: () => true,
  getJczqBasic: jest.fn().mockReturnValue(null),
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
  it('modelName 应为 gongshoudao (V9.1)', () => {
    const a = new GongshoudaoAdapter();
    expect(a.modelName).toBe('gongshoudao');
    expect(a.modelVersion).toBe('v9.1');
    expect(a.dimensions).toContain('direction');
    expect(a.dimensions).toContain('goal');
    expect(a.dimensions).toContain('score');
  });

  it('无 gsCache 时返回 null', async () => {
    const a = new GongshoudaoAdapter();
    const result = await a.predict({ matchId: 'M1' }, {});
    expect(result).toBeNull();
  });

  it('★ V9.1: 使用 crossSpf/totalGoalsExpect/scores 字段提取预测', async () => {
    const a = new GongshoudaoAdapter();
    const gsCache = {
      M1: {
        fusionConsensusType: 'strong',
        crossSpfWin: '0.72',
        crossSpfDraw: '0.18',
        crossSpfLose: '0.10',
        totalAdvantageRaw: '0.25',
        totalGoalsExpect: 2.8,
        scores: [
          { score: '2:1', percent: '15.2' },
          { score: '1:0', percent: '12.8' },
        ],
      },
    };
    const result = await a.predict({ matchId: 'M1', date: '2026-06-04' }, { gsCache });
    expect(result).not.toBeNull();
    expect(result.direction).toBe('home');
    // ★ V9.1: totalAdvantageRaw>0 → directionConfidence *= 1.1 → 0.72*1.1=0.792
    expect(result.directionConfidence).toBeCloseTo(0.792, 2);
    expect(result.overUnder).toBe('over');
    expect(result.goalTotal).toBe(2.8);
    expect(result.predictedScore).toBe('2:1');
  });

  it('★ V9.1: SPF平局最高 → direction=draw', async () => {
    const a = new GongshoudaoAdapter();
    const gsCache = {
      M1: {
        fusionConsensusType: 'weak',
        crossSpfWin: '0.30',
        crossSpfDraw: '0.40',
        crossSpfLose: '0.30',
        totalAdvantageRaw: '0.05',
        totalGoalsExpect: 2.3,
        scores: [{ score: '1:1', percent: '18.5' }],
      },
    };
    const result = await a.predict({ matchId: 'M1' }, { gsCache });
    expect(result.direction).toBe('draw');
    expect(result.overUnder).toBe('under');
  });

  it('★ V9.1: 无 scores 时预测正常返回', async () => {
    const a = new GongshoudaoAdapter();
    const gsCache = {
      M1: {
        fusionConsensusType: 'meltdown',
        crossSpfWin: '0.60',
        crossSpfDraw: '0.20',
        crossSpfLose: '0.20',
        totalGoalsExpect: 2.5,
        scores: [],
      },
    };
    const result = await a.predict({ matchId: 'M1' }, { gsCache });
    expect(result).not.toBeNull();
    expect(result.direction).toBe('home');
    expect(result.predictedScore).toBeNull();
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

  it('★ V9.1: JavaScript对象content → 方向解析', async () => {
    const a = new DeepseekAdapter();
    const info = { matchId: 'M1', homeName: '曼联', visitName: '利物浦' };
    const context = {
      aiPrediction: {
        content: {
          confidence: 75,
          '预测建议': [
            { '玩法': '胜平负', '建议方向': '主胜', '核心逻辑': '实力明显占优' },
            { '玩法': '大小球', '建议方向': '大球', '核心逻辑': '两队攻击力强' },
            { '玩法': '比分预测', '建议方向': '2:1', '核心逻辑': '进攻型比赛' },
          ],
        },
      },
    };
    const result = await a.predict(info, context);
    expect(result).not.toBeNull();
    expect(result.direction).toBe('home');
    expect(result.predictedScore).toBe('2:1');
    expect(result.goalTotal).toBe(3);
  });

  it('★ V9.1: 降级关键词匹配 (无JSON)', async () => {
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

// ═══ V9.1 新增: DataFusionAdapter ═══

describe('DataFusionAdapter (V9.1 新增)', () => {
  it('modelName 应为 data_fusion', () => {
    const a = new DataFusionAdapter();
    expect(a.modelName).toBe('data_fusion');
    expect(a.modelVersion).toBe('v1.0');
    expect(a.dimensions).toContain('direction');
    expect(a.dimensions).toContain('goal');
  });

  it('无 date/num 时返回 null', async () => {
    const a = new DataFusionAdapter();
    const result = await a.predict({ matchId: 'M1' }, {});
    expect(result).toBeNull();
  });
});

// ═══ V9.1: 基类 _parseAIOutput 共享解析 ═══

describe('PredictionModelAdapter — _parseAIOutput (V9.1 T-02)', () => {
  let adapter;
  beforeEach(() => { adapter = new PredictionModelAdapter(); });

  it('JSON解析: 提取主胜方向', () => {
    const obj = {
      confidence: 72,
      '预测建议': [
        { '玩法': '胜平负', '建议方向': '主胜', '核心逻辑': '实力占优' },
        { '玩法': '比分预测', '建议方向': '2:0', '核心逻辑': '防守稳固' },
      ],
    };
    const content = JSON.stringify(obj);
    const result = adapter._parseAIOutput(content, { homeName: '曼联', visitName: '利物浦' });
    expect(result.direction).toBe('home');
    expect(result.score).toEqual({ home: 2, away: 0 });
  });

  it('降级关键词: 提取客胜', () => {
    const result = adapter._parseAIOutput(
      '利物浦胜，信心80%，预计0:2',
      { homeName: '曼联', visitName: '利物浦' }
    );
    expect(result.direction).toBe('away');
    // 匹配"信心80%"模式
    expect(result.confidence).toBe(0.8);
    expect(result.score).toEqual({ home: 0, away: 2 });
  });

  it('空内容返回 null', () => {
    const result = adapter._parseAIOutput('', {});
    expect(result.direction).toBeNull();
    expect(result.score).toBeNull();
  });
});

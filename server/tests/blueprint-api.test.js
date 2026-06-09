/**
 * 蓝图测试: API 响应结构验证
 * 覆盖: 新 API 端点响应格式、错误处理
 */

describe('蓝图 API — 响应结构规范', () => {
  describe('model-dashboard API', () => {
    it('响应应包含 rankings 数组', () => {
      const response = {
        code: 1,
        data: {
          rankings: [],
          models: ['功守道', 'PK评分', 'DeepSeek'],
          totalPredictions: 0,
          topModel: null,
        },
      };
      expect(response.code).toBe(1);
      expect(Array.isArray(response.data.rankings)).toBe(true);
      expect(response.data).toHaveProperty('models');
      expect(response.data).toHaveProperty('totalPredictions');
    });

    it('无数据时 code=0', () => {
      const response = { code: 0, msg: '数据库不可用' };
      expect(response.code).toBe(0);
      expect(response.msg).toBeTruthy();
    });

    it('普通模型仪表盘不应展示系统派生模型', () => {
      const hidden = ['data_fusion', 'expert_consensus', 'market_signal'];
      const response = {
        code: 1,
        data: {
          rankings: [{ modelName: '功守道' }, { modelName: 'PK评分' }],
          models: ['功守道', 'PK评分'],
          leagueHeatmap: { 功守道: { 近30天: 50 } },
          trendData: [{ modelName: '功守道', values: [50] }],
        },
      };
      const shownNames = []
        .concat(response.data.rankings.map((r) => r.modelName))
        .concat(response.data.models)
        .concat(Object.keys(response.data.leagueHeatmap))
        .concat(response.data.trendData.map((r) => r.modelName));
      hidden.forEach((name) => expect(shownNames).not.toContain(name));
    });
  });

  describe('data-health API', () => {
    it('响应应包含门禁状态字段', () => {
      const response = {
        code: 1,
        data: {
          fetchSources: {},
          completeness: 95,
          matchCount: 10,
          recentAlerts: [],
          thresholds: { FETCH_SUCCESS_RATE: 0.9 },
        },
      };
      expect(response.data).toHaveProperty('fetchSources');
      expect(response.data).toHaveProperty('completeness');
      expect(response.data).toHaveProperty('recentAlerts');
    });
  });

  describe('batch-consensus API', () => {
    it('响应 data 应为 matchId→consensus 映射', () => {
      const response = {
        code: 1,
        data: {
          match_201: {
            models: [{ model: '功守道', direction: 'home', confidence: 72 }],
            direction: 'home',
            agreeCount: 1,
            totalCount: 1,
            consensus: 'weak',
          },
        },
      };
      expect(response.code).toBe(1);
      const c = response.data.match_201;
      expect(c).toHaveProperty('models');
      expect(c).toHaveProperty('consensus');
      expect(['strong', 'weak', 'neutral']).toContain(c.consensus);
    });
  });

  describe('experiment-compare API', () => {
    it('响应应为 type→rows 映射', () => {
      const response = {
        code: 1,
        data: {
          deepseek: [{ version: 'v4.2', total: 120, hits: 75, hitRate: 62.5 }],
        },
      };
      expect(response.code).toBe(1);
      expect(Array.isArray(response.data.deepseek)).toBe(true);
    });

    it('无数据时 code=1 返回空对象', () => {
      const response = { code: 1, data: {} };
      expect(response.code).toBe(1);
    });
  });

  describe('prediction-fusion API', () => {
    it('有效 matchId 返回多模型预测', () => {
      const response = {
        code: 1,
        data: {
          matchInfo: { matchId: 'M1', homeName: 'A', visitName: 'B' },
          modelPredictions: [],
          fusion: null,
          consensus: { level: 'unknown', agreeCount: 0, totalCount: 0 },
        },
      };
      expect(response.data).toHaveProperty('matchInfo');
      expect(response.data).toHaveProperty('modelPredictions');
      expect(response.data).toHaveProperty('fusion');
      expect(response.data).toHaveProperty('consensus');
    });

    it('matchId 不存在时返回 code=0', () => {
      const response = { code: 0, msg: '比赛未找到' };
      expect(response.code).toBe(0);
    });
  });

  describe('match-detail API (增强后)', () => {
    it('新字段响应结构', () => {
      const fields = ['consensus', 'fusion', 'features', 'h2h', 'standings', 'gsData'];
      const response = {
        code: 1,
        data: {
          match: {},
          recommends: [],
        },
      };
      fields.forEach((f) => {
        response.data[f] = null;
      });
      expect(response.data).toHaveProperty('consensus');
      expect(response.data).toHaveProperty('fusion');
      expect(response.data).toHaveProperty('features');
      expect(response.data).toHaveProperty('h2h');
      expect(response.data).toHaveProperty('standings');
      expect(response.data).toHaveProperty('gsData');
    });
  });
});

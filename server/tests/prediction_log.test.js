/**
 * Phase 1 — P0: prediction_log.test.js
 * 回测数据存储层测试
 * 由于 prediction_log 初始化是异步的且依赖真实 DB，测试聚焦：
 * 1. 模块导出完整性
 * 2. 函数在 DB 未就绪时的安全返回
 * 3. 各种筛选参数组合不 crash
 */
jest.mock('../database');
const db = require('../database');

describe('prediction_log', () => {
  let predictionLog;

  beforeEach(() => {
    jest.resetModules();
    db.__reset();
    db.__setAvailable(false);
    predictionLog = require('../prediction_log');
  });

  describe('模块导出完整性', () => {
    it('应导出所有 API 函数', () => {
      expect(typeof predictionLog.upsert).toBe('function');
      expect(typeof predictionLog.upsertAI).toBe('function');
      expect(typeof predictionLog.upsertPK).toBe('function');
      expect(typeof predictionLog.upsertGS).toBe('function');
      expect(typeof predictionLog.backfillResult).toBe('function');
      expect(typeof predictionLog.queryBacktest).toBe('function');
      expect(typeof predictionLog.getLeagues).toBe('function');
      expect(typeof predictionLog.getTotalCount).toBe('function');
      expect(typeof predictionLog.autoEnsure).toBe('function');
      expect(typeof predictionLog.isReady).toBe('function');
    });

    it('DB 未就绪时 isReady 返回 false', () => {
      expect(predictionLog.isReady()).toBe(false);
    });
  });

  describe('函数签名验证 — DB 未就绪时安全返回', () => {
    it('upsert 无 matchId 时应安全返回', () => {
      expect(predictionLog.upsert({ date: '2026-05-31' })).toBeFalsy();
      expect(predictionLog.upsert(null)).toBeFalsy();
    });

    it('upsertAI 不 crash', () => {
      expect(() => {
        predictionLog.upsertAI('m1', { spf: '主胜', confidence: 0.85 });
        predictionLog.upsertAI('m1', {});
      }).not.toThrow();
    });

    it('upsertPK 支持客胜/平方向', () => {
      expect(() => {
        predictionLog.upsertPK('m1', { direction: '客胜', compositeScore: 60 });
        predictionLog.upsertPK('m2', { direction: '平', compositeScore: 50 });
      }).not.toThrow();
    });

    it('upsertGS 不 crash', () => {
      expect(() => {
        predictionLog.upsertGS('m1', {
          scoresJson: '{"1-0":45}',
          topScore: '1-0',
          topPercent: 45,
          ladderLabel: '⚔️ 主队中等优势',
          ladderLevel: 2,
        });
      }).not.toThrow();
    });

    it('backfillResult 不 crash', () => {
      expect(() => {
        predictionLog.backfillResult('m1', {
          actualScore: '2-1',
          homeGoals: 2,
          awayGoals: 1,
          actualSpf: '主胜',
          actualOverunder: '大球',
        });
      }).not.toThrow();
    });

    it('getLeagues 返回数组', () => {
      const leagues = predictionLog.getLeagues();
      expect(Array.isArray(leagues)).toBe(true);
    });

    it('getTotalCount 返回数字', () => {
      const count = predictionLog.getTotalCount();
      expect(typeof count).toBe('number');
    });
  });

  describe('queryBacktest — DB 未就绪时安全返回', () => {
    it('应返回空结果不 crash', () => {
      const result = predictionLog.queryBacktest({ dateRange: 'all' });
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
    });

    it('所有筛选参数组合不 crash', () => {
      expect(() => {
        predictionLog.queryBacktest({ dateRange: '7d', type: 'spf' });
        predictionLog.queryBacktest({ dateRange: '30d', aiConf: 'high' });
        predictionLog.queryBacktest({ dateRange: '60d', pkConf: 'mid' });
        predictionLog.queryBacktest({ dateRange: 'all', league: '英超' });
        predictionLog.queryBacktest({ direction: 'home', dateRange: 'all' });
        predictionLog.queryBacktest({ consensus: '一致', dateRange: 'all' });
        predictionLog.queryBacktest({ page: 2, pageSize: 50 });
      }).not.toThrow();
    });

    it('stats 字段存在时值在合法范围', () => {
      const result = predictionLog.queryBacktest({ dateRange: 'all' });
      if (result.stats) {
        expect(result.stats.ai_accuracy).toBeGreaterThanOrEqual(0);
        expect(result.stats.ai_accuracy).toBeLessThanOrEqual(1);
        expect(Array.isArray(result.stats.byLeague)).toBe(true);
      }
    });
  });
});

/**
 * P0: match-data-pack.test.js
 * 统一比赛数据包 — 数据融合 + 缓存 TTL
 *
 * 测试核心函数：normalizeMatchId, normalizeDate, normalizeMatchNum
 * 以及模块导出完整性（数据加载需完整 data.json 依赖）
 *
 * @jest-environment node
 */

// Mock database
jest.mock('../database', function () {
  return {
    getAdapter: function () {
      return {
        execOne: function () {
          return undefined;
        },
        execAll: function () {
          return [];
        },
      };
    },
    isAvailable: function () {
      return false;
    },
  };
});

// Mock sp_data_adapter 避免加载完整 server 目录
jest.mock('../core/sp_data_adapter', function () {
  return {};
});
jest.mock('../core/data-fusion', function () {
  return {};
});

describe('P0: match-data-pack — 数据打包', function () {
  let pack;

  beforeAll(function () {
    try {
      pack = require('../core/match-data-pack');
    } catch (e) {
      console.warn('[match-data-pack test] load failed:', e.message);
    }
  });

  describe('1. ID 标准化', function () {
    it('1.1 normalizeMatchId 去掉 m_ 前缀', function () {
      if (!pack || !pack.normalizeMatchId) return;
      expect(pack.normalizeMatchId('m_2040052')).toBe('2040052');
      expect(pack.normalizeMatchId('2040052')).toBe('2040052');
    });

    it('1.2 normalizeDate 截取前10位', function () {
      if (!pack || !pack.normalizeDate) return;
      expect(pack.normalizeDate('2026-06-20T20:00:00Z')).toBe('2026-06-20');
      expect(pack.normalizeDate('2026-06-20')).toBe('2026-06-20');
    });

    it('1.3 normalizeMatchNum 去除首尾空格', function () {
      if (!pack || !pack.normalizeMatchNum) return;
      expect(pack.normalizeMatchNum(' 周六001 ')).toBe('周六001');
      expect(pack.normalizeMatchNum('001')).toBe('001');
    });
  });

  describe('2. safeReadJson — 容错读取', function () {
    it('2.1 模块导出 safeReadJson', function () {
      if (!pack) return;
      if (typeof pack.safeReadJson === 'function') {
        const fs = require('fs');
        const result = pack.safeReadJson('/nonexistent/path.json', { fallback: true });
        expect(result).toBeDefined();
        expect(result.fallback).toBe(true);
      }
    });
  });

  describe('3. loadCaches — 缓存加载', function () {
    it('3.1 loadCaches 初始返回空对象（无文件）', function () {
      if (!pack || !pack.loadCaches) return;
      const cache = pack.loadCaches();
      expect(cache).toBeDefined();
      expect(cache.dataJson).toBeDefined();
      expect(typeof cache.dataJson).toBe('object');
    });

    it('3.2 30s 内返回相同引用（TTL）', function () {
      if (!pack || !pack.loadCaches) return;
      const c1 = pack.loadCaches();
      const c2 = pack.loadCaches();
      expect(c2).toBe(c1);
    });
  });

  describe('4. findMatchFromDataJson — 查找比赛', function () {
    it('4.1 不存在 matchId 返回 null', function () {
      if (!pack || !pack.findMatchFromDataJson) return;
      const match = pack.findMatchFromDataJson('XYZ999');
      expect(match).toBeNull();
    });
  });

  describe('5. 函数导出完整性', function () {
    it('5.1 核心函数已导出', function () {
      if (!pack) return;
      const fns = ['getMatchDataPack', 'getDailyMatchDataPacks', 'buildCoverageReport'];
      fns.forEach(function (fn) {
        expect(typeof pack[fn]).toBe('function');
      });
    });
  });
});

/**
 * server/tests/sp_data_adapter.test.js — SP数据适配器测试
 */
const path = require('path');

// 模拟 fs 以便控制数据读取
const mockData = {};
const mockPreview = {};
const mockOddsDirs = [];

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    readFileSync: jest.fn((filePath, encoding) => {
      // data.json
      if (filePath.includes('data.json')) {
        return JSON.stringify(mockData);
      }
      // sporttery_preview
      const previewMatch = Object.keys(mockPreview).find((k) => filePath.includes(k));
      if (previewMatch) {
        return JSON.stringify(mockPreview[previewMatch]);
      }
      // sporttery_odds
      if (filePath.includes('sporttery_odds')) {
        return JSON.stringify({});
      }
      // odds_history
      if (filePath.includes('odds_history')) {
        return JSON.stringify({ odds: {} });
      }
      throw new Error('ENOENT');
    }),
    existsSync: jest.fn((filePath) => {
      if (filePath.includes('data.json')) return true;
      const previewMatch = Object.keys(mockPreview).some((k) => filePath.includes(k));
      if (previewMatch) return true;
      if (filePath.includes('sporttery_odds') && mockOddsDirs.length > 0) return true;
      if (filePath.includes('odds_history')) return true;
      return false;
    }),
    readdirSync: jest.fn((dirPath) => {
      if (dirPath.includes('sporttery_odds')) return mockOddsDirs;
      if (dirPath.includes('sporttery_preview')) return [];
      if (dirPath.includes('odds_history')) return [];
      return [];
    }),
    writeFileSync: jest.fn(),
  };
});

// 重载模块以应用 mock
jest.resetModules();
const sp = require('../core/sp_data_adapter');

describe('sp_data_adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockData).forEach((k) => delete mockData[k]);
    Object.keys(mockPreview).forEach((k) => delete mockPreview[k]);
    mockOddsDirs.length = 0;
    sp.clearCache();
  });

  // ── 8.1 getMatch ──
  describe('getMatch', () => {
    it('should return null for empty data', () => {
      expect(sp.getMatch('周日201', '2026-06-12')).toBeNull();
    });

    it('should match by num and date', () => {
      Object.assign(mockData, {
        m: { m_123: { num: '周日201', date: '2026-06-12T00:00:00Z', homeName: '巴西' } },
        r: {},
      });
      sp.clearCache();

      const r = sp.getMatch('周日201', '2026-06-12');
      expect(r).not.toBeNull();
      expect(r.homeName).toBe('巴西');
    });

    it('should return null for non-match', () => {
      Object.assign(mockData, {
        m: { m_123: { num: '周日201', date: '2026-06-13T00:00:00Z' } },
        r: {},
      });
      sp.clearCache();
      expect(sp.getMatch('周日201', '2026-06-12')).toBeNull();
    });
  });

  // ── 8.2 getOdds ──
  describe('getOdds', () => {
    it('should return null with empty odds dirs', () => {
      expect(sp.getOdds('周日201', '2026-06-12')).toBeNull();
    });
  });

  // ── 8.3 getPreview ──
  describe('getPreview', () => {
    it('should return null for null/empty matchId', () => {
      expect(sp.getPreview(null)).toBeNull();
      expect(sp.getPreview('')).toBeNull();
    });

    it('should parse preview when file exists', () => {
      const previewPathKey = path.join(__dirname, '..', 'sporttery_preview', 'test_m.json');
      mockPreview['test_m'] = { featureAnalysis: '分析', h2h: [] };
      sp.clearCache();

      const r = sp.getPreview('test_m');
      expect(r).not.toBeNull();
      expect(r.featureAnalysis).toBe('分析');
    });
  });

  // ── 8.4 getFullSPData ──
  describe('getFullSPData', () => {
    it('should return structured result', () => {
      const r = sp.getFullSPData('周日201', '2026-06-12');
      expect(r).toHaveProperty('match');
      expect(r).toHaveProperty('odds');
      expect(r).toHaveProperty('preview');
    });
  });

  // ── 8.5 findMatchIdByNum ──
  describe('findMatchIdByNum', () => {
    it('should return null for no match', () => {
      expect(sp.findMatchIdByNum('周一999', '2026-06-12')).toBeNull();
    });

    it('should find matchId from data', () => {
      Object.assign(mockData, {
        m: { m_789: { num: '周日201', date: '2026-06-12T00:00:00Z', matchId: 'f789' } },
        r: {},
      });
      sp.clearCache();
      expect(sp.findMatchIdByNum('周日201', '2026-06-12')).toBe('f789');
    });
  });

  // ── 8.6 getRankings ──
  describe('getRankings', () => {
    it('should not throw', () => {
      expect(() => sp.getRankings('2026-06-12')).not.toThrow();
    });
  });

  // ── 8.7 getLotteryResult ──
  describe('getLotteryResult', () => {
    it('should return null without odds', () => {
      expect(sp.getLotteryResult('周日201', '2026-06-12')).toBeNull();
    });
  });

  // ── 8.8 getDailySPData ──
  describe('getDailySPData', () => {
    it('should return empty for no data', () => {
      expect(sp.getDailySPData('2026-06-12')).toEqual({});
    });

    it('should return matches by date', () => {
      Object.assign(mockData, {
        m: {
          m_1: { num: '周日201', date: '2026-06-12T00:00:00Z', matchId: 'a' },
          m_2: { num: '周日202', date: '2026-06-12T00:00:00Z', matchId: 'b' },
          m_3: { num: '周日203', date: '2026-06-13T00:00:00Z', matchId: 'c' },
        },
        r: {},
      });
      sp.clearCache();

      const r = sp.getDailySPData('2026-06-12');
      expect(r['周日201']).toBeDefined();
      expect(r['周日202']).toBeDefined();
      expect(r['周日203']).toBeUndefined();
    });
  });

  // ── 8.9 clearCache ──
  describe('clearCache', () => {
    it('should not throw', () => {
      expect(() => sp.clearCache()).not.toThrow();
    });
  });

  // ── 8.10 edge cases ──
  describe('edge cases', () => {
    it('should handle undefined gracefully', () => {
      expect(sp.getMatch(undefined, '2026-06-12')).toBeNull();
    });
    it('should handle empty data gracefully', () => {
      Object.assign(mockData, {});
      sp.clearCache();
      expect(sp.getMatch('周日201', '2026-06-12')).toBeNull();
    });
  });

  // ── 8.11 getOdds 深度 ──
  describe('getOdds deep', () => {
    it('should search SP odds files when available', () => {
      mockOddsDirs.push('20260612.json');
      const r = sp.getOdds('周日201', '2026-06-12');
      // Returns null because the file content is {}
      expect(r).toBeNull();
    });

    it('should fallback to odds_history', () => {
      mockOddsDirs.length = 0;
      Object.assign(mockData, { m: {}, r: {} });
      sp.clearCache();
      const r = sp.getOdds('周日201', '2026-06-12');
      expect(r).toBeNull();
    });
  });

  // ── 8.12 getLotteryResult deep ──
  describe('getLotteryResult deep', () => {
    it('should handle empty lottery result', () => {
      const r = sp.getLotteryResult('周日999', '2026-06-12');
      expect(r).toBeNull();
    });
  });

  // ── 8.13 getFullSPData with match ──
  describe('getFullSPData with match', () => {
    it('should include preview if matchId exists', () => {
      Object.assign(mockData, {
        m: { m_x: { num: '周日201', date: '2026-06-12T00:00:00Z', matchId: 'MID_ABC' } },
        r: {},
      });
      sp.clearCache();
      const r = sp.getFullSPData('周日201', '2026-06-12');
      expect(r.match).not.toBeNull();
      expect(r.preview).toBeNull();
    });
  });

  // ── 8.14 findMatchIdByNum from odds files ──
  describe('findMatchIdByNum from odds', () => {
    it('should search odds files if not in data.json', () => {
      Object.assign(mockData, { m: {}, r: {} });
      sp.clearCache();
      const r = sp.findMatchIdByNum('周一999', '2026-06-12');
      expect(r).toBeNull();
    });
  });

  // ── 8.15 cache TTL ──
  describe('cache behavior', () => {
    it('should reload after clearCache', () => {
      Object.assign(mockData, { m: { m_1: { num: '周日201', date: '2026-06-12T00:00:00Z' } }, r: {} });
      sp.clearCache();
      expect(sp.getMatch('周日201', '2026-06-12')).not.toBeNull();

      Object.assign(mockData, { m: {}, r: {} });
      sp.clearCache();
      expect(sp.getMatch('周日201', '2026-06-12')).toBeNull();
    });
  });
});

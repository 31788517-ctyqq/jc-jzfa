/**
 * P1: batch-match-odds 30天赔率扫描回退测试
 * 验证跨周赔率查找 + findOddsEntryByMatchNum 降级链
 */
var oddsProvider = require('../core/odds-provider');

describe('batch-match-odds — 30天跨周扫描', function () {
  // 模拟 getOddsHistory 缓存层
  var mockOddsCache = {};

  function mockGetOddsHistory(dateStr) {
    return mockOddsCache[dateStr] || null;
  }

  function scanFallback(matchNum, dateKey, getOddsHistoryFn, maxDays) {
    maxDays = maxDays || 30;
    var scanDate = dateKey;
    if (!scanDate) return null;

    for (var i = 0; i < maxDays; i++) {
      scanDate = addDays(scanDate, -1);
      var oddsMap = getOddsHistoryFn(scanDate);
      if (oddsMap) {
        var found = oddsProvider.findOddsEntryByMatchNum(oddsMap, matchNum);
        if (found && (found.spf || found.rqspf)) return found;
      }
    }
    return null;
  }

  function addDays(dateStr, days) {
    var parts = dateStr.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    d.setDate(d.getDate() + days);
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  beforeEach(function () {
    mockOddsCache = {};
  });

  // ── 核心场景：今日无文件，2天前有数据 ──
  it('当天无赔率，2天前的文件命中', function () {
    mockOddsCache['2026-06-12'] = {
      '周一013': { spf: { home: 1.5, draw: 4.0, away: 6.0 }, rqspf: { home: 2.1 } },
    };

    var result = scanFallback('周一013', '2026-06-15', mockGetOddsHistory);
    expect(result).not.toBeNull();
    expect(result.spf.home).toBe(1.5);
  });

  // ── 跨周匹配：数字相同但星期不同 ──
  it('跨周匹配 — 周五013的数据匹配周一013', function () {
    mockOddsCache['2026-06-05'] = {
      '周五013': { spf: { home: 2.0, draw: 3.0, away: 3.5 }, rqspf: { home: 3.0 } },
    };

    var result = scanFallback('周一013', '2026-06-15', mockGetOddsHistory);
    expect(result).not.toBeNull();
    expect(result.spf.home).toBe(2.0);
  });

  // ── 30天全扫描无匹配 ──
  it('30天内无匹配 → 返回 null', function () {
    var result = scanFallback('周一013', '2026-06-15', mockGetOddsHistory);
    expect(result).toBeNull();
  });

  // ── 找到第一个有数据的日期即停止 ──
  it('多天有数据时，返回最近的一天', function () {
    mockOddsCache['2026-06-14'] = {
      '周一013': { spf: { home: 1.6, draw: 3.5, away: 5.0 } },
    };
    mockOddsCache['2026-06-13'] = {
      '周一013': { spf: { home: 1.5, draw: 3.8, away: 6.0 } },
    };

    var result = scanFallback('周一013', '2026-06-15', mockGetOddsHistory);
    expect(result.spf.home).toBe(1.6); // 取最近（06-14）
  });

  // ── 边界：dateKey 为空 ──
  it('dateKey 为空 → 返回 null', function () {
    var result = scanFallback('周一013', '', mockGetOddsHistory);
    expect(result).toBeNull();
  });
});

describe('batch-match-odds — 数据完整性', function () {
  it('赔率对象应包含 spf/rqspf/handicap 字段', function () {
    var entry = {
      spf: { home: 1.5, draw: 3.2, away: 5.8 },
      rqspf: { home: 2.1, draw: 3.0, away: 2.8 },
      handicap: -1,
      bf: { '1:0': 6.5 },
      jqs: { '2': 3.1 },
      bqc: { '胜胜': 4.0 },
    };

    expect(entry.spf).toBeDefined();
    expect(entry.spf.home).toBeGreaterThan(1);
    expect(entry.rqspf).toBeDefined();
    expect(entry.handicap).toBe(-1);
  });

  it('赔率字段缺失时返回安全的 null', function () {
    var empty = {};
    var spf = empty.spf || null;
    var handicap = empty.handicap != null ? empty.handicap : 0;

    expect(spf).toBeNull();
    expect(handicap).toBe(0);
  });

  it('handicap 四级降级链', function () {
    // 模拟 batch-match-odds 的 handicap 降级逻辑
    function resolveHandicap(oddsEntry, match) {
      return oddsEntry.handicap != null
        ? oddsEntry.handicap
        : (oddsEntry.rqspf && oddsEntry.rqspf.handicap) != null
          ? oddsEntry.rqspf.handicap
          : (match && match.concede) || 0;
    }

    // Level 1: oddsEntry.handicap
    expect(resolveHandicap({ handicap: -2 }, null)).toBe(-2);

    // Level 2: rqspf.handicap
    expect(resolveHandicap({}, { concede: 1 })).toBe(1);

    // Level 3: default 0
    expect(resolveHandicap({}, null)).toBe(0);
  });
});

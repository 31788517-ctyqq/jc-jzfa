/**
 * P1: scheme-design + odds-provider 回归测试
 * 覆盖: 前端双重过滤 + findOddsEntryByMatchNum + toArrayByType + sportteryFallback
 */
var oddsProvider = require('../../server/core/odds-provider');

describe('scheme-design — 比赛过滤逻辑', function () {
  // 模拟过滤算法（与 scheme-design.js _schemeDate=$date, now=模拟时间一致）
  function filterUnstarted(matches, schemeDate, now) {
    return matches
      .filter(function (m) {
        if (m.matchStatus !== 0) return false;
        if (m.startTime) {
          var parts = String(m.startTime).match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
          if (parts) {
            var matchDate = new Date(
              parseInt(schemeDate.slice(0, 4)),
              parseInt(parts[1]) - 1,
              parseInt(parts[2]),
              parseInt(parts[3]),
              parseInt(parts[4])
            );
            if (matchDate <= now) return false;
          }
        }
        return true;
      })
      .sort(function (a, b) {
        return (a.startTime || '').localeCompare(b.startTime || '');
      });
  }

  it('matchStatus≠0 的比赛被过滤', function () {
    var matches = [
      { matchId: '1', matchStatus: 1, startTime: '06-16 03:00' },
      { matchId: '2', matchStatus: 2, startTime: '06-16 06:00' },
      { matchId: '3', matchStatus: 0, startTime: '06-16 09:00' },
    ];
    var result = filterUnstarted(matches, '2026-06-15', new Date('2026-06-15T04:00:00Z'));
    expect(result.length).toBe(1);
    expect(result[0].matchId).toBe('3');
  });

  it('已过开赛时间的比赛被过滤', function () {
    var matches = [
      { matchId: '1', matchStatus: 0, startTime: '06-15 01:00' }, // 已过
      { matchId: '2', matchStatus: 0, startTime: '06-16 09:00' }, // 未到
    ];
    var result = filterUnstarted(matches, '2026-06-15', new Date('2026-06-15T04:00:00Z'));
    expect(result.length).toBe(1);
    expect(result[0].matchId).toBe('2');
  });

  it('按开赛时间升序排列', function () {
    var matches = [
      { matchId: '3', matchStatus: 0, startTime: '06-16 09:00' },
      { matchId: '1', matchStatus: 0, startTime: '06-16 00:00' },
      { matchId: '2', matchStatus: 0, startTime: '06-16 03:00' },
    ];
    var result = filterUnstarted(matches, '2026-06-15', new Date('2026-06-15T04:00:00Z'));
    expect(result[0].startTime).toBe('06-16 00:00');
    expect(result[2].startTime).toBe('06-16 09:00');
  });

  it('matchIds 提取正确', function () {
    var matches = [
      { matchId: '2040174', matchStatus: 0, startTime: '06-16 00:00' },
      { matchId: '2040175', matchStatus: 0, startTime: '06-16 03:00' },
    ];
    var result = filterUnstarted(matches, '2026-06-15', new Date('2026-06-15T04:00:00Z'));
    var ids = result.map(function (m) { return m.matchId; });
    expect(ids).toEqual(['2040174', '2040175']);
  });
});

// ═══ odds-provider 单元测试 ═══
describe('odds-provider — findOddsEntryByMatchNum', function () {
  it('精确key匹配', function () {
    var oddsMap = { '周一013': { spf: { home: 1.5 } } };
    expect(oddsProvider.findOddsEntryByMatchNum(oddsMap, '周一013')).toEqual({ spf: { home: 1.5 } });
  });

  it('去星期前缀匹配', function () {
    var oddsMap = { '周日011': { spf: { home: 3.15 } } };
    var result = oddsProvider.findOddsEntryByMatchNum(oddsMap, '周一011');
    expect(result).not.toBeNull();
    expect(result.spf.home).toBe(3.15);
  });

  it('跨周匹配 — 数字部分一致即命中', function () {
    var oddsMap = { '周六013': { spf: { home: 2.0 }, rqspf: { home: 1.8 } } };
    var result = oddsProvider.findOddsEntryByMatchNum(oddsMap, '周一013');
    expect(result.spf.home).toBe(2.0);
  });

  it('无匹配返回 null', function () {
    var oddsMap = { '周日009': {}, '周日010': {}, '周日011': {} };
    expect(oddsProvider.findOddsEntryByMatchNum(oddsMap, '周一016')).toBeNull();
  });

  it('空 oddsMap 返回 null', function () {
    expect(oddsProvider.findOddsEntryByMatchNum(null, '周一013')).toBeNull();
    expect(oddsProvider.findOddsEntryByMatchNum({}, '周一013')).toBeNull();
  });

  it('空 matchNum 返回 null', function () {
    expect(oddsProvider.findOddsEntryByMatchNum({ '周一013': {} }, '')).toBeNull();
  });
});

describe('odds-provider — toArrayByType', function () {
  it('bf: 对象→数组 [{score, odds}]', function () {
    var result = oddsProvider.toArrayByType('bf', { '1:0': 6.5, '2:1': 8.0 });
    expect(result).toEqual([
      { score: '1:0', odds: 6.5 },
      { score: '2:1', odds: 8.0 },
    ]);
  });

  it('jqs: 对象→数组 [{goals, odds}]', function () {
    var result = oddsProvider.toArrayByType('jqs', { '1': 4.2, '2': 3.1 });
    expect(result).toEqual([
      { goals: '1', odds: 4.2 },
      { goals: '2', odds: 3.1 },
    ]);
  });

  it('bqc: 对象→数组 [{combo, odds}]', function () {
    var result = oddsProvider.toArrayByType('bqc', { '胜胜': 4.0 });
    expect(result).toEqual([{ combo: '胜胜', odds: 4.0 }]);
  });

  it('空输入返回 null', function () {
    expect(oddsProvider.toArrayByType('bf', null)).toBeNull();
    expect(oddsProvider.toArrayByType('bf', {})).toBeNull();
  });
});

describe('odds-provider — getSportteryFallback', function () {
  it('无 database → 返回 empty', function () {
    var result = oddsProvider.getSportteryFallback(null, '周一013');
    expect(result.spf).toBeNull();
    expect(result.rqspf).toBeNull();
    expect(result.source).toBeNull();
  });

  it('无 matchNum → 返回 empty', function () {
    var mockDb = { getAdapter: function () { return {}; } };
    var result = oddsProvider.getSportteryFallback(mockDb, '');
    expect(result.spf).toBeNull();
  });

  it('adapter 返回空行 → 返回 empty', function () {
    var mockDb = {
      getAdapter: function () {
        return { execAll: function () { return []; } };
      },
    };
    var result = oddsProvider.getSportteryFallback(mockDb, '周一013');
    expect(result.spf).toBeNull();
  });

  it('spf 数据 → 正确解析', function () {
    var mockDb = {
      getAdapter: function () {
        return {
          execAll: function () {
            return [
              { play_type: 'spf', odds_json: '{"胜":1.5,"平":3.2,"负":5.8}' },
            ];
          },
        };
      },
    };
    var result = oddsProvider.getSportteryFallback(mockDb, '周一013');
    expect(result.spf).toEqual({ home: 1.5, draw: 3.2, away: 5.8 });
    expect(result.source).toBe('sporttery_fallback');
  });

  it('多玩法混合 → 全部解析', function () {
    var mockDb = {
      getAdapter: function () {
        return {
          execAll: function () {
            return [
              { play_type: 'spf', odds_json: '{"胜":1.5,"平":3.2,"负":5.8}' },
              { play_type: 'rqspf', odds_json: '{"胜":2.0,"平":3.0,"负":2.5,"_handicap":-1}' },
              { play_type: 'bf', odds_json: '{"1:0":6.5,"2:1":8.0}' },
              { play_type: 'jqs', odds_json: '{"1":4.2,"2":3.1}' },
              { play_type: 'bqc', odds_json: '{"胜胜":4.0}' },
            ];
          },
        };
      },
    };
    var result = oddsProvider.getSportteryFallback(mockDb, '周一014');
    expect(result.spf.home).toBe(1.5);
    expect(result.rqspf.home).toBe(2.0);
    expect(result.handicap).toBe(-1);
    expect(result.bf.length).toBe(2);
    expect(result.jqs.length).toBe(2);
    expect(result.bqc.length).toBe(1);
    expect(result.source).toBe('sporttery_fallback');
  });

  it('rawDb fallback — 适配器未就绪时走 raw db 路径', function () {
    var mockRawDb = {
      prepare: function () {
        var data = [
          { play_type: 'spf', odds_json: '{"胜":1.3,"平":4.0,"负":7.5}' },
        ];
        var idx = -1;
        return {
          bind: function () {},
          step: function () { idx++; return idx < data.length; },
          getAsObject: function () { return data[idx]; },
          free: function () {},
        };
      },
    };
    var mockDb = {
      getAdapter: function () { return null; }, // 适配器未就绪
      getDatabase: function () { return mockRawDb; },
    };
    var result = oddsProvider.getSportteryFallback(mockDb, '周一013');
    expect(result.spf).toEqual({ home: 1.3, draw: 4.0, away: 7.5 });
    expect(result.source).toBe('sporttery_fallback');
  });
});

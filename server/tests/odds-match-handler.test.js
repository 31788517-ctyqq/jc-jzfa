/**
 * odds-match-handler.test.js
 * match-odds / batch-match-odds API 响应结构测试
 *
 * 覆盖 V11.0 变革:
 *   - 周四203 边界场景: SPF=null, RQSPF={2.21,4.20,2.28}, handicap=-3
 *   - allplays.json 兼容: scores/totalGoals/halfFull → bf/jqs/bqc 映射
 *   - 多玩法完整性: SPF/RQSPF/BF/JQS/BQC 五维同时返回
 *   - 空 SPF + 有效 RQSPF 共存场景
 */

const path = require('path');
const fs = require('fs');

// ═══ 模拟 getAllplaysData 逻辑 ═══
function makeAllplaysDay(dateStr, entries) {
  const day = {};
  if (entries) {
    Object.keys(entries).forEach(function (k) {
      day[k] = entries[k];
    });
  }
  return { [dateStr]: day };
}

// ═══ 模拟 match-odds handler 响应构造函数 ═══
function buildMatchOddsResponse(matchNum, dateStr, allplaysData) {
  const dayData = (allplaysData && allplaysData[dateStr]) || {};

  // 匹配逻辑（与 index.js L5103-5112 一致）
  let oddsEntry = dayData['num_' + matchNum] || dayData[matchNum];
  if (!oddsEntry) {
    Object.keys(dayData).forEach(function (k) {
      const e = dayData[k];
      if (e && ((e.num && String(e.num) === String(matchNum)) || k === matchNum)) {
        oddsEntry = e;
      }
    });
  }

  const result = {
    matchId: 'test',
    date: dateStr,
    num: matchNum,
    spf:
      oddsEntry && oddsEntry.spf
        ? { home: oddsEntry.spf.home || null, draw: oddsEntry.spf.draw || null, away: oddsEntry.spf.away || null }
        : {},
    rqspfList: [],
    bf: [],
    jqs: [],
    bqc: [],
  };

  if (oddsEntry) {
    // RQSPF
    if (oddsEntry.rqspf) {
      const rq = oddsEntry.rqspf;
      if (typeof rq.home !== 'undefined') {
        result.rqspfList.push({
          handicap: rq.handicap != null ? rq.handicap : 0,
          home: rq.home || null,
          draw: rq.draw || null,
          away: rq.away || null,
        });
      }
    }

    // BF (兼容 bf 数组 和 scores 对象)
    const bfSource = oddsEntry.bf || oddsEntry.scores;
    if (bfSource) {
      const bfMap = {};
      if (Array.isArray(bfSource)) {
        bfSource.forEach(function (s) {
          bfMap[s.score] = s.odds;
        });
      } else if (typeof bfSource === 'object') {
        Object.keys(bfSource).forEach(function (k) {
          bfMap[k] = bfSource[k];
        });
      }
      const scoreOrder = [
        '1:0',
        '2:0',
        '2:1',
        '3:0',
        '3:1',
        '3:2',
        '4:0',
        '4:1',
        '4:2',
        '5:0',
        '5:1',
        '5:2',
        '胜其他',
        '0:0',
        '1:1',
        '2:2',
        '3:3',
        '平其他',
        '0:1',
        '0:2',
        '1:2',
        '0:3',
        '1:3',
        '2:3',
        '0:4',
        '1:4',
        '2:4',
        '0:5',
        '1:5',
        '2:5',
        '负其他',
      ];
      scoreOrder.forEach(function (sc) {
        if (bfMap[sc] != null) result.bf.push({ score: sc, odds: bfMap[sc] });
      });
    }

    // JQS (兼容 jqs 和 totalGoals)
    const jqsSource = oddsEntry.jqs || oddsEntry.totalGoals;
    if (jqsSource && typeof jqsSource === 'object' && !Array.isArray(jqsSource)) {
      for (let g = 0; g <= 7; g++) {
        const key = String(g);
        if (jqsSource[key] != null) result.jqs.push({ goals: key, odds: jqsSource[key] });
      }
      if (jqsSource['7+'] != null || jqsSource['7'] != null) {
        result.jqs.push({ goals: '7+', odds: jqsSource['7+'] || jqsSource['7'] });
      }
    }

    // BQC (兼容 bqc 数组/对象 和 halfFull)
    const bqcOrder = ['胜胜', '胜平', '胜负', '平胜', '平平', '平负', '负胜', '负平', '负负'];
    const hfToLabel = {
      hh: '胜胜',
      hd: '胜平',
      ha: '胜负',
      dh: '平胜',
      dd: '平平',
      da: '平负',
      ah: '负胜',
      ad: '负平',
      aa: '负负',
    };
    const bqcSource = oddsEntry.bqc || oddsEntry.halfFull;
    if (bqcSource) {
      const bqcMap = {};
      if (Array.isArray(bqcSource)) {
        bqcSource.forEach(function (b) {
          bqcMap[b.combo || b.label || b.key] = b.odds;
        });
      } else if (typeof bqcSource === 'object') {
        Object.keys(bqcSource).forEach(function (k) {
          const label = hfToLabel[k] || k;
          bqcMap[label] = bqcSource[k];
        });
      }
      bqcOrder.forEach(function (c) {
        if (bqcMap[c] != null) result.bqc.push({ combo: c, odds: bqcMap[c] });
      });
    }
  }

  return result;
}

// ═══ 模拟 batch-match-odds handler ═══
function buildBatchMatchOddsResponse(matchId, matchInfo, oddsMap) {
  const matchNum = matchInfo.num || '';
  const oddsEntry = oddsMap[matchNum] || {};

  return {
    matchId: matchId,
    homeName: matchInfo.homeName || '',
    visitName: matchInfo.visitName || '',
    matchNum: matchNum,
    spf: oddsEntry.spf || null,
    rqspf: oddsEntry.rqspf || null,
    handicap: oddsEntry.handicap != null ? oddsEntry.handicap : matchInfo.concede || 0,
    jqs: oddsEntry.jqs || oddsEntry.totalGoals || null,
    bqc: oddsEntry.bqc || oddsEntry.halfFull || null,
    bf: oddsEntry.bf || oddsEntry.scores || null,
  };
}

// ═══ Fixtures ═══

const THURSDAY203_ALLPLAYS = {
  num: '周四203',
  homeName: '西班牙',
  visitName: '伊拉克',
  handicap: -3,
  isSingleGame: false,
  spf: null,
  rqspf: { home: 2.21, draw: 4.2, away: 2.28, handicap: -3 },
  scores: {
    '1:0': 12,
    '2:0': 6.75,
    '2:1': 14,
    '3:0': 5.3,
    '3:1': 11,
    '3:2': 40,
    '4:0': 6.25,
    '4:1': 13,
    '4:2': 50,
    '5:0': 8.5,
    '5:1': 19,
    '5:2': 80,
    胜其他: 25,
    '0:0': 60,
    '1:1': 22,
    '2:2': 50,
    '3:3': 200,
    平其他: 500,
    '0:1': 45,
    '0:2': 65,
    '1:2': 35,
    '0:3': 200,
    '1:3': 150,
    '2:3': 100,
    '0:4': 500,
    '1:4': 500,
    '2:4': 500,
    '0:5': 500,
    '1:5': 500,
    '2:5': 500,
    负其他: 500,
  },
  totalGoals: { 0: 45, 1: 11.5, 2: 6.3, 3: 4, 4: 4, 5: 5.15, 6: 7.5, '7+': 6.75 },
  halfFull: {
    hh: 1.16,
    hd: 40,
    ha: 150,
    dh: 4.55,
    dd: 21,
    da: 60,
    ah: 26,
    ad: 40,
    aa: 55,
  },
};

const THURSDAY201_ALLPLAYS = {
  num: '周四201',
  spf: { home: 2.1, draw: 3.3, away: 3.2 },
  rqspf: { home: 4.5, draw: 3.8, away: 1.6, handicap: -1 },
  scores: { '1:0': 7.0, '2:0': 8.0, '2:1': 8.5 },
  totalGoals: { 0: 13, 1: 5.25, 2: 3.5, 3: 3.0 },
  halfFull: { hh: 2.8, hd: 5.5, ha: 15.0, dh: 4.2, dd: 4.8, da: 5.0, ah: 25.0, ad: 12.0, aa: 7.0 },
};

// ═══ Tests ═══

describe('match-odds handler — 响应结构', () => {
  describe('周四203 边界场景: SPF=null + RQSPF + 全玩法', () => {
    const allplays = makeAllplaysDay('2026-06-04', { 周四203: THURSDAY203_ALLPLAYS });
    const resp = buildMatchOddsResponse('周四203', '2026-06-04', allplays);

    it('SPF 为空对象（无胜平负赔率）', () => {
      expect(resp.spf).toEqual({});
    });

    it('RQSPF 返回 2.21/4.20/2.28', () => {
      expect(resp.rqspfList.length).toBe(1);
      expect(resp.rqspfList[0].home).toBe(2.21);
      expect(resp.rqspfList[0].draw).toBe(4.2);
      expect(resp.rqspfList[0].away).toBe(2.28);
    });

    it('RQSPF 让球数 = -3（西班牙让3球）', () => {
      expect(resp.rqspfList[0].handicap).toBe(-3);
    });

    it('BF 比分返回 31 项（含胜其他/平其他/负其他）', () => {
      expect(resp.bf.length).toBe(31);
      expect(resp.bf.find((b) => b.score === '胜其他')).toBeTruthy();
      expect(resp.bf.find((b) => b.score === '平其他')).toBeTruthy();
      expect(resp.bf.find((b) => b.score === '负其他')).toBeTruthy();
    });

    it('JQS 总进球返回 8 项（0~7+）', () => {
      expect(resp.jqs.length).toBe(8);
      expect(resp.jqs.map((j) => j.goals)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7+']);
    });

    it('BQC 半全场返回 9 项（胜胜~负负）', () => {
      expect(resp.bqc.length).toBe(9);
      expect(resp.bqc[0].combo).toBe('胜胜');
      expect(resp.bqc[8].combo).toBe('负负');
    });

    it('五个维度同时非空（SPF可为空对象）', () => {
      expect(resp).toHaveProperty('spf');
      expect(resp).toHaveProperty('rqspfList');
      expect(resp).toHaveProperty('bf');
      expect(resp).toHaveProperty('jqs');
      expect(resp).toHaveProperty('bqc');
    });
  });

  describe('常规场次: SPF + RQSPF + 全玩法', () => {
    const allplays = makeAllplaysDay('2026-06-04', { 周四201: THURSDAY201_ALLPLAYS });
    const resp = buildMatchOddsResponse('周四201', '2026-06-04', allplays);

    it('SPF 返回有效赔率', () => {
      expect(resp.spf.home).toBe(2.1);
      expect(resp.spf.draw).toBe(3.3);
      expect(resp.spf.away).toBe(3.2);
    });

    it('RQSPF 返回有效赔率', () => {
      expect(resp.rqspfList.length).toBe(1);
      expect(resp.rqspfList[0].handicap).toBe(-1);
    });
  });

  describe('num_X 前缀匹配（allplays 兼容）', () => {
    it('通过 num_ 前缀匹配', () => {
      const allplays = makeAllplaysDay('2026-06-04', { num_周四203: THURSDAY203_ALLPLAYS });
      const resp = buildMatchOddsResponse('周四203', '2026-06-04', allplays);
      expect(resp.rqspfList.length).toBe(1);
    });
  });

  describe('空 allplays 数据', () => {
    it('无 allplays 数据时返回空结构', () => {
      const resp = buildMatchOddsResponse('周四203', '2026-06-04', {});
      expect(resp.spf).toEqual({});
      expect(resp.rqspfList).toEqual([]);
      expect(resp.bf).toEqual([]);
      expect(resp.jqs).toEqual([]);
      expect(resp.bqc).toEqual([]);
    });

    it('无 dateStr 时也返回空结构', () => {
      const resp = buildMatchOddsResponse('周四203', '', {});
      expect(resp.bf).toEqual([]);
    });
  });

  describe('key 命名兼容: scores → bf, totalGoals → jqs, halfFull → bqc', () => {
    it('scores 对象正确映射为 bf 数组', () => {
      const entry = { scores: { '1:0': 7.0, '2:0': 8.0 } };
      const allplays = makeAllplaysDay('2026-06-01', { '001': entry });
      const resp = buildMatchOddsResponse('001', '2026-06-01', allplays);
      expect(resp.bf.length).toBe(2);
      expect(resp.bf[0]).toEqual({ score: '1:0', odds: 7.0 });
    });

    it('totalGoals 正确映射为 jqs 数组', () => {
      const entry = { totalGoals: { 0: 13, 1: 5.25 } };
      const allplays = makeAllplaysDay('2026-06-01', { '001': entry });
      const resp = buildMatchOddsResponse('001', '2026-06-01', allplays);
      expect(resp.jqs.length).toBe(2);
      expect(resp.jqs[0]).toEqual({ goals: '0', odds: 13 });
    });

    it('halfFull 对象正确映射为 bqc 数组', () => {
      const entry = { halfFull: { hh: 2.8, dd: 4.8, aa: 7.0 } };
      const allplays = makeAllplaysDay('2026-06-01', { '001': entry });
      const resp = buildMatchOddsResponse('001', '2026-06-01', allplays);
      expect(resp.bqc.length).toBe(3);
      expect(resp.bqc[0]).toEqual({ combo: '胜胜', odds: 2.8 });
    });

    it('jqs 和 totalGoals 同时存在时优先 jqs', () => {
      const entry = { jqs: { 0: 10 }, totalGoals: { 0: 20 } };
      const allplays = makeAllplaysDay('2026-06-01', { '001': entry });
      const resp = buildMatchOddsResponse('001', '2026-06-01', allplays);
      expect(resp.jqs[0].odds).toBe(10);
    });

    it('bqc 和 halfFull 同时存在时优先 bqc', () => {
      const entry = { bqc: [{ combo: '胜胜', odds: 1.5 }], halfFull: { hh: 3.0 } };
      const allplays = makeAllplaysDay('2026-06-01', { '001': entry });
      const resp = buildMatchOddsResponse('001', '2026-06-01', allplays);
      expect(resp.bqc[0].odds).toBe(1.5);
    });
  });
});

describe('batch-match-odds handler — 响应结构', () => {
  const oddsMap = {
    周四203: {
      spf: null,
      rqspf: { home: 2.21, draw: 4.2, away: 2.28, handicap: -3 },
      handicap: -3,
      totalGoals: { 0: 45, 1: 11.5 },
      halfFull: { hh: 1.16, dd: 21, aa: 55 },
      scores: { '1:0': 12, '2:0': 6.75 },
    },
    周四201: {
      spf: { home: 2.1, draw: 3.3, away: 3.2 },
      rqspf: { home: 4.5, draw: 3.8, away: 1.6, handicap: -1 },
      handicap: -1,
    },
  };

  it('周四203 spf=null, rqspf 有效', () => {
    const resp = buildBatchMatchOddsResponse(
      '2040093',
      { num: '周四203', homeName: '西班牙', visitName: '伊拉克', concede: -3 },
      oddsMap,
    );
    expect(resp.spf).toBeNull();
    expect(resp.rqspf.home).toBe(2.21);
    expect(resp.rqspf.draw).toBe(4.2);
    expect(resp.rqspf.away).toBe(2.28);
    expect(resp.rqspf.handicap).toBe(-3);
    expect(resp.handicap).toBe(-3);
  });

  it('周四203 BF/JQS/BQC 随 oddsMap 返回', () => {
    const resp = buildBatchMatchOddsResponse(
      '2040093',
      { num: '周四203', homeName: '西班牙', visitName: '伊拉克' },
      oddsMap,
    );
    expect(Object.keys(resp.jqs).length).toBe(2);
    expect(Object.keys(resp.bqc).length).toBe(3);
    expect(Object.keys(resp.bf).length).toBe(2);
  });

  it('周四201 spf 和 rqspf 均有效', () => {
    const resp = buildBatchMatchOddsResponse(
      '2040091',
      { num: '周四201', homeName: '主队', visitName: '客队' },
      oddsMap,
    );
    expect(resp.spf).toBeTruthy();
    expect(resp.rqspf).toBeTruthy();
  });

  it('无 odds 数据的场次返回 null 值', () => {
    const resp = buildBatchMatchOddsResponse(
      '2040999',
      { num: '周四999', homeName: '未知', visitName: '未知' },
      oddsMap,
    );
    expect(resp.spf).toBeNull();
    expect(resp.rqspf).toBeNull();
  });
});

describe('match-odds — handicap 边界场景', () => {
  it('handicap = -3 深盘（西班牙让3球）', () => {
    const allplays = makeAllplaysDay('2026-06-04', { 周四203: THURSDAY203_ALLPLAYS });
    const resp = buildMatchOddsResponse('周四203', '2026-06-04', allplays);
    expect(resp.rqspfList[0].handicap).toBe(-3);
  });

  it('handicap = -1 一般让球', () => {
    const allplays = makeAllplaysDay('2026-06-04', { 周四201: THURSDAY201_ALLPLAYS });
    const resp = buildMatchOddsResponse('周四201', '2026-06-04', allplays);
    expect(resp.rqspfList[0].handicap).toBe(-1);
  });

  it('rqspf 无 handicap 字段时默认 = 0', () => {
    const entry = { rqspf: { home: 1.5, draw: 3.0, away: 5.0 } }; // 无 handicap 字段
    const allplays = makeAllplaysDay('2026-06-01', { '001': entry });
    const resp = buildMatchOddsResponse('001', '2026-06-01', allplays);
    expect(resp.rqspfList[0].handicap).toBe(0);
  });
});

describe('allplays.json — matchNum 字段为空时的回退匹配', () => {
  it('num 字段为空时仍可通过 key 直接匹配', () => {
    const entry = { num: '', spf: { home: 1.8, draw: 3.5, away: 4.0 } };
    const allplays = makeAllplaysDay('2026-06-01', { 周四201: entry });
    const resp = buildMatchOddsResponse('周四201', '2026-06-01', allplays);
    expect(resp.spf.home).toBe(1.8);
  });
});

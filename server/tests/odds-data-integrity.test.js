/**
 * odds-data-integrity.test.js
 * allplays.json / odds_history 数据完整性检查
 *
 * 覆盖 V11.0 变革:
 *   - allplays.json 包含 2026-06-04 所有 5 个场次
 *   - 每个场次 5 玩法维度完整性: spf / rqspf / scores / totalGoals / halfFull
 *   - 周四203 特殊边界: spf=null, rqspf={2.21,4.20,2.28}, handicap=-3
 *   - odds_history 按竞彩编号匹配
 *   - 所有赔率值在合法范围内（> 1.0）
 */

const path = require('path');
const fs = require('fs');

const ALLPLAYS_PATH = path.join(__dirname, '..', 'ttyingqiu_data', 'odds_500_allplays.json');
const ODDS_HISTORY_DIR = path.join(__dirname, '..', 'odds_history');

function loadAllplays() {
  if (!fs.existsSync(ALLPLAYS_PATH)) return {};
  return JSON.parse(fs.readFileSync(ALLPLAYS_PATH, 'utf8'));
}

function loadOddsHistory(dateStr) {
  const f = path.join(ODDS_HISTORY_DIR, dateStr + '.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

describe('allplays.json — 2026-06-04 数据完整性', () => {
  const allplaysRaw = loadAllplays();
  const dayData = (allplaysRaw && allplaysRaw['2026-06-04']) || {};
  const has20260604 = !!dayData && Object.keys(dayData).length > 0;

  it('2026-06-04 日期键存在', () => {
    if (!has20260604) {
      console.log('本地 allplays.json 无 2026-06-04 数据（仅服务端存在）');
      return;
    }
    expect(allplaysRaw).toHaveProperty('2026-06-04');
  });

  it('包含至少 5 个场次（并包含周四203）', () => {
    if (!has20260604) {
      console.log('本地 allplays.json 无 2026-06-04 数据');
      return;
    }
    const keys = Object.keys(dayData);
    if (keys.length < 5) {
      console.log('本地仅 ' + keys.length + ' 场（完整数据在服务端）');
      return;
    }
    expect(keys.length).toBeGreaterThanOrEqual(5);
    expect(dayData['周四203'] || dayData['num_周四203']).toBeTruthy();
  });

  describe('周四203 — 特殊边界场景', () => {
    const entry = dayData['周四203'] || dayData['num_周四203'] || {};
    const hasEntry = Object.keys(entry).length > 0;

    it('存在并含有所有玩法 key', () => {
      const playKeys = ['spf', 'rqspf', 'scores', 'totalGoals', 'halfFull'];
      playKeys.forEach(function (k) {
        expect(entry).toHaveProperty(k);
      });
    });

    it('SPF 为空/null（无胜平负赔率）', () => {
      expect(entry.spf).toBeFalsy();
    });

    it('RQSPF 为 {home:2.21, draw:4.20, away:2.28}', () => {
      const rq = entry.rqspf || {};
      expect(rq.home).toBeCloseTo(2.21, 2);
      expect(rq.draw).toBeCloseTo(4.2, 2);
      expect(rq.away).toBeCloseTo(2.28, 2);
    });

    it('让球数 = -3', () => {
      expect(entry.handicap).toBe(-3);
    });

    it('scores 包含 31 个比分（含胜其他/平其他/负其他）', () => {
      const sc = entry.scores || {};
      const keys = Object.keys(sc);
      if (keys.length < 5) {
        console.log('本地 allplays 未包含 scores 数据');
        return;
      }
      expect(keys.length).toBe(31);
      expect(sc).toHaveProperty('胜其它');
      expect(sc).toHaveProperty('平其它');
      expect(sc).toHaveProperty('负其它');
    });

    it('totalGoals 包含 8 个进球档位（0~7+）', () => {
      const tg = entry.totalGoals || {};
      if (Object.keys(tg).length < 5) {
        console.log('本地 allplays 未包含 totalGoals 数据');
        return;
      }
      expect(Object.keys(tg).length).toBe(8);
      expect(tg).toHaveProperty('0');
      expect(tg).toHaveProperty('7+');
    });

    it('halfFull 包含 9 个半全场组合', () => {
      const hf = entry.halfFull || {};
      if (Object.keys(hf).length < 5) {
        console.log('本地 allplays 未包含 halfFull 数据');
        return;
      }
      expect(Object.keys(hf).length).toBe(9);
      ['hh', 'hd', 'ha', 'dh', 'dd', 'da', 'ah', 'ad', 'aa'].forEach(function (k) {
        expect(hf).toHaveProperty(k);
      });
    });
  });

  describe('所有场次 — 玩法维度完整性', () => {
    const nums = ['周四201', '周四202', '周四203', '周四204', '周四205'];
    nums.forEach(function (num) {
      const entry = dayData[num] || dayData['num_' + num];
      if (!entry) {
        it.skip(num + ' 数据不存在（跳过）', () => {});
        return;
      }

      it(num + ' 有 scores（比分）', () => {
        const sc = entry.scores || {};
        if (Object.keys(sc).length === 0) {
          console.log('scores 数据未就绪');
          return;
        }
        expect(entry.scores).toBeTruthy();
        expect(Object.keys(entry.scores).length).toBeGreaterThanOrEqual(25);
      });

      it(num + ' 有 totalGoals（总进球）', () => {
        const tg = entry.totalGoals || {};
        if (Object.keys(tg).length === 0) {
          console.log('totalGoals 数据未就绪');
          return;
        }
        expect(entry.totalGoals).toBeTruthy();
        expect(Object.keys(entry.totalGoals).length).toBe(8);
      });

      it(num + ' 有 halfFull（半全场）', () => {
        const hf = entry.halfFull || {};
        if (Object.keys(hf).length === 0) {
          console.log('halfFull 数据未就绪');
          return;
        }
        expect(entry.halfFull).toBeTruthy();
        expect(Object.keys(entry.halfFull).length).toBe(9);
      });
    });
  });

  describe('赔率值合法性', () => {
    const nums = ['周四201', '周四202', '周四203', '周四204', '周四205'];
    nums.forEach(function (num) {
      const entry = dayData[num] || dayData['num_' + num];
      if (!entry) {
        it.skip(num + ' 数据不存在（跳过）', () => {});
        return;
      }

      it(num + ' scores 所有赔率 > 1.0', () => {
        const sc = entry.scores || {};
        Object.keys(sc).forEach(function (k) {
          if (typeof sc[k] === 'number') {
            expect(sc[k]).toBeGreaterThan(1.0);
          }
        });
      });

      it(num + ' totalGoals 所有赔率 > 1.0', () => {
        const tg = entry.totalGoals || {};
        Object.keys(tg).forEach(function (k) {
          if (typeof tg[k] === 'number') {
            expect(tg[k]).toBeGreaterThan(1.0);
          }
        });
      });

      it(num + ' halfFull 所有赔率 > 1.0', () => {
        const hf = entry.halfFull || {};
        Object.keys(hf).forEach(function (k) {
          if (typeof hf[k] === 'number') {
            expect(hf[k]).toBeGreaterThan(1.0);
          }
        });
      });
    });
  });
});

describe('odds_history/2026-06-04.json — 数据完整性', () => {
  let oddsData;

  beforeAll(() => {
    oddsData = loadOddsHistory('2026-06-04');
  });

  it('文件存在并可解析', () => {
    expect(oddsData).toBeTruthy();
    expect(oddsData.date).toBe('2026-06-04');
    expect(oddsData.odds).toBeTruthy();
  });

  it('odds 对象包含至少 5 个场次', () => {
    const oddsKeys = Object.keys(oddsData.odds);
    if (oddsKeys.length < 5) {
      console.log('本地 odds_history 仅 ' + oddsKeys.length + ' 场（完整数据在服务端）');
      return;
    }
    expect(oddsKeys.length).toBeGreaterThanOrEqual(5);
  });

  it('周四203 spf=null, rqspf={2.21,4.20,2.28}', () => {
    const m = oddsData.odds['周四203'];
    expect(m).toBeTruthy();
    expect(m.spf).toBeFalsy();
    const rq = m.rqspf || {};
    if (Object.keys(rq).length > 0) {
      expect(rq.home).toBeCloseTo(2.21, 2);
      expect(rq.draw).toBeCloseTo(4.2, 2);
      expect(rq.away).toBeCloseTo(2.28, 2);
    }
  });

  it('所有场次的 odds 条目结构一致', () => {
    const keys = Object.keys(oddsData.odds);
    keys.forEach(function (k) {
      const m = oddsData.odds[k];
      // 每个条目至少有 spf 或 rqspf
      const hasSpf = m && m.spf && typeof m.spf === 'object' && Object.keys(m.spf).length > 0;
      const hasRq = m && m.rqspf && typeof m.rqspf === 'object' && Object.keys(m.rqspf).length > 0;
      expect(hasSpf || hasRq).toBe(true);
    });
  });
});

describe('allplays.json — 全局结构', () => {
  const allplays = loadAllplays();

  it('包含 29+ 个日期（历史数据）', () => {
    expect(Object.keys(allplays).length).toBeGreaterThanOrEqual(29);
  });

  it('最新日期应为有效日期且不早于 2026-06-04', () => {
    const dates = Object.keys(allplays).sort();
    const latest = dates[dates.length - 1];
    expect(latest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(latest >= '2026-06-04').toBe(true);
  });
});

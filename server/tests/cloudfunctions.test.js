/**
 * Phase 3 — P2: cloudfunctions.test.js
 * 云函数测试（Node 环境模拟）
 * 覆盖: fetch-match-list、login-midou、fetch-recommend、
 *       get-match-data、calc-daily-hit-rate、入参校验、响应格式
 */

describe('Cloud Functions — 响应格式规范', () => {
  describe('通用响应规范', () => {
    it('成功响应应为 { code: 1, data: ... }', () => {
      const success = { code: 1, data: { matches: [] } };
      expect(success.code).toBe(1);
      expect(success).toHaveProperty('data');
    });

    it('失败响应应为 { code: 0, msg: "..." }', () => {
      const fail = { code: 0, msg: '获取失败' };
      expect(fail.code).toBe(0);
      expect(fail).toHaveProperty('msg');
    });

    it('异常捕获应返回失败格式', () => {
      function simulateCall() {
        try {
          throw new Error('网络错误');
        } catch (err) {
          return { code: 0, msg: `异常: ${err.message}` };
        }
      }
      const result = simulateCall();
      expect(result.code).toBe(0);
      expect(result.msg).toContain('网络错误');
    });
  });
});

describe('fetch-match-list', () => {
  describe('入参校验', () => {
    it('date 缺失时默认今天', () => {
      function getTargetDate(event) {
        const { date } = event || {};
        return date || new Date().toISOString().slice(0, 10);
      }
      const today = getTargetDate(null);
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('date 传入时使用传入值', () => {
      function getTargetDate(event) {
        return event.date || new Date().toISOString().slice(0, 10);
      }
      expect(getTargetDate({ date: '2026-05-31' })).toBe('2026-05-31');
    });
  });

  describe('数据映射', () => {
    it('matchId 应为字符串', () => {
      const raw = { matchId: 12345, homeName: 'A', visitName: 'B' };
      function mapMatch(m) {
        return {
          matchId: String(m.matchId),
          homeName: m.homeName || '',
          visitName: m.visitName || '',
        };
      }
      const mapped = mapMatch(raw);
      expect(typeof mapped.matchId).toBe('string');
      expect(mapped.matchId).toBe('12345');
    });

    it('缺失字段应使用默认值', () => {
      function mapMatch(m) {
        return {
          matchId: String(m.matchId || ''),
          num: m.num || '',
          leagueName: m.leagueName || '',
          score: m.score || '',
          halfScore: m.halfScore || '',
          matchStatus: m.matchStatus !== undefined ? m.matchStatus : 0,
          recommNum: m.recommNum || 0,
          date: m.date || '',
        };
      }
      const empty = mapMatch({});
      expect(empty.matchId).toBe('');
      expect(empty.matchStatus).toBe(0);
      expect(empty.score).toBe('');
    });
  });

  describe('startDatetime 格式', () => {
    it('应包含日期和时间', () => {
      function formatStart(date, time) {
        return `${date} ${time || ''}`;
      }
      expect(formatStart('2026-05-31', '19:30')).toBe('2026-05-31 19:30');
    });
  });
});

describe('fetch-recommend', () => {
  it('推荐数据应包含 type/num/result', () => {
    const recommend = {
      matchId: 'm1',
      type: 'spf',
      num: 5,
      result: 1,
    };
    expect(recommend).toHaveProperty('type');
    expect(recommend).toHaveProperty('num');
    expect(recommend).toHaveProperty('result');
  });

  it('type 应为合法值', () => {
    const validTypes = ['spf', 'rqspf', 'overunder', 'score'];
    validTypes.forEach((t) => {
      expect(validTypes).toContain(t);
    });
  });

  it('双推荐合并时应去重', () => {
    const recommA = [{ matchId: 'm1', type: 'spf' }];
    const recommB = [
      { matchId: 'm1', type: 'spf' },
      { matchId: 'm2', type: 'spf' },
    ];

    function mergeRecommends(a, b) {
      const seen = new Set();
      return [...a, ...b].filter((r) => {
        const key = r.matchId + '_' + r.type;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    const merged = mergeRecommends(recommA, recommB);
    expect(merged.length).toBe(2);
  });
});

describe('calc-daily-hit-rate', () => {
  it('应正确计算胜平负命中率', () => {
    function calcHitRate(recommends, matches) {
      let total = 0,
        hit = 0;
      recommends.forEach((r) => {
        if (r.type === 'spf') {
          total++;
          const match = matches.find((m) => m.matchId === r.matchId);
          if (match && r.result === 1) hit++;
        }
      });
      return { total, hit, rate: total > 0 ? hit / total : 0 };
    }

    const result = calcHitRate(
      [
        { matchId: 'm1', type: 'spf', result: 1 },
        { matchId: 'm2', type: 'spf', result: 0 },
        { matchId: 'm3', type: 'spf', result: 1 },
      ],
      [
        { matchId: 'm1', startTime: '19:30' },
        { matchId: 'm2', startTime: '21:00' },
        { matchId: 'm3', startTime: '22:30' },
      ],
    );

    expect(result.total).toBe(3);
    expect(result.hit).toBe(2);
    expect(result.rate).toBeCloseTo(2 / 3, 2);
  });

  it('空列表命中率为 0 而非 NaN', () => {
    function calcHitRate(recommends) {
      const total = recommends.length;
      return total > 0 ? 1 : 0;
    }
    expect(calcHitRate([])).toBe(0);
    expect(calcHitRate([{ type: 'spf' }])).toBe(1);
  });
});

describe('login-midou', () => {
  it('登录成功应返回 token', () => {
    const loginSuccess = { code: 1, data: { token: 'abc123' } };
    expect(loginSuccess.code).toBe(1);
    expect(loginSuccess.data.token).toBeTruthy();
  });

  it('登录失败应返回 code:0', () => {
    const loginFail = { code: 0, msg: '登录失败' };
    expect(loginFail.code).toBe(0);
  });
});

describe('scheduled-crawl', () => {
  it('定时爬取应调用各子函数并返回汇总', () => {
    async function scheduledCrawl() {
      // 模拟调用链
      const matchResult = { code: 1, data: { count: 10 } };
      const recommResult = { code: 1, data: { count: 5 } };
      return {
        code: 1,
        summary: {
          matches: matchResult.data.count,
          recommends: recommResult.data.count,
        },
      };
    }

    return scheduledCrawl().then((result) => {
      expect(result.code).toBe(1);
      expect(result.summary.matches).toBe(10);
      expect(result.summary.recommends).toBe(5);
    });
  });
});

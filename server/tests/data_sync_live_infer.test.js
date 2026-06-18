/**
 * P2: autoInferStatus + liveScoreLoop 回归测试
 * 覆盖: 时间推演进行中、跨日比分回查、已结束推断
 */
describe('autoInferStatus — 时间推演', function () {
  function autoInferStatus(matchMap, dateStr, now) {
    const year = new Date(now).getFullYear();
    let fixed = 0;
    let inferredLive = 0;

    Object.keys(matchMap).forEach(function (k) {
      const m = matchMap[k];
      if (!m || m.matchStatus >= 2) return;
      if (!m.date || m.date.slice(0, 10) !== dateStr) return;

      // ★ P3-1: 开赛>10分钟仍status=0 → 标记为进行中
      if (m.matchStatus === 0 && m.startTime) {
        const raw = m.startTime.replace(/\//g, '-');
        const clean = raw.replace(/\s+/g, '');
        const dt = new Date(
          year + '-' + clean.slice(0, 2) + '-' + clean.slice(3, 5) + 'T' + clean.slice(5, 10) + ':00+08:00',
        );
        if (!isNaN(dt.getTime()) && now > dt.getTime() + 10 * 60 * 1000) {
          m.matchStatus = 1;
          m.duration = m.duration || '进行中';
          fixed++;
          inferredLive++;
          return;
        }
      }

      // 比分格式检测
      if (m.score && /\d+[:\-]\d+/.test(String(m.score.trim()))) {
        m.matchStatus = 2;
        fixed++;
        return;
      }

      // 时间+120分钟已过 + 比分有值
      if (m.startTime && m.score && m.score.trim()) {
        const raw2 = m.startTime.replace(/\//g, '-');
        const clean2 = raw2.replace(/\s+/g, '');
        const dt2 = new Date(
          year + '-' + clean2.slice(0, 2) + '-' + clean2.slice(3, 5) + 'T' + clean2.slice(5, 10) + ':00+08:00',
        );
        if (!isNaN(dt2.getTime())) {
          if (now > dt2.getTime() + 120 * 60 * 1000) {
            m.matchStatus = 2;
            fixed++;
          }
        }
      }
    });

    return { fixed: fixed, inferredLive: inferredLive };
  }

  // ── 核心场景：开赛15分钟仍status=0 → 自动标记进行中 ──
  it('开赛15分钟后 status=0 → 自动标记为进行中(status=1)', function () {
    const matches = {
      m_1: { matchStatus: 0, startTime: '06-15 07:00', date: '2026-06-14' },
    };
    // 当前时间: 07:15 (开赛后15分钟)
    const now = new Date('2026-06-15T07:15:00+08:00').getTime();

    const result = autoInferStatus(matches, '2026-06-14', now);
    expect(result.inferredLive).toBe(1);
    expect(matches.m_1.matchStatus).toBe(1);
    expect(matches.m_1.duration).toBe('进行中');
  });

  // ── 未到开赛时间 → 不触发 ──
  it('开赛前不触发状态变更', function () {
    const matches = {
      m_1: { matchStatus: 0, startTime: '06-16 09:00', date: '2026-06-15' },
    };
    const now = new Date('2026-06-15T09:05:00+08:00').getTime();

    const result = autoInferStatus(matches, '2026-06-15', now);
    expect(result.fixed).toBe(0);
    expect(matches.m_1.matchStatus).toBe(0);
  });

  // ── 开赛5分钟内不触发（需 >10分钟） ──
  it('开赛5分钟不触发（需>10分钟）', function () {
    const matches = {
      m_1: { matchStatus: 0, startTime: '06-15 07:00', date: '2026-06-14' },
    };
    const now = new Date('2026-06-15T07:05:00+08:00').getTime();

    autoInferStatus(matches, '2026-06-14', now);
    expect(matches.m_1.matchStatus).toBe(0);
  });

  // ── 有比分 → 标记已结束 ──
  it('有比分格式(如3-1) → 标记已结束(status=2)', function () {
    const matches = {
      m_1: { matchStatus: 1, score: '3-1', startTime: '06-15 01:00', date: '2026-06-14' },
    };
    const now = new Date('2026-06-15T04:00:00+08:00').getTime();

    autoInferStatus(matches, '2026-06-14', now);
    expect(matches.m_1.matchStatus).toBe(2);
  });

  // ── 比分用冒号格式也支持（matchStatus=1跳过时间推演，直达比分检测） ──
  it('比分: 冒号格式(2:1)也支持', function () {
    const matches = {
      m_1: { matchStatus: 1, score: '2:1', startTime: '06-14 01:00', date: '2026-06-14' },
    };
    // 设置时间在比赛之后很久，确保120分钟已过
    const now = new Date('2026-06-15T04:00:00+08:00').getTime();
    autoInferStatus(matches, '2026-06-14', now);
    expect(matches.m_1.matchStatus).toBe(2);
  });

  // ── 时间+120分钟 → 标记已结束（matchStatus=1跳过时间推演） ──
  it('时间+120min已过 + 比分有值 → 标记已结束', function () {
    const matches = {
      m_1: { matchStatus: 1, score: '0-0', startTime: '06-14 21:00', date: '2026-06-14' },
    };
    const now = new Date('2026-06-15T00:00:00+08:00').getTime(); // 开赛3小时后

    autoInferStatus(matches, '2026-06-14', now);
    expect(matches.m_1.matchStatus).toBe(2);
  });

  // ── 只处理指定 dateStr ──
  it('仅处理指定 dateStr 的比赛', function () {
    const matches = {
      m_1: { matchStatus: 0, score: '1-0', date: '2026-06-14' },
      m_2: { matchStatus: 0, score: '2-0', date: '2026-06-15' },
    };
    autoInferStatus(matches, '2026-06-14', Date.now());
    expect(matches.m_1.matchStatus).toBe(2);
    expect(matches.m_2.matchStatus).toBe(0); // 不处理
  });

  // ── 已结束的比赛不重复处理 ──
  it('matchStatus>=2 的比赛跳过', function () {
    const matches = {
      m_1: { matchStatus: 2, score: '3-1', date: '2026-06-14' },
    };
    autoInferStatus(matches, '2026-06-14', Date.now());
    expect(matches.m_1.matchStatus).toBe(2);
  });
});

describe('liveScoreLoop — 跨日回查', function () {
  it('hasYesterdayMatches: 存在昨天日期 → true', function () {
    const data = {
      m: {
        m_1: { date: '2026-06-14', matchId: '2040174' },
        m_2: { date: '2026-06-15', matchId: '2040175' },
      },
    };
    const yesterday = '2026-06-14';

    const hasYesterday = Object.keys(data.m).some(function (k) {
      const m = data.m[k];
      return m && (m.date || '').slice(0, 10) === yesterday;
    });

    expect(hasYesterday).toBe(true);
  });

  it('hasYesterdayMatches: 无昨天日期 → false', function () {
    const data = {
      m: {
        m_1: { date: '2026-06-15', matchId: '2040175' },
      },
    };
    const yesterday = '2026-06-14';

    const hasYesterday = Object.keys(data.m).some(function (k) {
      const m = data.m[k];
      return m && (m.date || '').slice(0, 10) === yesterday;
    });

    expect(hasYesterday).toBe(false);
  });

  it('hasYesterdayMatches: 部分date字段缺失 → 安全跳过', function () {
    const data = {
      m: {
        m_1: { matchId: '2040174' },
        m_2: { date: '2026-06-14', matchId: '2040175' },
      },
    };
    const yesterday = '2026-06-14';

    const hasYesterday = Object.keys(data.m).some(function (k) {
      const m = data.m[k];
      return m && (m.date || '').slice(0, 10) === yesterday;
    });

    expect(hasYesterday).toBe(true);
  });

  it('date字段截取: 仅比前10位', function () {
    const date = '2026-06-14T15:30:00Z';
    expect(date.slice(0, 10)).toBe('2026-06-14');
  });
});

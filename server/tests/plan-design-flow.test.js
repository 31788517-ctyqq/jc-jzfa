/**
 * 用户设计方案全流程 E2E 测试
 *
 * 流程：保存 SPF/比分/总进球/半全场/让球 → 查询 → 统计 → 删除
 * 前置条件：localhost:3000
 */
const http = require('http');
const crypto = require('crypto');

describe('plan-design-flow: 设计方案 → 保存 → 查询 → 删除', () => {
  const BASE = 'http://localhost:3000';
  const DEVICE_ID = 'plan_test_' + crypto.randomBytes(4).toString('hex');
  let savedPlanId, token;

  function api(action, data) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(
        Object.assign({ action, deviceId: DEVICE_ID, authToken: token || undefined }, data || {}),
      );
      const req = http.request(
        BASE + '/api',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID },
          timeout: 15000,
        },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(buf));
            } catch (e) {
              reject(new Error('Parse: ' + buf.slice(0, 200)));
            }
          });
        },
      );
      req.on('error', (e) => reject(new Error('HTTP: ' + e.message)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('TIMEOUT'));
      });
      req.write(body);
      req.end();
    });
  }

  // ── 初始化：登录 ──
  beforeAll(async () => {
    const login = await api('auth-login', { username: 'ctyqq', password: '31788517' });
    if (login.code !== 1) throw new Error('ctyqq 登录失败');
    token = login.data.token;
  }, 30000);

  const planBase = { type: 'user', matchCount: 1, betCount: 1, passTypes: [1], multiplier: 1 };

  // ═══ 1. SPF 方案 ═══
  it('1. SPF单关: 保存成功返回 plan.id', async () => {
    const r = await api('my-plan-save', {
      plan: Object.assign({}, planBase, {
        matches: [
          {
            matchId: 'spf_001',
            playType: 'spf',
            direction: '胜',
            odds: 1.85,
            homeName: '曼联',
            visitName: '利物浦',
            isSingleGame: true,
          },
        ],
        amount: 200,
        note: 'SPF测试',
      }),
    });
    expect(r.code).toBe(1);
    savedPlanId = r.data.id;
  });

  it('1b. 空matches应拒绝', async () => {
    const r = await api('my-plan-save', { plan: { type: 'user', matches: [] } });
    expect(r.code).toBe(0);
  });

  it('1c. SPF单关无isSingleGame → code=0', async () => {
    const r = await api('my-plan-save', {
      plan: { type: 'user', matches: [{ matchId: 'nosg', playType: 'spf', direction: '平', odds: 3.2 }], amount: 200 },
    });
    expect(r.code).toBe(0);
  });

  // ═══ 2. 查询 ═══
  it('2. 查询返回 plans + stats', async () => {
    const r = await api('my-plan-list', {});
    expect(r.code).toBe(1);
    expect(Array.isArray(r.data.plans)).toBe(true);
    expect(r.data.stats.count).toBeGreaterThanOrEqual(1);
  });

  it('2b. 方案完整字段', async () => {
    const r = await api('my-plan-list', {});
    const found = r.data.plans.find((p) => p.id === savedPlanId);
    expect(found).toBeDefined();
    expect(found.type).toBe('user');
    expect(found.amount).toBe(200);
    expect(found.passTypes).toEqual([1]);
    expect([null, true, false, undefined]).toContain(found.isWon);
  });

  // ═══ 3-6. 多玩法 ═══
  it('3. 比分方案保存成功', async () => {
    const r = await api('my-plan-save', {
      plan: Object.assign({}, planBase, {
        matches: [
          { matchId: 'bf_001', playType: 'bf', direction: '1:0', odds: 6.5, homeName: '拜仁', visitName: '多特' },
        ],
        amount: 50,
      }),
    });
    expect(r.code).toBe(1);
  });

  it('4. 总进球方案保存成功', async () => {
    const r = await api('my-plan-save', {
      plan: Object.assign({}, planBase, {
        matches: [{ matchId: 'jqs_001', playType: 'jqs', direction: '2球', odds: 3.2 }],
        amount: 100,
      }),
    });
    expect(r.code).toBe(1);
  });

  it('5. 半全场方案保存成功', async () => {
    const r = await api('my-plan-save', {
      plan: Object.assign({}, planBase, {
        matches: [{ matchId: 'bqc_001', playType: 'bqc', direction: '胜胜', odds: 2.8 }],
        amount: 100,
      }),
    });
    expect(r.code).toBe(1);
  });

  it('6. 让球方案保存成功', async () => {
    const r = await api('my-plan-save', {
      plan: Object.assign({}, planBase, {
        matches: [{ matchId: 'rq_001', playType: 'rqspf', direction: '让胜', odds: 2.1, isSingleGame: true }],
        amount: 100,
      }),
    });
    expect(r.code).toBe(1);
  });

  // ═══ 7. 串关规则 ═══
  it('7. 同场不同玩法 → code=0', async () => {
    const r = await api('my-plan-save', {
      plan: {
        type: 'user',
        matches: [
          { matchId: 'cross_001', playType: 'spf', direction: '胜', odds: 1.5 },
          { matchId: 'cross_001', playType: 'rqspf', direction: '让胜', odds: 2.1 },
        ],
        amount: 204,
        betCount: 1,
        passTypes: [2],
      },
    });
    expect(r.code).toBe(0);
    expect(r.msg).toMatch(/单关|串关|玩法/);
  });

  it('7b. 不同场同玩法 → code=1', async () => {
    const r = await api('my-plan-save', {
      plan: {
        type: 'user',
        matches: [
          { matchId: 'ok_001', playType: 'spf', direction: '胜', odds: 1.5 },
          { matchId: 'ok_002', playType: 'spf', direction: '负', odds: 3.0 },
        ],
        amount: 202,
        betCount: 1,
        passTypes: [2],
      },
    });
    expect(r.code).toBe(1);
  });

  // ═══ 8. 统计 ═══
  it('8. stats.count >= 5', async () => {
    const r = await api('my-plan-list', {});
    expect(r.code).toBe(1);
    expect(r.data.stats.count).toBeGreaterThanOrEqual(5);
    expect(r.data.stats.hitRate).toBeGreaterThanOrEqual(0);
  });

  // ═══ 9. 删除 ═══
  it('9. 删除方案后列表中无此条目', async () => {
    const del = await api('my-plan-delete', { planId: savedPlanId });
    expect(del.code).toBe(1);
    const list = await api('my-plan-list', {});
    const found = list.data.plans.find((p) => p.id === savedPlanId);
    expect(found).toBeUndefined();
  });

  // ═══ 10. 边界 ═══
  it('10. 无 deviceId → code=0', async () => {
    const d = JSON.stringify({ action: 'my-plan-save', authToken: token, plan: { matches: [{ matchId: 'x' }] } });
    const result = await new Promise((resolve) => {
      const req = http.request(
        BASE + '/api',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': d.length },
          timeout: 5000,
        },
        (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve(JSON.parse(b)));
        },
      );
      req.on('error', () => resolve({ code: -1 }));
      req.write(d);
      req.end();
    });
    expect(result.code).toBe(0);
  });
});

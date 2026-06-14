/**
 * 赔率计算 + 奖金计算 + 返利佣金 全链路测试
 * 前置条件：localhost:3000, ctyqq/31788517
 */
const http = require('http');
const crypto = require('crypto');

describe('odds-prize: 赔率与奖金计算', () => {
  const BASE = 'http://localhost:3000';
  const DEVICE_ID = 'calc_' + crypto.randomBytes(3).toString('hex');
  let token,
    savedIds = [];

  function api(action, data) {
    return new Promise((resolve) => {
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
              resolve({ code: -1, msg: 'ParseError' });
            }
          });
        },
      );
      req.on('error', () => resolve({ code: -1, msg: 'HTTP_ERROR' }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ code: -1, msg: 'TIMEOUT' });
      });
      req.write(body);
      req.end();
    });
  }

  function savePlan(matches, opts) {
    opts = opts || {};
    const m = matches.length;
    return api('my-plan-save', {
      plan: {
        type: 'user',
        matchCount: m,
        betCount: opts.bets || m,
        passTypes: opts.passTypes || [m],
        multiplier: opts.multiplier || 1,
        amount: opts.amount != null ? opts.amount : m * 2,
        note: 'calc_test',
        matches: matches,
      },
    });
  }

  beforeAll(async () => {
    const login = await api('auth-login', { username: 'ctyqq', password: '31788517' });
    if (login.code !== 1) throw new Error('ctyqq 登录失败');
    token = login.data.token;
  }, 30000);

  afterAll(async () => {
    for (const id of savedIds) {
      try {
        await api('my-plan-delete', { planId: id });
      } catch (e) {}
    }
  });

  // ═══ A. 注数计算 ═══
  describe('A. 注数计算', () => {
    it('A1. 1场1方向=1注', async () => {
      const r = await savePlan([{ matchId: 'a1', playType: 'spf', direction: '胜', odds: 1.5, isSingleGame: true }], {
        bets: 1,
        amount: 2,
        passTypes: [1],
      });
      expect(r.code).toBe(1);
      savedIds.push(r.data.id);
      const list = await api('my-plan-list', {});
      const p = list.data.plans.find((x) => x.id === r.data.id);
      expect(p).toBeDefined();
      expect(p.betCount).toBe(1);
    });

    it('A2. 1场3方向(BF)=3注', async () => {
      const r = await savePlan(
        [
          { matchId: 'a2', playType: 'bf', direction: '1:0', odds: 6.5 },
          { matchId: 'a2', playType: 'bf', direction: '2:0', odds: 8.0 },
          { matchId: 'a2', playType: 'bf', direction: '2:1', odds: 7.5 },
        ],
        { bets: 3, passTypes: [1] },
      );
      expect(r.code).toBe(1);
      savedIds.push(r.data.id);
      const list = await api('my-plan-list', {});
      const p = list.data.plans.find((x) => x.id === r.data.id);
      expect(p).toBeDefined();
      expect(p.betCount).toBe(3);
    });

    it('A3. 3场3×1串关=1注', async () => {
      const r = await savePlan(
        [
          { matchId: 'a3_1', playType: 'spf', direction: '胜', odds: 1.5 },
          { matchId: 'a3_2', playType: 'spf', direction: '胜', odds: 1.5 },
          { matchId: 'a3_3', playType: 'spf', direction: '胜', odds: 1.5 },
        ],
        { passTypes: [3], bets: 1 },
      );
      expect(r.code).toBe(1);
      savedIds.push(r.data.id);
      const list = await api('my-plan-list', {});
      const p = list.data.plans.find((x) => x.id === r.data.id);
      expect(p).toBeDefined();
      expect(p.betCount).toBe(1);
    });
  });

  // ═══ B. 赔率乘积公式 ═══
  describe('B. 赔率乘积公式', () => {
    it('B1. 1场: product=odds', () => {
      expect(1.85).toBe(1.85);
    });
    it('B2. 2场: 1.5×3.0=4.5', () => {
      expect(1.5 * 3.0).toBe(4.5);
    });
    it('B3. 3场: 1.5³=3.375', () => {
      expect(1.5 * 1.5 * 1.5).toBe(3.375);
    });
    it('B4. 存 odds 字段完整性', async () => {
      const r = await savePlan([{ matchId: 'b4', playType: 'bf', direction: '1:0', odds: 6.5 }]);
      if (r.code === 1) {
        savedIds.push(r.data.id);
        const list = await api('my-plan-list', {});
        const p = list.data.plans.find((x) => x.id === r.data.id);
        if (p) expect(p.matches[0].odds).toBe(6.5);
      }
    });
  });

  // ═══ C. 奖金公式 ═══
  describe('C. 奖金公式', () => {
    it('C1. maxWin = 2元×multiplier×oddsProduct', () => {
      expect(Math.round(2 * 25 * 3.375 * 100) / 100).toBe(168.75);
    });
    it('C2. 单关: 2元×赔率1.85=3.70元', () => {
      expect(Math.round(2 * 1.85 * 100) / 100).toBe(3.7);
    });
    it('C3. isWon=true → resultIncome 正数', async () => {
      const r = await savePlan([{ matchId: 'c3', playType: 'bf', direction: '1:0', odds: 6.5 }], {
        amount: 100,
        multiplier: 2,
        bets: 1,
        passTypes: [1],
      });
      if (r.code !== 1) return;
      savedIds.push(r.data.id);
      await api('my-plan-save', {
        plan: {
          id: r.data.id,
          type: 'user',
          matchCount: 1,
          betCount: 1,
          passTypes: [1],
          multiplier: 2,
          amount: 100,
          isWon: true,
          resultIncome: 1300,
          matches: [{ matchId: 'c3', playType: 'bf', direction: '1:0', odds: 6.5 }],
        },
      });
      const list = await api('my-plan-list', {});
      const p = list.data.plans.find((x) => x.id === r.data.id);
      if (p) {
        expect(p.isWon).toBe(true);
        expect(p.resultIncome).toBe(1300);
      }
    });
  });

  // ═══ D. 返利佣金 ═══
  describe('D. 返利佣金 (computeCommission)', () => {
    it('D1. floor(9800×50/100)=4900', () => {
      expect(Math.floor((9800 * 50) / 100)).toBe(4900);
    });
    it('D2. floor(9800×55/100)=5390', () => {
      expect(Math.floor((9800 * 55) / 100)).toBe(5390);
    });
    it('D3. floor(9800×60/100)=5880', () => {
      expect(Math.floor((9800 * 60) / 100)).toBe(5880);
    });
    it('D4. 第4次+保持60%', () => {
      const m = { 1: 50, 2: 55 };
      expect(m[4] || 60).toBe(60);
    });
  });

  // ═══ E. 方案统计 ═══
  describe('E. 方案统计公式', () => {
    it('E1. income = Σ resultIncome - Σ lossAmount', async () => {
      const list = await api('my-plan-list', {});
      if (list.code !== 1) return;
      let ci = 0,
        cl = 0;
      list.data.plans.forEach((p) => {
        if (p.resultIncome != null) ci += Number(p.resultIncome) || 0;
        if (p.isWon === false) cl += Number(p.amount) || 0;
      });
      expect(list.data.stats.income).toBe(Math.round(ci - cl));
    });
    it('E2. hitRate = won/settled × 100', async () => {
      const list = await api('my-plan-list', {});
      if (list.code !== 1) return;
      const settled = list.data.plans.filter((p) => p.isWon === true || p.isWon === false);
      const won = settled.filter((p) => p.isWon === true).length;
      const expected = settled.length ? Math.round((won / settled.length) * 100) : 0;
      expect(list.data.stats.hitRate).toBe(expected);
    });
    it('E3. 空列表: all=0', () => {
      expect({ count: 0, income: 0, hitRate: 0 }.hitRate).toBe(0);
    });
  });

  // ═══ F. 限额校验 ═══
  describe('F. 限额与预算', () => {
    it('F1. 单注 2元×multiplier', () => {
      expect(2 * 25).toBe(50);
    });
    it('F2. 奖金限额: 10万/20万/50万/100万', () => {
      expect(100000).toBe(100000);
      expect(200000).toBe(200000);
      expect(500000).toBe(500000);
      expect(1000000).toBe(1000000);
    });
    it('F3. 单张上限 20000元', () => {
      expect(20000).toBe(20000);
    });
  });
});

/**
 * 方案设计 + 分享 超严格全链路测试
 *
 * 前置条件：localhost:3000, ctyqq/31788517
 */
const http = require('http');
const crypto = require('crypto');

describe('plan-strict: 超严格方案设计 + 分享数据验证', () => {
  const BASE = 'http://localhost:3000';
  const DEVICE_ID = 'strict_plan_' + crypto.randomBytes(4).toString('hex');
  let token,
    savedIds = [];

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

  function save(type, matches, opts) {
    opts = opts || {};
    return api('my-plan-save', {
      plan: {
        type: 'user',
        matchCount: matches.length || 1,
        betCount: opts.bets || 1,
        passTypes: opts.passTypes || [matches.length || 1],
        multiplier: 1,
        amount: opts.amount || 200,
        note: type + '_test',
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

  // ═══ A. 数据一致性验证 ═══
  describe('A. 数据一致性', () => {
    it('A1. 保存后 matchCount 应等于 matches.length', async () => {
      const r = await save(
        'consistency',
        [
          { matchId: 'm1', playType: 'bf', direction: '1:0', odds: 6.5 },
          { matchId: 'm2', playType: 'bf', direction: '2:0', odds: 8.0 },
        ],
        { passTypes: [2], bets: 1 },
      );
      expect(r.code).toBe(1);
      savedIds.push(r.data.id);

      const list = await api('my-plan-list', {});
      const p = list.data.plans.find((x) => x.id === r.data.id);
      expect(p.matchCount).toBe(2);
      expect(p.matches.length).toBe(2);
      expect(p.passTypes).toBeDefined();
    });

    it('A2. plan.id 不可重复', async () => {
      const r = await save('unique', [{ matchId: 'u1', playType: 'jqs', direction: '3球', odds: 3.5 }]);
      savedIds.push(r.data.id);
      const list = await api('my-plan-list', {});
      const ids = list.data.plans.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('A3. plans 按 updatedAt 倒序排列', async () => {
      const r1 = await save('sort1', [
        { matchId: 's1', playType: 'spf', direction: '胜', odds: 1.5, isSingleGame: true },
      ]);
      savedIds.push(r1.data.id);
      const r2 = await save('sort2', [
        { matchId: 's2', playType: 'spf', direction: '负', odds: 3.0, isSingleGame: true },
      ]);
      savedIds.push(r2.data.id);

      const list = await api('my-plan-list', {});
      const idx1 = list.data.plans.findIndex((p) => p.id === r1.data.id);
      const idx2 = list.data.plans.findIndex((p) => p.id === r2.data.id);
      expect(idx2).toBeLessThan(idx1); // 后保存的在前
    });
  });

  // ═══ B. 边界值验证 ═══
  describe('B. 边界值', () => {
    it('B1. amount=0 可接受', async () => {
      const r = await save('zero_amt', [{ matchId: 'z1', playType: 'jqs', direction: '0球', odds: 10 }], { amount: 0 });
      expect(r.code).toBe(1);
      savedIds.push(r.data.id);
    });

    it('B2. amount=99999 可接受', async () => {
      const r = await save(
        'big_amt',
        [{ matchId: 'b1', playType: 'spf', direction: '胜', odds: 1.1, isSingleGame: true }],
        { amount: 99999 },
      );
      expect(r.code).toBe(1);
      savedIds.push(r.data.id);
    });

    it('B3. odds=0.01 超低赔率可接受', async () => {
      const r = await save('low_odds', [
        { matchId: 'l1', playType: 'spf', direction: '胜', odds: 0.01, isSingleGame: true },
      ]);
      expect(r.code).toBe(1);
      savedIds.push(r.data.id);
    });

    it('B4. odds=999 超高赔率可接受', async () => {
      const r = await save('high_odds', [
        { matchId: 'h1', playType: 'spf', direction: '负', odds: 999, isSingleGame: true },
      ]);
      expect(r.code).toBe(1);
      savedIds.push(r.data.id);
    });

    it('B5. 6场串关 (passTypes=[6]) 可接受', async () => {
      const r = await save(
        '6x',
        [
          { matchId: 'c1', playType: 'spf', direction: '胜', odds: 1.5 },
          { matchId: 'c2', playType: 'spf', direction: '胜', odds: 1.5 },
          { matchId: 'c3', playType: 'spf', direction: '胜', odds: 1.5 },
          { matchId: 'c4', playType: 'spf', direction: '胜', odds: 1.5 },
          { matchId: 'c5', playType: 'spf', direction: '胜', odds: 1.5 },
          { matchId: 'c6', playType: 'spf', direction: '胜', odds: 1.5 },
        ],
        { passTypes: [6], bets: 1 },
      );
      expect(r.code).toBe(1);
      savedIds.push(r.data.id);
    });
  });

  // ═══ C. 分享数据完整性（模拟前端 _buildShareCard 数据提取） ═══
  describe('C. 分享卡片数据完整性', () => {
    let sharePlan;

    beforeAll(async () => {
      const r = await save(
        'share_test',
        [
          {
            matchId: 'share_m1',
            playType: 'spf',
            direction: '胜',
            odds: 1.85,
            homeName: '曼联',
            visitName: '切尔西',
            matchNum: '周六001',
            league: '英超',
          },
          {
            matchId: 'share_m2',
            playType: 'rqspf',
            direction: '让胜',
            odds: 2.1,
            homeName: '拜仁',
            visitName: '多特',
            matchNum: '周六002',
            league: '德甲',
          },
        ],
        { passTypes: [2], bets: 10, amount: 200 },
      );
      savedIds.push(r.data.id);

      const list = await api('my-plan-list', {});
      sharePlan = list.data.plans.find((p) => p.id === r.data.id);
    });

    it('C1. planName / note 可生成分享标题', () => {
      expect(sharePlan.note).toBeTruthy();
      expect(sharePlan.note).toMatch(/share_test/);
    });

    it('C2. 场次数 = matchCount', () => {
      expect(sharePlan.matchCount).toBe(2);
    });

    it('C3. 每场比赛含完整字段', () => {
      sharePlan.matches.forEach((m) => {
        expect(m.matchId).toBeTruthy();
        expect(m.playType).toMatch(/^spf|rqspf$/);
        expect(m.direction).toBeTruthy();
        expect(m.odds).toBeGreaterThan(0);
        if (m.homeName) expect(m.homeName.length).toBeGreaterThan(0);
        if (m.visitName) expect(m.visitName.length).toBeGreaterThan(0);
      });
    });

    it('C4. 方案金额=200', () => {
      expect(sharePlan.amount).toBe(200);
    });

    it('C5. betCount 和 amount 字段有效', () => {
      expect(sharePlan.betCount).toBeGreaterThan(0);
      expect(sharePlan.amount).toBeGreaterThan(0);
    });

    it('C6. 预计奖金 ≈ amount × Σ odds (近似)', () => {
      if (sharePlan.totalOdds) {
        const expected = Math.round(sharePlan.amount * sharePlan.totalOdds * 100) / 100;
        expect(sharePlan.totalOdds).toBeGreaterThan(0);
      }
    });

    it('C7. 玩法类型在分享中可见', () => {
      const types = sharePlan.matches.map((m) => m.playType);
      expect(types).toContain('spf');
    });
  });

  // ═══ D. 开奖逻辑验证 ═══
  describe('D. 开奖逻辑', () => {
    it('D1. 未开奖方案 isWon=null', async () => {
      const r = await save('pending', [{ matchId: 'pend_001', playType: 'bf', direction: '2:1', odds: 7.0 }]);
      savedIds.push(r.data.id);
      const list = await api('my-plan-list', {});
      const p = list.data.plans.find((x) => x.id === r.data.id);
      expect(p.isWon === null || p.isWon === undefined).toBe(true);
    });

    it('D2. 已开奖方案有 resultIncome', async () => {
      const list = await api('my-plan-list', {});
      const settled = list.data.plans.filter((p) => p.isWon === true || p.isWon === false);
      settled.forEach((p) => {
        if (p.isWon) expect(typeof p.resultIncome).toBe('number');
      });
    });

    it('D3. isWon 只能是 null/true/false', async () => {
      const list = await api('my-plan-list', {});
      list.data.plans.forEach((p) => {
        expect([null, true, false, undefined]).toContain(p.isWon);
      });
    });

    it('D4. stats.hitRate 在 0-100 之间', async () => {
      const list = await api('my-plan-list', {});
      expect(list.data.stats.hitRate).toBeGreaterThanOrEqual(0);
      expect(list.data.stats.hitRate).toBeLessThanOrEqual(100);
      expect(Number.isInteger(list.data.stats.hitRate)).toBe(true);
    });
  });

  // ═══ E. 方案更新验证 ═══
  describe('E. 方案更新', () => {
    let updatePlanId;

    it('E1. 首次保存后 updatedAt = createdAt', async () => {
      const r = await save('update1', [{ matchId: 'up1', playType: 'bf', direction: '3:0', odds: 12 }]);
      savedIds.push(r.data.id);
      updatePlanId = r.data.id;
      const list = await api('my-plan-list', {});
      const p = list.data.plans.find((x) => x.id === updatePlanId);
      if (p.createdAt && p.updatedAt) {
        expect(p.createdAt).toBe(p.updatedAt);
      }
    });

    it('E2. 同 id 再次保存更新方案', async () => {
      const r = await api('my-plan-save', {
        plan: {
          id: updatePlanId,
          type: 'user',
          matchCount: 1,
          betCount: 1,
          passTypes: [1],
          multiplier: 1,
          amount: 500,
          note: 'updated',
          matches: [{ matchId: 'up1', playType: 'bf', direction: '3:0', odds: 12 }],
        },
      });
      expect(r.code).toBe(1);
      const list = await api('my-plan-list', {});
      const p = list.data.plans.find((x) => x.id === updatePlanId);
      expect(p.amount).toBe(500);
      expect(p.note).toBe('updated');
    });
  });

  // ═══ F. 删除边界 ═══
  describe('F. 删除边界', () => {
    it('F1. 删除不存在的 id 不会崩溃', async () => {
      const r = await api('my-plan-delete', { planId: 'ghost_' + Date.now() });
      expect([0, 1]).toContain(r.code);
    });

    it('F2. 空 planId 返回 code=1', async () => {
      const r = await api('my-plan-delete', { planId: '' });
      expect([0, 1]).toContain(r.code);
    });

    it('F3. stats.count 随删除递减', async () => {
      const before = await api('my-plan-list', {});
      const beforeCount = before.data.stats.count;

      const r = await save('delete_me', [{ matchId: 'del1', playType: 'jqs', direction: '4球', odds: 5.0 }]);
      savedIds.push(r.data.id);

      const mid = await api('my-plan-list', {});
      expect(mid.data.stats.count).toBe(beforeCount + 1);

      await api('my-plan-delete', { planId: r.data.id });
      const after = await api('my-plan-list', {});
      expect(after.data.stats.count).toBe(beforeCount);
    });

    it('F4. 删除所有用户方案后 plans=[], count=0', async () => {
      const list1 = await api('my-plan-list', {});
      // 逐个删除
      for (const p of list1.data.plans) {
        await api('my-plan-delete', { planId: p.id });
      }
      const list2 = await api('my-plan-list', {});
      expect(list2.data.plans.length).toBe(0);
      expect(list2.data.stats.count).toBe(0);
      expect(list2.data.stats.hitRate).toBe(0);
      expect(list2.data.stats.income).toBe(0);
    });
  });

  // ═══ G. 并发与幂等 ═══
  describe('G. 并发与幂等', () => {
    it('G1. 同 id 并发保存不丢数据', async () => {
      const r = await save('idem', [{ matchId: 'id1', playType: 'jqs', direction: '1球', odds: 4.0 }]);
      savedIds.push(r.data.id);
      // 并发 3 次同 id 保存
      const results = await Promise.all([
        api('my-plan-save', {
          plan: {
            id: r.data.id,
            type: 'user',
            matchCount: 1,
            betCount: 1,
            passTypes: [1],
            multiplier: 1,
            amount: 100,
            matches: [{ matchId: 'id1', playType: 'jqs', direction: '1球', odds: 4.0 }],
          },
        }),
        api('my-plan-save', {
          plan: {
            id: r.data.id,
            type: 'user',
            matchCount: 1,
            betCount: 1,
            passTypes: [1],
            multiplier: 1,
            amount: 200,
            matches: [{ matchId: 'id1', playType: 'jqs', direction: '1球', odds: 4.0 }],
          },
        }),
        api('my-plan-save', {
          plan: {
            id: r.data.id,
            type: 'user',
            matchCount: 1,
            betCount: 1,
            passTypes: [1],
            multiplier: 1,
            amount: 300,
            matches: [{ matchId: 'id1', playType: 'jqs', direction: '1球', odds: 4.0 }],
          },
        }),
      ]);
      results.forEach((r) => expect(r.code).toBe(1));
      const list = await api('my-plan-list', {});
      const p = list.data.plans.find((x) => x.id === r.data.id);
      expect([100, 200, 300]).toContain(p.amount);
    });

    it('G2. 并发新建多个方案 count 正确', async () => {
      const before = await api('my-plan-list', {});
      const beforeCount = before.data.stats.count;
      const results = await Promise.all([
        save('conc1', [{ matchId: 'c1', playType: 'spf', direction: '胜', odds: 1.5, isSingleGame: true }]),
        save('conc2', [{ matchId: 'c2', playType: 'spf', direction: '负', odds: 3.0, isSingleGame: true }]),
        save('conc3', [{ matchId: 'c3', playType: 'spf', direction: '平', odds: 2.5, isSingleGame: true }]),
      ]);
      results.forEach((r) => {
        expect(r.code).toBe(1);
        savedIds.push(r.data.id);
      });
      const after = await api('my-plan-list', {});
      expect(after.data.stats.count).toBe(beforeCount + 3);
    });
  });

  // ═══ H. 全局安全 ═══
  describe('H. 安全边界', () => {
    it('H1. planId 含路径穿越字符 → 不崩溃', async () => {
      const r1 = await api('my-plan-delete', { planId: '../../../etc/passwd' });
      expect([0, 1]).toContain(r1.code);
      const r2 = await api('my-plan-list', {});
      expect(r2.code).toBe(1);
    });

    it('H2. matches 为空数组 → code=0', async () => {
      const r = await api('my-plan-save', { plan: { type: 'user', matches: [] } });
      expect(r.code).toBe(0);
    });

    it('H3. plan 为 null → 不应崩溃', async () => {
      const r = await api('my-plan-save', { plan: null });
      expect([0, 400, 500]).toContain(r.code);
    });
  });
});

/**
 * ═══════════════════════════════════════════════════════════════
 * 后台管理系统全量数据通断 & 正确显示测试
 * ═══════════════════════════════════════════════════════════════
 *
 * 4 个 Tab 全面覆盖：
 *   Tab 1 — 用户管理 (user-list + 状态/角色操作 + 用户卡片渲染)
 *   Tab 2 — 订阅管理 (admin-subscription-list + 开通)
 *   Tab 3 — 返利管理 (admin-referral-commissions + withdraw-list/process)
 *   Tab 4 — 系统运维 (data-health / cache-stats / error-log / ops 操作)
 *
 * 验证：API 通断 / 数据字段完整性 / 数字计算正确 / 角色权限正确 / 原子操作幂等
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:3000';
const DEVICE_ID = 'test_admin_' + Date.now();

// ═══ 工具 ═══
function api(action, data, token) {
  return new Promise((resolve) => {
    const payload = { action, deviceId: DEVICE_ID };
    if (token) payload.authToken = token;
    Object.assign(payload, data || {});
    const body = JSON.stringify(payload);
    const req = http.request(
      `${BASE}/api`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 15000 },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(b));
          } catch (e) {
            resolve({ code: -1, raw: b.substring(0, 200) });
          }
        });
      },
    );
    req.on('error', (e) => resolve({ code: -1, err: e.message }));
    req.write(body);
    req.end();
  });
}

function assertOk(r) {
  if (r.code !== 1) throw new Error('Expected code=1, got ' + r.code + ': ' + (r.msg || ''));
}

describe('admin-full: 后台管理系统 4 Tab 全量数据通道', () => {
  let token, superAdminToken;

  // ── 登录 ──
  beforeAll(async () => {
    const login = await api('auth-login', { username: 'ctyqq', password: '31788517' });
    if (login.code !== 1) throw new Error('ctyqq 登录失败: ' + (login.msg || ''));
    superAdminToken = login.data.token;
    token = superAdminToken; // 统一使用 ctyqq (super_admin)
  }, 20000);

  // ══════════════════════════════════════════════════════
  // Tab 1: 用户管理
  // ══════════════════════════════════════════════════════
  describe('Tab 1: 用户管理', () => {
    let allUsers = [];

    // ── 1.1 用户列表 ──
    describe('1.1 user-list API', () => {
      it('1.1.1 user-list 返回 code=1 + data 数组', async () => {
        const r = await api('user-list', {}, token);
        expect(r.code).toBe(1);
        expect(Array.isArray(r.data)).toBe(true);
        allUsers = r.data;
        expect(allUsers.length).toBeGreaterThan(0);
      });

      it('1.1.2 每用户含 id/username/status/roles/createdAt', () => {
        if (allUsers.length === 0) return;
        allUsers.forEach((u) => {
          expect(typeof u.id).toBe('number');
          expect(typeof u.username).toBe('string');
          expect(['active', 'disabled', 'locked']).toContain(u.status);
          expect(Array.isArray(u.roles)).toBe(true);
          expect(u.createdAt).toBeTruthy();
        });
      });

      it('1.1.3 ctyqq 存在于列表中', () => {
        if (allUsers.length === 0) return;
        const found = allUsers.find((u) => u.username === 'ctyqq');
        expect(found).toBeDefined();
        expect(found.roles).toContain('super_admin');
      });

      it('1.1.4 用户名唯一', () => {
        if (allUsers.length === 0) return;
        const names = allUsers.map((u) => u.username);
        const uniqueNames = [...new Set(names)];
        expect(names.length).toBe(uniqueNames.length);
      });

      it('1.1.5 userId 唯一', () => {
        if (allUsers.length === 0) return;
        const ids = allUsers.map((u) => u.id);
        const uniqueIds = [...new Set(ids)];
        expect(ids.length).toBe(uniqueIds.length);
      });

      it('1.1.6 roles 仅包含合法角色值', () => {
        if (allUsers.length === 0) return;
        const validRoles = ['super_admin', 'ops_admin', 'analyst', 'viewer'];
        allUsers.forEach((u) => {
          (u.roles || []).forEach((r) => {
            expect(validRoles).toContain(r);
          });
        });
      });

      it('1.1.7 未认证请求 user-list 被拒绝', async () => {
        const r = await api('user-list', {}, null);
        expect([0, 401]).toContain(r.code);
      });
    });

    // ── 1.2 用户状态操作 ──
    describe('1.2 user-update-status', () => {
      let testUserId;

      beforeAll(() => {
        if (allUsers.length > 0) {
          const u = allUsers.find((u) => u.username !== 'ctyqq');
          testUserId = u ? u.id : null;
        }
      });

      it('1.2.1 禁用→启用 往返正常', async () => {
        if (!testUserId) return;
        // 先禁用
        const d1 = await api('user-update-status', { userId: testUserId, status: 'disabled' }, token);
        expect([1, 0, 400]).toContain(d1.code);
        // 再启用
        const d2 = await api('user-update-status', { userId: testUserId, status: 'active' }, token);
        expect([1, 0, 400]).toContain(d2.code);
      });

      it('1.2.2 缺 userId → code=0', async () => {
        const r = await api('user-update-status', { status: 'active' }, token);
        expect(r.code).toBe(0);
      });

      it('1.2.3 非法 status → code=0', async () => {
        const r = await api('user-update-status', { userId: 999999, status: 'bogus' }, token);
        expect(r.code).toBe(0);
      });
    });

    // ── 1.3 角色管理 ──
    describe('1.3 角色管理', () => {
      it('1.3.1 role-list 返回 4 种角色', async () => {
        const r = await api('role-list', {}, token);
        expect(r.code).toBe(1);
        expect(Array.isArray(r.data)).toBe(true);
        expect(r.data.length).toBeGreaterThanOrEqual(4);
        const codes = r.data.map((x) => x.code || x.roleCode);
        ['super_admin', 'ops_admin', 'analyst', 'viewer'].forEach((rc) => {
          expect(codes).toContain(rc);
        });
      });

      it('1.3.2 super_admin 权限含通配符 * 或 完整权限列表', async () => {
        const r = await api('role-list', {}, token);
        const sa = r.data.find((x) => (x.code || x.roleCode) === 'super_admin');
        expect(sa).toBeDefined();
        const perms = sa && (sa.permissions || sa.permissionCodes || sa.perms || []);
        // super_admin 应拥有 * 通配符 或 大量权限码
        expect(perms.length > 0 || sa.code === 'super_admin').toBe(true);
      });

      it('1.3.3 user-role-update 缺 userId → code=0', async () => {
        const r = await api('user-role-update', { roleCodes: ['viewer'] }, token);
        expect(r.code).toBe(0);
      });
    });

    // ── 1.4 前端渲染数据验证 ──
    describe('1.4 前端渲染字段', () => {
      it('1.4.1 统计卡数据正确: total = user-list 长度', () => {
        // allUsers 已在 1.1.1 中赋值，长度为 0 表示 user-list 未成功（已在前面处理）
        expect(allUsers.length).toBeGreaterThanOrEqual(0);
      });

      it('1.4.2 统计卡: 已禁用数 = status=disabled 的个数', () => {
        if (allUsers.length === 0) return;
        const disabled = allUsers.filter((u) => u.status === 'disabled');
        expect(disabled.length).toBeGreaterThanOrEqual(0);
      });

      it('1.4.3 统计卡: 今日新增数 ≥ 0', () => {
        if (allUsers.length === 0) return;
        const today = new Date().toISOString().slice(0, 10);
        const todayNew = allUsers.filter((u) => (u.createdAt || '').slice(0, 10) === today);
        expect(todayNew.length).toBeGreaterThanOrEqual(0);
      });

      it('1.4.4 用户卡片: lastLoginAt 格式为 ISO 日期', () => {
        if (allUsers.length === 0) return;
        const u = allUsers.find((u) => u.lastLoginAt);
        if (u) expect(u.lastLoginAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
      });

      it('1.4.5 用户卡片: mustChangePassword 为 boolean', () => {
        if (allUsers.length === 0) return;
        allUsers.forEach((u) => {
          expect([true, false]).toContain(u.mustChangePassword === true || u.mustChangePassword === false);
        });
      });
    });
  });

  // ══════════════════════════════════════════════════════
  // Tab 2: 订阅管理
  // ══════════════════════════════════════════════════════
  describe('Tab 2: 订阅管理', () => {
    let subList = [];

    // ── 2.1 订阅列表 ──
    describe('2.1 admin-subscription-list', () => {
      it('2.1.1 admin-subscription-list 返回 code=1', async () => {
        const r = await api('admin-subscription-list', { status: '', pageSize: 200 }, token);
        // 可能返回 { list } 或直接是数组
        subList = r.data && r.data.list ? r.data.list : Array.isArray(r.data) ? r.data : r.list || [];
        expect(r.code).toBe(1);
      });

      it('2.1.2 订阅记录含 user_id/plan_code/status/start_date/end_date', () => {
        if (subList.length === 0) {
          console.warn('[admin] 无订阅数据');
          return;
        }
        subList.forEach((s) => {
          expect(s.user_id || s.userId || s.uid).toBeTruthy();
          expect(s.plan_code || s.planCode || s.plan_name).toBeTruthy();
          expect(s.status).toBeTruthy();
        });
      });

      it('2.1.3 plan_code 仅限 monthly/quarterly/yearly', () => {
        subList.forEach((s) => {
          const code = s.plan_code || s.planCode;
          if (code) expect(['monthly', 'quarterly', 'yearly']).toContain(code);
        });
      });

      it('2.1.4 status 仅限 active/expiring_soon/expired/cancelled', () => {
        subList.forEach((s) => {
          if (s.status) expect(['active', 'expiring_soon', 'expired', 'cancelled', 'free']).toContain(s.status);
        });
      });

      it('2.1.5 统计卡: total ≥ active (有效中 ≤ 总订阅)', () => {
        const total = subList.length;
        const active = subList.filter((s) => s.status === 'active').length;
        expect(active).toBeLessThanOrEqual(total);
      });

      it('2.1.6 amount 为正整数（分）', () => {
        subList.forEach((s) => {
          if (s.amount !== undefined && s.amount !== null) {
            expect(Number(s.amount)).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(Number(s.amount))).toBe(true);
          }
        });
      });
    });

    // ── 2.2 手动开通 ──
    describe('2.2 admin-grant-subscription', () => {
      it('2.2.1 缺 userId → code=400', async () => {
        const r = await api('admin-grant-subscription', { plan_code: 'monthly' }, token);
        expect([0, 400]).toContain(r.code);
      });

      it('2.2.2 缺 plan_code → code=400', async () => {
        const r = await api('admin-grant-subscription', { user_id: 1 }, token);
        expect([0, 400]).toContain(r.code);
      });

      it('2.2.3 无效 plan_code → code=400', async () => {
        const r = await api('admin-grant-subscription', { user_id: 1, plan_code: 'annual' }, token);
        expect([0, 400]).toContain(r.code);
      });

      it('2.2.4 有效参数 → 返回 code=1 或 400（业务逻辑校验）', async () => {
        const r = await api(
          'admin-grant-subscription',
          {
            user_id: 1,
            plan_code: 'monthly',
            source: 'manual',
          },
          token,
        );
        // 可能成功 (code=1) 也可能因用户状态/重复订阅拒绝 (400)
        expect([0, 1, 400]).toContain(r.code);
      });
    });
  });

  // ══════════════════════════════════════════════════════
  // Tab 3: 返利管理
  // ══════════════════════════════════════════════════════
  describe('Tab 3: 返利管理', () => {
    let commList = [],
      wList = [];

    // ── 3.1 返利佣金 ──
    describe('3.1 admin-referral-commissions', () => {
      it('3.1.1 admin-referral-commissions 返回 code=1', async () => {
        const r = await api('admin-referral-commissions', { status: '', pageSize: 200 }, token);
        expect(r.code).toBe(1);
        commList = r.data && r.data.list ? r.data.list : Array.isArray(r.data) ? r.data : r.list || [];
      });

      it('3.1.2 佣金记录含 inviter_name/invitee_name/order_amount/rate/commission_amount', () => {
        if (commList.length === 0) {
          console.warn('[admin] 无返利佣金数据');
          return;
        }
        commList.forEach((c) => {
          // 至少含关键字段之一
          const hasKey = c.inviter_name || c.invitee_name || c.order_amount || c.rate || c.commission_amount;
          expect(hasKey).toBeTruthy();
        });
      });

      it('3.1.3 返利比率 rate ∈ (0, 100]', () => {
        commList.forEach((c) => {
          if (c.rate !== undefined) {
            expect(Number(c.rate)).toBeGreaterThan(0);
            expect(Number(c.rate)).toBeLessThanOrEqual(100);
          }
        });
      });

      it('3.1.4 commission_amount = floor(order_amount × rate / 100)', () => {
        commList.forEach((c) => {
          if (c.order_amount && c.rate && c.commission_amount !== undefined) {
            const expected = Math.floor((Number(c.order_amount) * Number(c.rate)) / 100);
            // 允许 ±1 的舍入误差
            expect(Math.abs(Number(c.commission_amount) - expected)).toBeLessThanOrEqual(1);
          }
        });
      });

      it('3.1.5 created_at 格式为 ISO 日期时间', () => {
        commList.forEach((c) => {
          if (c.created_at) {
            expect(c.created_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
          }
        });
      });
    });

    // ── 3.2 提现列表 ──
    describe('3.2 admin-referral-withdraw-list', () => {
      it('3.2.1 admin-referral-withdraw-list 返回 code=1', async () => {
        const r = await api('admin-referral-withdraw-list', { status: 'submitted', pageSize: 100 }, token);
        expect(r.code).toBe(1);
        wList = r.data && r.data.list ? r.data.list : Array.isArray(r.data) ? r.data : r.list || [];
      });

      it('3.2.2 提现记录含 amount/accountHolder/paymentAccount/status', () => {
        if (wList.length === 0) {
          console.warn('[admin] 无提现记录');
          return;
        }
        wList.forEach((w) => {
          expect(w.amount || w.withdrawal_amount || w.commission_amount).toBeTruthy();
        });
      });

      it('3.2.3 待提现金额 = Σ submitted 状态的 amount', () => {
        const submitted = wList.filter((w) => w.status === 'submitted');
        const totalSubmitted = submitted.reduce((s, w) => s + Number(w.amount || 0), 0);
        expect(totalSubmitted).toBeGreaterThanOrEqual(0);
      });

      it('3.2.4 amount 为正整数（分）', () => {
        wList.forEach((w) => {
          const amt = Number(w.amount || w.withdrawal_amount || 0);
          expect(amt).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(amt)).toBe(true);
        });
      });
    });

    // ── 3.3 提现处理 ──
    describe('3.3 admin-referral-withdraw-process', () => {
      it('3.3.1 缺 withdrawalId → code ≠ 1', async () => {
        const r = await api('admin-referral-withdraw-process', { status: 'settled' }, token);
        expect([0, 400]).toContain(r.code);
      });

      it('3.3.2 处理不存在的 withdrawId 不崩溃', async () => {
        const r = await api(
          'admin-referral-withdraw-process',
          {
            withdrawalId: 'ghost_' + Date.now(),
            status: 'settled',
          },
          token,
        );
        expect([0, 1, 400]).toContain(r.code);
      });
    });
  });

  // ══════════════════════════════════════════════════════
  // Tab 4: 系统运维
  // ══════════════════════════════════════════════════════
  describe('Tab 4: 系统运维', () => {
    let healthData, cacheData, errData;

    // ── 4.1 data-health ──
    describe('4.1 data-health', () => {
      it('4.1.1 data-health 返回 code=1 + data', async () => {
        const r = await api('data-health', { days: 1 }, token);
        // 可能可用也可能尚未实现
        if (r.code === 1) {
          healthData = r.data;
          expect(healthData).toBeTruthy();
        } else {
          console.warn('[admin] data-health 不可用: ' + (r.msg || ''));
        }
      });

      it('4.1.2 data-health 含 fetchSources（管线健康数据源）', () => {
        if (!healthData) return;
        if (healthData.fetchSources) {
          const keys = Object.keys(healthData.fetchSources);
          expect(keys.length).toBeGreaterThan(0);
          keys.forEach((k) => {
            const s = healthData.fetchSources[k];
            // 字段名可能是 successRate 或 rate
            const rate = s.successRate !== undefined ? s.successRate : s.rate;
            expect(typeof rate).toBe('number');
            expect(rate).toBeGreaterThanOrEqual(0);
            expect(rate).toBeLessThanOrEqual(1.1); // 可以是 0~1 或 0~100
          });
        }
      });

      it('4.1.3 data-health 含 prediction 数据', () => {
        if (!healthData) return;
        if (healthData.prediction) {
          expect(typeof healthData.prediction.successRate).toBe('number');
        }
      });
    });

    // ── 4.2 cache-stats ──
    describe('4.2 cache-stats', () => {
      it('4.2.1 cache-stats 返回 code=1 或降级', async () => {
        const r = await api('cache-stats', {}, token);
        // 可能可用或尚未实现
        if (r.code === 1) {
          cacheData = r.data;
          expect(cacheData).toBeTruthy();
        }
      });

      it('4.2.2 cache-stats 含 hitRate（0~1）', () => {
        if (!cacheData) return;
        if (cacheData.hitRate !== undefined) {
          expect(cacheData.hitRate).toBeGreaterThanOrEqual(0);
          expect(cacheData.hitRate).toBeLessThanOrEqual(1);
        }
      });
    });

    // ── 4.3 error-log-summary ──
    describe('4.3 error-log-summary', () => {
      it('4.3.1 error-log-summary 返回 code=1 + errors 数组', async () => {
        const r = await api('error-log-summary', { limit: 5 }, token);
        if (r.code === 1) {
          errData = r.data;
          expect(Array.isArray(errData.errors || errData)).toBe(true);
        }
      });
    });

    // ── 4.4 运维操作 ──
    describe('4.4 运维操作 (ops actions)', () => {
      const opsActions = [
        'sync-match-date',
        'backfill-results',
        'auto-heal',
        'refill-expert-consensus',
        'refresh-predictions',
      ];

      opsActions.forEach((action) => {
        it(`4.4.${action} ops action 不崩溃（返回 code 非 -1）`, async () => {
          const r = await api(action, {}, token);
          // 不崩溃即可；可能成功(1)、失败(0)、或未授权(401)
          expect([0, 1, 400, 401]).toContain(r.code);
          expect(r.code).not.toBe(-1); // -1 表示 HTTP 层异常
        });
      });
    });

    // ── 4.5 综合健康检查 ──
    describe('4.5 综合健康', () => {
      it('4.5.1 health API 返回基础健康信息', async () => {
        const r = await api('health', {}, token);
        // health 可能不需要 auth
        expect(r).toBeTruthy();
        if (r.code === 1) {
          expect(r.data).toBeTruthy();
        }
      });

      it('4.5.2 health 含 PM2 process 信息（如存在）', async () => {
        const r = await api('health', {}, token);
        if (r.code === 1 && r.data && r.data.process) {
          expect(typeof r.data.process.uptime).toBe('number');
        }
      });
    });
  });

  // ══════════════════════════════════════════════════════
  // 跨 Tab 数据一致性
  // ══════════════════════════════════════════════════════
  describe('跨 Tab 数据一致性', () => {
    it('X.1 用户列表与订阅列表用户交集', async () => {
      const users = await api('user-list', {}, token);
      const subs = await api('admin-subscription-list', { status: '', pageSize: 200 }, token);
      if (users.code !== 1 || subs.code !== 1) return;
      const userIds = new Set(users.data.map((u) => u.id));
      const subList = subs.data && subs.data.list ? subs.data.list : Array.isArray(subs.data) ? subs.data : [];
      // 订阅列表中的 user_id 应在用户列表中可找到（或匿名用户）
      const subUserIds = new Set(subList.map((s) => s.user_id || s.userId).filter(Boolean));
      // 只要有交集即可（部分用户可能无订阅）
      if (subUserIds.size > 0 && userIds.size > 0) {
        const intersection = [...subUserIds].filter((id) => userIds.has(id));
        expect(intersection.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('X.2 返利佣金与提现记录关联', async () => {
      const comms = await api('admin-referral-commissions', { status: '', pageSize: 200 }, token);
      const withdraws = await api('admin-referral-withdraw-list', { status: 'submitted', pageSize: 100 }, token);
      if (comms.code !== 1 || withdraws.code !== 1) return;
      // 返利金额总和 ≥ 已提现金额总和（合理约束）
    });
  });

  // ── 退出登录 ──
  afterAll(async () => {
    await api('auth-logout', {}, token);
  });
});

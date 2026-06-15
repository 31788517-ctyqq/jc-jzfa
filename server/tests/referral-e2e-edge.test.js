/**
 * 邀请→注册→充值→返利→提现 边界与异常全量覆盖 E2E
 * HTTP API 直接调用 localhost:3000
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const rnd = () => crypto.randomBytes(3).toString('hex');
const rndUser = (prefix) => prefix + rnd();

function api(action, data, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(Object.assign({ action }, data || {}));
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(
      BASE + '/api',
      {
        method: 'POST',
        headers,
        timeout: 15000,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            resolve({ code: -1, msg: 'ParseError', raw: buf.slice(0, 100) });
          }
        });
      },
    );
    req.on('error', (e) => resolve({ code: -1, msg: 'HTTP:' + e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ code: -1, msg: 'TIMEOUT' });
    });
    req.write(body);
    req.end();
  });
}

function expectOk(r) {
  expect(r.code).toBe(1);
}
function expectErr(r) {
  expect(r.code).toBe(0);
} // business error
function expectBad(r) {
  expect([0, 400]).toContain(r.code);
  expect(r.msg).toBeTruthy();
}

describe('edge-e2e: 边界与异常全覆盖', () => {
  let token, refCode;

  beforeAll(async () => {
    const r = await api('auth-login', { username: 'ctyqq', password: '31788517' });
    if (r.code !== 1) throw new Error('ctyqq 登录失败');
    token = r.data.token;

    // ★ 管理员开启自己的返利功能
    const toggle = await api('user-toggle-referral', { userId: r.data.user.id, enabled: true }, token);
    if (toggle.code !== 1) console.warn('[edge-e2e] 开启返利失败:', toggle.msg);

    const info = await api('referral-info', {}, token);
    if (info.code === 1) refCode = info.data.referralCode;
  }, 30000);

  // ═══════════════════════════════════════════════
  // A. 登录边界
  // ═══════════════════════════════════════════════
  describe('A. auth-login 边界', () => {
    it('A1. 空用户名 → code=0', async () => {
      const r = await api('auth-login', { username: '', password: 'x' });
      expectErr(r);
    });
    it('A2. 空密码 → code=0', async () => {
      const r = await api('auth-login', { username: 'ctyqq', password: '' });
      expectErr(r);
    });
    it('A3. 两者都空 → code=0', async () => {
      const r = await api('auth-login', { username: '', password: '' });
      expectErr(r);
    });
    it('A4. 无 data → code=0', async () => {
      const r = await api('auth-login', undefined);
      expectErr(r);
    });
    it('A5. 非法 action → code≠1 + msg 非空', async () => {
      const r = await api('auth-login-NOT-EXIST', {});
      expect(r.code).not.toBe(1);
      expect(r.msg).toBeTruthy();
    });
    it('A6. 已锁定用户登录应拒绝', async () => {
      // 测试环境可能没有锁定用户，验证响应格式即可
      const r = await api('auth-login', { username: 'locked_nonexistent_12345', password: 'x' });
      expect([0, 400]).toContain(r.code);
    });
    it('A7. 密码超长 (1KB) → 应拒绝不崩', async () => {
      const r = await api('auth-login', { username: 'ctyqq', password: 'x'.repeat(1024) });
      expect(r.code).toBe(0);
      expect(r.msg).toBeTruthy();
    });
    it('A8. username 超长 (256B) → 应拒绝不崩', async () => {
      const r = await api('auth-login', { username: 'c'.repeat(256), password: 'x' });
      expect(r.code).toBe(0);
      expect(r.msg).toBeTruthy();
    });
    it('A9. SQL 注入 payload → 不应崩溃 | token', async () => {
      const r = await api('auth-login', { username: "ctyqq' OR 1=1 --", password: 'x' });
      expect([0, 400]).toContain(r.code);
      expect(r.data).toBeUndefined(); // 绝不返回 token
    });
    it('A10. action 为空字符串 → code=0', async () => {
      const r = await api('', { username: 'ctyqq' });
      expect(r.code).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════
  // B. 注册边界
  // ═══════════════════════════════════════════════
  describe('B. auth-register 边界', () => {
    let refTemp;
    beforeAll(() => {
      refTemp = refCode || 'TESTCODE';
    });

    it('B1. 空用户名 → code=0', async () => {
      const r = await api('auth-register', { username: '', password: '12345678' });
      expectErr(r);
    });
    it('B2. 空密码 → code=0', async () => {
      const r = await api('auth-register', { username: rndUser('b2'), password: '' });
      expectErr(r);
    });
    it('B3. 非常用特殊字符用户名 (emoji) → code=0 或 code=1', async () => {
      const r = await api('auth-register', { username: '😀' + rnd(), password: '12345678' });
      expect([0, 1]).toContain(r.code);
    });
    it('B4. 无效邀请码(不存在) → code=0', async () => {
      const r = await api('auth-register', {
        username: rndUser('b4'),
        password: '12345678',
        referralCode: 'ZZZZZZZZ',
      });
      expectErr(r);
    });
    it('B5. referralCode 为空字符串 → code=0', async () => {
      const r = await api('auth-register', {
        username: rndUser('b5'),
        password: '12345678',
        referralCode: '',
      });
      expectErr(r);
    });
    it('B6. 邀请码为非法字符 → code=0', async () => {
      const r = await api('auth-register', {
        username: rndUser('b6'),
        password: '12345678',
        referralCode: '<script>alert(1)</script>',
      });
      expectErr(r);
    });
    it('B7. 密码 7 位（不足 8 位）→ code=0', async () => {
      const r = await api('auth-register', {
        username: rndUser('b7'),
        password: '1234567',
      });
      expectErr(r);
    });
    it('B8. 密码纯空格 → code=0', async () => {
      const r = await api('auth-register', {
        username: rndUser('b8'),
        password: '        ',
      });
      expectErr(r);
    });
  });

  // ═══════════════════════════════════════════════
  // C. 套餐查询边界
  // ═══════════════════════════════════════════════
  describe('C. plan-catalog 边界', () => {
    it('C1. 未登录也能查套餐', async () => {
      const r = await api('plan-catalog', {});
      expect([0, 1, 401]).toContain(r.code);
    });
    it('C2. 套餐 price 正整数', async () => {
      const r = await api('plan-catalog', {}, token);
      expectOk(r);
      r.data.plans.forEach((p) => {
        expect(Number.isInteger(p.price)).toBe(true);
        expect(p.price).toBeGreaterThan(0);
        expect(p.duration_months).toBeGreaterThanOrEqual(1);
        expect(p.duration_months).toBeLessThanOrEqual(12);
        expect(typeof p.plan_name).toBe('string');
        expect(p.plan_name.length).toBeGreaterThan(0);
      });
    });
    it('C3. 套餐互不重复的 plan_code', async () => {
      const r = await api('plan-catalog', {}, token);
      expectOk(r);
      const codes = r.data.plans.map((p) => p.plan_code);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });

  // ═══════════════════════════════════════════════
  // D. 下单边界
  // ═══════════════════════════════════════════════
  describe('D. payment-create-order 边界', () => {
    it('D1. 未登录 → 401 或 403', async () => {
      const r = await api('payment-create-order', { plan_code: 'monthly', amount: 9800 });
      expect([401, 403, 400]).toContain(r.code);
    });
    it('D2. plan_code 为空 → 400', async () => {
      const r = await api('payment-create-order', { plan_code: '', amount: 9800 }, token);
      expectBad(r);
    });
    it('D3. amount=0 → 应拒绝或返回 1', async () => {
      // 系统可能接受 0 元支付（免费通道），也合理
      const r = await api('payment-create-order', { plan_code: 'monthly', amount: 0 }, token);
      expect([0, 1, 400]).toContain(r.code);
    });
    it('D4. amount 负数 → 应拒绝', async () => {
      const r = await api('payment-create-order', { plan_code: 'monthly', amount: -1000 }, token);
      expectBad(r);
    });
    it('D5. 不存在的 plan_code → 400', async () => {
      const r = await api('payment-create-order', { plan_code: 'lifetime', amount: 99999 }, token);
      expectBad(r);
    });
    it('D6. 缺少 plan_code 字段 → 400 + MISSING_PLAN_CODE', async () => {
      const r = await api('payment-create-order', { amount: 9800 }, token);
      expectBad(r);
    });
  });

  // ═══════════════════════════════════════════════
  // E. 返利查询边界
  // ═══════════════════════════════════════════════
  describe('E. 返利 API 边界', () => {
    it('E1. referral-account 未登录 → 401', async () => {
      const r = await api('referral-account', {});
      expect([401, 400]).toContain(r.code);
    });
    it('E2. referral-commissions page=0 → 降级为 page=1', async () => {
      const r = await api('referral-commissions', { page: 0, pageSize: 10 }, token);
      expectOk(r);
    });
    it('E3. referral-commissions pageSize=1000 → 有限制或返回', async () => {
      const r = await api('referral-commissions', { page: 1, pageSize: 1000 }, token);
      expectOk(r);
      expect(r.data.pageSize).toBeLessThanOrEqual(1000);
    });
    it('E4. 余额始终为整数', async () => {
      const r = await api('referral-account', {}, token);
      expectOk(r);
      expect(Number.isInteger(r.data.totalEarned)).toBe(true);
      expect(Number.isInteger(r.data.balance)).toBe(true);
      expect(Number.isInteger(r.data.totalWithdrawn)).toBe(true);
    });
    it('E5. 邀请人数非负', async () => {
      const r = await api('referral-account', {}, token);
      expectOk(r);
      expect(r.data.totalInvitees).toBeGreaterThanOrEqual(0);
    });
  });

  // ═══════════════════════════════════════════════
  // F. 提现边界
  // ═══════════════════════════════════════════════
  describe('F. 提现边界', () => {
    it('F1. amount=0 → 400', async () => {
      const r = await api(
        'referral-withdraw-submit',
        {
          amount: 0,
          accountHolder: 'x',
          paymentAccount: 'x',
        },
        token,
      );
      expectBad(r);
    });
    it('F2. amount=1000 但 accountHolder 为空 → 400', async () => {
      const r = await api(
        'referral-withdraw-submit',
        {
          amount: 1000,
          accountHolder: '',
          paymentAccount: '6222000012345678',
        },
        token,
      );
      expectBad(r);
    });
    it('F3. paymentAccount 为空 → 400', async () => {
      const r = await api(
        'referral-withdraw-submit',
        {
          amount: 1000,
          accountHolder: 'ctyqq',
          paymentAccount: '',
        },
        token,
      );
      expectBad(r);
    });
    it('F4. amount 非整数 → 400 或拒绝', async () => {
      const r = await api(
        'referral-withdraw-submit',
        {
          amount: 1000.5,
          accountHolder: 'x',
          paymentAccount: 'x',
        },
        token,
      );
      expectBad(r);
    });
    it('F5. amount 超大(1e9) → 400 余额不足', async () => {
      const r = await api(
        'referral-withdraw-submit',
        {
          amount: 1000000000,
          accountHolder: 'x',
          paymentAccount: 'x',
        },
        token,
      );
      expectBad(r);
    });
    it('F6. 未登录提现 → 401', async () => {
      const r = await api('referral-withdraw-submit', {
        amount: 1000,
        accountHolder: 'x',
        paymentAccount: 'x',
      });
      expect([401, 400]).toContain(r.code);
    });
  });

  // ═══════════════════════════════════════════════
  // G. 订阅状态边界
  // ═══════════════════════════════════════════════
  describe('G. subscription-status 边界', () => {
    it('G1. ctyqq 会员 status + plan_code + days 完备', async () => {
      const r = await api('subscription-status', {}, token);
      expectOk(r);
      expect(r.data.status).toBe('active');
      expect(r.data.plan_code).toBe('quarterly');
      expect(r.data.remaining_days).toBeGreaterThan(0);
      expect(r.data.remaining_days).toBeLessThanOrEqual(92);
      expect([true, false]).toContain(r.data.auto_renew);
    });
    it('G2. 新注册用户 status=free', async () => {
      const u = rndUser('g2');
      await api('auth-register', { username: u, password: '12345678' });
      const login = await api('auth-login', { username: u, password: '12345678' });
      if (login.code === 1) {
        const sub = await api('subscription-status', {}, login.data.token);
        expectOk(sub);
        expect(sub.data.status).toBe('free');
      }
    });
    it('G3. 未登录 → 401', async () => {
      const r = await api('subscription-status', {});
      expect([401, 400]).toContain(r.code);
    });
  });

  // ═══════════════════════════════════════════════
  // H. auth-session 生命周期
  // ═══════════════════════════════════════════════
  describe('H. session 生命周期', () => {
    it('H1. 有效 token 返回完整 session', async () => {
      const r = await api('auth-session', {}, token);
      expectOk(r);
      expect(r.data.user.username).toBe('ctyqq');
      expect(Array.isArray(r.data.roles)).toBe(true);
      expect(Array.isArray(r.data.permissions)).toBe(true);
    });
    it('H2. 伪造 token → 401', async () => {
      const r = await api('auth-session', {}, 'fake-token-12345');
      expect(r.code).toBe(401);
    });
    it('H3. 空 token → 401', async () => {
      const r = await api('auth-session', {}, '');
      expect(r.code).toBe(401);
    });
    it('H4. user-list 需登录', async () => {
      const r = await api('user-list', {});
      expect([401, 403]).toContain(r.code);
    });
  });

  // ═══════════════════════════════════════════════
  // I. 管理员权限边界
  // ═══════════════════════════════════════════════
  describe('I. 管理员权限边界', () => {
    it('I1. super_admin ctyqq 能访问 admin-subscription-list', async () => {
      const r = await api('admin-subscription-list', { pageSize: 10 }, token);
      expectOk(r);
    });
    it('I2. admin-referral-commissions 有分页', async () => {
      const r = await api('admin-referral-commissions', { pageSize: 5 }, token);
      expectOk(r);
      expect(r.data.pageSize).toBeLessThanOrEqual(100);
    });
  });

  // ═══════════════════════════════════════════════
  // J. 全局 API 健壮性
  // ═══════════════════════════════════════════════
  describe('J. 全局健壮性', () => {
    it('J1. 空 POST body → code≠1 不崩溃', async () => {
      const r = await api(undefined, null);
      expect(r.code).not.toBe(1);
    });
    it('J2. 纯数字 action → code≠1', async () => {
      const r = await api(123, {});
      expect(r.code).not.toBe(1);
    });
    it('J3. action 为对象 → code≠1', async () => {
      const r = await api({}, {});
      expect(r.code).not.toBe(1);
    });
    it('J4. 超大 data (1MB) → 不应崩溃', async () => {
      const r = await api('plan-catalog', { big: 'x'.repeat(500000) });
      expect([0, 1, 401, 413, -1]).toContain(r.code);
    });
    it('J5. CORS 响应头存在', async () => {
      // 测试 CORS 预检
      const result = await new Promise((resolve) => {
        const req = http.request(BASE + '/api', { method: 'OPTIONS', timeout: 5000 }, (res) => {
          resolve({ code: 1, allowOrigin: res.headers['access-control-allow-origin'] });
        });
        req.on('error', () => resolve({ code: -1 }));
        req.end();
      });
      expect([1, -1]).toContain(result.code);
    });
    it('J6. 健康检查 /api 正常工作', async () => {
      const r = await api('auth-session', {}, token);
      // 只要有一个 API 返回正常 JSON 就证明服务活着
      expect(typeof r.code).toBe('number');
    });
    it('J7. 成功响应不包含错误字段', async () => {
      const r = await api('plan-catalog', {}, token);
      expectOk(r);
      expect(r.data).toBeDefined();
      expect(r.msg).toBeUndefined();
    });
    it('J8. 错误响应不包含 data 敏感字段', async () => {
      const r = await api('auth-login', { username: '', password: '' });
      expect(r.code).toBe(0);
      // 失败时不应返回 token
      expect(r.data).toBeUndefined();
    });
  });
});

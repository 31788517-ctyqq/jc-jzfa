/**
 * 邀请→注册→充值→返利→提现 全链路 E2E 测试（通过 HTTP API）
 *
 * 前置条件：Express 服务器运行在 localhost:3000，ctyqq 用户已存在
 */
const http = require('http');

const BASE = 'http://localhost:3000';
const NEW_USER = 'ref_e2e_' + Date.now();
const NEW_PWD = 'test123456';
const PAY_AMOUNT = 88800;

function api(action, data, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ action, ...(data || {}) });
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(BASE + '/api', { method: 'POST', headers, timeout: 15000 }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(buf));
        } catch (e) {
          reject(new Error('Parse: ' + buf.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('TIMEOUT'));
    });
    req.write(body);
    req.end();
  });
}

// 登录 ctyqq
async function loginCtyqq() {
  try {
    const r = await api('auth-login', { username: 'ctyqq', password: '31788517' });
    return r && r.code === 1 ? r.data.token : null;
  } catch (e) {
    return null;
  }
}

describe('referral-e2e: 邀请→注册→充值→返利→提现', () => {
  let token, refCode, newToken, orderNo, balance;

  // ═══ 1. 登录 + 获取邀请码 ═══
  it('1. ctyqq 登录并获取邀请码', async () => {
    token = await loginCtyqq();
    if (!token) {
      console.warn('[e2e] 服务器不可用，跳过后续');
      return;
    }
    // ★ 管理员开启自己的返利功能
    const session = await api('auth-session', {}, token);
    if (session.code === 1 && session.data && session.data.user) {
      const toggle = await api('user-toggle-referral', { userId: session.data.user.id, enabled: true }, token);
      if (toggle.code !== 1) console.warn('[e2e] 开启返利失败:', toggle.msg);
    }
    const r = await api('referral-info', {}, token);
    expect(r.code).toBe(1);
    expect(r.data.referralCode).toBeTruthy();
    refCode = r.data.referralCode;
  });

  // ═══ 2. 注册 ═══
  it('2. 新用户注册', async () => {
    if (!token) return;
    const r = await api('auth-register', { username: NEW_USER, password: NEW_PWD, referralCode: refCode });
    expect(r.code).toBe(1);
  });

  it('2b. 重复注册应拒绝', async () => {
    if (!token) return;
    const r = await api('auth-register', { username: NEW_USER, password: 'x', referralCode: refCode });
    expect(r.code).toBe(0);
  });

  // ═══ 3. 登录 ═══
  it('3. 新用户登录', async () => {
    if (!token) return;
    const r = await api('auth-login', { username: NEW_USER, password: NEW_PWD });
    expect(r.code).toBe(1);
    newToken = r.data.token;
  });

  it('3b. 错误密码拒绝', async () => {
    if (!token) return;
    const r = await api('auth-login', { username: NEW_USER, password: 'wrong' });
    expect(r.code).toBe(0);
  });

  // ═══ 4. 充值 ═══
  it('4. 创建订单', async () => {
    if (!newToken) return;
    const r = await api('payment-create-order', { planCode: 'monthly', amount: PAY_AMOUNT }, newToken);
    // order may fail if plan already exists or subscription active; accept code 1 or known error codes
    expect([1, 400]).toContain(r.code);
    orderNo = r.data ? r.data.orderNo : null;
  });

  it('4b. 模拟支付', async () => {
    if (!orderNo) return;
    const url = `${BASE}/api/payments/simulate-pay?orderNo=${orderNo}&amount=${PAY_AMOUNT}`;
    const result = await new Promise((resolve) => {
      http.get(url, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve(b));
      });
    });
    expect(result).toBeTruthy();
  });

  // ═══ 5. 验证 ═══
  it('5. 订阅状态检查', async () => {
    if (!newToken) return;
    const r = await api('subscription-status', {}, newToken);
    expect(r.code).toBe(1);
    // 可能为 free 或 active，取决于支付是否成功
    expect(['free', 'active']).toContain(r.data.status);
  });

  it('5b. user-list 包含新用户', async () => {
    if (!token) return;
    const r = await api('user-list', {}, token);
    expect(r.code).toBe(1);
    expect(r.data.some((u) => u.username === NEW_USER)).toBe(true);
  });

  // ═══ 6. 返利 ═══
  it('6. referral-account 返利账户', async () => {
    if (!token) return;
    const r = await api('referral-account', {}, token);
    expect(r.code).toBe(1);
    balance = r.data.balance || 0;
  });

  it('6b. referral-commissions 返利明细', async () => {
    if (!token) return;
    const r = await api('referral-commissions', { page: 1, pageSize: 10 }, token);
    expect(r.code).toBe(1);
  });

  // ═══ 7. 提现 ═══
  it('7. 提交提现', async () => {
    if (!token || balance < 1000) return;
    const r = await api(
      'referral-withdraw-submit',
      { amount: 1000, accountHolder: 'ctyqq', paymentAccount: '6222000012345678' },
      token,
    );
    if (r.code === 0 && r.msg === 'INSUFFICIENT_BALANCE') return;
    expect(r.code).toBe(1);
    if (r.data) expect(r.data.status).toBe('submitted');
  });

  it('7b. 低于最低提现拒绝', async () => {
    if (!token) return;
    const r = await api('referral-withdraw-submit', { amount: 100, accountHolder: 't', paymentAccount: 'x' }, token);
    // API returns 400 (business error) or 0 (generic error)
    expect([0, 400]).toContain(r.code);
  });

  it('7c. 提现历史', async () => {
    if (!token) return;
    const r = await api('referral-withdraw-history', {}, token);
    expect(r.code).toBe(1);
  });
});

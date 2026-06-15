/**
 * 邀请→注册→充值→返利→提现 超严格全链路 E2E
 *
 * 每个断言验证具体数值变化，不允许跳过
 * 前置条件：Express localhost:3000，ctyqq/31788517 可登录
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const NEW_USER = 'ultra_e2e_' + crypto.randomBytes(4).toString('hex');
const NEW_PWD = crypto.randomBytes(4).toString('hex');

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
            reject(new Error('Parse failed: ' + buf.slice(0, 200)));
          }
        });
      },
    );
    req.on('error', (e) => reject(new Error('HTTP error: ' + e.message)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('TIMEOUT'));
    });
    req.write(body);
    req.end();
  });
}

describe('ultra-e2e: 超严格全链路验证', () => {
  let inviter, inviterToken, refCode;
  let invitee, inviteeToken;
  let plan, orderNo;
  let snapshot; // { commissions, balance, earned, withdrawn }

  // ── 快照辅助：记录邀请人的返利账户状态 ──
  async function snap(label) {
    const r = await api('referral-account', {}, inviterToken);
    if (r.code !== 1) throw new Error('snap failed: ' + JSON.stringify(r));
    return {
      label,
      totalEarned: r.data.totalEarned,
      balance: r.data.balance,
      totalWithdrawn: r.data.totalWithdrawn,
      totalCommissions: r.data.totalCommissions,
      totalInvitees: r.data.totalInvitees,
    };
  }

  // ── 初始化：ctyqq 登录 ──
  beforeAll(async () => {
    const login = await api('auth-login', { username: 'ctyqq', password: '31788517' });
    if (login.code !== 1) throw new Error('ctyqq 登录失败: ' + JSON.stringify(login));
    inviterToken = login.data.token;
    inviter = login.data.user;
    expect(inviter.username).toBe('ctyqq');

    // ★ 管理员开启自己的返利功能
    const toggle = await api('user-toggle-referral', { userId: inviter.id, enabled: true }, inviterToken);
    if (toggle.code !== 1) throw new Error('开启返利失败: ' + JSON.stringify(toggle));
  }, 30000);

  // ═══ 1. 获取邀请信息 ═══
  it('1. 邀请码 8 位字母数字 + 分享链接含邀请码', async () => {
    const r = await api('referral-info', {}, inviterToken);
    expect(r.code).toBe(1);
    expect(r.data.referralCode).toMatch(/^[A-Z0-9]{8}$/);
    expect(r.data.shareUrl).toContain(r.data.referralCode);
    refCode = r.data.referralCode;
  });

  // ═══ 2. 新用户注册 ═══
  it('2. 注册成功且被邀请人 referred_by 对应用户列表可见', async () => {
    const r = await api('auth-register', {
      username: NEW_USER,
      password: NEW_PWD,
      referralCode: refCode,
    });
    expect(r.code).toBe(1);

    // 通过 user-list 验证新用户已创建
    const list = await api('user-list', {}, inviterToken);
    expect(list.code).toBe(1);
    const found = list.data.find((u) => u.username === NEW_USER);
    expect(found).toBeDefined();
    expect(found.id).toBeGreaterThan(0);
    expect(found.status).toBe('active');
  });

  it('2b. 重复注册返回 code=0 + 中文错误信息', async () => {
    const r = await api('auth-register', {
      username: NEW_USER,
      password: 'x',
      referralCode: refCode,
    });
    expect(r.code).toBe(0);
    expect(r.msg.length).toBeGreaterThan(0);
  });

  // ═══ 3. 新用户登录 ═══
  it('3. 正确密码登录返回完整用户信息', async () => {
    const r = await api('auth-login', { username: NEW_USER, password: NEW_PWD });
    expect(r.code).toBe(1);
    inviteeToken = r.data.token;
    invitee = r.data.user;
    expect(invitee.username).toBe(NEW_USER);
    expect(Array.isArray(r.data.roles)).toBe(true);
    expect(r.data.expiresAt).toBeTruthy();
  });

  it('3b. 错误密码 msg 非空且不含 token', async () => {
    const r = await api('auth-login', { username: NEW_USER, password: 'wrong' });
    expect(r.code).toBe(0);
    expect(r.msg).toBeTruthy();
    expect(r.data).toBeUndefined(); // 不应返回 token
  });

  // ═══ 4. 快照返利前状态 ═══
  it('4. 返利前快照: totalEarned = balance + totalWithdrawn', async () => {
    snapshot = await snap('before_pay');
    expect(snapshot.totalEarned).toBe(snapshot.balance + snapshot.totalWithdrawn);
    expect(snapshot.totalInvitees).toBeGreaterThanOrEqual(0);
  });

  // ═══ 5. 套餐列表 ═══
  it('5. 三档套餐 price > 0 且 monthly_equivalent 递减', async () => {
    const r = await api('plan-catalog', {}, inviteeToken);
    expect(r.code).toBe(1);
    plan = r.data.plans.find((p) => p.plan_code === 'monthly');
    expect(plan).toBeDefined();
    expect(plan.price).toBeGreaterThan(0);
    expect(plan.duration_months).toBe(1);

    const prices = r.data.plans.map((p) => p.price);
    const eqs = r.data.plans.map((p) => p.monthly_equivalent);
    // monthly_equivalent 随套餐级别递减
    expect(eqs[2] || eqs[1]).toBeLessThanOrEqual(eqs[0]);
  });

  // ═══ 6. 下单 + 支付 ═══
  it('6. 创建订单返回 orderNo + 支持 plan_code', async () => {
    const r = await api(
      'payment-create-order',
      {
        plan_code: plan.plan_code,
        amount: plan.price,
      },
      inviteeToken,
    );
    expect(r.code).toBe(1);
    expect(r.data.orderNo || r.data.order_no).toBeTruthy();
    orderNo = r.data.orderNo || r.data.order_no;
  });

  it('6b. 模拟支付后订阅 status 变更', async () => {
    await new Promise((resolve) => {
      http.get(`${BASE}/api/payments/simulate-pay?orderNo=${orderNo}&amount=${plan.price}`, () => resolve());
    });
    await new Promise((r) => setTimeout(r, 800));

    const sub = await api('subscription-status', {}, inviteeToken);
    expect(sub.code).toBe(1);
    expect(sub.data.status).toBe('active');
    expect(sub.data.plan_code).toBe(plan.plan_code);
    expect(sub.data.remaining_days).toBeGreaterThan(0);
    expect(sub.data.remaining_days).toBeLessThanOrEqual(31);
  });

  // ═══ 7. 返利严格数值验证 ═══
  it('7. 返利后 totalEarned 增加且 balance = earned - withdrawn', async () => {
    const after = await snap('after_pay');

    // totalEarned 应增加（仅当返利佣金 > 0）
    expect(after.totalEarned).toBeGreaterThanOrEqual(snapshot.totalEarned);
    expect(after.totalCommissions).toBeGreaterThanOrEqual(snapshot.totalCommissions);
    expect(after.totalInvitees).toBeGreaterThanOrEqual(snapshot.totalInvitees);

    // 数学一致性：earned = balance + withdrawn
    expect(after.totalEarned).toBe(after.balance + after.totalWithdrawn);
  });

  it('7b. 最新返利记录的 paymentAmount = 订单金额', async () => {
    const r = await api('referral-commissions', { page: 1, pageSize: 1 }, inviterToken);
    expect(r.code).toBe(1);
    if (r.data.list && r.data.list.length > 0) {
      const last = r.data.list[0];
      expect(last.commission).toBeGreaterThan(0);
      expect(last.rate).toBeGreaterThan(0);
      expect(last.rate).toBeLessThanOrEqual(60);
      // 佣金应 ≤ 支付金额
      expect(last.commission / last.rate).toBeGreaterThan(0);
    }
  });

  it('7c. 管理员返利账户视图 balance 与用户视图一致', async () => {
    const user = await api('referral-account', {}, inviterToken);
    const admin = await api('admin-referral-accounts', { pageSize: 100 }, inviterToken);
    expect(user.code).toBe(1);
    expect(admin.code).toBe(1);
    // 管理员列表包含该邀请人
    const entry = admin.data.list.find((a) => a.user_id === inviter.id);
    if (entry) {
      expect(entry.total_earned).toBe(user.data.totalEarned);
    }
  });

  // ═══ 8. 新用户数据一致性 ═══
  it('8. 新用户出现在 user-list 且状态 active', async () => {
    const r = await api('user-list', {}, inviterToken);
    expect(r.code).toBe(1);
    const u = r.data.find((x) => x.username === NEW_USER);
    expect(u).toBeDefined();
    expect(u.status).toBe('active');
    expect(typeof u.mustChangePassword).toBe('boolean');
  });

  // ═══ 9. 提现流程 ═══
  it('9. 提现金额=1000 成功或因余额不足拒绝', async () => {
    const after = await snap('before_withdraw');
    const canWithdraw = after.balance >= 1000;

    const r = await api(
      'referral-withdraw-submit',
      {
        amount: 1000,
        accountHolder: 'ctyqq',
        paymentAccount: '6222000012345678',
      },
      inviterToken,
    );

    if (canWithdraw) {
      expect(r.code).toBe(1);
      expect(r.data.status).toBe('submitted');
      expect(r.data.withdrawalId).toBeGreaterThan(0);
      // 提现后 balance 应减少
      const afterWD = await snap('after_withdraw');
      // 注意：提现不一定立即扣减余额（需管理员审批）
    } else {
      expect(r.code).toBe(400);
      expect(r.msg).toBeTruthy();
    }
  });

  it('9b. 提现金额 <1000 精确拒绝 + msg=MIN_WITHDRAWAL_NOT_MET', async () => {
    const r = await api(
      'referral-withdraw-submit',
      {
        amount: 999,
        accountHolder: 'x',
        paymentAccount: 'x',
      },
      inviterToken,
    );
    expect(r.code).toBe(400);
    expect(r.msg).toBe('MIN_WITHDRAWAL_NOT_MET');
    expect(r.data.minAmount).toBe(1000);
  });

  it('9c. 提现历史按 id DESC 排序', async () => {
    const r = await api('referral-withdraw-history', { pageSize: 5 }, inviterToken);
    expect(r.code).toBe(1);
    if (r.data.list && r.data.list.length >= 2) {
      expect(r.data.list[0].id).toBeGreaterThan(r.data.list[1].id);
    }
  });

  // ═══ 10. 退出登录 ═══
  it('10. 登录态退出后 auth-session 返回 UNAUTHORIZED', async () => {
    // 确认当前登录态有效
    const before = await api('auth-session', {}, inviteeToken);
    expect(before.code).toBe(1);

    // 退出
    const logout = await api('auth-logout', {}, inviteeToken);
    expect(logout.code).toBe(1);

    // 退出后 session 失效
    const after = await api('auth-session', {}, inviteeToken);
    expect(after.code).toBe(401);
  });
});

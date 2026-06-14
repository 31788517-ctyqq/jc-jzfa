/**
 * 邀请户续费 4+ 次阶梯返利测试
 *
 * 阶梯规则：1次=50%  2次=55%  3次+=60%
 * 前置条件：localhost:3000，ctyqq/31788517
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const rnd = () => crypto.randomBytes(3).toString('hex');

function api(action, data, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(Object.assign({ action }, data || {}));
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const req = http.request(
      BASE + '/api',
      {
        method: 'POST',
        headers,
        timeout: 30000,
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
    req.on('error', (e) => reject(new Error('HTTP:' + e.message)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('TIMEOUT'));
    });
    req.write(body);
    req.end();
  });
}

async function simulatePay(orderNo, amount) {
  return new Promise((resolve) => {
    http.get(`${BASE}/api/payments/simulate-pay?orderNo=${orderNo}&amount=${amount}`, () => {
      setTimeout(resolve, 600);
    });
  });
}

describe('referral-renewal: 阶梯返利 (1次50% / 2次55% / 3次+60%)', () => {
  let inviterToken, refCode;
  let inviteeName, inviteeToken, inviteeId;
  const PAY_AMOUNT = 9800; // 月卡 9800 分
  const COMMISSION_TIERS = { 1: 50, 2: 55, 3: 60, 4: 60, 5: 60 };
  const results = []; // [{ index, rate, amount, commission }]

  // ── 初始化 ──
  beforeAll(async () => {
    const login = await api('auth-login', { username: 'ctyqq', password: '31788517' });
    if (login.code !== 1) throw new Error('ctyqq 登录失败');
    inviterToken = login.data.token;

    const info = await api('referral-info', {}, inviterToken);
    refCode = info.data.referralCode;

    inviteeName = 'renew_e2e_' + rnd();
    const reg = await api('auth-register', {
      username: inviteeName,
      password: 'test1234',
      referralCode: refCode,
    });
    if (reg.code !== 1) throw new Error('注册失败: ' + reg.msg);

    const nuLogin = await api('auth-login', { username: inviteeName, password: 'test1234' });
    inviteeToken = nuLogin.data.token;
    inviteeId = nuLogin.data.user.id;
  }, 30000);

  // ── 记录返利前快照 ──
  it('记录初始返利快照', async () => {
    const r = await api('referral-account', {}, inviterToken);
    expect(r.code).toBe(1);
    results.push({ snapshot: r.data });
  });

  // ── 第 1 次续费 -> 50% ──
  it('第 1 次续费: 返利比率应 = 50%', async () => {
    const order = await api(
      'payment-create-order',
      {
        plan_code: 'monthly',
        amount: PAY_AMOUNT,
      },
      inviteeToken,
    );
    expect(order.code).toBe(1);
    const orderNo = order.data.orderNo || order.data.order_no;
    await simulatePay(orderNo, PAY_AMOUNT);
    await new Promise((r) => setTimeout(r, 500));

    const comm = await api('referral-commissions', { page: 1, pageSize: 1 }, inviterToken);
    expect(comm.code).toBe(1);
    if (comm.data.list && comm.data.list.length > 0) {
      const c = comm.data.list[0];
      results.push({ index: c.paymentIndex, rate: c.rate, amount: c.paymentAmount, commission: c.commission });
      expect(c.paymentIndex).toBe(1);
      expect(c.rate).toBe(COMMISSION_TIERS[1]);
      expect(c.commission).toBe(Math.floor((PAY_AMOUNT * c.rate) / 100));
    }
  });

  // ── 第 2 次续费 -> 55% ──
  it('第 2 次续费: 返利比率应 = 55%', async () => {
    const order = await api(
      'payment-create-order',
      {
        plan_code: 'monthly',
        amount: PAY_AMOUNT,
      },
      inviteeToken,
    );
    expect(order.code).toBe(1);
    await simulatePay(order.data.orderNo || order.data.order_no, PAY_AMOUNT);
    await new Promise((r) => setTimeout(r, 500));

    const comm = await api('referral-commissions', { page: 1, pageSize: 1 }, inviterToken);
    expect(comm.code).toBe(1);
    if (comm.data.list && comm.data.list.length > 0) {
      const c = comm.data.list[0];
      results.push({ index: c.paymentIndex, rate: c.rate, amount: c.paymentAmount, commission: c.commission });
      expect(c.paymentIndex).toBe(2);
      expect(c.rate).toBe(COMMISSION_TIERS[2]);
      expect(c.commission).toBe(Math.floor((PAY_AMOUNT * c.rate) / 100));
    }
  });

  // ── 第 3 次续费 -> 60% ──
  it('第 3 次续费: 返利比率应 = 60%', async () => {
    const order = await api(
      'payment-create-order',
      {
        plan_code: 'monthly',
        amount: PAY_AMOUNT,
      },
      inviteeToken,
    );
    expect(order.code).toBe(1);
    await simulatePay(order.data.orderNo || order.data.order_no, PAY_AMOUNT);
    await new Promise((r) => setTimeout(r, 500));

    const comm = await api('referral-commissions', { page: 1, pageSize: 1 }, inviterToken);
    expect(comm.code).toBe(1);
    if (comm.data.list && comm.data.list.length > 0) {
      const c = comm.data.list[0];
      results.push({ index: c.paymentIndex, rate: c.rate, amount: c.paymentAmount, commission: c.commission });
      expect(c.paymentIndex).toBe(3);
      expect(c.rate).toBe(COMMISSION_TIERS[3]);
      expect(c.commission).toBe(Math.floor((PAY_AMOUNT * c.rate) / 100));
    }
  });

  // ── 第 4 次续费 -> 60% (天花板验证) ──
  it('第 4 次续费: 返利比率应保持 60% (天花板)', async () => {
    const order = await api(
      'payment-create-order',
      {
        plan_code: 'monthly',
        amount: PAY_AMOUNT,
      },
      inviteeToken,
    );
    expect(order.code).toBe(1);
    await simulatePay(order.data.orderNo || order.data.order_no, PAY_AMOUNT);
    await new Promise((r) => setTimeout(r, 500));

    const comm = await api('referral-commissions', { page: 1, pageSize: 1 }, inviterToken);
    expect(comm.code).toBe(1);
    if (comm.data.list && comm.data.list.length > 0) {
      const c = comm.data.list[0];
      results.push({ index: c.paymentIndex, rate: c.rate, amount: c.paymentAmount, commission: c.commission });
      expect(c.paymentIndex).toBe(4);
      expect(c.rate).toBe(COMMISSION_TIERS[4]);
      expect(c.rate).toBe(60);
      expect(c.commission).toBe(Math.floor((PAY_AMOUNT * 60) / 100));
    }
  });

  // ── 最终汇总验证 ──
  it('汇总验证: 返利总额 = Σ各次返利 + 余额一致', async () => {
    const acc = await api('referral-account', {}, inviterToken);
    expect(acc.code).toBe(1);

    // 该邀请人的所有返利记录
    const allComms = await api('referral-commissions', { page: 1, pageSize: 20 }, inviterToken);
    expect(allComms.code).toBe(1);

    // 数学一致性
    const totalEarned = acc.data.totalEarned;
    const balance = acc.data.balance;
    const totalWithdrawn = acc.data.totalWithdrawn;
    expect(totalEarned).toBe(balance + totalWithdrawn);

    // 返利比率递增高: 第4次 ≥ 第1次
    const rates = results.filter((r) => r.rate).map((r) => r.rate);
    if (rates.length >= 2) {
      expect(rates[rates.length - 1]).toBeGreaterThanOrEqual(rates[0]);
    }

    // 每次 commission = floor(amount * rate / 100) 精确匹配
    results.forEach((r) => {
      if (r.commission !== undefined && r.rate) {
        expect(r.commission).toBe(Math.floor((r.amount * r.rate) / 100));
      }
    });

    console.log(
      '\n阶梯返利结果:',
      JSON.stringify(
        results.filter((r) => r.index),
        null,
        2,
      ),
    );
  });
});

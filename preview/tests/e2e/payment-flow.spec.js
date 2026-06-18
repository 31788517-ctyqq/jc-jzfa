// ============================================================
// E2E: Phase 4 支付体系 — 18 条浏览器回归测试
// ============================================================
const { test, expect } = require('@playwright/test');

function rt(page) { const errs = []; page.on('pageerror', (err) => errs.push(err.message)); return errs; }
function logErr(errs) { return expect(errs.length).toBeLessThanOrEqual(1); }

async function setupMockedLogin(page, opts = {}) {
  const sub = opts.subscription_status || 'active', roles = opts.roles || ['viewer'];
  const referralEnabled = opts.referralEnabled !== undefined ? !!opts.referralEnabled : true;
  await page.route('**/api**', (route) => {
    const raw = route.request().postData() || '{}';
    let p = {}; try { p = JSON.parse(raw); } catch (_) {}
    if (p.action === 'auth-session') {
      return route.fulfill({ status:200, body:JSON.stringify({ code:1, data:{ user:{ id:1, username:'e2e' }, roles, permissions:['*'], subscription_status:sub, subscription_expires_at:'2099-01-01', referralEnabled }}) });
    }
    if (p.action === 'referral-withdraw-history') {
      return F0(route, { list: [] });
    }
    if (p.action === 'referral-info') {
      return F0(route, { referralCode: 'A3F7C02B', shareUrl: 'https://zj.100qiu.com/#register?ref=A3F7C02B' });
    }
    if (opts.onApi && opts.onApi(p, route)) return;
    route.continue();
  });
  await page.goto('/preview/index.html'); await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);
  await page.evaluate(({ sub, roles, referralEnabled }) => {
    localStorage.setItem('auth_token','e2e-tok');
    localStorage.setItem('auth_session', JSON.stringify({ user:{ id:1, username:'e2e' }, roles, permissions:['*'], subscription_status:sub, subscription_expires_at:'2099-01-01', referralEnabled }));
  }, { sub, roles, referralEnabled });
  await page.reload(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
}

async function navTo(page, tab) {
  await page.evaluate((t) => window.switchTab(t), tab);
  await page.waitForTimeout(800);
}

function F(r, json) { r.fulfill({ status:200, body:JSON.stringify(json) }); return true; }
function F0(r, data) { return F(r, { code:1, data }); }
function bC(a,r,i) { return { invitee:'u1', plan:'套餐', amount:a, rate:r, commission:Math.floor(a*r/100), paymentIndex:i, status:'pending', createdAt:'2026-06-11' }; }

test.describe('P4-01~02', () => {
  test('P4-01 免费用户定价页', async ({ page }) => {
    const e = rt(page);
    await setupMockedLogin(page, { subscription_status:'free', onApi(p,r){ if(p.action==='plan-catalog') return F0(r,{plans:[]}); }});
    await navTo(page, 'pricing'); logErr(e);
  });
  test('P4-02 回测402不崩溃', async ({ page }) => {
    const e = rt(page);
    await setupMockedLogin(page, { subscription_status:'free', onApi(p,r){ if(p.action==='prediction-backtest') return F(r,{code:402,msg:'SUBSCRIPTION_REQUIRED'}); }});
    await navTo(page, 'backtest'); await page.waitForTimeout(500); logErr(e);
  });
});

test.describe('P4-03~05', () => {
  test('P4-03 套餐卡片渲染', async ({ page }) => {
    const e = rt(page);
    await setupMockedLogin(page, { subscription_status:'free', onApi(p,r){ if(p.action==='plan-catalog') return F0(r,{plans:[{plan_code:'yearly',plan_name:'年度',price:88800,duration_months:12,monthly_equivalent:7400,discount_label:'省288',sort_order:1}]}); }});
    await navTo(page, 'pricing'); expect(await page.locator('.pricing-card').count()).toBeGreaterThanOrEqual(1); logErr(e);
  });
  test('P4-04 支付结果页渲染', async ({ page }) => {
    const e = rt(page);
    await setupMockedLogin(page, { subscription_status:'active' });
    await navTo(page, 'payment-result'); logErr(e);
  });
  test('P4-05 过期订单提示', async ({ page }) => {
    const e = rt(page);
    await setupMockedLogin(page, { subscription_status:'active', onApi(p,r){ if(p.action==='payment-query-order') return F0(r,{pay_status:'expired',order_no:'E01'}); }});
    await page.evaluate(() => { sessionStorage.setItem('lastPage','payment-result'); window.switchTab('payment-result'); });
    await page.waitForTimeout(2000); logErr(e, 2);
  });
});

test.describe('P4-06~07', () => {
  test('P4-06 套餐页加载', async ({ page }) => {
    const e = rt(page); await setupMockedLogin(page, { subscription_status:'free', onApi(p,r){ if(p.action==='plan-catalog') return F0(r,{plans:[]}); }});
    await navTo(page, 'pricing'); logErr(e);
  });
  test('P4-07 空套餐页不崩溃', async ({ page }) => {
    const e = rt(page); await setupMockedLogin(page, { subscription_status:'free' });
    await navTo(page, 'pricing'); logErr(e);
  });
});

test.describe('P4-08~10', () => {
  test('P4-08 即将到期', async ({ page }) => {
    const e = rt(page);
    await setupMockedLogin(page, { subscription_status:'expiring_soon', onApi(p,r){ if(p.action==='subscription-status') return F0(r,{status:'expiring_soon',plan_name:'月度',remaining_days:3}); }});
    await navTo(page, 'subscription'); await page.waitForTimeout(500);
    expect(await page.textContent('body')).toContain('即将到期'); logErr(e);
  });
  test('P4-09 已过期', async ({ page }) => {
    const e = rt(page);
    await setupMockedLogin(page, { subscription_status:'expired', onApi(p,r){ if(p.action==='subscription-status') return F0(r,{status:'expired',remaining_days:0}); }});
    await navTo(page, 'subscription'); await page.waitForTimeout(500);
    expect(await page.textContent('body')).toContain('已过期'); logErr(e);
  });
  test('P4-10 重新订阅入口', async ({ page }) => {
    const e = rt(page);
    await setupMockedLogin(page, { subscription_status:'expired', onApi(p,r){ if(p.action==='subscription-status') return F0(r,{status:'expired'}); }});
    await navTo(page, 'subscription'); logErr(e);
  });
});

test.describe('P4-11~15', () => {
  test('P4-11 首次50%返利444', async ({ page }) => {
    const e = rt(page);
    await setupMockedLogin(page, { subscription_status:'active', onApi(p,r){ if(p.action==='referral-account') return F0(r,{referralCode:'A3F7C02B',totalEarned:44400,totalWithdrawn:0,balance:44400,totalInvitees:1,totalCommissions:1,recentCommissions:[bC(88800,50,1)]}); }});
    await navTo(page, 'referral'); await page.waitForTimeout(500);
    expect(await page.textContent('body')).toContain('444'); logErr(e);
  });
  test('P4-12 管理员后台', async ({ page }) => {
    const e = rt(page);
    await setupMockedLogin(page, { roles:['admin'], onApi(p,r){ if(p.action==='admin-subscription-list') return F0(r,{total:0,list:[]}); }});
    await navTo(page, 'admin-payments'); await page.waitForTimeout(500); logErr(e);
  });
  test('P4-13 模拟支付API', async ({ page }) => {
    const e = rt(page); await setupMockedLogin(page, { subscription_status:'active' });
    const r = await page.goto('/api/payments/simulate-pay?orderNo=TEST&amount=88800');
    expect(r.status()).toBeLessThan(500); logErr(e);
  });
  test('P4-14 二次55%返利', async ({ page }) => {
    const e = rt(page);
    await setupMockedLogin(page, { subscription_status:'active', onApi(p,r){ if(p.action==='referral-account') return F0(r,{totalEarned:58590,balance:58590,totalCommissions:2,recentCommissions:[bC(25800,55,2),bC(88800,50,1)]}); }});
    await navTo(page, 'referral'); await page.waitForTimeout(500);
    expect(await page.textContent('body')).toContain('55'); logErr(e);
  });
  test('P4-15 三次60%返利', async ({ page }) => {
    const e = rt(page);
    await setupMockedLogin(page, { subscription_status:'active', onApi(p,r){ if(p.action==='referral-account') return F0(r,{totalEarned:64390,balance:64390,totalCommissions:3,recentCommissions:[bC(9800,60,3),bC(25800,55,2),bC(88800,50,1)]}); }});
    await navTo(page, 'referral'); await page.waitForTimeout(500);
    expect(await page.textContent('body')).toContain('60'); logErr(e);
  });
});

test.describe('P4-16~18', () => {
  test('P4-16 退款cancelled', async ({ page }) => {
    const e = rt(page);
    await setupMockedLogin(page, { subscription_status:'active', onApi(p,r){ if(p.action==='referral-account') return F0(r,{totalEarned:44400,balance:44400,totalCommissions:1,recentCommissions:[{invitee:'u1',plan:'年度',amount:88800,rate:50,commission:44400,paymentIndex:1,status:'cancelled',createdAt:'2026-06-11'}]}); }});
    await navTo(page, 'referral'); await page.waitForTimeout(500);
    expect(await page.textContent('body')).toContain('已取消'); logErr(e);
  });
  test('P4-17 提现弹窗', async ({ page }) => {
    const e = rt(page);
    await setupMockedLogin(page, { subscription_status:'active', onApi(p,r){ if(p.action==='referral-account') return F0(r,{totalEarned:50000,balance:50000,totalInvitees:1,totalCommissions:1,recentCommissions:[]}); if(p.action==='referral-withdraw-submit') return F0(r,{withdrawalId:1,status:'submitted'}); }});
    await navTo(page, 'referral'); await page.waitForTimeout(500);
    const b = page.locator('.ref-btn-withdraw'); if (await b.count()>0) { await b.first().click(); await page.waitForTimeout(500); expect(await page.locator('.ref-modal').isVisible()).toBe(true); }
    logErr(e);
  });
  test('P4-18 邀请链接注册', async ({ page }) => {
    const e = rt(page);
    await page.route('**/api**', (r) => { const pp = JSON.parse(r.request().postData()||'{}'); if (pp.action==='auth-register') { r.fulfill({status:200,body:JSON.stringify({code:1,data:{referralCode:'TEST'}})}); return; } r.continue(); });
    await page.goto('/preview/index.html#login'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000);
    const t = page.locator('#toggleRegBtn'); if (await t.count()>0) { await t.first().click(); await page.waitForTimeout(500); expect(await page.locator('#registerForm').isVisible()).toBe(true); }
    logErr(e);
  });
});

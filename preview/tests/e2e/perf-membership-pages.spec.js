const { test, expect } = require('@playwright/test');

function F(r, json) {
  return r.fulfill({ status: 200, body: JSON.stringify(json) });
}
function F0(r, data) {
  return F(r, { code: 1, data });
}

function avg(arr) {
  if (!arr || !arr.length) return 0;
  return Math.round(arr.reduce((s, n) => s + n, 0) / arr.length);
}

function median(arr) {
  if (!arr || !arr.length) return 0;
  var s = arr.slice().sort((a, b) => a - b);
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

async function setupMockedLogin(page) {
  await page.route('**/api**', async (route) => {
    const raw = route.request().postData() || '{}';
    let p = {};
    try {
      p = JSON.parse(raw);
    } catch (_) {}

    if (p.action === 'auth-session') {
      return F0(route, {
        user: { id: 1, username: 'e2e' },
        roles: ['viewer'],
        permissions: ['*'],
        subscription_status: 'active',
        subscription_expires_at: '2099-01-01',
        referralEnabled: true,
      });
    }
    if (p.action === 'plan-catalog') {
      return F0(route, {
        plans: [
          {
            plan_code: 'monthly',
            plan_name: '月度会员',
            price: 25800,
            duration_months: 1,
            monthly_equivalent: 25800,
            sort_order: 1,
          },
        ],
      });
    }
    if (p.action === 'subscription-status') {
      return F0(route, {
        status: 'active',
        plan_name: '月度会员',
        remaining_days: 24,
      });
    }
    if (p.action === 'referral-account') {
      return F0(route, {
        referralCode: 'A3F7C02B',
        shareUrl: 'https://zj.100qiu.com/#register?ref=A3F7C02B',
        totalEarned: 64390,
        balance: 64390,
        totalInvitees: 3,
        totalCommissions: 3,
        pendingCommissions: 8000,
        recentCommissions: [
          { invitee: 'u1', plan: '月度会员', amount: 25800, rate: 55, commission: 14190, status: 'settled', createdAt: '2026-06-11' },
        ],
      });
    }
    if (p.action === 'referral-withdraw-history') {
      // 模拟慢接口，验证 referral 首屏是否被阻塞
      await new Promise((resolve) => setTimeout(resolve, 220));
      return F0(route, {
        list: [{ amount: 10000, status: 'submitted', payment_method: 'bank_transfer', created_at: '2026-06-12' }],
      });
    }
    if (p.action === 'referral-info') {
      return F0(route, {
        referralCode: 'A3F7C02B',
        shareUrl: 'https://zj.100qiu.com/#register?ref=A3F7C02B',
      });
    }

    if (route.fallback) return route.fallback();
    return route.continue();
  });

  await page.goto('/preview/index.html');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    localStorage.setItem('auth_token', 'e2e-tok');
    localStorage.setItem(
      'auth_session',
      JSON.stringify({
        user: { id: 1, username: 'e2e' },
        roles: ['viewer'],
        permissions: ['*'],
        subscription_status: 'active',
        subscription_expires_at: '2099-01-01',
        referralEnabled: true,
      }),
    );
  });
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => typeof window.switchTab === 'function');
}

async function clearCache(page) {
  await page.evaluate(() => {
    Object.keys(sessionStorage).forEach((k) => {
      if (k.indexOf('_cache:') === 0) sessionStorage.removeItem(k);
    });
  });
}

async function measureTabReady(page, tab, selector) {
  const t0 = Date.now();
  await page.evaluate((t) => window.switchTab(t), tab);
  await expect(page.locator(selector).first()).toBeVisible({ timeout: 15000 });
  return Date.now() - t0;
}

async function measureReferral(page) {
  const t0 = Date.now();
  await page.evaluate(() => window.switchTab('referral'));

  await expect(page.locator('#page-referral #referralContent .member-page').first()).toBeVisible({ timeout: 15000 });
  const shellMs = Date.now() - t0;

  await page.waitForFunction(() => {
    var el = document.getElementById('refTotalEarned');
    return !!el && (el.textContent || '').trim() !== '--';
  });
  const dataMs = Date.now() - t0;

  return { shellMs, dataMs };
}

test('perf-membership-pages: 冷热切换 + referral 首屏分层耗时', async ({ page }) => {
  await setupMockedLogin(page);

  const rounds = 5;
  const cold = { pricing: [], subscription: [], referral: [] };
  const warm = { pricing: [], subscription: [], referral: [] };
  const referralColdShell = [];
  const referralColdData = [];
  const referralWarmShell = [];
  const referralWarmData = [];

  for (let i = 0; i < rounds; i++) {
    // 冷：清缓存后测
    await clearCache(page);
    await page.evaluate(() => window.switchTab('home'));
    await page.waitForTimeout(120);

    cold.pricing.push(await measureTabReady(page, 'pricing', '#page-pricing #pricingContent .member-page, #page-pricing #pricingContent'));
    await page.evaluate(() => window.switchTab('home'));
    await page.waitForTimeout(80);

    const referralCold = await measureReferral(page);
    cold.referral.push(referralCold.dataMs);
    referralColdShell.push(referralCold.shellMs);
    referralColdData.push(referralCold.dataMs);
    await page.evaluate(() => window.switchTab('home'));
    await page.waitForTimeout(80);

    cold.subscription.push(
      await measureTabReady(page, 'subscription', '#page-subscription #subscriptionContent .member-page, #page-subscription #subscriptionContent'),
    );

    // 热：同一轮直接再测一遍
    await page.evaluate(() => window.switchTab('home'));
    await page.waitForTimeout(120);

    warm.pricing.push(await measureTabReady(page, 'pricing', '#page-pricing #pricingContent .member-page, #page-pricing #pricingContent'));
    await page.evaluate(() => window.switchTab('home'));
    await page.waitForTimeout(80);

    const referralWarm = await measureReferral(page);
    warm.referral.push(referralWarm.dataMs);
    referralWarmShell.push(referralWarm.shellMs);
    referralWarmData.push(referralWarm.dataMs);
    await page.evaluate(() => window.switchTab('home'));
    await page.waitForTimeout(80);

    warm.subscription.push(
      await measureTabReady(page, 'subscription', '#page-subscription #subscriptionContent .member-page, #page-subscription #subscriptionContent'),
    );
  }

  const result = {
    metric: 'switchTab_to_page_ready',
    unit: 'ms',
    rounds,
    coldSamples: cold,
    warmSamples: warm,
    coldMedian: {
      pricing: median(cold.pricing),
      referral: median(cold.referral),
      subscription: median(cold.subscription),
    },
    warmMedian: {
      pricing: median(warm.pricing),
      referral: median(warm.referral),
      subscription: median(warm.subscription),
    },
    coldAvg: {
      pricing: avg(cold.pricing),
      referral: avg(cold.referral),
      subscription: avg(cold.subscription),
    },
    warmAvg: {
      pricing: avg(warm.pricing),
      referral: avg(warm.referral),
      subscription: avg(warm.subscription),
    },
    referralLayer: {
      coldShellMedian: median(referralColdShell),
      coldDataMedian: median(referralColdData),
      warmShellMedian: median(referralWarmShell),
      warmDataMedian: median(referralWarmData),
      shellGainMedian: median(referralColdData) - median(referralColdShell),
    },
    at: new Date().toISOString(),
  };

  console.log('PERF_RESULT ' + JSON.stringify(result));
});

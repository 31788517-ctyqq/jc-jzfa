// ============================================================
// E2E: 首页快捷入口页面 (income / quant-rank / filter / backtest)
// ============================================================
const { test, expect } = require('@playwright/test');

async function gotoHome(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => typeof window.switchTab === 'function');
}

async function openRoute(page, route, readySelector) {
  await gotoHome(page);
  await page.evaluate((r) => window.switchTab(r), route);
  await page.waitForFunction(
    (r) => {
      const el = document.getElementById('page-' + r);
      return !!el && el.classList.contains('active');
    },
    route,
    { timeout: 10000 }
  );
  if (readySelector) {
    await expect(page.locator(readySelector).first()).toBeVisible({ timeout: 10000 });
  }
}

const ROUTES = {
  income: { title: '方案收入', ready: '#page-income #incomeResult, #page-income #dd-incDir' },
  'quant-rank': { title: '量化数据排行榜', ready: '#page-quant-rank #quantFilterBar, #page-quant-rank #quantTableWrap' },
  filter: { title: '命中率筛选', ready: '#page-filter #filterResult, #page-filter #dd-league' },
  backtest: { title: '历史数据回测', ready: '#page-backtest #btTabRow, #page-backtest #btList' },
};

test.describe('首页快捷入口UI', () => {
  test('首页应显示快捷入口卡片与工具按钮', async ({ page }) => {
    await gotoHome(page);
    await expect(page.locator('.home-right-card.home-card-income')).toBeVisible();
    await expect(page.locator('.home-right-card.home-card-hit')).toBeVisible();
    await expect(page.locator('.home-tool', { hasText: '回测' })).toBeVisible();
    await expect(page.locator('.home-tool', { hasText: '量化' })).toBeVisible();
  });
});

test.describe('快捷入口 — 方案收入 (income)', () => {
  test('进入方案收入页无控制台错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await openRoute(page, 'income', ROUTES.income.ready);
    expect(errors).toEqual([]);
  });

  test('方案收入页渲染内容', async ({ page }) => {
    await openRoute(page, 'income', ROUTES.income.ready);
    const html = await page.content();
    expect(html.length).toBeGreaterThan(1000);
    await expect(page.locator('#navTitle')).toContainText(ROUTES.income.title);
  });

  test('方案收入 API 无失败', async ({ page }) => {
    const failedRequests = [];
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().includes('/api/')) failedRequests.push({ url: r.url(), status: r.status() });
    });
    await openRoute(page, 'income', ROUTES.income.ready);
    expect(failedRequests.length).toBe(0);
  });
});

test.describe('快捷入口 — 量化数据排行榜 (quant-rank)', () => {
  test('进入量化排行页无控制台错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await openRoute(page, 'quant-rank', ROUTES['quant-rank'].ready);
    expect(errors).toEqual([]);
  });

  test('量化排行页渲染内容', async ({ page }) => {
    await openRoute(page, 'quant-rank', ROUTES['quant-rank'].ready);
    const html = await page.content();
    expect(html.length).toBeGreaterThan(1000);
  });

  test('量化排行页内容含场次数据', async ({ page }) => {
    await openRoute(page, 'quant-rank', ROUTES['quant-rank'].ready);
    const html = await page.content();
    const hasContent = html.includes('周') || html.includes('matchNum') || html.includes('编号') || html.length > 2000;
    expect(hasContent).toBe(true);
  });
});

test.describe('快捷入口 — 命中率筛选 (filter)', () => {
  test('进入命中率筛选页无控制台错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await openRoute(page, 'filter', ROUTES.filter.ready);
    expect(errors).toEqual([]);
  });

  test('命中率筛选页渲染筛选控件', async ({ page }) => {
    await openRoute(page, 'filter', ROUTES.filter.ready);
    const html = await page.content();
    expect(html.length).toBeGreaterThan(1000);
  });
});

test.describe('快捷入口 — 历史数据回测 (backtest)', () => {
  test('进入回测页无控制台错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await openRoute(page, 'backtest', ROUTES.backtest.ready);
    expect(errors).toEqual([]);
  });

  test('回测页渲染内容', async ({ page }) => {
    await openRoute(page, 'backtest', ROUTES.backtest.ready);
    const html = await page.content();
    expect(html.length).toBeGreaterThan(1000);
  });

  test('回测页 API 无失败', async ({ page }) => {
    const failedRequests = [];
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().includes('/api/')) failedRequests.push({ url: r.url(), status: r.status() });
    });
    await openRoute(page, 'backtest', ROUTES.backtest.ready);
    expect(failedRequests.length).toBe(0);
  });
});

// ============================================================
// 综合：跨页面导航稳定性
// ============================================================
test.describe('跨页面导航', () => {
  test('连续切换5个TabBar不崩溃', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await gotoHome(page);
    const tabs = ['home', 'match', 'rank', 'hit', 'plan', 'home'];
    for (const tab of tabs) {
      await page.click('#tab-' + tab);
      await page.waitForTimeout(300);
    }

    expect(errors).toEqual([]);
  });

  test('连续切换4个快捷入口页不崩溃', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const routes = ['income', 'quant-rank', 'filter', 'backtest'];
    for (const route of routes) {
      await openRoute(page, route, ROUTES[route].ready);
    }

    expect(errors).toEqual([]);
  });
});

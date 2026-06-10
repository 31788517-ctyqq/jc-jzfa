const { test, expect } = require('@playwright/test');
const budgets = require('./perf-budgets');

const ROUTE_READY = {
  home: '#page-home',
  match: '#page-match #matchList, #page-match',
  rank: '#page-rank #rankList, #page-rank',
  hit: '#page-hit #hitContent, #page-hit',
  plan: '#page-plan #planList, #page-plan',
  income: '#page-income #incomeResult, #page-income',
  'quant-rank': '#page-quant-rank #quantTableWrap, #page-quant-rank',
  filter: '#page-filter #filterResult, #page-filter',
  backtest: '#page-backtest #btTabRow, #page-backtest',
  scheme: '#page-scheme #schemeMatchList, #page-scheme',
  'model-dashboard': '#page-model-dashboard #model-dashboard-content, #page-model-dashboard',
  'data-health': '#page-data-health #data-health-content, #page-data-health',
  'confirm-scheme': '#page-confirm-scheme #confirmContent, #page-confirm-scheme',
};

async function gotoHome(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => typeof window.switchTab === 'function');
}

async function switchAndMeasure(page, route) {
  const start = Date.now();
  await page.evaluate((r) => window.switchTab(r), route);

  await page.waitForFunction(
    (r) => {
      const el = document.getElementById('page-' + r);
      return !!el && el.classList.contains('active');
    },
    route,
    { timeout: 15000 }
  );

  const selector = ROUTE_READY[route];
  if (selector) {
    await expect(page.locator(selector).first()).toBeVisible({ timeout: 15000 });
  }

  return Date.now() - start;
}

test.describe('E2E 性能预算 — 首页与路由切换', () => {
  test('首页导航性能不超过预算', async ({ page }) => {
    await gotoHome(page);

    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      if (!n) return null;
      return {
        ttfbMs: Math.round(n.responseStart),
        domContentLoadedMs: Math.round(n.domContentLoadedEventEnd),
        loadMs: Math.round(n.loadEventEnd),
      };
    });

    expect(nav).toBeTruthy();
    expect(nav.ttfbMs).toBeLessThanOrEqual(budgets.navigation.ttfbMs);
    expect(nav.domContentLoadedMs).toBeLessThanOrEqual(budgets.navigation.domContentLoadedMs);
    expect(nav.loadMs).toBeLessThanOrEqual(budgets.navigation.loadMs);
  });

  for (const route of Object.keys(budgets.routeSwitch)) {
    test(`路由 ${route} 切换耗时不超过预算`, async ({ page }) => {
      await gotoHome(page);
      const elapsed = await switchAndMeasure(page, route);
      test.info().annotations.push({ type: 'perf', description: `${route}: ${elapsed}ms` });
      expect(elapsed).toBeLessThanOrEqual(budgets.routeSwitch[route]);
    });
  }
});

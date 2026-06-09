const { test, expect } = require('@playwright/test');

function monitorRuntime(page) {
  const pageErrors = [];
  const apiFailures = [];
  const assetFailures = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    if (status < 400) return;

    if (url.includes('/api')) {
      apiFailures.push({ url, status });
      return;
    }

    if (/\.(css|js|png|svg|jpg|jpeg|gif|webp)(\?|$)/i.test(url) && !/favicon\.ico/i.test(url)) {
      assetFailures.push({ url, status });
    }
  });

  return { pageErrors, apiFailures, assetFailures };
}

async function openHome(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(function () {
    return typeof window.switchTab === 'function';
  });
}

async function openPlanPage(page) {
  await page.click('#tab-plan');
  await page.waitForTimeout(1200);
  await expect(page.locator('#planTabBar')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#planList')).toBeVisible({ timeout: 10000 });
}

async function switchPlanSubTab(page, tabId) {
  const tab = page.locator('#planTabBar .filter-tag[data-tab="' + tabId + '"]').first();
  await expect(tab).toBeVisible({ timeout: 10000 });
  await tab.click();
  await page.waitForTimeout(1200);
}

test.describe('关键业务链路', () => {
  test('今日方案可见标签页有卡片时都应带分享按钮', async ({ page }) => {
    const runtime = monitorRuntime(page);
    await openHome(page);
    await openPlanPage(page);

    for (const tabId of ['expert', 'my']) {
      await switchPlanSubTab(page, tabId);

      const planList = page.locator('#planList');
      const cardCount = await planList.locator('.plan-card').count();

      if (cardCount > 0) {
        const shareCount = await planList.locator('.plan-card .mp-share-btn').count();
        expect(shareCount).toBeGreaterThan(0);
        expect(shareCount).toBeGreaterThanOrEqual(cardCount);
      } else {
        await expect(planList).toContainText(/稍稍等|暂无|加载|方案/);
      }
    }

    expect(runtime.pageErrors).toEqual([]);
    expect(runtime.apiFailures).toEqual([]);
    expect(runtime.assetFailures).toEqual([]);
  });

  test('首页快捷入口与新增路由页面不应白屏', async ({ page }) => {
    const runtime = monitorRuntime(page);
    await openHome(page);

    const modelEntry = page.locator('[onclick*="switchTab(\'model-dashboard\')"]').first();
    await expect(modelEntry).toBeVisible({ timeout: 10000 });
    await modelEntry.click();
    await page.waitForTimeout(1200);
    await expect(page.locator('#model-dashboard-content')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#navTitle')).toHaveText('模型表现仪表板');

    await page.evaluate(function () {
      window.switchTab('home');
    });
    await page.waitForTimeout(800);

    const dataHealthEntry = page.locator('[onclick*="switchTab(\'data-health\')"]').first();
    await expect(dataHealthEntry).toBeVisible({ timeout: 10000 });
    await dataHealthEntry.click();
    await page.waitForTimeout(1200);
    await expect(page.locator('#data-health-content')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#navTitle')).toHaveText('数据健康监控');

    await page.evaluate(function () {
      window.switchTab('scheme');
    });
    await page.waitForTimeout(1200);
    await expect(page.locator('#schemeMatchList')).toBeVisible({ timeout: 10000 });

    await page.evaluate(function () {
      window.switchTab('confirm-scheme');
    });
    await page.waitForTimeout(1200);
    await expect(page.locator('#confirmContent')).toBeVisible({ timeout: 10000 });

    expect(runtime.pageErrors).toEqual([]);
    expect(runtime.apiFailures).toEqual([]);
    expect(runtime.assetFailures).toEqual([]);
  });
});

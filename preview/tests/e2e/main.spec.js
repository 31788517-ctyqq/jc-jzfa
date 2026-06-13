// ============================================================
// E2E: 首页 + 预测回测页
// ============================================================
const { test, expect } = require('@playwright/test');
const { ensureE2EAuth } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await ensureE2EAuth(page);
});

test.describe('首页', () => {
  test('首页正常加载', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);

    const html = await page.content();
    expect(html.length).toBeGreaterThan(200);
  });
});

test.describe('预测回测页', () => {
  test('预测页面正常加载', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/prediction.html?date=2026-05-31');
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
  });

  test('API 请求正常', async ({ page }) => {
    const failedRequests = [];

    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedRequests.push({
          url: response.url(),
          status: response.status(),
        });
      }
    });

    await page.goto('/prediction.html?date=2026-05-31');
    await page.waitForLoadState('networkidle');

    const apiFailures = failedRequests.filter((r) => r.url.includes('/api/'));
    expect(apiFailures).toEqual([]);
  });
});

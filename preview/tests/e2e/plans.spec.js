// ============================================================
// E2E: 量化方案页 (plans.html)
// ============================================================
const { test, expect } = require('@playwright/test');
const { ensureE2EAuth } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await ensureE2EAuth(page);
});

test.describe('量化方案页', () => {
  test('页面正常加载，无控制台错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/plans.html?date=2026-05-31');
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
  });

  test('页面包含关键 DOM 元素', async ({ page }) => {
    await page.goto('/plans.html?date=2026-05-31');
    await page.waitForLoadState('networkidle');

    // 验证核心容器存在
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // 不应出现空白页
    const html = await page.content();
    expect(html.length).toBeGreaterThan(500);
  });

  test('API 请求返回正常状态码', async ({ page }) => {
    const failedRequests = [];

    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedRequests.push({
          url: response.url(),
          status: response.status(),
        });
      }
    });

    await page.goto('/plans.html?date=2026-05-31');
    await page.waitForLoadState('networkidle');

    // 核心 API 不应 4xx/5xx
    const apiFailures = failedRequests.filter((r) => r.url.includes('/api/'));
    expect(apiFailures).toEqual([]);
  });
});

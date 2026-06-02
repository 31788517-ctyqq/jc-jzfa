// ============================================================
// E2E: 功守道页面 (gongshoudao.html)
// ============================================================
const { test, expect } = require('@playwright/test');

test.describe('功守道页面', () => {
  test('页面正常加载，无控制台错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/gongshoudao.html');
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
  });

  test('核心组件容器存在', async ({ page }) => {
    await page.goto('/gongshoudao.html');
    await page.waitForLoadState('networkidle');

    const body = page.locator('body');
    await expect(body).toBeVisible();

    const html = await page.content();
    expect(html.length).toBeGreaterThan(500);
  });

  test('功守道 API 请求正常', async ({ page }) => {
    const failedRequests = [];

    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedRequests.push({
          url: response.url(),
          status: response.status(),
        });
      }
    });

    await page.goto('/gongshoudao.html');
    await page.waitForLoadState('networkidle');

    const apiFailures = failedRequests.filter((r) => r.url.includes('/api/'));
    expect(apiFailures).toEqual([]);
  });

  test('页面 title 不为空', async ({ page }) => {
    await page.goto('/gongshoudao.html');
    await page.waitForLoadState('networkidle');

    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});

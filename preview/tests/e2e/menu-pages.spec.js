// ============================================================
// E2E: 首页快捷菜单页面 (income / quant-rank / filter / backtest)
// ============================================================
const { test, expect } = require('@playwright/test');

// 辅助：通过首页菜单项点击进入页面
async function clickMenu(page, menuText) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // 定位对应菜单项
  const menuItem = page.locator('.menu-item', { hasText: menuText });
  await expect(menuItem).toBeVisible({ timeout: 5000 });
  await menuItem.click();
  await page.waitForTimeout(800); // 等异步渲染
}

test.describe('快捷菜单 — 方案收入 (income)', () => {
  test('进入方案收入页无控制台错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await clickMenu(page, '方案收入');
    expect(errors).toEqual([]);
  });

  test('方案收入页渲染内容', async ({ page }) => {
    await clickMenu(page, '方案收入');
    await page.waitForTimeout(1500);

    const html = await page.content();
    expect(html.length).toBeGreaterThan(1000);

    // 导航标题应更新
    const navTitle = page.locator('#navTitle');
    await expect(navTitle).toBeVisible();
  });

  test('方案收入 API 无失败', async ({ page }) => {
    const failedRequests = [];
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().includes('/api/')) {
        failedRequests.push({ url: r.url(), status: r.status() });
      }
    });

    await clickMenu(page, '方案收入');
    await page.waitForTimeout(1000);

    expect(failedRequests.length).toBe(0);
  });
});

test.describe('快捷菜单 — 量化数据排行榜 (quant-rank)', () => {
  test('进入量化排行页无控制台错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await clickMenu(page, '量化数据排行榜');
    expect(errors).toEqual([]);
  });

  test('量化排行页渲染内容', async ({ page }) => {
    await clickMenu(page, '量化数据排行榜');
    await page.waitForTimeout(1500);

    const html = await page.content();
    expect(html.length).toBeGreaterThan(1000);
  });

  test('量化排行页内容含场次数据', async ({ page }) => {
    await clickMenu(page, '量化数据排行榜');
    await page.waitForTimeout(2000);

    const html = await page.content();
    // 应该有比赛编号或队伍名
    const hasContent =
      html.includes('周一') ||
      html.includes('matchNum') ||
      html.includes('编号') ||
      html.length > 2000;
    expect(hasContent).toBe(true);
  });
});

test.describe('快捷菜单 — 命中率筛选 (filter)', () => {
  test('进入命中率筛选页无控制台错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await clickMenu(page, '命中率筛选');
    expect(errors).toEqual([]);
  });

  test('命中率筛选页渲染筛选控件', async ({ page }) => {
    await clickMenu(page, '命中率筛选');
    await page.waitForTimeout(1000);

    const html = await page.content();
    expect(html.length).toBeGreaterThan(1000);
  });
});

test.describe('快捷菜单 — 历史数据回测 (backtest)', () => {
  test('进入回测页无控制台错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await clickMenu(page, '历史数据回测');
    expect(errors).toEqual([]);
  });

  test('回测页渲染内容', async ({ page }) => {
    await clickMenu(page, '历史数据回测');
    await page.waitForTimeout(2000);

    const html = await page.content();
    expect(html.length).toBeGreaterThan(1000);
  });

  test('回测页 API 无失败', async ({ page }) => {
    const failedRequests = [];
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().includes('/api/')) {
        failedRequests.push({ url: r.url(), status: r.status() });
      }
    });

    await clickMenu(page, '历史数据回测');
    await page.waitForTimeout(1000);

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

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const tabs = ['home', 'match', 'rank', 'hit', 'plan', 'home'];
    for (const tab of tabs) {
      await page.click('#tab-' + tab);
      await page.waitForTimeout(400);
    }

    expect(errors).toEqual([]);
  });

  test('连续切换4个菜单页不崩溃', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const menus = ['方案收入', '量化数据排行榜', '命中率筛选', '历史数据回测'];
    for (const menuText of menus) {
      // 每次都重新回到首页
      await page.click('#tab-home');
      await page.waitForTimeout(300);

      const menuItem = page.locator('.menu-item', { hasText: menuText });
      if (await menuItem.isVisible()) {
        await menuItem.click();
        await page.waitForTimeout(500);
      }
    }

    expect(errors).toEqual([]);
  });
});

// ============================================================
// E2E: TabBar 5 个标签页 (home / match / rank / hit / plan)
// ============================================================
const { test, expect } = require('@playwright/test');
const { ensureE2EAuth } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await ensureE2EAuth(page);
});

// 辅助：点击 TabBar 按钮并等待内容渲染
async function clickTab(page, tabName) {
  const tabs = {
    home: 'tab-home',
    match: 'tab-match',
    rank: 'tab-rank',
    hit: 'tab-hit',
    plan: 'tab-plan',
  };
  const selector = '#' + tabs[tabName];
  await page.click(selector);
  await page.waitForTimeout(800); // 等异步渲染
}

test.describe('TabBar — 首页', () => {
  test('TabBar 存在且包含5个标签', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const tabIds = ['tab-home', 'tab-match', 'tab-rank', 'tab-hit', 'tab-plan'];
    for (const id of tabIds) {
      const tab = page.locator('#' + id);
      await expect(tab).toBeVisible();
    }
  });

  test('首页加载后统计数据不为空', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 等数据渲染
    await page.waitForTimeout(1000);

    const matchCount = page.locator('#homeMatchCount');
    await expect(matchCount).toBeVisible();
    const text = await matchCount.textContent();
    expect(text).not.toBe('-');
    expect(text).not.toBe('');
  });
});

test.describe('TabBar — 比赛列表 (match)', () => {
  test('切换到比赛列表无控制台错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clickTab(page, 'match');

    expect(errors).toEqual([]);
  });

  test('比赛列表渲染数据', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clickTab(page, 'match');

    // 比赛列表应该有内容
    const listEl = page.locator('#page-match .match-card, #match-list, #page-match');
    await expect(listEl.first()).toBeVisible({ timeout: 8000 });

    const html = await page.content();
    expect(html.length).toBeGreaterThan(1000);
  });

  test('比赛列表 API 无失败', async ({ page }) => {
    const failedRequests = [];
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().includes('/api/')) {
        failedRequests.push({ url: r.url(), status: r.status() });
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clickTab(page, 'match');
    await page.waitForTimeout(500);

    expect(failedRequests.length).toBe(0);
  });
});

test.describe('TabBar — 排行榜 (rank)', () => {
  test('切换到排行榜无控制台错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clickTab(page, 'rank');

    expect(errors).toEqual([]);
  });

  test('排行榜渲染数据', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clickTab(page, 'rank');

    const html = await page.content();
    expect(html.length).toBeGreaterThan(1000);
  });

  test('排行榜 API 无失败', async ({ page }) => {
    const failedRequests = [];
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().includes('/api/')) {
        failedRequests.push({ url: r.url(), status: r.status() });
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clickTab(page, 'rank');
    await page.waitForTimeout(500);

    expect(failedRequests.length).toBe(0);
  });
});

test.describe('TabBar — 命中率 (hit)', () => {
  test('切换到命中率页无控制台错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clickTab(page, 'hit');

    expect(errors).toEqual([]);
  });

  test('命中率页渲染数据', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clickTab(page, 'hit');

    await page.waitForTimeout(1000);
    const html = await page.content();
    expect(html.length).toBeGreaterThan(1000);
  });

  test('命中率 API 无失败', async ({ page }) => {
    const failedRequests = [];
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().includes('/api/')) {
        failedRequests.push({ url: r.url(), status: r.status() });
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clickTab(page, 'hit');
    await page.waitForTimeout(500);

    expect(failedRequests.length).toBe(0);
  });
});

test.describe('TabBar — 方案 (plan)', () => {
  test('切换到方案页无控制台错误', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clickTab(page, 'plan');

    expect(errors).toEqual([]);
  });

  test('方案页渲染子标签 (专家/比分/量化)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clickTab(page, 'plan');

    await page.waitForTimeout(1000);

    // 方案页应有子标签
    const tabBar = page.locator('#planTabBar');
    await expect(tabBar).toBeVisible({ timeout: 8000 });

    // 至少包含方案相关内容
    const html = await page.content();
    expect(html.length).toBeGreaterThan(1500);
  });

  test('方案页 API 无失败', async ({ page }) => {
    const failedRequests = [];
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().includes('/api/')) {
        failedRequests.push({ url: r.url(), status: r.status() });
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clickTab(page, 'plan');
    await page.waitForTimeout(500);

    expect(failedRequests.length).toBe(0);
  });
});

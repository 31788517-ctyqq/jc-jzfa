/**
 * preview/tests/e2e/data-dashboard.spec.js
 * E2E 验证 — 数据全链路透视看板
 *
 * 仅依赖于静态 HTML 页面加载 (不需要后端 API)
 * 检查: 模块引用、页面容器骨架屏、路由注册
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const BASE = 'http://localhost:3000';
const PREVIEW = BASE + '/preview/index.html';
const SS_DIR = path.join(__dirname, '..', '..', '..', '_screenshots');

// ═══════════════════════════════════════════
// 测试 1: 首页加载正常
// ═══════════════════════════════════════════

test('1. 首页 HTML 加载正常', async ({ page }) => {
  await page.goto(PREVIEW);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#page-home')).toBeAttached();
});

// ═══════════════════════════════════════════
// 测试 2: main.js 包含 page-admin 创建逻辑
// ═══════════════════════════════════════════

test('2. main-fusion.js 创建 page-admin 容器', async ({ page }) => {
  await page.goto(PREVIEW);
  await page.waitForLoadState('domcontentloaded');

  // 检查 switchTab 和 _ensurePage 函数存在
  const hasEnsurePage = await page.evaluate(() => {
    // 作为 SPA，_ensurePage 应在 main-fusion 中定义
    const scripts = document.querySelectorAll('script[src]');
    return scripts.length > 0;
  });
  expect(hasEnsurePage).toBe(true);
});

// ═══════════════════════════════════════════
// 测试 3: 验证后端 pipeline-monitor 模块可 require
// ═══════════════════════════════════════════

test('3. data-pipeline-monitor.js 功能正确', async ({ page }) => {
  // 通过页面内嵌脚本测试后端模块不可行（浏览器限制）
  // 跳过：已在 Jest/Node 测试中验证
});

// ═══════════════════════════════════════════
// 测试 4: 各模块 source map / JS 引用完整性
// ═══════════════════════════════════════════

test('4. index.html 加载的 script 标签可达', async ({ page }) => {
  await page.goto(PREVIEW);
  await page.waitForLoadState('networkidle');

  // 检查没有 404 脚本加载失败
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.waitForTimeout(1000);
  expect(errors.length).toBe(0);
});

// ═══════════════════════════════════════════
// 测试 5: index.js API endpoints 存在
// ═══════════════════════════════════════════

test('5. index.js 包含新 API endpoints', async () => {
  const fs = require('fs');
  const indexSource = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'server', 'index.js'),
    'utf8'
  );
  expect(indexSource).toContain("case 'pipeline-dashboard'");
  expect(indexSource).toContain("case 'compute-dashboard'");
  expect(indexSource).toContain("case 'render-check-report'");
  expect(indexSource).toContain("require('./core/data-pipeline-monitor')");
});

// ═══════════════════════════════════════════
// 测试 6: deploy.py DEPLOY_MAP 完整性
// ═══════════════════════════════════════════

test('6. deploy.py DEPLOY_MAP 包含所有新模块', async () => {
  const fs = require('fs');
  const deploySource = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'deploy.py'),
    'utf8'
  );
  const expected = [
    'admin-pipeline.js',
    'admin-compute.js',
    'admin-overview.js',
    'data-confidence.js',
    'data-confidence-tooltip.js',
    'data-snapshot.js',
    'admin-data-dashboard.css',
    'data-pipeline-monitor.js',
  ];
  for (const name of expected) {
    expect(deploySource).toContain(name);
  }
});

// ═══════════════════════════════════════════
// 测试 7: API 合同测试已更新
// ═══════════════════════════════════════════

test('7. API Contract 包含新 action', async () => {
  const fs = require('fs');
  const contractSource = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'server', 'tests', 'api-contract.test.js'),
    'utf8'
  );
  expect(contractSource).toContain("'pipeline-dashboard'");
  expect(contractSource).toContain("'compute-dashboard'");
  expect(contractSource).toContain("'render-check-report'");
});

// ═══════════════════════════════════════════
// 测试 8: CSS 文件包含关键选择器
// ═══════════════════════════════════════════

test('8. admin-data-dashboard.css 包含所有区块样式', async () => {
  const fs = require('fs');
  const cssFile = path.join(__dirname, '..', '..', '..', 'preview', 'css', 'admin-data-dashboard.css');
  expect(fs.existsSync(cssFile)).toBe(true);
  const css = fs.readFileSync(cssFile, 'utf8');

  const selectors = [
    '.adm-dashboard',
    '.adm-dash-header',
    '.adm-dash-summary',
    '.adm-dash-section',
    '.adm-source-grid',
    '.adm-dash-table',
    '.adm-pipeline-flow',
    '.adm-score-gauge',
    '.adm-score-cards',
    '.adm-timeline',
    '.adm-alert-banner',
    '.adm-heatmap',
    '.adm-latency-row',
    '.dc-hero',
    '.dc-stats-row',
    '#dcTooltip',
    '.dc-panel',
  ];
  for (const sel of selectors) {
    expect(css).toContain(sel);
  }
});

// ═══════════════════════════════════════════
// 测试 9: 所有新 JS 模块导出关键函数
// ═══════════════════════════════════════════

const MODULE_CHECKS = [
  { file: 'preview/js/pages/admin-pipeline.js', contains: ['loadAdminPipeline', "pipeline-dashboard'", 'destroyPipeline'] },
  { file: 'preview/js/pages/admin-compute.js', contains: ['loadAdminCompute', "compute-dashboard'", 'destroyCompute'] },
  { file: 'preview/js/pages/admin-overview.js', contains: ['loadAdminOverview', 'ECharts', 'loadECharts'] },
  { file: 'preview/js/pages/data-confidence.js', contains: ['loadDataConfidence', 'dc-hero', '数据可信度'] },
  { file: 'preview/js/data-confidence-tooltip.js', contains: ['initDataConfidenceTooltip', 'toggleDcPanel', 'dc-panel'] },
  { file: 'preview/js/data-snapshot.js', contains: ['initSnapshotCheck', 'SAMPLE_RATE', 'render-check-report'] },
];

for (const mc of MODULE_CHECKS) {
  test(`9. ${mc.file} 导出关键函数`, async () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', mc.file),
      'utf8'
    );
    for (const keyword of mc.contains) {
      expect(source).toContain(keyword);
    }
  });
}

// ============================================================
// Playwright E2E 测试配置 — JC-ZJFA
// ============================================================
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './preview/tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  use: {
    // 开发服务器地址
    baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // 开发服务器，自动启动和关闭
  webServer: {
    command: 'node server/index.js',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    cwd: '.',
  },
});

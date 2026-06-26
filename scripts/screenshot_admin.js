const pw = require('playwright');

(async () => {
  const browser = await pw.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  const SS = 'e:/JC-ZJFA/_screenshots';

  try {
    // 1. 打开首页
    await page.goto('http://127.0.0.1:3000/preview/index.html');
    await page.waitForLoadState('networkidle');

    // 2. 清除旧session并登录
    await page.evaluate(() => {
      localStorage.removeItem('auth_session');
      localStorage.removeItem('auth_token');
    });
    await page.evaluate(() => window.switchTab('login'));
    await page.waitForSelector('#loginUser');
    await page.fill('#loginUser', 'ctyqq');
    await page.fill('#loginPass', '31788517');
    await page.click('#loginBtn');
    await page.waitForTimeout(3000);

    // 3. 关闭可能的弹窗覆盖层
    await page.evaluate(() => {
      // 关闭VIP欢迎弹窗
      var overlays = document.querySelectorAll('.vip-welcome-overlay, .gift-popup, .modal-overlay');
      overlays.forEach(function(o) { o.style.display = 'none'; });
    });

    // 4. 进入管理后台
    await page.evaluate(() => window.switchTab('admin'));
    await page.waitForTimeout(2000);

    // 5. 再次关闭可能的弹窗
    await page.evaluate(() => {
      var overlays = document.querySelectorAll('.vip-welcome-overlay, .gift-popup, .modal-overlay, [style*=\"fixed\"]');
      overlays.forEach(function(o) {
        if (o.style.zIndex > 900 || o.className.includes('overlay') || o.className.includes('popup')) {
          o.style.display = 'none';
        }
      });
    });

    // 6. 截图admin页面 (默认users Tab)
    await page.screenshot({ path: SS + '/admin_7tabs_full.png', fullPage: true });

    // 7. 截图Tab栏
    await page.screenshot({ path: SS + '/admin_7tabs_bar.png', clip: { x: 0, y: 180, width: 430, height: 100 } });

    // 8. 用 evaluate 点击Tab并截图
    async function clickTabAndScreenshot(tabKey, filename) {
      await page.evaluate(function(k) {
        // 关闭覆盖层
        document.querySelectorAll('[style*=\"fixed\"]').forEach(function(o) {
          if (o.style.zIndex > 900) o.style.display = 'none';
        });
        // 点击Tab
        var tab = document.querySelector('.adm-tab[data-tab=\"' + k + '\"]');
        if (tab) tab.click();
      }, tabKey);
      await page.waitForTimeout(2000);
      await page.screenshot({ path: SS + '/' + filename, fullPage: true });
    }

    await clickTabAndScreenshot('pipeline', 'tab5_pipeline.png');
    await clickTabAndScreenshot('compute', 'tab6_compute.png');
    await clickTabAndScreenshot('overview', 'tab7_overview.png');

    console.log('Screenshots saved to _screenshots/:');
    console.log('  admin_7tabs_full.png - admin page with 7 tabs');
    console.log('  admin_7tabs_bar.png - tab bar closeup');
    console.log('  tab5_pipeline.png - data collection dashboard');
    console.log('  tab6_compute.png - compute pipeline dashboard');
    console.log('  tab7_overview.png - quality overview dashboard');

  } catch (e) {
    console.log('ERROR:', e.message);
    await page.screenshot({ path: SS + '/error.png' });
  }

  await browser.close();
})();

const pw = require('playwright');
(async () => {
  const browser = await pw.chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // 1. 打开首页
    await page.goto('http://127.0.0.1:3000/preview/index.html');
    await page.waitForLoadState('networkidle');
    console.log('1. 首页已加载');

    // 2. 清除 localStorage 中可能存在的旧 session
    await page.evaluate(() => {
      localStorage.removeItem('auth_session');
      localStorage.removeItem('auth_token');
    });
    console.log('2. 已清除旧 session');

    // 3. 切到登录页
    await page.evaluate(() => window.switchTab('login'));
    await page.waitForSelector('#loginUser');
    console.log('3. 登录页已显示');

    // 4. 填写登录
    await page.fill('#loginUser', 'ctyqq');
    await page.fill('#loginPass', '31788517');
    console.log('4. 已填写凭证');

    // 5. 监听网络请求
    let loginResp = null;
    page.on('response', function(resp) {
      if (resp.url().includes('/api') && resp.request().postData()) {
        loginResp = resp;
      }
    });

    await page.click('#loginBtn');
    console.log('5. 已点击登录');

    // 6. 等待响应
    await page.waitForTimeout(4000);

    // 7. 检查 session
    const sessionRaw = await page.evaluate(() => localStorage.getItem('auth_session'));
    const session = sessionRaw ? JSON.parse(sessionRaw) : null;
    if (session) {
      console.log('6. Session roles:', JSON.stringify(session.roles));
      console.log('6. Session perms(前3):', JSON.stringify((session.permissions||[]).slice(0,3)));
      console.log('6. perms has data_health:', (session.permissions||[]).indexOf('dashboard:data_health_view') >= 0);
    } else {
      console.log('6. NO session stored!');
      // 检查页面错误
      const bodyText = await page.evaluate(() => document.body.textContent.substring(0, 300));
      console.log('6. Body:', bodyText);
    }

    // 8. 检查当前活跃页面
    const activePage = await page.evaluate(() => {
      var el = document.querySelector('.page.active');
      return el ? el.id : 'NONE';
    });
    console.log('7. Active page:', activePage);

    // 9. 尝试进入管理后台
    if (session) {
      await page.evaluate(() => window.switchTab('admin'));
      await page.waitForTimeout(3000);

      // 10. 检查admin页面DOM
      const hasAdmin = await page.evaluate(() => {
        var el = document.getElementById('page-admin');
        return el ? true : false;
      });
      console.log('8. page-admin 存在:', hasAdmin);

      // 11. 检查Tabs
      const tabs = await page.evaluate(() => {
        var els = document.querySelectorAll('#admTabs .adm-tab');
        return Array.from(els).map(function(e) {
          return e.getAttribute('data-tab') + ':' + e.textContent.trim();
        });
      });
      console.log('9. Tab数量:', tabs.length);
      console.log('9. Tabs:', JSON.stringify(tabs));

      // 12. 检查 admin-panel 中是否有 skeleton
      const panelHtml = await page.evaluate(() => {
        var el = document.getElementById('admPanel');
        return el ? el.innerHTML.substring(0, 500) : 'NO PANEL';
      });
      console.log('10. Panel HTML(截取):', panelHtml);
    }

  } catch(e) {
    console.log('ERROR:', e.message);
  }

  await browser.close();
  console.log('\n=== 完成 ===');
})();

/**
 * 邮件告警测试脚本
 * 用法: node server/test_alert.js
 * 
 * 前置条件:
 *   1. 在 server/.env 中配置 ALERT_SMTP_USER 和 ALERT_SMTP_PASS
 *   2. QQ邮箱需在设置中开启 SMTP 服务并获取授权码（16位）
 *      设置路径: QQ邮箱 → 设置 → 账户 → POP3/IMAP/SMTP服务 → 开启 → 生成授权码
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const alert = require('./alert');

(async () => {
  console.log('═══════════════════════════════════');
  console.log('  邮件告警系统 — 连通性测试');
  console.log('═══════════════════════════════════');

  // 检查配置
  const user = process.env.ALERT_SMTP_USER;
  const pass = process.env.ALERT_SMTP_PASS;
  const recipient = process.env.ALERT_RECIPIENT || '31788517@qq.com';

  if (!user || !pass) {
    console.log('\n[错误] 未配置发件人信息！');
    console.log('请在 server/.env 中添加：');
    console.log('  ALERT_SMTP_USER=your_qq_email@qq.com');
    console.log('  ALERT_SMTP_PASS=your_smtp_authorization_code');
    console.log('\n获取QQ邮箱SMTP授权码步骤：');
    console.log('  1. 登录QQ邮箱 → 设置 → 账户');
    console.log('  2. 找到"POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务"');
    console.log('  3. 开启"IMAP/SMTP服务"或"POP3/SMTP服务"');
    console.log('  4. 按提示发送短信 → 获取16位授权码');
    console.log('  5. 将授权码填入 ALERT_SMTP_PASS');
    process.exit(1);
  }

  console.log('  发件人: ' + user);
  console.log('  收件人: ' + recipient);
  console.log('');

  // 测试 SMTP 连接
  console.log('[1/3] 测试 SMTP 连接...');
  const result = await alert.test();

  if (result) {
    console.log('✅ SMTP 连接成功！');
  } else {
    console.log('❌ SMTP 连接失败，请检查：');
    console.log('  - ALERT_SMTP_USER 是否为完整QQ邮箱地址');
    console.log('  - ALERT_SMTP_PASS 是否为16位SMTP授权码（非QQ密码）');
    console.log('  - 服务器防火墙是否允许 465 端口出站');
    process.exit(1);
  }

  // 发送测试告警
  console.log('[2/3] 发送测试告警邮件...');
  const sent = await alert.general('info', '告警系统测试', 
    '<p>这是一封自动发送的测试邮件。</p>'
    + '<ul>'
    + '<li>系统: JC-ZJFA 竞彩监控</li>'
    + '<li>时间: ' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + '</li>'
    + '<li>状态: 告警系统已成功配置</li>'
    + '</ul>'
    + '<p style="color:#4CAF50;"><b>✅ 配置验证通过</b></p>'
    + '<p>从现在起，当以下事件发生时您将收到告警邮件：</p>'
    + '<ol>'
    + '<li>爬虫连续失败3次</li>'
    + '<li>米斗数据登录失败</li>'
    + '<li>data.json 数据异常</li>'
    + '<li>AI 分析引擎故障</li>'
    + '<li>定时任务守护进程异常退出</li>'
    + '</ol>'
  );

  if (sent) {
    console.log('✅ 测试邮件已发送，请检查收件箱！');
  } else {
    console.log('❌ 测试邮件发送失败');
  }

  console.log('[3/3] 测试完成');
})();

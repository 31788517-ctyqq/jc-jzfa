#!/usr/bin/env node
/**
 * scripts/watchdog.cjs — PM2 进程存活监控 + 自动恢复
 *
 * 用途: cron 每 5 分钟运行一次，检查 3 个必需进程是否全部在线
 *      缺失时尝试自动启动，并发送告警
 *
 * 用法: node scripts/watchdog.cjs
 * cron:  */5 * * * * cd /root/server && node scripts/watchdog.cjs >> /root/.pm2/logs/watchdog.log 2>&1
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ═══ 配置 ═══
const REQUIRED_PROCS = ['jc-zjfa', 'jc-sync', 'jc-scheduler'];
const ALERT_ENABLED = process.env.ALERT_ENABLED === 'true';
const ALERT_RECIPIENT = process.env.ALERT_RECIPIENT || '';
const ALERT_SMTP_HOST = process.env.ALERT_SMTP_HOST || 'smtp.qq.com';
const ALERT_SMTP_PORT = parseInt(process.env.ALERT_SMTP_PORT || '465', 10);
const ALERT_SMTP_USER = process.env.ALERT_SMTP_USER || '';
const ALERT_SMTP_PASS = process.env.ALERT_SMTP_PASS || '';

const LOG_FILE = '/root/.pm2/logs/watchdog.log';

function log(msg) {
  const ts = new Date().toISOString();
  const line = '[' + ts + '] [watchdog] ' + msg;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
}

// ═══ 邮件告警 ═══
function sendAlert(subject, body) {
  if (!ALERT_ENABLED || !ALERT_RECIPIENT) {
    log('告警未启用或无收件人，跳过邮件发送');
    return;
  }
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: ALERT_SMTP_HOST,
      port: ALERT_SMTP_PORT,
      secure: ALERT_SMTP_PORT === 465,
      auth: { user: ALERT_SMTP_USER, pass: ALERT_SMTP_PASS },
    });
    transporter.sendMail({
      from: ALERT_SMTP_USER,
      to: ALERT_RECIPIENT,
      subject: '[JC-ZJFA 看门狗] ' + subject,
      text: body,
    });
    log('告警邮件已发送: ' + subject);
  } catch (e) {
    log('邮件发送失败: ' + e.message);
  }
}

// ═══ 主逻辑 ═══
try {
  let pm2Out;
  try {
    pm2Out = execSync('pm2 jlist 2>/dev/null', { timeout: 10000, encoding: 'utf8' });
  } catch (_) {
    log('PM2 不可用，尝试恢复...');
    // PM2 daemon 可能挂了
    try {
      execSync('pm2 resurrect 2>/dev/null', { timeout: 15000 });
      pm2Out = execSync('pm2 jlist 2>/dev/null', { timeout: 10000, encoding: 'utf8' });
      log('PM2 已复活');
    } catch (e2) {
      log('PM2 复活失败: ' + e2.message);
      sendAlert('PM2 Daemon 已死', 'watchdog 无法启动 PM2 daemon。请 SSH 手动检查。\n错误: ' + e2.message);
      process.exit(1);
    }
  }

  const pm2List = JSON.parse(pm2Out);
  const runningNames = pm2List.filter(function (p) { return p.status === 'online'; }).map(function (p) { return p.name; });
  const missingProcs = REQUIRED_PROCS.filter(function (n) { return runningNames.indexOf(n) === -1; });

  if (missingProcs.length === 0) {
    // 所有进程正常 — 静默退出
    process.exit(0);
  }

  // 有进程缺失 — 尝试恢复
  log('检测到缺失进程: ' + missingProcs.join(', ') + ' — 尝试自动恢复');
  try {
    const cwd = process.env.WATCHDOG_CWD || '/root/server';
    execSync('cd ' + cwd + ' && pm2 start ecosystem.config.json --only ' + missingProcs.join(','), {
      timeout: 30000,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    log('自动恢复成功: ' + missingProcs.join(', '));
    sendAlert(
      '进程自动恢复',
      '以下缺失进程已自动恢复:\n' +
        missingProcs.join('\n') +
        '\n\n时间: ' +
        new Date().toISOString()
    );
  } catch (e) {
    log('自动恢复失败: ' + e.message);
    sendAlert(
      '进程缺失 - 自动恢复失败',
      '以下进程缺失且自动恢复失败:\n' +
        missingProcs.join('\n') +
        '\n\n错误: ' +
        e.message +
        '\n时间: ' +
        new Date().toISOString() +
        '\n\n请 SSH 手动检查: ssh root@119.23.51.159'
    );
  }

  process.exit(missingProcs.length > 0 ? 1 : 0);
} catch (e) {
  log('watchdog 异常: ' + e.message);
  sendAlert('Watchdog 异常', 'watchdog 自身运行异常:\n' + e.message + '\n时间: ' + new Date().toISOString());
  process.exit(2);
}

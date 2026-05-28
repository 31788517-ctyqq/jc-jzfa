/**
 * 邮件告警模块
 * 
 * 当爬虫/API/定时任务发生关键错误时，自动发送邮件通知
 * 
 * 配置 (server/.env):
 *   ALERT_SMTP_HOST    — SMTP 服务器（默认 smtp.qq.com）
 *   ALERT_SMTP_PORT    — SMTP 端口（默认 465）
 *   ALERT_SMTP_USER    — 发件邮箱地址
 *   ALERT_SMTP_PASS    — QQ邮箱授权码（非登录密码）
 *   ALERT_RECIPIENT    — 收件人邮箱（默认 31788517@qq.com）
 *   ALERT_ENABLED      — 是否启用告警（默认 true）
 */

const nodemailer = require('nodemailer');
const os = require('os');

// ═══ 配置 ═══
const SMTP_HOST = process.env.ALERT_SMTP_HOST || 'smtp.qq.com';
const SMTP_PORT = parseInt(process.env.ALERT_SMTP_PORT || '465', 10);
const SMTP_USER = process.env.ALERT_SMTP_USER || '';
const SMTP_PASS = process.env.ALERT_SMTP_PASS || '';
const RECIPIENT = process.env.ALERT_RECIPIENT || '31788517@qq.com';
const ENABLED = process.env.ALERT_ENABLED !== 'false';

// ═══ 创建 transporter（懒加载） ═══
let transporter = null;
let initError = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_USER || !SMTP_PASS) {
    initError = 'ALERT_SMTP_USER 或 ALERT_SMTP_PASS 未配置';
    console.warn('[alert] ' + initError + '，告警功能已禁用');
    return null;
  }
  try {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    console.log('[alert] 邮件告警已就绪，发件: ' + SMTP_USER + ' → 收件: ' + RECIPIENT);
    return transporter;
  } catch (e) {
    initError = e.message;
    console.warn('[alert] 初始化失败: ' + e.message);
    return null;
  }
}

// ═══ 核心发送函数 ═══
async function sendMail(subject, bodyHtml) {
  if (!ENABLED) return false;
  const tp = getTransporter();
  if (!tp) return false;

  const serverInfo = os.hostname() + ' (' + (process.env.NODE_ENV || 'dev') + ')';
  const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  try {
    await tp.sendMail({
      from: '"JC-ZJFA 监控" <' + SMTP_USER + '>',
      to: RECIPIENT,
      subject: '[' + serverInfo + '] ' + subject,
      html: '<div style="font-family:Microsoft YaHei,sans-serif;padding:16px;max-width:600px;">'
        + '<h3 style="color:#C20003;margin:0 0 12px;">' + subject + '</h3>'
        + '<p style="color:#666;margin:0 0 16px;font-size:13px;">' + timeStr + ' | ' + serverInfo + '</p>'
        + bodyHtml
        + '<hr style="border:none;border-top:1px solid #eee;margin:20px 0 0;">'
        + '<p style="color:#999;font-size:11px;">此邮件由 JC-ZJFA 竞彩监控系统自动发送，请勿回复。</p>'
        + '</div>'
    });
    console.log('[alert] 邮件已发送: ' + subject);
    return true;
  } catch (e) {
    console.error('[alert] 发送失败: ' + e.message);
    return false;
  }
}

// ═══ 告警类型 ═══

/** 爬取失败告警 */
async function crawlFailed(errorMsg, context) {
  const html = '<table style="border-collapse:collapse;width:100%;">'
    + '<tr><td style="padding:8px 12px;background:#FFF5F5;border-left:3px solid #C20003;"><b>错误信息</b></td>'
    + '<td style="padding:8px 12px;background:#FFF5F5;">' + escapeHtml(errorMsg) + '</td></tr>'
    + (context ? '<tr><td style="padding:8px 12px;border-left:3px solid #eee;"><b>上下文</b></td>'
    + '<td style="padding:8px 12px;">' + escapeHtml(context) + '</td></tr>' : '')
    + '</table>';
  return sendMail('⚠ 爬取异常 - ' + errorMsg.slice(0, 40), html);
}

/** 登录失败告警 */
async function loginFailed(errorMsg) {
  const html = '<p style="color:#F44336;">登录米斗数据失败，爬虫无法获取数据。</p>'
    + '<p><b>错误:</b> ' + escapeHtml(errorMsg) + '</p>'
    + '<p style="color:#666;">请检查 MIDOU_MOBILE / MIDOU_PASSWORD 是否正确，或米斗平台是否可访问。</p>';
  return sendMail('🔴 登录失败 - 米斗数据', html);
}

/** 数据异常告警 */
async function dataAnomaly(description, detail) {
  const html = '<p style="color:#FF9800;">数据文件出现异常，可能影响服务正常使用。</p>'
    + '<p><b>描述:</b> ' + escapeHtml(description) + '</p>'
    + (detail ? '<pre style="background:#f5f5f5;padding:12px;border-radius:4px;overflow:auto;">' + escapeHtml(detail) + '</pre>' : '');
  return sendMail('⚡ 数据异常 - ' + description.slice(0, 40), html);
}

/** AI 分析失败告警 */
async function aiFailed(errorMsg, matchInfo) {
  const html = '<p>AI 深度分析（DeepSeek + 豆包）执行失败。</p>'
    + '<p><b>比赛:</b> ' + escapeHtml(matchInfo || '未知') + '</p>'
    + '<p><b>错误:</b> ' + escapeHtml(errorMsg) + '</p>';
  return sendMail('🤖 AI分析失败 - ' + (matchInfo || '').slice(0, 30), html);
}

/** 定时任务异常告警 */
async function schedulerFailed(taskName, errorMsg) {
  const html = '<p>定时任务执行异常，可能影响数据同步。</p>'
    + '<p><b>任务:</b> ' + escapeHtml(taskName) + '</p>'
    + '<p><b>错误:</b> ' + escapeHtml(errorMsg) + '</p>';
  return sendMail('⏰ 定时任务失败 - ' + taskName, html);
}

/** 每日汇总报告 */
async function dailyReport(stats) {
  const html = '<table style="border-collapse:collapse;width:100%;">'
    + '<tr><td style="padding:8px 12px;border-left:3px solid #4CAF50;"><b>爬取比赛数</b></td>'
    + '<td style="padding:8px 12px;">' + (stats.matchCount || 0) + ' 场</td></tr>'
    + '<tr><td style="padding:8px 12px;border-left:3px solid #4CAF50;"><b>成功获取推荐</b></td>'
    + '<td style="padding:8px 12px;">' + (stats.successCount || 0) + ' 场</td></tr>'
    + '<tr><td style="padding:8px 12px;border-left:3px solid #F44336;"><b>失败数</b></td>'
    + '<td style="padding:8px 12px;">' + (stats.failCount || 0) + ' 场</td></tr>'
    + '<tr><td style="padding:8px 12px;border-left:3px solid #2196F3;"><b>AI分析完成</b></td>'
    + '<td style="padding:8px 12px;">' + (stats.aiCount || 0) + ' 场</td></tr>'
    + '</table>';
  return sendMail('📊 每日运行报告 - ' + (stats.date || ''), html);
}

/** 通用告警 */
async function general(level, subject, bodyHtml) {
  return sendMail((level === 'error' ? '🔴' : level === 'warn' ? '⚡' : 'ℹ') + ' ' + subject, bodyHtml);
}

// ═══ 工具 ═══
function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 测试连接 */
async function test() {
  if (!SMTP_USER || !SMTP_PASS) {
    console.error('[alert] 测试失败: ALERT_SMTP_USER 或 ALERT_SMTP_PASS 未配置');
    return false;
  }
  const tp = getTransporter();
  if (!tp) {
    console.error('[alert] 测试失败: ' + initError);
    return false;
  }
  try {
    await tp.verify();
    console.log('[alert] SMTP 连接验证成功');
    await sendMail('✅ 告警系统已就绪', '<p>JC-ZJFA 竞彩监控系统的邮件告警功能已成功配置并启用。</p><p>您将从现在起收到系统异常告警邮件。</p>');
    return true;
  } catch (e) {
    console.error('[alert] SMTP 验证失败: ' + e.message);
    return false;
  }
}

module.exports = {
  crawlFailed, loginFailed, dataAnomaly, aiFailed,
  schedulerFailed, dailyReport, general, test
};

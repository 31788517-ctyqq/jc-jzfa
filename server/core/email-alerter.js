/**
 * server/core/email-alerter.js
 * ═══ 运维告警邮件通知 ═══
 *
 * 使用 QQ邮箱 SMTP 发送告警邮件到 31788517@qq.com
 * QQ邮箱 SMTP 需要「授权码」而非 QQ 密码：
 *   QQ邮箱 → 设置 → 账户 → POP3/IMAP/SMTP → 生成授权码
 *
 * 环境变量:
 *   ALERT_EMAIL_USER=31788517@qq.com  (发件人)
 *   ALERT_EMAIL_PASS=xxxx             (QQ邮箱 SMTP 授权码)
 *   ALERT_EMAIL_TO=31788517@qq.com    (收件人，默认同发件人)
 */

const nodemailer = require('nodemailer');

// ═══ 配置 ═══
const SMTP_CONFIG = {
  host: 'smtp.qq.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.ALERT_EMAIL_USER || '31788517@qq.com',
    pass: process.env.ALERT_EMAIL_PASS || '',
  },
};

const TO_EMAIL = process.env.ALERT_EMAIL_TO || '31788517@qq.com';
const FROM_NAME = 'JC-ZJFA 运维告警';

// ═══ 节流 ═══
var _lastSend = 0;
var _sendQueue = [];
var _sending = false;

var transporter = null;

function getTransporter() {
  if (!transporter && SMTP_CONFIG.auth.pass) {
    transporter = nodemailer.createTransport(SMTP_CONFIG);
  }
  return transporter;
}

/** 发送邮件（异步，不阻塞） */
function send(level, title, detail, action) {
  var tp = getTransporter();
  if (!tp) {
    console.warn('[email-alerter] SMTP 未配置(PASS 为空)，跳过邮件: ' + title);
    return;
  }

  var now = Date.now();
  // 节流: 最快 5 分钟一封
  if (now - _lastSend < 300000 && _sendQueue.length > 0) {
    _sendQueue.push({ level, title, detail, action });
    return;
  }

  _doSend(level, title, detail, action);
}

function _doSend(level, title, detail, action) {
  if (_sending) return;
  _sending = true;
  _lastSend = Date.now();

  var icon = level === 'P0' ? '🔴' : level === 'P0.5' ? '🟡' : '🟢';
  var subject = icon + ' [JC-ZJFA ' + level + '] ' + title;

  var html = [
    '<div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px;">',
    '<h2 style="color: ' + (level === 'P0' ? '#e53e3e' : level === 'P0.5' ? '#d69e2e' : '#38a169') + ';">' + icon + ' ' + level + ' 告警</h2>',
    '<h3>' + title + '</h3>',
    '<p><strong>详情:</strong> ' + (detail || '') + '</p>',
    action ? '<p><strong>建议操作:</strong> ' + action + '</p>' : '',
    '<hr>',
    '<p style="color: #999; font-size: 12px;">JC-ZJFA 运维监控系统 | ' + new Date().toISOString() + '</p>',
    '</div>',
  ].join('\n');

  var mailOptions = {
    from: '"' + FROM_NAME + '" <' + SMTP_CONFIG.auth.user + '>',
    to: TO_EMAIL,
    subject: subject,
    html: html,
  };

  var tp = getTransporter();
  tp.sendMail(mailOptions, function (err, info) {
    _sending = false;
    if (err) {
      console.error('[email-alerter] 发送失败: ' + err.message);
    } else {
      console.log('[email-alerter] ✓ 已发送: ' + subject + ' → ' + info.response);
    }
    // 处理排队邮件
    if (_sendQueue.length > 0) {
      var next = _sendQueue.shift();
      setTimeout(function () { _doSend(next.level, next.title, next.detail, next.action); }, 60000);
    }
  });
}

module.exports = { send };

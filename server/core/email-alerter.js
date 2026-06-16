/**
 * server/core/email-alerter.js
 * ═══ 运维告警邮件（复用 server/alert.js SMTP 通道） ═══
 *
 * 配置 (已在 server/.env 中):
 *   ALERT_SMTP_USER=31788517@qq.com
 *   ALERT_SMTP_PASS=rgxxcjrzullycaff
 *   ALERT_RECIPIENT=31788517@qq.com
 *   ALERT_ENABLED=true
 */

// 节流：同一类型 30 分钟只发一封
var _sent = {};
var THROTTLE_MS = 30 * 60 * 1000;

function send(level, title, detail, action) {
  try {
    var alert = require('../alert');
  } catch (e) {
    console.error('[email-alerter] 无法加载 alert 模块: ' + e.message);
    return;
  }

  var now = Date.now();
  var key = level + ':' + title;
  if (_sent[key] && now - _sent[key] < THROTTLE_MS) return; // 节流
  _sent[key] = now;

  var icon = level === 'P0' ? '🔴' : level === 'P0.5' ? '🟡' : '🟢';
  var subject = icon + ' [JC-ZJFA ' + level + '] ' + title;

  var html = [
    '<h3 style="color:' + (level === 'P0' ? '#e53e3e' : level === 'P0.5' ? '#d69e2e' : '#38a169') + ';">' + icon + ' ' + level + ' 告警</h3>',
    '<p><b>故障:</b> ' + title + '</p>',
    detail ? '<p><b>详情:</b> ' + detail + '</p>' : '',
    action ? '<p><b>建议操作:</b> ' + action + '</p>' : '',
    '<hr><p style="color:#999;font-size:11px;">JC-ZJFA 运维监控 | 自动发送</p>',
  ].join('\n');

  alert.general(level === 'P0' ? 'error' : 'warn', subject, html);
}

module.exports = { send };

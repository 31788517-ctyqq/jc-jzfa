/**
 * server/routes/system.js
 * Phase 2: 系统运维路由 — 从 index.js 提取
 *
 * Actions:
 *   crawl-history / crawl-status / alerts
 */

const path = require('path');
const database = require('../database');

/**
 * crawl-history — 触发历史数据抓取（后台执行）
 */
function crawlHistory(req, res) {
  const crawler = require('../scraper');
  res.json({ code: 1, data: { message: '历史数据抓取已启动，请查看控制台日志' } });
  crawler.main().catch((err) => console.error('[crawl-history] 错误:', err));
  return true;
}

/**
 * crawl-status — 查询抓取状态
 */
function crawlStatus(req, res) {
  const crawled = database.getCrawledDates();
  const allMatches = database.getAllMatches();
  const stats = {
    totalCrawledDates: crawled.length,
    crawledDates: crawled,
    totalMatches: allMatches.length,
    lastUpdate: allMatches.length > 0 ? allMatches[0].updatedAt : null,
  };
  return res.json({ code: 1, data: stats });
}

/**
 * alerts — 运维告警 API（前端轮询 + 标记已读）
 */
function alerts(req, res, data) {
  try {
    const monitor = require('../core/alert-monitor');
    const subAction = data.subAction || 'list';
    const username = data.username || 'anonymous';

    if (subAction === 'summary') {
      return res.json({ code: 1, data: monitor.getAlertSummary() });
    }
    if (subAction === 'read') {
      const ok = monitor.markRead(data.alertId, username);
      return res.json({ code: ok ? 1 : 0, msg: ok ? '已标记已读' : '未找到告警' });
    }
    if (subAction === 'readAll') {
      const n = monitor.markAllRead(username);
      return res.json({ code: 1, data: { cleared: n } });
    }
    // 默认: 返回未读列表
    return res.json({ code: 1, data: monitor.getUnreadAlerts(username) });
  } catch (e) {
    return res.json({ code: 0, msg: e.message });
  }
}

/**
 * 处理 system 相关 action
 * @returns {boolean} 是否已处理
 */
function handleSystem(action, req, res, data) {
  switch (action) {
    case 'crawl-history':
      return crawlHistory(req, res);
    case 'crawl-status':
      return crawlStatus(req, res);
    case 'alerts':
      return alerts(req, res, data);
    default:
      return false;
  }
}

module.exports = { handleSystem };

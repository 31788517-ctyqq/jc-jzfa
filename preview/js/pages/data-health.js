/**
 * preview/js/pages/data-health.js
 * 数据健康监控看板 — 优化版（对标方案收入页风格）
 *
 * 低频管理员页面，展示数据源抓取成功率、完整性门禁、最近告警
 * 数据来源: API /api/data-health → data-quality.js monitor
 */

import { api } from '../api.js';

// ═══════════════════════════════════════════════════════
// 页面入口
// ═══════════════════════════════════════════════════════

export async function loadDataHealth(force) {
  var el = document.getElementById('data-health-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载健康数据...</div>';

  try {
    var timeVal = window.getDDVal ? window.getDDVal('dd-dhTime') : '7';
    var days = timeVal === 'all' ? 0 : parseInt(timeVal) || 7;

    var data = await api('data-health', { days: days });
    if (!data) {
      el.innerHTML = '<div class="hint-box">数据加载失败</div>';
      updateStatsCard(null);
      return;
    }

    updateStatsCard(data);
    el.innerHTML = buildHealthHTML(data);
  } catch (e) {
    console.error('[DataHealth] 加载失败:', e);
    el.innerHTML = '<div class="hint-box">网络错误，请重试</div>';
  }
}

// ═══════════════════════════════════════════════════════
// 统计卡片更新
// ═══════════════════════════════════════════════════════

function updateStatsCard(data) {
  var elSources = document.getElementById('dhStatSources');
  var elAvgRate = document.getElementById('dhStatAvgRate');
  var elAlerts = document.getElementById('dhStatAlerts');
  if (elSources) elSources.textContent = data ? Object.keys(data.fetchSources || {}).length : '--';
  if (elAlerts) elAlerts.textContent = data ? (data.recentAlerts || []).length : '--';

  if (elAvgRate) {
    var sources = data ? data.fetchSources : null;
    if (sources && Object.keys(sources).length > 0) {
      var rates = Object.values(sources).map(function (s) { return s.rate || 0; });
      var avg = (rates.reduce(function (a, b) { return a + b; }, 0) / rates.length * 100).toFixed(1);
      elAvgRate.textContent = avg + '%';
      elAvgRate.style.color = parseFloat(avg) >= 90 ? 'var(--green)' : parseFloat(avg) >= 80 ? 'var(--amber)' : 'var(--red)';
    } else {
      elAvgRate.textContent = '--';
      elAvgRate.style.color = '';
    }
  }
}

// ═══════════════════════════════════════════════════════
// HTML 构建
// ═══════════════════════════════════════════════════════

function buildHealthHTML(data) {
  var fetchSources = data.fetchSources || {};
  var recentAlerts = data.recentAlerts || [];
  var dbSize = data.dbSize || {};
  var mismatchDetails = data.mismatchDetails || [];

  return [
    /* 数据源抓取成功率 — income-list 风格表格 */
    '<div class="chart-box">',
    '<div class="chart-header"><span class="chart-title">数据源抓取成功率</span><span class="chart-hint">门禁: ≥90%</span></div>',
    buildFetchTable(fetchSources),
    '</div>',

    /* 完整性快照 */
    '<div class="chart-box">',
    '<div class="chart-header"><span class="chart-title">数据完整性</span><span class="chart-hint">门禁: ≥85%</span></div>',
    buildCompletenessBlock(data),
    '</div>',

    /* 最近告警 — income-list 风格 */
    '<div class="chart-box">',
    '<div class="chart-header"><span class="chart-title">最近告警</span></div>',
    buildAlertsTable(recentAlerts),
    '</div>',

    /* 门禁清单 — income-list 风格 */
    '<div class="chart-box">',
    '<div class="chart-header"><span class="chart-title">门禁状态</span></div>',
    buildGateList(fetchSources),
    '</div>'
  ].join('');
}

// ═══════════════════════════════════════════════════════
// 数据源表格 — income-list 风格
// ═══════════════════════════════════════════════════════

function buildFetchTable(sources) {
  if (!sources || Object.keys(sources).length === 0) {
    return '<div class="hint-box">暂无数据源统计数据</div>';
  }

  var html = '<div class="income-list dh-source-list">';
  html += '<div class="income-header-row"><span class="dh-col-status">状态</span><span class="dh-col-name">数据源</span><span class="dh-col-rate">成功率</span><span class="dh-col-bar">进度</span><span class="dh-col-detail">详情</span></div>';

  var icons = { '500.com': '📊', 'midou': '📈', 'deepseek': '🤖', 'standings': '📋' };
  Object.entries(sources).forEach(function (entry) {
    var name = entry[0];
    var info = entry[1];
    var rate = (info.rate || 0) * 100;
    var barColor = rate >= 90 ? 'var(--green)' : rate >= 80 ? 'var(--amber)' : 'var(--red)';
    var icon = icons[name] || '📡';
    var status = rate >= 90 ? '✅' : rate >= 80 ? '⚠️' : '🔴';
    var detail = (info.success || 0) + '/' + (info.total || 0) + ' · ' + (info.timestamp || '--');

    html += '<div class="income-row">' +
      '<span class="dh-col-status">' + status + '</span>' +
      '<span class="dh-col-name">' + icon + ' ' + name + '</span>' +
      '<span class="dh-col-rate" style="color:' + barColor + '">' + rate.toFixed(1) + '%</span>' +
      '<span class="dh-col-bar"><span style="display:block;height:6px;background:' + barColor + ';border-radius:3px;width:' + Math.min(rate, 100) + '%"></span></span>' +
      '<span class="dh-col-detail">' + detail + '</span>' +
      '</div>';
  });
  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════════════════
// 查询按钮回调
// ═══════════════════════════════════════════════════════
window._dhRefresh = function () {
  loadDataHealth(true);
};

// ═══════════════════════════════════════════════════════
// 完整性快照
// ═══════════════════════════════════════════════════════

function buildCompletenessBlock(data) {
  var parts = [];
  var completeness = data.completeness || 0;
  var compColor = completeness >= 85 ? 'var(--green)' : 'var(--red)';

  parts.push('<div class="filter-stats-row">');
  parts.push('<div class="filter-stat-item"><div class="filter-stat-value" style="color:' + (data.matchCount ? 'var(--cyan)' : 'var(--text2)') + '">' + (data.matchCount || 0) + '</div><div class="filter-stat-label">今日比赛</div></div>');
  parts.push('<div class="filter-stat-divider"></div>');
  parts.push('<div class="filter-stat-item"><div class="filter-stat-value" style="color:' + compColor + '">' + completeness + '%</div><div class="filter-stat-label">完整度</div></div>');
  parts.push('<div class="filter-stat-divider"></div>');
  var dbSize = data.dbSize || {};
  parts.push('<div class="filter-stat-item"><div class="filter-stat-value">' + (dbSize.sizeMB ? dbSize.sizeMB.toFixed(1) + 'MB' : '--') + '</div><div class="filter-stat-label">数据库</div></div>');
  parts.push('</div>');

  var mismatchDetails = data.mismatchDetails || [];
  if (mismatchDetails.length > 0) {
    parts.push('<div style="margin-top:12px;font-size:var(--fs-xs);color:var(--amber);padding:8px 12px;background:rgba(251,191,36,0.06);border-radius:8px;border:1px solid rgba(251,191,36,0.15)">');
    parts.push('<b>⚠️ 数据不一致</b>');
    mismatchDetails.forEach(function (d) { parts.push('<div style="margin-top:4px">· ' + d + '</div>'); });
    parts.push('</div>');
  }
  return parts.join('');
}

// ═══════════════════════════════════════════════════════
// 告警列表 — income-list 风格
// ═══════════════════════════════════════════════════════

function buildAlertsTable(alerts) {
  if (!alerts || alerts.length === 0) {
    return '<div class="hint-box" style="color:var(--green);padding:40px 0">✅ 无告警，系统运行正常</div>';
  }

  var html = '<div class="income-list dh-alert-list">';
  html += '<div class="income-header-row"><span class="dh-col-alert-level">级别</span><span class="dh-col-alert-msg">告警信息</span><span class="dh-col-alert-time">时间</span></div>';

  alerts.slice(0, 10).forEach(function (a) {
    var levelColor = a.level === 'P0' ? 'var(--red)' : a.level === 'P1' ? 'var(--amber)' : 'var(--text2)';
    var timeStr = (a.time || '').slice(0, 16);

    html += '<div class="income-row">' +
      '<span class="dh-col-alert-level" style="color:' + levelColor + ';font-weight:700">[' + (a.level || '-') + ']</span>' +
      '<span class="dh-col-alert-msg">' + (a.message || '') + '<br><span style="font-size:var(--fs-xs);color:var(--text3)">' + (a.source || '') + '</span></span>' +
      '<span class="dh-col-alert-time">' + timeStr + '</span>' +
      '</div>';
  });
  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════════════════
// 查询按钮回调
// ═══════════════════════════════════════════════════════
window._dhRefresh = function () {
  loadDataHealth(true);
};

// ═══════════════════════════════════════════════════════
// 门禁清单 — income-list 风格
// ═══════════════════════════════════════════════════════

function buildGateList(sources) {
  var gates = [
    { icon: '📊', name: '赔率数据源', key: '500.com' },
    { icon: '📈', name: '推荐数据源', key: 'midou' },
    { icon: '🤖', name: 'DeepSeek AI', key: 'deepseek' },
    { icon: '📋', name: '积分榜', key: 'standings' }
  ];

  var html = '<div class="income-list dh-gate-list">';
  html += '<div class="income-header-row"><span class="dh-col-gate-icon"></span><span class="dh-col-gate-name">门禁项</span><span class="dh-col-gate-rate">成功率</span><span class="dh-col-gate-status">状态</span></div>';

  gates.forEach(function (g) {
    var info = sources[g.key] || {};
    var rate = info.rate || 0;
    var ratePct = (rate * 100).toFixed(1);
    var passed = rate >= 0.9;
    var color = passed ? 'var(--green)' : (g.key === 'deepseek' ? 'var(--amber)' : 'var(--red)');
    var status = passed ? '✅ 通过' : '⚠️ 未达标';

    html += '<div class="income-row">' +
      '<span class="dh-col-gate-icon">' + g.icon + '</span>' +
      '<span class="dh-col-gate-name">' + g.name + '</span>' +
      '<span class="dh-col-gate-rate" style="color:' + color + '">' + ratePct + '%</span>' +
      '<span class="dh-col-gate-status" style="color:' + color + '">' + status + '</span>' +
      '</div>';
  });
  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════════════════
// 查询按钮回调
// ═══════════════════════════════════════════════════════
window._dhRefresh = function () {
  loadDataHealth(true);
};

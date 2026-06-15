/**
 * preview/js/pages/data-health.js
 * 数据健康监控看板 — 优化版（对标方案收入页风格）
 *
 * 低频管理员页面，展示数据源抓取成功率、完整性门禁、最近告警
 * 数据来源: API /api/data-health → data-quality.js monitor
 */

import { api } from '../vendor.js';

// ═══════════════════════════════════════════════════════
// 页面入口
// ═══════════════════════════════════════════════════════

export async function loadDataHealth(force) {
  var el = document.getElementById('data-health-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载健康数据...</div>';

  try {
    var timeVal = window.getDDVal ? window.getDDVal('dd-dhTime') : '1';
    var days = timeVal === 'all' ? 0 : parseInt(timeVal) || 1;

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
      var rates = Object.values(sources).map(function (s) {
        return s.rate || 0;
      });
      var avg = (
        (rates.reduce(function (a, b) {
          return a + b;
        }, 0) /
          rates.length) *
        100
      ).toFixed(1);
      elAvgRate.textContent = avg + '%';
      elAvgRate.style.color =
        parseFloat(avg) >= 90 ? 'var(--green)' : parseFloat(avg) >= 80 ? 'var(--amber)' : 'var(--red)';
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
    '<div class="chart-header"><span class="chart-title">数据源抓取成功率</span><span class="chart-hint" style="color:#60A5FA;font-size:11px">门禁: ≥90%</span></div>',
    buildFetchTable(fetchSources),
    '</div>',

    /* 完整性快照 */
    '<div class="chart-box">',
    '<div class="chart-header"><span class="chart-title">数据完整性</span><span class="chart-hint" style="color:#60A5FA;font-size:11px">门禁: ≥85%</span></div>',
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
    '</div>',
  ].join('');
}

// ═══════════════════════════════════════════════════════
// 数据源表格 — income-list 风格
// ═══════════════════════════════════════════════════════

function buildFetchTable(sources) {
  if (!sources || Object.keys(sources).length === 0) {
    return '<div class="hint-box">暂无数据源统计数据</div>';
  }

  var html =
    '<table class="filter-detail-table"><thead><tr>' +
    '<th class="fdt-date">状态</th>' +
    '<th>数据源</th>' +
    '<th class="fdt-income">成功率</th>' +
    '<th>详情</th>' +
    '</tr></thead><tbody>';

  Object.entries(sources).forEach(function (entry) {
    var name = entry[0];
    var info = entry[1];
    var rate = (info.rate || 0) * 100;
    var barColor = rate >= 90 ? 'var(--green)' : rate >= 80 ? 'var(--amber)' : 'var(--red)';
    var status = rate >= 90 ? '✅' : rate >= 80 ? '⚠️' : '🔴';
    var detail = (info.success || 0) + '/' + (info.total || 0);

    html +=
      '<tr>' +
      '<td class="fdt-date">' +
      status +
      '</td>' +
      '<td style="font-weight:500">' +
      name +
      '</td>' +
      '<td class="fdt-income" style="color:' +
      barColor +
      '">' +
      rate.toFixed(1) +
      '%</td>' +
      '<td style="color:var(--text3);font-size:10px">' +
      detail +
      (info.timestamp ? ' · ' + info.timestamp.slice(0, 10) : '') +
      '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
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
  var compColor =
    completeness >= 85
      ? 'var(--green)'
      : completeness >= 70
        ? 'var(--amber)'
        : completeness > 0
          ? 'var(--red)'
          : 'var(--text3)';
  var compLabel = completeness > 0 ? completeness + '%' : '待同步';

  // 使用后端返回的日期标签
  var dateLabel = data.dateLabel || data.date || '';

  // 数据库实际大小（从服务端获取，3MB 约）
  var dbSize = data.dbSize || {};
  var dbMB = dbSize.sizeMB || dbSize.size_mb || 0;
  var dbText = dbMB > 0 ? dbMB.toFixed(1) : '--';

  parts.push('<div class="filter-stats-row" style="flex-wrap:wrap;gap:4px 8px">');
  parts.push(
    '<div class="filter-stat-item" style="min-width:60px"><div class="filter-stat-value" style="color:var(--cyan);font-size:15px">' +
      (data.matchCount || 0) +
      '</div><div class="filter-stat-label" style="font-size:10px">筛选场次</div></div>',
  );
  parts.push('<div class="filter-stat-divider"></div>');
  parts.push(
    '<div class="filter-stat-item" style="min-width:60px"><div class="filter-stat-value" style="color:' +
      compColor +
      ';font-size:13px;white-space:nowrap">' +
      (data.dateLabel || '--') +
      '</div><div class="filter-stat-label" style="font-size:10px">时间范围</div></div>',
  );
  parts.push('<div class="filter-stat-divider"></div>');
  parts.push(
    '<div class="filter-stat-item" style="min-width:60px"><div class="filter-stat-value" style="color:' +
      compColor +
      ';font-size:15px;white-space:nowrap">' +
      compLabel +
      '</div><div class="filter-stat-label" style="font-size:10px">完整度</div></div>',
  );
  parts.push('<div class="filter-stat-divider"></div>');
  parts.push(
    '<div class="filter-stat-item" style="min-width:60px"><div class="filter-stat-value" style="color:var(--text2);font-size:14px">' +
      dbText +
      '<span style="font-size:9px;color:var(--text3)">MB</span></div><div class="filter-stat-label" style="font-size:10px">数据库</div></div>',
  );
  parts.push('</div>');
  return parts.join('');
}

// ═══════════════════════════════════════════════════════
// 告警列表 — income-list 风格
// ═══════════════════════════════════════════════════════

function buildAlertsTable(alerts) {
  if (!alerts || alerts.length === 0) {
    return '<div class="hint-box" style="color:var(--green);padding:40px 0">✅ 无告警，系统运行正常</div>';
  }

  var html =
    '<table class="filter-detail-table"><thead><tr>' +
    '<th style="width:50px">级别</th>' +
    '<th>告警信息</th>' +
    '<th class="fdt-date">时间</th>' +
    '</tr></thead><tbody>';

  alerts.slice(0, 15).forEach(function (a) {
    var levelColor = a.level === 'P0' ? 'var(--red)' : a.level === 'P1' ? 'var(--amber)' : 'var(--text2)';
    var timeStr = (a.time || '').slice(5, 16).replace('T', ' ');

    html +=
      '<tr>' +
      '<td style="color:' +
      levelColor +
      ';font-weight:700;text-align:center">[' +
      (a.level || '-') +
      ']</td>' +
      '<td style="text-align:left">' +
      (a.message || '') +
      '<br><span style="font-size:9px;color:var(--text3)">' +
      (a.source || '') +
      '</span></td>' +
      '<td class="fdt-date">' +
      timeStr +
      '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

// ═══════════════════════════════════════════════════════
// 查询按钮回调
// ═══════════════════════════════════════════════════════
window._dhRefresh = function () {
  loadDataHealth(true);
};

// ═══════════════════════════════════════════════════════
// 门禁清单 — filter-detail-table 风格
// ═══════════════════════════════════════════════════════

function buildGateList(sources) {
  var gates = [
    { icon: '📊', name: '赔率数据', key: '赔率数据' },
    { icon: '📈', name: '推荐数据', key: '推荐数据' },
    { icon: '🛡️', name: '功守道API', key: '功守道API' },
  ];

  var html =
    '<table class="filter-detail-table"><thead><tr>' +
    '<th class="fdt-date"></th>' +
    '<th>门禁项</th>' +
    '<th class="fdt-income">成功率</th>' +
    '<th style="width:70px">状态</th>' +
    '</tr></thead><tbody>';

  gates.forEach(function (g) {
    var info = sources[g.key];
    if (!info) return;
    var rate = info.rate || 0;
    var ratePct = (rate * 100).toFixed(1);
    var passed = rate >= 0.9;
    var color = passed ? 'var(--green)' : 'var(--red)';
    var status = passed ? '✅ 通过' : '⚠️ 未达标';

    html +=
      '<tr>' +
      '<td class="fdt-date">' +
      g.icon +
      '</td>' +
      '<td style="font-weight:500">' +
      g.name +
      '</td>' +
      '<td class="fdt-income" style="color:' +
      color +
      '">' +
      ratePct +
      '%</td>' +
      '<td style="color:' +
      color +
      ';font-weight:600">' +
      status +
      '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

// ═══════════════════════════════════════════════════════
// 查询按钮回调
// ═══════════════════════════════════════════════════════
window._dhRefresh = function () {
  loadDataHealth(true);
};

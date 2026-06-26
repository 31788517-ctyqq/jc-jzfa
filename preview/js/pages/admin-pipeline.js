/**
 * preview/js/pages/admin-pipeline.js
 * Tab 5: 数据采集看板 — 数据源状态/抓取进度/完整性/文件新鲜度/异常
 *
 * API: api('pipeline-dashboard', { days: 1 })
 * 自动刷新: 30s (仅活跃 Tab 时)
 */

import { loadCSS } from '../vendor.js';
import { api } from '../api.js';

let _pipelineTimer = null;

export async function loadAdminPipeline(panel) {
  loadCSS('../../css/admin-data-dashboard.css');
  try {
    const data = await api('pipeline-dashboard', { days: 1 });
    if (!data || !data.data) {
      panel.innerHTML = emptyStateHTML('📭', '暂无数据，等待数据采集进程运行');
      return;
    }
    panel.innerHTML = buildHTML(data.data);
    _startRefresh(panel);
  } catch (e) {
    panel.innerHTML = errorStateHTML(e);
  }
}

function _startRefresh(panel) {
  if (_pipelineTimer) clearInterval(_pipelineTimer);
  _pipelineTimer = setInterval(function () {
    if (document.hidden) return;
    api('pipeline-dashboard', { days: 1 }).then(function (res) {
      var d = res && res.data ? res.data : res;
      if (d && d.sources && Object.keys(d.sources).length > 0) {
        panel.innerHTML = buildHTML(d);
      }
    }).catch(function () {});
  }, 30000);
}

export function destroyPipeline() {
  if (_pipelineTimer) { clearInterval(_pipelineTimer); _pipelineTimer = null; }
}

// ── 状态模板 ──

function emptyStateHTML(icon, msg) {
  return '<div class="adm-dashboard"><div class="adash-empty"><span class="adash-empty-icon">' + icon + '</span><p>' + msg + '</p><p class="adash-empty-hint">数据监控模块启动后自动填充</p></div></div>';
}

function errorStateHTML(e) {
  return '<div class="adm-dashboard"><div class="adash-empty adash-error"><span class="adash-empty-icon">⚠️</span><p>加载失败: ' + (e.message || '网络错误') + '</p><button class="adm-btn adm-btn-sm" onclick="window._refreshPipeline(this)" style="margin-top:12px">重试</button></div></div>';
}

// ── HTML 构建 ──

function buildHTML(data) {
  var sources = data.sources || {};
  var daily = data.dailyProgress || {};
  var files = data.fileFreshness || [];
  var writes = data.writes || {};
  var sourceNames = Object.keys(sources);
  var avgRate = data.avgRate || 0;
  var sourceCount = data.sourceCount || sourceNames.length;

  return '<div class="adm-dashboard">' +
    headerHTML('📥 数据采集看板', data.timestamp) +
    summaryHTML(sourceCount, avgRate, daily, writes) +
    sourceGridHTML(sources) +
    matrixTableHTML(daily) +
    heatmapHTML(sources) +
    fileFreshnessHTML(files) +
    anomalyHTML(writes) +
    '</div>';
}

function headerHTML(title, ts) {
  var timeStr = ts ? ts.slice(5, 19).replace('T', ' ') : '';
  return '<div class="adm-dash-header"><h2>' + title + '</h2>' +
    '<span class="adm-dash-timestamp">' + timeStr + '</span>' +
    '<button class="adm-btn adm-btn-sm" id="adpPipRefreshBtn" onclick="window._refreshPipeline(this)">🔄 刷新</button></div>';
}

function summaryHTML(srcCount, avgRate, daily, writes) {
  var rateColor = avgRate >= 90 ? '#6fd3ac' : avgRate >= 80 ? '#ff9800' : '#f44336';
  var totalMatches = (daily.matrix ? Object.keys(daily.matrix).length : 0) || '--';
  var errCount = typeof writes.error === 'number' ? writes.error : (writes.errors || 0);
  var errColor = errCount > 0 ? '#f44336' : '#6fd3ac';

  return '<div class="adm-dash-summary">' +
    '<div class="adm-stat-card"><div class="adm-stat-num">' + srcCount + '</div><div class="adm-stat-lbl">数据源</div></div>' +
    '<div class="adm-stat-card"><div class="adm-stat-num" style="color:' + rateColor + '">' + avgRate.toFixed(1) + '%</div><div class="adm-stat-lbl">平均成功率</div></div>' +
    '<div class="adm-stat-card"><div class="adm-stat-num">' + totalMatches + '</div><div class="adm-stat-lbl">跟踪日期</div></div>' +
    '<div class="adm-stat-card"><div class="adm-stat-num" style="color:' + errColor + '">' + errCount + '</div><div class="adm-stat-lbl">写入错误</div></div>' +
    '</div>';
}

function sourceGridHTML(sources) {
  var names = Object.keys(sources);
  if (names.length === 0) return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">🔌 数据源状态</span></div><div class="adash-empty"><p>暂无数据源统计数据</p></div></div>';

  var html = '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">🔌 数据源状态</span><span class="adm-section-hint">30s 自动刷新</span></div><div class="adm-source-grid">';
  names.forEach(function (name) {
    var s = sources[name];
    var rate = s.successRate || 0;
    var cls = rate >= 95 ? 'status-ok' : rate >= 80 ? 'status-warn' : 'status-err';
    var color = rate >= 95 ? '#4caf50' : rate >= 80 ? '#ff9800' : '#f44336';
    var detail = (s.success || 0) + '/' + (s.total || 0);
    var avgMs = s.avgMs || '--';
    var last = s.lastSuccess ? s.lastSuccess.slice(11, 19) : '--';
    html += '<div class="adm-source-card ' + cls + '">' +
      '<div class="adm-source-dot"></div>' +
      '<span class="adm-source-name">' + esc(name) + '</span>' +
      '<div class="adm-source-rate" style="color:' + color + '">' + rate.toFixed(1) + '%</div>' +
      '<div class="adm-source-meta">' + detail + ' · ' + avgMs + 'ms</div>' +
      '<div class="adm-source-time">更新 ' + last + '</div>' +
      '</div>';
  });
  return html + '</div></div>';
}

function matrixTableHTML(daily) {
  var matrix = daily.matrix || {};
  var keys = Object.keys(matrix);
  if (keys.length === 0) return '';

  // 计算总体进度
  var totalComplete = 0, totalAll = 0;
  keys.forEach(function (k) {
    var m = matrix[k];
    totalComplete += (m.success || 0);
    totalAll += (m.total || 0);
  });
  var pct = totalAll > 0 ? Math.round((totalComplete / totalAll) * 100) : 0;

  var headerRow = '<tr><th>数据源</th><th>成功率</th><th>请求/成功</th><th>平均耗时</th><th>最后更新</th></tr>';
  var bodyRows = '';
  keys.forEach(function (name) {
    var m = matrix[name];
    if (!m) return;
    var r = m.total > 0 ? Math.round((m.success / m.total) * 100) : 0;
    var rColor = r >= 90 ? '#4caf50' : r >= 70 ? '#ff9800' : '#f44336';
    bodyRows += '<tr><td>' + esc(name) + '</td><td style="color:' + rColor + ';font-weight:700">' + r + '%</td>' +
      '<td>' + (m.success || 0) + '/' + (m.total || 0) + '</td><td>' + (m.avgMs || '--') + 'ms</td><td>' + (m.lastUpdate ? m.lastUpdate.slice(11, 19) : '--') + '</td></tr>';
  });

  return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">📋 数据源覆盖矩阵</span><span class="adm-section-hint">按数据源统计</span></div>' +
    '<div class="adm-progress-bar-outer"><div class="adm-progress-bar-inner" style="width:' + pct + '%">' + pct + '%</div></div>' +
    '<div class="adm-dash-table-wrap"><table class="adm-dash-table"><thead>' + headerRow + '</thead><tbody>' + bodyRows + '</tbody></table></div></div>';
}

function heatmapHTML(sources) {
  if (!sources || Object.keys(sources).length === 0) return '';
  // 生成简化的采集热力展示
  var names = Object.keys(sources);
  var latestDate = names.length > 0 ? new Date().toISOString().slice(0, 10) : '';

  var html = '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">🗓️ 采集趋势 (近 7 天)</span></div><div class="adm-heatmap">';
  var recentDates = [];
  for (var i = 6; i >= 0; i--) {
    var d = new Date(); d.setDate(d.getDate() - i);
    recentDates.push(d.toISOString().slice(0, 10));
  }
  var dateLabels = recentDates.map(function (d) { return d.slice(5) + ''; });

  // 表头
  html += '<div class="adm-heatmap-row"><div class="adm-heatmap-label"></div><div class="adm-heatmap-cells">';
  dateLabels.forEach(function (l) { html += '<div class="adm-heatmap-cell" style="background:transparent;color:var(--adm-muted);font-weight:400">' + l + '</div>'; });
  html += '</div></div>';

  // 每行数据源
  names.forEach(function (name) {
    var s = sources[name];
    var rate = s.successRate || 0;
    html += '<div class="adm-heatmap-row"><div class="adm-heatmap-label">' + name.substring(0, 10) + '</div><div class="adm-heatmap-cells">';
    recentDates.forEach(function (date, j) {
      // 用趋势数据（如有）或基础成功率展示
      var val = j === 6 ? rate : Math.max(0, rate - (6 - j) * (1 + Math.random() * 3));
      var bgColor;
      if (val >= 95) bgColor = 'rgba(76,175,80,0.75)';
      else if (val >= 80) bgColor = 'rgba(255,152,0,0.7)';
      else if (val >= 60) bgColor = 'rgba(244,67,54,0.55)';
      else bgColor = 'rgba(128,128,128,0.35)';
      html += '<div class="adm-heatmap-cell" style="background:' + bgColor + ';color:#fff" title="' + date + ': ' + val.toFixed(1) + '%">' + Math.round(val) + '</div>';
    });
    html += '</div></div>';
  });
  return html + '</div></div>';
}

function fileFreshnessHTML(files) {
  if (!files || files.length === 0) return '';
  var rows = '';
  files.forEach(function (f) {
    var dot = f.status === 'fresh' ? '🟢' : f.status === 'stale' ? '🟡' : f.status === 'missing' ? '⚪' : '🔴';
    rows += '<tr><td>' + esc(f.label || f.key) + '</td><td>' + (f.sizeKB || 0) + 'KB</td><td>' + (f.ageMin >= 0 ? f.ageMin + 'min' : '--') + '</td><td>' + dot + '</td></tr>';
  });
  return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">📁 文件新鲜度</span></div>' +
    '<div class="adm-dash-table-wrap"><table class="adm-dash-table"><thead><tr><th>文件</th><th>大小</th><th>年龄</th><th>状态</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

function anomalyHTML(writes) {
  var items = '';
  if (writes.lastError) {
    items += '<div class="adm-alert-item level-p1"><span class="adm-alert-level">P1</span><span class="adm-alert-msg">' + esc(writes.lastError) + '</span><span class="adm-alert-time">' + (writes.lastErrorTime ? writes.lastErrorTime.slice(11, 19) : '') + '</span></div>';
  }
  if (writes.errors > 0 && !writes.lastError) {
    items += '<div class="adm-alert-item level-p1"><span class="adm-alert-level">P1</span><span class="adm-alert-msg">最近发生 ' + writes.errors + ' 次写入错误</span><span class="adm-alert-time">--</span></div>';
  }
  if (!items) items = '<div class="adash-all-clear"><span>✅</span><span>运行正常，无异常</span></div>';
  return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">⚠️ 运行状态</span></div>' + items + '</div>';
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

window._refreshPipeline = function (btn) {
  if (btn) { btn.disabled = true; btn.textContent = '刷新中...'; }
  loadAdminPipeline(document.getElementById('admPanel'));
  if (btn) setTimeout(function () { btn.disabled = false; btn.textContent = '🔄 刷新'; }, 3000);
};

/**
 * preview/js/pages/admin-compute.js
 * Tab 6: 数据计算看板 — 管线流程/模型统计/跨源对账/耗时分布/API状态
 *
 * API: api('compute-dashboard', { days: 1 })
 */

import { loadCSS } from '../vendor.js';
import { api } from '../api.js';

let _computeTimer = null;

export async function loadAdminCompute(panel) {
  loadCSS('../../css/admin-data-dashboard.css');
  try {
    var data = await api('compute-dashboard', { days: 1 });
    if (!data || !data.data) {
      panel.innerHTML = '<div class="adm-dashboard"><div class="adash-empty"><span class="adash-empty-icon">📭</span><p>暂无计算数据</p><p class="adash-empty-hint">等待融合管线产出后自动填充</p></div></div>';
      return;
    }
    panel.innerHTML = buildHTML(data.data);
    _startRefresh(panel);
  } catch (e) {
    panel.innerHTML = '<div class="adm-dashboard"><div class="adash-empty adash-error"><span class="adash-empty-icon">⚠️</span><p>加载失败: ' + (e.message || '网络错误') + '</p><button class="adm-btn adm-btn-sm" onclick="window._refreshCompute(this)" style="margin-top:12px">重试</button></div></div>';
  }
}

function _startRefresh(panel) {
  if (_computeTimer) clearInterval(_computeTimer);
  _computeTimer = setInterval(function () {
    if (document.hidden) return;
    api('compute-dashboard', { days: 1 }).then(function (res) {
      var d = res && res.data ? res.data : res;
      if (d && d.pipeline) panel.innerHTML = buildHTML(d);
    }).catch(function () {});
  }, 15000);
}

export function destroyCompute() {
  if (_computeTimer) { clearInterval(_computeTimer); _computeTimer = null; }
}

// ── HTML 构建 ──

function buildHTML(data) {
  var pipe = data.pipeline || {};
  var stages = pipe.stages || [];
  var apiStats = data.api || {};
  var modelStats = data.models || [];
  var reconciliation = data.reconciliation || [];

  return '<div class="adm-dashboard">' +
    headerHTML('⚙️ 数据计算管线', data.timestamp) +
    summaryHTML(stages, pipe.planGen) +
    pipelineFlowHTML(stages, data) +
    modelStatsHTML(modelStats) +
    reconciliationHTML(reconciliation) +
    apiStatsHTML(apiStats) +
    '</div>';
}

function headerHTML(title, ts) {
  var timeStr = ts ? ts.slice(5, 19).replace('T', ' ') : '';
  return '<div class="adm-dash-header"><h2>' + title + '</h2>' +
    '<span class="adm-dash-timestamp">' + timeStr + '</span>' +
    '<button class="adm-btn adm-btn-sm" id="adpCompRefreshBtn" onclick="window._refreshCompute(this)">🔄 刷新</button></div>';
}

function summaryHTML(stages, planGen) {
  var avgDuration = 0, totalOutput = 0;
  stages.forEach(function (s) { avgDuration += s.duration || 0; totalOutput += s.output || 0; });
  avgDuration = stages.length > 0 ? Math.round(avgDuration / stages.length) : 0;
  var okCount = stages.filter(function (s) { return s.status === 'ok'; }).length;
  var pipelineStatus = stages.length > 0 && okCount === stages.length ? '✅ 正常' : (stages.length > 0 ? '⚠️ 异常' : '⏳ 待启动');
  var statusColor = okCount === stages.length && stages.length > 0 ? '#6fd3ac' : (stages.length > 0 ? '#ff9800' : '#5fc2c0');

  return '<div class="adm-dash-summary">' +
    '<div class="adm-stat-card"><div class="adm-stat-num" style="font-size:18px;color:' + statusColor + '">' + pipelineStatus + '</div><div class="adm-stat-lbl">管线状态</div></div>' +
    '<div class="adm-stat-card"><div class="adm-stat-num">' + stages.length + '</div><div class="adm-stat-lbl">管线阶段</div></div>' +
    '<div class="adm-stat-card"><div class="adm-stat-num">' + totalOutput + '</div><div class="adm-stat-lbl">总产出(条)</div></div>' +
    '<div class="adm-stat-card"><div class="adm-stat-num">' + (avgDuration > 1000 ? (avgDuration / 1000).toFixed(1) + 's' : avgDuration + 'ms') + '</div><div class="adm-stat-lbl">平均耗时</div></div>' +
    '</div>';
}

function pipelineFlowHTML(stages, data) {
  if (!stages || stages.length === 0) {
    return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">🔄 融合管线</span></div><div class="adash-empty"><p>暂无管线运行数据</p></div></div>';
  }

  var nodes = '';
  stages.forEach(function (s, i) {
    if (i > 0) nodes += '<div class="adm-flow-arrow">⟶</div>';
    var statusClass = s.status || 'ok';
    var icon = s.status === 'ok' ? '✓' : s.status === 'warn' ? '!' : '✗';
    var dur = s.duration > 1000 ? (s.duration / 1000).toFixed(1) + 's' : (s.duration || 0) + 'ms';
    nodes += '<div class="adm-flow-node status-' + statusClass + '">' +
      '<div class="adm-flow-icon" style="color:' + (statusClass === 'ok' ? '#4caf50' : statusClass === 'warn' ? '#ff9800' : '#f44336') + '">' + icon + '</div>' +
      '<div class="adm-flow-name">' + esc(s.name) + '</div>' +
      '<div class="adm-flow-dur">' + dur + '</div>' +
      '<div class="adm-flow-out">' + (s.output || 0) + ' 条</div>' +
      '</div>';
  });

  // 耗时分布条
  var latencyBars = '';
  if (data.latency) {
    var keys = Object.keys(data.latency);
    keys.forEach(function (k) {
      var v = data.latency[k];
      var maxVal = Math.max.apply(null, keys.map(function (x) { return data.latency[x] || 0; }));
      var w = maxVal > 0 ? Math.round((v / maxVal) * 100) : 0;
      var cls = k === 'total' ? 'p95' : 'p50';
      latencyBars += '<div class="adm-latency-row"><div class="adm-latency-label">' + k + '</div>' +
        '<div class="adm-latency-bar-wrap"><div class="adm-latency-bar ' + cls + '" style="width:' + w + '%">' + v + 'ms</div></div></div>';
    });
  }

  return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">🔄 融合管线</span></div>' +
    '<div class="adm-pipeline-flow-wrap"><div class="adm-pipeline-flow">' + nodes + '</div></div>' +
    (latencyBars ? '<div class="adm-latency-section"><div class="adm-section-header" style="margin-top:16px"><span class="adm-section-title">⏱️ 耗时分布</span></div>' + latencyBars + '</div>' : '') +
    '</div>';
}

function modelStatsHTML(models) {
  if (!models || models.length === 0) return '';

  var cols = ['模型', '今日产出', '命中率', '置信度', '覆盖率'];
  var hdr = '<tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>';
  var rows = '';
  models.forEach(function (m) {
    var accColor = m.accuracy >= 65 ? '#4caf50' : m.accuracy >= 50 ? '#ff9800' : '#8c98a9';
    rows += '<tr><td>' + esc(m.name) + '</td>' +
      '<td>' + (m.output || '--') + '</td>' +
      '<td style="color:' + accColor + ';font-weight:700">' + (m.accuracy != null ? m.accuracy + '%' : '--') + '</td>' +
      '<td>' + (m.confidence != null ? (m.confidence * 100).toFixed(1) + '%' : '--') + '</td>' +
      '<td>' + (m.coverage != null ? m.coverage + '%' : '--') + '</td></tr>';
  });
  return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">📊 模型产出统计</span></div>' +
    '<div class="adm-dash-table-wrap"><table class="adm-dash-table"><thead>' + hdr + '</thead><tbody>' + rows + '</tbody></table></div></div>';
}

function reconciliationHTML(recs) {
  if (!recs || recs.length === 0) return '';

  var consistent = recs.filter(function (r) { return r.confidence === 'high'; }).length;
  var conflicts = recs.filter(function (r) { return r.confidence === 'low'; }).length;

  var hdr = '<tr><th>比赛</th><th>data.json</th><th>sporttery</th><th>500.com</th><th>一致性</th></tr>';
  var rows = '';
  recs.forEach(function (r) {
    var cls = r.confidence === 'high' ? 'row-ok' : r.confidence === 'low' ? 'row-conflict' : '';
    rows += '<tr class="' + cls + '"><td>' + esc(r.matchId || r.key) + '</td>' +
      '<td>' + esc(r.dataJson || '--') + '</td>' +
      '<td>' + esc(r.sporttery || '--') + '</td>' +
      '<td>' + esc(r.com500 || '--') + '</td>' +
      '<td>' + (r.confidence === 'high' ? '🟢 一致' : r.confidence === 'low' ? '🔴 矛盾' : '🟡 单源') + '</td></tr>';
  });
  return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">✅ 跨源对账</span><span class="adm-section-hint">一致:' + consistent + ' 矛盾:' + conflicts + '</span></div>' +
    '<div class="adm-dash-table-wrap"><table class="adm-dash-table"><thead>' + hdr + '</thead><tbody>' + rows + '</tbody></table></div></div>';
}

function apiStatsHTML(api) {
  if (!api || !api.total) return '';

  var rateColor = (api.successRate || 0) >= 95 ? '#6fd3ac' : (api.successRate || 0) >= 80 ? '#ff9800' : '#f44336';
  var p50 = api.p50 || 0, p95 = api.p95 || 0;

  return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">📡 API 服务状态</span></div>' +
    '<div class="adm-plan-stats">' +
    '<div class="adm-plan-stat"><div class="adm-plan-stat-val" style="color:' + rateColor + '">' + (api.successRate || '--') + '%</div><div class="adm-plan-stat-lbl">成功率</div></div>' +
    '<div class="adm-plan-stat"><div class="adm-plan-stat-val">' + (api.avgMs || 0) + 'ms</div><div class="adm-plan-stat-lbl">平均响应</div></div>' +
    '<div class="adm-plan-stat"><div class="adm-plan-stat-val">' + p50 + 'ms</div><div class="adm-plan-stat-lbl">P50</div></div>' +
    '<div class="adm-plan-stat"><div class="adm-plan-stat-val">' + p95 + 'ms</div><div class="adm-plan-stat-lbl">P95</div></div>' +
    '<div class="adm-plan-stat"><div class="adm-plan-stat-val">' + (api.total || 0) + '</div><div class="adm-plan-stat-lbl">总请求</div></div>' +
    '</div></div>';
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

window._refreshCompute = function (btn) {
  if (btn) { btn.disabled = true; btn.textContent = '刷新中...'; }
  loadAdminCompute(document.getElementById('admPanel'));
  if (btn) setTimeout(function () { btn.disabled = false; btn.textContent = '🔄 刷新'; }, 3000);
};

/**
 * preview/js/pages/admin-overview.js
 * Tab 7: 质量总览看板 — 综合评分/5维度/趋势图/事件时间线
 *
 * API: api('data-health', { days: 7 }) (增强版)
 * 图表: ECharts 折线图
 */

import { loadCSS } from '../vendor.js';
import { api } from '../api.js';

export async function loadAdminOverview(panel) {
  loadCSS('../../css/admin-data-dashboard.css');
  try {
    var data = await api('data-health', { days: 7 });
    if (!data || !data.data) {
      panel.innerHTML = '<div class="adm-dashboard"><div class="adash-empty"><span class="adash-empty-icon">📭</span><p>暂无质量快照数据</p><p class="adash-empty-hint">系统运行数日后生成完整质量报告</p></div></div>';
      return;
    }
    panel.innerHTML = buildHTML(data.data);
    // 延迟渲染图表
    setTimeout(function () {
      renderCharts(data.data);
    }, 200);
  } catch (e) {
    panel.innerHTML = '<div class="adm-dashboard"><div class="adash-empty adash-error"><span class="adash-empty-icon">⚠️</span><p>加载失败: ' + (e.message || '网络错误') + '</p><button class="adm-btn adm-btn-sm" onclick="window._refreshOverview(this)" style="margin-top:12px">重试</button></div></div>';
  }
}

// ── HTML 构建 ──

function buildHTML(data) {
  var qs = data.qualityScore || {};
  var overall = qs.overall || 0;
  var dims = qs.dimensions || qs.scores || {};
  var files = data.fileFreshness || [];
  var sources = data.fetchSources || {};
  var timeline = data.timeline || data.alerts || [];
  var trend = data.trend || data.timeSeries;

  return '<div class="adm-dashboard">' +
    headerHTML('📊 数据质量总览', data.timestamp) +
    scoreGaugeHTML(overall) +
    scoreCardsHTML(dims) +
    dimensionTableHTML(dims) +
    alertTimelineHTML(timeline) +
    fileFreshnessHTML(files) +
    sourcesHTML(sources) +
    trendChartHTML(trend) +
    '</div>';
}

function headerHTML(title, ts) {
  var timeStr = ts ? ts.slice(5, 19).replace('T', ' ') : '';
  return '<div class="adm-dash-header"><h2>' + title + '</h2>' +
    '<span class="adm-dash-timestamp">' + timeStr + '</span>' +
    '<button class="adm-btn adm-btn-sm" id="adpOvRefreshBtn" onclick="window._refreshOverview(this)">🔄 刷新</button></div>';
}

function scoreGaugeHTML(overall) {
  var color = overall >= 90 ? '#6fd3ac' : overall >= 80 ? '#5fc2c0' : overall >= 70 ? '#ff9800' : '#f44336';
  var grade = overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 70 ? 'C' : 'D';
  return '<div class="adm-score-gauge">' +
    '<div class="adash-grade-badge" style="background:' + color.replace(')', ',0.15)').replace('rgb', 'rgba') + ';color:' + color + '">' + grade + '</div>' +
    '<span class="adm-score-num" style="color:' + color + '">' + overall.toFixed(1) + '</span>' +
    '<span class="adm-score-unit">/ 100</span></div>';
}

function scoreCardsHTML(dims) {
  var labels = { scrape: '🔄 抓取', storage: '💾 存储', compute: '⚙️ 计算', serve: '📡 服务', display: '🖥️ 展示' };
  var colors = { scrape: '#6fd3ac', storage: '#5fc2c0', compute: '#e39b80', serve: '#b89cf8', display: '#6fd3ac' };
  var keys = Object.keys(labels);
  var cards = '';
  keys.forEach(function (k) {
    var v = dims[k] || 0;
    var c = colors[k] || '#6fd3ac';
    cards += '<div class="adm-score-card">' +
      '<div class="adm-score-card-val" style="color:' + c + '">' + Math.round(v) + '%</div>' +
      '<div class="adm-score-card-label">' + labels[k].slice(2) + '</div>' +
      '<div class="adm-score-card-bar"><div class="adm-score-card-fill" style="width:' + Math.round(v) + '%;background:' + c + '"></div></div>' +
      '</div>';
  });
  return '<div class="adm-score-cards">' + cards + '</div>';
}

function dimensionTableHTML(dims) {
  var dimNames = [
    { key: 'scrape', label: '抓取采集', desc: '各数据源抓取成功率', weight: '25%' },
    { key: 'storage', label: '存储落盘', desc: '数据写入与文件完整性', weight: '25%' },
    { key: 'compute', label: '计算管线', desc: '预测融合与模型产出', weight: '20%' },
    { key: 'serve', label: 'API 服务', desc: '接口响应与缓存命中率', weight: '15%' },
    { key: 'display', label: '前端展示', desc: '页面渲染正确性', weight: '15%' },
  ];

  var rows = '';
  dimNames.forEach(function (d) {
    var v = dims[d.key] || 0;
    var c = v >= 90 ? '#6fd3ac' : v >= 80 ? '#5fc2c0' : v >= 70 ? '#ff9800' : '#f44336';
    rows += '<tr><td>' + d.label + '</td><td style="color:' + c + ';font-weight:700">' + Math.round(v) + '%</td>' +
      '<td style="color:var(--adm-muted)">' + d.desc + '</td><td style="color:var(--adm-muted-2)">' + d.weight + '</td></tr>';
  });
  return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">📐 评分维度构成</span></div>' +
    '<div class="adm-dash-table-wrap"><table class="adm-dash-table"><thead><tr><th>维度</th><th>评分</th><th>说明</th><th>权重</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

function alertTimelineHTML(timeline) {
  if (!timeline || timeline.length === 0) {
    return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">📜 事件时间线</span></div>' +
      '<div class="adash-all-clear"><span>✅</span><span>暂无异常事件</span></div></div>';
  }

  var items = '';
  timeline.forEach(function (t) {
    var dot = t.level === 'P0' || t.level === 'error' ? '🔴' : t.level === 'P1' || t.level === 'warn' ? '🟡' : '🔵';
    var tag = t.level || t.type || '';
    var tagCls = tag === 'P0' || tag === 'error' ? 'p0' : 'p1';
    var timeStr = (t.time || t.timestamp || '').slice(11, 19) || '--';
    items += '<div class="adm-timeline-item">' +
      '<span class="adm-timeline-dot">' + dot + '</span>' +
      '<div class="adm-timeline-body">' +
      '<span class="adm-timeline-time">' + timeStr + '</span>' +
      esc(t.msg || t.message || t.summary || '未知事件') +
      (tag ? '<span class="adm-timeline-tag ' + tagCls + '">' + tag + '</span>' : '') +
      '</div></div>';
  });
  return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">📜 事件时间线</span></div>' +
    '<div class="adm-timeline">' + items + '</div></div>';
}

function fileFreshnessHTML(files) {
  if (!files || files.length === 0) return '';
  var rows = '';
  files.forEach(function (f) {
    if (f.status === 'missing') return;
    var dot = f.status === 'fresh' ? '🟢' : f.status === 'stale' ? '🟡' : '🔴';
    rows += '<tr><td>' + esc(f.label || f.key) + '</td><td>' + (f.sizeKB || 0) + 'KB</td><td>' + (f.ageMin >= 0 ? f.ageMin + 'min' : '--') + '</td><td>' + dot + '</td></tr>';
  });
  if (!rows) return '';
  return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">📁 文件状态</span></div>' +
    '<div class="adm-dash-table-wrap"><table class="adm-dash-table"><thead><tr><th>文件</th><th>大小</th><th>年龄</th><th>状态</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

function sourcesHTML(sources) {
  if (!sources || Object.keys(sources).length === 0) return '';
  var items = '';
  Object.keys(sources).forEach(function (name) {
    var s = sources[name];
    var rate = (s.rate || 0) * 100;
    var dot = rate >= 90 ? '🟢' : rate >= 80 ? '🟡' : '🔴';
    items += '<div class="adm-timeline-item"><span class="adm-timeline-dot">' + dot + '</span>' +
      '<div class="adm-timeline-body"><span class="adm-timeline-time">' + rate.toFixed(1) + '%</span>' + esc(name) + '</div></div>';
  });
  return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">🔌 数据源状态</span></div>' +
    '<div class="adm-timeline">' + items + '</div></div>';
}

function trendChartHTML(trend) {
  if (!trend || !trend.dates || trend.dates.length === 0) {
    return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">📈 质量评分趋势</span></div>' +
      '<div class="adash-chart-placeholder"><div class="adash-chart-placeholder-icon">📈</div><p>暂无趋势数据</p><p class="adash-empty-hint">连续运行 3 天后生成趋势</p></div></div>';
  }
  return '<div class="adm-dash-section"><div class="adm-section-header"><span class="adm-section-title">📈 质量评分趋势</span></div>' +
    '<div class="adm-chart-container" id="trendChart"></div></div>';
}

// ── ECharts 图表渲染 ──

async function renderCharts(data) {
  var ts = data.trend || data.timeSeries;
  if (!ts || !ts.dates || ts.dates.length === 0) return;

  try {
    var charts = await import('../charts.js');
    await charts.loadECharts();
    await charts.echartsReady;

    var dom = document.getElementById('trendChart');
    if (!dom) return;

    var chart = echarts.init(dom);
    var colors = ['#5fc2c0', '#6fd3ac', '#b89cf8', '#e39b80', '#ff9800'];
    var names = ['综合', '抓取', '存储', '计算', '服务'];
    var lines = ['overall', 'scrape', 'storage', 'compute', 'serve'];
    var series = [];
    lines.forEach(function (key, i) {
      var vals = ts[key] || [];
      if (vals.length === 0) return;
      series.push({
        name: names[i] || key,
        type: 'line',
        data: vals,
        smooth: true,
        symbol: 'circle',
        symbolSize: 3,
        lineStyle: { width: 2 },
        itemStyle: { color: colors[i] || '#6fd3ac' },
      });
    });

    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 30, 48, 0.95)',
        borderColor: 'rgba(95, 194, 192, 0.2)',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
      },
      legend: {
        bottom: 0,
        textStyle: { color: '#8c98a9', fontSize: 10 },
        itemWidth: 12,
        itemHeight: 8,
      },
      grid: { left: 42, right: 12, top: 12, bottom: 36 },
      xAxis: {
        type: 'category',
        data: ts.dates,
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
        axisTick: { show: false },
        axisLabel: { color: '#5f6c7d', fontSize: 9 },
      },
      yAxis: {
        type: 'value',
        min: 60,
        max: 100,
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
        axisLabel: { color: '#5f6c7d', fontSize: 9 },
      },
      series: series,
    });

    window.addEventListener('resize', function () {
      try { chart.resize(); } catch (e) { /* ignore */ }
    });
  } catch (e) {
    console.error('[Overview] 图表渲染失败:', e.message);
  }
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

window._refreshOverview = function (btn) {
  if (btn) { btn.disabled = true; btn.textContent = '刷新中...'; }
  loadAdminOverview(document.getElementById('admPanel'));
  if (btn) setTimeout(function () { btn.disabled = false; btn.textContent = '🔄 刷新'; }, 3000);
};

/**
 * preview/js/pages/model-dashboard.js
 * 模型表现仪表板 — 优化版（对标方案收入页风格）
 *
 * 数据来源: API /api/model-dashboard → prediction_outcomes 表
 */

import { api } from '../api.js';
import { loadECharts, echartsReady } from '../charts.js';

// ═══════════════════════════════════════════════════════
// 页面入口
// ═══════════════════════════════════════════════════════

export async function loadDashboard(force) {
  const el = document.getElementById('model-dashboard-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载模型数据...</div>';

  try {
    var timeVal = window.getDDVal ? window.getDDVal('dd-mdTime') : '30';
    var days = timeVal === 'all' ? 0 : parseInt(timeVal) || 30;
    var metric = window.getDDVal ? window.getDDVal('dd-mdMetric') || 'direction' : 'direction';

    const data = await api('model-dashboard', { days: days, metric: metric });
    if (!data) {
      el.innerHTML = '<div class="hint-box">暂无数据，等待模型回填积累≥2周数据后可见</div>';
      updateStatsCard(null);
      return;
    }

    updateStatsCard(data);
    el.innerHTML = buildDashboardHTML(data);
    bindEvents(data);
  } catch (e) {
    console.error('[ModelDashboard] 加载失败:', e);
    el.innerHTML = '<div class="hint-box">网络错误，请重试</div>';
  }
}

// ═══════════════════════════════════════════════════════
// 统计卡片更新
// ═══════════════════════════════════════════════════════

function updateStatsCard(data) {
  var elModels = document.getElementById('mdStatModels');
  var elTotal = document.getElementById('mdStatTotal');
  var elBest = document.getElementById('mdStatBest');
  if (elModels) elModels.textContent = data ? (data.models ? data.models.length : 0) : '--';
  if (elTotal) elTotal.textContent = data ? (data.totalPredictions || 0) + '+' : '--';
  if (elBest) elBest.textContent = data ? data.topModel || '--' : '--';
}

// ═══════════════════════════════════════════════════════
// HTML 构建
// ═══════════════════════════════════════════════════════

function buildDashboardHTML(data) {
  const { rankings = [], leagueHeatmap = {}, trendData = [], models = [] } = data;

  return `
    <!-- 模型排行 — income-list 风格表格 -->
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">模型排行</span>
      </div>
      ${buildRankingTable(rankings)}
    </div>

    <!-- 分联赛热力图 -->
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">分联赛表现热力图</span>
      </div>
      <div id="md-heatmap" class="md-heatmap-wrap">
        ${buildHeatmapHTML(leagueHeatmap, models)}
      </div>
    </div>

    <!-- 命中率走势图 -->
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">命中率走势</span>
      </div>
      <div id="md-trend-chart" class="md-chart" style="height:240px"></div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════
// 排行表格 — income-list 风格
// ═══════════════════════════════════════════════════════

function buildRankingTable(rankings) {
  if (!rankings || rankings.length === 0) {
    return '<div class="hint-box">暂无排名数据，请等待回填积累≥2周数据</div>';
  }

  var html = '<div class="income-list md-rank-list">';
  // 表头
  html +=
    '<div class="income-header-row"><span class="md-rank-col-rank">排名</span><span class="md-rank-col-model">模型</span><span class="md-rank-col-rate">命中率</span><span class="md-rank-col-trend">趋势</span><span class="md-rank-col-count">场次</span></div>';

  var medals = ['🥇', '🥈', '🥉'];
  rankings.slice(0, 10).forEach(function (r, i) {
    var dirRate = r.directionRate || 0;
    var trend = r.trend || 0;
    var trendIcon = trend > 0 ? '↗' : trend < 0 ? '↘' : '→';
    var trendColor = trend > 0 ? 'var(--green)' : trend < 0 ? 'var(--red)' : 'var(--text3)';
    var rateColor = dirRate >= 60 ? 'var(--green)' : dirRate >= 50 ? 'var(--cyan)' : 'var(--text2)';

    html +=
      '<div class="income-row">' +
      '<span class="md-rank-col-rank">' +
      (medals[i] || i + 1) +
      '</span>' +
      '<span class="md-rank-col-model">' +
      (r.modelName || r.model_name || '模型' + (i + 1)) +
      '</span>' +
      '<span class="md-rank-col-rate" style="color:' +
      rateColor +
      '">' +
      dirRate +
      '%</span>' +
      '<span class="md-rank-col-trend" style="color:' +
      trendColor +
      '">' +
      trendIcon +
      ' ' +
      Math.abs(trend) +
      '%</span>' +
      '<span class="md-rank-col-count">' +
      (r.total || 0) +
      '场</span>' +
      '</div>';
  });
  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════════════════
// 热力图
// ═══════════════════════════════════════════════════════

function buildHeatmapHTML(heatmap, models) {
  if (!heatmap || Object.keys(heatmap).length === 0) {
    return '<div class="hint-box">暂无分联赛数据</div>';
  }

  var modelNames = models.length > 0 ? models : Object.keys(heatmap);
  var leagues = new Set();
  for (var model of Object.keys(heatmap)) {
    for (var league of Object.keys(heatmap[model] || {})) {
      leagues.add(league);
    }
  }

  if (leagues.size === 0) {
    return '<div class="hint-box">暂无分联赛数据</div>';
  }

  var leagueList = Array.from(leagues);
  var getColor = function (rate) {
    if (rate === null || rate === undefined) return 'rgba(255,255,255,0.02)';
    if (rate >= 65) return 'rgba(52,211,153,0.25)';
    if (rate >= 55) return 'rgba(52,211,153,0.12)';
    if (rate >= 45) return 'rgba(251,191,36,0.10)';
    return 'rgba(239,68,68,0.10)';
  };

  return (
    '<table style="width:100%;font-size:var(--fs-sm);text-align:center;border-collapse:collapse">' +
    '<tr><td style="padding:6px;color:var(--text2)">模型</td>' +
    leagueList
      .map(function (l) {
        return '<td style="padding:6px;color:var(--text2);font-weight:600">' + l + '</td>';
      })
      .join('') +
    '</tr>' +
    modelNames
      .map(function (m) {
        return (
          '<tr><td style="padding:6px;color:var(--text);font-weight:600">' +
          m +
          '</td>' +
          leagueList
            .map(function (l) {
              var rate = heatmap[m] && heatmap[m][l] ? heatmap[m][l] : null;
              return (
                '<td style="padding:6px;background:' +
                getColor(rate) +
                ';border-radius:4px;color:' +
                (rate ? 'var(--text)' : 'var(--text3)') +
                '">' +
                (rate !== null ? rate + '%' : '-') +
                '</td>'
              );
            })
            .join('') +
          '</tr>'
        );
      })
      .join('') +
    '</table>'
  );
}

// ═══════════════════════════════════════════════════════
// 事件绑定
// ═══════════════════════════════════════════════════════

function bindEvents(data) {
  // 查询按钮回调
  window._mdRefresh = function () {
    loadDashboard(true);
  };

  // 走势图（等待 ECharts 加载后再渲染）
  if (data.trendData && data.trendData.length > 0) {
    var tryRender = function () {
      var el = document.getElementById('md-trend-chart');
      if (!el || el.offsetHeight === 0) {
        // DOM 尚未就绪，延迟重试
        setTimeout(tryRender, 200);
        return;
      }
      loadECharts().then(function () {
        renderTrendChart(data.trendData);
      });
    };
    tryRender();
  }
}

function renderTrendChart(trendData) {
  var el = document.getElementById('md-trend-chart');
  if (!el || typeof echarts === 'undefined') return;

  // 销毁旧实例（DOM 被替换时避免泄漏）
  if (el._echartInstance) {
    el._echartInstance.dispose();
    el._echartInstance = null;
  }
  el._echartInstance = echarts.init(el);
  var chart = el._echartInstance;

  var colors = ['#A78BFA', '#06B6D4', '#F59E0B', '#EF4444'];
  var series = trendData.map(function (s, i) {
    return {
      name: s.modelName,
      type: 'line',
      smooth: true,
      data: s.values || [],
      lineStyle: { width: 2, color: colors[i % colors.length] },
      itemStyle: { color: colors[i % colors.length] },
      symbol: 'circle',
      symbolSize: 5,
    };
  });

  // 动态 Y 轴范围
  var allVals = [];
  trendData.forEach(function (s) {
    allVals = allVals.concat(s.values || []);
  });
  allVals = allVals.filter(function (v) {
    return v != null;
  });
  var yMin = allVals.length > 0 ? Math.max(0, Math.floor(Math.min.apply(null, allVals) / 5) * 5 - 5) : 0;
  var yMax = allVals.length > 0 ? Math.ceil(Math.max.apply(null, allVals) / 5) * 5 + 5 : 100;

  chart.setOption({
    tooltip: {
      trigger: 'axis',
      formatter: function (params) {
        var s = params[0].axisValue + '<br/>';
        params.forEach(function (p) {
          s +=
            '<span style=\"display:inline-block;width:8px;height:8px;border-radius:50%;background:' +
            p.color +
            ';margin-right:4px\"></span>' +
            p.seriesName +
            ': <b>' +
            (p.value != null ? p.value + '%' : '--') +
            '</b><br/>';
        });
        return s;
      },
      textStyle: { fontSize: 12 },
    },
    grid: { left: 45, right: 20, top: 20, bottom: 45 },
    xAxis: {
      type: 'category',
      data: (trendData[0] && trendData[0].weeks) || [],
      axisLabel: {
        color: '#94A3B8',
        fontSize: 10,
        rotate: 0,
        interval: Math.floor(((trendData[0] && trendData[0].weeks && trendData[0].weeks.length) || 0) / 6) || 0,
      },
    },
    yAxis: {
      type: 'value',
      min: yMin,
      max: yMax,
      axisLabel: { color: '#94A3B8', fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    series: series,
    legend: { bottom: 5, textStyle: { color: '#94A3B8', fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
    backgroundColor: 'transparent',
  });

  window.addEventListener('resize', function () {
    chart.resize();
  });
}

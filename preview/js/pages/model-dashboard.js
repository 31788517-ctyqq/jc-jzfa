/**
 * preview/js/pages/model-dashboard.js
 * 模型表现仪表板 — 优化版（对标方案收入页风格）
 *
 * 数据来源: API /api/model-dashboard → prediction_outcomes 表
 */

import { api } from '../api.js';
import { loadECharts, echartsReady } from '../charts.js?v=202606080308';

const INTERNAL_MODEL_NAMES = ['data_fusion', 'market_signal'];
let _mdResizeHandler = null; // ★ P1-4: 命名 resize handler，避免重复绑定泄漏

function isInternalModelName(name) {
  return INTERNAL_MODEL_NAMES.indexOf(String(name || '')) >= 0;
}

function filterDashboardData(data) {
  if (!data) return data;
  const rankings = (data.rankings || []).filter(function (r) {
    return !isInternalModelName(r.modelName || r.model_name);
  });
  const models = (data.models || []).filter(function (name) {
    return !isInternalModelName(name);
  });
  const heatmap = {};
  Object.keys(data.leagueHeatmap || {}).forEach(function (name) {
    if (!isInternalModelName(name)) heatmap[name] = data.leagueHeatmap[name];
  });
  const trendData = (data.trendData || []).filter(function (item) {
    return !isInternalModelName(item.modelName || item.model_name);
  });
  const playMatrix = (data.playMatrix || []).filter(function (item) {
    return !isInternalModelName(item.modelName || item.model_name);
  });
  const weightSuggestions = (data.weightSuggestions || []).filter(function (item) {
    return !isInternalModelName(item.modelName || item.model_name);
  });
  return Object.assign({}, data, {
    rankings: rankings,
    models: models,
    leagueHeatmap: heatmap,
    trendData: trendData,
    playMatrix: playMatrix,
    weightSuggestions: weightSuggestions,
    totalPredictions: rankings.reduce(function (sum, r) {
      return sum + (r.total || 0);
    }, 0),
    topModel: rankings.length > 0 ? rankings[0].modelName || rankings[0].model_name : null,
  });
}

// ═══════════════════════════════════════════════════════

// 页面入口
// ═══════════════════════════════════════════════════════

export async function loadDashboard(force) {
  const el = document.getElementById('model-dashboard-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载模型数据...</div>';

  try {
    const timeVal = window.getDDVal ? window.getDDVal('dd-mdTime') : '30';
    const days = timeVal === 'all' ? 0 : parseInt(timeVal) || 30;
    const metric = window.getDDVal ? window.getDDVal('dd-mdMetric') || 'direction' : 'direction';

    const data = filterDashboardData(await api('model-dashboard', { days: days, metric: metric }));
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
  const elModels = document.getElementById('mdStatModels');
  const elTotal = document.getElementById('mdStatTotal');
  const elBest = document.getElementById('mdStatBest');
  if (elModels)
    elModels.textContent = data
      ? data.reliabilitySummary
        ? data.reliabilitySummary.activeModels
        : data.models
          ? data.models.length
          : 0
      : '--';
  if (elTotal)
    elTotal.textContent = data
      ? (data.reliabilitySummary ? data.reliabilitySummary.validSamples : data.totalPredictions || 0) + '+'
      : '--';
  if (elBest) elBest.textContent = data ? data.bestStableModel || data.topModel || '--' : '--';
}

// ═══════════════════════════════════════════════════════
// HTML 构建
// ═══════════════════════════════════════════════════════

function buildDashboardHTML(data) {
  const {
    rankings = [],
    leagueHeatmap = {},
    trendData = [],
    models = [],
    playMatrix = [],
    reliabilitySummary = {},
    weightSuggestions = [],
  } = data;

  return `
    ${buildReliabilitySummary(reliabilitySummary)}
    <!-- 模型排行 — reliability 风格表格 -->
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">可靠性排行</span>
      </div>
      ${buildRankingTable(rankings)}
    </div>

    <!-- 玩法矩阵 -->
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">玩法矩阵</span>
      </div>
      ${buildPlayMatrix(playMatrix)}
    </div>

    <!-- 权重建议 -->
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">权重建议（只读）</span>
      </div>
      ${buildWeightSuggestions(weightSuggestions)}
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

function buildReliabilitySummary(summary) {
  summary = summary || {};
  return (
    '<div class="md-reliability-summary" id="mdReliabilitySummary">' +
    '<div><b>活跃模型</b><span>' +
    (summary.activeModels || 0) +
    '</span></div>' +
    '<div><b>有效样本</b><span>' +
    (summary.validSamples || 0) +
    '</span></div>' +
    '<div><b>最佳稳定模型</b><span>' +
    esc(summary.bestStableModel || '--') +
    '</span></div>' +
    '<div><b>模型健康</b><span>' +
    (summary.health === 'stable' ? '稳定' : '样本不足') +
    '</span></div>' +
    '<em>' +
    esc(summary.note || '动态权重仅作只读建议，不自动覆盖生产规则') +
    '</em></div>'
  );
}

function buildRankingTable(rankings) {
  if (!rankings || rankings.length === 0) {
    return '<div class="hint-box">暂无排名数据，请等待回填积累≥2周数据</div>';
  }

  let html = '<div class="income-list md-rank-list">';
  // 表头
  html +=
    '<div class="income-header-row"><span class="md-rank-col-rank">排名</span><span class="md-rank-col-model">模型</span><span class="md-rank-col-rate">可靠性</span><span class="md-rank-col-trend">ROI</span><span class="md-rank-col-count">样本</span></div>';

  const medals = ['🥇', '🥈', '🥉'];
  rankings.slice(0, 10).forEach(function (r, i) {
    const reliability = r.reliabilityScore || 0;
    const roi = r.roi || 0;
    const trend = r.trend || 0;
    const trendIcon = trend > 0 ? '↗' : trend < 0 ? '↘' : '→';
    const rateColor = reliability >= 70 ? 'var(--green)' : reliability >= 55 ? 'var(--cyan)' : 'var(--text2)';
    const roiColor = roi > 0 ? 'var(--green)' : roi < 0 ? 'var(--red)' : 'var(--text3)';
    const sampleNote = r.sampleStatus || (r.total < 10 ? '样本不足，仅供观察' : '样本充足');

    html +=
      '<div class="income-row md-rank-row">' +
      '<span class="md-rank-col-rank">' +
      (r.eligibleForRanking === false ? '观察' : medals[i] || i + 1) +
      '</span>' +
      '<span class="md-rank-col-model">' +
      esc(r.modelName || r.model_name || '模型' + (i + 1)) +
      '<em>' +
      esc(r.calibrationStatus || '较准确') +
      '｜稳定 ' +
      (r.stabilityScore || 0) +
      '</em></span>' +
      '<span class="md-rank-col-rate" style="color:' +
      rateColor +
      '">' +
      reliability +
      '</span>' +
      '<span class="md-rank-col-trend" style="color:' +
      roiColor +
      '">' +
      fmtROI(roi) +
      '<em>' +
      trendIcon +
      Math.abs(trend) +
      '%</em></span>' +
      '<span class="md-rank-col-count">' +
      (r.total || 0) +
      '场<em>' +
      esc(sampleNote) +
      '</em></span>' +
      '</div>';
  });
  html += '</div>';
  return html;
}

function fmtROI(v) {
  if (v === undefined || v === null || isNaN(v)) return '-';
  const n = Number(v) * 100;
  return (n > 0 ? '+' : '') + Math.round(n) + '%';
}

function fmtRate(v) {
  if (v === null || v === undefined || isNaN(v)) return '-';
  return Math.round(Number(v)) + '%';
}

function buildPlayMatrix(playMatrix) {
  if (!playMatrix || playMatrix.length === 0) return '<div class="hint-box">暂无玩法矩阵数据</div>';
  const plays = [
    ['spf', 'SPF'],
    ['handicap', '让球'],
    ['overUnder', '大小球'],
    ['score', '比分'],
  ];
  let html = '<div class="md-play-matrix">';
  html +=
    '<div class="md-play-row md-play-head"><span>模型</span>' +
    plays
      .map(function (p) {
        return '<span>' + p[1] + '</span>';
      })
      .join('') +
    '</div>';
  playMatrix.slice(0, 8).forEach(function (m) {
    html += '<div class="md-play-row"><span class="md-play-model">' + esc(m.modelName || '-') + '</span>';
    plays.forEach(function (p) {
      const d = m[p[0]] || {};
      html +=
        '<span class="md-play-cell"><b>' +
        fmtRate(d.hitRate) +
        '</b><em>' +
        (d.sample || 0) +
        '场｜ROI ' +
        fmtROI(d.roi) +
        '</em></span>';
    });
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function buildWeightSuggestions(items) {
  if (!items || items.length === 0) return '<div class="hint-box">暂无权重建议；样本不足时不生成生产权重</div>';
  return (
    '<div class="md-weight-list">' +
    items
      .map(function (item) {
        return (
          '<div class="md-weight-row"><b>' +
          esc(item.modelName || '-') +
          '</b><span>' +
          Math.round((item.suggestedWeight || 0) * 100) +
          '%</span><em>' +
          esc(item.reason || '只读建议') +
          '</em></div>'
        );
      })
      .join('') +
    '</div>'
  );
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ═══════════════════════════════════════════════════════
// 热力图
// ═══════════════════════════════════════════════════════

function buildHeatmapHTML(heatmap, models) {
  if (!heatmap || Object.keys(heatmap).length === 0) {
    return '<div class="hint-box">暂无分联赛数据</div>';
  }

  const modelNames = models.length > 0 ? models : Object.keys(heatmap);
  const leagues = new Set();
  for (const model of Object.keys(heatmap)) {
    for (const league of Object.keys(heatmap[model] || {})) {
      leagues.add(league);
    }
  }

  if (leagues.size === 0) {
    return '<div class="hint-box">暂无分联赛数据</div>';
  }

  const leagueList = Array.from(leagues);
  const getColor = function (rate) {
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
              const rate = heatmap[m] && heatmap[m][l] ? heatmap[m][l] : null;
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
    const tryRender = function () {
      const el = document.getElementById('md-trend-chart');
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
  const el = document.getElementById('md-trend-chart');
  if (!el || typeof echarts === 'undefined') return;

  // 销毁旧实例（DOM 被替换时避免泄漏）
  if (el._echartInstance) {
    el._echartInstance.dispose();
    el._echartInstance = null;
  }
  el._echartInstance = echarts.init(el);
  const chart = el._echartInstance;

  const colors = ['#A78BFA', '#06B6D4', '#F59E0B', '#EF4444'];
  const series = trendData.map(function (s, i) {
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
  let allVals = [];
  trendData.forEach(function (s) {
    allVals = allVals.concat(s.values || []);
  });
  allVals = allVals.filter(function (v) {
    return v != null;
  });
  const yMin = allVals.length > 0 ? Math.max(0, Math.floor(Math.min.apply(null, allVals) / 5) * 5 - 5) : 0;
  const yMax = allVals.length > 0 ? Math.ceil(Math.max.apply(null, allVals) / 5) * 5 + 5 : 100;

  chart.setOption({
    tooltip: {
      trigger: 'axis',
      formatter: function (params) {
        let s = params[0].axisValue + '<br/>';
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

  if (_mdResizeHandler) window.removeEventListener('resize', _mdResizeHandler);
  _mdResizeHandler = function () {
    chart.resize();
  };
  window.addEventListener('resize', _mdResizeHandler);
}

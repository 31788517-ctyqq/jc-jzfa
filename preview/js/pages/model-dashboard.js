/**
 * preview/js/pages/model-dashboard.js
 * 模型表现仪表板 — 蓝图 §17.6
 *
 * 展示各模型的近30日方向/大小球/比分命中率排行、分联赛热力图、命中率走势
 * 数据来源: API /api/model-dashboard → prediction_outcomes 表
 */

import { api } from '../api.js';

// ═══════════════════════════════════════════════════════
// 页面入口
// ═══════════════════════════════════════════════════════

export async function loadDashboard() {
  const el = document.getElementById('model-dashboard-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载模型数据...</div>';

  try {
    const data = await api('model-dashboard', { days: 30 });
    if (!data) {
      el.innerHTML = '<div class="empty-state">暂无数据，等待模型回填积累≥2周数据后可见</div>';
      return;
    }

    el.innerHTML = buildDashboardHTML(data);
    bindEvents(data);
  } catch (e) {
    console.error('[ModelDashboard] 加载失败:', e);
    el.innerHTML = '<div class="empty-state">网络错误，请重试</div>';
  }
}

// ═══════════════════════════════════════════════════════
// HTML 构建
// ═══════════════════════════════════════════════════════

function buildDashboardHTML(data) {
  const { rankings = [], leagueHeatmap = {}, trendData = [], models = [] } = data;

  return `
    <!-- 模型排行 -->
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">模型排行 (近30日)</span>
        <select id="md-ranking-metric" class="chart-select" onchange="window._mdSwitchMetric &amp;&amp; window._mdSwitchMetric()">
          <option value="direction">方向命中率</option>
          <option value="over_under">大小球命中率</option>
          <option value="score">比分命中率</option>
        </select>
      </div>
      <div class="md-ranking-table">
        ${buildRankingTable(rankings)}
      </div>
    </div>

    <!-- 分联赛热力图 -->
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">分联赛表现热力图</span>
        <span class="chart-hint">绿色=高命中 红色=低命中</span>
      </div>
      <div id="md-heatmap" class="md-heatmap-wrap">
        ${buildHeatmapHTML(leagueHeatmap, models)}
      </div>
    </div>

    <!-- 命中率走势图 -->
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">命中率走势</span>
        <span class="chart-hint">周级滚动窗口</span>
      </div>
      <div id="md-trend-chart" class="md-chart" style="height:240px"></div>
    </div>

    <!-- 统计数据 -->
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">统计概览</span>
      </div>
      <div class="filter-stats-row">
        <div class="filter-stat-item">
          <div class="filter-stat-value">${models.length || 6}</div>
          <div class="filter-stat-label">活跃模型</div>
        </div>
        <div class="filter-stat-divider"></div>
        <div class="filter-stat-item">
          <div class="filter-stat-value">${(data.totalPredictions || 0)}+</div>
          <div class="filter-stat-label">总预测</div>
        </div>
        <div class="filter-stat-divider"></div>
        <div class="filter-stat-item">
          <div class="filter-stat-value">${data.topModel || '--'}</div>
          <div class="filter-stat-label">最佳模型</div>
        </div>
      </div>
    </div>
  `;
}

function buildRankingTable(rankings) {
  if (!rankings || rankings.length === 0) {
    return '<div class="empty-state">暂无排名数据，请等待回填积累≥2周数据</div>';
  }

  const medals = ['🥇', '🥈', '🥉'];
  return rankings.slice(0, 10).map((r, i) => {
    const dirRate = r.directionRate || 0;
    const trend = r.trend || 0;
    const trendIcon = trend > 0 ? '↗' : trend < 0 ? '↘' : '→';
    const trendColor = trend > 0 ? 'var(--green)' : trend < 0 ? 'var(--red)' : 'var(--text2)';

    return `
      <div class="dir-item" style="padding:10px 0">
        <span style="width:32px;text-align:center">${medals[i] || (i + 1)}</span>
        <span class="dir-item-name" style="flex:1">${r.modelName || r.model_name}</span>
        <span style="width:60px;text-align:center;color:var(--green);font-weight:700">${dirRate}%</span>
        <span style="width:50px;text-align:center;color:${trendColor}">${trendIcon} ${Math.abs(trend)}%</span>
        <span style="width:50px;text-align:center;color:var(--text2)">${r.total || 0}场</span>
      </div>
    `;
  }).join('');
}

function buildHeatmapHTML(heatmap, models) {
  if (!heatmap || Object.keys(heatmap).length === 0) {
    return '<div class="empty-state">暂无分联赛数据</div>';
  }

  const modelNames = models.length > 0 ? models : Object.keys(heatmap);
  const leagues = new Set();
  for (const model of Object.keys(heatmap)) {
    for (const league of Object.keys(heatmap[model] || {})) {
      leagues.add(league);
    }
  }

  if (leagues.size === 0) {
    return '<div class="empty-state">暂无分联赛数据</div>';
  }

  const leagueList = [...leagues];
  const getColor = (rate) => {
    if (rate === null || rate === undefined) return 'rgba(255,255,255,0.02)';
    if (rate >= 65) return 'rgba(52,211,153,0.25)';
    if (rate >= 55) return 'rgba(52,211,153,0.12)';
    if (rate >= 45) return 'rgba(251,191,36,0.10)';
    return 'rgba(239,68,68,0.10)';
  };

  return `
    <table style="width:100%;font-size:var(--fs-sm);text-align:center;border-collapse:collapse">
      <tr>
        <td style="padding:6px;color:var(--text2)">模型</td>
        ${leagueList.map(l => `<td style="padding:6px;color:var(--text2);font-weight:600">${l}</td>`).join('')}
      </tr>
      ${modelNames.map(m => `
        <tr>
          <td style="padding:6px;color:var(--text);font-weight:600">${m}</td>
          ${leagueList.map(l => {
            const rate = (heatmap[m] && heatmap[m][l]) ? heatmap[m][l] : null;
            return `<td style="padding:6px;background:${getColor(rate)};border-radius:4px;color:${rate ? 'var(--text)' : 'var(--text3)'}">${rate !== null ? rate + '%' : '-'}</td>`;
          }).join('')}
        </tr>
      `).join('')}
    </table>
  `;
}

// ═══════════════════════════════════════════════════════
// 事件绑定
// ═══════════════════════════════════════════════════════

function bindEvents(data) {
  // 排行榜计量切换
  window._mdSwitchMetric = function() {
    const sel = document.getElementById('md-ranking-metric');
    if (!sel) return;
    const metric = sel.value;
    // 重新排列表格行
    const tbody = document.querySelector('.md-ranking-table');
    if (tbody) {
      loadDashboard(); // 简化处理：重新加载
    }
  };

  // 走势图（如果有 ECharts）
  if (data.trendData && data.trendData.length > 0) {
    try {
      renderTrendChart(data.trendData);
    } catch (e) {
      console.log('[ModelDashboard] 走势图渲染跳过（ECharts 可能未加载）');
    }
  }
}

function renderTrendChart(trendData) {
  const el = document.getElementById('md-trend-chart');
  if (!el || typeof echarts === 'undefined') return;

  const chart = echarts.init(el);
  const series = trendData.map(s => ({
    name: s.modelName,
    type: 'line',
    smooth: true,
    data: s.values || [],
    lineStyle: { width: 2 },
  }));

  chart.setOption({
    grid: { left: 40, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'category', data: trendData[0]?.weeks || [], axisLabel: { color: '#94A3B8', fontSize: 11 } },
    yAxis: { type: 'value', min: 40, max: 70, axisLabel: { color: '#94A3B8', formatter: '{value}%' } },
    series,
    legend: { bottom: 0, textStyle: { color: '#94A3B8', fontSize: 11 } },
    backgroundColor: 'transparent',
  });
}

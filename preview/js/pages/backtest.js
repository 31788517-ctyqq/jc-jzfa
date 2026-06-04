/**
 * preview/js/pages/backtest.js — V9 三Tab回测分析页
 * Tab: GS功守道 | AI深度分析 | PK融合分析
 * 每个Tab独立：统计卡片 + ECharts图表 + 明细列表
 */
import { api } from '../api.js';
import { loadECharts } from '../charts.js';

var _btPage = 1,
  _btPageSize = 20,
  _btLeagues = [],
  _btTab = 'gs',
  _btStats = null,
  _btItems = [],
  _btChartInst = {}; // 三Tab各一个ECharts实例

export function loadBacktest() {
  try {
    var el = document.getElementById('page-backtest');
    if (!el) { console.error('[BT] #page-backtest not found'); return; }
    el.innerHTML = renderPage();
    injectStyles();
    _btTab = 'gs';
    _btPage = 1;
    _btChartInst = {};
    fetchData();
  } catch (e) {
    console.error('[BT] loadBacktest error:', e);
    var el2 = document.getElementById('page-backtest');
    if (el2) el2.innerHTML = '<div style="color:red;padding:20px;">回测页面加载失败: ' + e.message + '</div>';
  }
}

/* ═══════════════════════ CSS ═══════════════════════ */
function injectStyles() {
  if (document.getElementById('bt-inline-css')) return;
  var s = document.createElement('style');
  s.id = 'bt-inline-css';
  s.textContent = [
    // Tab bar
    '.bt-tab-row { display:flex; gap:4px; padding:0 10px 8px; border-bottom:1px solid rgba(255,255,255,0.06); }',
    '.bt-tab-btn { flex:1; text-align:center; padding:8px 4px; font-size:13px; font-weight:600; color:var(--text3); cursor:pointer; border-radius:10px; transition:all .2s; position:relative; }',
    '.bt-tab-btn:hover { color:var(--text2); }',
    '.bt-tab-btn.active { color:var(--cyan); background:rgba(24,224,224,0.08); }',
    '.bt-tab-btn.active::after { content:""; position:absolute; bottom:-4px; left:20%; right:20%; height:2px; background:var(--cyan); border-radius:1px; }',

    // Stats sub row (below scheme-stats-card)
    '.bt-tab-stats .scheme-stats-card { flex-wrap: wrap; }',
    '.bt-stat-sub { width:100%; font-size:10px; color:var(--text3); margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.06); display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }',
    '.bt-stat-sub span { white-space:nowrap; }',

    // Tab stats container
    '.bt-tab-stats { display:none; }',
    '.bt-tab-stats.active { display:block; }',

    // Chart
    '.bt-chart-wrap { display:none; margin:0 0 10px; background:var(--card); border:1px solid var(--card-border); border-radius:22px; padding:12px 10px 8px; overflow:hidden; }',
    '.bt-chart-wrap.active { display:block; }',
    '.bt-chart-inner { width:100%; height:260px; }',
    '.bt-chart-toggle { display:flex; gap:4px; margin-bottom:6px; }',
    '.bt-chart-toggle-btn { font-size:11px; padding:3px 10px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); background:transparent; color:var(--text3); cursor:pointer; transition:all .15s; }',
    '.bt-chart-toggle-btn.active { background:rgba(24,224,224,0.12); color:var(--cyan); border-color:var(--cyan); }',

    // Pager
    '.bt-pager-wrap { display:flex; justify-content:center; align-items:center; gap:6px; padding:16px 0; flex-wrap:wrap; }',
    '.bt-pager-btn { min-width:32px; height:32px; padding:0 6px; border-radius:8px; border:1px solid rgba(255,255,255,0.1); background:transparent; color:var(--text2); font-size:13px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; transition:all .15s; }',
    '.bt-pager-btn:hover { border-color:rgba(255,255,255,0.25); color:#fff; }',
    '.bt-pager-btn.active { background:var(--cyan); color:var(--bg); border-color:var(--cyan); font-weight:700; }',
    '.bt-pager-btn:disabled { opacity:0.3; cursor:default; pointer-events:none; }',
    '.bt-pager-ellipsis { min-width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; color:var(--text3); font-size:13px; }',
    '.bt-pager-nav { min-width:28px; }',
    '.bt-pager-info { font-size:12px; color:var(--text3); margin:0 8px; white-space:nowrap; }',

    // Prediction highlight
    '.bt-col-num { font-weight:700; font-size:12px; }',
    '.bt-col-league { font-size:9px; color:var(--text3); display:block; line-height:1.3; }',
    '.bt-col-home { font-weight:500; font-size:12px; line-height:1.4; }',
    '.bt-col-score { font-weight:700; font-size:13px; color:var(--cyan); padding:1px 0; line-height:1.4; }',
    '.bt-col-away { font-weight:500; font-size:12px; color:var(--text2); line-height:1.4; }',
    '.bt-col-hcp { font-size:9px; color:var(--amber); font-weight:400; margin-left:2px; }',
    '.bt-col-pred { flex:1; display:flex; flex-direction:column; gap:2px; align-items:flex-end; }',
    '.bt-pred-item { font-size:10px; line-height:1.5; white-space:nowrap; }',
    '.bt-pred-item .pred-label { color:var(--text3); margin-right:2px; }',
    '.bt-pred-item .pred-val { font-weight:600; }',
    '.bt-pred-item .pred-hit { color:var(--green); }',
    '.bt-pred-item .pred-miss { color:var(--red); }',
    '.bt-pred-dim { opacity:0.35; }',
    '.bt-summary-bar { display:flex; justify-content:flex-start; align-items:center; padding:4px 4px 8px; color:var(--text3); font-size:12px; }',
  ].join('\n');
  document.head.appendChild(s);
}

/* ═══════════════════════ Page HTML ═══════════════════════ */
function renderPage() {
  return [
    // Tab bar
    '<div class="filter-row" id="btTabRow">',
    '<div class="filter-tag active" data-tab="gs" onclick="btSwitchTab(\'gs\')">功守道量化</div>',
    '<div class="filter-tag" data-tab="ai" onclick="btSwitchTab(\'ai\')">AI深度分析</div>',
    '<div class="filter-tag" data-tab="pk" onclick="btSwitchTab(\'pk\')">PK融合分析</div>',
    '<div class="filter-tag" data-tab="experiment" onclick="btSwitchTab(\'experiment\')">实验对比</div>',
    '</div>',

    // Shared filter card
    renderFilterCard(),

    // ── GS Tab Stats ──
    '<div class="bt-tab-stats active" id="btStatsGS">' + renderStatsCard('gs') + '</div>',
    // ── AI Tab Stats ──
    '<div class="bt-tab-stats" id="btStatsAI">' + renderStatsCard('ai') + '</div>',
    // ── PK Tab Stats ──
    '<div class="bt-tab-stats" id="btStatsPK">' + renderStatsCard('pk') + '</div>',
    // ── Experiment Tab (蓝图新增) ──
    '<div class="bt-tab-stats" id="btStatsEXPERIMENT"><div id="btExperimentContent" class="chart-box" style="margin:10px 0"><div class="loading">加载中...</div></div></div>',

    // Chart containers (one per tab)
    '<div class="bt-chart-wrap active" id="btChartGS">',
    '<div class="bt-chart-toggle" id="btChartToggleGS"><button class="bt-chart-toggle-btn active" data-ctype="calibration" onclick="btChartType(\'gs\',\'calibration\')">校准曲线</button><button class="bt-chart-toggle-btn" data-ctype="bar" onclick="btChartType(\'gs\',\'bar\')">分组柱状图</button></div>',
    '<div class="bt-chart-inner" id="btChartInnerGS"></div>',
    '</div>',
    '<div class="bt-chart-wrap" id="btChartAI">',
    '<div class="bt-chart-toggle" id="btChartToggleAI"><button class="bt-chart-toggle-btn active" data-ctype="calibration" onclick="btChartType(\'ai\',\'calibration\')">置信校准曲线</button><button class="bt-chart-toggle-btn" data-ctype="bar" onclick="btChartType(\'ai\',\'bar\')">联赛分组</button></div>',
    '<div class="bt-chart-inner" id="btChartInnerAI"></div>',
    '</div>',
    '<div class="bt-chart-wrap" id="btChartPK">',
    '<div class="bt-chart-toggle" id="btChartTogglePK"><button class="bt-chart-toggle-btn active" data-ctype="calibration" onclick="btChartType(\'pk\',\'calibration\')">信心分校准</button><button class="bt-chart-toggle-btn" data-ctype="stars" onclick="btChartType(\'pk\',\'stars\')">星级校准</button></div>',
    '<div class="bt-chart-inner" id="btChartInnerPK"></div>',
    '</div>',

    // List + pager
    '<div class="bt-summary-bar" id="btSummary" style="display:none;"><span style="color:var(--text3);">AI预测结果仅供参考</span></div>',
    '<div class="backtest-list" id="btList"></div>',
    '<div class="backtest-pager" id="btPager"></div>',
  ].join('');
}

function renderFilterCard() {
  return [
    '<div class="filter-section-card" id="btFilterCard">',
    '<div class="filter-head">筛选条件</div>',
    filterDD('dd-btRange', '时间', [
      { v: 'all', l: '全部时间' },
      { v: '7d', l: '近7天' },
      { v: '30d', l: '近30天' },
      { v: '60d', l: '近60天' },
      { v: '90d', l: '近90天' },
    ]),
    '<div class="filter-row" id="btLeagueRow">',
    '<span class="filter-label">联赛</span>',
    '<div class="filter-dd" id="dd-btLeague" data-val="all">',
    '<div class="filter-dd-trigger" onclick="toggleDD(\'dd-btLeague\', event)">',
    '<span class="filter-dd-text">全部</span>',
    '<svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg>',
    '</div>',
    '<ul class="filter-dd-menu" id="dd-btLeague-menu"><li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-btLeague\',\'all\',\'全部\')">全部</li></ul>',
    '</div></div>',
    '<div class="filter-btn-wrap"><button class="filter-submit-btn" onclick="doBTQuery()">查询</button></div>',
    '</div>',
  ].join('');
}

function filterDD(id, label, opts) {
  var items = '';
  opts.forEach(function (o, i) {
    items += '<li data-val="' + o.v + '" class="filter-dd-option' + (i === 0 ? ' selected' : '') + '" onclick="selectDD(\'' + id + "','" + o.v + "','" + o.l + '\')">' + o.l + '</li>';
  });
  return '<div class="filter-row">' +
    '<span class="filter-label">' + label + '</span>' +
    '<div class="filter-dd" id="' + id + '" data-val="' + opts[0].v + '">' +
    '<div class="filter-dd-trigger" onclick="toggleDD(\'' + id + '\', event)">' +
    '<span class="filter-dd-text">' + opts[0].l + '</span>' +
    '<svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg>' +
    '</div><ul class="filter-dd-menu">' + items + '</ul></div></div>';
}

/* ═══════════════════════ Stats Card Renderers ═══════════════════════ */
function renderStatsCard(tab) {
  if (tab === 'gs') {
    return '<div class="scheme-stats-card">' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val" id="gsTotal">-</div><div class="scheme-stat-lbl">总预测</div></div>' +
      '<div class="scheme-stat-div"></div>' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val bt-amber" id="gsScoreHit">-</div><div class="scheme-stat-lbl">比分命中率</div></div>' +
      '<div class="scheme-stat-div"></div>' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val" id="gsSpfHit">-</div><div class="scheme-stat-lbl">方向命中率</div></div>' +
      '<div class="bt-stat-sub"><span>强一致:<b id="gsStrongHit">-</b></span><span>弱一致:<b id="gsWeakHit">-</b></span><span>熔断:<b id="gsMeltHit">-</b></span></div>' +
      '</div>';
  }
  if (tab === 'ai') {
    return '<div class="scheme-stats-card">' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val" id="aiTotal">-</div><div class="scheme-stat-lbl">总预测</div></div>' +
      '<div class="scheme-stat-div"></div>' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val bt-green" id="aiSpfAcc">-</div><div class="scheme-stat-lbl">SPF命中率</div></div>' +
      '<div class="scheme-stat-div"></div>' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val" id="aiOuAcc">-</div><div class="scheme-stat-lbl">大小球命中</div></div>' +
      '<div class="bt-stat-sub"><span>比分命中:<b id="aiScAcc">-</b></span><span>高信心:<b id="aiHiConf">-</b></span><span>中信心:<b id="aiMidConf">-</b></span></div>' +
      '</div>';
  }
  if (tab === 'pk') {
    return '<div class="scheme-stats-card">' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val" id="pkTotal">-</div><div class="scheme-stat-lbl">总预测</div></div>' +
      '<div class="scheme-stat-div"></div>' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val bt-green" id="pkDirAcc">-</div><div class="scheme-stat-lbl">方向命中率</div></div>' +
      '<div class="scheme-stat-div"></div>' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val" id="pkHcpAcc">-</div><div class="scheme-stat-lbl">让球命中率</div></div>' +
      '<div class="bt-stat-sub"><span>大小球:<b id="pkGoalAcc">-</b></span><span>5★:<b id="pkStar5">-</b></span><span>3-4★:<b id="pkStar34">-</b></span></div>' +
      '</div>';
  }
  return '';
}

/* ═══════════════════════ Tab Switching ═══════════════════════ */
window.btSwitchTab = function (tab) {
  _btTab = tab;
  // Tab buttons
  document.querySelectorAll('#btTabRow .filter-tag').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-tab') === tab);
  });
  // Stats cards
  document.querySelectorAll('.bt-tab-stats').forEach(function (s) { s.classList.remove('active'); });
  var statsEl = document.getElementById('btStats' + tab.toUpperCase());
  if (statsEl) statsEl.classList.add('active');
  // Charts
  document.querySelectorAll('.bt-chart-wrap').forEach(function (c) { c.classList.remove('active'); });
  var chartEl = document.getElementById('btChart' + tab.toUpperCase());
  if (chartEl) chartEl.classList.add('active');
  // Rerender list with tab highlight & render chart
  if (tab !== 'experiment') {
    renderList(_btItems);
    renderChart(tab, 'calibration');
  } else {
    loadExperimentCompare();
  }
};

/* ═══════════════════════ Chart Type Toggle ═══════════════════════ */
window.btChartType = function (tab, ctype) {
  var toggleEl = document.getElementById('btChartToggle' + tab.toUpperCase());
  if (toggleEl) {
    toggleEl.querySelectorAll('.bt-chart-toggle-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-ctype') === ctype);
    });
  }
  renderChart(tab, ctype);
};

/* ═══════════════════════ Data Fetch ═══════════════════════ */
window.doBTQuery = function () {
  _btPage = 1;
  fetchData();
};

function getBTFilters() {
  function v(id) { return window.getDDVal ? window.getDDVal(id) || 'all' : 'all'; }
  return {
    type: 'all',
    dateRange: v('dd-btRange'),
    league: v('dd-btLeague'),
    direction: 'all',
    aiConf: 'all',
    pkConf: 'all',
    consensus: 'all',
  };
}

function populateLeagues(leagues) {
  if (!leagues || !leagues.length) return;
  _btLeagues = leagues;
  var menu = document.getElementById('dd-btLeague-menu');
  if (!menu) return;
  var html = '<li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-btLeague\',\'all\',\'全部\')">全部</li>';
  leagues.forEach(function (lg) {
    html += '<li data-val="' + esc(lg) + '" class="filter-dd-option" onclick="selectDD(\'dd-btLeague\',\'' + esc(lg) + "','" + esc(lg) + '\')">' + esc(lg) + '</li>';
  });
  menu.innerHTML = html;
}

function fetchData() {
  var el = document.getElementById('btList');
  if (el) el.innerHTML = '<div class="plan-notice" style="text-align:center;padding:40px 0;color:var(--text2);">加载中...</div>';

  var f = getBTFilters();
  api('prediction-backtest', {
    type: f.type,
    dateRange: f.dateRange,
    league: f.league,
    direction: f.direction,
    aiConf: f.aiConf,
    pkConf: f.pkConf,
    consensus: f.consensus,
    page: _btPage,
    pageSize: _btPageSize,
  })
    .then(function (res) {
      if (res.leagues) populateLeagues(res.leagues);
      _btStats = res.stats;
      _btItems = res.items || [];
      updateAllStats(res.stats);
      renderList(res.items);
      renderPager(res);
      renderChart(_btTab, 'calibration');
      var s = document.getElementById('btSummary');
      if (s) s.style.display = (res.total || 0) > 0 ? 'flex' : 'none';
    })
    .catch(function (e) {
      console.error('backtest fetch error:', e);
      var el2 = document.getElementById('btList');
      if (el2) el2.innerHTML = '<div class="plan-notice" style="text-align:center;padding:40px 0;color:var(--red);">数据加载失败: ' + e.message + '</div>';
    });
}

/* ═══════════════════════ Stats Update ═══════════════════════ */
function updateAllStats(stats) {
  if (!stats) return;
  // GS
  var gs = stats.gs || {};
  setText('gsTotal', (gs.total || 0).toLocaleString());
  setText('gsScoreHit', fmtPct(gs.score_hit_rate));
  setText('gsSpfHit', fmtPct(gs.spf_hit_rate));
  if (gs.byConsensus) {
    setText('gsStrongHit', fmtPct(gs.byConsensus.strong ? gs.byConsensus.strong.rate : 0));
    setText('gsWeakHit', fmtPct(gs.byConsensus.weak ? gs.byConsensus.weak.rate : 0));
    setText('gsMeltHit', fmtPct(gs.byConsensus.meltdown ? gs.byConsensus.meltdown.rate : 0));
  }
  // AI
  var ai = stats.ai || {};
  setText('aiTotal', (ai.total || 0).toLocaleString());
  setText('aiSpfAcc', fmtPct(ai.spf_accuracy));
  setText('aiOuAcc', fmtPct(ai.ou_accuracy) + ' (' + (ai.ou_total || 0) + ')');
  setText('aiScAcc', fmtPct(ai.score_accuracy) + ' (' + (ai.score_total || 0) + ')');
  if (ai.byConfidence) {
    var hi = ai.byConfidence.find(function (b) { return b.label === '90-100' || b.label === '80-89'; }) || {};
    var mid = ai.byConfidence.find(function (b) { return b.label === '70-79' || b.label === '60-69'; }) || {};
    setText('aiHiConf', fmtPct(hi.rate || 0));
    setText('aiMidConf', fmtPct(mid.rate || 0));
  }
  // PK
  var pk = stats.pk || {};
  setText('pkTotal', (pk.total || 0).toLocaleString());
  setText('pkDirAcc', fmtPct(pk.direction_accuracy));
  setText('pkHcpAcc', fmtPct(pk.hcp_accuracy) + ' (' + (pk.hcp_total || 0) + ')');
  setText('pkGoalAcc', fmtPct(pk.goal_accuracy) + ' (' + (pk.goal_total || 0) + ')');
  if (pk.byStars) {
    var star5 = pk.byStars.find(function (b) { return b.stars === 5; }) || {};
    var star34 = pk.byStars.filter(function (b) { return b.stars === 3 || b.stars === 4; });
    var s34t = 0, s34h = 0;
    star34.forEach(function (s) { s34t += s.total; s34h += s.hit; });
    setText('pkStar5', fmtPct(star5.rate || 0));
    setText('pkStar34', fmtPct(s34t > 0 ? s34h / s34t : 0));
  }
}

function setText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}

function fmtPct(v) {
  if (v === undefined || v === null || isNaN(v)) return '-';
  return Math.round(v * 100) + '%';
}

/* ═══════════════════════ ECharts Rendering ═══════════════════════ */
function renderChart(tab, ctype) {
  var innerEl = document.getElementById('btChartInner' + tab.toUpperCase());
  if (!innerEl) return;
  loadECharts().then(function () {
    if (typeof echarts === 'undefined') { innerEl.innerHTML = '<div style="color:var(--text3);text-align:center;padding:60px 0;">图表组件加载中...</div>'; return; }
    // Dispose old instance
    if (_btChartInst[tab]) { _btChartInst[tab].dispose(); _btChartInst[tab] = null; }
    innerEl.innerHTML = '';
    var inst = echarts.init(innerEl);
    _btChartInst[tab] = inst;

    // 所有图表统一暗色背景
    var baseOpt = {
      backgroundColor: 'transparent',
      textStyle: { color: '#94A3B8', fontSize: 11 },
      legend: { textStyle: { color: '#94A3B8' } },
    };

    if (tab === 'gs') {
      var opt = ctype === 'calibration' ? gsCalibrationOption(_btStats) : gsBarOption(_btStats);
      inst.setOption(Object.assign({}, baseOpt, opt));
    } else if (tab === 'ai') {
      var opt = ctype === 'calibration' ? aiCalibrationOption(_btStats) : aiBarOption(_btStats);
      inst.setOption(Object.assign({}, baseOpt, opt));
    } else if (tab === 'pk') {
      if (ctype === 'calibration') { inst.setOption(Object.assign({}, baseOpt, pkCalibrationOption(_btStats))); }
      else if (ctype === 'stars') { inst.setOption(Object.assign({}, baseOpt, pkStarsOption(_btStats))); }
    }

    window.addEventListener('resize', function () { try { inst.resize(); } catch (e) {} });
  });
}

/* ── GS 校准曲线：预测概率 vs 实际命中率 ── */
function gsCalibrationOption(stats) {
  var data = (stats && stats.gs && stats.gs.calibration) || [];
  if (!data.length) return { title: { text: '暂无足够数据', left: 'center', top: 'center', textStyle: { color: '#64748B' } } };
  var labels = data.map(function (d) { return d.label; });
  var actualRates = data.map(function (d) { return d.actualRate * 100; });
  var predictProbs = data.map(function (d) { return parseFloat(d.predictProb) * 100; });
  var totals = data.map(function (d) { return d.total; });

  return {
    tooltip: {
      trigger: 'axis',
      formatter: function (p) {
        var d = data[p[0].dataIndex];
        return d.label + '<br/>预测概率: ' + (parseFloat(d.predictProb) * 100).toFixed(1) + '%<br/>实际命中率: ' + (d.actualRate * 100).toFixed(1) + '%<br/>样本: ' + d.total + '场';
      },
    },
    grid: { left: 48, right: 20, top: 30, bottom: 36 },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10, color: '#64748B' }, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } } },
    yAxis: { type: 'value', name: '命中率(%)', max: 100, axisLabel: { fontSize: 10, color: '#64748B' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } } },
    series: [
      { name: '实际命中率', type: 'bar', data: actualRates, itemStyle: { color: '#18E0E0', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 32, label: { show: true, position: 'top', fontSize: 9, color: '#94A3B8', formatter: function (p) { return (p.value || 0).toFixed(1) + '%'; } } },
      { name: '理想参考线(y=x)', type: 'line', data: predictProbs, lineStyle: { color: 'rgba(251,191,36,0.5)', type: 'dashed', width: 1.5 }, symbol: 'none', tooltip: { show: false } },
    ],
  };
}

/* ── GS 柱状图：共识分级命中率 ── */
function gsBarOption(stats) {
  var cs = (stats && stats.gs && stats.gs.byConsensus) || {};
  var items = [
    { name: '强一致', total: (cs.strong && cs.strong.total) || 0, rate: (cs.strong && cs.strong.rate) || 0 },
    { name: '弱一致', total: (cs.weak && cs.weak.total) || 0, rate: (cs.weak && cs.weak.rate) || 0 },
    { name: '熔断', total: (cs.meltdown && cs.meltdown.total) || 0, rate: (cs.meltdown && cs.meltdown.rate) || 0 },
  ];
  var labels = items.map(function (d) { return d.name + '(' + d.total + '场)'; });
  var rates = items.map(function (d) { return (d.rate * 100).toFixed(1); });
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 20, top: 20, bottom: 36 },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10, color: '#64748B' } },
    yAxis: { type: 'value', name: '命中率(%)', max: 100, axisLabel: { fontSize: 10, color: '#64748B' } },
    series: [{
      type: 'bar', data: rates,
      itemStyle: { color: function (p) { return ['#34D399', '#FBBF24', '#EF4444'][p.dataIndex]; }, borderRadius: [6, 6, 0, 0] },
      barMaxWidth: 50,
      label: { show: true, position: 'top', fontSize: 11, fontWeight: 'bold', color: '#fff', formatter: '{c}%' },
    }],
  };
}

/* ── AI 校准曲线：置信度 vs 实际命中率 ── */
function aiCalibrationOption(stats) {
  var data = (stats && stats.ai && stats.ai.calibration) || [];
  if (!data.length) return { title: { text: '暂无足够数据', left: 'center', top: 'center', textStyle: { color: '#64748B' } } };
  var labels = data.map(function (d) { return d.label; });
  var actualRates = data.map(function (d) { return d.actualRate * 100; });
  var mids = data.map(function (d) { return parseFloat(d.predictProb); });

  return {
    tooltip: {
      trigger: 'axis',
      formatter: function (p) {
        var d = data[p[0].dataIndex];
        return '置信区间: ' + d.label + '<br/>实际命中率: ' + (d.actualRate * 100).toFixed(1) + '%<br/>样本: ' + d.total + '场';
      },
    },
    grid: { left: 48, right: 20, top: 30, bottom: 36 },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10, color: '#64748B' }, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } } },
    yAxis: { type: 'value', name: '命中率(%)', max: 100, axisLabel: { fontSize: 10, color: '#64748B' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } } },
    series: [
      { name: '实际命中率', type: 'bar', data: actualRates, itemStyle: { color: '#34D399', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 36, label: { show: true, position: 'top', fontSize: 9, color: '#94A3B8', formatter: function (p) { return (p.value || 0).toFixed(1) + '%'; } } },
      { name: '理想(y=置信度/100)', type: 'line', data: mids.map(function (v) { return v; }), lineStyle: { color: 'rgba(251,191,36,0.5)', type: 'dashed' }, symbol: 'none', tooltip: { show: false } },
    ],
  };
}

/* ── AI 柱状图：联赛分组 ── */
function aiBarOption(stats) {
  var leagues = (stats && stats.ai && stats.ai.byLeague) || [];
  if (!leagues.length) return { title: { text: '暂无联赛数据', left: 'center', top: 'center', textStyle: { color: '#64748B' } } };
  leagues.sort(function (a, b) { return b.accuracy - a.accuracy; });
  leagues = leagues.slice(0, 12);
  var labels = leagues.map(function (l) { return l.league; });
  var rates = leagues.map(function (l) { return (l.accuracy * 100).toFixed(1); });
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 80, right: 20, top: 10, bottom: 10 },
    xAxis: { type: 'value', name: '命中率(%)', max: 100, axisLabel: { fontSize: 10, color: '#64748B' } },
    yAxis: { type: 'category', data: labels, inverse: true, axisLabel: { fontSize: 10, color: '#94A3B8', width: 72, overflow: 'truncate' } },
    series: [{
      type: 'bar', data: rates,
      itemStyle: { color: function (p) { return p.value >= 50 ? '#34D399' : p.value >= 35 ? '#FBBF24' : '#EF4444'; }, borderRadius: [0, 6, 6, 0] },
      barMaxWidth: 20,
      label: { show: true, position: 'right', fontSize: 10, color: '#94A3B8', formatter: '{c}%' },
    }],
  };
}

/* ── PK 校准曲线：综合信心分 vs 命中率 ── */
function pkCalibrationOption(stats) {
  var data = (stats && stats.pk && stats.pk.calibration) || [];
  if (!data.length) return { title: { text: '暂无足够数据', left: 'center', top: 'center', textStyle: { color: '#64748B' } } };
  var labels = data.map(function (d) { return d.label; });
  var actualRates = data.map(function (d) { return d.actualRate * 100; });

  return {
    tooltip: {
      trigger: 'axis',
      formatter: function (p) {
        var d = data[p[0].dataIndex];
        return '信心分区间: ' + d.label + '<br/>实际命中率: ' + (d.actualRate * 100).toFixed(1) + '%<br/>样本: ' + d.total + '场';
      },
    },
    grid: { left: 48, right: 20, top: 30, bottom: 36 },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10, color: '#64748B' }, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } } },
    yAxis: { type: 'value', name: '命中率(%)', max: 100, axisLabel: { fontSize: 10, color: '#64748B' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } } },
    series: [
      { name: '实际命中率', type: 'bar', data: actualRates, itemStyle: { color: '#A78BFA', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 36, label: { show: true, position: 'top', fontSize: 9, color: '#94A3B8', formatter: function (p) { return (p.value || 0).toFixed(1) + '%'; } } },
    ],
  };
}

/* ── PK 柱状图：星级命中率 ── */
function pkStarsOption(stats) {
  var stars = (stats && stats.pk && stats.pk.byStars) || [];
  if (!stars.length) return { title: { text: '暂无星级数据', left: 'center', top: 'center', textStyle: { color: '#64748B' } } };
  var labels = stars.map(function (s) { return s.stars + '★(' + s.total + '场)'; });
  var rates = stars.map(function (s) { return (s.rate * 100).toFixed(1); });
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 20, top: 20, bottom: 36 },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10, color: '#64748B' } },
    yAxis: { type: 'value', name: '命中率(%)', max: 100, axisLabel: { fontSize: 10, color: '#64748B' } },
    series: [{
      type: 'bar', data: rates,
      itemStyle: { color: function (p) {
        var colors = ['#64748B', '#94A3B8', '#FBBF24', '#34D399', '#18E0E0']; // 1-5★
        return colors[p.dataIndex] || '#18E0E0';
      }, borderRadius: [6, 6, 0, 0] },
      barMaxWidth: 44,
      label: { show: true, position: 'top', fontSize: 11, fontWeight: 'bold', color: '#fff', formatter: '{c}%' },
    }],
  };
}

/* ═══════════════════════ Detail List ═══════════════════════ */
function renderList(list) {
  var el = document.getElementById('btList');
  if (!el) return;
  if (!list || list.length === 0) {
    el.innerHTML = '<div class="plan-notice" style="text-align:center;padding:80px 20px;">' +
      '<span style="display:block;margin-bottom:12px;font-size:36px;">📭</span>' +
      '<p style="font-size:14px;color:var(--text3);">暂无回测数据</p></div>';
    return;
  }

  var html = '<div class="income-list bt-detail-list">';
  html += '<div class="income-header-row">' +
    '<span class="bt-col-date">日期</span>' +
    '<span class="bt-col-match">场次</span>' +
    '<span class="bt-col-teams">对阵 / 比分</span>' +
    '<span class="bt-col-pred">预测结果</span></div>';

  list.forEach(function (row) {
    var dateDisplay = esc((row.date || '').slice(5));
    var hcp = '';
    if (row.handicap && row.handicap !== 0) {
      var sign = row.handicap > 0 ? '+' : '';
      hcp = '<span class="bt-col-hcp">' + sign + row.handicap + '</span>';
    }
    var scoreText = esc(row.actual_score || '-');
    var predParts = buildPredictionItems(row);

    html += '<div class="income-row">' +
      '<span class="bt-col-date">' + dateDisplay + '</span>' +
      '<span class="bt-col-match">' +
      '<span class="bt-col-num">' + esc(row.matchNum || '') + '</span>' +
      '<span class="bt-col-league">' + esc(row.leagueName || '') + '</span></span>' +
      '<span class="bt-col-teams">' +
      '<div class="bt-col-home">' + esc(row.homeName || '-') + '</div>' +
      '<div class="bt-col-score">' + scoreText + hcp + '</div>' +
      '<div class="bt-col-away">' + esc(row.visitName || '-') + '</div></span>' +
      '<span class="bt-col-pred">' + (predParts.length ? predParts.join('') : '<span style="color:var(--text3);font-size:10px;">-</span>') + '</span>' +
      '</div>';
  });

  html += '</div>';
  el.innerHTML = html;
}

function buildPredictionItems(row) {
  var parts = [];
  var isGS = _btTab === 'gs';
  var isAI = _btTab === 'ai';
  var isPK = _btTab === 'pk';

  // GS prediction
  if (row.gs_top_score) {
    var dimClass = isGS ? '' : ' bt-pred-dim';
    parts.push(
      '<div class="bt-pred-item' + dimClass + '">' +
      '<span class="pred-label">GS</span>' +
      '<span class="pred-val ' + (row.gs_hit ? 'pred-hit' : 'pred-miss') + '">' +
      esc(row.gs_top_score) + (isGS && row.gs_top_percent ? ' ' + Math.round(row.gs_top_percent * 100) + '%' : '') + (row.gs_hit ? ' ✓' : ' ✕') +
      '</span></div>'
    );
  }

  // AI prediction
  if (row.ai_spf) {
    var dimClass2 = isAI ? '' : ' bt-pred-dim';
    parts.push(
      '<div class="bt-pred-item' + dimClass2 + '">' +
      '<span class="pred-label">AI</span>' +
      '<span class="pred-val ' + (row.ai_hit ? 'pred-hit' : 'pred-miss') + '">' +
      esc(row.ai_spf) + (isAI && row.ai_confidence ? ' ' + Math.round(row.ai_confidence) : '') + (row.ai_hit ? ' ✓' : ' ✕') +
      '</span></div>'
    );
  }

  // PK prediction
  if (row.pk_direction) {
    var dimClass3 = isPK ? '' : ' bt-pred-dim';
    var extra = '';
    if (isPK && row.pk_direction_stars) extra = ' ' + '★'.repeat(row.pk_direction_stars);
    if (isPK && row.pk_composite_score) extra += ' ' + Math.round(row.pk_composite_score) + '分';
    parts.push(
      '<div class="bt-pred-item' + dimClass3 + '">' +
      '<span class="pred-label">PK</span>' +
      '<span class="pred-val ' + (row.pk_hit ? 'pred-hit' : 'pred-miss') + '">' +
      esc(row.pk_direction) + extra + (row.pk_hit ? ' ✓' : ' ✕') +
      '</span></div>'
    );
  }

  return parts;
}

/* ═══════════════════════ Pagination ═══════════════════════ */
function renderPager(data) {
  var el = document.getElementById('btPager');
  if (!el) return;
  var totalPages = Math.ceil((data.total || 0) / (data.pageSize || 20));
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  var cur = data.page || 1;
  var pages = buildPageRange(cur, totalPages);
  var html = '<div class="bt-pager-wrap">';
  html += '<button class="bt-pager-btn bt-pager-nav" onclick="btGoPage(1)"' + (cur === 1 ? ' disabled' : '') + '>«</button>';
  html += '<button class="bt-pager-btn bt-pager-nav" onclick="btGoPage(' + (cur - 1) + ')"' + (cur === 1 ? ' disabled' : '') + '>‹</button>';
  for (var i = 0; i < pages.length; i++) {
    var p = pages[i];
    if (p === '...') html += '<span class="bt-pager-ellipsis">…</span>';
    else html += '<button class="bt-pager-btn' + (p === cur ? ' active' : '') + '" onclick="btGoPage(' + p + ')">' + p + '</button>';
  }
  html += '<button class="bt-pager-btn bt-pager-nav" onclick="btGoPage(' + (cur + 1) + ')"' + (cur === totalPages ? ' disabled' : '') + '>›</button>';
  html += '<button class="bt-pager-btn bt-pager-nav" onclick="btGoPage(' + totalPages + ')"' + (cur === totalPages ? ' disabled' : '') + '>»</button>';
  html += '<span class="bt-pager-info">' + cur + ' / ' + totalPages + ' 页</span></div>';
  el.innerHTML = html;
}

function buildPageRange(cur, total) {
  if (total <= 7) { var arr = []; for (var i = 1; i <= total; i++) arr.push(i); return arr; }
  var pages = [1];
  var left = Math.max(2, cur - 2), right = Math.min(total - 1, cur + 2);
  if (left > 2) pages.push('...');
  for (var i = left; i <= right; i++) pages.push(i);
  if (right < total - 1) pages.push('...');
  pages.push(total);
  return pages;
}

window.btGoPage = function (p) {
  _btPage = p;
  fetchData();
  document.getElementById('page-backtest').scrollIntoView({ behavior: 'smooth' });
};

/* ═══════════════════════ Helpers ═══════════════════════ */
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


// =============================================================
// * 蓝图：实验对比 tab
// =============================================================
async function loadExperimentCompare() {
  var el = document.getElementById('btExperimentContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载实验数据...</div>';

  try {
    var data = await api('experiment-compare');
    if (!data || Object.keys(data).length === 0) {
      el.innerHTML = '<div class="empty-state">暂无实验对比数据，请等待prediction_logs积累数据后查看</div>';
      return;
    }
    el.innerHTML = buildExperimentHTML(data);
  } catch (e) {
    el.innerHTML = '<div class="empty-state">加载失败: ' + e.message + '</div>';
  }
}

function buildExperimentHTML(data) {
  var html = '';
  Object.keys(data).forEach(function(type) {
    var rows = data[type];
    if (!rows || rows.length === 0) return;
    var typeLabel = type === 'deepseek' ? 'DeepSeek AI' : type === 'doubao' ? '豆包 AI' : type === 'outcomes' ? '模型回测' : type;
    html += '<div class="chart-box"><div class="chart-header"><span class="chart-title">' + typeLabel + '版本对比</span></div>';
    html += '<table style="width:100%;font-size:var(--fs-sm)"><thead><tr style="color:var(--text3)"><th style="text-align:left;padding:6px">版本</th><th>总数</th><th>命中</th><th>命中率</th><th>置信度</th></tr></thead><tbody>';
    rows.forEach(function(r) {
      var rateColor = r.hitRate >= 60 ? 'var(--green)' : r.hitRate >= 50 ? 'var(--amber)' : 'var(--red)';
      html += '<tr style="border-top:1px solid rgba(255,255,255,0.04)"><td style="padding:6px;color:var(--text)">' + r.version + '</td><td style="text-align:center;color:var(--text2)">' + r.total + '</td><td style="text-align:center;color:var(--text2)">' + r.hits + '</td><td style="text-align:center;color:' + rateColor + ';font-weight:700">' + r.hitRate + '%</td><td style="text-align:center;color:var(--text3)">' + (r.avgConfidence ? (r.avgConfidence * 100).toFixed(1) + '%' : '--') + '</td></tr>';
    });
    html += '</tbody></table></div>';
  });
  return html;
}

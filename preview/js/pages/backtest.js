/**
import { loadCSS } from '../vendor.js';
loadCSS('../../css/page-backtest.css');

 * preview/js/pages/backtest.js — V9 三Tab回测分析页
 * Tab: GS功守道 | AI深度分析 | PK融合分析
 * 每个Tab独立：统计卡片 + ECharts图表 + 明细列表
 */
import { api } from '../api.js';
import { loadECharts } from '../charts.js?v=202606080308';
let _btPage = 1,
  _btPageSize = 20,
  _btLeagues = [],
  _btTab = 'gs',
  _btStats = null,
  _btItems = [],
  _btSampleMode = 'ab_only',
  _btQualitySplit = null,
  _btDegradeImpact = null,
  _btChartInst = {}; // 三Tab各一个ECharts实例
let _btResizeHandler = null; // ★ P1-4: 命名 resize handler，避免重复绑定泄漏

export function loadBacktest() {
  try {
    const el = document.getElementById('page-backtest');
    if (!el) {
      console.error('[BT] #page-backtest not found');
      return;
    }
    injectStyles(); // ★ 必须在 renderPage 之前注入，避免 FOUC
    el.innerHTML = renderPage();
    _btTab = 'gs';
    _btPage = 1;
    _btSampleMode = 'ab_only';
    _btQualitySplit = null;
    _btDegradeImpact = null;
    _btChartInst = {};
    fetchData();
  } catch (e) {
    console.error('[BT] loadBacktest error:', e);
    const el2 = document.getElementById('page-backtest');
    if (el2) el2.innerHTML = '<div style="color:red;padding:20px;">回测页面加载失败: ' + e.message + '</div>';
  }
}

/* ═══════════════════════ CSS ═══════════════════════ */
function injectStyles() {
  // ★ 先移除旧标签再重建，防止 Vite HMR 残留旧样式
  const old = document.getElementById('bt-inline-css');
  if (old) old.remove();
  const s = document.createElement('style');
  s.id = 'bt-inline-css';
  s.textContent = [
    // Tab bar
    '.bt-tab-row { display:flex; gap:4px; padding:0 10px 8px; border-bottom:1px solid rgba(15,23,42,0.06); }',
    '.bt-tab-btn { flex:1; text-align:center; padding:8px 4px; font-size:13px; font-weight:600; color:#64748b; cursor:pointer; border-radius:10px; transition:all .2s; position:relative; }',
    '.bt-tab-btn:hover { color:#475569; }',
    '.bt-tab-btn.active { color:var(--cyan); background:rgba(24,224,224,0.08); }',
    '.bt-tab-btn.active::after { content:""; position:absolute; bottom:-4px; left:20%; right:20%; height:2px; background:var(--cyan); border-radius:1px; }',

    // Stats sub row (below scheme-stats-card)
    '.bt-tab-stats .scheme-stats-card { flex-wrap: wrap; }',
    '.bt-stat-sub { width:100%; font-size:10px; color:#64748b; margin-top:10px; padding-top:8px; border-top:1px solid rgba(15,23,42,0.06); display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }',
    '.bt-stat-sub span { white-space:nowrap; }',

    // Tab stats container
    '.bt-tab-stats { display:none; }',
    '.bt-tab-stats.active { display:block; }',

    // Chart
    '.bt-chart-wrap { display:none; margin:0 0 10px; background:var(--card); border:1px solid var(--card-border); border-radius:22px; padding:10px 10px 8px; overflow:hidden; }',
    '.bt-chart-wrap.active { display:block; }',
    '.bt-chart-inner { width:100%; height:260px; }',
    '.bt-chart-toggle { display:flex; gap:4px; justify-content:center; margin-bottom:4px; }',
    '.bt-chart-toggle-btn { font-size:11px; padding:2px 10px; border-radius:12px; border:1px solid rgba(15,23,42,0.15); background:rgba(15,23,42,0.04); color:#64748b; cursor:pointer; transition:all .15s; }',
    '.bt-chart-toggle-btn.active { background:rgba(24,224,224,0.12); color:var(--cyan); border-color:var(--cyan); }',

    // Pager
    '.bt-pager-wrap { display:flex; justify-content:center; align-items:center; gap:6px; padding:16px 0; flex-wrap:wrap; }',
    '.bt-pager-btn { min-width:32px; height:32px; padding:0 6px; border-radius:8px; border:1px solid rgba(15,23,42,0.12); background:rgba(15,23,42,0.04); color:#475569; font-size:13px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; transition:all .15s; }',
    '.bt-pager-btn:hover { border-color:rgba(15,23,42,0.25); color:#1e293b; }',
    '.bt-pager-btn.active { background:var(--cyan); color:#0f172a; border-color:var(--cyan); font-weight:700; }',
    '.bt-pager-btn:disabled { opacity:0.3; cursor:default; pointer-events:none; }',
    '.bt-pager-ellipsis { min-width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; color:#64748b; font-size:13px; }',
    '.bt-pager-nav { min-width:28px; }',
    '.bt-pager-info { font-size:12px; color:#64748b; margin:0 8px; white-space:nowrap; }',

    // Prediction + table layout（回测页专用）
    '.backtest-list .filter-detail-table { table-layout:fixed; }',
    '.backtest-list .filter-detail-table th, .backtest-list .filter-detail-table td { vertical-align:top; }',
    '.backtest-list .filter-detail-table td { font-size:12px; }',
    '.backtest-list .fdt-date { width:62px; text-align:center; }',
    '.backtest-list .fdt-match { width:74px; text-align:center; }',
    '.backtest-list .fdt-teams { width:96px; text-align:left; line-height:1.35; }',
    '.backtest-list .fdt-dir { min-width:0; }',
    '.bt-date-main { font-weight:700; letter-spacing:.2px; font-size:12px; }',
    '.bt-match-week { display:block; font-size:12px; font-weight:700; line-height:1.2; white-space:nowrap; }',
    '.bt-match-num { display:block; font-size:12px; font-weight:800; line-height:1.2; white-space:nowrap; }',
    '.bt-match-league { display:block; font-size:12px; color:var(--text3); line-height:1.25; margin-top:2px; }',
    '.bt-team-home, .bt-team-away { display:block; font-weight:600; line-height:1.35; font-size:12px; }',
    '.bt-team-score { display:flex; align-items:center; gap:4px; margin:2px 0; font-weight:800; color:var(--cyan); line-height:1.35; font-size:12px; }',
    '.bt-handicap { font-size:12px; color:var(--amber); font-weight:500; }',
    '.bt-pred-stack { display:flex; flex-direction:column; gap:5px; }',
    '.bt-pred-item { font-size:12px; line-height:1.4; display:flex; align-items:flex-start; gap:6px; }',
    '.bt-pred-item .pred-label { flex:0 0 24px; color:var(--text3); font-weight:700; letter-spacing:.2px; font-size:12px; }',
    '.bt-pred-item .pred-val { flex:1; min-width:0; font-weight:700; word-break:break-word; font-size:12px; }',
    '.bt-pred-item .pred-hit { color:var(--red) !important; }',
    '.bt-pred-item .pred-miss { color:var(--green) !important; }',
    '.bt-pred-empty { color:var(--text3); font-size:12px; }',
    '.bt-pred-dim { opacity:0.45; }',
    '.chart-box .fdt-teams { white-space:normal; }',
    '.bt-summary-bar { display:flex; justify-content:flex-start; align-items:center; padding:4px 4px 8px; color:var(--text3); font-size:12px; }',
    '.bt-pk-judge-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin:8px 0 10px; }',
    '.bt-pk-judge-card { border:1px solid rgba(47,159,154,.18); border-radius:12px; padding:8px; background:linear-gradient(145deg, rgba(255,255,255,.72), rgba(238,246,246,.62)); box-shadow:inset 0 1px 0 rgba(255,255,255,.58), 0 8px 18px rgba(48,72,78,.08); }',
    '.bt-pk-judge-card b { display:block; color:var(--text2); font-size:12px; }',
    '.bt-pk-judge-card span { color:var(--cyan); font-size:15px; font-weight:800; }',
    '.bt-pk-judge-card em { display:block; color:var(--text3); font-size:10px; font-style:normal; margin-top:2px; }',
    '.bt-pk-row td { padding:0 8px 10px !important; border-top:none !important; }',
    '.bt-pk-snapshot { margin-top:0; width:100%; padding:10px 12px; border-radius:12px; border:1px solid rgba(47,159,154,.15); background:linear-gradient(160deg, rgba(126,166,189,.1), rgba(255,255,255,.72)); color:var(--text2); font-size:12px; line-height:1.45; display:flex; flex-direction:column; gap:6px; box-sizing:border-box; }',
    '.bt-pk-topline { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; }',
    '.bt-pk-meta { display:flex; align-items:center; justify-content:space-between; gap:4px; padding:4px 8px; border-radius:8px; background:rgba(15,23,42,.06); color:var(--text3); font-size:12px; font-weight:600; }',
    '.bt-pk-meta strong { color:#0f766e; font-weight:700; white-space:nowrap; font-size:12px; }',
    '.bt-pk-narrative { padding:7px 8px; border-radius:8px; background:rgba(255,255,255,.62); color:var(--text2); font-size:12px; line-height:1.45; }',
    '.bt-pk-chip-row { display:flex; flex-wrap:wrap; gap:6px; }',
    '.bt-pk-kv { display:flex; align-items:flex-start; gap:8px; }',
    '.bt-pk-kv-k { min-width:64px; color:var(--text3); font-size:12px; font-weight:600; }',
    '.bt-pk-kv-v { flex:1; color:var(--text2); font-size:12px; line-height:1.45; }',
    '.bt-pk-snapshot b { color:var(--text2); }',
    '.bt-pk-chip { display:inline-block; margin:0; padding:2px 8px; border-radius:999px; background:rgba(184,112,112,.12); color:#b87070; font-size:12px; line-height:1.35; }',
    '.bt-pk-chip.ok { background:rgba(122,170,150,.14); color:#5f9a83; }',
    '.bt-pk-chip.attr { background:rgba(167,139,250,.16); color:#8b5cf6; }',
    '.bt-pk-sample-note { color:#b89a60; font-size:10px; margin-top:6px; }',

    // ─── filter-tag 标签按钮 + filter-DD 筛选卡片（浅色主题） ───
    '.filter-row { display:flex; gap:8px; overflow-x:auto; padding:12px 0; margin:0; scrollbar-width:none; }',
    '.filter-row::-webkit-scrollbar { display:none; }',
    '.filter-tag { white-space:nowrap; padding:6px 14px; border-radius:999px; font-size:var(--fs-sm); background:rgba(15,23,42,0.05); color:#475569; border:1px solid rgba(15,23,42,0.1); cursor:pointer; transition:all .2s; }',
    '.filter-tag.active { background:var(--cyan); color:#0f172a; font-weight:600; border-color:var(--cyan); }',
    '.filter-section-card { background:var(--card); border:1px solid var(--card-border); border-radius:22px; padding:22px 22px 18px; margin-bottom:16px; box-shadow:0 0 14px rgba(15,23,42,0.04); }',
    '.filter-head { font-size:var(--fs-xl); font-weight:700; color:#1e293b; margin-bottom:14px; padding:0 2px; }',
    '.filter-section-card .filter-row { display:flex; align-items:center; justify-content:space-between; min-height:56px; padding:4px 4px; border-bottom:1px solid rgba(15,23,42,0.06); overflow-x:visible; gap:0; }',
    '.filter-section-card .filter-row:last-of-type { border-bottom:none; }',
    '.filter-label { font-size:var(--fs-md); color:#64748b; font-weight:600; flex-shrink:0; min-width:44px; margin-right:16px; margin-left:8px; }',
    '.filter-dd { flex:1; position:relative; -webkit-user-select:none; user-select:none; }',
    '.filter-dd-trigger { height:44px; padding:0 38px 0 16px; background:rgba(15,23,42,0.04); border:1px solid rgba(15,23,42,0.12); border-radius:12px; font-size:15px; font-weight:500; letter-spacing:.3px; transition:all .25s ease; cursor:pointer; display:flex; align-items:center; position:relative; -webkit-tap-highlight-color:transparent; touch-action:manipulation; }',
    '.filter-dd.open .filter-dd-trigger { background-color:rgba(24,224,224,0.08); border-color:rgba(24,224,224,0.4); box-shadow:0 0 0 4px rgba(24,224,224,0.05), 0 0 18px rgba(24,224,224,0.1); }',
    '.filter-dd-text { color:var(--cyan); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '.filter-dd-arrow { position:absolute; right:12px; top:50%; transform:translateY(-50%); width:20px; height:20px; fill:none; stroke:var(--cyan); stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; transition:transform .2s ease; }',
    '.filter-dd.open .filter-dd-arrow { transform:translateY(-50%) rotate(180deg); }',
    '.filter-dd-menu { display:none; position:fixed; z-index:9999; background:#fff; border:1px solid rgba(15,23,42,0.15); border-radius:12px; max-height:220px; overflow-y:auto; padding:6px 0; box-shadow:0 8px 30px rgba(15,23,42,0.12), 0 0 12px rgba(15,23,42,0.06); -webkit-overflow-scrolling:touch; transform:translateZ(0); }',
    '.filter-dd.open .filter-dd-menu { display:block; }',
    '.filter-dd.open { z-index:999; position:relative; }',
    '.filter-dd-option { position:relative; padding:12px 40px 12px 18px; font-size:14px; font-weight:500; color:#475569; cursor:pointer; transition:background .15s ease; -webkit-tap-highlight-color:transparent; touch-action:manipulation; }',
    '.filter-dd-option:hover { background:rgba(15,23,42,0.05); color:#1e293b; }',
    '.filter-dd-option.selected { color:var(--cyan); font-weight:600; background:rgba(24,224,224,0.08); }',
    '.filter-dd-option.selected::after { content:\"\\2713\"; position:absolute; right:14px; top:50%; transform:translateY(-50%); font-size:15px; font-weight:700; color:var(--cyan); }',
    '.filter-btn-wrap { margin-top:18px; }',

    // ─── scheme-stats-card 统计卡片 ───
    '.scheme-stats-card { background:var(--card); border:1px solid var(--card-border); border-radius:22px; padding:18px 10px; margin-bottom:14px; display:flex; align-items:center; justify-content:space-around; }',
    '.scheme-stat-item { flex:1; text-align:center; }',
    '.scheme-stat-val { font-size:16px; font-weight:800; color:var(--cyan); line-height:1.2; }',
    '.scheme-stat-lbl { font-size:var(--fs-xs); color:var(--text3); margin-top:4px; }',
    '.scheme-stat-div { width:1px; height:32px; background:rgba(15,23,42,0.06); }',
  ].join('\n');
  document.head.appendChild(s);
}
injectStyles(); // ★ 模块级立即注入，确保样式在任何渲染之前就绪

/* ═══════════════════════ Page HTML ═══════════════════════ */
function renderPage() {
  return [
    // Tab bar
    '<div class="filter-row" id="btTabRow">',
    '<div class="filter-tag active" data-tab="gs" onclick="btSwitchTab(\'gs\')">功守道量化</div>',
    '<div class="filter-tag" data-tab="ai" onclick="btSwitchTab(\'ai\')">AI深度分析</div>',
    '<div class="filter-tag" data-tab="pk" onclick="btSwitchTab(\'pk\')">PK裁判验证</div>',
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
    '<div class="bt-chart-toggle" id="btChartTogglePK"><button class="bt-chart-toggle-btn active" data-ctype="calibration" onclick="btChartType(\'pk\',\'calibration\')">信心分校准</button><button class="bt-chart-toggle-btn" data-ctype="decision" onclick="btChartType(\'pk\',\'decision\')">决策等级</button></div>',
    '<div class="bt-chart-inner" id="btChartInnerPK"></div>',
    '</div>',

    // List + pager
    '<div class="bt-summary-bar" id="btSummary" style="display:none;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
      '<span id="btSummaryText" style="color:var(--text3);">AI预测结果仅供参考</span>' +
      '<span style="display:flex;gap:6px;">' +
      '<button class="bt-chart-toggle-btn active" id="btModeAB" onclick="btSetSampleMode(\'ab_only\')">仅A/B</button>' +
      '<button class="bt-chart-toggle-btn" id="btModeAll" onclick="btSetSampleMode(\'all\')">含C/D</button>' +
      '</span>' +
      '</div>',
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
    '<div class="filter-row" id="btModelRow">',
    '<span class="filter-label">模型</span>',
    '<div class="filter-dd" id="dd-btModel" data-val="all">',
    '<div class="filter-dd-trigger" onclick="toggleDD(\'dd-btModel\', event)">',
    '<span class="filter-dd-text">全部</span>',
    '<svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg>',
    '</div>',
    '<ul class="filter-dd-menu" id="dd-btModel-menu"><li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-btModel\',\'all\',\'全部\')">全部</li></ul>',
    '</div></div>',
    filterDD('dd-btDecision', '决策等级', [
      { v: 'all', l: '全部' },
      { v: 'main_pick', l: '主推' },
      { v: 'playable', l: '可做' },
      { v: 'cautious', l: '谨慎' },
      { v: 'watch', l: '观望' },
    ]),
    filterDD('dd-btRisk', '风险等级', [
      { v: 'all', l: '全部' },
      { v: 'green', l: '低风险' },
      { v: 'yellow', l: '中风险' },
      { v: 'red', l: '高风险' },
    ]),
    filterDD('dd-btEV', 'EV区间', [
      { v: 'all', l: '全部' },
      { v: 'positive', l: '正EV' },
      { v: 'neutral', l: 'EV缺失/中性' },
      { v: 'negative', l: '负EV' },
    ]),
    filterDD('dd-btConflict', '分歧类型', [
      { v: 'all', l: '全部' },
      { v: 'aligned', l: '一致' },
      { v: 'degraded', l: '降级' },
      { v: 'gs_meltdown', l: '熔断' },
      { v: 'negative_ev', l: '负EV' },
      { v: 'overheat', l: '过热' },
    ]),
    filterDD('dd-btAttribution', '归因标签', [
      { v: 'all', l: '全部' },
      { v: '方向判断正确', l: '方向正确' },
      { v: '方向判断失误', l: '方向失误' },
      { v: '正EV兑现', l: '正EV兑现' },
      { v: '热度风险', l: '热度风险' },
      { v: '数据质量风险', l: '数据质量' },
    ]),
    '<div class="filter-btn-wrap"><button class="filter-submit-btn" onclick="doBTQuery()">查询</button></div>',
    '</div>',
  ].join('');
}

function filterDD(id, label, opts) {
  let items = '';
  opts.forEach(function (o, i) {
    items +=
      '<li data-val="' +
      o.v +
      '" class="filter-dd-option' +
      (i === 0 ? ' selected' : '') +
      '" onclick="selectDD(\'' +
      id +
      "','" +
      o.v +
      "','" +
      o.l +
      '\')">' +
      o.l +
      '</li>';
  });
  return (
    '<div class="filter-row">' +
    '<span class="filter-label">' +
    label +
    '</span>' +
    '<div class="filter-dd" id="' +
    id +
    '" data-val="' +
    opts[0].v +
    '">' +
    '<div class="filter-dd-trigger" onclick="toggleDD(\'' +
    id +
    '\', event)">' +
    '<span class="filter-dd-text">' +
    opts[0].l +
    '</span>' +
    '<svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg>' +
    '</div><ul class="filter-dd-menu">' +
    items +
    '</ul></div></div>'
  );
}

/* ═══════════════════════ Stats Card Renderers ═══════════════════════ */
function renderStatsCard(tab) {
  if (tab === 'gs') {
    return (
      '<div class="scheme-stats-card">' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val" id="gsTotal">-</div><div class="scheme-stat-lbl">总预测</div></div>' +
      '<div class="scheme-stat-div"></div>' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val bt-amber" id="gsScoreHit">-</div><div class="scheme-stat-lbl">比分命中率</div></div>' +
      '<div class="scheme-stat-div"></div>' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val" id="gsSpfHit">-</div><div class="scheme-stat-lbl">方向命中率</div></div>' +
      '<div class="bt-stat-sub"><span>强一致:<b id="gsStrongHit">-</b></span><span>弱一致:<b id="gsWeakHit">-</b></span><span>熔断:<b id="gsMeltHit">-</b></span></div>' +
      '</div>'
    );
  }
  if (tab === 'ai') {
    return (
      '<div class="scheme-stats-card">' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val" id="aiTotal">-</div><div class="scheme-stat-lbl">总预测</div></div>' +
      '<div class="scheme-stat-div"></div>' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val bt-green" id="aiSpfAcc">-</div><div class="scheme-stat-lbl">SPF命中率</div></div>' +
      '<div class="scheme-stat-div"></div>' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val" id="aiOuAcc">-</div><div class="scheme-stat-lbl">大小球命中</div></div>' +
      '<div class="bt-stat-sub"><span>比分命中:<b id="aiScAcc">-</b></span><span>高信心:<b id="aiHiConf">-</b></span><span>中信心:<b id="aiMidConf">-</b></span></div>' +
      '</div>'
    );
  }
  if (tab === 'pk') {
    return (
      '<div class="scheme-stats-card">' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val" id="pkTotal">-</div><div class="scheme-stat-lbl">总预测</div></div>' +
      '<div class="scheme-stat-div"></div>' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val bt-green" id="pkDirAcc">-</div><div class="scheme-stat-lbl">方向命中率</div></div>' +
      '<div class="scheme-stat-div"></div>' +
      '<div class="scheme-stat-item"><div class="scheme-stat-val" id="pkMainROI">-</div><div class="scheme-stat-lbl">主推ROI</div></div>' +
      '<div class="bt-stat-sub"><span>有效样本:<b id="pkJudgeSamples">-</b></span><span>正EV ROI:<b id="pkPositiveEVROI">-</b></span><span>观望避坑:<b id="pkWatchAvoid">-</b></span></div>' +
      '</div>'
    );
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
  document.querySelectorAll('.bt-tab-stats').forEach(function (s) {
    s.classList.remove('active');
  });
  const statsEl = document.getElementById('btStats' + tab.toUpperCase());
  if (statsEl) statsEl.classList.add('active');
  // Charts
  document.querySelectorAll('.bt-chart-wrap').forEach(function (c) {
    c.classList.remove('active');
  });
  const chartEl = document.getElementById('btChart' + tab.toUpperCase());
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
  const toggleEl = document.getElementById('btChartToggle' + tab.toUpperCase());
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

window.btSetSampleMode = function (mode) {
  _btSampleMode = mode === 'all' ? 'all' : 'ab_only';
  _btPage = 1;
  const abBtn = document.getElementById('btModeAB');
  const allBtn = document.getElementById('btModeAll');
  if (abBtn) abBtn.classList.toggle('active', _btSampleMode === 'ab_only');
  if (allBtn) allBtn.classList.toggle('active', _btSampleMode === 'all');
  fetchData();
};

function getBTFilters() {
  function v(id) {
    return window.getDDVal ? window.getDDVal(id) || 'all' : 'all';
  }
  return {
    type: 'all',
    dateRange: v('dd-btRange'),
    league: v('dd-btLeague'),
    model: v('dd-btModel'),
    decisionLevel: v('dd-btDecision'),
    riskLevel: v('dd-btRisk'),
    evRange: v('dd-btEV'),
    conflictType: v('dd-btConflict'),
    attributionTag: v('dd-btAttribution'),
    direction: 'all',
    aiConf: 'all',
    pkConf: 'all',
    consensus: 'all',
  };
}

function populateLeagues(leagues) {
  if (!leagues || !leagues.length) return;
  _btLeagues = leagues;
  const menu = document.getElementById('dd-btLeague-menu');
  if (!menu) return;
  let html =
    '<li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-btLeague\',\'all\',\'全部\')">全部</li>';
  leagues.forEach(function (lg) {
    html +=
      '<li data-val="' +
      esc(lg) +
      '" class="filter-dd-option" onclick="selectDD(\'dd-btLeague\',\'' +
      esc(lg) +
      "','" +
      esc(lg) +
      '\')">' +
      esc(lg) +
      '</li>';
  });
  menu.innerHTML = html;
}

function populateModels(models) {
  if (!models || !models.length) return;
  const menu = document.getElementById('dd-btModel-menu');
  if (!menu) return;
  let html =
    '<li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-btModel\',\'all\',\'全部\')">全部</li>';
  models.forEach(function (m) {
    let label = m;
    if (m === 'expert_consensus') label = '专家共识';
    else if (m === 'DeepSeek') label = 'DeepSeek AI';
    else if (m === 'doubao') label = '豆包 AI';
    else if (m === '功守道') label = '功守道量化';
    else if (m === 'PK评分') label = 'PK融合评分';
    html +=
      '<li data-val="' +
      esc(m) +
      '" class="filter-dd-option" onclick="selectDD(\'dd-btModel\',\'' +
      esc(m) +
      "','" +
      esc(label) +
      '\')">' +
      esc(label) +
      '</li>';
  });
  menu.innerHTML = html;
}

function fetchData() {
  const el = document.getElementById('btList');
  if (el)
    el.innerHTML =
      '<div class="plan-notice" style="text-align:center;padding:40px 0;color:var(--text2);">加载中...</div>';

  const f = getBTFilters();
  api('prediction-backtest', {
    type: f.type,
    dateRange: f.dateRange,
    league: f.league,
    model: f.model,
    direction: f.direction,
    aiConf: f.aiConf,
    pkConf: f.pkConf,
    consensus: f.consensus,
    decisionLevel: f.decisionLevel,
    riskLevel: f.riskLevel,
    evRange: f.evRange,
    conflictType: f.conflictType,
    attributionTag: f.attributionTag,
    sampleMode: _btSampleMode,
    page: _btPage,
    pageSize: _btPageSize,
  })
    .then(function (res) {
      if (res.leagues) populateLeagues(res.leagues);
      if (res.models) populateModels(res.models);
      _btStats = res.stats;
      _btItems = res.items || [];
      _btQualitySplit = res.qualitySplit || null;
      _btDegradeImpact = res.degradeImpact || null;
      updateAllStats(res.stats);
      renderList(res.items);
      renderPager(res);
      renderChart(_btTab, 'calibration');
      const s = document.getElementById('btSummary');
      const st = document.getElementById('btSummaryText');
      const abBtn = document.getElementById('btModeAB');
      const allBtn = document.getElementById('btModeAll');
      if (abBtn) abBtn.classList.toggle('active', _btSampleMode === 'ab_only');
      if (allBtn) allBtn.classList.toggle('active', _btSampleMode === 'all');
      if (st && _btQualitySplit) {
        const ratio =
          _btDegradeImpact && _btDegradeImpact.fallbackPlanRatio != null
            ? Math.round(_btDegradeImpact.fallbackPlanRatio * 100)
            : 0;
        st.textContent =
          '样本口径：' +
          (_btSampleMode === 'ab_only' ? '仅A/B' : '含C/D') +
          ' ｜ AB样本 ' +
          ((_btQualitySplit.ab && _btQualitySplit.ab.sampleSize) || 0) +
          ' ｜ C/D样本 ' +
          ((_btQualitySplit.cd && _btQualitySplit.cd.sampleSize) || 0) +
          ' ｜ 降级占比 ' +
          ratio +
          '%';
      }
      if (s) s.style.display = (res.total || 0) > 0 || !!_btQualitySplit ? 'flex' : 'none';
    })
    .catch(function (e) {
      console.error('backtest fetch error:', e);
      const el2 = document.getElementById('btList');
      if (el2)
        el2.innerHTML =
          '<div class="plan-notice" style="text-align:center;padding:40px 0;color:var(--red);">数据加载失败: ' +
          e.message +
          '</div>';
    });
}

/* ═══════════════════════ Stats Update ═══════════════════════ */
function updateAllStats(stats) {
  if (!stats) return;
  // GS
  const gs = stats.gs || {};
  setText('gsTotal', (gs.total || 0).toLocaleString());
  setText('gsScoreHit', fmtPct(gs.score_hit_rate));
  setText('gsSpfHit', fmtPct(gs.spf_hit_rate));
  if (gs.byConsensus) {
    setText('gsStrongHit', fmtPct(gs.byConsensus.strong ? gs.byConsensus.strong.rate : 0));
    setText('gsWeakHit', fmtPct(gs.byConsensus.weak ? gs.byConsensus.weak.rate : 0));
    setText('gsMeltHit', fmtPct(gs.byConsensus.meltdown ? gs.byConsensus.meltdown.rate : 0));
  }
  // AI
  const ai = stats.ai || {};
  setText('aiTotal', (ai.total || 0).toLocaleString());
  setText('aiSpfAcc', fmtPct(ai.spf_accuracy));
  setText('aiOuAcc', fmtPct(ai.ou_accuracy) + ' (' + (ai.ou_total || 0) + ')');
  setText('aiScAcc', fmtPct(ai.score_accuracy) + ' (' + (ai.score_total || 0) + ')');
  if (ai.byConfidence) {
    const hi =
      ai.byConfidence.find(function (b) {
        return b.label === '90-100' || b.label === '80-89';
      }) || {};
    const mid =
      ai.byConfidence.find(function (b) {
        return b.label === '70-79' || b.label === '60-69';
      }) || {};
    setText('aiHiConf', fmtPct(hi.rate || 0));
    setText('aiMidConf', fmtPct(mid.rate || 0));
  }
  // PK
  const pk = stats.pk || {};
  const judge = pk.judge || {};
  const mainPick = findDecisionStat(judge, 'main_pick');
  setText('pkTotal', (judge.validSamples || pk.total || 0).toLocaleString());
  setText('pkDirAcc', fmtPct(pk.direction_accuracy));
  setText('pkMainROI', fmtROI(mainPick.roi));
  setText('pkJudgeSamples', (judge.validSamples || 0) + ' / ' + (judge.settledSamples || 0));
  setText('pkPositiveEVROI', fmtROI(judge.positiveEV ? judge.positiveEV.roi : 0));
  setText('pkWatchAvoid', fmtPct(judge.watchAvoidance ? judge.watchAvoidance.avoidRate : 0));
}

function findDecisionStat(judge, code) {
  const rows = (judge && judge.byDecisionLevel) || [];
  return (
    rows.find(function (x) {
      return x.code === code;
    }) || { total: 0, hit: 0, hitRate: 0, roi: 0 }
  );
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function fmtPct(v) {
  if (v === undefined || v === null || isNaN(v)) return '-';
  return Math.round(v * 100) + '%';
}

function fmtROI(v) {
  if (v === undefined || v === null || isNaN(v)) return '-';
  const n = Number(v) * 100;
  return (n > 0 ? '+' : '') + Math.round(n) + '%';
}

function displayDecisionLevel(v) {
  const k = String(v || '').toLowerCase();
  if (!k) return '观望';
  if (k === 'main_pick') return '主推';
  if (k === 'playable') return '可做';
  if (k === 'cautious') return '谨慎';
  if (k === 'watch') return '观望';
  return String(v);
}

function displayRiskLevel(v) {
  const k = String(v || '').toLowerCase();
  if (!k || k === '-') return '-';
  if (k === 'green') return '低';
  if (k === 'yellow') return '中';
  if (k === 'red') return '高';
  return String(v);
}

function displaySnapshotStatus(v) {
  const k = String(v || '').toLowerCase();
  if (!k || k === '-') return '-';
  if (k === 'missing_snapshot') return '缺失';
  if (k === 'ok') return '正常';
  return String(v).replace(/_/g, '');
}

/* ═══════════════════════ ECharts Rendering ═══════════════════════ */
function renderChart(tab, ctype) {
  const innerEl = document.getElementById('btChartInner' + tab.toUpperCase());
  if (!innerEl) return;
  loadECharts().then(function () {
    if (typeof echarts === 'undefined') {
      innerEl.innerHTML = '<div style="color:var(--text3);text-align:center;padding:60px 0;">图表组件加载中...</div>';
      return;
    }
    // Dispose old instance
    if (_btChartInst[tab]) {
      _btChartInst[tab].dispose();
      _btChartInst[tab] = null;
    }
    innerEl.innerHTML = '';
    const inst = echarts.init(innerEl);
    _btChartInst[tab] = inst;

    // 所有图表统一暗色背景
    const baseOpt = {
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
      if (ctype === 'calibration') {
        inst.setOption(Object.assign({}, baseOpt, pkCalibrationOption(_btStats)));
      } else if (ctype === 'decision') {
        inst.setOption(Object.assign({}, baseOpt, pkDecisionOption(_btStats)));
      } else if (ctype === 'stars') {
        inst.setOption(Object.assign({}, baseOpt, pkStarsOption(_btStats)));
      }
    }

    if (_btResizeHandler) window.removeEventListener('resize', _btResizeHandler);
    _btResizeHandler = function () {
      try {
        inst.resize();
      } catch (e) {}
    };
    window.addEventListener('resize', _btResizeHandler);
  });
}

/* ── GS 校准曲线：预测概率 vs 实际命中率 ── */
function gsCalibrationOption(stats) {
  const data = (stats && stats.gs && stats.gs.calibration) || [];
  if (!data.length)
    return { title: { text: '暂无足够数据', left: 'center', top: 'center', textStyle: { color: '#64748B' } } };
  const labels = data.map(function (d) {
    return d.label;
  });
  const actualRates = data.map(function (d) {
    return d.actualRate * 100;
  });
  const predictProbs = data.map(function (d) {
    return parseFloat(d.predictProb) * 100;
  });
  const totals = data.map(function (d) {
    return d.total;
  });

  return {
    tooltip: {
      trigger: 'axis',
      formatter: function (p) {
        const d = data[p[0].dataIndex];
        return (
          d.label +
          '<br/>预测概率: ' +
          (parseFloat(d.predictProb) * 100).toFixed(1) +
          '%<br/>实际命中率: ' +
          (d.actualRate * 100).toFixed(1) +
          '%<br/>样本: ' +
          d.total +
          '场'
        );
      },
    },
    grid: { left: 48, right: 20, top: 40, bottom: 36 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { fontSize: 10, color: '#64748B' },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
    },
    yAxis: {
      type: 'value',
      name: '命中率(%)',
      max: 100,
      axisLabel: { fontSize: 10, color: '#64748B' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    series: [
      {
        name: '实际命中率',
        type: 'bar',
        data: actualRates,
        itemStyle: { color: '#18E0E0', borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 32,
        label: {
          show: true,
          position: 'top',
          fontSize: 9,
          color: '#94A3B8',
          formatter: function (p) {
            return (p.value || 0).toFixed(1) + '%';
          },
        },
      },
      {
        name: '理想参考线(y=x)',
        type: 'line',
        data: predictProbs,
        lineStyle: { color: 'rgba(251,191,36,0.5)', type: 'dashed', width: 1.5 },
        symbol: 'none',
        tooltip: { show: false },
      },
    ],
  };
}

/* ── GS 柱状图：共识分级命中率 ── */
function gsBarOption(stats) {
  const cs = (stats && stats.gs && stats.gs.byConsensus) || {};
  const items = [
    { name: '强一致', total: (cs.strong && cs.strong.total) || 0, rate: (cs.strong && cs.strong.rate) || 0 },
    { name: '弱一致', total: (cs.weak && cs.weak.total) || 0, rate: (cs.weak && cs.weak.rate) || 0 },
    { name: '熔断', total: (cs.meltdown && cs.meltdown.total) || 0, rate: (cs.meltdown && cs.meltdown.rate) || 0 },
  ];
  // ★ 全零数据兜底：DB 无 pk_fusion_consensus 字段时显示提示
  const allZero = items.every(function (d) {
    return d.total === 0;
  });
  if (allZero) {
    return {
      title: {
        text: '暂无共识分类数据',
        subtext: 'prediction_logs 缺少 pk_fusion_consensus',
        left: 'center',
        top: 'center',
        textStyle: { color: '#64748B' },
        subtextStyle: { color: '#475569', fontSize: 10 },
      },
    };
  }
  const labels = items.map(function (d) {
    return d.name + '(' + d.total + '场)';
  });
  const rates = items.map(function (d) {
    return (d.rate * 100).toFixed(1);
  });
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 20, top: 40, bottom: 36 },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10, color: '#64748B' } },
    yAxis: { type: 'value', name: '命中率(%)', max: 100, axisLabel: { fontSize: 10, color: '#64748B' } },
    series: [
      {
        type: 'bar',
        data: rates,
        barCategoryGap: '45%',
        itemStyle: {
          color: function (p) {
            return ['#34D399', '#FBBF24', '#EF4444'][p.dataIndex];
          },
          borderRadius: [6, 6, 0, 0],
        },
        barMaxWidth: 50,
        label: { show: true, position: 'top', fontSize: 11, fontWeight: 'bold', color: '#fff', formatter: '{c}%' },
      },
    ],
  };
}

/* ── AI 校准曲线：置信度 vs 实际命中率 ── */
function aiCalibrationOption(stats) {
  const data = (stats && stats.ai && stats.ai.calibration) || [];
  if (!data.length)
    return { title: { text: '暂无足够数据', left: 'center', top: 'center', textStyle: { color: '#64748B' } } };
  const labels = data.map(function (d) {
    return d.label;
  });
  const actualRates = data.map(function (d) {
    return d.actualRate * 100;
  });
  const mids = data.map(function (d) {
    return parseFloat(d.predictProb);
  });

  return {
    tooltip: {
      trigger: 'axis',
      formatter: function (p) {
        const d = data[p[0].dataIndex];
        return (
          '置信区间: ' +
          d.label +
          '<br/>实际命中率: ' +
          (d.actualRate * 100).toFixed(1) +
          '%<br/>样本: ' +
          d.total +
          '场'
        );
      },
    },
    grid: { left: 48, right: 20, top: 40, bottom: 36 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { fontSize: 10, color: '#64748B' },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
    },
    yAxis: {
      type: 'value',
      name: '命中率(%)',
      max: 100,
      axisLabel: { fontSize: 10, color: '#64748B' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    series: [
      {
        name: '实际命中率',
        type: 'bar',
        data: actualRates,
        itemStyle: { color: '#34D399', borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 36,
        label: {
          show: true,
          position: 'top',
          fontSize: 9,
          color: '#94A3B8',
          formatter: function (p) {
            return (p.value || 0).toFixed(1) + '%';
          },
        },
      },
      {
        name: '理想(y=置信度/100)',
        type: 'line',
        data: mids.map(function (v) {
          return v;
        }),
        lineStyle: { color: 'rgba(251,191,36,0.5)', type: 'dashed' },
        symbol: 'none',
        tooltip: { show: false },
      },
    ],
  };
}

/* ── AI 柱状图：联赛分组 ── */
function aiBarOption(stats) {
  let leagues = (stats && stats.ai && stats.ai.byLeague) || [];
  if (!leagues.length)
    return { title: { text: '暂无联赛数据', left: 'center', top: 'center', textStyle: { color: '#64748B' } } };
  leagues.sort(function (a, b) {
    return (b.accuracy || 0) - (a.accuracy || 0);
  });
  leagues = leagues.slice(0, 12);
  const labels = leagues.map(function (l) {
    return l.league;
  });
  const rates = leagues.map(function (l) {
    return ((l.accuracy || 0) * 100).toFixed(1);
  });
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 80, right: 20, top: 10, bottom: 10 },
    xAxis: { type: 'value', name: '命中率(%)', max: 100, axisLabel: { fontSize: 10, color: '#64748B' } },
    yAxis: {
      type: 'category',
      data: labels,
      inverse: true,
      axisLabel: { fontSize: 10, color: '#94A3B8', width: 72, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        data: rates,
        itemStyle: {
          color: function (p) {
            return p.value >= 50 ? '#34D399' : p.value >= 35 ? '#FBBF24' : '#EF4444';
          },
          borderRadius: [0, 6, 6, 0],
        },
        barMaxWidth: 20,
        label: { show: true, position: 'right', fontSize: 10, color: '#94A3B8', formatter: '{c}%' },
      },
    ],
  };
}

/* ── PK 校准曲线：综合信心分 vs 命中率 ── */
function pkCalibrationOption(stats) {
  const data = (stats && stats.pk && stats.pk.calibration) || [];
  if (!data.length)
    return { title: { text: '暂无足够数据', left: 'center', top: 'center', textStyle: { color: '#64748B' } } };
  const labels = data.map(function (d) {
    return d.label;
  });
  const actualRates = data.map(function (d) {
    return d.actualRate * 100;
  });

  return {
    tooltip: {
      trigger: 'axis',
      formatter: function (p) {
        const d = data[p[0].dataIndex];
        return (
          '信心分区间: ' +
          d.label +
          '<br/>实际命中率: ' +
          (d.actualRate * 100).toFixed(1) +
          '%<br/>样本: ' +
          d.total +
          '场'
        );
      },
    },
    grid: { left: 48, right: 20, top: 40, bottom: 36 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { fontSize: 10, color: '#64748B' },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
    },
    yAxis: {
      type: 'value',
      name: '命中率(%)',
      max: 100,
      axisLabel: { fontSize: 10, color: '#64748B' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    series: [
      {
        name: '实际命中率',
        type: 'bar',
        data: actualRates,
        itemStyle: { color: '#A78BFA', borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 36,
        label: {
          show: true,
          position: 'top',
          fontSize: 9,
          color: '#94A3B8',
          formatter: function (p) {
            return (p.value || 0).toFixed(1) + '%';
          },
        },
      },
    ],
  };
}

/* ── PK 裁判验证：决策等级命中率 + ROI ── */
function pkDecisionOption(stats) {
  const rows = (stats && stats.pk && stats.pk.judge && stats.pk.judge.byDecisionLevel) || [];
  if (!rows.length)
    return { title: { text: '暂无决策等级数据', left: 'center', top: 'center', textStyle: { color: '#64748B' } } };
  const labels = rows.map(function (r) {
    return r.label + '(' + r.total + '场)';
  });
  const hitRates = rows.map(function (r) {
    return ((r.hitRate || 0) * 100).toFixed(1);
  });
  const rois = rows.map(function (r) {
    return ((r.roi || 0) * 100).toFixed(1);
  });
  return {
    tooltip: {
      trigger: 'axis',
      formatter: function (params) {
        const idx = params && params[0] ? params[0].dataIndex : 0;
        const r = rows[idx] || {};
        return (
          r.label +
          '<br/>样本: ' +
          (r.total || 0) +
          '<br/>命中率: ' +
          ((r.hitRate || 0) * 100).toFixed(1) +
          '%<br/>ROI: ' +
          fmtROI(r.roi || 0) +
          (r.sampleNote ? '<br/><span style="color:#d9b36c">' + r.sampleNote + '</span>' : '')
        );
      },
    },
    legend: { data: ['命中率', 'ROI'] },
    grid: { left: 48, right: 24, top: 44, bottom: 36 },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10, color: '#64748B' } },
    yAxis: { type: 'value', name: '%', axisLabel: { fontSize: 10, color: '#64748B' } },
    series: [
      {
        name: '命中率',
        type: 'bar',
        data: hitRates,
        itemStyle: { color: '#A78BFA', borderRadius: [5, 5, 0, 0] },
        barMaxWidth: 28,
      },
      { name: 'ROI', type: 'line', data: rois, itemStyle: { color: '#5BD4C8' }, symbolSize: 7 },
    ],
  };
}

/* ── PK 柱状图：星级命中率 ── */
function pkStarsOption(stats) {
  const stars = (stats && stats.pk && stats.pk.byStars) || [];
  if (!stars.length)
    return { title: { text: '暂无星级数据', left: 'center', top: 'center', textStyle: { color: '#64748B' } } };
  const labels = stars.map(function (s) {
    return s.stars + '★(' + s.total + '场)';
  });
  const rates = stars.map(function (s) {
    return (s.rate * 100).toFixed(1);
  });
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 20, top: 40, bottom: 36 },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10, color: '#64748B' } },
    yAxis: { type: 'value', name: '命中率(%)', max: 100, axisLabel: { fontSize: 10, color: '#64748B' } },
    series: [
      {
        type: 'bar',
        data: rates,
        itemStyle: {
          color: function (p) {
            const colors = ['#64748B', '#94A3B8', '#FBBF24', '#34D399', '#18E0E0']; // 1-5★
            return colors[p.dataIndex] || '#18E0E0';
          },
          borderRadius: [6, 6, 0, 0],
        },
        barMaxWidth: 44,
        label: { show: true, position: 'top', fontSize: 11, fontWeight: 'bold', color: '#fff', formatter: '{c}%' },
      },
    ],
  };
}

/* ═══════════════════════ Detail List ═══════════════════════ */
function renderList(list) {
  const el = document.getElementById('btList');
  if (!el) return;
  if (!list || list.length === 0) {
    el.innerHTML =
      '<div class="plan-notice" style="text-align:center;padding:80px 20px;">' +
      '<span style="display:block;margin-bottom:12px;font-size:36px;">📭</span>' +
      '<p style="font-size:14px;color:var(--text3);">暂无回测数据</p></div>';
    return;
  }

  let html =
    (_btTab === 'pk' ? renderPKJudgeOverview(_btStats) : '') +
    '<div class="chart-box" style="margin-top:16px">' +
    '<div class="chart-header"><span class="chart-title">回测明细</span></div>' +
    '<table class="filter-detail-table"><thead><tr>' +
    '<th class="fdt-date">日期</th>' +
    '<th class="fdt-match">场次</th>' +
    '<th class="fdt-teams">对阵 / 比分</th>' +
    '<th class="fdt-dir">预测结果</th>' +
    '</tr></thead><tbody>';

  list.forEach(function (row) {
    const dateDisplay = esc((row.date || '').slice(5));
    let hcp = '';
    if (row.handicap && row.handicap !== 0) {
      const sign = row.handicap > 0 ? '+' : '';
      hcp = '<span class="bt-handicap">' + sign + row.handicap + '</span>';
    }
    const scoreText = esc(row.actual_score || '-');
    const predParts = buildPredictionItems(row);
    const rawMatchNum = String(row.matchNum || '');
    const m = rawMatchNum.match(/(周[一二三四五六日天])\s*(\d{1,3})/);
    const matchWeek = m ? m[1] : '';
    const matchNo = m ? m[2] : rawMatchNum;

    const hasPKBlock = _btTab === 'pk' && (row.pk_direction || row.pk_final_direction || row.pk_decision_level);

    html +=
      '<tr>' +
      '<td class="fdt-date"><span class="bt-date-main">' +
      dateDisplay +
      '</span></td>' +
      '<td class="fdt-match">' +
      (matchWeek ? '<span class="bt-match-week">' + esc(matchWeek) + '</span>' : '') +
      '<span class="bt-match-num">' +
      esc(matchNo || '-') +
      '</span>' +
      '<span class="bt-match-league">' +
      esc(row.leagueName || '') +
      '</span></td>' +
      '<td class="fdt-teams">' +
      '<span class="bt-team-home">' +
      esc(row.homeName || '-') +
      '</span>' +
      '<span class="bt-team-score">' +
      scoreText +
      hcp +
      '</span>' +
      '<span class="bt-team-away">' +
      esc(row.visitName || '-') +
      '</span></td>' +
      '<td class="fdt-dir">' +
      '<div class="bt-pred-stack">' +
      (predParts.length ? predParts.join('') : '<span class="bt-pred-empty">-</span>') +
      '</div>' +
      '</td>' +
      '</tr>' +
      (hasPKBlock ? '<tr class="bt-pk-row"><td colspan="4">' + renderPKSnapshot(row) + '</td></tr>' : '');
  });

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

function renderPKJudgeOverview(stats) {
  const judge = stats && stats.pk && stats.pk.judge ? stats.pk.judge : {};
  const mainPick = findDecisionStat(judge, 'main_pick');
  const playable = findDecisionStat(judge, 'playable');
  const cautious = findDecisionStat(judge, 'cautious');
  const positiveEV = judge.positiveEV || {};
  const watch = judge.watchAvoidance || {};
  const note =
    mainPick.sampleNote || positiveEV.sampleNote || watch.sampleNote
      ? '<div class="bt-pk-sample-note">样本不足时结论仅供观察，未结算样本不计入统计。</div>'
      : '';
  return (
    '<div class="chart-box" id="btPKJudgePanel" style="margin-top:16px">' +
    '<div class="chart-header"><span class="chart-title">PK裁判验证</span></div>' +
    '<div class="bt-pk-judge-grid">' +
    '<div class="bt-pk-judge-card"><b>主推</b><span>' +
    fmtPct(mainPick.hitRate) +
    '</span><em>ROI ' +
    fmtROI(mainPick.roi) +
    '｜' +
    mainPick.total +
    '场</em></div>' +
    '<div class="bt-pk-judge-card"><b>可做/谨慎</b><span>' +
    fmtPct(playable.hitRate) +
    ' / ' +
    fmtPct(cautious.hitRate) +
    '</span><em>验证分层是否有效</em></div>' +
    '<div class="bt-pk-judge-card"><b>正EV</b><span>' +
    fmtROI(positiveEV.roi) +
    '</span><em>' +
    (positiveEV.total || 0) +
    '场｜命中 ' +
    fmtPct(positiveEV.hitRate) +
    '</em></div>' +
    '<div class="bt-pk-judge-card"><b>观望避坑</b><span>' +
    fmtPct(watch.avoidRate) +
    '</span><em>' +
    (watch.avoided || 0) +
    '/' +
    (watch.total || 0) +
    ' 场</em></div>' +
    '</div>' +
    note +
    '</div>'
  );
}

function buildPredictionItems(row) {
  const parts = [];
  const isGS = _btTab === 'gs';
  const isAI = _btTab === 'ai';
  const isPK = _btTab === 'pk';

  // GS prediction
  if (row.gs_top_score) {
    const dimClass = isGS ? '' : ' bt-pred-dim';
    parts.push(
      '<div class="bt-pred-item' +
        dimClass +
        '">' +
        '<span class="pred-label">GS</span>' +
        '<span class="pred-val ' +
        (row.gs_hit ? 'pred-hit' : 'pred-miss') +
        '">' +
        esc(row.gs_top_score) +
        (isGS && row.gs_top_percent ? ' ' + Math.round(row.gs_top_percent) + '%' : '') +
        (row.gs_hit ? ' ✓' : ' ✕') +
        '</span></div>',
    );
  }

  // AI prediction
  if (row.ai_spf) {
    const dimClass2 = isAI ? '' : ' bt-pred-dim';
    parts.push(
      '<div class="bt-pred-item' +
        dimClass2 +
        '">' +
        '<span class="pred-label">AI</span>' +
        '<span class="pred-val ' +
        (row.ai_hit ? 'pred-hit' : 'pred-miss') +
        '">' +
        esc(row.ai_spf) +
        (isAI && row.ai_confidence ? ' ' + Math.round(row.ai_confidence) : '') +
        (row.ai_hit ? ' ✓' : ' ✕') +
        '</span></div>',
    );
  }

  // PK prediction
  if (row.pk_direction || row.pk_final_direction || row.pk_decision_level) {
    const dimClass3 = isPK ? '' : ' bt-pred-dim';
    const finalDir = row.pk_final_direction === 'watch' ? '观望' : row.pk_final_direction || row.pk_direction || '观望';
    let extra = '';
    if (isPK && row.pk_direction_stars) extra = ' ' + '★'.repeat(row.pk_direction_stars);
    if (isPK && row.pk_composite_score) extra += ' ' + Math.round(row.pk_composite_score) + '分';
    parts.push(
      '<div class="bt-pred-item' +
        dimClass3 +
        '">' +
        '<span class="pred-label">PK</span>' +
        '<span class="pred-val ' +
        (row.pk_judge_hit ? 'pred-hit' : 'pred-miss') +
        '">' +
        esc(finalDir) +
        extra +
        (row.pk_final_direction === 'watch' ? ' ⏸' : row.pk_judge_hit ? ' ✓' : ' ✕') +
        '</span></div>',
    );
  }

  return parts;
}

function renderPKSnapshot(row) {
  const tags = Array.isArray(row.pk_risk_tags) ? row.pk_risk_tags : [];
  const reasons = Array.isArray(row.pk_degrade_reasons) ? row.pk_degrade_reasons : [];
  const attrs = Array.isArray(row.pk_attribution_tags) ? row.pk_attribution_tags : [];
  const chips = tags.length
    ? tags
        .slice(0, 3)
        .map(function (t) {
          return '<span class="bt-pk-chip">' + esc(t) + '</span>';
        })
        .join('')
    : '<span class="bt-pk-chip ok">低风险</span>';
  const reasonText = reasons.length ? reasons.join('、') : '无强制降级原因';
  const attrChips = attrs.length
    ? attrs
        .slice(0, 4)
        .map(function (t) {
          return '<span class="bt-pk-chip attr">' + esc(t) + '</span>';
        })
        .join('')
    : '<span class="bt-pk-chip ok">归因待积累</span>';
  return (
    '<div class="bt-pk-snapshot">' +
    '<div class="bt-pk-topline">' +
    '<span class="bt-pk-meta">裁判<strong>' +
    esc(displayDecisionLevel(row.pk_decision_level || '观望')) +
    '</strong></span>' +
    '<span class="bt-pk-meta">风险<strong>' +
    esc(displayRiskLevel(row.pk_risk_level || '-')) +
    '</strong></span>' +
    '<span class="bt-pk-meta">EV<strong>' +
    (row.pk_selected_ev == null ? '-' : Number(row.pk_selected_ev).toFixed(2)) +
    '</strong></span>' +
    '<span class="bt-pk-meta">ROI<strong>' +
    fmtROI(row.pk_unit_roi) +
    '</strong></span>' +
    '</div>' +
    '<div class="bt-pk-narrative">' +
    esc(row.pk_decision_narrative || 'PK裁判：暂无复盘说明') +
    '</div>' +
    '<div class="bt-pk-kv"><span class="bt-pk-kv-k">赛前裁判</span><span class="bt-pk-kv-v">' +
    esc(displayDecisionLevel(row.pk_decision_level || '观望')) +
    '｜' +
    esc(row.pk_final_direction || row.pk_direction || 'watch') +
    '</span></div>' +
    '<div class="bt-pk-chip-row">' +
    chips +
    '</div>' +
    '<div class="bt-pk-kv"><span class="bt-pk-kv-k">降级原因</span><span class="bt-pk-kv-v">' +
    esc(reasonText) +
    '</span></div>' +
    '<div class="bt-pk-kv"><span class="bt-pk-kv-k">归因标签</span><span class="bt-pk-kv-v">' +
    attrChips +
    '</span></div>' +
    '<div class="bt-pk-kv"><span class="bt-pk-kv-k">分歧类型</span><span class="bt-pk-kv-v">' +
    esc(row.pk_conflict_type || '-') +
    '</span></div>' +
    '<div class="bt-pk-kv"><span class="bt-pk-kv-k">快照状态</span><span class="bt-pk-kv-v">' +
    esc(displaySnapshotStatus(row.pk_snapshot_status || '-')) +
    '</span></div>' +
    '<div class="bt-pk-kv"><span class="bt-pk-kv-k">赛后结果</span><span class="bt-pk-kv-v">' +
    esc(row.actual_spf || '-') +
    ' / ' +
    esc(row.actual_score || '-') +
    '</span></div>' +
    '</div>'
  );
}

/* ═══════════════════════ Pagination ═══════════════════════ */
function renderPager(data) {
  const el = document.getElementById('btPager');
  if (!el) return;
  const totalPages = Math.ceil((data.total || 0) / (data.pageSize || 20));
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }
  const cur = data.page || 1;
  const pages = buildPageRange(cur, totalPages);
  let html = '<div class="bt-pager-wrap">';
  html +=
    '<button class="bt-pager-btn bt-pager-nav" onclick="btGoPage(1)"' + (cur === 1 ? ' disabled' : '') + '>«</button>';
  html +=
    '<button class="bt-pager-btn bt-pager-nav" onclick="btGoPage(' +
    (cur - 1) +
    ')"' +
    (cur === 1 ? ' disabled' : '') +
    '>‹</button>';
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p === '...') html += '<span class="bt-pager-ellipsis">…</span>';
    else
      html +=
        '<button class="bt-pager-btn' +
        (p === cur ? ' active' : '') +
        '" onclick="btGoPage(' +
        p +
        ')">' +
        p +
        '</button>';
  }
  html +=
    '<button class="bt-pager-btn bt-pager-nav" onclick="btGoPage(' +
    (cur + 1) +
    ')"' +
    (cur === totalPages ? ' disabled' : '') +
    '>›</button>';
  html +=
    '<button class="bt-pager-btn bt-pager-nav" onclick="btGoPage(' +
    totalPages +
    ')"' +
    (cur === totalPages ? ' disabled' : '') +
    '>»</button>';
  html += '<span class="bt-pager-info">' + cur + ' / ' + totalPages + ' 页</span></div>';
  el.innerHTML = html;
}

function buildPageRange(cur, total) {
  if (total <= 7) {
    const arr = [];
    for (var i = 1; i <= total; i++) arr.push(i);
    return arr;
  }
  const pages = [1];
  const left = Math.max(2, cur - 2),
    right = Math.min(total - 1, cur + 2);
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
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// =============================================================
// * 蓝图：实验对比 tab
// =============================================================
async function loadExperimentCompare() {
  const el = document.getElementById('btExperimentContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载实验数据...</div>';

  try {
    const data = await api('experiment-compare');
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
  let html = '';
  Object.keys(data).forEach(function (type) {
    const rows = data[type];
    if (!rows || rows.length === 0) return;
    const typeLabel =
      type === 'deepseek' ? 'DeepSeek AI' : type === 'doubao' ? '豆包 AI' : type === 'outcomes' ? '模型回测' : type;
    const hasConfidence = rows.some(function (r) {
      return r.avgConfidence != null;
    });
    html +=
      '<div class="chart-box"><div class="chart-header"><span class="chart-title">' +
      typeLabel +
      '版本对比</span></div>';
    html +=
      '<table style="width:100%;font-size:var(--fs-sm)"><thead><tr style="color:var(--text3)"><th style="text-align:left;padding:6px">版本</th><th>总数</th><th>命中</th><th>命中率</th>' +
      (hasConfidence ? '<th>置信度</th>' : '') +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      const rateColor = r.hitRate >= 60 ? 'var(--green)' : r.hitRate >= 50 ? 'var(--amber)' : 'var(--red)';
      html +=
        '<tr style="border-top:1px solid rgba(255,255,255,0.04)"><td style="padding:6px;color:var(--text)">' +
        r.version +
        '</td><td style="text-align:center;color:var(--text2)">' +
        r.total +
        '</td><td style="text-align:center;color:var(--text2)">' +
        r.hits +
        '</td><td style="text-align:center;color:' +
        rateColor +
        ';font-weight:700">' +
        r.hitRate +
        '%</td>';
      if (hasConfidence) {
        html +=
          '<td style="text-align:center;color:var(--text3)">' +
          (r.avgConfidence != null ? (r.avgConfidence * 100).toFixed(1) + '%' : '--') +
          '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  });
  return html;
}

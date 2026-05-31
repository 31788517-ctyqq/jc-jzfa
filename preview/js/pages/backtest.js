/**
 * preview/js/pages/backtest.js
 * 预测回测页面 — 筛选 + 统计 + 明细列表
 * V3：紧凑布局、联赛筛选、高级选项可收起、隐藏空预测格
 */
import { api } from '../api.js';

var _btPage = 1,
  _btPageSize = 20,
  _btLeagues = [];

export function loadBacktest() {
  try {
    var el = document.getElementById('page-backtest');
    if (!el) {
      console.error('[BT] #page-backtest not found');
      return;
    }
    el.innerHTML = renderPage();
    injectStyles();
    console.log('[BT] page rendered, fetching data...');
    fetchData();
  } catch (e) {
    console.error('[BT] loadBacktest error:', e);
    var el = document.getElementById('page-backtest');
    if (el) el.innerHTML = '<div style="color:red;padding:20px;">回测页面加载失败: ' + e.message + '</div>';
  }
}

function injectStyles() {
  if (document.getElementById('bt-inline-css')) return;
  var s = document.createElement('style');
  s.id = 'bt-inline-css';
  s.textContent = [
    '.backtest-page { padding:8px 0; }',

    /* 统计卡片 */
    '.bt-stats-card { background:var(--card); border:1px solid var(--card-border); border-radius:22px; padding:18px 20px; margin-bottom:12px; }',
    '.bt-stats-row { display:flex; align-items:center; justify-content:space-around; text-align:center; }',
    '.bt-stat-item { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; }',
    '.bt-stat-value { font-size:28px; font-weight:900; color:var(--cyan); text-shadow:0 0 12px rgba(24,224,224,0.18); line-height:1.1; }',
    '.bt-stat-label { font-size:11px; color:var(--text2); }',
    '.bt-val-green { color:var(--green) !important; text-shadow:0 0 12px rgba(52,211,153,0.18) !important; }',
    '.bt-val-amber { color:var(--amber) !important; text-shadow:0 0 12px rgba(251,191,36,0.18) !important; }',
    '.bt-stat-divider { width:1px; height:36px; background:rgba(255,255,255,0.08); flex-shrink:0; }',

    /* 筛选行紧凑 */
    '#btFilterCard .filter-row { min-height:48px; padding:2px 4px; }',
    '#btFilterCard .filter-head { margin-bottom:8px; }',
    '#btFilterCard .filter-btn-wrap { margin-top:4px; }',

    /* 高级筛选折叠 */
    '.bt-advanced-toggle { display:flex; align-items:center; gap:4px; padding:6px 4px; color:var(--text3); font-size:12px; cursor:pointer; user-select:none; border-top:1px solid rgba(255,255,255,0.04); margin-top:2px; }',
    '.bt-advanced-toggle .arr { transition:transform .2s; display:inline-block; font-size:10px; }',
    '.bt-advanced-toggle.open .arr { transform:rotate(180deg); }',
    '.bt-advanced-filters { display:none; }',
    '.bt-advanced-filters.open { display:block; }',

    /* 类型标签 */
    '.bt-type-tag { font-size:10px; padding:2px 8px; border-radius:999px; }',
    '.bt-type-tag.bt-type-ai { background:rgba(24,224,224,0.12); color:var(--cyan); }',
    '.bt-type-tag.bt-type-pk { background:rgba(167,139,250,0.12); color:var(--purple); }',
    '.bt-type-tag.bt-type-gs { background:rgba(251,191,36,0.12); color:var(--amber); }',

    /* 结果网格 */
    '.bt-result-grid { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }',
    '.bt-result-cell { flex:1; min-width:64px; text-align:center; padding:6px 3px; border-radius:8px; background:rgba(255,255,255,0.03); }',
    '.bt-result-label { display:block; font-size:10px; color:var(--text3); margin-bottom:3px; }',
    '.bt-result-val { font-size:12px; font-weight:600; }',
    '.bt-hit .bt-result-val { color:var(--green); }',
    '.bt-miss .bt-result-val { color:var(--red); }',

    /* 比赛卡片 */
    '.backtest-row { padding:14px 16px !important; margin-bottom:8px; }',
    '.backtest-row .match-header { margin-bottom:8px; }',
    '.backtest-row .match-teams { margin-bottom:6px; }',

    /* 赛果SPF标签 */
    '.bt-spf-badge { display:inline-block; font-size:11px; padding:3px 10px; border-radius:999px; margin-left:8px; font-weight:600; }',
    '.bt-spf-badge.bt-spf-home { background:rgba(24,224,224,0.12); color:var(--cyan); }',
    '.bt-spf-badge.bt-spf-draw { background:rgba(167,139,250,0.12); color:var(--purple); }',
    '.bt-spf-badge.bt-spf-away { background:rgba(251,191,36,0.12); color:var(--amber); }',

    /* 分页 */
    '.backtest-pager { margin-top:12px; }',
    '.bt-pager-wrap { display:flex; justify-content:center; align-items:center; gap:6px; padding:16px 0; flex-wrap:wrap; }',
    '.bt-pager-btn { min-width:32px; height:32px; padding:0 6px; border-radius:8px; border:1px solid rgba(255,255,255,0.1); background:transparent; color:var(--text2); font-size:13px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; transition:all .15s; }',
    '.bt-pager-btn:hover { border-color:rgba(255,255,255,0.25); color:#fff; }',
    '.bt-pager-btn.active { background:var(--cyan); color:var(--bg); border-color:var(--cyan); font-weight:700; }',
    '.bt-pager-btn:disabled { opacity:0.3; cursor:default; pointer-events:none; }',
    '.bt-pager-ellipsis { min-width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; color:var(--text3); font-size:13px; }',
    '.bt-pager-nav { min-width:28px; }',
    '.bt-pager-info { font-size:12px; color:var(--text3); margin:0 8px; white-space:nowrap; }',

    /* 日期标记 */
    '.bt-date-tag { font-size:11px; color:var(--text3); margin-right:8px; }',

    /* 列表容器 */
    '.bt-summary-bar { display:flex; justify-content:space-between; align-items:center; padding:6px 4px 12px; color:var(--text3); font-size:12px; }',
    '.bt-summary-bar strong { color:var(--cyan); }',
  ].join('\n');
  document.head.appendChild(s);
}

function renderPage() {
  return (
    '<div class="backtest-page">' +
    renderFilterCard() +
    renderStatsCard() +
    '<div class="bt-summary-bar" id="btSummary" style="display:none;">' +
    '<span>共 <strong id="btSummaryCount">0</strong> 场比赛</span>' +
    '<span style="cursor:pointer;color:var(--cyan);" onclick="btGoTop()">↑ 回到顶部</span>' +
    '</div>' +
    '<div class="backtest-list" id="btList"></div>' +
    '<div class="backtest-pager" id="btPager"></div>' +
    '</div>'
  );
}

/* ── 筛选卡片 ── */
function renderFilterCard() {
  return [
    '<div class="filter-section-card" id="btFilterCard">',
    '<div class="filter-head">回测筛选</div>',

    // 核心筛选: 时间 + 联赛
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
    '</div>',
    '</div>',

    // 方向筛选
    filterDD('dd-btDir', '方向', [
      { v: 'all', l: '全部' },
      { v: 'home', l: '主胜' },
      { v: 'away', l: '客胜' },
      { v: 'draw', l: '平' },
    ]),

    // 高级筛选 (可收起)
    '<div class="bt-advanced-toggle" onclick="btToggleAdvanced()" id="btAdvToggle">',
    '<span>高级筛选</span><span class="arr">▼</span>',
    '</div>',
    '<div class="bt-advanced-filters" id="btAdvFilters">',
    filterDD('dd-btAiConf', 'AI信心', [
      { v: 'all', l: '全部' },
      { v: 'high', l: '高(≥80)' },
      { v: 'mid', l: '中(70-79)' },
      { v: 'low', l: '低(<70)' },
    ]),
    filterDD('dd-btPkConf', 'PK信心', [
      { v: 'all', l: '全部' },
      { v: 'high', l: '高(≥70)' },
      { v: 'mid', l: '中(50-69)' },
      { v: 'low', l: '低(<50)' },
    ]),
    '</div>',

    '<div class="filter-btn-wrap">',
    '<button class="filter-submit-btn" onclick="doBTQuery()">查询</button>',
    '</div>',
    '</div>',
  ].join('');
}

function filterDD(id, label, opts) {
  var items = '';
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
    '<span class="filter-label">' + label + '</span>' +
    '<div class="filter-dd" id="' + id + '" data-val="' + opts[0].v + '">' +
    '<div class="filter-dd-trigger" onclick="toggleDD(\'' + id + '\', event)">' +
    '<span class="filter-dd-text">' + opts[0].l + '</span>' +
    '<svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg>' +
    '</div>' +
    '<ul class="filter-dd-menu">' + items + '</ul>' +
    '</div>' +
    '</div>'
  );
}

/* ── 高级筛选折叠 ── */
window.btToggleAdvanced = function () {
  var toggle = document.getElementById('btAdvToggle');
  var filters = document.getElementById('btAdvFilters');
  if (!toggle || !filters) return;
  var isOpen = filters.classList.toggle('open');
  toggle.classList.toggle('open', isOpen);
};

/* ── 查询触发 ── */
window.doBTQuery = function () {
  _btPage = 1;
  fetchData();
};

window.btGoTop = function () {
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

function getBTFilters() {
  function v(id) {
    return window.getDDVal ? window.getDDVal(id) || 'all' : 'all';
  }
  return {
    type: 'all',
    dateRange: v('dd-btRange'),
    league: v('dd-btLeague'),
    direction: v('dd-btDir'),
    aiConf: v('dd-btAiConf'),
    pkConf: v('dd-btPkConf'),
    consensus: 'all',
  };
}

/* ── 填充联赛下拉 ── */
function populateLeagues(leagues) {
  if (!leagues || !leagues.length) return;
  _btLeagues = leagues;
  var menu = document.getElementById('dd-btLeague-menu');
  if (!menu) return;
  var html = '<li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-btLeague\',\'all\',\'全部\')">全部</li>';
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

/* ── 数据请求 ── */
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
      // 填充联赛列表
      if (res.leagues && _btLeagues.length === 0) {
        populateLeagues(res.leagues);
      } else if (res.leagues) {
        populateLeagues(res.leagues);
      }
      renderStats(res.stats);
      renderList(res.items);
      renderPager(res);
      // 更新摘要栏
      var s = document.getElementById('btSummary');
      var sc = document.getElementById('btSummaryCount');
      if (s) s.style.display = (res.total || 0) > 0 ? 'flex' : 'none';
      if (sc) sc.textContent = (res.total || 0).toLocaleString();
    })
    .catch(function (e) {
      console.error('backtest fetch error:', e);
      var el = document.getElementById('btList');
      if (el)
        el.innerHTML =
          '<div class="plan-notice" style="text-align:center;padding:40px 0;color:var(--red);">数据加载失败: ' +
          e.message +
          '</div>';
    });
}

/* ── 统计卡片 ── */
function renderStatsCard() {
  return (
    '<div class="bt-stats-card" id="btStatsCard">' +
    '<div class="bt-stats-row">' +
    '<div class="bt-stat-item">' +
    '<div class="bt-stat-value" id="btTotal">-</div>' +
    '<div class="bt-stat-label">总预测</div>' +
    '</div>' +
    '<div class="bt-stat-divider"></div>' +
    '<div class="bt-stat-item">' +
    '<div class="bt-stat-value bt-val-green" id="btAiAcc">-</div>' +
    '<div class="bt-stat-label">AI准确率</div>' +
    '</div>' +
    '<div class="bt-stat-divider"></div>' +
    '<div class="bt-stat-item">' +
    '<div class="bt-stat-value" id="btPkAcc">-</div>' +
    '<div class="bt-stat-label">PK准确率</div>' +
    '</div>' +
    '<div class="bt-stat-divider"></div>' +
    '<div class="bt-stat-item">' +
    '<div class="bt-stat-value bt-val-amber" id="btGsHit">-</div>' +
    '<div class="bt-stat-label">GS比中</div>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function renderStats(stats) {
  if (!stats) return;
  var t = document.getElementById('btTotal');
  var a = document.getElementById('btAiAcc');
  var p = document.getElementById('btPkAcc');
  var g = document.getElementById('btGsHit');
  if (t) t.textContent = (stats.total || 0).toLocaleString();
  if (a) a.textContent = Math.round((stats.ai_accuracy || 0) * 100) + '%';
  if (p) p.textContent = Math.round((stats.pk_accuracy || 0) * 100) + '%';
  if (g) g.textContent = Math.round((stats.gs_score_hit_rate || 0) * 100) + '%';
}

/* ── 明细列表 ── */
function renderList(list) {
  var el = document.getElementById('btList');
  if (!el) return;
  if (!list || list.length === 0) {
    el.innerHTML =
      '<div class="plan-notice" style="text-align:center;padding:80px 20px;">' +
      '<span class="notice-icon" style="display:block;margin-bottom:16px;"><img src="/assets/expressionless-face.svg" width="48" height="48" alt="" decoding="async"/></span>' +
      '<p style="font-size:14px;color:var(--text3);">暂无回测数据</p>' +
      '</div>';
    return;
  }

  var html = '';
  list.forEach(function (row) {
    var tags = [];
    if (row.ai_spf) tags.push('<span class="bt-type-tag bt-type-ai">AI</span>');
    if (row.pk_direction) tags.push('<span class="bt-type-tag bt-type-pk">PK</span>');
    if (row.gs_top_score) tags.push('<span class="bt-type-tag bt-type-gs">GS</span>');

    // 结果单元格（仅在有预测数据时显示）
    var cells = '';
    if (row.ai_spf) {
      cells +=
        '<div class="bt-result-cell ' + (row.ai_hit ? 'bt-hit' : 'bt-miss') + '">' +
        '<span class="bt-result-label">AI</span>' +
        '<span class="bt-result-val">' + esc(row.ai_spf) + (row.ai_hit ? ' ✓' : ' ✗') + '</span></div>';
    }
    if (row.pk_direction) {
      cells +=
        '<div class="bt-result-cell ' + (row.pk_hit ? 'bt-hit' : 'bt-miss') + '">' +
        '<span class="bt-result-label">PK</span>' +
        '<span class="bt-result-val">' + esc(row.pk_direction) + (row.pk_hit ? ' ✓' : ' ✗') + '</span></div>';
    }
    if (row.gs_top_score) {
      cells +=
        '<div class="bt-result-cell ' + (row.gs_hit ? 'bt-hit' : 'bt-miss') + '">' +
        '<span class="bt-result-label">GS</span>' +
        '<span class="bt-result-val">' + esc(row.gs_top_score) + (row.gs_hit ? ' ✓' : ' ✗') + '</span></div>';
    }

    // 赛果SPF标签
    var spfBadge = '';
    if (row.actual_spf) {
      var spfClass = '';
      if (row.actual_spf === '主胜') spfClass = 'bt-spf-home';
      else if (row.actual_spf === '平') spfClass = 'bt-spf-draw';
      else spfClass = 'bt-spf-away';
      spfBadge = '<span class="bt-spf-badge ' + spfClass + '">' + esc(row.actual_spf) + '</span>';
    }

    html +=
      '<div class="match-card backtest-row">' +
      '<div class="match-header"><div class="match-header-left">' +
      '<span class="match-league">' + esc(row.leagueName || '') + '</span>' +
      '<span class="match-num">' + esc(row.matchNum || '') + '</span>' +
      '</div>' +
      '<div class="match-header-right">' + tags.join('') + spfBadge + '</div>' +
      '</div>' +
      '<div class="match-teams"><span class="team-name">' + esc(row.homeName || '') + '</span>' +
      '<span class="match-score" style="font-size:14px;">' + esc(row.actual_score || '-') + '</span>' +
      '<span class="team-name">' + esc(row.visitName || '') + '</span></div>' +
      // ★ 仅在有预测数据时显示结果网格
      (cells ? '<div class="bt-result-grid">' + cells + '</div>' : '') +
      '</div>';
  });
  el.innerHTML = html;
}

/* ── 智能分页 ── */
function renderPager(data) {
  var el = document.getElementById('btPager');
  if (!el) return;
  var totalPages = Math.ceil((data.total || 0) / (data.pageSize || 20));
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  var cur = data.page || 1;
  var pages = buildPageRange(cur, totalPages);

  var html = '<div class="bt-pager-wrap">';

  // « 首页
  html += '<button class="bt-pager-btn bt-pager-nav" onclick="btGoPage(1)"' + (cur === 1 ? ' disabled' : '') + ' title="首页">«</button>';
  // ‹ 上一页
  html += '<button class="bt-pager-btn bt-pager-nav" onclick="btGoPage(' + (cur - 1) + ')"' + (cur === 1 ? ' disabled' : '') + ' title="上一页">‹</button>';

  for (var i = 0; i < pages.length; i++) {
    var p = pages[i];
    if (p === '...') {
      html += '<span class="bt-pager-ellipsis">…</span>';
    } else {
      html += '<button class="bt-pager-btn' + (p === cur ? ' active' : '') + '" onclick="btGoPage(' + p + ')">' + p + '</button>';
    }
  }

  // › 下一页
  html += '<button class="bt-pager-btn bt-pager-nav" onclick="btGoPage(' + (cur + 1) + ')"' + (cur === totalPages ? ' disabled' : '') + ' title="下一页">›</button>';
  // » 末页
  html += '<button class="bt-pager-btn bt-pager-nav" onclick="btGoPage(' + totalPages + ')"' + (cur === totalPages ? ' disabled' : '') + ' title="末页">»</button>';

  html += '<span class="bt-pager-info">' + cur + ' / ' + totalPages + ' 页</span>';
  html += '</div>';
  el.innerHTML = html;
}

/** 构建分页范围：首页、末页、当前±2、省略号 */
function buildPageRange(cur, total) {
  if (total <= 7) {
    // 少于7页，全部显示
    var arr = [];
    for (var i = 1; i <= total; i++) arr.push(i);
    return arr;
  }
  var pages = [1]; // 首页
  var left = Math.max(2, cur - 2);
  var right = Math.min(total - 1, cur + 2);

  if (left > 2) pages.push('...');
  for (var i = left; i <= right; i++) pages.push(i);
  if (right < total - 1) pages.push('...');
  pages.push(total); // 末页
  return pages;
}

window.btGoPage = function (p) {
  _btPage = p;
  fetchData();
  document.getElementById('page-backtest').scrollIntoView({ behavior: 'smooth' });
};

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

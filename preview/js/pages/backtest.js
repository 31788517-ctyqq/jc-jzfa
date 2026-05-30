/**
 * preview/js/pages/backtest.js
 * 预测回测页面 — 筛选 + 统计 + 明细列表
 * V2：复用 filter-section-card / filter-dd 体系，与方案收入筛选卡片风格对齐
 */
import { api } from '../api.js';

var _btPage = 1, _btPageSize = 20;

export function loadBacktest() {
  try {
    var el = document.getElementById('page-backtest');
    if (!el) { console.error('[BT] #page-backtest not found'); return; }
    el.innerHTML = renderPage();
    injectStyles();
    console.log('[BT] page rendered, fetching data...');
    fetchData();
  } catch(e) {
    console.error('[BT] loadBacktest error:', e);
    var el = document.getElementById('page-backtest');
    if (el) el.innerHTML = '<div style="color:red;padding:20px;">回测页面加载失败: '+e.message+'</div>';
  }
}

function injectStyles() {
  if (document.getElementById('bt-inline-css')) return;
  var s = document.createElement('style');
  s.id = 'bt-inline-css';
  s.textContent = [
    '.backtest-page { padding:12px 0; }',
    '.bt-type-tag { font-size:10px;padding:2px 8px;border-radius:999px;margin-left:4px; }',
    '.bt-type-tag.bt-type-ai { background:rgba(24,224,224,0.12);color:var(--cyan); }',
    '.bt-type-tag.bt-type-pk { background:rgba(167,139,250,0.12);color:var(--purple); }',
    '.bt-type-tag.bt-type-gs { background:rgba(251,191,36,0.12);color:var(--amber); }',
    '.bt-result-grid { display:flex;gap:8px;margin-top:10px;flex-wrap:wrap; }',
    '.bt-result-cell { flex:1;min-width:70px;text-align:center;padding:8px 4px;border-radius:8px;background:rgba(255,255,255,0.03); }',
    '.bt-result-label { display:block;font-size:10px;color:var(--text3);margin-bottom:4px; }',
    '.bt-result-val { font-size:12px;font-weight:600; }',
    '.bt-hit .bt-result-val { color:var(--green); }',
    '.bt-miss .bt-result-val { color:var(--red); }',
    '.backtest-pager { margin-top:12px; }',
    '.backtest-row { margin-bottom:8px; }',
    '#btStatsCard .filter-stat-value { font-size:28px; font-weight:900; }',
    '.bt-single-card { padding:20px 16px; }',
    '.bt-stats-row { display:flex; align-items:center; justify-content:space-around; text-align:center; }',
    '.bt-stat-item { flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; }',
    '.bt-stat-value { font-size:28px; font-weight:900; color:var(--cyan); text-shadow:0 0 12px rgba(24,224,224,0.18); line-height:1.1; }',
    '.bt-stat-label { font-size:11px; color:var(--text2); }',
    '.bt-val-green { color:var(--green); text-shadow:0 0 12px rgba(52,211,153,0.18); }',
    '.bt-val-amber { color:var(--amber); text-shadow:0 0 12px rgba(251,191,36,0.18); }',
    '.bt-stat-divider { width:1px; height:36px; background:rgba(255,255,255,0.08); flex-shrink:0; }',
  ].join('\n');
  document.head.appendChild(s);
}

function renderPage() {
  return '<div class="backtest-page">' +
    renderFilterCard() +
    renderStatsCard() +
    '<div class="backtest-list" id="btList"></div>' +
    '<div class="backtest-pager" id="btPager"></div>' +
    '</div>';
}

/* ── 筛选卡片：复用 filter-section-card + filter-dd 体系 ── */
function renderFilterCard() {
  return [
    '<div class="filter-section-card">',
      '<div class="filter-head">筛选条件</div>',

      filterDD('dd-btType', '类型', [
        {v:'all',l:'全部'},{v:'ai',l:'AI'},{v:'pk',l:'PK'},{v:'gs',l:'GS'}
      ]),
      filterDD('dd-btRange', '时间', [
        {v:'all',l:'全部'},{v:'7d',l:'7天'},{v:'30d',l:'30天'},{v:'60d',l:'60天'},{v:'90d',l:'90天'}
      ]),
      filterDD('dd-btDir', '方向', [
        {v:'all',l:'全部'},{v:'home',l:'主胜'},{v:'away',l:'客胜'},{v:'draw',l:'平'}
      ]),
      filterDD('dd-btAiConf', 'AI信心', [
        {v:'all',l:'全部'},{v:'high',l:'高'},{v:'mid',l:'中'},{v:'low',l:'低'}
      ]),
      filterDD('dd-btPkConf', 'PK信心', [
        {v:'all',l:'全部'},{v:'high',l:'高'},{v:'mid',l:'中'},{v:'low',l:'低'}
      ]),

      '<div class="filter-btn-wrap">',
        '<button class="filter-submit-btn" onclick="doBTQuery()">查询</button>',
      '</div>',
    '</div>'
  ].join('');
}

function filterDD(id, label, opts) {
  var items = '';
  opts.forEach(function(o, i) {
    items += '<li data-val="' + o.v + '" class="filter-dd-option' + (i === 0 ? ' selected' : '') +
      '" onclick="selectDD(\'' + id + '\',\'' + o.v + '\',\'' + o.l + '\')">' + o.l + '</li>';
  });

  return '<div class="filter-row">' +
    '<span class="filter-label">' + label + '</span>' +
    '<div class="filter-dd" id="' + id + '" data-val="' + opts[0].v + '">' +
      '<div class="filter-dd-trigger" onclick="toggleDD(\'' + id + '\', event)">' +
        '<span class="filter-dd-text">' + opts[0].l + '</span>' +
        '<svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg>' +
      '</div>' +
      '<ul class="filter-dd-menu">' + items + '</ul>' +
    '</div>' +
    '</div>';
}

// 查询按钮：读取 filter-dd 当前值后发起请求
window.doBTQuery = function() {
  _btPage = 1;
  fetchData();
};

function getBTFilters() {
  function v(id) { return window.getDDVal ? window.getDDVal(id) || 'all' : 'all'; }
  return {
    type: v('dd-btType'), dateRange: v('dd-btRange'),
    league: 'all', direction: v('dd-btDir'),
    aiConf: v('dd-btAiConf'), pkConf: v('dd-btPkConf'),
    consensus: 'all'
  };
}

/* ── 数据请求 ── */
function fetchData() {
  var el = document.getElementById('btList');
  if (el) el.innerHTML = '<div class="plan-notice" style="text-align:center;padding:20px;color:var(--text2);">加载中...</div>';

  var f = getBTFilters();
  api('prediction-backtest', {
    type: f.type, dateRange: f.dateRange,
    league: f.league, direction: f.direction,
    aiConf: f.aiConf, pkConf: f.pkConf,
    consensus: f.consensus, page: _btPage, pageSize: _btPageSize
  }).then(function(res) {
    renderStats(res.stats);
    renderList(res.items);
    renderPager(res);
  }).catch(function(e) {
    console.error('backtest fetch error:', e);
    var el = document.getElementById('btList');
    if (el) el.innerHTML = '<div class="plan-notice" style="text-align:center;padding:20px;color:var(--red);">数据加载失败: '+e.message+'</div>';
  });
}

/* ── 统计卡片：四个数据合并到一个卡片内，无分隔线 ── */
function renderStatsCard() {
  return '<div class="filter-stats-card bt-single-card" id="btStatsCard">' +
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
        '<div class="bt-stat-value bt-val-cyan" id="btPkAcc">-</div>' +
        '<div class="bt-stat-label">PK准确率</div>' +
      '</div>' +
      '<div class="bt-stat-divider"></div>' +
      '<div class="bt-stat-item">' +
        '<div class="bt-stat-value bt-val-amber" id="btGsHit">-</div>' +
        '<div class="bt-stat-label">GS比中</div>' +
      '</div>' +
    '</div>' +
    '</div>';
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
    el.innerHTML = '<div class="plan-notice"><span class="notice-icon"><img src="/assets/expressionless-face.svg" width="32" height="32" alt="" decoding="async"/></span>暂无回测数据。请确保已有比赛完成且AI/GS/PK数据已入库。</div>';
    return;
  }
  var html = '';
  list.forEach(function(row) {
    var tags = [];
    if (row.ai_spf) tags.push('<span class="bt-type-tag bt-type-ai">AI</span>');
    if (row.pk_direction) tags.push('<span class="bt-type-tag bt-type-pk">PK</span>');
    if (row.gs_top_score) tags.push('<span class="bt-type-tag bt-type-gs">GS</span>');

    var cells = '';
    if (row.ai_spf) {
      cells += '<div class="bt-result-cell ' + (row.ai_hit ? 'bt-hit' : 'bt-miss') + '">' +
        '<span class="bt-result-label">AI</span>' +
        '<span class="bt-result-val">' + esc(row.ai_spf) + (row.ai_hit ? ' ✓' : ' ✗') + '</span></div>';
    }
    if (row.pk_direction) {
      cells += '<div class="bt-result-cell ' + (row.pk_hit ? 'bt-hit' : 'bt-miss') + '">' +
        '<span class="bt-result-label">PK</span>' +
        '<span class="bt-result-val">' + esc(row.pk_direction) + (row.pk_hit ? ' ✓' : ' ✗') + '</span></div>';
    }
    if (row.gs_top_score) {
      cells += '<div class="bt-result-cell ' + (row.gs_hit ? 'bt-hit' : 'bt-miss') + '">' +
        '<span class="bt-result-label">GS</span>' +
        '<span class="bt-result-val">' + esc(row.gs_top_score) + (row.gs_hit ? ' ✓' : ' ✗') + '</span></div>';
    }

    html += '<div class="match-card backtest-row">' +
      '<div class="match-header"><div class="match-header-left">' +
      '<span class="match-league">' + esc(row.leagueName || '') + '</span>' +
      '<span class="match-num">' + esc(row.matchNum || '') + '</span></div>' +
      '<div class="match-header-right">' + tags.join('') + '</div></div>' +
      '<div class="match-teams"><span class="team-name">' + esc(row.homeName || '') + '</span>' +
      '<span class="match-score" style="font-size:14px;">' + esc(row.actual_score || '-') + '</span>' +
      '<span class="team-name">' + esc(row.visitName || '') + '</span></div>' +
      '<div class="bt-result-grid">' + cells + '</div></div>';
  });
  el.innerHTML = html;
}

function renderPager(data) {
  var el = document.getElementById('btPager');
  if (!el) return;
  var totalPages = Math.ceil((data.total || 0) / (data.pageSize || 20));
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  var html = '<div style="display:flex;justify-content:center;gap:8px;padding:16px 0;">';
  for (var i = 1; i <= totalPages; i++) {
    html += '<button style="padding:4px 14px;border-radius:16px;border:1px solid rgba(255,255,255,0.1);' +
      (i === data.page ? 'background:var(--cyan);color:var(--bg);border-color:var(--cyan);' : 'background:transparent;color:var(--text2);') +
      'cursor:pointer;" onclick="btGoPage(' + i + ')">' + i + '</button>';
  }
  html += '</div>';
  el.innerHTML = html;
}

window.btGoPage = function(p) {
  _btPage = p;
  fetchData();
  document.getElementById('page-backtest').scrollIntoView({ behavior: 'smooth' });
};

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * preview/js/pages/backtest.js
 * 预测回测页面 — 筛选 + 统计 + 明细列表
 */
import { api } from '../api.js';

var state = {
  type: 'all', dateRange: 'all', league: 'all',
  direction: 'all', aiConf: 'all', pkConf: 'all', consensus: 'all',
  page: 1, pageSize: 20
};

export function loadBacktest() {
  var el = document.getElementById('page-backtest');
  if (!el) return;
  el.innerHTML = renderPage();
  // Inject dropdown styles (same as gongshoudao uses)
  injectStyles();
  document.addEventListener('click', handleDocClose);
  fetchData();
}

function injectStyles() {
  if (document.getElementById('bt-inline-css')) return;
  var s = document.createElement('style');
  s.id = 'bt-inline-css';
  s.textContent = [
    '.bt-dd-trigger { display:inline-flex;align-items:center;justify-content:center;gap:4px;',
    '  padding:3px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);',
    '  border-radius:999px;color:var(--text2);font-size:12px;cursor:pointer;position:relative;',
    '  white-space:nowrap;user-select:none; }',
    '.bt-dd-trigger:hover { border-color:var(--cyan);color:var(--cyan); }',
    '.bt-dd-menu { display:none;position:absolute;top:calc(100% + 4px);left:0;min-width:100%;',
    '  background:var(--card-bg);border:1px solid rgba(255,255,255,0.1);border-radius:10px;',
    '  box-shadow:0 8px 24px rgba(0,0,0,0.4);z-index:1000;overflow:hidden; }',
    '.bt-dd-menu.open { display:block; }',
    '.bt-dd-item { padding:7px 16px;font-size:12px;color:var(--text2);cursor:pointer;white-space:nowrap; }',
    '.bt-dd-item:hover { background:rgba(24,224,224,0.08);color:var(--cyan); }',
    '.bt-dd-item.active { background:rgba(24,224,224,0.12);color:var(--cyan);font-weight:600; }',
    '.backtest-page { padding:12px 0; }',
    '.bt-filter-card { margin-bottom:12px; }',
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
    '.backtest-stats { grid-template-columns:repeat(4,1fr)!important;margin:10px 0; }',
    '.backtest-pager { margin-top:12px; }',
    '.backtest-row { margin-bottom:8px; }',
    '.bt-dd-wrap { position:relative;display:inline-block; }',
  ].join('\n');
  document.head.appendChild(s);
}

function renderPage() {
  return '<div class="backtest-page">' +
    renderFilterCard() +
    '<div class="stats-grid backtest-stats" id="btStats"></div>' +
    '<div class="backtest-list" id="btList"></div>' +
    '<div class="backtest-pager" id="btPager"></div>' +
    '</div>';
}

function renderFilterCard() {
  var typeOpts = [{v:'all',l:'全部'},{v:'ai',l:'AI'},{v:'pk',l:'PK'},{v:'gs',l:'GS'}];
  var rangeOpts = [{v:'all',l:'全部'},{v:'7d',l:'7天'},{v:'30d',l:'30天'},{v:'60d',l:'60d'},{v:'90d',l:'90d'}];
  var dOpts = [{v:'all',l:'全部'},{v:'home',l:'主胜'},{v:'away',l:'客胜'},{v:'draw',l:'平'}];
  var confOpts = [{v:'all',l:'全部'},{v:'high',l:'高'},{v:'mid',l:'中'},{v:'low',l:'低'}];

  return '<div class="menu-item bt-filter-card" style="flex-direction:column;gap:6px;padding:14px 16px;">' +
    filterRow('类型', 'bt-type', typeOpts, state.type) +
    filterRow('时间', 'bt-range', rangeOpts, state.dateRange) +
    filterRow('方向', 'bt-dir', dOpts, state.direction) +
    filterRow('AI信心', 'bt-aiconf', confOpts, state.aiConf) +
    filterRow('PK信心', 'bt-pkconf', confOpts, state.pkConf) +
    '<div style="text-align:right;margin-top:6px"><button onclick="doBTQuery()" style="padding:6px 20px;border:none;border-radius:20px;background:var(--cyan);color:var(--bg);cursor:pointer;">查询</button></div>' +
    '</div>';
}

function filterRow(label, id, opts, curVal) {
  var h = '<div style="display:flex;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.025);">' +
    '<span style="width:56px;flex-shrink:0;font-size:12px;color:var(--text2);">' + label + '</span>' +
    '<div style="flex:1;display:flex;justify-content:flex-end;">' +
    '<div class="bt-dd-wrap">';
  var selLabel = curVal;
  opts.forEach(function(o) { if (o.v === curVal) selLabel = o.l; });
  h += '<span class="bt-dd-trigger" onclick="event.stopPropagation();toggleBTDD(event,\'' + id + '\')" id="' + id + '-label">' + selLabel + ' <svg viewBox="0 0 24 24" width="12" height="12"><polyline points="6 10 12 16 18 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>';
  h += '<div class="bt-dd-menu" id="' + id + '-dd">';
  opts.forEach(function(o) {
    h += '<div class="bt-dd-item' + (o.v === curVal ? ' active' : '') + '" data-val="' + o.v + '" onclick="selectBT(event,\'' + id + '\',this)">' + o.l + '</div>';
  });
  h += '</div></div></div></div>';
  return h;
}

window.toggleBTDD = function(e, id) {
  var dd = document.getElementById(id + '-dd');
  if (!dd) return;
  var isOpen = dd.classList.contains('open');
  document.querySelectorAll('.bt-dd-menu').forEach(function(m) { m.classList.remove('open'); });
  if (!isOpen) dd.classList.add('open');
};

window.selectBT = function(e, id, el) {
  e.stopPropagation();
  var val = el.getAttribute('data-val');
  var map = {
    'bt-type': 'type', 'bt-range': 'dateRange', 'bt-dir': 'direction',
    'bt-aiconf': 'aiConf', 'bt-pkconf': 'pkConf', 'bt-cons': 'consensus'
  };
  var key = map[id];
  if (key) state[key] = val;

  // Update this dropdown only
  var dd = document.getElementById(id + '-dd');
  if (dd) {
    dd.querySelectorAll('.bt-dd-item').forEach(function(item) {
      item.classList.remove('active');
      if (item.getAttribute('data-val') === val) item.classList.add('active');
    });
  }
  var label = document.getElementById(id + '-label');
  if (label) label.childNodes[0].textContent = el.textContent;
  dd.classList.remove('open');
};

window.doBTQuery = function() {
  state.page = 1;
  fetchData();
};

function handleDocClose(e) {
  if (!e.target.closest('.bt-dd-trigger') && !e.target.closest('.bt-dd-item')) {
    document.querySelectorAll('.bt-dd-menu').forEach(function(m) { m.classList.remove('open'); });
  }
}

function fetchData() {
  api('prediction-backtest', {
    type: state.type, dateRange: state.dateRange,
    league: state.league, direction: state.direction,
    aiConf: state.aiConf, pkConf: state.pkConf,
    consensus: state.consensus, page: state.page, pageSize: state.pageSize
  }).then(function(res) {
    renderStats(res.stats);
    renderList(res.items);
    renderPager(res);
  }).catch(function(e) {
    console.error('backtest fetch error:', e);
  });
}

function renderStats(stats) {
  var el = document.getElementById('btStats');
  if (!el || !stats) return;
  el.innerHTML =
    '<div class="stat-box"><div class="stat-value">' + (stats.total || 0).toLocaleString() + '</div><div class="stat-label">总预测</div></div>' +
    '<div class="stat-box"><div class="stat-value" style="color:var(--green)">' + Math.round((stats.ai_accuracy || 0) * 100) + '%</div><div class="stat-label">AI准确率</div></div>' +
    '<div class="stat-box"><div class="stat-value" style="color:var(--cyan)">' + Math.round((stats.pk_accuracy || 0) * 100) + '%</div><div class="stat-label">PK准确率</div></div>' +
    '<div class="stat-box"><div class="stat-value" style="color:var(--amber)">' + Math.round((stats.gs_score_hit_rate || 0) * 100) + '%</div><div class="stat-label">GS比中</div></div>';
}

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
  state.page = p;
  fetchData();
  document.getElementById('page-backtest').scrollIntoView({ behavior: 'smooth' });
};

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

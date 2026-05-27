import { api } from '../api.js';

var quantDate = '';
var quantDateOffset = 0;
var currentTab = 'power';
var allData = [];         // 原始比赛+GS合并数据
var pickedIds = {};       // { matchId: true }
var sortKey = 'rank';     // 当前排序字段
var sortAsc = true;       // true=升序

export function updateQuantDateBar() {
  var d = new Date();
  d.setDate(d.getDate() + quantDateOffset);
  quantDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  var el = document.getElementById('quantDateCurrent');
  if (!el) return;
  var weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var mmdd = String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
  var today = new Date().toDateString() === d.toDateString();
  el.textContent = (today ? '今天 ' : '') + mmdd + ' ' + weekNames[d.getDay()];
}

export function shiftQuantDate(delta) {
  quantDateOffset += delta;
  updateQuantDateBar();
  loadQuantRank();
}

export function goQuantToday() {
  quantDateOffset = 0;
  updateQuantDateBar();
  loadQuantRank();
}

export function toggleQuantDatePicker() {
  var el = document.getElementById('quantDatePicker');
  if (!el) return;
  el.style.display = el.style.display !== 'none' ? 'none' : 'block';
}

export function switchQuantTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.quant-tab').forEach(function (t) { t.classList.remove('active'); });
  var activeTab = document.querySelector('.quant-tab[data-tab="' + tab + '"]');
  if (activeTab) activeTab.classList.add('active');
  renderTable();
}

// ═══ 多选管理 ═══
export function togglePick(ev, matchId) {
  ev.stopPropagation();
  if (pickedIds[matchId]) delete pickedIds[matchId];
  else pickedIds[matchId] = true;
  updatePkBar();
  // 更新行样式
  var row = document.getElementById('qr-' + matchId);
  if (row) {
    if (pickedIds[matchId]) row.classList.add('picked');
    else row.classList.remove('picked');
  }
}

function clearPicks() {
  pickedIds = {};
  updatePkBar();
  document.querySelectorAll('.quant-table tbody tr').forEach(function (r) { r.classList.remove('picked'); });
}

export function startPK() {
  var ids = Object.keys(pickedIds);
  if (ids.length < 2) return;
  // 收集选中比赛信息
  var picked = allData.filter(function (item) { return pickedIds[item.matchId]; });
  if (picked.length < 2) return;
  // 调用 openPKMulti
  if (window.openPKMulti) {
    window.openPKMulti(picked);
    clearPicks();
  }
}

function updatePkBar() {
  var bar = document.getElementById('quantPkBar');
  var count = Object.keys(pickedIds).length;
  var cntEl = document.getElementById('pkSelectCount');
  var btn = document.getElementById('pkBarBtn');
  if (bar) bar.style.display = count > 0 ? 'flex' : 'none';
  if (cntEl) cntEl.textContent = count;
  if (btn) btn.disabled = count < 2;
}

// ═══ 排序 ═══
export function sortBy(key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else { sortKey = key; sortAsc = true; }
  renderTable();
}

// ═══ 数据加载 ═══
export function loadQuantRank() {
  var wrap = document.getElementById('quantTableWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载数据中...</div>';

  var params = {};
  if (quantDate) params.date = quantDate;

  api('ranking-list', params).then(function (rankData) {
    var ranking = rankData.ranking || [];
    if (ranking.length === 0) {
      wrap.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text3)">暂无比赛数据</div>';
      return;
    }

    var gsPromises = ranking.map(function (item) {
      return api('gongshoudao', { matchId: item.matchId }).catch(function () { return null; });
    });

    Promise.all(gsPromises).then(function (gsResults) {
      allData = ranking.map(function (item, i) {
        var gs = gsResults[i] || {};
        return mergeItem(item, gs);
      });
      sortKey = 'rank';
      sortAsc = true;
      renderTable();
    });
  }).catch(function () {
    wrap.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text3)">加载失败</div>';
  });
}

function mergeItem(item, gs) {
  var advVal = gs.totalAdvantageValue || 50;
  return {
    matchId: item.matchId,
    num: item.num || '',
    homeName: item.homeName || '',
    visitName: item.visitName || '',
    leagueName: item.leagueName || '',
    date: item.date || '',
    matchStatus: item.matchStatus || 0,
    // 量化字段
    rank: item.rank || 99,
    totalAdvantage: gs.totalAdvantage || '-',
    totalAdvantageValue: advVal,
    goalDiff: gs.goalDiffHome || '-',
    crossWin: gs.crossWin || '-',
    crossDraw: gs.crossDraw || '-',
    crossLose: gs.crossLose || '-',
    crossRq: gs.crossRq,
    attackPattern: gs.attackPattern || '',
    attackAdvantageValue: gs.attackAdvantageValue || 50,
    defenseAdvantageValue: gs.defenseAdvantageValue || 50,
    hasGS: !!(gs.attackPattern)
  };
}

// ═══ 渲染表格 ═══
function renderTable() {
  var wrap = document.getElementById('quantTableWrap');
  if (!wrap) return;

  // 排序
  var sorted = allData.slice().sort(function (a, b) {
    var va = getSortVal(a, sortKey);
    var vb = getSortVal(b, sortKey);
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });

  var cols = [
    { key: 'match', label: '对阵', sortable: false, cls: 'th-match' },
    { key: 'rank', label: '总排序', sortable: true, cls: 'th-rank' },
    { key: 'goalDiff', label: '净胜球', sortable: true, cls: 'th-gd' },
    { key: 'cross', label: '胜平负交叉', sortable: false, cls: 'th-cross' },
    { key: 'power', label: '综合实力', sortable: true, cls: 'th-power' },
    { key: 'attackDefense', label: '攻守实力', sortable: false, cls: 'th-ad' }
  ];

  var html = '<table class="quant-table"><thead><tr><th class="th-chk"></th>';
  cols.forEach(function (col) {
    var ascDesc = '';
    if (sortKey === col.key) ascDesc = sortAsc ? ' sort-asc' : ' sort-desc';
    if (col.sortable) {
      html += '<th class="sortable ' + col.cls + ascDesc + '" onclick="sortBy(\'' + col.key + '\')">' + col.label + '</th>';
    } else {
      html += '<th class="' + col.cls + '">' + col.label + '</th>';
    }
  });
  html += '</tr></thead><tbody>';

  sorted.forEach(function (item, idx) {
    var picked = !!pickedIds[item.matchId];
    var rowCls = picked ? ' picked' : '';
    html += '<tr id="qr-' + item.matchId + '" class="' + rowCls + '">';

    // 复选框
    html += '<td><input type="checkbox" class="q-chk" ' + (picked ? 'checked' : '') + ' onclick="togglePick(event,\'' + item.matchId + '\')" /></td>';

    // 对阵
    html += '<td class="q-match-cell">' +
      '<div class="q-match-num">' + esc(item.num) + '</div>' +
      '<div class="q-match-teams">' + esc(item.homeName) + ' vs ' + esc(item.visitName) + '</div>' +
      '<div class="q-match-league">' + esc(item.leagueName) + '</div>' +
      '</td>';

    // 总排序
    var r = item.rank;
    var rCls = r === 1 ? 'r1' : r === 2 ? 'r2' : r === 3 ? 'r3' : '';
    html += '<td><span class="q-cell-rank ' + rCls + '">' + r + '</span></td>';

    // 净胜球
    var gd = item.goalDiff;
    var gdCls = 'zero';
    if (gd !== '-' && gd !== '?') {
      var gdNum = parseFloat(String(gd).split('/')[0]);
      gdCls = isNaN(gdNum) ? 'zero' : gdNum > 0 ? 'pos' : gdNum < 0 ? 'neg' : 'zero';
    }
    html += '<td><span class="q-cell-num ' + gdCls + '">' + gd + '</span></td>';

    // 胜平负交叉
    html += '<td><span class="q-cell-num" style="font-size:11px">胜' + item.crossWin + ' 平' + item.crossDraw + ' 负' + item.crossLose + '</span></td>';

    // 综合实力
    var powerCls = item.totalAdvantageValue >= 60 ? 'pos' : item.totalAdvantageValue >= 45 ? 'zero' : 'neg';
    html += '<td><span class="q-cell-num ' + powerCls + '">' + item.totalAdvantage + '</span></td>';

    // 攻守实力
    html += '<td><span class="q-cell-num" style="font-size:11px">攻' + item.attackAdvantageValue + '守' + item.defenseAdvantageValue + '</span></td>';

    html += '</tr>';
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
  updatePkBar();
}

function getSortVal(item, key) {
  switch (key) {
    case 'rank': return item.rank || 99;
    case 'goalDiff': {
      var parts = String(item.goalDiff).split('/');
      var num = parseFloat(parts[0]);
      return isNaN(num) ? 0 : num;
    }
    case 'power': return item.totalAdvantageValue || 0;
    case 'attackDefense': return (item.attackAdvantageValue || 0) + (item.defenseAdvantageValue || 0);
    default: return 0;
  }
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

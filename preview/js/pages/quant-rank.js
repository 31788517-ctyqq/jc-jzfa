import { api } from '../api.js';

var quantDate = '';
var quantDateOffset = 0;
var currentTab = 'power';
var allData = [];
var pickedIds = {};
var sortKey = 'rank';
var sortAsc = true;

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

export function shiftQuantDate(delta) { quantDateOffset += delta; updateQuantDateBar(); loadQuantRank(); }
export function goQuantToday() { quantDateOffset = 0; updateQuantDateBar(); loadQuantRank(); }

export function toggleQuantDatePicker() {
  var el = document.getElementById('quantDatePicker');
  if (!el) return;
  el.style.display = el.style.display !== 'none' ? 'none' : 'block';
}

export function switchQuantTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.quant-tab').forEach(function (t) { t.classList.remove('active'); });
  var t = document.querySelector('.quant-tab[data-tab="' + tab + '"]');
  if (t) t.classList.add('active');
  renderTable();
}

export function togglePick(ev, matchId) {
  ev.stopPropagation();
  if (pickedIds[matchId]) delete pickedIds[matchId];
  else pickedIds[matchId] = true;
  updatePkBar();
  var row = document.getElementById('qr-' + matchId);
  if (row) { if (pickedIds[matchId]) row.classList.add('picked'); else row.classList.remove('picked'); }
}

function clearPicks() {
  pickedIds = {};
  updatePkBar();
  document.querySelectorAll('.quant-table tbody tr').forEach(function (r) { r.classList.remove('picked'); });
}

export function startPK() {
  var picked = allData.filter(function (item) { return pickedIds[item.matchId]; });
  if (picked.length < 2) return;
  if (window.openPKMulti) { window.openPKMulti(picked); clearPicks(); }
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
        return mergeItem(item, gsResults[i] || {});
      });
      sortKey = 'rank'; sortAsc = true;
      renderTable();
    });
  }).catch(function () {
    wrap.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text3)">加载失败</div>';
  });
}

function mergeItem(item, gs) {
  return {
    matchId: item.matchId,
    num: item.num || '',
    homeName: item.homeName || '',
    visitName: item.visitName || '',
    leagueName: item.leagueName || '',
    date: item.date || '',
    matchStatus: item.matchStatus || 0,
    rank: item.rank || 99,
    totalAdvantage: gs.totalAdvantage || '-',
    totalAdvantageValue: gs.totalAdvantageValue || 0,
    goalDiff: gs.goalDiffHome || '-',
    crossWin: gs.crossWin !== undefined ? gs.crossWin : '-',
    crossDraw: gs.crossDraw !== undefined ? gs.crossDraw : '-',
    crossLose: gs.crossLose !== undefined ? gs.crossLose : '-',
    crossRq: gs.crossRq,
    attackAdvantageValue: gs.attackAdvantageValue || 0,
    defenseAdvantageValue: gs.defenseAdvantageValue || 0,
    hasGS: !!(gs.attackPattern)
  };
}

// ═══ 渲染纯表格 ═══
function renderTable() {
  var wrap = document.getElementById('quantTableWrap');
  if (!wrap) return;

  var sorted = allData.slice().sort(function (a, b) {
    var va = getSortVal(a, sortKey), vb = getSortVal(b, sortKey);
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
    { key: 'ad', label: '攻守实力', sortable: false, cls: 'th-ad' }
  ];

  var h = '<table class="quant-table"><thead><tr><th class="th-chk"></th>';
  cols.forEach(function (c) {
    var ad = sortKey === c.key ? (sortAsc ? ' sort-asc' : ' sort-desc') : '';
    h += '<th class="' + c.cls + (c.sortable ? ' sortable' + ad : '') + '" onclick="' + (c.sortable ? 'sortBy(\'' + c.key + '\')' : '') + '">' + c.label + '</th>';
  });
  h += '</tr></thead><tbody>';

  sorted.forEach(function (item) {
    var p = !!pickedIds[item.matchId];
    h += '<tr id="qr-' + item.matchId + '" class="' + (p ? 'picked' : '') + '">' +
      '<td><input type="checkbox" class="q-chk" ' + (p ? 'checked' : '') + ' onclick="togglePick(event,\'' + item.matchId + '\')"/></td>' +
      tdMatch(item) +
      tdRank(item.rank) +
      tdNum(item, 'goalDiff') +
      tdCross(item) +
      tdNum(item, 'power') +
      tdAd(item) +
      '</tr>';
  });

  h += '</tbody></table>';
  wrap.innerHTML = h;
  updatePkBar();
}

function tdMatch(item) {
  return '<td class="q-match-cell">' +
    '<div class="q-match-num">' + esc(item.num) + '</div>' +
    '<div class="q-match-teams">' + esc(item.homeName) + ' vs ' + esc(item.visitName) + '</div>' +
    '</td>';
}

function tdRank(r) {
  var cls = r === 1 ? 'r1' : r === 2 ? 'r2' : r === 3 ? 'r3' : '';
  return '<td><span class="q-cell-rank ' + cls + '">' + r + '</span></td>';
}

function tdNum(item, k) {
  var v;
  if (k === 'goalDiff') {
    v = item.goalDiff;
    if (v !== '-') { var n = parseFloat(String(v).split('/')[0]); if (!isNaN(n)) v = (n >= 0 ? '+' : '') + n.toFixed(4); }
  } else { // power
    v = item.totalAdvantage || '-';
  }
  var cls = getNumClass(item, k);
  return '<td><span class="q-cell-num ' + cls + '">' + v + '</span></td>';
}

function getNumClass(item, k) {
  if (k === 'goalDiff') {
    var v = item.goalDiff;
    if (v === '-' || v === '?') return '';
    var n = parseFloat(String(v).split('/')[0]); if (isNaN(n)) return '';
    return n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  }
  // power
  var p = item.totalAdvantageValue;
  if (p >= 60) return 'pos';
  if (p < 45) return 'neg';
  return '';
}

function tdCross(item) {
  if (item.crossWin === '-' && item.crossDraw === '-' && item.crossLose === '-') {
    return '<td><span class="q-cell-num" style="color:var(--text4)">-</span></td>';
  }
  var w = item.crossWin, d = item.crossDraw, l = item.crossLose;
  return '<td><span class="q-cell-num" style="font-size:11px">胜' + w + ' 平' + d + ' 负' + l + '</span></td>';
}

function tdAd(item) {
  var a = item.attackAdvantageValue, d = item.defenseAdvantageValue;
  if (a === 0 && d === 0) return '<td><span class="q-cell-num" style="color:var(--text4)">-</span></td>';
  return '<td><span class="q-cell-num" style="font-size:11px;white-space:nowrap;">+攻' + a + '守' + d + '</span></td>';
}

function getSortVal(item, key) {
  switch (key) {
    case 'rank': return item.rank || 99;
    case 'goalDiff': var p = String(item.goalDiff).split('/'); var n = parseFloat(p[0]); return isNaN(n) ? 0 : n;
    case 'power': return item.totalAdvantageValue || 0;
    case 'ad': return (item.attackAdvantageValue || 0) + (item.defenseAdvantageValue || 0);
    default: return 0;
  }
}

function esc(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

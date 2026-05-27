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
  // 切换 tab 时重置排序键为默认
  if (tab === 'power') { sortKey = 'rank'; sortAsc = true; }
  else if (tab === 'goal') { sortKey = 'totalSum'; sortAsc = true; }
  else { sortKey = 'hotFocusNum'; sortAsc = true; }
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
  if (window.openPKMulti) { window.openPKMulti(picked, currentTab); clearPicks(); }
}

function updatePkBar() {
  var bar = document.getElementById('quantPkBar');
  var count = Object.keys(pickedIds).length;
  var cntEl = document.getElementById('pkBarCount');
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
    // ⭐ 并行请求热度数据
    var hotPromise = api('quant-hot', params).catch(function () { return null; });
    Promise.all(gsPromises.concat([hotPromise])).then(function (results) {
      var hotData = results[results.length - 1] || {};
      var hotMap = (hotData && hotData.hotData) ? hotData.hotData : {};
      var gsResults = results.slice(0, -1);
      allData = ranking.map(function (item, i) {
        var merged = mergeItem(item, gsResults[i] || {});
        // ⭐ 注入热度数据
        var hd = hotMap[item.matchId] || {};
        if (hd.staticDiff !== undefined && hd.staticDiff !== null) merged.staticDiff = hd.staticDiff;
        if (hd.heatIndex !== null && hd.heatIndex !== undefined) merged.heatIndex = hd.heatLabel || hd.heatIndex;
        if (hd.homeFeature) merged.homeFeature = hd.homeFeature;
        if (hd.guestFeature) merged.guestFeature = hd.guestFeature;
        if (hd.oddsLive !== null && hd.oddsLive !== undefined) merged.oddsLive = hd.oddsLive;
        if (hd.hotFocusNum !== null && hd.hotFocusNum !== undefined) merged.hotFocusNum = hd.hotFocusNum;
        if (hd.rq !== undefined && hd.rq !== null) merged.rq = hd.rq;
        return merged;
      });
      sortKey = 'rank'; sortAsc = true;
      renderTable();
    });
  }).catch(function () {
    wrap.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text3)">加载失败</div>';
  });
}

function mergeItem(item, gs) {
  var cw = gs.crossWin !== undefined ? gs.crossWin : '-';
  var cd = gs.crossDraw !== undefined ? gs.crossDraw : '-';
  var cl = gs.crossLose !== undefined ? gs.crossLose : '-';
  var aav = gs.attackAdvantageValue || 0;
  var dav = gs.defenseAdvantageValue || 0;
  var gdh = parseFloat(gs.goalDiffHome) || 0;
  var gda = parseFloat(gs.goalDiffAway) || 0;
  var tge = parseFloat(gs.totalGoalsExpect) || 0;
  var tgv = parseFloat(gs.totalGoalsValue) || 0;
  // 交锋进球：简化的对冲进球预期
  var hhg = (cw !== '-' && cl !== '-') ? (((cw || 0) - (cl || 0)) / 10 + 2.5) : 2.5;

  function goalTotalSum() {
    var b = Math.abs(tge);
    var a = Math.abs(gdh + gda);
    var s = Math.abs(tgv);
    var h = Math.abs(hhg);
    var r = Math.abs((aav + dav) / 100);
    return parseFloat((b + a + s + h + r).toFixed(4));
  }

  return {
    matchId: item.matchId,
    num: item.num || '',
    homeName: item.homeName || '',
    visitName: item.visitName || '',
    leagueName: item.leagueName || '',
    date: item.date || '',
    matchStatus: item.matchStatus || 0,
    rank: item.rank || 99,
    // 实力维度
    totalAdvantage: gs.totalAdvantage || '-',
    totalAdvantageValue: gs.totalAdvantageValue || 0,
    goalDiff: gs.goalDiffHome || '-',
    crossWin: cw,
    crossDraw: cd,
    crossLose: cl,
    crossRq: gs.crossRq,
    attackAdvantageValue: aav,
    defenseAdvantageValue: dav,
    hasGS: !!(gs.attackPattern),
    // 进球维度
    bigBallRatio: tge,
    attDefGoal: gdh + gda,
    strengthGoal: tgv,
    headToHeadGoal: hhg,
    breakArmor: (aav + dav) / 100,
    totalSum: goalTotalSum(),
    // 热点维度（占位）
    rq: gs.crossRq !== undefined ? gs.crossRq : '-',
    hotFocusNum: '-',
    heatIndex: '-',
    homeFeature: '-',
    guestFeature: '-',
    staticDiff: gs.totalAdvantageValue || 0,
    oddsLive: '-'
  };
}

// ═══ 渲染纯表格 ═══
function renderTable() {
  var wrap = document.getElementById('quantTableWrap');
  if (!wrap) return;

  var sorted;
  if (currentTab === 'power') {
    // 实力tab保持API原始顺序，不排序
    sorted = allData.slice();
  } else {
    sorted = allData.slice().sort(function (a, b) {
      var va = getSortVal(a, sortKey), vb = getSortVal(b, sortKey);
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  // 按 currentTab 确定列定义（实力tab全部不可排序）
  var cols;
  if (currentTab === 'power') {
    cols = [
      { key: 'match', label: '对阵', sortable: false, cls: 'th-match' },
      { key: 'goalDiff', label: '净胜球', sortable: false, cls: 'th-gd' },
      { key: 'cross', label: '胜平负交叉', sortable: false, cls: 'th-cross' },
      { key: 'power', label: '综合实力', sortable: false, cls: 'th-power' },
      { key: 'ad', label: '攻守实力', sortable: false, cls: 'th-ad' }
    ];
  } else if (currentTab === 'goal') {
    cols = [
      { key: 'match', label: '对阵', sortable: false, cls: 'th-match' },
      { key: 'totalSum', label: '合计', sortable: true, cls: 'th-sum' },
      { key: 'bigBallRatio', label: '大球比例', sortable: true, cls: 'th-big' },
      { key: 'attDefGoal', label: '攻防进球', sortable: true, cls: 'th-ag' },
      { key: 'strengthGoal', label: '实力进球', sortable: true, cls: 'th-sg' },
      { key: 'headToHeadGoal', label: '交锋进球', sortable: true, cls: 'th-hg' },
      { key: 'breakArmor', label: '破甲和', sortable: true, cls: 'th-ba' }
    ];
  } else {
    cols = [
      { key: 'match', label: '对阵', sortable: false, cls: 'th-match' },
      { key: 'rq', label: '让球数', sortable: false, cls: 'th-rq' },
      { key: 'hotFocusNum', label: '关注热度', sortable: true, cls: 'th-hot' },
      { key: 'heatIndex', label: '冷热指数', sortable: true, cls: 'th-heat' },
      { key: 'homeFeature', label: '主队特征', sortable: false, cls: 'th-hf' },
      { key: 'guestFeature', label: '客队特征', sortable: false, cls: 'th-gf' },
      { key: 'staticDiff', label: '静态实力差', sortable: true, cls: 'th-sd' },
      { key: 'oddsLive', label: '亚指临盘', sortable: false, cls: 'th-ol' }
    ];
  }

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
      tdMatch(item);

    if (currentTab === 'power') {
      h += tdNum(item, 'goalDiff') +
        tdCross(item) +
        tdNum(item, 'power') +
        tdAd(item);
    } else if (currentTab === 'goal') {
      h += tdGoalCell(item, 'totalSum', 2) +
        tdGoalCell(item, 'bigBallRatio', 1) +
        tdGoalCell(item, 'attDefGoal', 2) +
        tdGoalCell(item, 'strengthGoal', 2) +
        tdGoalCell(item, 'headToHeadGoal', 2) +
        tdGoalCell(item, 'breakArmor', 2);
    } else {
      h += tdHotCell(item, 'rq') +
        tdHotCell(item, 'hotFocusNum') +
        tdHotCell(item, 'heatIndex') +
        tdHotCell(item, 'homeFeature') +
        tdHotCell(item, 'guestFeature') +
        tdHotCell(item, 'staticDiff') +
        tdHotCell(item, 'oddsLive');
    }

    h += '</tr>';
  });

  h += '</tbody></table>';
  wrap.innerHTML = h;
  updatePkBar();
}

function tdMatch(item) {
  return '<td class="q-match-cell">' +
    '<div class="q-match-teams">' + esc(item.homeName) + '</div>' +
    '<div class="q-match-vs">vs</div>' +
    '<div class="q-match-teams">' + esc(item.visitName) + '</div>' +
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
  } else { // power — 综合实力偏移百分比
    var pv = item.totalAdvantageValue - 50;
    v = (pv >= 0 ? '+' : '') + pv.toFixed(1) + '%';
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
  // power — 综合实力偏移
  var p = item.totalAdvantageValue - 50;
  if (p > 0) return 'pos';
  if (p < 0) return 'neg';
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

// 进球 tab 单元格
function tdGoalCell(item, key, digits) {
  var v = item[key];
  if (v === '-' || v === undefined || v === null) {
    return '<td><span class="q-cell-num" style="color:var(--text4)">-</span></td>';
  }
  var n = parseFloat(v);
  if (isNaN(n)) return '<td><span class="q-cell-num">' + v + '</span></td>';
  var formatted;
  if (key === 'bigBallRatio') {
    formatted = n.toFixed(digits) + '%';
  } else {
    formatted = (n >= 0 ? '+' : '') + n.toFixed(digits);
  }
  var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return '<td><span class="q-cell-num ' + cls + '">' + formatted + '</span></td>';
}

// 热点 tab 单元格
function tdHotCell(item, key) {
  var v = item[key];
  if (v === '-' || v === undefined || v === null) {
    return '<td><span class="q-cell-num" style="color:var(--text4);font-size:10px">数据接入中</span></td>';
  }
  if (key === 'heatIndex') {
    // 后端可能返回格式化字符串 "1.35 🔥" 或纯数字
    if (typeof v === 'string' && v.indexOf('🔥') !== -1) {
      return '<td><span class="q-cell-num neg">' + v + '</span></td>';
    }
    if (typeof v === 'string' && v.indexOf('🧊') !== -1) {
      return '<td><span class="q-cell-num cool">' + v + '</span></td>';
    }
    var n = parseFloat(v);
    if (isNaN(n)) return '<td><span class="q-cell-num">' + v + '</span></td>';
    var icon = n > 1.2 ? ' 🔥' : n < 0.8 ? ' 🧊' : ' 🎯';
    var cls = n > 1.2 ? 'neg' : n < 0.8 ? 'cool' : 'pos';
    return '<td><span class="q-cell-num ' + cls + '">' + n.toFixed(2) + icon + '</span></td>';
  }
  var n = parseFloat(v);
  if (isNaN(n)) return '<td><span class="q-cell-num">' + v + '</span></td>';
  if (key === 'hotFocusNum' && n > 1000) v = (n / 10000).toFixed(1) + '万';
  if (key === 'staticDiff') { var clsSD = n > 0 ? 'pos' : n < 0 ? 'neg' : ''; return '<td><span class="q-cell-num ' + clsSD + '">' + (n >= 0 ? '+' : '') + n.toFixed(2) + '</span></td>'; }
  return '<td><span class="q-cell-num">' + v + '</span></td>';
}

function getSortVal(item, key) {
  switch (key) {
    // 实力
    case 'rank':       return item.rank || 99;
    case 'goalDiff':   var p = String(item.goalDiff).split('/'); var n = parseFloat(p[0]); return isNaN(n) ? 0 : n;
    case 'power':      return item.totalAdvantageValue || 0;
    case 'ad':         return (item.attackAdvantageValue || 0) + (item.defenseAdvantageValue || 0);
    // 进球
    case 'totalSum':       return parseFloat(item.totalSum) || 0;
    case 'bigBallRatio':   return parseFloat(item.bigBallRatio) || 0;
    case 'attDefGoal':     return parseFloat(item.attDefGoal) || 0;
    case 'strengthGoal':   return parseFloat(item.strengthGoal) || 0;
    case 'headToHeadGoal': return parseFloat(item.headToHeadGoal) || 0;
    case 'breakArmor':     return parseFloat(item.breakArmor) || 0;
    // 热点
    case 'hotFocusNum': return parseFloat(item.hotFocusNum) || 0;
    case 'heatIndex':
      // 后端可能返回 "1.35 🔥" 格式，提取数值
      var hv = String(item.heatIndex).replace(/[^\d.]/g, '');
      return parseFloat(hv) || 0;
    case 'staticDiff':  return parseFloat(item.staticDiff) || 0;
    default: return 0;
  }
}

function esc(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

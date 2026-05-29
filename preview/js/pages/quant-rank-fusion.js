import { api } from '../api.js';
import { loadECharts, echartsReady } from '../charts.js';

console.log('[V5.0-FUSION] quant-rank-fusion.js loaded — cross-tab selection enabled');

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
  // ★ V5.0: 不再清空 pickedIds，支持跨标签选择
  updatePkBar();
  // 切换 tab 时重置回表格视图
  if (currentView === 'chart') switchQuantView('table');
  // 切换 tab 时重置排序键为默认
  if (tab === 'power') { sortKey = 'rank'; sortAsc = true; }
  else if (tab === 'goal') { sortKey = 'totalSum'; sortAsc = true; }
  else { sortKey = 'hotFocusNum'; sortAsc = true; }
  document.querySelectorAll('#quantFilterBar .filter-tag').forEach(function (t) { t.classList.remove('active'); });
  var t = document.querySelector('#quantFilterBar .filter-tag[data-tab="' + tab + '"]');
  if (t) t.classList.add('active');
  renderTable();
}

export function togglePick(ev, matchId) {
  ev.stopPropagation();
  // 利用浏览器原生 checkbox 切换，JS 只管理 pickedIds 和行样式
  if (pickedIds[matchId]) delete pickedIds[matchId];
  else pickedIds[matchId] = true;
  updatePkBar();
  var row = document.getElementById('qr-' + matchId);
  if (row) { if (pickedIds[matchId]) row.classList.add('picked'); else row.classList.remove('picked'); }
}

export function startPK() {
  var picked = allData.filter(function (item) { return pickedIds[item.matchId]; });
  if (picked.length < 2) return;
  if (window.openPKMulti) { window.openPKMulti(picked); clearPicks(); }
}

function clearPicks() {
  pickedIds = {};
  updatePkBar();
  document.querySelectorAll('.quant-card-row.picked').forEach(function (r) { r.classList.remove('picked'); });
  document.querySelectorAll('.q-chk:checked').forEach(function (c) { c.checked = false; });
}

function updatePkBar() {
  var count = Object.keys(pickedIds).length;
  var bar = document.getElementById('quantPkBar');
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
  pickedIds = {};  // 切换日期时清空复选框状态
  updatePkBar();
  var wrap = document.getElementById('quantTableWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载数据中...</div>';
  var params = {};
  if (quantDate) params.date = quantDate;

  // ★ 三个 API 并行请求，消除串行等待
  Promise.all([
    api('ranking-list', params).catch(function () { return { ranking: [] }; }),
    api('gongshoudao-all', params).catch(function () { return {}; }),
    api('quant-hot', params).catch(function () { return {}; })
  ]).then(function (results) {
    var rankData = results[0] || {};
    var gsAllData = results[1] || {};
    var hotData = results[2] || {};
    var ranking = rankData.ranking || [];
    if (ranking.length === 0) {
      // 当天无数据 → 自动回退到前一天（和今日比赛页面规则一致）
      var now = new Date();
      var todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      if (quantDateOffset === 0 && (quantDate === '' || quantDate === todayStr)) {
        var prev = new Date();
        prev.setDate(prev.getDate() - 1);
        var prevStr = prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0') + '-' + String(prev.getDate()).padStart(2, '0');
        if (prevStr >= '2026-03-19') {
          quantDateOffset = -1;
          updateQuantDateBar();
          loadQuantRank();
          return;
        }
      }
      wrap.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text3)">暂无比赛数据</div>';
      return;
    }
    // ⭐ 并行结果已就绪，直接合并数据
    var gsAllMap = gsAllData.gsData || {};
    var hotMap = (hotData && hotData.hotData) ? hotData.hotData : {};
    var gsResults = ranking.map(function (item) { return gsAllMap[item.matchId] || {}; });
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
        // ★Phase2: 数据完整性标记
        merged.hasChange = (hd.heatIndex != null && hd.heatIndex !== undefined);
        merged.hasYz = (hd.hotFocusNum != null && hd.hotFocusNum !== undefined);
        // 计算整体完整度：0=全缺失，1=仅GS，2=GS+热度部分，3=全部就绪
        var score = 0;
        if (merged.hasGS) score += 1;
        if (merged.hasChange) score += 1;
        if (merged.hasYz) score += 1;
        merged.completenessScore = score;
        return merged;
      });
    sortKey = 'rank'; sortAsc = true;
    renderTable();
  }).catch(function () {
    wrap.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text3)">加载失败</div>';
  });
}

function mergeItem(item, gs) {
  var cw = gs.crossWin !== undefined ? gs.crossWin : '-';
  var cd = gs.crossDraw !== undefined ? gs.crossDraw : '-';
  var cl = gs.crossLose !== undefined ? gs.crossLose : '-';

  // ── 进球预测维度 ──

  // 综合大球比例 = (主队大球比例 + 客队大球比例 + 交锋大球比例) / 3 × 100
  var bigBall = gs.bigBallRatio != null ? gs.bigBallRatio : '-';

  // 攻防进球 = xgHome + xgAway（射门还原法 M3_A）
  var attDefGoal = gs.attDefGoal != null ? gs.attDefGoal : '-';

  // 实力进球 = 0.5 × (主队静态进球能力 + 客队静态进球能力) × (1 + 0.2 × Total_战)
  var strengthGoal = gs.strengthGoal != null ? gs.strengthGoal : '-';

  // 交锋进球 = H2H场均总进球（最近3-6次交锋）
  var headToHeadGoal = gs.h2hGoalAvg != null ? gs.h2hGoalAvg : '-';

  // 破甲和 = 主队进攻次数/(客队被射次数+0.5) + 客队进攻次数/(主队被射次数+0.5)
  var breakArmor = gs.breakArmorSum != null ? gs.breakArmorSum : '-';

  // ── 实力PK四维指标（PK.md 2.1-2.2） ──

  // ① 净胜球量化 = GD_q = ExpG_h - ExpG_a（后端按四维呼吸权重公式计算）
  var gdScore = (gs.gdQ != null) ? gs.gdQ : '-';
  var gdNum = gdScore === '-' ? 0 : gdScore;

  // ② 胜平负交叉 = (H_wins + A_losses) - (H_losses + A_wins)
  // 数据映射：hWins→主队胜场, aLosses→客队负场, hLosses→主队负场, aWins→客队胜场
  var crossValue;
  if (gs.hWins != null && gs.aLosses != null && gs.hLosses != null && gs.aWins != null) {
    crossValue = (gs.hWins + gs.aLosses) - (gs.hLosses + gs.aWins);
  } else {
    crossValue = '-';
  }
  var cvNum = crossValue === '-' ? 0 : crossValue;

  // ③ 综合实力 = Total_战 = 0.7×Static + 0.3×Dyn（V6.4 双轨实力量化）
  var pwScore = gs.totalStrength != null ? parseFloat(gs.totalStrength.toFixed(4)) : '-';
  var pwNum = pwScore === '-' ? 0 : pwScore;

  // ④ 攻守实力 = 进球分布计分法 V6.4（WinQiu_2×2 + WinQiu_1×1 + LoseQiu_0×2 + LoseQiu_1×1）
  var adCombined = gs.adWeightedComposite != null ? parseFloat(gs.adWeightedComposite.toFixed(4)) : '-';
  var adNum = adCombined === '-' ? 0 : adCombined;

  // 总排序 = 0.25 × 净胜球 + 0.25 × 胜平负交叉 + 0.25 × 综合实力 + 0.25 × 攻守实力
  var totalScore = parseFloat(((gdNum + cvNum + pwNum + adNum) / 4).toFixed(4));

  function goalTotalSum() {
    var b = bigBall === '-' ? 0 : Math.abs(bigBall);
    var a = attDefGoal === '-' ? 0 : Math.abs(attDefGoal);
    var s = strengthGoal === '-' ? 0 : Math.abs(strengthGoal);
    var h = headToHeadGoal === '-' ? 0 : Math.abs(headToHeadGoal);
    var r = breakArmor === '-' ? 0 : Math.abs(breakArmor);
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
    totalScore: totalScore,          // 总排序得分（四维等权合成）
    // 实力维度 — 四维指标原始值
    gdScore: gdScore,               // 净胜球量化 = xgHome - xgAway
    crossValue: crossValue,          // 胜平负交叉 = (H_win+G_loss-H_loss-G_win)/10
    pwScore: pwScore,               // 综合实力 = Total_战
    adCombined: adCombined,          // 攻守实力 = sigmoid加权合成
    // ★ P0-5: 胜平负交叉双组概率
    crossSpfWin: gs.crossSpfWin !== undefined ? gs.crossSpfWin : '-',
    crossSpfDraw: gs.crossSpfDraw !== undefined ? gs.crossSpfDraw : '-',
    crossSpfLose: gs.crossSpfLose !== undefined ? gs.crossSpfLose : '-',
    crossHcpWin: gs.crossHcpWin !== undefined ? gs.crossHcpWin : '-',
    crossHcpDraw: gs.crossHcpDraw !== undefined ? gs.crossHcpDraw : '-',
    crossHcpLose: gs.crossHcpLose !== undefined ? gs.crossHcpLose : '-',
    // ★ P1-1: M3.7 四重熔断
    fusionConsensus: gs.fusionConsensus || '',
    fusionFinalHome: gs.fusionFinalHome != null ? gs.fusionFinalHome : 0,
    fusionFinalAway: gs.fusionFinalAway != null ? gs.fusionFinalAway : 0,
    // ★ P1-2: 攻防格局
    attackPattern: gs.attackPattern || '',
    // 兼容旧字段
    totalAdvantage: gs.totalAdvantage || '-',
    totalAdvantageValue: Math.round(50 + pwScore * 100),  // Total_战 映射到进度条
    goalDiff: gdScore,               // 净胜球量化值
    crossWin: cw,
    crossDraw: cd,
    crossLose: cl,
    crossRq: gs.crossRq,
    attackAdvantageValue: gs.attackAdvantageValue || 0,
    defenseAdvantageValue: gs.defenseAdvantageValue || 0,
    hasGS: !!(gs.attackPattern),
    // 进球维度（后端按 PK.md 公式计算）
    bigBallRatio: bigBall,
    attDefGoal: attDefGoal,
    strengthGoal: strengthGoal,
    headToHeadGoal: headToHeadGoal,
    breakArmor: breakArmor,
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

// ═══ 渲染 — flex 卡片表格 ═══
function renderTable() {
  var wrap = document.getElementById('quantTableWrap');
  if (!wrap) return;

  // 排序
  var sorted;
  if (currentTab === 'power') {
    sorted = allData.slice();
  } else {
    sorted = allData.slice().sort(function (a, b) {
      var va = getSortVal(a, sortKey), vb = getSortVal(b, sortKey);
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  // 列定义 — key, label, sortable, colCls
  var cols, renderRow;
  if (currentTab === 'power') {
    cols = [
      { key: 'match', label: '对阵', sortable: false, colCls: 'q-col-match', hdCls: 'q-match-hd' },
      { key: 'goalDiff', label: '净胜球\n量化', sortable: false, colCls: 'q-col-gd' },
      { key: 'cross', label: '胜平负\n交叉', sortable: false, colCls: 'q-col-cross' },
      { key: 'power', label: '综合\n实力', sortable: false, colCls: 'q-col-power' },
      { key: 'ad', label: '攻守\n实力', sortable: false, colCls: 'q-col-ad' }
    ];
    renderRow = function (item) {
      return renderGoalDiff(item) +
        renderCrossValue(item) +
        renderPower(item) +
        renderAdCombined(item);
    };
  } else if (currentTab === 'goal') {
    cols = [
      { key: 'match', label: '对阵', sortable: false, colCls: 'q-col-match', hdCls: 'q-match-hd' },
      { key: 'bigBallRatio', label: '综合大球\n比例', sortable: true, colCls: 'q-col-big' },
      { key: 'attDefGoal', label: '攻防\n进球', sortable: true, colCls: 'q-col-ag' },
      { key: 'headToHeadGoal', label: '交锋\n进球', sortable: true, colCls: 'q-col-hg' },
      { key: 'breakArmor', label: '破甲和', sortable: true, colCls: 'q-col-ba' }
    ];
    renderRow = function (item) {
      return renderGoalCell(item, 'bigBallRatio') +
        renderGoalCell(item, 'attDefGoal') +
        renderGoalCell(item, 'headToHeadGoal') +
        renderGoalCell(item, 'breakArmor');
    };
  } else {
    cols = [
      { key: 'match', label: '对阵', sortable: false, colCls: 'q-col-match', hdCls: 'q-match-hd' },
      { key: 'rq', label: '让球数', sortable: false, colCls: 'q-col-rq' },
      { key: 'hotFocusNum', label: '关注\n热度\n（万）', sortable: true, colCls: 'q-col-hot' },
      { key: 'heatIndex', label: '冷热\n指数', sortable: true, colCls: 'q-col-heat' },
      { key: 'oddsLive', label: '亚指\n临盘', sortable: false, colCls: 'q-col-ol' }
    ];
    renderRow = function (item) {
      return renderHotCell(item, 'rq') +
        renderHotCell(item, 'hotFocusNum') +
        renderHotCell(item, 'heatIndex') +
        renderHotCell(item, 'oddsLive');
    };
  }

  // 构建卡片表格
  var h = '<div class="quant-card-list">';

  // 表头
  h += '<div class="quant-card-header">';
  h += '<span class="q-col-chk"></span>';
  cols.forEach(function (c) {
    var isActive = sortKey === c.key;
    var sortCls = '';
    if (isActive && c.sortable) {
      sortCls = sortAsc ? ' q-sort-asc' : ' q-sort-desc';
    }
    h += '<span class="' + c.colCls + (c.hdCls ? ' ' + c.hdCls : '') +
      (c.sortable ? ' q-sortable' + sortCls : '') +
      '" onclick="' + (c.sortable ? 'sortBy(\'' + c.key + '\')' : '') + '">' +
      c.label.replace(/\n/g, '<br>') + '</span>';
  });
  h += '</div>';

  // 数据行
  sorted.forEach(function (item) {
    var p = !!pickedIds[item.matchId];
    h += '<div id="qr-' + item.matchId + '" class="quant-card-row' + (p ? ' picked' : '') + '">';
    h += '<span class="q-col-chk"><input type="checkbox" class="q-chk" ' + (p ? 'checked' : '') + ' onclick="togglePick(event,\'' + item.matchId + '\')"/></span>';
    h += renderMatch(item);
    h += renderRow(item);
    h += '</div>';
  });

  h += '</div>';
  wrap.innerHTML = h;
  updatePkBar();

  // P2-6: 显示视图切换按钮
  var toggle = document.getElementById('quantViewToggle');
  if (toggle && allData.length > 0) {
    toggle.style.display = 'flex';
    // P2-6: 平板+ 默认图表视图
    if (window.innerWidth >= 768 && currentView === 'table') {
      switchQuantView('chart');
    }
  }
}

// ── 对战列 ──
function shortTeam(name) {
  if (!name) return '--';
  return name.length > 3 ? name.slice(0, 3) + '..' : name;
}

function renderMatch(item) {
  var tagsHtml = renderTags(item);
  return '<span class="q-col-match q-match-cell">' +
    '<div class="q-match-teams" title="' + esc(item.homeName) + '">' + esc(shortTeam(item.homeName)) + '</div>' +
    '<div class="q-match-vs">vs</div>' +
    '<div class="q-match-teams" title="' + esc(item.visitName) + '">' + esc(shortTeam(item.visitName)) + '</div>' +
    (tagsHtml ? tagsHtml : '') +
    '</span>';
}

// ── 总排序（四维合成得分，保留2位小数） ──
function renderRank(totalScore) {
  if (totalScore === undefined || totalScore === null || isNaN(totalScore))
    return '<span class="q-col-rk"><span class="q-cell-num">-</span></span>';
  var n = parseFloat(totalScore);
  var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return '<span class="q-col-rk"><span class="q-cell-num ' + cls + '">' + (n >= 0 ? '+' : '') + n.toFixed(2) + '</span></span>';
}

// ── 净胜球量化（保留2位小数） ──
function renderGoalDiff(item) {
  var v = item.gdScore !== undefined ? item.gdScore : item.goalDiff;
  if (v === '-' || v === '?' || v === undefined || v === null) return '<span class="q-col-gd"><span class="q-cell-num">-</span></span>';
  var n = parseFloat(v);
  if (isNaN(n)) return '<span class="q-col-gd"><span class="q-cell-num">' + v + '</span></span>';
  var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return '<span class="q-col-gd"><span class="q-cell-num ' + cls + '">' + (n >= 0 ? '+' : '') + n.toFixed(2) + '</span></span>';
}
// ── 综合实力（Total_战，百分比化显示） ──
function renderPower(item) {
  var pv = item.pwScore;
  if (pv === '-' || pv === undefined || pv === null)
    return '<span class="q-col-power"><span class="q-cell-num" style="color:var(--text4)">-</span></span>';
  var pct = pv * 100;
  var cls = pv > 0 ? 'pos' : pv < 0 ? 'neg' : '';
  return '<span class="q-col-power"><span class="q-cell-num ' + cls + '">' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%</span></span>';
}

// ── 胜平负交叉（只展示RC值） ──
function renderCrossValue(item) {
  var v = item.crossValue;
  if (v === '-' || v === undefined || v === null) {
    return '<span class="q-col-cross"><span class="q-cell-num" style="color:var(--text4)">-</span></span>';
  }
  var n = v;
  if (typeof n !== 'number' || isNaN(n)) return '<span class="q-col-cross"><span class="q-cell-num">' + v + '</span></span>';
  var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return '<span class="q-col-cross"><span class="q-cell-num ' + cls + '">' + (n >= 0 ? '+' : '') + n + '</span></span>';
}

// ── 攻守实力（保留2位小数，含格局徽章 P1-2） ──
function renderAdCombined(item) {
  var v = item.adCombined;
  var patternBadge = '';
  if (item.attackPattern) {
    var pc = item.attackPattern === '对攻为主' ? 'atk' : item.attackPattern === '防守为主' ? 'def' : 'bal';
    patternBadge = '<span class="pattern-badge ' + pc + '" title="' +
      (item.attackPattern === '对攻为主' ? '进攻优势度>0.15 且 防守优势度>-0.05' :
       item.attackPattern === '防守为主' ? '防守优势度>0.15 且 进攻优势度>-0.05' : '攻守平衡') +
      '">' + item.attackPattern + '</span>';
  }
  if (v === '-' || v === undefined || v === null)
    return '<span class="q-col-ad"><span class="q-cell-num" style="color:var(--text4)">-</span>' + patternBadge + '</span>';
  var n = parseFloat(v);
  if (isNaN(n)) return '<span class="q-col-ad"><span class="q-cell-num">' + v + '</span>' + patternBadge + '</span>';
  var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return '<span class="q-col-ad"><span class="q-cell-num ' + cls + '">' + (n >= 0 ? '+' : '') + n.toFixed(2) + '</span>' + patternBadge + '</span>';
}

// ── 进球 tab 单元格 (统一 toFixed(1)) ──
function renderGoalCell(item, key) {
  var v = item[key];
  if (v === '-' || v === undefined || v === null) {
    return '<span class="q-col-' + keyToCls(key) + '"><span class="q-cell-num" style="color:var(--text4)">-</span></span>';
  }
  var n = parseFloat(v);
  if (isNaN(n)) return '<span class="q-col-' + keyToCls(key) + '"><span class="q-cell-num">' + v + '</span></span>';
  var formatted;
  if (key === 'bigBallRatio') {
    formatted = n.toFixed(1) + '%';
  } else {
    formatted = (n >= 0 ? '+' : '') + n.toFixed(1);
  }
  var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return '<span class="q-col-' + keyToCls(key) + '"><span class="q-cell-num ' + cls + '">' + formatted + '</span></span>';
}

function keyToCls(key) {
  var m = { totalSum: 'sum', bigBallRatio: 'big', attDefGoal: 'ag', strengthGoal: 'sg', headToHeadGoal: 'hg', breakArmor: 'ba' };
  return m[key] || 'sum';
}

// ── M3.7 四重验证单元格 (P1-1) ──
function renderFusionCell(item) {
  var consensus = item.fusionConsensus;
  if (!consensus) return '<span class="q-col-fusion"><span class="q-cell-num" style="color:var(--text4)">-</span></span>';
  var cls = 'fusion-' + consensus;
  var label = consensus === 'strong' ? '强一致' : consensus === 'weak' ? '弱一致' : consensus === 'meltdown' ? '⚠️熔断' : '';
  var h = item.fusionFinalHome != null ? item.fusionFinalHome.toFixed(2) : '-';
  var a = item.fusionFinalAway != null ? item.fusionFinalAway.toFixed(2) : '-';
  return '<span class="q-col-fusion">' +
    '<span class="fusion-badge ' + cls + '" title="E_final=H' + h + '+A' + a + '">' + label + '</span>' +
    '<span style="display:block;font-size:8px;color:var(--text3);line-height:1.1">H' + h + '+A' + a + '</span>' +
    '</span>';
}

// ── 热点 tab 单元格 (去图标) ──
function renderHotCell(item, key) {
  var v = item[key];
  if (v === '-' || v === undefined || v === null) {
    return '<span class="q-col-' + hotKeyToCls(key) + '"><span class="q-cell-num">-</span></span>';
  }
  if (key === 'heatIndex') {
    // 去掉后端可能附加的图标，只取数值
    var cleaned = String(v).replace(/[^\d.]/g, '');
    var n = parseFloat(cleaned);
    if (isNaN(n)) return '<span class="q-col-heat"><span class="q-cell-num">' + v + '</span></span>';
    var cls = n > 1.20 ? 'neg' : n < 0.80 ? 'cool' : 'pos';
    return '<span class="q-col-heat"><span class="q-cell-num ' + cls + '">' + n.toFixed(2) + '</span></span>';
  }
  if (key === 'staticDiff') {
    var n = parseFloat(v);
    if (isNaN(n)) return '<span class="q-col-sd"><span class="q-cell-num">' + v + '</span></span>';
    var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
    return '<span class="q-col-sd"><span class="q-cell-num ' + cls + '">' + (n >= 0 ? '+' : '') + n.toFixed(2) + '</span></span>';
  }
  if (key === 'hotFocusNum') {
    var n = parseFloat(v);
    if (isNaN(n)) return '<span class="q-col-hot"><span class="q-cell-num">' + v + '</span></span>';
    var fmt = (n / 10000).toFixed(1);
    return '<span class="q-col-hot"><span class="q-cell-num pos">' + fmt + '</span></span>';
  }
  // rq, homeFeature, guestFeature, oddsLive
  // 文本字段清理箭头符号后展示
  if (key === 'rq' || key === 'homeFeature' || key === 'guestFeature') {
    var cleaned = String(v).replace(/→/g, '').trim();
    return '<span class="q-col-' + hotKeyToCls(key) + '"><span class="q-cell-num">' + cleaned + '</span></span>';
  }
  var n = parseFloat(v);
  if (isNaN(n)) return '<span class="q-col-' + hotKeyToCls(key) + '"><span class="q-cell-num">' + v + '</span></span>';
  return '<span class="q-col-' + hotKeyToCls(key) + '"><span class="q-cell-num">' + n.toFixed(2) + '</span></span>';
}

function hotKeyToCls(key) {
  var m = { rq: 'rq', hotFocusNum: 'hot', heatIndex: 'heat', homeFeature: 'hf', guestFeature: 'gf', staticDiff: 'sd', oddsLive: 'ol' };
  return m[key] || 'ol';
}

// ── 排序值提取 ──
function getSortVal(item, key) {
  switch (key) {
    case 'rank':       return parseFloat(item.totalScore) || 0;
    case 'goalDiff':   return parseFloat(item.gdScore) || 0;
    case 'cross':      return parseFloat(item.crossValue) || 0;
    case 'power':      return parseFloat(item.pwScore) || 0;
    case 'ad':         return parseFloat(item.adCombined) || 0;
    case 'totalSum':       return parseFloat(item.totalSum) || 0;
    case 'bigBallRatio':   return parseFloat(item.bigBallRatio) || 0;
    case 'attDefGoal':     return parseFloat(item.attDefGoal) || 0;
    case 'strengthGoal':   return parseFloat(item.strengthGoal) || 0;
    case 'headToHeadGoal': return parseFloat(item.headToHeadGoal) || 0;
    case 'breakArmor':     return parseFloat(item.breakArmor) || 0;
    case 'hotFocusNum': return parseFloat(item.hotFocusNum) || 0;
    case 'heatIndex':
      var hv = String(item.heatIndex).replace(/[^\d.]/g, '');
      return parseFloat(hv) || 0;
    case 'staticDiff':  return parseFloat(item.staticDiff) || 0;
    default: return 0;
  }
}

// ═══ P0-1: 智能标签系统 ═══
function computeTags(item) {
  var tags = [];
  var pwScore = parseFloat(item.pwScore) || 0;
  // 1. 绝对优势: pwScore >= 0.25
  if (pwScore >= 0.25) tags.push({ e: '🔥', t: '绝对优势', c: 'tag-dominance' });
  // 2. 模型打架: 熔断
  if (item.fusionConsensus === 'meltdown') tags.push({ e: '⚠️', t: '模型打架', c: 'tag-meltdown' });
  // 3. 实力均衡: -0.08 ~ +0.08
  if (pwScore >= -0.08 && pwScore <= 0.08) tags.push({ e: '🎯', t: '实力均衡', c: 'tag-balanced' });
  // 4. 过热风险: heatIndex >= 1.40
  var heatIdx = parseFloat(item.heatIndex);
  if (!isNaN(heatIdx) && heatIdx >= 1.40) {
    tags.push({ e: '💰', t: '过热风险 (' + heatIdx.toFixed(2) + ')', c: 'tag-overheat' });
  }
  // 5. 冷门潜质: heatIndex <= 0.85
  if (!isNaN(heatIdx) && heatIdx > 0 && heatIdx <= 0.85) {
    tags.push({ e: '🧊', t: '冷门潜质 (' + heatIdx.toFixed(2) + ')', c: 'tag-cold' });
  }
  // 6. 防守大战: adCombined > 0.15 且总进球期望<2.0
  var ad = parseFloat(item.adCombined) || 0;
  var totalGoals = item.strengthGoal !== undefined ? parseFloat(item.strengthGoal) : 0;
  if (ad > 0.15 && totalGoals > 0 && totalGoals < 2.0) tags.push({ e: '🛡️', t: '防守大战', c: 'tag-defense' });
  // 7. 对攻大战: adCombined > 0.15 且总进球期望>3.0
  if (ad > 0.15 && totalGoals > 3.0) tags.push({ e: '⚡', t: '对攻大战', c: 'tag-attack' });
  return tags;
}

function renderTags(item) {
  var tags = computeTags(item);
  if (!tags.length) return '';
  return '<span class="q-match-tags">' + tags.map(function (t) {
    return '<span class="q-tag ' + t.c + '" title="' + esc(t.t) + '">' + t.e + '</span>';
  }).join('') + '</span>';
}

// ═══ P2-5/P2-6: ECharts 图表视图 + 响应式切换 ═══
var currentView = 'table';
var chartInstance = null;
var chartResizeHandler = null;

export function switchQuantView(view) {
  currentView = view;
  var tableWrap = document.getElementById('quantTableWrap');
  var chartWrap = document.getElementById('quantChartWrap');
  var toggle = document.getElementById('quantViewToggle');
  var btns = toggle ? toggle.querySelectorAll('.qt-view-btn') : [];

  btns.forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });

  if (view === 'chart') {
    if (tableWrap) tableWrap.style.display = 'none';
    if (chartWrap) chartWrap.style.display = 'block';
    setTimeout(function () { renderChart(); }, 100);
  } else {
    if (tableWrap) tableWrap.style.display = 'block';
    if (chartWrap) chartWrap.style.display = 'none';
  }
}

function renderChart() {
  var container = document.getElementById('quantChart');
  if (!container) return;

  // 懒加载 ECharts
  loadECharts().then(function () {
    if (!echartsReady || !window.echarts) return;
    _doRenderChart(container);
  });
}

function _doRenderChart(container) {

  var filtered = allData.filter(function (item) {
    return (currentTab === 'power') || (currentTab === 'goal') || (currentTab === 'hot' && item.hotFocusNum !== '-' && item.hotFocusNum !== undefined);
  });

  if (!filtered.length) {
    container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text3)">暂无数据</div>';
    return;
  }

  var n = filtered.length;

  // 短队名
  var names = filtered.map(function (item) {
    return shortTeam(item.homeName) + ' vs ' + shortTeam(item.visitName);
  });

  // ═══ 根据 tab 定义指标组（每组 3-4 项） ═══
  var seriesDefs;
  if (currentTab === 'power') {
    seriesDefs = [
      { name: '综合实力',  key: 'pwScore',     fmt: 2, color: '#18E0E0' },
      { name: '净胜球量化', key: 'gdScore',     fmt: 2, color: '#22c55e' },
      { name: '胜平负交叉', key: 'crossValue',  fmt: 2, color: '#fbbf24' },
      { name: '攻守实力',  key: 'adCombined',  fmt: 2, color: '#f97316' }
    ];
  } else if (currentTab === 'goal') {
    seriesDefs = [
      { name: '综合大球比例',   key: 'bigBallRatio',    fmt: 1, color: '#22c55e' },
      { name: '攻防进球',   key: 'attDefGoal',      fmt: 1, color: '#60a5fa' },
      { name: '交锋进球',   key: 'headToHeadGoal',  fmt: 1, color: '#fbbf24' },
      { name: '破甲和',     key: 'breakArmor',      fmt: 1, color: '#f97316' }
    ];
  } else {
    seriesDefs = [
      { name: '关注热度',  key: 'hotFocusNum', fmt: 1, color: '#f97316' },
      { name: '冷热指数',  key: 'heatIndex',   fmt: 2, color: '#18E0E0' }
    ];
  }

  // 动态高度：每场 × 30px（每组指标间隙） + 40px legend
  var rowsPerTeam = seriesDefs.length;
  var chartH = Math.max(400, n * rowsPerTeam * 14 + 60);
  container.style.height = chartH + 'px';

  // ── 构建 series ──
  var series = seriesDefs.map(function (def) {
    var data = filtered.map(function (item) {
      var raw = parseFloat(item[def.key]);
      if (isNaN(raw)) return '-';
      return parseFloat(raw.toFixed(def.fmt));
    });
    return {
      name: def.name,
      type: 'bar',
      data: data,
      barMaxWidth: 16,
      itemStyle: {
        color: def.color,
        borderRadius: [0, 3, 3, 0]
      },
      label: {
        show: true,
        position: 'right',
        color: '#94A3B8',
        fontSize: 9
      }
    };
  });

  chartInstance = echarts.init(container);
  chartInstance.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: function (params) {
        var html = '<b>' + params[0].name + '</b>';
        params.forEach(function (p) {
          html += '<br/>' + p.marker + ' ' + p.seriesName + '：<b>' + p.value + '</b>';
        });
        return html;
      }
    },
    legend: {
      data: seriesDefs.map(function (s) { return s.name; }),
      textStyle: { color: '#94A3B8', fontSize: 10 },
      top: 0
    },
    grid: { left: '2%', right: '8%', top: 36, bottom: 10, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#64748B', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(24,224,224,0.04)' } },
      axisLine: { show: false }
    },
    yAxis: {
      type: 'category',
      data: names,
      axisLabel: { color: '#94A3B8', fontSize: 10, width: 80, overflow: 'truncate' },
      axisLine: { show: false },
      axisTick: { show: false },
      inverse: true
    },
    series: series,
    backgroundColor: 'transparent'
  });

  // 清理旧 resize 监听，添加新的
  if (chartResizeHandler) window.removeEventListener('resize', chartResizeHandler);
  chartResizeHandler = function () { if (chartInstance) chartInstance.resize(); };
  window.addEventListener('resize', chartResizeHandler);
}

function esc(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

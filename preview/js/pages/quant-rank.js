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
  pickedIds = {};  // 切换 tab 时清空复选框状态
  updatePkBar();
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
  if (window.openPKMulti) { window.openPKMulti(picked, currentTab); clearPicks(); }
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

  api('ranking-list', params).then(function (rankData) {
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
    // ⭐ 批量获取功守道 + 热度数据（2 次请求替代 N+1 次）
    var gsAllPromise = api('gongshoudao-all', params).catch(function () { return {}; });
    var hotPromise = api('quant-hot', params).catch(function () { return null; });
    Promise.all([gsAllPromise, hotPromise]).then(function (results) {
      var gsAllData = results[0] || {};
      var gsAllMap = gsAllData.gsData || {};
      var hotData = results[1] || {};
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
    });
  }).catch(function () {
    wrap.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text3)">加载失败</div>';
  });
}

function mergeItem(item, gs) {
  var cw = gs.crossWin !== undefined ? gs.crossWin : '-';
  var cd = gs.crossDraw !== undefined ? gs.crossDraw : '-';
  var cl = gs.crossLose !== undefined ? gs.crossLose : '-';

  // ── 进球预测维度（直接使用后端按 PK.md 公式计算的值） ──

  // 大球比例 = 0.4×主队大球率 + 0.4×客队大球率 + 0.2×交锋大球率（百分比）
  var bigBall = gs.bigBallRatio != null ? gs.bigBallRatio : 50;

  // 攻防进球 = xgHome + xgAway（射门还原法 M3_A）
  var attDefGoal = gs.attDefGoal != null ? gs.attDefGoal : (gs.xgHome || 0) + (gs.xgAway || 0);

  // 实力进球 = 0.5 × (主队静态进球能力 + 客队静态进球能力) × (1 + 0.2 × Total_战)
  var strengthGoal = gs.strengthGoal != null ? gs.strengthGoal : (parseFloat(gs.totalGoalsExpect) || 0);

  // 交锋进球 = H2H场均总进球（最近3-6次交锋）
  var headToHeadGoal = gs.h2hGoalAvg != null ? gs.h2hGoalAvg : 2.5;

  // 破甲和 = 主队进攻次数/(客队被射次数+0.5) + 客队进攻次数/(主队被射次数+0.5)
  var breakArmor = gs.breakArmorSum != null ? gs.breakArmorSum : 0;

  // ── 实力PK四维指标（PK.md 2.1-2.2） ──

  // ① 净胜球量化 = xgHome - xgAway（源自射门还原法 M3_A）
  var gdScore = (gs.xgHome != null && gs.xgAway != null) ? parseFloat((gs.xgHome - gs.xgAway).toFixed(4)) : 0;

  // ② 胜平负交叉 = (H_win + G_loss - H_loss - G_win) / 10（基于真实赛果对冲）
  var crossValue = (gs.hWins != null && gs.aLosses != null) ? ((gs.hWins + gs.aLosses - gs.hLosses - gs.aWins) / 10) : '-';
  var cvNum = crossValue === '-' ? 0 : parseFloat(crossValue);

  // ③ 综合实力 = Total_战 = 0.7×(homePower-guestPower)/100 + 0.3×Dyn（双轨实力量化）
  var pwScore = gs.totalStrength != null ? parseFloat(gs.totalStrength.toFixed(4)) : 0;

  // ④ 攻守实力 = w_进攻 × Adv_进攻 + w_防守 × Adv_防守（sigmoid加权合成 V24.0）
  var adCombined = gs.adWeightedComposite != null ? parseFloat(gs.adWeightedComposite.toFixed(4)) : 0;

  // 总排序 = 0.25 × 净胜球 + 0.25 × 胜平负交叉 + 0.25 × 综合实力 + 0.25 × 攻守实力
  var totalScore = parseFloat(((gdScore + cvNum + pwScore + adCombined) / 4).toFixed(4));

  function goalTotalSum() {
    var b = Math.abs(bigBall);
    var a = Math.abs(attDefGoal);
    var s = Math.abs(strengthGoal);
    var h = Math.abs(headToHeadGoal);
    var r = Math.abs(breakArmor);
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
    oddsLive: '-',
    // P1: 胜平负交叉数值
    crossValue: crossValue,
    // P2: 攻守实力组合值
    adCombined: adCombined
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
      { key: 'rank', label: '总排序', sortable: true, colCls: 'q-col-rk' },
      { key: 'goalDiff', label: '净胜球', sortable: false, colCls: 'q-col-gd' },
      { key: 'cross', label: '胜平负\n交叉', sortable: false, colCls: 'q-col-cross' },
      { key: 'power', label: '综合\n实力', sortable: false, colCls: 'q-col-power' },
      { key: 'ad', label: '攻守\n实力', sortable: false, colCls: 'q-col-ad' }
    ];
    renderRow = function (item) {
      return renderRank(item.totalScore) +
        renderGoalDiff(item) +
        renderCrossValue(item) +
        renderPower(item) +
        renderAdCombined(item);
    };
  } else if (currentTab === 'goal') {
    cols = [
      { key: 'match', label: '对阵', sortable: false, colCls: 'q-col-match', hdCls: 'q-match-hd' },
      { key: 'totalSum', label: '合计', sortable: true, colCls: 'q-col-sum' },
      { key: 'bigBallRatio', label: '大球\n比例', sortable: true, colCls: 'q-col-big' },
      { key: 'attDefGoal', label: '攻防\n进球', sortable: true, colCls: 'q-col-ag' },
      { key: 'strengthGoal', label: '实力\n进球', sortable: true, colCls: 'q-col-sg' },
      { key: 'headToHeadGoal', label: '交锋\n进球', sortable: true, colCls: 'q-col-hg' },
      { key: 'breakArmor', label: '破甲和', sortable: true, colCls: 'q-col-ba' }
    ];
    renderRow = function (item) {
      return renderGoalCell(item, 'totalSum') +
        renderGoalCell(item, 'bigBallRatio') +
        renderGoalCell(item, 'attDefGoal') +
        renderGoalCell(item, 'strengthGoal') +
        renderGoalCell(item, 'headToHeadGoal') +
        renderGoalCell(item, 'breakArmor');
    };
  } else {
    cols = [
      { key: 'match', label: '对阵', sortable: false, colCls: 'q-col-match', hdCls: 'q-match-hd' },
      { key: 'rq', label: '让球数', sortable: false, colCls: 'q-col-rq' },
      { key: 'hotFocusNum', label: '关注\n热度\n（万）', sortable: true, colCls: 'q-col-hot' },
      { key: 'heatIndex', label: '冷热\n指数', sortable: true, colCls: 'q-col-heat' },
      { key: 'homeFeature', label: '主队\n特征', sortable: false, colCls: 'q-col-hf' },
      { key: 'guestFeature', label: '客队\n特征', sortable: false, colCls: 'q-col-gf' },
      { key: 'staticDiff', label: '静态\n实力差', sortable: true, colCls: 'q-col-sd' },
      { key: 'oddsLive', label: '亚指\n临盘', sortable: false, colCls: 'q-col-ol' }
    ];
    renderRow = function (item) {
      return renderHotCell(item, 'rq') +
        renderHotCell(item, 'hotFocusNum') +
        renderHotCell(item, 'heatIndex') +
        renderHotCell(item, 'homeFeature') +
        renderHotCell(item, 'guestFeature') +
        renderHotCell(item, 'staticDiff') +
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
}

// ── 对战列 ──
function shortTeam(name) {
  if (!name) return '--';
  return name.length > 3 ? name.slice(0, 3) + '..' : name;
}

function renderMatch(item) {
  return '<span class="q-col-match q-match-cell">' +
    '<div class="q-match-teams" title="' + esc(item.homeName) + '">' + esc(shortTeam(item.homeName)) + '</div>' +
    '<div class="q-match-vs">vs</div>' +
    '<div class="q-match-teams" title="' + esc(item.visitName) + '">' + esc(shortTeam(item.visitName)) + '</div>' +
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
  var pv = item.pwScore !== undefined ? item.pwScore : (item.totalAdvantageValue - 50) / 100;
  var pct = pv * 100;
  var cls = pv > 0 ? 'pos' : pv < 0 ? 'neg' : '';
  return '<span class="q-col-power"><span class="q-cell-num ' + cls + '">' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%</span></span>';
}

// ── 胜平负交叉（保留2位小数） ──
function renderCrossValue(item) {
  var v = item.crossValue;
  if (v === '-' || v === undefined || v === null) {
    return '<span class="q-col-cross"><span class="q-cell-num" style="color:var(--text4)">-</span></span>';
  }
  var n = parseFloat(v);
  if (isNaN(n)) return '<span class="q-col-cross"><span class="q-cell-num">' + v + '</span></span>';
  var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return '<span class="q-col-cross"><span class="q-cell-num ' + cls + '">' + (n >= 0 ? '+' : '') + n.toFixed(2) + '</span></span>';
}

// ── 攻守实力（保留2位小数） ──
function renderAdCombined(item) {
  var v = item.adCombined;
  if (v === 0 || v === undefined || v === null) return '<span class="q-col-ad"><span class="q-cell-num" style="color:var(--text4)">0.00</span></span>';
  var n = parseFloat(v);
  if (isNaN(n)) return '<span class="q-col-ad"><span class="q-cell-num">' + v + '</span></span>';
  var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return '<span class="q-col-ad"><span class="q-cell-num ' + cls + '">' + (n >= 0 ? '+' : '') + n.toFixed(2) + '</span></span>';
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
    var fmt = n > 10000 ? Math.round(n / 100) / 100 : n.toFixed(0);
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

function esc(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

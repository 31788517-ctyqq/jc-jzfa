// ==================== 主入口：路由导航 + 全局状态管理 ====================
console.log('[V6.0-LAZY] main-fusion.js loaded');
import { api } from './api.js';
import { WEEK_NAMES, formatDate } from './utils.js';
import * as state from './state.js';
import { loadHome } from './pages/home.js';
import { loadMatchList, loadMatchListFromData, startMatchPK } from './pages/match-list.js';

// ═══ 模块懒加载：非核心页面模块按需动态导入 ═══
var _modCache = {};
function _mod(name) {
  if (_modCache[name]) return Promise.resolve(_modCache[name]);
  return import('./pages/' + name + '.js').then(function (m) {
    _modCache[name] = m;
    return m;
  });
}

// 预加载常用模块（在首次渲染后异步加载，不阻塞首页）
function _preloadMods() {
  setTimeout(function () {
    _mod('ranking');    // 排行榜 → tab-rank
    _mod('match-detail'); // 比赛详情
    _mod('match-pk-fusion'); // PK弹窗
  }, 800);
}

// ═══ 懒加载 window 代理 ═══
// 所有 onclick 调用的函数通过代理确保模块已加载
window.goDetail      = function (id) { _mod('match-detail').then(function (m) { m.goDetail(id); }); };
window.closeAI       = function ()   { _mod('match-detail').then(function (m) { m.closeAI(); }); };
window.showAIPrediction = function (id) { _mod('match-detail').then(function (m) { m.showAIPrediction(id); }); };
window.showGongshoudao = function () { var args = arguments; _mod('gongshoudao').then(function (m) { m.showGongshoudao.apply(null, args); }); };
window.openPK        = function ()   { var args = arguments; _mod('match-pk-fusion').then(function (m) { m.openPK.apply(null, args); }); };
window.closePK       = function ()   { _mod('match-pk-fusion').then(function (m) { m.closePK(); }); };
window.openPKMulti   = function ()   { var args = arguments; _mod('match-pk-fusion').then(function (m) { m.openPKMulti.apply(null, args); }); };
window.toggleDD      = function ()   { var args = arguments; _mod('filter').then(function (m) { m.toggleDD.apply(null, args); }); };
window.selectDD      = function ()   { var args = arguments; _mod('filter').then(function (m) { m.selectDD.apply(null, args); }); };
window.getDDVal      = function ()   { return ''; }; // 同步取值已在 filter.js 处理
window.onDDTypeChange = function ()  { _mod('filter').then(function (m) { m.onDDTypeChange(); }); };
window.onRankTypeChange = function(){ _mod('filter').then(function (m) { m.onRankTypeChange(); }); };
window.doFilterQuery = function ()   { _mod('filter').then(function (m) { m.doFilterQuery(); }); };
window.loadIncome    = function (f)  { _mod('income').then(function (m) { m.loadIncome(f); }); };
window.switchPlanTab = function (t)  { _mod('plans').then(function (m) { m.switchPlanTab(t); }); };
window.shiftPlanDate = function (d)  { _mod('plans').then(function (m) { m.shiftPlanDate(d); }); };
window.goPlanToday   = function ()   { _mod('plans').then(function (m) { m.goPlanToday(); }); };
window.switchQuantTab = function (t) { _mod('quant-rank-fusion').then(function (m) { m.switchQuantTab(t); }); };
window.toggleQuantDatePicker = function () { _mod('quant-rank-fusion').then(function (m) { m.toggleQuantDatePicker(); }); };
window.shiftQuantDate = function (d) { _mod('quant-rank-fusion').then(function (m) { m.shiftQuantDate(d); }); };
window.goQuantToday  = function ()   { _mod('quant-rank-fusion').then(function (m) { m.goQuantToday(); }); };
window.togglePick    = function (id) { _mod('quant-rank-fusion').then(function (m) { m.togglePick(id); }); };
window.startPK       = function ()   { _mod('quant-rank-fusion').then(function (m) { m.startPK(); }); };
window.sortBy        = function (k)  { _mod('quant-rank-fusion').then(function (m) { m.sortBy(k); }); };
window.switchQuantView = function (v) { _mod('quant-rank-fusion').then(function (m) { m.switchQuantView(v); }); };
window.startMatchPK  = startMatchPK;  // 已静态导入
window.handleDocClose = function (e) { _mod('filter').then(function (m) { m.handleDocClose(e); }); };

// WebSocket 暂未实现，使用 HTTP 轮询模式

// ── 日期切换 ──
export function updateDateBar() {
  var el = document.getElementById('dateCurrent');
  if (!el) return;
  var w = state.weekDates[state.selectedWeekIdx];
  if (w) {
    var today = formatDate(new Date()).slice(5);
    var prefix = w.matchDate === today ? '今天 ' : '';
    el.textContent = prefix + w.matchDate.replace('-', '/') + ' ' + w.weekNum;
  } else {
    el.textContent = '加载中...';
  }
}

export function shiftWeek(delta) {
  var newIdx = state.selectedWeekIdx + delta;
  if (newIdx < 0 || newIdx >= state.weekDates.length) return;
  state.setSelectedWeekIdx(newIdx);
  updateDateBar();
  loadMatchList();
}

// ── 日历选择器 ──
export function toggleDatePicker() {
  var el = document.getElementById('datePicker');
  if (!el) return;
  var isOpen = el.style.display !== 'none';
  if (isOpen) { el.style.display = 'none'; return; }
  renderDatePicker();
  el.style.display = 'block';
}

let pickerYear, pickerMonth;

function renderDatePicker() {
  var grid = document.getElementById('datePickerGrid');
  var monthEl = document.getElementById('datePickerMonth');
  if (!grid || !monthEl) return;

  var weeks = state.weekDates || [];
  var available = {};
  weeks.forEach(function (w) { available[w.matchDate] = true; });

  var today = formatDate(new Date()).slice(5);
  var current = weeks[state.selectedWeekIdx] ? weeks[state.selectedWeekIdx].matchDate : '';

  if (!pickerYear) {
    var d = new Date();
    pickerYear = d.getFullYear();
    pickerMonth = d.getMonth() + 1;
    if (current) pickerMonth = parseInt(current.slice(0, 2), 10);
  }
  window.datePickerYear = pickerYear;

  var CN = ['一','二','三','四','五','六','七','八','九','十','十一','十二'];
  monthEl.textContent = CN[pickerMonth - 1] + '月 ' + pickerYear;

  var firstDay = new Date(pickerYear, pickerMonth - 1, 1);
  var lastDay = new Date(pickerYear, pickerMonth, 0);
  var daysInMonth = lastDay.getDate();
  var startDow = firstDay.getDay();

  var html = '';
  for (var i = 0; i < startDow; i++) html += '<div class="date-picker-cell other-month"></div>';
  for (var day = 1; day <= daysInMonth; day++) {
    var mm = String(pickerMonth).padStart(2, '0');
    var dd = String(day).padStart(2, '0');
    var md = mm + '-' + dd;
    var hasMatch = !!available[md];
    var isActive = md === current;
    var isToday = md === today;
    var cls = 'date-picker-cell';
    if (hasMatch) cls += ' has-match';
    if (isActive) cls += ' active';
    if (isToday) cls += ' today';
    var onclick = ' onclick="selectDateFromPicker(\'' + md + '\')"';
    html += '<div class="' + cls + '"' + onclick + '>' + day + '</div>';
  }
  grid.innerHTML = html;

  document.getElementById('datePickerPrev').onclick = function () { pickerMonth--; if (pickerMonth < 1) { pickerYear--; pickerMonth = 12; } window.datePickerYear = pickerYear; renderDatePicker(); };
  document.getElementById('datePickerNext').onclick = function () { pickerMonth++; if (pickerMonth > 12) { pickerYear++; pickerMonth = 1; } window.datePickerYear = pickerYear; renderDatePicker(); };
}

export function selectDateFromPicker(matchDate) {
  var weeks = state.weekDates || [];
  if (matchDate === 'today') {
    var today = formatDate(new Date()).slice(5);
    for (var i = 0; i < weeks.length; i++) {
      if (weeks[i].matchDate === today) { state.setSelectedWeekIdx(i); break; }
    }
  } else {
    for (var i = 0; i < weeks.length; i++) {
      if (weeks[i].matchDate === matchDate) { state.setSelectedWeekIdx(i); break; }
    }
  }
  updateDateBar();
  loadMatchList();
  var el = document.getElementById('datePicker');
  if (el) el.style.display = 'none';
}

// ── 通用日历渲染 ──
function dobj(dateStr) {
  var p = dateStr.split('-');
  return { y: parseInt(p[0], 10), m: parseInt(p[1], 10), d: parseInt(p[2], 10) };
}

function renderMonthCalendar(prefix, availableDates, currentDate, todayDate, onSelect) {
  var grid = document.getElementById(prefix + 'Grid');
  var monthEl = document.getElementById(prefix + 'Month');
  if (!grid || !monthEl) return;

  var yearKey = prefix + 'Year', monthKey = prefix + 'MonthIdx';
  if (typeof window[yearKey] === 'undefined') {
    var d = new Date();
    window[yearKey] = d.getFullYear();
    window[monthKey] = d.getMonth() + 1;
    if (currentDate) window[monthKey] = parseInt(currentDate.slice(0, 2), 10);
  }

  var CN = ['一','二','三','四','五','六','七','八','九','十','十一','十二'];
  monthEl.textContent = CN[window[monthKey] - 1] + '月 ' + window[yearKey];

  var firstDay = new Date(window[yearKey], window[monthKey] - 1, 1);
  var lastDay = new Date(window[yearKey], window[monthKey], 0);
  var startDow = firstDay.getDay();

  var html = '';
  for (var i = 0; i < startDow; i++) html += '<div class="date-picker-cell other-month"></div>';
  for (var day = 1; day <= lastDay.getDate(); day++) {
    var mm = String(window[monthKey]).padStart(2, '0');
    var dd = String(day).padStart(2, '0');
    var md = mm + '-' + dd;
    var hasMatch = availableDates.indexOf(md) >= 0;
    var isActive = md === currentDate;
    var isToday = md === todayDate;
    var cls = 'date-picker-cell';
    if (hasMatch) cls += ' has-match';
    if (isActive) cls += ' active';
    if (isToday) cls += ' today';
    // 所有日期均可点击，无数据的日期由后端返回空列表+页面提示"暂无方案"
    var onclick = ' onclick="' + onSelect + '(\'' + md + '\')"';
    html += '<div class="' + cls + '"' + onclick + '>' + day + '</div>';
  }
  grid.innerHTML = html;

  document.getElementById(prefix + 'Prev').onclick = function () { window[monthKey]--; if (window[monthKey] < 1) { window[yearKey]--; window[monthKey] = 12; } renderMonthCalendar(prefix, availableDates, currentDate, todayDate, onSelect); };
  document.getElementById(prefix + 'Next').onclick = function () { window[monthKey]++; if (window[monthKey] > 12) { window[yearKey]++; window[monthKey] = 1; } renderMonthCalendar(prefix, availableDates, currentDate, todayDate, onSelect); };
}

// ── 今日方案日历 ──
export function togglePlanDatePicker() {
  var el = document.getElementById('planDatePicker');
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  var weeks = state.weekDates || [];
  var available = weeks.map(function(w) { return w.matchDate; });
  var today = formatDate(new Date()).slice(5);
  // 从实际 planDate 提取 MM-DD
  var current = state.planDate ? state.planDate.slice(5) : today;
  renderMonthCalendar('planDate', available, current, today, 'selectPlanDateFromPicker');
  el.style.display = 'block';
}
export function selectPlanDateFromPicker(md) {
  // 使用日历控件当前年份，而非 planDate 的年份（修复跨年导航bug）
  var year = window.planDateYear || new Date().getFullYear();
  var parts = md.split('-');
  var month = parseInt(parts[0], 10), day = parseInt(parts[1], 10);
  var fullDate = year + '-' + md;
  state.setPlanDate(fullDate);
  // 标记为日历直接选日，不污染 planDateOffset（避免影响左右箭头切换）
  state.setPlanDateExplicit(true);
  // 直接更新DOM，不调updatePlanDateBar避免重置
  var el = document.getElementById('planDateCurrent');
  if (el) {
    var mmdd = md.replace('-', '/');
    var week = WEEK_NAMES[new Date(year, month - 1, day).getDay()];
    el.textContent = mmdd + ' ' + week;
  }
  _mod('plans').then(function (m) {
    if (state.planTab === 'expert') m.loadPlanList();
    else if (state.planTab === 'quant') m.loadQuantPlanList();
    else m.loadScorePlanList();
  });
  document.getElementById('planDatePicker').style.display = 'none';
}

// ── 排行榜日历 ──
export function toggleRankDatePicker() {
  var el = document.getElementById('rankDatePicker');
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  var weeks = state.weekDates || [];
  var available = weeks.map(function(w) { return w.matchDate; });
  var today = formatDate(new Date()).slice(5);
  var current = state.rankDate ? state.rankDate.slice(5) : today;
  renderMonthCalendar('rankDate', available, current, today, 'selectRankDateFromPicker');
  el.style.display = 'block';
}
export function selectRankDateFromPicker(md) {
  // 使用日历控件当前年份，而非 rankDate 的年份（修复跨年导航bug）
  var year = window.rankDateYear || new Date().getFullYear();
  state.setRankDate(year + '-' + md);
  var el = document.getElementById('rankDateCurrent');
  if (el) {
    var mmdd = md.replace('-', '/');
    var week = WEEK_NAMES[new Date(year, parseInt(md.slice(0,2), 10) - 1, parseInt(md.slice(3), 10)).getDay()];
    el.textContent = mmdd + ' ' + week;
  }
  _mod('ranking').then(function (m) { m.loadRanking(); });
  document.getElementById('rankDatePicker').style.display = 'none';
}

export function goToday() {
  var today = formatDate(new Date()).slice(5);
  var now = new Date();
  var todayWeek = WEEK_NAMES[now.getDay()];
  var best = 0;
  state.weekDates.forEach(function (w, i) {
    if (w.matchDate === today && w.weekNum === todayWeek) best = i;
  });
  if (!(state.weekDates[best] && state.weekDates[best].matchDate === today && state.weekDates[best].weekNum === todayWeek)) {
    state.weekDates.forEach(function (w, i) { if (w.matchDate <= today) best = i; });
  }
  state.setSelectedWeekIdx(best);
  updateDateBar();
  loadMatchList();
}

export function initWeekDates() {
  // 并行发起 week-dates 和 match-list，减少串行等待时间
  var datesP = api('week-dates', {}).catch(function () { return []; });
  var matchP = api('match-list', { date: formatDate(new Date()) }).catch(function () { return []; });
  Promise.all([datesP, matchP]).then(function (r) {
    var list = r[0] || [], matches = r[1] || [];
    state.setWeekDates(list.length ? list : []);
    if (state.weekDates.length) {
      var today = formatDate(new Date()).slice(5);
      state.setSelectedWeekIdx(0);
      state.weekDates.forEach(function (w, i) { if (w.matchDate <= today) state.setSelectedWeekIdx(i); });
    } else {
      state.setWeekDates([{ weekNum: WEEK_NAMES[new Date().getDay()], matchDate: formatDate(new Date()).slice(5) }]);
    }
    updateDateBar();
    loadMatchListFromData(matches);
  }).catch(function () {
    state.setWeekDates([{ weekNum: WEEK_NAMES[new Date().getDay()], matchDate: formatDate(new Date()).slice(5) }]);
    state.setSelectedWeekIdx(0);
    updateDateBar();
    loadMatchList();
  });
}

// ── 页面容器按需创建 ──
function _ensurePage(id) {
  var el = document.getElementById('page-' + id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'page';
    el.id = 'page-' + id;
    document.body.insertBefore(el, document.querySelector('.tabbar'));
    // 为特定页面初始化子结构
    if (id === 'match') el.innerHTML = '<div class="date-bar" id="dateBar"><span class="date-arrow" onclick="shiftWeek(-1)"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span><span class="date-current" id="dateCurrent" onclick="toggleDatePicker()"></span><span class="date-arrow" onclick="shiftWeek(1)"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span></div><div class="date-picker" id="datePicker" style="display:none"><div class="date-picker-header"><button class="date-picker-nav" id="datePickerPrev">&lt;</button><span class="date-picker-month" id="datePickerMonth"></span><button class="date-picker-nav" id="datePickerNext">&gt;</button></div><div class="date-picker-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="date-picker-grid" id="datePickerGrid"></div><div class="date-picker-footer"><button class="date-picker-today" onclick="selectDateFromPicker(\'today\')">今天</button><button class="date-picker-close" onclick="toggleDatePicker()">✕</button></div></div><div id="matchList"></div><div class="quant-pk-bar" id="matchPkBar" style="display:none"><button class="pk-bar-btn" id="mpkBarBtn" onclick="startMatchPK()">场次PK（已选 <b id="mpkBarCount">0</b> 场）</button></div>';
    else if (id === 'plan') el.innerHTML = '<div class="filter-row" id="planTabBar"><div class="filter-tag active" data-tab="expert" onclick="switchPlanTab(\'expert\')">专家方案</div><div class="filter-tag" data-tab="score" onclick="switchPlanTab(\'score\')">比分方案</div><div class="filter-tag" data-tab="quant" onclick="switchPlanTab(\'quant\')">量化方案</div></div><div class="date-bar" id="planDateBar"><span class="date-arrow" onclick="shiftPlanDate(-1)"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span><span class="date-current" id="planDateCurrent" onclick="togglePlanDatePicker()"></span><span class="date-arrow" onclick="shiftPlanDate(1)"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span></div><div class="date-picker" id="planDatePicker" style="display:none"><div class="date-picker-header"><button class="date-picker-nav" id="planDatePrev">&lt;</button><span class="date-picker-month" id="planDateMonth"></span><button class="date-picker-nav" id="planDateNext">&gt;</button></div><div class="date-picker-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="date-picker-grid" id="planDateGrid"></div></div><div id="planList"></div>';
    else if (id === 'detail') el.innerHTML = '<div id="detailContent"></div>';
    else if (id === 'rank') el.innerHTML = '<div class="filter-row" id="catFilterBar"></div><div class="filter-row" id="subFilterBar" style="display:none;padding-top:0;"></div><div class="date-bar" id="rankDateBar"><span class="date-arrow" onclick="shiftRankDate(-1)"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span><span class="date-current" id="rankDateCurrent" onclick="toggleRankDatePicker()"></span><span class="date-arrow" onclick="shiftRankDate(1)"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span></div><div class="date-picker" id="rankDatePicker" style="display:none"><div class="date-picker-header"><button class="date-picker-nav" id="rankDatePrev">&lt;</button><span class="date-picker-month" id="rankDateMonth"></span><button class="date-picker-nav" id="rankDateNext">&gt;</button></div><div class="date-picker-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="date-picker-grid" id="rankDateGrid"></div></div><div class="rank-list" id="rankList"></div>';
    else if (id === 'quant-rank') el.innerHTML = '<div class="filter-row" id="quantFilterBar"><div class="filter-tag active" data-tab="power" onclick="switchQuantTab(\'power\')">实力排行榜</div><div class="filter-tag" data-tab="goal" onclick="switchQuantTab(\'goal\')">进球排行榜</div><div class="filter-tag" data-tab="hot" onclick="switchQuantTab(\'hot\')">热点排行榜</div></div><div class="date-bar" id="quantDateBar"><span class="date-arrow" onclick="shiftQuantDate(-1)"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span><span class="date-current" id="quantDateCurrent" onclick="toggleQuantDatePicker()"></span><span class="date-arrow" onclick="shiftQuantDate(1)"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span></div><div class="quant-table-wrap" id="quantTableWrap"></div><div class="quant-chart-wrap" id="quantChartWrap" style="display:none"><div class="quant-chart-inner" id="quantChart"></div></div><div class="quant-view-toggle" id="quantViewToggle" style="display:none"><button class="qt-view-btn active" data-view="table" onclick="switchQuantView(\'table\')">📋 表格</button><button class="qt-view-btn" data-view="chart" onclick="switchQuantView(\'chart\')">📊 图表</button></div><div class="quant-pk-bar" id="quantPkBar" style="display:none"><span class="pk-bar-hint" id="pkBarHint" style="display:none">已选 <b id="pkSelectCount">0</b> 场</span><button class="pk-bar-btn" id="pkBarBtn" onclick="startPK()">场次PK（已选 <b id="pkBarCount">0</b> 场）</button></div>';
    else if (id === 'hit') el.innerHTML = '<div id="hitContent"></div>';
    else if (id === 'filter') el.innerHTML = '<div class="filter-stats-card"><div class="stats-subtitle">数据概览</div><div class="filter-stats-row"><div class="filter-stat-item"><div class="filter-stat-value" id="statMatches">-</div><div class="filter-stat-label">比赛场次</div></div><div class="filter-stat-divider"></div><div class="filter-stat-item"><div class="filter-stat-value" id="statLeagues">-</div><div class="filter-stat-label">联赛数</div></div><div class="filter-stat-divider"></div><div class="filter-stat-item"><div class="filter-stat-value" id="statDirs">-</div><div class="filter-stat-label">方向数</div></div></div></div><div class="filter-section-card"><div class="filter-head">筛选条件</div><div class="filter-row"><span class="filter-label">联赛</span><div class="filter-dd" id="dd-league" data-val=""><div class="filter-dd-trigger" onclick="toggleDD(\'dd-league\', event)"><span class="filter-dd-text">全部</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"></ul></div></div><div class="filter-row"><span class="filter-label">时间</span><div class="filter-dd" id="dd-time" data-val="all"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-time\', event)"><span class="filter-dd-text">全部时间</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"><li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-time\',\'all\',\'全部时间\')">全部时间</li><li data-val="30" class="filter-dd-option" onclick="selectDD(\'dd-time\',\'30\',\'近30天\')">近30天</li><li data-val="60" class="filter-dd-option" onclick="selectDD(\'dd-time\',\'60\',\'近60天\')">近60天</li><li data-val="90" class="filter-dd-option" onclick="selectDD(\'dd-time\',\'90\',\'近90天\')">近90天</li></ul></div></div><div class="filter-row"><span class="filter-label">方向</span><div class="filter-row-inline"><div class="filter-dd" id="dd-dirType" data-val=""><div class="filter-dd-trigger" onclick="toggleDD(\'dd-dirType\', event)"><span class="filter-dd-text">全部</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"><li data-val="" class="filter-dd-option selected" onclick="selectDD(\'dd-dirType\',\'\',\'全部\');onDDTypeChange()">全部</li><li data-val="胜平负" class="filter-dd-option" onclick="selectDD(\'dd-dirType\',\'胜平负\',\'胜平负\');onDDTypeChange()">胜平负</li><li data-val="让球" class="filter-dd-option" onclick="selectDD(\'dd-dirType\',\'让球\',\'让球\');onDDTypeChange()">让球</li><li data-val="进球数" class="filter-dd-option" onclick="selectDD(\'dd-dirType\',\'进球数\',\'进球数\');onDDTypeChange()">进球数</li><li data-val="双选" class="filter-dd-option" onclick="selectDD(\'dd-dirType\',\'双选\',\'双选\');onDDTypeChange()">双选</li><li data-val="半全场" class="filter-dd-option" onclick="selectDD(\'dd-dirType\',\'半全场\',\'半全场\');onDDTypeChange()">半全场</li></ul></div><div class="filter-dd" id="dd-dir" data-val="" style="display:none"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-dir\', event)"><span class="filter-dd-text">全部</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"></ul></div></div></div><div class="filter-row"><span class="filter-label">排名</span><div class="filter-row-inline"><div class="filter-dd" id="dd-rankType" data-val="全部"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-rankType\', event)"><span class="filter-dd-text">全部</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"><li data-val="全部" class="filter-dd-option selected" onclick="selectDD(\'dd-rankType\',\'全部\',\'全部\');onRankTypeChange()">全部</li><li data-val="每天" class="filter-dd-option" onclick="selectDD(\'dd-rankType\',\'每天\',\'每天\');onRankTypeChange()">每天</li><li data-val="每场" class="filter-dd-option" onclick="selectDD(\'dd-rankType\',\'每场\',\'当天所有场次\');onRankTypeChange()">当天所有场次</li></ul></div><div class="filter-dd" id="dd-rank" data-val="0" style="display:none"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-rank\', event)"><span class="filter-dd-text">全部</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"><li data-val="0" class="filter-dd-option selected" onclick="selectDD(\'dd-rank\',\'0\',\'全部\')">全部</li><li data-val="1" class="filter-dd-option" onclick="selectDD(\'dd-rank\',\'1\',\'第一名\')">第一名</li><li data-val="2" class="filter-dd-option" onclick="selectDD(\'dd-rank\',\'2\',\'前二名\')">前二名</li><li data-val="3" class="filter-dd-option" onclick="selectDD(\'dd-rank\',\'3\',\'前三名\')">前三名</li><li data-val="4" class="filter-dd-option" onclick="selectDD(\'dd-rank\',\'4\',\'前四名\')">前四名</li><li data-val="5" class="filter-dd-option" onclick="selectDD(\'dd-rank\',\'5\',\'前五名\')">前五名</li><li data-val="6" class="filter-dd-option" onclick="selectDD(\'dd-rank\',\'6\',\'前六名\')">前六名</li></ul></div></div></div><div class="filter-btn-wrap"><button class="filter-submit-btn" onclick="doFilterQuery()">查询</button></div></div><div id="filterResult"></div>';
    else if (id === 'income') el.innerHTML = '<div class="filter-section-card"><div class="filter-head">筛选条件</div><div class="filter-row"><span class="filter-label">方向</span><div class="filter-dd" id="dd-incDir" data-val="expert"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-incDir\', event)"><span class="filter-dd-text">专家博热方案</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"><li data-val="all" class="filter-dd-option" onclick="selectDD(\'dd-incDir\',\'all\',\'全部\')">全部</li><li data-val="expert" class="filter-dd-option selected" onclick="selectDD(\'dd-incDir\',\'expert\',\'专家博热方案\')">专家博热方案</li><li data-val="score" class="filter-dd-option" onclick="selectDD(\'dd-incDir\',\'score\',\'单场比分方案\')">单场比分方案</li><li data-val="quant" class="filter-dd-option" onclick="selectDD(\'dd-incDir\',\'quant\',\'量化博冷方案\')">量化博冷方案</li></ul></div></div><div class="filter-row"><span class="filter-label">时间</span><div class="filter-dd" id="dd-incTime" data-val="all"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-incTime\', event)"><span class="filter-dd-text">全部时间</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"><li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-incTime\',\'all\',\'全部时间\')">全部时间</li><li data-val="30" class="filter-dd-option" onclick="selectDD(\'dd-incTime\',\'30\',\'近30天\')">近30天</li><li data-val="60" class="filter-dd-option" onclick="selectDD(\'dd-incTime\',\'60\',\'近60天\')">近60天</li></ul></div></div><div class="filter-row"><span class="filter-label">方案</span><div class="filter-dd" id="dd-incPlan" data-val="all"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-incPlan\', event)"><span class="filter-dd-text">全部</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"><li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-incPlan\',\'all\',\'全部\')">全部</li></ul></div></div><div class="filter-btn-wrap"><button class="filter-submit-btn" onclick="loadIncome(true)">查询</button></div></div><div class="filter-stats-card inc-stats-card" id="incStatsCard"><div class="stats-subtitle">筛选结果</div><div class="filter-stats-row"><div class="filter-stat-item"><div class="filter-stat-value" id="incTotalPlans">-</div><div class="filter-stat-label">执行方案</div></div><div class="filter-stat-divider"></div><div class="filter-stat-item"><div class="filter-stat-value" id="incWinRate">-</div><div class="filter-stat-label">中奖率</div></div><div class="filter-stat-divider"></div><div class="filter-stat-item"><div class="filter-stat-value" id="incTotalIncome">-</div><div class="filter-stat-label">总盈利(元)</div></div></div></div><div id="incomeResult"></div>';
  }
  return el;
}

// ── 标签切换 ──
export function switchTab(tab) {
  if (state.currentPage === 'home' && tab !== 'home') state.setSavedScrollY(window.scrollY);
  state.setCurrentPage(tab);
  // 记住当前页，刷新后恢复
  try { sessionStorage.setItem('lastPage', tab); } catch(e) {}
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  var pageEl = _ensurePage(tab === 'detail' ? 'detail' : tab);
  pageEl.classList.add('active');
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  var tabEl = document.getElementById('tab-' + (tab === 'detail' ? 'rank' : tab));
  if (tabEl) tabEl.classList.add('active');

  var titles = {
    home: '竞彩推荐监控', match: '今日比赛', plan: '今日方案', detail: '比赛详情',
    'quant-rank': '量化数据排行榜', rank: '推荐排行榜', hit: '命中率统计',
    filter: '命中率筛选', income: '方案收入', backtest: '回测分析'
  };
  var titleEl = document.getElementById('navTitle');
  if (titleEl) titleEl.textContent = titles[tab] || '竞彩推荐监控';
  var backEl = document.getElementById('navBack');
  if (backEl) backEl.style.display = (tab === 'detail' || tab === 'filter') ? 'flex' : 'none';

  if (tab === 'home') {
    var cameBack = state.savedScrollY > 0;
    if (!cameBack) loadHome();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        window.scrollTo(0, state.savedScrollY);
        if (cameBack) state.setSavedScrollY(0);
      });
    });
  }
  if (tab === 'match') {
    if (state.weekDates.length > 0) { updateDateBar(); loadMatchList(); }
    else initWeekDates();
  }
  if (tab === 'plan') { _mod('plans').then(function (m) { m.updatePlanDateBar(); if (state.planTab === 'expert') m.loadPlanList(); else if (state.planTab === 'quant') m.loadQuantPlanList(); else m.loadScorePlanList(); }); }
  if (tab === 'quant-rank') { _mod('quant-rank-fusion').then(function (m) { m.updateQuantDateBar(); m.loadQuantRank(); }); }
  if (tab === 'rank') { _mod('ranking').then(function (m) { m.updateRankDateBar(); m.loadRanking(); }); }
  if (tab === 'hit') { _mod('hit-rate').then(function (m) { m.loadHitRate(); }); }
  if (tab === 'filter') { _mod('filter').then(function (m) { m.loadFilterLeagues(); m.resetFilterResult(); }); }
  if (tab === 'income') { _mod('income').then(function (m) { m.loadIncome(); }); }
  if (tab === 'backtest') { _mod('backtest').then(function (m) { m.loadBacktest(); }); }
}

export function goBack() {
  switchTab(state.lastPage);
  if (state.lastPage === 'home') {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { window.scrollTo(0, state.savedScrollY); });
    });
  }
}

// ── 本地函数注册到 window ──
window.goBack = goBack;
window.goToday = goToday;
window.shiftWeek = shiftWeek;
window.toggleDatePicker = toggleDatePicker;
window.selectDateFromPicker = selectDateFromPicker;
window.togglePlanDatePicker = togglePlanDatePicker;
window.selectPlanDateFromPicker = selectPlanDateFromPicker;
window.toggleRankDatePicker = toggleRankDatePicker;
window.selectRankDateFromPicker = selectRankDateFromPicker;
// 懒加载的 window 代理已在文件顶部定义

// ── 导航栏滚动隐藏 ──
window.addEventListener('scroll', () => {
  var navbar = document.getElementById('navbar');
  var currentScroll = window.scrollY;
  if (currentScroll > 80 && currentScroll > state.lastScrollY_nav) {
    if (navbar) navbar.classList.add('hidden');
  } else {
    if (navbar) navbar.classList.remove('hidden');
  }
  state.setLastScrollYNav(currentScroll);
}, { passive: true });

// ── 下拉菜单全局关闭 ──
document.addEventListener('click', handleDocClose);
document.addEventListener('touchend', function (e) {
  setTimeout(function () { handleDocClose(e); }, 50);
});

// ── 启动：恢复上次页面 ──
(function initPage() {
  var last = null;
  try { last = sessionStorage.getItem('lastPage'); } catch(e) {}
  if (last && last !== 'home' && last !== 'detail') {
    state.setCurrentPage(last);
    switchTabLoad(last);
  } else {
    document.getElementById('page-home').classList.add('active');
    state.setCurrentPage('home');
    loadHome();
    _preloadMods();
  }
})();

// 只加载内容，不切换 DOM（用于初始化）
function switchTabLoad(tab) {
  if (tab === 'match') {
    if (state.weekDates.length > 0) { updateDateBar(); loadMatchList(); }
    else initWeekDates();
  }
  if (tab === 'plan') { _mod('plans').then(function (m) { m.updatePlanDateBar(); if (state.planTab === 'expert') m.loadPlanList(); else if (state.planTab === 'quant') m.loadQuantPlanList(); else m.loadScorePlanList(); }); }
  if (tab === 'quant-rank') { _mod('quant-rank-fusion').then(function (m) { m.updateQuantDateBar(); m.loadQuantRank(); }); }
  if (tab === 'rank') { _mod('ranking').then(function (m) { m.updateRankDateBar(); m.loadRanking(); }); }
  if (tab === 'hit') { _mod('hit-rate').then(function (m) { m.loadHitRate(); }); }
  if (tab === 'filter') { _mod('filter').then(function (m) { m.loadFilterLeagues(); m.resetFilterResult(); }); }
  if (tab === 'income') { _mod('income').then(function (m) { m.loadIncome(); }); }
  if (tab === 'backtest') { _mod('backtest').then(function (m) { m.loadBacktest(); }); }
}

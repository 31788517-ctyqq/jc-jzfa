// ==================== 主入口：路由导航 + 全局状态管理 ====================
import { api } from './api.js';
import { WEEK_NAMES, formatDate } from './utils.js';
import * as state from './state.js';
import { loadHome } from './pages/home.js';
import { loadMatchList } from './pages/match-list.js';
import { goDetail, closeAI, showAIPrediction } from './pages/match-detail.js';
import { loadRanking, selectCategory, selectDirection, updateRankDateBar, shiftRankDate, goRankToday } from './pages/ranking.js';
import { loadHitRate } from './pages/hit-rate.js';
import { loadFilterLeagues, resetFilterResult, toggleDD, selectDD, getDDVal, onDDTypeChange, onRankTypeChange, doFilterQuery, closeAllDD, handleDocClose } from './pages/filter.js';
import { loadIncome } from './pages/income.js';
import { loadPlanList, updatePlanDateBar, shiftPlanDate, goPlanToday } from './pages/plans.js';

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
    var onclick = hasMatch ? (' onclick="selectDateFromPicker(\'' + md + '\')"') : '';
    html += '<div class="' + cls + '"' + onclick + '>' + day + '</div>';
  }
  grid.innerHTML = html;

  document.getElementById('datePickerPrev').onclick = function () { pickerMonth--; if (pickerMonth < 1) { pickerYear--; pickerMonth = 12; } renderDatePicker(); };
  document.getElementById('datePickerNext').onclick = function () { pickerMonth++; if (pickerMonth > 12) { pickerYear++; pickerMonth = 1; } renderDatePicker(); };
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
    var onclick = hasMatch ? (' onclick="' + onSelect + '(\'' + md + '\')"') : '';
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
  renderMonthCalendar('planDate', available, state.planDate.slice(5), today, 'selectPlanDateFromPicker');
  el.style.display = 'block';
}
export function selectPlanDateFromPicker(md) {
  var weeks = state.weekDates || [];
  // check if weekDates has this specific date
  for (var i = 0; i < weeks.length; i++) {
    if (weeks[i].matchDate === md) { state.setSelectedWeekIdx(i); break; }
  }
  // Set plan date to the year of the selected matchDate with correct date
  state.setPlanDate(state.planDate.slice(0,5) + md);
  updatePlanDateBar();
  loadPlanList();
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
  renderMonthCalendar('rankDate', available, state.rankDate.slice(5), today, 'selectRankDateFromPicker');
  el.style.display = 'block';
}
export function selectRankDateFromPicker(md) {
  state.setRankDate(state.rankDate.slice(0,5) + md);
  updateRankDateBar();
  loadRanking();
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
  api('week-dates', {}).then(function (list) {
    state.setWeekDates(list || []);
    if (state.weekDates.length) {
      var today = formatDate(new Date()).slice(5);
      state.setSelectedWeekIdx(0);
      state.weekDates.forEach(function (w, i) { if (w.matchDate <= today) state.setSelectedWeekIdx(i); });
    } else {
      state.setWeekDates([{ weekNum: WEEK_NAMES[new Date().getDay()], matchDate: formatDate(new Date()).slice(5) }]);
    }
    updateDateBar();
    loadMatchList();
  }).catch(function () {
    state.setWeekDates([{ weekNum: WEEK_NAMES[new Date().getDay()], matchDate: formatDate(new Date()).slice(5) }]);
    state.setSelectedWeekIdx(0);
    updateDateBar();
    loadMatchList();
  });
}

// ── 标签切换 ──
export function switchTab(tab) {
  if (state.currentPage === 'home' && tab !== 'home') state.setSavedScrollY(window.scrollY);
  state.setCurrentPage(tab);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  var pageEl = document.getElementById('page-' + (tab === 'detail' ? 'detail' : tab));
  if (pageEl) pageEl.classList.add('active');
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  var tabEl = document.getElementById('tab-' + (tab === 'detail' ? 'rank' : tab));
  if (tabEl) tabEl.classList.add('active');

  var titles = {
    home: '竞彩推荐监控',
    match: '今日比赛',
    plan: '今日方案',
    detail: '比赛详情',
    rank: '推荐排行榜',
    hit: '命中率统计',
    filter: '命中率筛选',
    income: '方案收入'
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
    setTimeout(function () {
      var listEl = document.getElementById('matchList');
      if (listEl && (!listEl.children.length || listEl.children[0].classList.contains('loading-spinner'))) {
        loadMatchList();
      }
    }, 300);
  }
  if (tab === 'plan') { updatePlanDateBar(); loadPlanList(); }
  if (tab === 'rank') { updateRankDateBar(); loadRanking(); }
  if (tab === 'hit') loadHitRate();
  if (tab === 'filter') { loadFilterLeagues(); resetFilterResult(); }
  if (tab === 'income') loadIncome();
}

export function goBack() {
  switchTab(state.lastPage);
  if (state.lastPage === 'home') {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { window.scrollTo(0, state.savedScrollY); });
    });
  }
}

// ── 注册到 window 供 HTML onclick 调用 ──
window.switchTab = switchTab;
window.goBack = goBack;
window.goToday = goToday;
window.shiftWeek = shiftWeek;
window.toggleDatePicker = toggleDatePicker;
window.selectDateFromPicker = selectDateFromPicker;
window.togglePlanDatePicker = togglePlanDatePicker;
window.selectPlanDateFromPicker = selectPlanDateFromPicker;
window.toggleRankDatePicker = toggleRankDatePicker;
window.selectRankDateFromPicker = selectRankDateFromPicker;
window.goDetail = goDetail;
window.closeAI = closeAI;
window.showAIPrediction = showAIPrediction;
window.selectCategory = selectCategory;
window.selectDirection = selectDirection;
window.shiftRankDate = shiftRankDate;
window.goRankToday = goRankToday;
window.doFilterQuery = doFilterQuery;
window.toggleDD = toggleDD;
window.selectDD = selectDD;
window.getDDVal = getDDVal;
window.onDDTypeChange = onDDTypeChange;
window.onRankTypeChange = onRankTypeChange;
window.shiftPlanDate = shiftPlanDate;
window.goPlanToday = goPlanToday;
window.loadIncome = function (f) { loadIncome(f); };

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

// ── 启动 ──
loadHome();

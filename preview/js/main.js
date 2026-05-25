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

function renderDatePicker() {
  var list = document.getElementById('datePickerList');
  if (!list) return;
  var weeks = state.weekDates || [];
  if (weeks.length === 0) { list.innerHTML = '<div style="padding:12px;color:var(--text3);text-align:center">暂无可用日期</div>'; return; }

  // Group by month
  var today = formatDate(new Date()).slice(5);
  var currentDate = state.weekDates[state.selectedWeekIdx] ? state.weekDates[state.selectedWeekIdx].matchDate : '';
  var months = {};
  weeks.forEach(function (w) {
    var md = w.matchDate; // "MM-DD"
    var m = md.slice(0, 2);
    if (!months[m]) months[m] = [];
    months[m].push(w);
  });

  // Sort months descending (newest first)
  var sortedMonths = Object.keys(months).sort().reverse();
  var html = '';
  sortedMonths.forEach(function (m) {
    html += '<div style="font-size:11px;color:var(--text3);margin:10px 0 6px;font-weight:600">' + m + '月</div>';
    html += '<div class="date-picker-list">';
    months[m].forEach(function (w) {
      var dd = w.matchDate.slice(3);
      var isActive = w.matchDate === currentDate;
      var isToday = w.matchDate === today;
      html += '<div class="date-picker-item' + (isActive ? ' active' : '') + (isToday ? ' today' : '') +
        '" onclick="selectDateFromPicker(\'' + w.matchDate + '\')">' + dd + '</div>';
    });
    html += '</div>';
  });
  list.innerHTML = html;
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

// ==================== 主入口：路由导航 + 全局状态管理 ====================
import { api } from './api.js';
import { WEEK_NAMES, formatDate } from './utils.js';
import * as state from './state.js';
import { loadHome } from './pages/home.js';
import { loadMatchList } from './pages/match-list.js';
import { goDetail, closeAI, showAIPrediction } from './pages/match-detail.js';
import {
  loadRanking,
  selectCategory,
  selectDirection,
  updateRankDateBar,
  shiftRankDate,
  goRankToday,
} from './pages/ranking.js';
import { loadHitRate } from './pages/hit-rate.js';
import {
  loadFilterLeagues,
  resetFilterResult,
  toggleDD,
  selectDD,
  getDDVal,
  onDDTypeChange,
  onRankTypeChange,
  doFilterQuery,
  closeAllDD,
  handleDocClose,
} from './pages/filter.js';
import { loadIncome } from './pages/income.js';
import { loadPlanList, updatePlanDateBar, shiftPlanDate, goPlanToday } from './pages/plans.js';
import { showGongshoudao } from './pages/gongshoudao.js?v=25052903';
import {
  loadQuantRank,
  updateQuantDateBar,
  shiftQuantDate,
  goQuantToday,
  toggleQuantDatePicker,
  switchQuantTab,
  switchQuantOpportunity,
  togglePick,
  startPK,
  sortBy,
  switchQuantView,
} from './pages/quant-rank.js?v=202606131900';
import { openPK, closePK, openPKMulti } from './pages/match-pk-fusion.js?v=85';

// ── 日期切换 ──
export function updateDateBar() {
  const el = document.getElementById('dateCurrent');
  if (!el) return;
  const w = state.weekDates[state.selectedWeekIdx];
  if (w) {
    const today = formatDate(new Date()).slice(5);
    const prefix = w.matchDate === today ? '今天 ' : '';
    el.textContent = prefix + w.matchDate.replace('-', '/') + ' ' + w.weekNum;
  } else {
    el.textContent = '加载中...';
  }
}

export function shiftWeek(delta) {
  const newIdx = state.selectedWeekIdx + delta;
  if (newIdx < 0 || newIdx >= state.weekDates.length) return;
  state.setSelectedWeekIdx(newIdx);
  updateDateBar();
  loadMatchList();
}

// ── 日历选择器 ──
export function toggleDatePicker() {
  const el = document.getElementById('datePicker');
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  if (isOpen) {
    el.style.display = 'none';
    return;
  }
  renderDatePicker();
  el.style.display = 'block';
}

let pickerYear, pickerMonth;

function renderDatePicker() {
  const grid = document.getElementById('datePickerGrid');
  const monthEl = document.getElementById('datePickerMonth');
  if (!grid || !monthEl) return;

  const weeks = state.weekDates || [];
  const available = {};
  weeks.forEach(function (w) {
    available[w.matchDate] = true;
  });

  const today = formatDate(new Date()).slice(5);
  const current = weeks[state.selectedWeekIdx] ? weeks[state.selectedWeekIdx].matchDate : '';

  if (!pickerYear) {
    const d = new Date();
    pickerYear = d.getFullYear();
    pickerMonth = d.getMonth() + 1;
    if (current) pickerMonth = parseInt(current.slice(0, 2), 10);
  }
  window.datePickerYear = pickerYear;

  const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  monthEl.textContent = CN[pickerMonth - 1] + '月 ' + pickerYear;

  const firstDay = new Date(pickerYear, pickerMonth - 1, 1);
  const lastDay = new Date(pickerYear, pickerMonth, 0);
  const daysInMonth = lastDay.getDate();
  const startDow = firstDay.getDay();

  let html = '';
  for (let i = 0; i < startDow; i++) html += '<div class="date-picker-cell other-month"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const mm = String(pickerMonth).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const md = mm + '-' + dd;
    const hasMatch = !!available[md];
    const isActive = md === current;
    const isToday = md === today;
    let cls = 'date-picker-cell';
    if (hasMatch) cls += ' has-match';
    if (isActive) cls += ' active';
    if (isToday) cls += ' today';
    const onclick = ' onclick="selectDateFromPicker(\'' + md + '\')"';
    html += '<div class="' + cls + '"' + onclick + '>' + day + '</div>';
  }
  grid.innerHTML = html;

  document.getElementById('datePickerPrev').onclick = function () {
    pickerMonth--;
    if (pickerMonth < 1) {
      pickerYear--;
      pickerMonth = 12;
    }
    window.datePickerYear = pickerYear;
    renderDatePicker();
  };
  document.getElementById('datePickerNext').onclick = function () {
    pickerMonth++;
    if (pickerMonth > 12) {
      pickerYear++;
      pickerMonth = 1;
    }
    window.datePickerYear = pickerYear;
    renderDatePicker();
  };
}

export function selectDateFromPicker(matchDate) {
  const weeks = state.weekDates || [];
  if (matchDate === 'today') {
    const today = formatDate(new Date()).slice(5);
    for (var i = 0; i < weeks.length; i++) {
      if (weeks[i].matchDate === today) {
        state.setSelectedWeekIdx(i);
        break;
      }
    }
  } else {
    for (var i = 0; i < weeks.length; i++) {
      if (weeks[i].matchDate === matchDate) {
        state.setSelectedWeekIdx(i);
        break;
      }
    }
  }
  updateDateBar();
  loadMatchList();
  const el = document.getElementById('datePicker');
  if (el) el.style.display = 'none';
}

// ── 通用日历渲染 ──
function dobj(dateStr) {
  const p = dateStr.split('-');
  return { y: parseInt(p[0], 10), m: parseInt(p[1], 10), d: parseInt(p[2], 10) };
}

function renderMonthCalendar(prefix, availableDates, currentDate, todayDate, onSelect) {
  const grid = document.getElementById(prefix + 'Grid');
  const monthEl = document.getElementById(prefix + 'Month');
  if (!grid || !monthEl) return;

  const yearKey = prefix + 'Year',
    monthKey = prefix + 'MonthIdx';
  if (typeof window[yearKey] === 'undefined') {
    const d = new Date();
    window[yearKey] = d.getFullYear();
    window[monthKey] = d.getMonth() + 1;
    if (currentDate) window[monthKey] = parseInt(currentDate.slice(0, 2), 10);
  }

  const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  monthEl.textContent = CN[window[monthKey] - 1] + '月 ' + window[yearKey];

  const firstDay = new Date(window[yearKey], window[monthKey] - 1, 1);
  const lastDay = new Date(window[yearKey], window[monthKey], 0);
  const startDow = firstDay.getDay();

  let html = '';
  for (let i = 0; i < startDow; i++) html += '<div class="date-picker-cell other-month"></div>';
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const mm = String(window[monthKey]).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const md = mm + '-' + dd;
    const hasMatch = availableDates.indexOf(md) >= 0;
    const isActive = md === currentDate;
    const isToday = md === todayDate;
    let cls = 'date-picker-cell';
    if (hasMatch) cls += ' has-match';
    if (isActive) cls += ' active';
    if (isToday) cls += ' today';
    // 所有日期均可点击，无数据的日期由后端返回空列表+页面提示"暂无方案"
    const onclick = ' onclick="' + onSelect + "('" + md + '\')"';
    html += '<div class="' + cls + '"' + onclick + '>' + day + '</div>';
  }
  grid.innerHTML = html;

  document.getElementById(prefix + 'Prev').onclick = function () {
    window[monthKey]--;
    if (window[monthKey] < 1) {
      window[yearKey]--;
      window[monthKey] = 12;
    }
    renderMonthCalendar(prefix, availableDates, currentDate, todayDate, onSelect);
  };
  document.getElementById(prefix + 'Next').onclick = function () {
    window[monthKey]++;
    if (window[monthKey] > 12) {
      window[yearKey]++;
      window[monthKey] = 1;
    }
    renderMonthCalendar(prefix, availableDates, currentDate, todayDate, onSelect);
  };
}

// ── 今日方案日历 ──
export function togglePlanDatePicker() {
  const el = document.getElementById('planDatePicker');
  if (!el) return;
  if (el.style.display !== 'none') {
    el.style.display = 'none';
    return;
  }
  const weeks = state.weekDates || [];
  const available = weeks.map(function (w) {
    return w.matchDate;
  });
  const today = formatDate(new Date()).slice(5);
  // 从实际 planDate 提取 MM-DD
  const current = state.planDate ? state.planDate.slice(5) : today;
  renderMonthCalendar('planDate', available, current, today, 'selectPlanDateFromPicker');
  el.style.display = 'block';
}
export function selectPlanDateFromPicker(md) {
  // 使用日历控件当前年份，而非 planDate 的年份（修复跨年导航bug）
  const year = window.planDateYear || new Date().getFullYear();
  const parts = md.split('-');
  const month = parseInt(parts[0], 10),
    day = parseInt(parts[1], 10);
  const fullDate = year + '-' + md;
  state.setPlanDate(fullDate);
  // 标记为日历直接选日，不污染 planDateOffset（避免影响左右箭头切换）
  state.setPlanDateExplicit(true);
  // 直接更新DOM，不调updatePlanDateBar避免重置
  const el = document.getElementById('planDateCurrent');
  if (el) {
    const mmdd = md.replace('-', '/');
    const week = WEEK_NAMES[new Date(year, month - 1, day).getDay()];
    el.textContent = mmdd + ' ' + week;
  }
  loadPlanList();
  document.getElementById('planDatePicker').style.display = 'none';
}

// ── 排行榜日历 ──
export function toggleRankDatePicker() {
  const el = document.getElementById('rankDatePicker');
  if (!el) return;
  if (el.style.display !== 'none') {
    el.style.display = 'none';
    return;
  }
  const weeks = state.weekDates || [];
  const available = weeks.map(function (w) {
    return w.matchDate;
  });
  const today = formatDate(new Date()).slice(5);
  const current = state.rankDate ? state.rankDate.slice(5) : today;
  renderMonthCalendar('rankDate', available, current, today, 'selectRankDateFromPicker');
  el.style.display = 'block';
}
export function selectRankDateFromPicker(md) {
  // 使用日历控件当前年份，而非 rankDate 的年份（修复跨年导航bug）
  const year = window.rankDateYear || new Date().getFullYear();
  state.setRankDate(year + '-' + md);
  const el = document.getElementById('rankDateCurrent');
  if (el) {
    const mmdd = md.replace('-', '/');
    const week = WEEK_NAMES[new Date(year, parseInt(md.slice(0, 2), 10) - 1, parseInt(md.slice(3), 10)).getDay()];
    el.textContent = mmdd + ' ' + week;
  }
  loadRanking();
  document.getElementById('rankDatePicker').style.display = 'none';
}

export function goToday() {
  const today = formatDate(new Date()).slice(5);
  const now = new Date();
  const todayWeek = WEEK_NAMES[now.getDay()];
  let best = 0;
  state.weekDates.forEach(function (w, i) {
    if (w.matchDate === today && w.weekNum === todayWeek) best = i;
  });
  if (
    !(state.weekDates[best] && state.weekDates[best].matchDate === today && state.weekDates[best].weekNum === todayWeek)
  ) {
    state.weekDates.forEach(function (w, i) {
      if (w.matchDate <= today) best = i;
    });
  }
  state.setSelectedWeekIdx(best);
  updateDateBar();
  loadMatchList();
}

export function initWeekDates() {
  api('week-dates', {})
    .then(function (list) {
      state.setWeekDates(list || []);
      if (state.weekDates.length) {
        const today = formatDate(new Date()).slice(5);
        state.setSelectedWeekIdx(0);
        state.weekDates.forEach(function (w, i) {
          if (w.matchDate <= today) state.setSelectedWeekIdx(i);
        });
      } else {
        state.setWeekDates([{ weekNum: WEEK_NAMES[new Date().getDay()], matchDate: formatDate(new Date()).slice(5) }]);
      }
      updateDateBar();
      loadMatchList();
    })
    .catch(function () {
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
  // 记住当前页，刷新后恢复
  try {
    sessionStorage.setItem('lastPage', tab);
  } catch (e) {}
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const pageEl = document.getElementById('page-' + (tab === 'detail' ? 'detail' : tab));
  if (pageEl) pageEl.classList.add('active');
  document.querySelectorAll('.tab-item').forEach((t) => t.classList.remove('active'));
  const tabEl = document.getElementById('tab-' + (tab === 'detail' ? 'rank' : tab));
  if (tabEl) tabEl.classList.add('active');

  const titles = {
    home: '竞彩推荐监控',
    match: '今日比赛',
    plan: '今日方案',
    detail: '比赛详情',
    'quant-rank': '量化数据排行榜',
    rank: '今日推荐榜',
    hit: '命中率数据',
    filter: '命中率筛选',
    income: '方案收入',
  };
  const titleEl = document.getElementById('navTitle');
  if (titleEl) titleEl.textContent = titles[tab] || '竞彩推荐监控';
  const backEl = document.getElementById('navBack');
  if (backEl) backEl.style.display = tab === 'detail' || tab === 'filter' ? 'flex' : 'none';

  if (tab === 'home') {
    const cameBack = state.savedScrollY > 0;
    if (!cameBack) loadHome();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        window.scrollTo(0, state.savedScrollY);
        if (cameBack) state.setSavedScrollY(0);
      });
    });
  }
  if (tab === 'match') {
    if (state.weekDates.length > 0) {
      updateDateBar();
      loadMatchList();
    } else initWeekDates();
    setTimeout(function () {
      const listEl = document.getElementById('matchList');
      if (listEl && (!listEl.children.length || listEl.children[0].classList.contains('loading-spinner'))) {
        loadMatchList();
      }
    }, 300);
  }
  if (tab === 'plan') {
    updatePlanDateBar();
    loadPlanList();
  }
  if (tab === 'quant-rank') {
    updateQuantDateBar();
    loadQuantRank();
  }
  if (tab === 'rank') {
    updateRankDateBar();
    loadRanking();
  }
  if (tab === 'hit') loadHitRate();
  if (tab === 'filter') {
    loadFilterLeagues();
    resetFilterResult();
  }
  if (tab === 'income') loadIncome();
}

export function goBack() {
  switchTab(state.lastPage);
  if (state.lastPage === 'home') {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        window.scrollTo(0, state.savedScrollY);
      });
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
window.showGongshoudao = showGongshoudao;
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
window.loadIncome = function (f) {
  loadIncome(f);
};
window.shiftQuantDate = shiftQuantDate;
window.goQuantToday = goQuantToday;
window.toggleQuantDatePicker = toggleQuantDatePicker;
window.switchQuantTab = switchQuantTab;
window.switchQuantOpportunity = switchQuantOpportunity;
window.togglePick = togglePick;
window.startPK = startPK;
window.sortBy = sortBy;
window.switchQuantView = switchQuantView;
window.openPK = openPK;
window.closePK = closePK;
window.openPKMulti = openPKMulti;

// ── 导航栏滚动隐藏 ──
window.addEventListener(
  'scroll',
  () => {
    const navbar = document.getElementById('navbar');
    const currentScroll = window.scrollY;
    if (currentScroll > 80 && currentScroll > state.lastScrollY_nav) {
      if (navbar) navbar.classList.add('hidden');
    } else {
      if (navbar) navbar.classList.remove('hidden');
    }
    state.setLastScrollYNav(currentScroll);
  },
  { passive: true },
);

// ── 下拉菜单全局关闭 ──
document.addEventListener('click', handleDocClose);
document.addEventListener('touchend', function (e) {
  setTimeout(function () {
    handleDocClose(e);
  }, 50);
});

// ── 启动：恢复上次页面（DOM 已由阻塞脚本预设 active，此处只加载数据）───
(function initPage() {
  let last = null;
  try {
    last = sessionStorage.getItem('lastPage');
  } catch (e) {}
  // 如果阻塞脚本已设 active（非 home），直接加载数据；否则初始化 home
  if (last && last !== 'home' && last !== 'detail') {
    state.setCurrentPage(last);
    switchTabLoad(last);
  } else {
    document.getElementById('page-home').classList.add('active');
    state.setCurrentPage('home');
    loadHome();
  }
})();

// 只加载内容，不切换 DOM（用于初始化）
function switchTabLoad(tab) {
  if (tab === 'match') {
    if (state.weekDates.length > 0) {
      updateDateBar();
      loadMatchList();
    } else initWeekDates();
  }
  if (tab === 'plan') {
    updatePlanDateBar();
    loadPlanList();
  }
  if (tab === 'quant-rank') {
    updateQuantDateBar();
    loadQuantRank();
  }
  if (tab === 'rank') {
    updateRankDateBar();
    loadRanking();
  }
  if (tab === 'hit') loadHitRate();
  if (tab === 'filter') {
    loadFilterLeagues();
    resetFilterResult();
  }
  if (tab === 'income') loadIncome();
}

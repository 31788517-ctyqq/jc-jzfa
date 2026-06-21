// ==================== 主入口：路由导航 + 全局状态管理 ====================
console.log('[V7.0-VITE][Phase2] main-fusion.js loaded');
import {
  api,
  WEEK_NAMES,
  formatDate,
  getCache,
  setCache,
  clearAuthAll,
  getAuthSession,
  hasAuthToken,
  setAuthSession,
  hasReferralAccess,
} from './vendor.js';
import * as state from './vendor.js';
import { ICONS } from './vendor.js';
import { loadHome } from './pages/home.js';
import { loadMatchList, loadMatchListFromData, startMatchPK } from './pages/match-list.js';
import { loadCSS } from './vendor.js';
loadCSS('../css/page-modal.css');
// ═══ 模块懒加载 · 双模式兼容 ═══
// ★ P0-2 (Vite build): import.meta.glob → Vite 构建时展开为静态映射，每个页面独立 chunk
// ★ Browser (raw ES module): 动态 import() → HTTP/2 并行加载源文件
//   try-catch 兜底保证两套路径（旧 /js/ + 新 /dist/）同时可用
let pageModules;
try {
  pageModules = import.meta.glob('./pages/*.js');
} catch (e) {
  pageModules = {};
}
function _mod(name) {
  const key = './pages/' + name + '.js';
  const loader = pageModules[key];
  // Vite build path: 静态注册的 chunk
  if (loader) {
    return loader().catch(function (e) {
      console.error('[JS] chunk load fail: ' + name + ' - ' + (e && e.message));
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          loader()
            .then(resolve)
            .catch(function (e2) {
              console.error('[JS] chunk retry fail: ' + name + ' - ' + (e2 && e2.message));
              reject(e2);
            });
        }, 1000);
      });
    });
  }
  // Browser path: 动态 import（兼容旧 /js/ 路径），v 参数绕过 SW 缓存
  return import('./pages/' + name + '.js?v=20260621a').catch(function (e) {
    console.error('[JS] load fail: ' + name + ' - ' + (e && e.message));
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        import('./pages/' + name + '.js?v=20260621a').then(resolve).catch(function (e2) {
          console.error('[JS] retry fail: ' + name + ' - ' + (e2 && e2.message));
          reject(e2);
        });
      }, 1000);
    });
  });
}

// ★ P0: 后台预加载热门 tab 页面 JS chunk + API 数据，消除切换时延迟
var _hotModulesPreloaded = false;
function _preloadHotModules() {
  if (_hotModulesPreloaded) return;
  _hotModulesPreloaded = true;
  var hotModules = ['match-list', 'plans', 'ranking', 'hit-rate', 'filter', 'income'];
  // 立即预加载 JS 模块（不延迟）
  hotModules.forEach(function (name) {
    _mod(name).catch(function () {});
  });
  // ★ P2 tier-1: 同时预取 API 数据（与模块加载并行），tab 切换直接命中缓存
  var today = formatDate(new Date());
  var todayShort = today.slice(5); // MM-DD
  // match-list: 缓存双格式 key
  api('match-list', {})
    .then(function (data) {
      setCache('match-list:' + today, data);
      setCache('match-list:' + todayShort, data);
    })
    .catch(function () {});
  // ranking-list: 默认参数 key
  api('ranking-list', {})
    .then(function (data) {
      setCache('ranking-list:||', data);
    })
    .catch(function () {});
}

// 预加载常用模块（在首次渲染后异步加载，不阻塞首页）
// ★ V17 P0优化: 只预加载方案页(底部第5tab最高频)，其余按需懒加载，节省~200KB
// ★ P0加速: 新增 match-detail + ECharts 预加载（比赛详情页打开速度优化）
function _preloadMods() {
  setTimeout(function () {
    _mod('match-list'); // ★ 比赛列表（默认首页 Tab，消除首次切换白屏）
    _mod('plans'); // ★ 方案页（底部第5 tab，最高频入口）
    _mod('match-detail'); // ★ 比赛详情页（列表/排行点击高频入口）
  }, 2000);
  setTimeout(function () {
    // ECharts 延迟加载（避免与模块预加载竞争带宽）
    import('./charts.js').then(function (c) {
      c.loadECharts().catch(function () {});
    });
  }, 4000);
}

// ═══ 懒加载 window 代理 ═══
// 所有 onclick 调用的函数通过代理确保模块已加载
window.goDetail = function (id) {
  _mod('match-detail')
    .then(function (m) {
      m.goDetail(id);
    })
    .catch(function (e) {
      console.error('[JS] goDetail 失败:', e && e.message);
    });
};
window.openAI = function () {
  const args = arguments;
  _mod('match-detail')
    .then(function (m) {
      m.showAIPrediction.apply(null, args);
    })
    .catch(function (e) {
      console.error('[JS] openAI 失败:', e && e.message);
      alert('AI深度解析加载失败，请刷新页面后重试');
    });
};
window.closeAI = function () {
  _mod('match-detail')
    .then(function (m) {
      m.closeAI();
    })
    .catch(function (e) {
      console.error('[JS] closeAI 失败:', e && e.message);
    });
};
window.showAIPrediction = function () {
  const args = arguments;
  _mod('match-detail')
    .then(function (m) {
      m.showAIPrediction.apply(null, args);
    })
    .catch(function (e) {
      console.error('[JS] showAIPrediction 失败:', e && e.message);
      alert('AI深度解析加载失败，请刷新页面后重试');
    });
};
window.showGongshoudao = function () {
  const args = arguments;
  _mod('gongshoudao')
    .then(function (m) {
      m.showGongshoudao.apply(null, args);
    })
    .catch(function (e) {
      console.error('[JS] showGongshoudao 失败:', e && e.message);
      alert('功守道量化数据加载失败，请刷新页面后重试');
    });
};
window.openPK = function () {
  const args = arguments;
  _mod('match-pk-fusion')
    .then(function (m) {
      m.openPK.apply(null, args);
    })
    .catch(function (e) {
      console.error('[JS] openPK 失败:', e && e.message);
    });
};
window.closePK = function () {
  _mod('match-pk-fusion')
    .then(function (m) {
      m.closePK();
    })
    .catch(function (e) {
      console.error('[JS] closePK 失败:', e && e.message);
    });
};
window.openPKMulti = function () {
  const args = arguments;
  _mod('match-pk-fusion')
    .then(function (m) {
      m.openPKMulti.apply(null, args);
    })
    .catch(function (e) {
      console.error('[JS] openPKMulti 失败:', e && e.message);
    });
};
window.toggleDD = function () {
  const args = arguments;
  _mod('filter')
    .then(function (m) {
      m.toggleDD.apply(null, args);
    })
    .catch(function (e) {
      console.error('[JS] toggleDD 失败:', e && e.message);
    });
};
window.selectDD = function () {
  const args = arguments;
  _mod('filter')
    .then(function (m) {
      m.selectDD.apply(null, args);
    })
    .catch(function (e) {
      console.error('[JS] selectDD 失败:', e && e.message);
    });
};
window.getDDVal = function (id) {
  const el = document.getElementById(id);
  return el ? el.getAttribute('data-val') || '' : '';
};
window.onDDTypeChange = function () {
  _mod('filter')
    .then(function (m) {
      m.onDDTypeChange();
    })
    .catch(function (e) {
      console.error('[JS] onDDTypeChange 失败:', e && e.message);
    });
};
window.onRankTypeChange = function () {
  _mod('filter')
    .then(function (m) {
      m.onRankTypeChange();
    })
    .catch(function (e) {
      console.error('[JS] onRankTypeChange 失败:', e && e.message);
    });
};
window.doFilterQuery = function () {
  _mod('filter')
    .then(function (m) {
      m.doFilterQuery();
    })
    .catch(function (e) {
      console.error('[JS] doFilterQuery 失败:', e && e.message);
    });
};
window.loadIncome = function (f) {
  _mod('income')
    .then(function (m) {
      m.loadIncome(f);
    })
    .catch(function (e) {
      console.error('[JS] loadIncome 失败:', e && e.message);
    });
};
window.onIncDirChange = function () {
  const args = arguments;
  _mod('income')
    .then(function (m) {
      if (m.onIncDirChange) m.onIncDirChange.apply(null, args);
    })
    .catch(function (e) {
      console.error('[JS] onIncDirChange 失败:', e && e.message);
    });
};
window.switchPlanTab = function (t) {
  _mod('plans')
    .then(function (m) {
      m.switchPlanTab(t);
    })
    .catch(function (e) {
      console.error('[JS] switchPlanTab 失败:', e && e.message);
    });
};
window.shiftPlanDate = function (d) {
  _mod('plans')
    .then(function (m) {
      m.shiftPlanDate(d);
    })
    .catch(function (e) {
      console.error('[JS] shiftPlanDate 失败:', e && e.message);
    });
};
window.goPlanToday = function () {
  _mod('plans')
    .then(function (m) {
      m.goPlanToday();
    })
    .catch(function (e) {
      console.error('[JS] goPlanToday 失败:', e && e.message);
    });
};
window.switchQuantTab = function (t) {
  _mod('quant-rank-fusion')
    .then(function (m) {
      m.switchQuantTab(t);
    })
    .catch(function (e) {
      console.error('[JS] switchQuantTab 失败:', e && e.message);
    });
};
window.switchQuantOpportunity = function (level) {
  _mod('quant-rank-fusion')
    .then(function (m) {
      m.switchQuantOpportunity(level);
    })
    .catch(function (e) {
      console.error('[JS] switchQuantOpportunity 失败:', e && e.message);
    });
};
window.toggleQuantDatePicker = function () {
  _mod('quant-rank-fusion')
    .then(function (m) {
      m.toggleQuantDatePicker();
    })
    .catch(function (e) {
      console.error('[JS] toggleQuantDatePicker 失败:', e && e.message);
    });
};
window.shiftQuantDate = function (d) {
  _mod('quant-rank-fusion')
    .then(function (m) {
      m.shiftQuantDate(d);
    })
    .catch(function (e) {
      console.error('[JS] shiftQuantDate 失败:', e && e.message);
    });
};
window.goQuantToday = function () {
  _mod('quant-rank-fusion')
    .then(function (m) {
      m.goQuantToday();
    })
    .catch(function (e) {
      console.error('[JS] goQuantToday 失败:', e && e.message);
    });
};
window.togglePick = function (ev, id) {
  _mod('quant-rank-fusion')
    .then(function (m) {
      m.togglePick(ev, id);
    })
    .catch(function (e) {
      console.error('[JS] togglePick 失败:', e && e.message);
    });
};
window.startPK = function () {
  _mod('quant-rank-fusion')
    .then(function (m) {
      m.startPK();
    })
    .catch(function (e) {
      console.error('[JS] startPK 失败:', e && e.message);
    });
};
window.sortBy = function (k) {
  _mod('quant-rank-fusion')
    .then(function (m) {
      m.sortBy(k);
    })
    .catch(function (e) {
      console.error('[JS] sortBy 失败:', e && e.message);
    });
};
window.switchQuantView = function (v) {
  _mod('quant-rank-fusion')
    .then(function (m) {
      m.switchQuantView(v);
    })
    .catch(function (e) {
      console.error('[JS] switchQuantView 失败:', e && e.message);
    });
};
window.startMatchPK = startMatchPK; // 已静态导入
window.handleDocClose = function (e) {
  _mod('filter')
    .then(function (m) {
      m.handleDocClose(e);
    })
    .catch(function (e) {
      console.error('[JS] handleDocClose 失败:', e && e.message);
    });
};
window.selectCategory = function (cat) {
  _mod('ranking')
    .then(function (m) {
      m.selectCategory(cat);
    })
    .catch(function (e) {
      console.error('[JS] selectCategory 失败:', e && e.message);
    });
};
window.selectDirection = function (dir) {
  _mod('ranking')
    .then(function (m) {
      m.selectDirection(dir);
    })
    .catch(function (e) {
      console.error('[JS] selectDirection 失败:', e && e.message);
    });
};
window.shiftRankDate = function (delta) {
  _mod('ranking')
    .then(function (m) {
      m.shiftRankDate(delta);
    })
    .catch(function (e) {
      console.error('[JS] shiftRankDate 失败:', e && e.message);
    });
};
window.goRankToday = function () {
  _mod('ranking')
    .then(function (m) {
      m.goRankToday();
    })
    .catch(function (e) {
      console.error('[JS] goRankToday 失败:', e && e.message);
    });
};

// WebSocket 暂未实现，使用 HTTP 轮询模式

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

function readPendingMatchFocus() {
  try {
    const raw = sessionStorage.getItem('pendingMatchFocus');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function applyPendingMatchWeek() {
  const pending = readPendingMatchFocus();
  if (!pending || !pending.matchDate || !Array.isArray(state.weekDates) || state.weekDates.length === 0) return false;
  for (let i = 0; i < state.weekDates.length; i++) {
    if (state.weekDates[i] && state.weekDates[i].matchDate === pending.matchDate) {
      state.setSelectedWeekIdx(i);
      return true;
    }
  }
  return false;
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
  _mod('plans').then(function (m) {
    if (state.planTab === 'my') m.loadMyPlanList();
    else if (state.planTab === 'ai_tg') m.loadAIPlanList();
    else if (state.planTab === 'wc')
      m.loadPlanList(function (p) {
        const pn = p.planName || '';
        return pn.indexOf('世界杯') === 0;
      });
    else {
      // 默认定位到第一个标签（世界杯）
      state.setPlanTab('wc');
      m.loadPlanList(function (p) {
        const pn = p.planName || '';
        return pn.indexOf('世界杯') === 0;
      });
    }
  });
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
  _mod('ranking').then(function (m) {
    m.loadRanking();
  });
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

function _setBestWeekIndex() {
  var today = formatDate(new Date()).slice(5); // MM-DD
  var todayFull = formatDate(new Date()); // YYYY-MM-DD
  var bestIdx = 0;
  var bestDate = '';

  // 优先选中今天
  for (var i = 0; i < state.weekDates.length; i++) {
    var w = state.weekDates[i];
    if (!w || !w.matchDate) continue;
    if (w.matchDate === today) {
      state.setSelectedWeekIdx(i);
      return;
    }
  }

  // 今天不在列表中：选最近的过去日期（同月优先，避免跨月定位错误）
  // month 格式为 "MM-DD"，取月份前两位比较
  var todayMonth = today.slice(0, 2);
  for (var j = 0; j < state.weekDates.length; j++) {
    var w2 = state.weekDates[j];
    if (!w2 || !w2.matchDate) continue;
    // 只考虑同月或上月最后一天（防止定位到5月初）
    var wMonth = w2.matchDate.slice(0, 2);
    if (w2.matchDate <= today) {
      if (wMonth === todayMonth || (bestDate === '' && wMonth < todayMonth)) {
        bestIdx = j;
        bestDate = w2.matchDate;
      }
    }
  }
  // 如果同月无匹配且全部是未来日期，选第一个
  if (bestDate === '' && state.weekDates.length > 0) {
    bestIdx = 0;
  }
  state.setSelectedWeekIdx(bestIdx);
}

function _cacheMatchListForDates(matches, fallbackDate) {
  if (!Array.isArray(matches) || matches.length === 0) return;
  const raw = matches[0].date || matches[0].matchDate || matches[0].startTime || fallbackDate || '';
  const full = String(raw).match(/\d{4}-\d{2}-\d{2}/);
  const short = String(raw).match(/\d{2}-\d{2}/);
  if (full) {
    setCache('match-list:' + full[0], matches);
    setCache('match-list:' + full[0].slice(5), matches);
  } else if (short) {
    setCache('match-list:' + short[0], matches);
  }
}

export function initWeekDates() {
  const cachedDates = getCache('week-dates');
  if (Array.isArray(cachedDates) && cachedDates.length) {
    state.setWeekDates(cachedDates);
    _setBestWeekIndex();
    applyPendingMatchWeek();
    updateDateBar();
    const selected = state.weekDates[state.selectedWeekIdx];
    const cachedMatches = selected ? getCache('match-list:' + selected.matchDate) : null;
    if (cachedMatches) {
      loadMatchListFromData(cachedMatches);
      return;
    }
    loadMatchList();
    return;
  }

  const todayFull = formatDate(new Date());
  api('week-dates', {})
    .then(function (list) {
      list = list || [];
      if (list.length) setCache('week-dates', list);
      state.setWeekDates(list.length ? list : []);
      if (state.weekDates.length) {
        _setBestWeekIndex();
      } else {
        state.setWeekDates([{ weekNum: WEEK_NAMES[new Date().getDay()], matchDate: todayFull.slice(5) }]);
      }
      applyPendingMatchWeek();
      updateDateBar();
      const selected = state.weekDates[state.selectedWeekIdx];
      const cachedMatches = selected ? getCache('match-list:' + selected.matchDate) : null;
      if (cachedMatches) {
        loadMatchListFromData(cachedMatches);
        return;
      }
      loadMatchList();
    })
    .catch(function () {
      state.setWeekDates([{ weekNum: WEEK_NAMES[new Date().getDay()], matchDate: formatDate(new Date()).slice(5) }]);
      state.setSelectedWeekIdx(0);
      updateDateBar();
      loadMatchList();
    });
}

// ── 页面容器按需创建 ──
function _ensurePage(id) {
  let el = document.getElementById('page-' + id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'page';
    el.id = 'page-' + id;
    document.body.insertBefore(el, document.querySelector('.tabbar'));
    // 为特定页面初始化子结构
    if (id === 'match')
      el.innerHTML =
        '<div class="date-bar" id="dateBar"><span class="date-arrow" onclick="shiftWeek(-1)">'+ICONS.arrowLeft+'</span><span class="date-current" id="dateCurrent" onclick="toggleDatePicker()"></span><span class="date-arrow" onclick="shiftWeek(1)">'+ICONS.arrowRight+'</span></div><div class="date-picker" id="datePicker" style="display:none"><div class="date-picker-header"><button class="date-picker-nav" id="datePickerPrev">&lt;</button><span class="date-picker-month" id="datePickerMonth"></span><button class="date-picker-nav" id="datePickerNext">&gt;</button></div><div class="date-picker-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="date-picker-grid" id="datePickerGrid"></div><div class="date-picker-footer"><button class="date-picker-today" onclick="selectDateFromPicker(\'today\')">今天</button><button class="date-picker-close" onclick="toggleDatePicker()">✕</button></div></div><div id="matchList"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div><div class="skel-bar w40"></div></div></div><div class="quant-pk-bar" id="matchPkBar" style="display:none"><button class="pk-bar-btn" id="mpkBarBtn" onclick="startMatchPK()">场次PK（已选 <b id="mpkBarCount">0</b> 场）</button></div>';
    else if (id === 'plan')
      el.innerHTML =
        '<div class="filter-row" id="planTabBar" style="justify-content:flex-start;gap:6px"><div class="filter-tag" data-tab="wc" onclick="switchPlanTab(\'wc\')" class="filter-tag active">世界杯</div><div class="filter-tag" data-tab="expert" onclick="switchPlanTab(\'expert\')">专家博热方案</div><div class="filter-tag" data-tab="ai_tg" onclick="switchPlanTab(\'ai_tg\')">总进球三向</div><div class="filter-tag" data-tab="my" onclick="switchPlanTab(\'my\')">我的方案</div></div><div class="date-bar" id="planDateBar"><span class="date-arrow" onclick="shiftPlanDate(-1)">'+ICONS.arrowLeft+'</span><span class="date-current" id="planDateCurrent" onclick="togglePlanDatePicker()"></span><span class="date-arrow" onclick="shiftPlanDate(1)">'+ICONS.arrowRight+'</span></div><div class="date-picker" id="planDatePicker" style="display:none"><div class="date-picker-header"><button class="date-picker-nav" id="planDatePrev">&lt;</button><span class="date-picker-month" id="planDateMonth"></span><button class="date-picker-nav" id="planDateNext">&gt;</button></div><div class="date-picker-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="date-picker-grid" id="planDateGrid"></div></div><div id="planList"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div><div class="skel-bar w40"></div></div></div>';
    else if (id === 'detail')
      el.innerHTML =
        '<div class="page-skeleton" id="detailContent"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div><div class="skel-bar w40"></div></div>';
    else if (id === 'rank')
      el.innerHTML =
        '<div class="filter-row" id="catFilterBar"></div><div class="filter-row" id="subFilterBar" style="display:none;padding-top:0;justify-content:flex-start;gap:6px"></div><div class="date-bar" id="rankDateBar"><span class="date-arrow" onclick="shiftRankDate(-1)">'+ICONS.arrowLeft+'</span><span class="date-current" id="rankDateCurrent" onclick="toggleRankDatePicker()"></span><span class="date-arrow" onclick="shiftRankDate(1)">'+ICONS.arrowRight+'</span></div><div class="date-picker" id="rankDatePicker" style="display:none"><div class="date-picker-header"><button class="date-picker-nav" id="rankDatePrev">&lt;</button><span class="date-picker-month" id="rankDateMonth"></span><button class="date-picker-nav" id="rankDateNext">&gt;</button></div><div class="date-picker-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="date-picker-grid" id="rankDateGrid"></div></div><div class="rank-list" id="rankList"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div><div class="skel-bar w40"></div></div></div>';
    else if (id === 'quant-rank')
      el.innerHTML =
        '<div class="filter-row" id="quantFilterBar"><div class="filter-tag active" data-tab="power" onclick="switchQuantTab(\'power\')">实力排行榜</div><div class="filter-tag" data-tab="goal" onclick="switchQuantTab(\'goal\')">进球排行榜</div><div class="filter-tag" data-tab="hot" onclick="switchQuantTab(\'hot\')">热点排行榜</div></div><div class="date-bar" id="quantDateBar"><span class="date-arrow" onclick="shiftQuantDate(-1)">'+ICONS.arrowLeft+'</span><span class="date-current" id="quantDateCurrent" onclick="toggleQuantDatePicker()"></span><span class="date-arrow" onclick="shiftQuantDate(1)">'+ICONS.arrowRight+'</span></div><div class="quant-table-wrap" id="quantTableWrap"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div><div class="skel-bar w40"></div></div></div><div class="quant-chart-wrap" id="quantChartWrap" style="display:none"><div class="quant-chart-inner" id="quantChart"></div></div><div class="quant-view-toggle" id="quantViewToggle" style="display:none"><button class="qt-view-btn active" data-view="table" onclick="switchQuantView(\'table\')">📋 表格</button><button class="qt-view-btn" data-view="chart" onclick="switchQuantView(\'chart\')">📊 图表</button></div><div class="quant-pk-bar" id="quantPkBar" style="display:none"><span class="pk-bar-hint" id="pkBarHint" style="display:none">已选 <b id="pkSelectCount">0</b> 场</span><button class="pk-bar-btn" id="pkBarBtn" onclick="startPK()">场次PK（已选 <b id="pkBarCount">0</b> 场）</button></div>';
    else if (id === 'hit')
      el.innerHTML =
        '<div class="page-skeleton" id="hitContent"><div class="skel-bar"></div><div class="skel-bar w60"></div><div class="skel-bar w80"></div><div class="skel-bar w40"></div></div>';
    else if (id === 'filter')
      el.innerHTML =
        '<div class="filter-stats-card"><div class="stats-subtitle">数据概览</div><div class="filter-stats-row"><div class="filter-stat-item"><div class="filter-stat-value" id="statMatches">-</div><div class="filter-stat-label">比赛场次</div></div><div class="filter-stat-divider"></div><div class="filter-stat-item"><div class="filter-stat-value" id="statLeagues">-</div><div class="filter-stat-label">联赛数</div></div><div class="filter-stat-divider"></div><div class="filter-stat-item"><div class="filter-stat-value" id="statDirs">-</div><div class="filter-stat-label">方向数</div></div></div></div><div class="filter-section-card"><div class="filter-head">筛选条件</div><div class="filter-row"><span class="filter-label">联赛</span><div class="filter-dd" id="dd-league" data-val=""><div class="filter-dd-trigger" onclick="toggleDD(\'dd-league\', event)"><span class="filter-dd-text">全部</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"></ul></div></div><div class="filter-row"><span class="filter-label">时间</span><div class="filter-dd" id="dd-time" data-val="all"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-time\', event)"><span class="filter-dd-text">全部时间</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"><li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-time\',\'all\',\'全部时间\')">全部时间</li><li data-val="30" class="filter-dd-option" onclick="selectDD(\'dd-time\',\'30\',\'近30天\')">近30天</li><li data-val="60" class="filter-dd-option" onclick="selectDD(\'dd-time\',\'60\',\'近60天\')">近60天</li><li data-val="90" class="filter-dd-option" onclick="selectDD(\'dd-time\',\'90\',\'近90天\')">近90天</li></ul></div></div><div class="filter-row"><span class="filter-label">方向</span><div class="filter-row-inline"><div class="filter-dd" id="dd-dirType" data-val=""><div class="filter-dd-trigger" onclick="toggleDD(\'dd-dirType\', event)"><span class="filter-dd-text">全部</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"><li data-val="" class="filter-dd-option selected" onclick="selectDD(\'dd-dirType\',\'\',\'全部\');onDDTypeChange()">全部</li><li data-val="综合排名" class="filter-dd-option" onclick="selectDD(\'dd-dirType\',\'综合排名\',\'综合排名\');onDDTypeChange()">综合排名</li><li data-val="胜平负" class="filter-dd-option" onclick="selectDD(\'dd-dirType\',\'胜平负\',\'胜平负\');onDDTypeChange()">胜平负</li><li data-val="让球" class="filter-dd-option" onclick="selectDD(\'dd-dirType\',\'让球\',\'让球\');onDDTypeChange()">让球</li><li data-val="进球数" class="filter-dd-option" onclick="selectDD(\'dd-dirType\',\'进球数\',\'进球数\');onDDTypeChange()">进球数</li><li data-val="双选" class="filter-dd-option" onclick="selectDD(\'dd-dirType\',\'双选\',\'双选\');onDDTypeChange()">双选</li><li data-val="半全场" class="filter-dd-option" onclick="selectDD(\'dd-dirType\',\'半全场\',\'半全场\');onDDTypeChange()">半全场</li></ul></div><div class="filter-dd" id="dd-dir" data-val="" style="display:none"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-dir\', event)"><span class="filter-dd-text">全部</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"></ul></div></div></div><div class="filter-row"><span class="filter-label">排名</span><div class="filter-row-inline"><div class="filter-dd" id="dd-rankType" data-val="全部"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-rankType\', event)"><span class="filter-dd-text">全部</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"><li data-val="全部" class="filter-dd-option selected" onclick="selectDD(\'dd-rankType\',\'全部\',\'全部\');onRankTypeChange()">全部</li><li data-val="每天" class="filter-dd-option" onclick="selectDD(\'dd-rankType\',\'每天\',\'每天\');onRankTypeChange()">每天</li><li data-val="每场" class="filter-dd-option" onclick="selectDD(\'dd-rankType\',\'每场\',\'当天所有场次\');onRankTypeChange()">当天所有场次</li></ul></div><div class="filter-dd" id="dd-rank" data-val="0" style="display:none"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-rank\', event)"><span class="filter-dd-text">全部</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"><li data-val="0" class="filter-dd-option selected" onclick="selectDD(\'dd-rank\',\'0\',\'全部\')">全部</li><li data-val="1" class="filter-dd-option" onclick="selectDD(\'dd-rank\',\'1\',\'第一名\')">第一名</li><li data-val="2" class="filter-dd-option" onclick="selectDD(\'dd-rank\',\'2\',\'前二名\')">前二名</li><li data-val="3" class="filter-dd-option" onclick="selectDD(\'dd-rank\',\'3\',\'前三名\')">前三名</li><li data-val="4" class="filter-dd-option" onclick="selectDD(\'dd-rank\',\'4\',\'前四名\')">前四名</li><li data-val="5" class="filter-dd-option" onclick="selectDD(\'dd-rank\',\'5\',\'前五名\')">前五名</li><li data-val="6" class="filter-dd-option" onclick="selectDD(\'dd-rank\',\'6\',\'前六名\')">前六名</li></ul></div></div></div><div class="filter-btn-wrap"><button class="filter-submit-btn" onclick="doFilterQuery()">查询</button></div></div><div id="filterResult"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    else if (id === 'income')
      el.innerHTML =
        '<div class="filter-section-card"><div class="filter-head">筛选条件</div><div class="filter-row"><span class="filter-label">方向</span><div class="filter-dd" id="dd-incDir" data-val="expert"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-incDir\', event)"><span class="filter-dd-text">专家博热方案</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"><li data-val="all" class="filter-dd-option" onclick="selectDD(\'dd-incDir\',\'all\',\'全部\');onIncDirChange(\'all\')">全部</li><li data-val="expert" class="filter-dd-option selected" onclick="selectDD(\'dd-incDir\',\'expert\',\'专家博热方案\');onIncDirChange(\'expert\')">专家博热方案</li><li data-val="wc" class="filter-dd-option" onclick="selectDD(\'dd-incDir\',\'wc\',\'世界杯\');onIncDirChange(\'wc\')">世界杯</li><li data-val="ai_tg" class="filter-dd-option" onclick="selectDD(\'dd-incDir\',\'ai_tg\',\'总进球三向\');onIncDirChange(\'ai_tg\')">总进球三向</li><li data-val="my" class="filter-dd-option" onclick="selectDD(\'dd-incDir\',\'my\',\'我的方案\');onIncDirChange(\'my\')">我的方案</li></ul></div></div><div class="filter-row"><span class="filter-label">时间</span><div class="filter-dd" id="dd-incTime" data-val="all"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-incTime\', event)"><span class="filter-dd-text">全部时间</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"><li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-incTime\',\'all\',\'全部时间\')">全部时间</li><li data-val="30" class="filter-dd-option" onclick="selectDD(\'dd-incTime\',\'30\',\'近30天\')">近30天</li><li data-val="60" class="filter-dd-option" onclick="selectDD(\'dd-incTime\',\'60\',\'近60天\')">近60天</li></ul></div></div><div class="filter-row"><span class="filter-label">方案</span><div class="filter-dd" id="dd-incPlan" data-val="all"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-incPlan\', event)"><span class="filter-dd-text">全部</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div><ul class="filter-dd-menu"><li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-incPlan\',\'all\',\'全部\')">全部</li><li data-val="plan_1" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_1\',\'方案一\')">方案一</li><li data-val="plan_2" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_2\',\'方案二\')">方案二</li><li data-val="plan_3" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_3\',\'方案三\')">方案三</li><li data-val="plan_4" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_4\',\'方案四\')">方案四</li><li data-val="plan_5" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_5\',\'方案五\')">方案五</li><li data-val="plan_6" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_6\',\'方案六\')">方案六</li><li data-val="plan_7" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_7\',\'方案七\')">方案七</li></ul></div></div><div class="filter-btn-wrap"><button class="filter-submit-btn" onclick="loadIncome(true)">查询</button></div></div><div class="filter-stats-card inc-stats-card" id="incStatsCard"><div class="stats-subtitle">筛选结果</div><div class="filter-stats-row"><div class="filter-stat-item"><div class="filter-stat-value" id="incTotalPlans">-</div><div class="filter-stat-label">执行方案</div></div><div class="filter-stat-divider"></div><div class="filter-stat-item"><div class="filter-stat-value" id="incWinRate">-</div><div class="filter-stat-label">中奖率</div></div><div class="filter-stat-divider"></div><div class="filter-stat-item"><div class="filter-stat-value" id="incTotalIncome">-</div><div class="filter-stat-label">总盈利(元)</div></div></div></div><div id="incomeResult"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    else if (id === 'scheme')
      el.innerHTML =
        '<div class="scheme-stats-card" id="schemeStats"><div class="scheme-stat-item"><div class="scheme-stat-val">0</div><div class="scheme-stat-lbl">历史方案</div></div><div class="scheme-stat-div"></div><div class="scheme-stat-item"><div class="scheme-stat-val">0</div><div class="scheme-stat-lbl">方案收入(分)</div></div><div class="scheme-stat-div"></div><div class="scheme-stat-item"><div class="scheme-stat-val">0%</div><div class="scheme-stat-lbl">命中率</div></div></div>' +
        '<div class="filter-row" id="schemePlayTabs"><div class="filter-tag active" data-type="mixed" onclick="switchSchemePlay(\'mixed\')">混合过关</div><div class="filter-tag" data-type="spf" onclick="switchSchemePlay(\'spf\')">胜平负</div><div class="filter-tag" data-type="rqspf" onclick="switchSchemePlay(\'rqspf\')">R胜平负</div><div class="filter-tag" data-type="bf" onclick="switchSchemePlay(\'bf\')">比分</div><div class="filter-tag" data-type="jqs" onclick="switchSchemePlay(\'jqs\')">总进球</div><div class="filter-tag" data-type="bqc" onclick="switchSchemePlay(\'bqc\')">半全场</div></div>' +
        '<div id="schemeDateBar" class="date-bar"><span class="date-current">&#x1F4C5; 加载中... <span id="schemeMatchTotal">共0场比赛</span></span></div>' +
        '<div id="schemeMatchList"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div><div class="skel-bar w40"></div></div></div>' +
        '<div class="scheme-summary-bar" id="schemeSummaryBar" style="display:none">' +
        '<div class="ssb-top">' +
        '<div class="ssb-issue"><span>第<span id="ssbIssueNum">--</span>期（仅供参考）</span><i class="ssb-info-icon" title="期号仅供参考">i</i></div>' +
        '</div>' +
        '<div class="ssb-content">' +
        '<div class="ssb-card ssb-selected"><div class="ssb-badge" id="schemeSelCountBadge">0</div><div class="ssb-label">已选</div></div>' +
        '<div class="ssb-card ssb-pass" id="schemePassText" onclick="showPassPopup()">--</div>' +
        '<div class="ssb-card ssb-clear" onclick="clearSchemeSelections()">清空</div>' +
        '<div class="ssb-card ssb-multi" id="ssbMultiCard" onclick="showMultiplierPopup()"><span id="ssbMultiplier">2</span><span class="ssb-multi-label">倍</span></div>' +
        '<div class="ssb-amount"><div class="ssb-amount-row"><span class="ssb-amount-label">投注金额</span><span class="ssb-amount-meta"><span class="ssb-amount-val" id="ssbAmount">0</span><span class="ssb-amount-unit">元</span></span></div><div class="ssb-amount-row"><span class="ssb-amount-label">最高奖金</span><span class="ssb-amount-meta"><span class="ssb-amount-val ssb-amount-big" id="ssbMaxWin">0</span><span class="ssb-amount-unit">元</span></span></div></div>' +
        '<button class="ssb-view-btn" onclick="saveUserPlan()">查看方案</button>' +
        '</div>' +
        '</div>' +
        '<div class="ssb-overlay" id="multiplierOverlay">' +
        '<div class="ssb-modal ssb-multi-modal">' +
        '<div class="ssb-modal-header"><div class="ssb-input-wrap"><input type="text" id="ssbMultiInput" readonly value="2"/><span>倍</span></div><button class="ssb-modal-cancel" onclick="closeMultiplierPopup()">取消</button><button class="ssb-modal-confirm" onclick="confirmMultiplierPopup()">确定</button></div>' +
        '<div class="ssb-quick-row"><button onclick="setMultiQuick(2)">2</button><button onclick="setMultiQuick(5)">5</button><button onclick="setMultiQuick(10)">10</button><button onclick="setMultiQuick(20)">20</button><button onclick="setMultiQuick(50)">50</button></div>' +
        '<div class="ssb-keyboard">' +
        '<button onclick="inputMultiDigit(\'1\')">1</button><button onclick="inputMultiDigit(\'2\')">2</button><button onclick="inputMultiDigit(\'3\')">3</button>' +
        '<button onclick="inputMultiDigit(\'4\')">4</button><button onclick="inputMultiDigit(\'5\')">5</button><button onclick="inputMultiDigit(\'6\')">6</button>' +
        '<button onclick="inputMultiDigit(\'7\')">7</button><button onclick="inputMultiDigit(\'8\')">8</button><button onclick="inputMultiDigit(\'9\')">9</button>' +
        '<button onclick="inputMultiDigit(\'.\')" disabled>.</button><button onclick="inputMultiDigit(\'0\')">0</button><button onclick="backspaceMulti()">⌫</button>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="ssb-overlay" id="passOverlay">' +
        '<div class="ssb-modal ssb-pass-modal">' +
        '<div class="ssb-modal-title">选择过关方式<button class="ssb-modal-close" onclick="closePassPopup()">✕</button></div>' +
        '<div class="ssb-pass-hint" id="passHint">当前：0场，上限：8关</div>' +
        '<div class="ssb-pass-list" id="passList"></div>' +
        '<div class="ssb-modal-footer"><button class="ssb-modal-cancel" onclick="closePassPopup()">取消</button><button class="ssb-modal-confirm" onclick="confirmPassPopup()">确定</button></div>' +
        '</div>' +
        '</div>';
    else if (id === 'login') el.innerHTML = '<div id="loginContent"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    else if (id === 'register')
      el.innerHTML =
        '<div class="page-skeleton" id="registerContent"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div><div class="skel-bar w40"></div></div>';
    else if (id === 'contact-invite') el.innerHTML = '<div id="contactInviteContent"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    else if (id === 'account-security') el.innerHTML = '<div id="accountSecurityContent"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    else if (id === 'profile') el.innerHTML = '<div id="profileContent"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div><div class="skel-bar w40"></div></div></div>';
    else if (id === 'confirm-scheme')
      el.innerHTML =
        '<div id="confirmContent"><div class="loading"><div class="loading-spinner"></div>加载方案中...</div></div>';
    // ★ 蓝图新增页面
    else if (id === 'model-dashboard')
      el.innerHTML =
        '<div class="filter-section-card"><div class="filter-head">筛选条件</div>' +
        '<div class="filter-row"><span class="filter-label">时间</span>' +
        '<div class="filter-dd" id="dd-mdTime" data-val="30"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-mdTime\', event)"><span class="filter-dd-text">近30天</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div>' +
        '<ul class="filter-dd-menu"><li data-val="1" class="filter-dd-option" onclick="selectDD(\'dd-mdTime\',\'1\',\'今天\')">今天</li><li data-val="7" class="filter-dd-option" onclick="selectDD(\'dd-mdTime\',\'7\',\'近7天\')">近7天</li><li data-val="30" class="filter-dd-option selected" onclick="selectDD(\'dd-mdTime\',\'30\',\'近30天\')">近30天</li><li data-val="60" class="filter-dd-option" onclick="selectDD(\'dd-mdTime\',\'60\',\'近60天\')">近60天</li><li data-val="all" class="filter-dd-option" onclick="selectDD(\'dd-mdTime\',\'all\',\'全部\')">全部</li></ul>' +
        '</div></div>' +
        '<div class="filter-row"><span class="filter-label">指标</span>' +
        '<div class="filter-dd" id="dd-mdMetric" data-val="direction"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-mdMetric\', event)"><span class="filter-dd-text">方向命中率</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div>' +
        '<ul class="filter-dd-menu"><li data-val="direction" class="filter-dd-option selected" onclick="selectDD(\'dd-mdMetric\',\'direction\',\'方向命中率\')">方向命中率</li><li data-val="over_under" class="filter-dd-option" onclick="selectDD(\'dd-mdMetric\',\'over_under\',\'大小球命中率\')">大小球命中率</li><li data-val="score" class="filter-dd-option" onclick="selectDD(\'dd-mdMetric\',\'score\',\'比分命中率\')">比分命中率</li><li data-val="all" class="filter-dd-option" onclick="selectDD(\'dd-mdMetric\',\'all\',\'综合\')">综合</li></ul>' +
        '</div></div>' +
        '<div class="filter-btn-wrap"><button class="filter-submit-btn" onclick="window._mdRefresh && window._mdRefresh()">查询</button></div>' +
        '</div>' +
        '<div class="scheme-stats-card" id="mdStatsCard"><div class="scheme-stat-item"><div class="scheme-stat-val" id="mdStatModels">-</div><div class="scheme-stat-lbl">活跃模型</div></div><div class="scheme-stat-div"></div><div class="scheme-stat-item"><div class="scheme-stat-val" id="mdStatTotal">-</div><div class="scheme-stat-lbl">总预测</div></div><div class="scheme-stat-div"></div><div class="scheme-stat-item"><div class="scheme-stat-val" id="mdStatBest">-</div><div class="scheme-stat-lbl">最佳模型</div></div></div>' +
        '<div id="model-dashboard-content"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    else if (id === 'data-health')
      el.innerHTML =
        '<div class="filter-section-card"><div class="filter-head">筛选条件</div>' +
        '<div class="filter-row"><span class="filter-label">时间</span>' +
        '<div class="filter-dd" id="dd-dhTime" data-val="1"><div class="filter-dd-trigger" onclick="toggleDD(\'dd-dhTime\', event)"><span class="filter-dd-text">今天</span><svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></svg></div>' +
        '<ul class="filter-dd-menu"><li data-val="1" class="filter-dd-option selected" onclick="selectDD(\'dd-dhTime\',\'1\',\'今天\')">今天</li><li data-val="7" class="filter-dd-option" onclick="selectDD(\'dd-dhTime\',\'7\',\'近7天\')">近7天</li><li data-val="30" class="filter-dd-option" onclick="selectDD(\'dd-dhTime\',\'30\',\'近30天\')">近30天</li><li data-val="all" class="filter-dd-option" onclick="selectDD(\'dd-dhTime\',\'all\',\'全部\')">全部</li></ul>' +
        '</div></div>' +
        '<div class="filter-btn-wrap"><button class="filter-submit-btn" onclick="window._dhRefresh && window._dhRefresh()">查询</button></div>' +
        '</div>' +
        '<div class="scheme-stats-card" id="dhStatsCard"><div class="scheme-stat-item"><div class="scheme-stat-val" id="dhStatSources">-</div><div class="scheme-stat-lbl">数据源</div></div><div class="scheme-stat-div"></div><div class="scheme-stat-item"><div class="scheme-stat-val" id="dhStatAvgRate">-</div><div class="scheme-stat-lbl">平均成功率</div></div><div class="scheme-stat-div"></div><div class="scheme-stat-item"><div class="scheme-stat-val" id="dhStatAlerts">-</div><div class="scheme-stat-lbl">活跃告警</div></div></div>' +
        '<div id="data-health-content"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    // ★ Phase 4: 支付体系页面容器
    else if (id === 'pricing') el.innerHTML = '<div id="pricingContent"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    else if (id === 'payment') el.innerHTML = '<div id="paymentContent"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    else if (id === 'payment-result') el.innerHTML = '<div id="paymentResultContent"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    else if (id === 'subscription') el.innerHTML = '<div id="subscriptionContent"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    else if (id === 'referral') el.innerHTML = '<div id="referralContent"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    else if (id === 'admin-payments') el.innerHTML = '<div id="adminPaymentsContent"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    else if (id === 'admin-referrals') el.innerHTML = '<div id="adminReferralsContent"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    else if (id === 'admin') el.innerHTML = '<div id="adminContent"><div class="page-skeleton"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div></div></div>';
    // P0-2: 回测分析骨架屏（首次加载时显示）
    else if (id === 'backtest')
      el.innerHTML =
        '<div class="page-skeleton" id="backtestContent"><div class="skel-bar w80"></div><div class="skel-bar w60"></div><div class="skel-bar w100"></div><div class="skel-bar w40"></div></div>';
  }
  return el;
}

// ── 标签切换 ──
export function switchTab(tab) {
  // 重定向：独立 myplan 页面已废弃，统一跳转到今日方案 → 我的方案标签
  if (tab === 'myplan') {
    try {
      sessionStorage.setItem('pendingPlanTab', 'my');
    } catch (e) {}
    switchTab('plan');
    return;
  }

  // ★ 管理后台: 旧入口重定向到统一后台对应 Tab
  if (tab === 'admin-payments' || tab === 'admin-referrals') {
    try {
      sessionStorage.setItem('pendingAdminTab', tab === 'admin-payments' ? 'payments' : 'referrals');
    } catch (e) {}
    switchTab('admin');
    return;
  }

  const publicTabs = new Set(['login', 'register', 'contact-invite', 'pricing', 'profile']);

  if (!publicTabs.has(tab) && !hasAuthToken()) {
    try {
      sessionStorage.setItem('pendingAfterLogin', tab);
    } catch (e) {}
    tab = 'login';
  }

  if (state.currentPage === 'home' && tab !== 'home') state.setSavedScrollY(window.scrollY);
  state.setCurrentPage(tab);
  // 记住当前页，刷新后恢复
  try {
    sessionStorage.setItem('lastPage', tab);
  } catch (e) {}
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const pageEl = _ensurePage(tab === 'detail' ? 'detail' : tab);
  pageEl.classList.add('active');
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
    filter: '推荐方向命中查询',
    income: '方案收入',
    backtest: '回测分析',
    scheme: '方案设计',
    login: '账号登录',
    register: '邀请码注册',
    'contact-invite': '联系客服',
    'account-security': '账号安全',
    profile: '个人中心',

    'confirm-scheme': '确认方案',
    'model-dashboard': '模型表现仪表板',
    'data-health': '数据健康监控',
    pricing: '选择套餐',
    payment: '确认支付',
    'payment-result': '支付结果',
    subscription: '我的订阅',
    referral: '返利中心',
    'admin-payments': '支付管理',
    'admin-referrals': '返利管理',
    admin: '管理后台',
  };
  const titleEl = document.getElementById('navTitle');
  if (titleEl)
    titleEl.textContent = (tab === 'referral' && !hasReferralAccess() ? '邀请中心' : titles[tab]) || '竞彩推荐监控';
  const backEl = document.getElementById('navBack');
  // 底部 Tab 页面隐藏返回键（通过底部 tabbar 导航即可）
  if (backEl)
    backEl.style.display =
      tab !== 'home' &&
      tab !== 'login' &&
      tab !== 'register' &&
      tab !== 'contact-invite' &&
      tab !== 'account-security' &&
      tab !== 'profile' &&
      tab !== 'pricing' &&
      tab !== 'payment-result' &&
      tab !== 'match' &&
      tab !== 'rank' &&
      tab !== 'hit' &&
      tab !== 'plan'
        ? 'flex'
        : 'none';

  // navMyBtn (green)
  const nmb = document.getElementById('navMyBtn');
  const sm = tab === 'match' || tab === 'plan' || tab === 'rank' || tab === 'hit';
  if (nmb) {
    nmb.style.display = sm ? 'flex' : 'none';
    nmb.style.marginLeft = sm ? 'auto' : '0';
  }
  if (backEl) {
    backEl.style.marginLeft = sm ? '8px' : 'auto';
  }

  const navbarEl = document.getElementById('navbar');
  if (navbarEl) {
    navbarEl.classList.toggle('home-mode', tab === 'home');
    navbarEl.style.display =
      tab === 'login' ||
      tab === 'register' ||
      tab === 'contact-invite' ||
      tab === 'account-security' ||
      tab === 'profile' ||
      tab === 'pricing' ||
      tab === 'payment' ||
      tab === 'payment-result' ||
      tab === 'admin' ||
      tab === 'referral' ||
      tab === 'subscription'
        ? 'none'
        : 'flex';
  }

  const tabbarEl = document.querySelector('.tabbar');
  if (tabbarEl)
    tabbarEl.style.display =
      tab === 'login' ||
      tab === 'register' ||
      tab === 'contact-invite' ||
      tab === 'account-security' ||
      tab === 'pricing' ||
      tab === 'payment' ||
      tab === 'payment-result' ||
      tab === 'admin' ||
      tab === 'referral' ||
      tab === 'subscription'
        ? 'none'
        : 'flex';

  if (tab === 'login') {
    _mod('login').then(function (m) {
      m.loadLogin();
    });
    return;
  }
  if (tab === 'register') {
    _mod('register').then(function (m) {
      m.loadRegister();
    });
    return;
  }
  if (tab === 'contact-invite') {
    _mod('contact-invite').then(function (m) {
      m.loadContactInvite();
    });
    return;
  }
  if (tab === 'account-security') {
    _mod('account-security').then(function (m) {
      m.loadAccountSecurity();
    });
    return;
  }
  if (tab === 'profile') {
    _mod('profile').then(function (m) {
      m.loadProfile();
    });
    return;
  }

  if (tab === 'home') {
    const cameBack = state.savedScrollY > 0;
    if (!cameBack) {
      loadHome();
      _preloadHotModules();
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        window.scrollTo(0, state.savedScrollY);
        if (cameBack) state.setSavedScrollY(0);
      });
    });
  }
  if (tab === 'match') {
    if (state.weekDates.length > 0) {
      applyPendingMatchWeek();
      updateDateBar();
      // ★ P1: API 提前发起，与模块加载并行
      var mw = state.weekDates[state.selectedWeekIdx];
      var mParams = { _t: Date.now() };
      if (mw) {
        mParams.weekNum = mw.weekNum;
        mParams.matchDate = mw.matchDate;
      } else {
        mParams.date = formatDate(new Date());
      }
      var matchApiPromise = api('match-list', mParams);
      _mod('match-list').then(function (m) {
        m.loadMatchList(matchApiPromise);
      });
    } else initWeekDates();
  }
  if (tab === 'plan') {
    // 如果从"保存方案"跳转过来，强制切到"我的方案"
    let pendingTab;
    try {
      pendingTab = sessionStorage.getItem('pendingPlanTab');
      sessionStorage.removeItem('pendingPlanTab');
    } catch (e) {}
    if (pendingTab === 'my') {
      state.setPlanTab('my');
      document.querySelectorAll('#planTabBar .filter-tag').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === 'my');
      });
      const myTag = document.querySelector('#planTabBar .filter-tag[data-tab="my"]');
      if (myTag) myTag.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    } else {
      // 首次打开默认定位到第一个标签（世界杯）
      state.setPlanTab('wc');
      document.querySelectorAll('#planTabBar .filter-tag').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === 'wc');
      });
    }
    _mod('plans').then(function (m) {
      m._autoSetBestDate();
      m.updatePlanDateBar();
      if (state.planTab === 'my') m.loadMyPlanList();
      else if (state.planTab === 'ai_tg') m.loadAIPlanList();
      else if (state.planTab === 'wc')
        m.loadPlanList(function (p) {
          var pn = p.planName || '';
          return pn.indexOf('世界杯') === 0;
        });
      else {
        // 默认定位到第一个标签（世界杯）
        state.setPlanTab('wc');
        document.querySelectorAll('#planTabBar .filter-tag').forEach(function (btn) {
          btn.classList.toggle('active', btn.getAttribute('data-tab') === 'wc');
        });
        m.loadPlanList(function (p) {
          var pn = p.planName || '';
          return pn.indexOf('世界杯') === 0;
        });
      }
    });
  }
  if (tab === 'quant-rank') {
    _mod('quant-rank-fusion').then(function (m) {
      m.updateQuantDateBar();
      m.loadQuantRank();
    });
  }
  if (tab === 'rank') {
    // ★ P1: API 提前发起（与模块加载并行）
    var rParams = {};
    if (state.selectedCategory) rParams.category = state.selectedCategory;
    if (state.selectedDirection) rParams.direction = state.selectedDirection;
    if (state.rankDate) rParams.date = state.rankDate;
    var rankApiPromise = api('ranking-list', rParams);
    _mod('ranking').then(function (m) {
      if (typeof m._autoSetRankBestDate === 'function') m._autoSetRankBestDate();
      if (typeof m.updateRankDateBar === 'function') m.updateRankDateBar();
      m.loadRanking(undefined, undefined, rankApiPromise);
    });
  }
  if (tab === 'hit') {
    _mod('hit-rate').then(function (m) {
      m.loadHitRate();
    });
  }
  if (tab === 'filter') {
    _mod('filter').then(function (m) {
      m.loadFilterLeagues().then(function () {
        m.doFilterQuery();
      });
    });
  }
  if (tab === 'income') {
    _mod('income').then(function (m) {
      m.loadIncome();
    });
  }
  if (tab === 'backtest') {
    _mod('backtest').then(function (m) {
      m.loadBacktest();
    });
  }
  if (tab === 'scheme') {
    _mod('scheme-design').then(function (m) {
      m.loadSchemeDesign();
    });
  }
  if (tab === 'confirm-scheme') {
    const backEl2 = document.getElementById('navBack');
    if (backEl2) backEl2.style.display = 'flex';
    _mod('confirm-scheme').then(function (m) {
      m.loadConfirmScheme();
    });
  }
  // ★ 蓝图新增页面
  if (tab === 'model-dashboard') {
    _mod('model-dashboard').then(function (m) {
      m.loadDashboard();
    });
  }
  if (tab === 'data-health') {
    _mod('data-health').then(function (m) {
      m.loadDataHealth();
    });
  }
  // ★ Phase 4 支付体系页面
  if (tab === 'pricing') {
    _mod('pricing').then(function (m) {
      m.loadPricing(document.getElementById('pricingContent'));
    });
  }
  if (tab === 'payment') {
    _mod('payment').then(function (m) {
      m.loadPayment(document.getElementById('paymentContent'), state._paymentData || {});
    });
  }
  if (tab === 'payment-result') {
    _mod('payment-result').then(function (m) {
      m.loadPaymentResult(document.getElementById('paymentResultContent'));
    });
  }
  if (tab === 'subscription') {
    _mod('subscription').then(function (m) {
      m.loadSubscription(document.getElementById('subscriptionContent'));
    });
  }
  if (tab === 'referral') {
    _mod('referral').then(function (m) {
      m.loadReferral(document.getElementById('referralContent'));
    });
  }
  if (tab === 'admin-payments') {
    _mod('admin-payments').then(function (m) {
      m.loadAdminPayments(document.getElementById('adminPaymentsContent'));
    });
  }
  if (tab === 'admin-referrals') {
    _mod('admin-referrals').then(function (m) {
      m.loadAdminReferrals(document.getElementById('adminReferralsContent'));
    });
  }
  if (tab === 'admin') {
    _mod('admin').then(function (m) {
      m.loadAdmin(document.getElementById('adminContent'));
    });
  }

  // ★ Phase3: 切 Tab 时立即预取 API 数据（与模块加载并行）
  //     api() 内置请求去重，模块加载后调用同一 API 时共享已发起的请求
  _prefetchTabData(tab);

  // ★ P1: 首页后异步预取相邻 Tab 数据（方案+命中率），切页直接渲染
  if (tab === 'home') {
    setTimeout(function () {
      const today = formatDate(new Date());
      api('plan-list', { date: today, qualityMode: 'all' }).catch(function () {});
      api('hit-rate-stats', {}).catch(function () {});
    }, 1200);
  }
}

// ★ Phase3: API 数据预取 — 与模块加载并行，api() 去重保证零额外请求
//     注：此函数在 switchTab 和 switchTabLoad 两处共用（只定义一次）
function _prefetchTabData(tab) {
  const today = formatDate(new Date());
  if (tab === 'plan') {
    const pd = state.planDate || today;
    api('plan-list', { date: pd, qualityMode: 'all' }).catch(function () {});
  } else if (tab === 'match') {
    const sel = state.weekDates[state.selectedWeekIdx];
    if (sel && sel.matchDate) {
      api('match-list', { date: sel.matchDate }).catch(function () {});
    }
  } else if (tab === 'rank') {
    api('ranking-list', { date: state.rankDate || today }).catch(function () {});
  } else if (tab === 'hit') {
    api('hit-rate-stats', {}).catch(function () {});
  } else if (tab === 'quant-rank') {
    api('quant-rank', {}).catch(function () {});
  } else if (tab === 'income') {
    api('plan-income', {}).catch(function () {});
  } else if (tab === 'filter') {
    api('filter-leagues', {}).catch(function () {});
  } else if (tab === 'backtest') {
    api('prediction-backtest', {}).catch(function () {});
  }
}

// ★ Phase 4: 页面导航辅助（支持传递参数）
window.navigateTo = function (tab, data) {
  if (data) state.setPaymentData(data);
  switchTab(tab);
};

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

// ── 本地函数注册到 window ──
window.switchTab = switchTab;
window.goBack = goBack;
window._stReal = switchTab;
window._gbReal = goBack;
if (window._stQ && window._stQ.length) {
  const _q = window._stQ;
  window._stQ = [];
  _q.forEach(function (_t) {
    if (_t === '__goBack__') goBack();
    else switchTab(_t);
  });
}
window.goToday = goToday;
window.shiftWeek = shiftWeek;
window.toggleDatePicker = toggleDatePicker;
window.selectDateFromPicker = selectDateFromPicker;
window.togglePlanDatePicker = togglePlanDatePicker;
window.selectPlanDateFromPicker = selectPlanDateFromPicker;

// ★ 懒加载代理：方案设计页玩法切换（确保模块未加载时也能响应点击）
window.switchSchemePlay = function (type) {
  _mod('scheme-design').then(function () {
    window.switchSchemePlay(type);
  });
};
window.toggleRankDatePicker = toggleRankDatePicker;
window.selectRankDateFromPicker = selectRankDateFromPicker;
// 懒加载的 window 代理已在文件顶部定义

// ── hash 路由监听（支持浏览器前进/后退 + 手动改 hash） ──
window.addEventListener('hashchange', function () {
  const h = (window.location.hash || '').replace('#', '').split('?')[0].replace(/^\/+/, '').trim();
  if (h && h !== state.currentPage) switchTab(h);
});

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

window.addEventListener('auth:unauthorized', function () {
  clearAuthAll();
  if (state.currentPage !== 'login') switchTab('login');
});

// ── 方案收入方向切换：动态更新 dd-incPlan 下拉菜单 ──
window.onIncDirChange = function (dir) {
  let incDir = dir || (window.getDDVal ? window.getDDVal('dd-incDir') : 'expert');
  if (incDir !== 'all' && incDir !== 'expert' && incDir !== 'my' && incDir !== 'ai_tg') {
    selectDD('dd-incDir', 'expert', '专家博热方案');
    incDir = 'expert';
  }
  const ddPlan = document.getElementById('dd-incPlan');
  if (!ddPlan) return;
  const menu = ddPlan.querySelector('.filter-dd-menu');
  if (!menu) return;

  // 重置为"全部"选中
  selectDD('dd-incPlan', 'all', '全部');

  if (incDir === 'ai_tg') {
    // 总进球三向：仅显示 A123 / A345
    menu.innerHTML =
      '<li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-incPlan\',\'all\',\'全部\')">全部</li>' +
      '<li data-val="A123" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'A123\',\'方案A123\')">方案A123（1、2、3球）</li>' +
      '<li data-val="A345" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'A345\',\'方案A345\')">方案A345（3、4、5球）</li>';
  } else if (incDir === 'expert' || incDir === 'all') {
    // 专家博热方案 / 全部：仅显示 plan_1 ~ plan_7
    menu.innerHTML =
      '<li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-incPlan\',\'all\',\'全部\')">全部</li>' +
      '<li data-val="plan_1" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_1\',\'方案一\')">方案一</li>' +
      '<li data-val="plan_2" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_2\',\'方案二\')">方案二</li>' +
      '<li data-val="plan_3" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_3\',\'方案三\')">方案三</li>' +
      '<li data-val="plan_4" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_4\',\'方案四\')">方案四</li>' +
      '<li data-val="plan_5" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_5\',\'方案五\')">方案五</li>' +
      '<li data-val="plan_6" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_6\',\'方案六\')">方案六</li>' +
      '<li data-val="plan_7" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_7\',\'方案七\')">方案七</li>';
  } else {
    // 我的方案：全部 + 方案一~七
    menu.innerHTML =
      '<li data-val="all" class="filter-dd-option selected" onclick="selectDD(\'dd-incPlan\',\'all\',\'全部\')">全部</li>' +
      '<li data-val="plan_1" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_1\',\'方案一\')">方案一</li>' +
      '<li data-val="plan_2" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_2\',\'方案二\')">方案二</li>' +
      '<li data-val="plan_3" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_3\',\'方案三\')">方案三</li>' +
      '<li data-val="plan_4" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_4\',\'方案四\')">方案四</li>' +
      '<li data-val="plan_5" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_5\',\'方案五\')">方案五</li>' +
      '<li data-val="plan_6" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_6\',\'方案六\')">方案六</li>' +
      '<li data-val="plan_7" class="filter-dd-option" onclick="selectDD(\'dd-incPlan\',\'plan_7\',\'方案七\')">方案七</li>';
  }
};

// ── 启动：恢复上次页面 ──
(function initPage() {
  // ★ 读取 hash 目标页（如 #admin），优先级高于 sessionStorage
  let hashTab = '';
  try {
    const h = window.location.hash.replace('#', '').split('?')[0].replace(/^\/+/, '').trim();
    if (h && h !== 'home' && h !== 'detail') hashTab = h;
  } catch (e) {}

  function startAuthedPage() {
    let last = null;
    try {
      last = sessionStorage.getItem('lastPage');
    } catch (e) {}
    // hash 目标页优先
    const target = hashTab || last;
    if (target && target !== 'home' && target !== 'detail' && target !== 'login') {
      state.setCurrentPage(target);
      switchTabLoad(target);
      setTimeout(function () {
        _preloadMods();
        _preloadData(target);
      }, 500);
      return;
    }
    document.getElementById('page-home').classList.add('active');
    state.setCurrentPage('home');
    loadHome();
    _preloadMods();
    setTimeout(function () {
      _preloadData('home');
    }, 500);
  }

  if (!hasAuthToken()) {
    // 未登录：公开页允许直接打开，其余页面登录后跳回
    if (
      hashTab === 'login' ||
      hashTab === 'register' ||
      hashTab === 'contact-invite' ||
      hashTab === 'pricing' ||
      hashTab === 'profile'
    ) {
      state.setCurrentPage(hashTab);
      switchTabLoad(hashTab);
      return;
    }
    // ★ 未登录但有指定页面：记住目标页，先显示首页+Tabbar
    if (hashTab) {
      try {
        sessionStorage.setItem('pendingAfterLogin', hashTab);
      } catch (e) {}
    }
    // ★ 修复：未登录默认显示首页+Tabbar，不强制跳转登录
    document.getElementById('page-home').classList.add('active');
    state.setCurrentPage('home');
    loadHome();
    // 显示底部导航
    const tabbarEl2 = document.querySelector('.tabbar');
    if (tabbarEl2) tabbarEl2.style.display = 'flex';
    const navbarEl2 = document.getElementById('navbar');
    if (navbarEl2) {
      navbarEl2.style.display = 'flex';
      navbarEl2.classList.add('home-mode');
    }
    _preloadMods();
    return;
  }

  // ★ P0-4: 已登录 — 立即渲染首页，auth-session 后台异步执行（不再阻塞 FCP）
  startAuthedPage();
  setTimeout(function () {
    if (!hasAuthToken()) return;
    api('auth-session', {}, 0)
      .then(function (session) {
        setAuthSession(session || {});
        try {
          if (typeof window._refreshAuthUI === 'function') window._refreshAuthUI(session);
        } catch (e) {}
      })
      .catch(function () {
        // 静默失败，可能是网络抖动，不清除 token
      });
  }, 100);
})();

// ★ P1: 异步预取数据（提前填充 sessionStorage 缓存）
function _preloadData(current) {
  const preloadMap = {
    match: ['plan', 'quant-rank'],
    plan: ['match', 'quant-rank'],
    'quant-rank': ['match', 'plan'],
    rank: ['match', 'plan'],
    hit: ['match'],
    filter: ['match'],
    income: ['match'],
    home: ['match', 'plan'],
  };
  const tabs = preloadMap[current] || [];
  tabs.forEach(function (tab) {
    if (tab === 'match') {
      if (!getCache('week-dates')) {
        api('week-dates', {})
          .then(function (list) {
            if (Array.isArray(list) && list.length) setCache('week-dates', list);
          })
          .catch(function () {});
      }
    } else if (tab === 'plan') {
      _mod('plans')
        .then(function (m) {
          if (!m.loadPlanList) return;
          if (state.planTab === 'wc')
            m.loadPlanList(function (p) {
              const pn = p.planName || '';
              return pn.indexOf('世界杯') === 0;
            });
          else if (state.planTab === 'ai_tg') m.loadAIPlanList();
          else
            m.loadPlanList(function (p) {
              const pn = p.planName || '';
              return pn.indexOf('方案') === 0 && pn.indexOf('方案A') !== 0;
            });
        })
        .catch(function () {});
    } else if (tab === 'quant-rank') {
      _mod('quant-rank-fusion')
        .then(function (m) {
          if (m.loadQuantRank) m.loadQuantRank();
        })
        .catch(function () {});
    }
  });
}

// 只加载内容，不切换 DOM（用于初始化）
function switchTabLoad(tab) {
  // 确保页面容器存在（页面刷新后 DOM 被销毁）
  const pageEl = _ensurePage(tab);

  // ★ P0 修复：激活页面 DOM（刷新后页面不可见的原因）
  document.querySelectorAll('.page').forEach(function (p) {
    p.classList.remove('active');
  });
  if (pageEl) pageEl.classList.add('active');

  // 更新导航标题
  const titles = {
    home: '竞彩推荐监控',
    match: '今日比赛',
    plan: '今日方案',
    detail: '比赛详情',
    'quant-rank': '量化数据排行榜',
    rank: '今日推荐榜',
    hit: '命中率数据',
    filter: '推荐方向命中查询',
    income: '方案收入',
    backtest: '回测分析',
    scheme: '方案设计',
    login: '账号登录',
    register: '邀请码注册',
    'contact-invite': '联系客服',
    'account-security': '账号安全',
    profile: '个人中心',

    'confirm-scheme': '确认方案',
    'model-dashboard': '模型表现仪表板',
    'data-health': '数据健康监控',
    pricing: '选择套餐',
    payment: '确认支付',
    'payment-result': '支付结果',
    subscription: '我的订阅',
    referral: '返利中心',
    'admin-payments': '支付管理',
    'admin-referrals': '返利管理',
    admin: '管理后台',
  };
  const titleEl = document.getElementById('navTitle');
  if (titleEl)
    titleEl.textContent = (tab === 'referral' && !hasReferralAccess() ? '邀请中心' : titles[tab]) || '竞彩推荐监控';

  // 设置对应 tab-item active
  document.querySelectorAll('.tab-item').forEach(function (t) {
    t.classList.remove('active');
  });
  const tabEl = document.getElementById('tab-' + (tab === 'detail' ? 'rank' : tab));
  if (tabEl) tabEl.classList.add('active');

  // 底部 Tab 页面隐藏返回键
  const backEl = document.getElementById('navBack');
  if (backEl)
    backEl.style.display =
      tab !== 'home' &&
      tab !== 'login' &&
      tab !== 'register' &&
      tab !== 'contact-invite' &&
      tab !== 'account-security' &&
      tab !== 'profile' &&
      tab !== 'pricing' &&
      tab !== 'payment-result' &&
      tab !== 'match' &&
      tab !== 'rank' &&
      tab !== 'hit' &&
      tab !== 'plan'
        ? 'flex'
        : 'none';

  // navMyBtn (green)
  const nmb = document.getElementById('navMyBtn');
  const sm = tab === 'match' || tab === 'plan' || tab === 'rank' || tab === 'hit';
  if (nmb) {
    nmb.style.display = sm ? 'flex' : 'none';
    nmb.style.marginLeft = sm ? 'auto' : '0';
  }
  if (backEl) {
    backEl.style.marginLeft = sm ? '8px' : 'auto';
  }

  const navbarEl = document.getElementById('navbar');
  if (navbarEl)
    navbarEl.style.display =
      tab === 'login' ||
      tab === 'register' ||
      tab === 'contact-invite' ||
      tab === 'account-security' ||
      tab === 'profile' ||
      tab === 'pricing' ||
      tab === 'payment' ||
      tab === 'payment-result' ||
      tab === 'admin' ||
      tab === 'referral' ||
      tab === 'subscription'
        ? 'none'
        : 'flex';

  const tabbarEl = document.querySelector('.tabbar');
  if (tabbarEl)
    tabbarEl.style.display =
      tab === 'login' ||
      tab === 'register' ||
      tab === 'contact-invite' ||
      tab === 'account-security' ||
      tab === 'pricing' ||
      tab === 'payment' ||
      tab === 'payment-result' ||
      tab === 'admin' ||
      tab === 'referral' ||
      tab === 'subscription'
        ? 'none'
        : 'flex';

  if (tab === 'login') {
    _mod('login').then(function (m) {
      m.loadLogin();
    });
    return;
  }
  if (tab === 'register') {
    _mod('register').then(function (m) {
      m.loadRegister();
    });
    return;
  }
  if (tab === 'contact-invite') {
    _mod('contact-invite').then(function (m) {
      m.loadContactInvite();
    });
    return;
  }
  if (tab === 'account-security') {
    _mod('account-security').then(function (m) {
      m.loadAccountSecurity();
    });
    return;
  }
  if (tab === 'profile') {
    _mod('profile').then(function (m) {
      m.loadProfile();
    });
    return;
  }

  if (tab === 'match') {
    if (state.weekDates.length > 0) {
      applyPendingMatchWeek();
      updateDateBar();
      loadMatchList();
    } else initWeekDates();
  }
  if (tab === 'plan') {
    // 如果从"保存方案"跳转过来，强制切到"我的方案"
    let pendingTab;
    try {
      pendingTab = sessionStorage.getItem('pendingPlanTab');
      sessionStorage.removeItem('pendingPlanTab');
    } catch (e) {}
    if (pendingTab === 'my') {
      state.setPlanTab('my');
      document.querySelectorAll('#planTabBar .filter-tag').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === 'my');
      });
      const myTag = document.querySelector('#planTabBar .filter-tag[data-tab="my"]');
      if (myTag) myTag.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    } else {
      // 首次打开默认定位到第一个标签（世界杯）
      state.setPlanTab('wc');
      document.querySelectorAll('#planTabBar .filter-tag').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === 'wc');
      });
    }
    _mod('plans').then(function (m) {
      m._autoSetBestDate();
      m.updatePlanDateBar();
      if (state.planTab === 'my') m.loadMyPlanList();
      else if (state.planTab === 'ai_tg') m.loadAIPlanList();
      else if (state.planTab === 'wc')
        m.loadPlanList(function (p) {
          var pn = p.planName || '';
          return pn.indexOf('世界杯') === 0;
        });
      else {
        // 默认定位到第一个标签（世界杯）
        state.setPlanTab('wc');
        document.querySelectorAll('#planTabBar .filter-tag').forEach(function (btn) {
          btn.classList.toggle('active', btn.getAttribute('data-tab') === 'wc');
        });
        m.loadPlanList(function (p) {
          var pn = p.planName || '';
          return pn.indexOf('世界杯') === 0;
        });
      }
    });
  }
  if (tab === 'quant-rank') {
    _mod('quant-rank-fusion').then(function (m) {
      m.updateQuantDateBar();
      m.loadQuantRank();
    });
  }
  if (tab === 'rank') {
    // ★ P1: API 提前发起（与模块加载并行）
    var rParams = {};
    if (state.selectedCategory) rParams.category = state.selectedCategory;
    if (state.selectedDirection) rParams.direction = state.selectedDirection;
    if (state.rankDate) rParams.date = state.rankDate;
    var rankApiPromise = api('ranking-list', rParams);
    _mod('ranking').then(function (m) {
      if (typeof m._autoSetRankBestDate === 'function') m._autoSetRankBestDate();
      if (typeof m.updateRankDateBar === 'function') m.updateRankDateBar();
      m.loadRanking(undefined, undefined, rankApiPromise);
    });
  }
  if (tab === 'hit') {
    _mod('hit-rate').then(function (m) {
      m.loadHitRate();
    });
  }
  if (tab === 'filter') {
    _mod('filter').then(function (m) {
      m.loadFilterLeagues().then(function () {
        m.doFilterQuery();
      });
    });
  }
  if (tab === 'income') {
    _mod('income').then(function (m) {
      m.loadIncome();
    });
  }
  if (tab === 'backtest') {
    _mod('backtest').then(function (m) {
      m.loadBacktest();
    });
  }
  if (tab === 'scheme') {
    _mod('scheme-design').then(function (m) {
      m.loadSchemeDesign();
    });
  }
  if (tab === 'confirm-scheme') {
    const backEl2 = document.getElementById('navBack');
    if (backEl2) backEl2.style.display = 'flex';
    _mod('confirm-scheme').then(function (m) {
      m.loadConfirmScheme();
    });
  }
  // ★ 蓝图新增页面
  if (tab === 'model-dashboard') {
    _mod('model-dashboard').then(function (m) {
      m.loadDashboard();
    });
  }
  if (tab === 'data-health') {
    _mod('data-health').then(function (m) {
      m.loadDataHealth();
    });
  }
  // ★ Phase 4 支付体系页面
  if (tab === 'pricing') {
    _mod('pricing').then(function (m) {
      m.loadPricing(document.getElementById('pricingContent'));
    });
  }
  if (tab === 'payment') {
    _mod('payment').then(function (m) {
      m.loadPayment(document.getElementById('paymentContent'), state._paymentData || {});
    });
  }
  if (tab === 'payment-result') {
    _mod('payment-result').then(function (m) {
      m.loadPaymentResult(document.getElementById('paymentResultContent'));
    });
  }
  if (tab === 'subscription') {
    _mod('subscription').then(function (m) {
      m.loadSubscription(document.getElementById('subscriptionContent'));
    });
  }
  if (tab === 'referral') {
    _mod('referral').then(function (m) {
      m.loadReferral(document.getElementById('referralContent'));
    });
  }
  if (tab === 'admin-payments') {
    _mod('admin-payments').then(function (m) {
      m.loadAdminPayments(document.getElementById('adminPaymentsContent'));
    });
  }
  if (tab === 'admin-referrals') {
    _mod('admin-referrals').then(function (m) {
      m.loadAdminReferrals(document.getElementById('adminReferralsContent'));
    });
  }
  if (tab === 'admin') {
    _mod('admin').then(function (m) {
      m.loadAdmin(document.getElementById('adminContent'));
    });
  }

  // ★ Phase3: 切 Tab 时立即预取 API 数据（与模块加载并行）
  //     api() 内置请求去重，模块加载后调用同一 API 时共享已发起的请求
  _prefetchTabData(tab);

  // ★ P1: 首页后异步预取相邻 Tab 数据（方案+命中率），切页直接渲染
  if (tab === 'home') {
    setTimeout(function () {
      const today = formatDate(new Date());
      api('plan-list', { date: today, qualityMode: 'all' }).catch(function () {});
      api('hit-rate-stats', {}).catch(function () {});
    }, 1200);
  }
}

// ★ Phase3: API 数据预取 — 与模块加载并行，api() 去重保证零额外请求

// 命中率页面重试事件监听
document.addEventListener('retryHitRate', function () {
  _mod('hit-rate').then(function (m) {
    m.loadHitRate();
  });
});

// ★ Phase 4: 订阅付费引导弹窗
document.addEventListener('subscription:required', function (e) {
  const detail = e.detail || {};
  const redirect = detail.redirect || 'pricing';
  const msg = detail.msg || '此功能需要订阅会员';
  const ok = confirm(msg + '\n\n是否查看套餐？');
  if (ok && typeof switchTab === 'function') {
    switchTab(redirect);
  }
});

// P0-1: 首页加载完成后 3 秒静默预加载注册页 JS（加速首次打开）
(function () {
  let _registerPreloaded = false;
  document.addEventListener('home:ready', function () {
    if (_registerPreloaded) return;
    _registerPreloaded = true;
    setTimeout(function () {
      _mod('register')
        .then(function (m) {
          console.log('[prefetch] register.js cached');
        })
        .catch(function () {});
    }, 3000);
  });
  // 兜底：如果 home:ready 事件未触发，3 秒后自动尝试
  setTimeout(function () {
    if (_registerPreloaded) return;
    _registerPreloaded = true;
    _mod('register')
      .then(function (m) {
        console.log('[prefetch] register.js cached (fallback)');
      })
      .catch(function () {});
  }, 5000);
})();

// V12: 运维告警横幅轮询（仅 ctyqq 可见）
(function () {
  const POLL_MS = 30 * 1000;
  let lastCount = 0;
  function checkAlerts() {
    fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'alerts', data: { username: 'ctyqq' } }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        const alerts = d.data || [];
        const unread = alerts.filter(function (a) {
          return !a.readAt;
        });
        const bar = document.getElementById('alertBanner');
        if (!bar) return;
        if (unread.length === 0) {
          bar.style.display = 'none';
          lastCount = 0;
          return;
        }
        if (unread.length !== lastCount) {
          const a = unread[0];
          const bg = a.level === 'P0' ? '#e53e3e' : a.level === 'P0.5' ? '#d69e2e' : '#38a169';
          const icon = a.level === 'P0' ? '\u{1F534}' : a.level === 'P0.5' ? '\u{1F7E1}' : '\u{1F7E2}';
          bar.style.background = bg;
          let txt = icon + ' [' + a.level + '] ' + a.title;
          if (a.detail) txt += ' | ' + a.detail;
          if (a.action) txt += ' | ' + a.action;
          const abt = document.getElementById('alertBannerText');
          if (abt) abt.textContent = txt;
          bar.style.display = 'block';
        }
        lastCount = unread.length;
      });
  }
  checkAlerts();
  setInterval(checkAlerts, POLL_MS);
  const abr = document.getElementById('alertBannerRead');
  const abc = document.getElementById('alertBannerClose');
  const ab = document.getElementById('alertBanner');
  if (abr)
    abr.addEventListener('click', function (e) {
      e.stopPropagation();
      if (ab) ab.style.display = 'none';
      fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'alerts', data: { subAction: 'readAll', username: 'ctyqq' } }),
      });
    });
  if (abc)
    abc.addEventListener('click', function (e) {
      e.stopPropagation();
      if (ab) ab.style.display = 'none';
    });
  if (ab)
    ab.addEventListener('click', function () {
      ab.style.display = 'none';
      fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'alerts', data: { subAction: 'readAll', username: 'ctyqq' } }),
      });
    });
})();

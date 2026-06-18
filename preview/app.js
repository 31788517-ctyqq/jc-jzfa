const API = '/api';
const DIR_COLORS = {
  胜: '#EF4444',
  平: '#FBBF24',
  负: '#60A5FA',
  胜平: '#34D399',
  平负: '#F472B6',
  胜负: '#A78BFA',
  让胜: '#18E0E0',
  让平: '#F59E0B',
  让负: '#94A3B8',
};
const CAT_NAMES = ['综合排名', '胜平负', '半全场', '进球数', '双选', '让球'];
const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// ECharts 按需懒加载：只在比赛详情页需要图表时才加载（首页无需加载 ~1MB 的 ECharts）
let echartsReady = false,
  echartsLoading = false;
const echartsWaiters = [];

function loadECharts() {
  return new Promise(function (resolve) {
    if (typeof echarts !== 'undefined') {
      echartsReady = true;
      return resolve();
    }
    if (echartsLoading) {
      echartsWaiters.push(resolve);
      return;
    }
    echartsLoading = true;
    const script = document.createElement('script');
    script.src = '/assets/echarts.min.js?v=1';
    script.onload = function () {
      echartsReady = true;
      echartsLoading = false;
      resolve();
      echartsWaiters.forEach(function (w) {
        w();
      });
    };
    script.onerror = function () {
      echartsLoading = false;
      console.warn('ECharts 加载失败，图表功能不可用');
      resolve();
    };
    document.head.appendChild(script);
  });
}

let currentPage = 'home',
  detailMatchId = null;
let selectedCategory = '',
  selectedDirection = '';
const selectedMatchDate = '';
let savedScrollY = 0;

function getWeekDay(dateStr) {
  return WEEK_NAMES[new Date(dateStr).getDay()];
}

function api(action, data = {}, retries = 3) {
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data }),
  })
    .then((r) => r.json())
    .then((d) => {
      if (d.code === 1) return d.data;
      // pending 状态透传（如 AI 后台生成中），不抛异常
      if (d.pending) return d;
      throw new Error(d.msg || '服务器错误');
    })
    .catch((err) => {
      if (retries > 0) {
        console.warn(`[API] ${action} 请求失败，重试中 (${4 - retries}/3):`, err.message);
        return new Promise((resolve) => setTimeout(resolve, 2000)).then(() => api(action, data, retries - 1));
      }
      throw err;
    });
}

// 导航栏滚动隐藏
let lastScrollY = 0;
window.addEventListener(
  'scroll',
  () => {
    const navbar = document.getElementById('navbar');
    const currentScroll = window.scrollY;
    if (currentScroll > 80 && currentScroll > lastScrollY) {
      navbar.classList.add('hidden');
    } else {
      navbar.classList.remove('hidden');
    }
    lastScrollY = currentScroll;
  },
  { passive: true },
);

let weekDates = []; // [{weekNum, matchDate, label}]
let selectedWeekIdx = 0; // 当前竞彩期号在 weekDates 中的索引

function formatDate(d) {
  const y = d.getFullYear(),
    m = (d.getMonth() + 1).toString().padStart(2, '0'),
    day = d.getDate().toString().padStart(2, '0');
  return y + '-' + m + '-' + day;
}
function formatDateCN(d) {
  const m = (d.getMonth() + 1).toString().padStart(2, '0'),
    day = d.getDate().toString().padStart(2, '0');
  return m + '月' + day + '日 ' + WEEK_NAMES[d.getDay()];
}

function shiftWeek(delta) {
  const newIdx = selectedWeekIdx + delta;
  if (newIdx < 0 || newIdx >= weekDates.length) return;
  selectedWeekIdx = newIdx;
  updateDateBar();
  loadMatchList();
}
// ── 日历选择器 ──
function toggleDatePicker() {
  const el = document.getElementById('datePicker');
  if (!el) return;
  if (el.style.display !== 'none') {
    el.style.display = 'none';
    return;
  }
  renderDatePicker();
  el.style.display = 'block';
}
let datePickerYear, datePickerMonth;
function renderDatePicker() {
  const grid = document.getElementById('datePickerGrid');
  const monthEl = document.getElementById('datePickerMonth');
  if (!grid || !monthEl) return;

  const available = {};
  weekDates.forEach(function (w) {
    available[w.matchDate] = true;
  });

  const today = formatDate(new Date()).slice(5);
  const current = weekDates[selectedWeekIdx] ? weekDates[selectedWeekIdx].matchDate : '';

  if (!datePickerYear) {
    const d = new Date();
    datePickerYear = d.getFullYear();
    datePickerMonth = d.getMonth() + 1;
    if (current) datePickerMonth = parseInt(current.slice(0, 2), 10);
  }

  const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  monthEl.textContent = CN[datePickerMonth - 1] + '月 ' + datePickerYear;

  const firstDay = new Date(datePickerYear, datePickerMonth - 1, 1);
  const lastDay = new Date(datePickerYear, datePickerMonth, 0);
  const daysInMonth = lastDay.getDate();
  const startDow = firstDay.getDay();

  let html = '';
  for (let i = 0; i < startDow; i++) html += '<div class="date-picker-cell other-month"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const mm = String(datePickerMonth).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const md = mm + '-' + dd;
    const hasMatch = !!available[md];
    const isActive = md === current;
    const isToday = md === today;
    let cls = 'date-picker-cell';
    if (hasMatch) cls += ' has-match';
    if (isActive) cls += ' active';
    if (isToday) cls += ' today';
    const onclick = hasMatch ? ' onclick="selectDateFromPicker(\'' + md + '\')"' : '';
    html += '<div class="' + cls + '"' + onclick + '>' + day + '</div>';
  }
  grid.innerHTML = html;

  document.getElementById('datePickerPrev').onclick = function () {
    datePickerMonth--;
    if (datePickerMonth < 1) {
      datePickerYear--;
      datePickerMonth = 12;
    }
    renderDatePicker();
  };
  document.getElementById('datePickerNext').onclick = function () {
    datePickerMonth++;
    if (datePickerMonth > 12) {
      datePickerYear++;
      datePickerMonth = 1;
    }
    renderDatePicker();
  };
}
function selectDateFromPicker(date) {
  if (date === 'today') {
    const today = formatDate(new Date()).slice(5);
    weekDates.forEach(function (w, i) {
      if (w.matchDate === today) selectedWeekIdx = i;
    });
  } else {
    weekDates.forEach(function (w, i) {
      if (w.matchDate === date) selectedWeekIdx = i;
    });
  }
  updateDateBar();
  loadMatchList();
  const el = document.getElementById('datePicker');
  if (el) el.style.display = 'none';
}

// ── 通用日历渲染 (app.js) ──
function renderMonthCalendar(prefix, availableDates, current, today, onSelect) {
  const grid = document.getElementById(prefix + 'Grid');
  const monthEl = document.getElementById(prefix + 'Month');
  if (!grid || !monthEl) return;
  const yk = prefix + 'Y',
    mk = prefix + 'M';
  if (typeof window[yk] === 'undefined') {
    const d = new Date();
    window[yk] = d.getFullYear();
    window[mk] = d.getMonth() + 1;
    if (current) window[mk] = parseInt(current.slice(0, 2), 10);
  }
  const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  monthEl.textContent = CN[window[mk] - 1] + '月 ' + window[yk];
  const firstDay = new Date(window[yk], window[mk] - 1, 1);
  const lastDay = new Date(window[yk], window[mk], 0);
  const startDow = firstDay.getDay();
  let html = '';
  for (let i = 0; i < startDow; i++) html += '<div class="date-picker-cell other-month"></div>';
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const mm = String(window[mk]).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const md = mm + '-' + dd;
    const hasMatch = availableDates.indexOf(md) >= 0;
    const isActive = md === current;
    const isToday = md === today;
    let cls = 'date-picker-cell';
    if (hasMatch) cls += ' has-match';
    if (isActive) cls += ' active';
    if (isToday) cls += ' today';
    const onclick = hasMatch ? ' onclick="' + onSelect + "('" + md + '\')"' : '';
    html += '<div class="' + cls + '"' + onclick + '>' + day + '</div>';
  }
  grid.innerHTML = html;
  document.getElementById(prefix + 'Prev').onclick = function () {
    window[mk]--;
    if (window[mk] < 1) {
      window[yk]--;
      window[mk] = 12;
    }
    renderMonthCalendar(prefix, availableDates, current, today, onSelect);
  };
  document.getElementById(prefix + 'Next').onclick = function () {
    window[mk]++;
    if (window[mk] > 12) {
      window[yk]++;
      window[mk] = 1;
    }
    renderMonthCalendar(prefix, availableDates, current, today, onSelect);
  };
}
function togglePlanDatePicker() {
  const el = document.getElementById('planDatePicker');
  if (!el) return;
  if (el.style.display !== 'none') {
    el.style.display = 'none';
    return;
  }
  const available = weekDates.map(function (w) {
    return w.matchDate;
  });
  const today = formatDate(new Date()).slice(5);
  const current = planDate ? planDate.slice(5) : today;
  renderMonthCalendar('planDate', available, current, today, 'selectPlanDateFromPicker');
  el.style.display = 'block';
}
function selectPlanDateFromPicker(md) {
  const year = planDate ? planDate.slice(0, 4) : new Date().getFullYear();
  planDate = year + '-' + md;
  const el = document.getElementById('planDateCurrent');
  if (el) {
    const mmdd = md.replace('-', '/');
    const week = WEEK_NAMES[new Date(year, parseInt(md.slice(0, 2), 10) - 1, parseInt(md.slice(3), 10)).getDay()];
    el.textContent = mmdd + ' ' + week;
  }
  if (planTab === 'expert') loadPlanList();
  else loadScorePlanList();
  document.getElementById('planDatePicker').style.display = 'none';
}
function toggleRankDatePicker() {
  const el = document.getElementById('rankDatePicker');
  if (!el) return;
  if (el.style.display !== 'none') {
    el.style.display = 'none';
    return;
  }
  const available = weekDates.map(function (w) {
    return w.matchDate;
  });
  const today = formatDate(new Date()).slice(5);
  const current = rankDate ? rankDate.slice(5) : today;
  renderMonthCalendar('rankDate', available, current, today, 'selectRankDateFromPicker');
  el.style.display = 'block';
}
function selectRankDateFromPicker(md) {
  const year = rankDate ? rankDate.slice(0, 4) : new Date().getFullYear();
  rankDate = year + '-' + md;
  const el = document.getElementById('rankDateCurrent');
  if (el) {
    const mmdd = md.replace('-', '/');
    const week = WEEK_NAMES[new Date(year, parseInt(md.slice(0, 2), 10) - 1, parseInt(md.slice(3), 10)).getDay()];
    el.textContent = mmdd + ' ' + week;
  }
  loadRanking();
  document.getElementById('rankDatePicker').style.display = 'none';
}
function goToday() {
  // 找到今天或最近的竞彩期号
  const today = formatDate(new Date()).slice(5);
  const now = new Date();
  const todayWeek = WEEK_NAMES[now.getDay()];
  let best = 0;
  // 首选：matchDate==today 且 weekNum==todayWeek；其次：matchDate<=today 的最大 matchDate
  weekDates.forEach(function (w, i) {
    if (w.matchDate === today && w.weekNum === todayWeek) {
      best = i;
    }
  });
  if (weekDates[best] && weekDates[best].matchDate === today && weekDates[best].weekNum === todayWeek) {
    // 已精确匹配
  } else {
    weekDates.forEach(function (w, i) {
      if (w.matchDate <= today) best = i;
    });
  }
  selectedWeekIdx = best;
  updateDateBar();
  loadMatchList();
}
function updateDateBar() {
  const el = document.getElementById('dateCurrent');
  if (!el) return;
  const w = weekDates[selectedWeekIdx];
  if (w) {
    const today = formatDate(new Date()).slice(5);
    const prefix = w.matchDate === today ? '今天 ' : '';
    // 如 "今天 05/19 周二" 或 "04/01 周三"
    el.textContent = prefix + w.matchDate.replace('-', '/') + ' ' + w.weekNum;
  } else {
    el.textContent = '加载中...';
  }
}
function initWeekDates() {
  api('week-dates', {})
    .then(function (list) {
      weekDates = list || [];
      if (weekDates.length) {
        const today = formatDate(new Date()).slice(5);
        selectedWeekIdx = 0;
        weekDates.forEach(function (w, i) {
          if (w.matchDate <= today) selectedWeekIdx = i;
        });
      } else {
        // 无周数据时，生成当天作为兜底
        weekDates = [{ weekNum: WEEK_NAMES[new Date().getDay()], matchDate: formatDate(new Date()).slice(5) }];
      }
      updateDateBar();
      loadMatchList();
    })
    .catch(function () {
      // 兜底：api 不可用时用当天日期直接加载
      weekDates = [{ weekNum: WEEK_NAMES[new Date().getDay()], matchDate: formatDate(new Date()).slice(5) }];
      selectedWeekIdx = 0;
      updateDateBar();
      loadMatchList();
    });
}

function switchTab(tab) {
  // 保存离开home时的滚动位置
  if (currentPage === 'home' && tab !== 'home') savedScrollY = window.scrollY;
  currentPage = tab;
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.getElementById('page-' + (tab === 'detail' ? 'detail' : tab)).classList.add('active');
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
  document.getElementById('navTitle').textContent = titles[tab] || '竞彩推荐监控';
  // 详情页和筛选页显示返回按钮
  document.getElementById('navBack').style.display = tab === 'detail' || tab === 'filter' ? 'flex' : 'none';

  if (tab === 'home') {
    const cameBack = savedScrollY > 0;
    if (!cameBack) loadHome();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        window.scrollTo(0, savedScrollY);
        if (cameBack) savedScrollY = 0; // 恢复后清零防止影响后续导航
      });
    });
  }
  if (tab === 'match') {
    if (weekDates.length > 0) {
      updateDateBar();
      loadMatchList();
    } else initWeekDates();
    // 双重保障：100ms后若仍未加载则兜底强制加载
    setTimeout(function () {
      const listEl = document.getElementById('matchList');
      if (listEl && (!listEl.children.length || listEl.children[0].classList.contains('loading-spinner'))) {
        loadMatchList();
      }
    }, 300);
  }
  if (tab === 'plan') {
    updatePlanDateBar();
    if (planTab === 'expert') loadPlanList();
    else loadScorePlanList();
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

let lastPage = 'home';
function goBack() {
  switchTab(lastPage);
  if (lastPage === 'home') {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        window.scrollTo(0, savedScrollY);
      });
    });
  }
}

// 首页
function loadHome() {
  // 首页：ranking-list + match-list 同时发起，用 Promise.all 减少等待
  const rankP = api('ranking-list', {}).catch(function () {
    return {};
  });
  const matchP = api('match-list', {}).catch(function () {
    return [];
  });
  Promise.all([rankP, matchP]).then(function (r) {
    const rank = r[0],
      matches = r[1];
    document.getElementById('matchCount').textContent = matches.length || '-';
    document.getElementById('maxRankCount').textContent = rank.topExpertCount || 0;
  });
}

// 比赛列表
function loadMatchList() {
  const el = document.getElementById('matchList');
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  const params = { _t: Date.now() };
  const w = weekDates[selectedWeekIdx];
  if (w) {
    params.weekNum = w.weekNum;
    params.matchDate = w.matchDate;
  } else {
    params.date = formatDate(new Date());
  }

  api('match-list', params)
    .then((matches) => {
      el.innerHTML = matches
        .map((m) => {
          const statusText = { 0: '未开始', 1: '进行中', 2: '已结束', 3: '取消' }[m.matchStatus] || '未知';
          const roundText = m.num || '';
          const timeStr = m.startTime ? m.startTime.slice(5) : '';
          const startDate = m.startTime ? m.startTime.slice(0, 5) : '';
          const isLive = m.matchStatus === 1 || m.matchStatus === 2;
          const scoreText = m.score || '';
          const halfText = m.halfScore || '';
          const durText = m.duration || '';
          const yellowText = m.yellow || '';
          const redText = m.red || '';
          let scoreDisplay = '';
          let extraInfo = '';
          if (isLive && scoreText) {
            const parts = scoreText.replace('-', ':').split(':');
            if (parts.length === 2)
              scoreDisplay = '<span class="match-score">' + parts[0] + ' : ' + parts[1] + '</span>';
          }
          // 进行中比赛：显示进行时间
          if (m.matchStatus === 1 && durText && durText !== '未') {
            extraInfo += '<span class="match-dur">' + durText + '</span>';
          }
          // 红黄牌
          if (isLive && yellowText && yellowText !== '-') {
            extraInfo += '<span class="match-card-stat yellow"><span class="stat-dot"></span>' + yellowText + '</span>';
          }
          if (isLive && redText && redText !== '-') {
            extraInfo += '<span class="match-card-stat red"><span class="stat-dot"></span>' + redText + '</span>';
          }
          if (halfText) {
            extraInfo += '<span class="match-half">(半 ' + halfText + ')</span>';
          }
          return `
        <div class="match-card" onclick="goDetail('${m.matchId}')">
          <div class="match-header">
            <span class="match-league">${m.leagueName}</span>
            ${m.isSingleGame ? '<span class="match-single-badge">单关</span>' : ''}
            <span class="match-num">${roundText}</span>
          </div>
          <div class="match-teams">
            <span class="team-name">${m.homeName}</span>
            ${isLive && scoreDisplay ? scoreDisplay : '<span class="vs">VS</span>'}
            <span class="team-name">${m.visitName}</span>
          </div>
          <div class="match-info">
            <span class="match-experts">${m.recommNum ? m.recommNum + '位专家推荐' : ''}</span>
            <span class="match-time">${startDate ? startDate.replace('-', '/') + ' ' : ''}${timeStr}</span>
          </div>
          <div class="match-status" style="color:${m.matchStatus === 1 ? 'var(--cyan)' : m.matchStatus === 2 ? 'var(--green)' : m.matchStatus === 3 ? 'var(--red)' : 'var(--text2)'}">${statusText} ${extraInfo}</div>
        </div>
      `;
        })
        .join('');
    })
    .catch((e) => {
      el.innerHTML = `<div class="loading">${e.message}</div>`;
    });
}

// 比赛详情
function goDetail(matchId) {
  if (currentPage === 'home') savedScrollY = window.scrollY;
  lastPage = currentPage;
  detailMatchId = matchId;
  const el = document.getElementById('detailContent');
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';
  switchTab('detail');

  Promise.all([api('match-detail', { matchId }), api('recommend-trend', { matchId })]).then(([detail, trend]) => {
    const match = detail.match || detail;
    const recommends = detail.recommends || [];
    const hasResults = recommends.some(function (r) {
      return r.result !== null;
    });
    const statusText = match.matchStatus === 2 ? '已结束' : match.matchStatus === 1 ? '进行中' : '未开始';
    const roundText = match.num || match.matchNum || '竞彩';
    const isLive = match.matchStatus === 1 || match.matchStatus === 2;
    const scoreText = match.score || '';
    const halfText = match.halfScore || '';
    const durText = match.duration || '';
    const yellowText = match.yellow || '';
    const redText = match.red || '';
    let scoreDisplay = '';
    let extraText = '';
    if (isLive && scoreText) {
      const parts = scoreText.replace('-', ':').split(':');
      if (parts.length === 2) scoreDisplay = '<span class="match-score">' + parts[0] + ' : ' + parts[1] + '</span>';
    }
    if (match.matchStatus === 1 && durText && durText !== '未') {
      extraText += '<span class="match-dur">' + durText + '</span>';
    }
    if (yellowText && yellowText !== '-') {
      extraText += '<span class="match-card-stat yellow"><span class="stat-dot"></span>' + yellowText + '</span>';
    }
    if (redText && redText !== '-') {
      extraText += '<span class="match-card-stat red"><span class="stat-dot"></span>' + redText + '</span>';
    }
    if (halfText) {
      extraText += '<span class="match-half">(半 ' + halfText + ')</span>';
    }

    let html = `
      <div class="match-card" style="margin-bottom: 16px;">
        <div class="match-header">
          <span class="match-league">${match.leagueName}</span>
          <span class="match-num">${roundText}</span>
        </div>
        <div class="match-teams">
          <span class="team-name">${match.homeName}</span>
          ${isLive && scoreDisplay ? scoreDisplay : '<span class="vs">VS</span>'}
          <span class="team-name">${match.visitName}</span>
        </div>
        <div style="text-align: center; font-size: 12px; color: var(--text3);">
          ${match.startTime ? match.startTime.slice(5) : ''} · ${roundText} ${extraText}
        </div>
      </div>
    `;

    // AI预测核心看点卡片
    html += `
      <div class="ai-card" onclick="showAIPrediction('${matchId}')">
        <div class="ai-card-header">
          <span class="ai-icon">🤖</span>
          <span class="ai-title">AI预测核心看点</span>
          <span class="ai-arrow">›</span>
        </div>
        <div class="ai-summary">五维分析：基础面 · 状态面 · 动机面 · 对位面 · 市场面</div>
      </div>
    `;

    html += `
      <div class="chart-box">
        <div class="chart-header">
          <div class="chart-title">推荐趋势 · 方向分布</div>
        </div>
        <div id="trendChart" class="chart"></div>
        <div class="dir-list" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.05);">
    `;

    // 构建方向命中结果映射
    const hitMap = {};
    recommends.forEach(function (r) {
      if (r.result === 1) hitMap[r.type] = true;
    });

    let dirItems = (trend.lastResult || []).filter((r) => r.num > 0);
    if (dirItems.length === 0 && recommends.length > 0) {
      const typeMap = {};
      recommends.forEach((r) => {
        if (!typeMap[r.type]) typeMap[r.type] = 0;
        typeMap[r.type] += r.num || 0;
      });
      dirItems = Object.keys(typeMap).map((t) => ({ type: t, num: typeMap[t] }));
    }
    const isFinished =
      match.matchStatus === 2 ||
      recommends.some(function (r) {
        return r.result !== null;
      });
    dirItems
      .sort((a, b) => (b.num || 0) - (a.num || 0))
      .forEach((r) => {
        const isHit = isFinished && hitMap[r.type];
        const hitFlag = isHit ? '<img src="/assets/worldcup/flag-hit.png" class="hit-flag" alt="">' : '';
        const hitClass = isHit ? ' hit' : '';
        html += `
        <div class="dir-item${hitClass}">
          <span class="dir-name">${hitFlag}${r.type}</span>
          <span class="dir-count">${r.num}位</span>
        </div>
      `;
      });
    html += '</div></div>';

    el.innerHTML = html;
    el.classList.remove('page-skeleton');

    // AI 核心看点卡片隐藏逻辑：比赛日期早于今天则隐藏
    const matchDate = (match.date || '').slice(0, 10);
    const todayStr = formatDate(new Date());
    const isPastMatch = matchDate && matchDate < todayStr;
    if (isPastMatch) {
      const aiCard = el.querySelector('.ai-card');
      if (aiCard) aiCard.style.display = 'none';
    }

    setTimeout(() => {
      const chartEl = document.getElementById('trendChart');
      const top5 = (trend.lastResult || []).sort((a, b) => b.num - a.num).slice(0, 5);

      // 少于2个数据点时展示占位（线图需≥2个点才可读）
      if (!trend || !trend.timeLabels || trend.timeLabels.length < 2 || (trend.series || []).length === 0) {
        chartEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;color:#64748B;">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" opacity="0.5"><path d="M14 25C14 27 15.07 32 29 32C42.93 32 44 27 44 25C44 23 44 10 44 10H29H14C14 10 14 23 14 25Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M29 16H23V21L26 24L29 21V16Z" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 16V10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 40L43 40" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 14H4C4 14 5 19 6 22C7 25 14 24 14 24" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>
          <div style="margin-top:12px;font-size:13px;color:#94A3B8;">趋势数据收集中</div>
          <div style="margin-top:4px;font-size:11px;color:#4B5563;">每20分钟更新一个数据点</div>
        </div>`;
        return;
      }

      // 懒加载 ECharts 后渲染图表
      loadECharts().then(function () {
        if (!echartsReady) return;
        const existInstance = echarts.getInstanceByDom(chartEl);
        if (existInstance) existInstance.dispose();
        const chart = echarts.init(chartEl);
        const colors = ['#EF4444', '#FBBF24', '#34D399', '#18E0E0', '#A78BFA'];

        let matchedSeries = trend.series.filter(function (s) {
          return top5.some(function (t) {
            return t.type === s.name;
          });
        });
        if (matchedSeries.length === 0) matchedSeries = trend.series.slice(0, 5);
        const series = matchedSeries.slice(0, 5).map(function (s, i) {
          return {
            name: s.name,
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { width: 2, color: colors[i] },
            itemStyle: { color: colors[i] },
            data: s.data,
          };
        });

        chart.setOption({
          color: colors,
          tooltip: { trigger: 'axis' },
          legend: {
            bottom: 0,
            icon: 'circle',
            itemWidth: 8,
            itemHeight: 8,
            textStyle: { fontSize: 10, color: '#94A3B8' },
          },
          grid: { left: '2%', right: '4%', bottom: '18%', top: '5%', containLabel: true },
          xAxis: {
            type: 'category',
            data: trend.timeLabels,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { fontSize: 10, color: '#64748B' },
          },
          yAxis: {
            type: 'value',
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { fontSize: 10, color: '#64748B' },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.03)' } },
          },
          series,
        });
      });
    }, 100);
  });
}

// 排行榜
function loadRanking(cat, dir) {
  if (cat !== undefined) selectedCategory = cat;
  if (dir !== undefined) selectedDirection = dir;

  const el = document.getElementById('rankList');
  const catEl = document.getElementById('catFilterBar');
  const subEl = document.getElementById('subFilterBar');
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  const params = {};
  if (selectedCategory && selectedDirection) params.direction = selectedDirection;
  else if (selectedCategory) params.category = selectedCategory;
  if (rankDate) params.date = rankDate;

  api('ranking-list', params).then((data) => {
    // 当天无排名时自动回退到最近有数据的日期
    if ((data.ranking || []).length === 0 && !selectedCategory && !selectedDirection) {
      const now2 = new Date();
      const todayStr2 =
        now2.getFullYear() +
        '-' +
        String(now2.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(now2.getDate()).padStart(2, '0');
      if (rankDate === todayStr2 || rankDate === '') {
        const d3 = new Date();
        d3.setDate(d3.getDate() + rankDateOffset - 1);
        if (d3.toISOString().slice(0, 10) >= MIN_PLAN_DATE) {
          rankDateOffset--;
          updateRankDateBar();
          loadRanking();
          return;
        }
      }
    }

    // 分类筛选
    const catOrder = CAT_NAMES.filter((c) => c === '综合排名' || (data.categories && data.categories[c]));
    catEl.innerHTML = catOrder
      .map((c) => {
        const isActive = (c === '综合排名' && !selectedCategory) || c === selectedCategory;
        return `<div class="filter-tag ${isActive ? 'active' : ''}" onclick="selectCategory('${c}')">${c}</div>`;
      })
      .join('');

    // 二级筛选
    if (selectedCategory && data.categories && data.categories[selectedCategory]) {
      subEl.style.display = 'flex';
      const dirs = data.categories[selectedCategory].directions;
      subEl.innerHTML = dirs
        .map((d) => {
          const isActive = d.name === selectedDirection;
          return `<div class="filter-tag ${isActive ? 'active' : ''}" onclick="selectDirection('${d.name.replace(/'/g, "\\'")}')">${d.name}</div>`;
        })
        .join('');
    } else {
      subEl.style.display = 'none';
    }

    // 排名列表
    const topCount = data.ranking.length > 0 ? data.ranking[0].expertCount : 1;
    el.innerHTML = data.ranking
      .map((item) => {
        const r = item.rank;
        let badgeClass = 'normal',
          badgeContent = r;
        if (r === 1) {
          badgeClass = 'gold';
          badgeContent = '🥇';
        } else if (r === 2) {
          badgeClass = 'silver';
          badgeContent = '🥈';
        } else if (r === 3) {
          badgeClass = 'bronze';
          badgeContent = '🥉';
        }

        const pct = Math.round((item.expertCount / topCount) * 100);
        const idx = item.rank;
        return `
        <div class="rank-card" onclick="goDetail('${item.matchId}')">
          <div class="rank-badge ${badgeClass}">${badgeContent}</div>
          <div class="rank-content">
            <div class="rank-teams">${item.homeName} vs ${item.visitName}</div>
            <div class="rank-meta">${item.leagueName} · ${item.num || ''}</div>
            <div class="rank-direction">${item.direction} · ${item.expertCount}位专家</div>
            <div class="rank-progress">
              <div class="rank-progress-fill" data-width="${pct}"></div>
            </div>
          </div>
          ${item.isHit ? '<div class="rank-hit-stamp">中</div>' : ''}
        </div>
      `;
      })
      .join('');

    // 延迟触发进度条动画
    requestAnimationFrame(() => {
      el.querySelectorAll('.rank-progress-fill').forEach((el) => {
        setTimeout(() => {
          el.style.width = el.dataset.width + '%';
        }, 80);
      });
    });
  });
}

function selectCategory(cat) {
  if (cat === '综合排名') {
    selectedCategory = '';
    selectedDirection = '';
  } else {
    selectedCategory = cat;
    selectedDirection = '';
  }
  loadRanking();
}

function selectDirection(dir) {
  selectedDirection = dir;
  loadRanking();
}

// 命中率数据
function loadHitRate() {
  const el = document.getElementById('hitContent');
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  api('hit-rate-stats', { days: 60 })
    .then((data) => {
      if (!data || !data.directionStats) {
        el.innerHTML = '<div class="loading">命中率数据需要时间积累</div>';
        return;
      }

      const top3Rate = data.top3HitRate !== undefined ? data.top3HitRate : 0;

      let html = `
      <div class="stats-header">
        <div style="font-size: 11px; color: var(--cyan); margin-bottom: 12px;">近60天完赛数据概览</div>
        <div class="stats-row">
          <div class="stat-big">
            <div class="stat-big-value">${data.directionStats.length}</div>
            <div class="stat-big-label">方向数</div>
          </div>
          <div class="stat-big">
            <div class="stat-big-value">${top3Rate}%</div>
            <div class="stat-big-label">综合排名命中率</div>
          </div>
        </div>
      </div>
    `;

      // 各方向命中场次排名
      const top10 = data.directionStats.slice(0, 10);
      let rankHTML = `<div class="hit-ranking-card">
      <div class="hit-ranking-title">各方向命中场次排名</div>`;

      top10.forEach((d, i) => {
        const r = i + 1;
        const barColor = d.hitRate >= 60 ? '#38E5D0' : d.hitRate >= 45 ? '#38E5D0' : '#E84141';
        const top3Class = r <= 3 ? ' top3' : '';
        rankHTML += `
        <div class="hit-rank-row">
          <span class="hit-rank-num${top3Class}">${r}</span>
          <span class="hit-rank-label">${d.direction}</span>
          <div class="hit-rank-bar-bg">
            <div class="hit-rank-bar" style="background-color:${barColor};" data-width="${d.hitRate}"></div>
          </div>
          <span class="hit-rank-pct">${d.hitRate}%</span>
        </div>`;
      });

      rankHTML += `</div>`;

      html += rankHTML;

      // 明细表格
      html += `
      <div class="chart-box" style="margin-top: 16px;">
        <table class="data-table" style="display:table;">
          <thead>
            <tr>
              <th>方向</th>
              <th>总次数</th>
              <th>命中</th>
              <th>未中</th>
              <th>命中率</th>
            </tr>
          </thead>
          <tbody>
    `;

      data.directionStats.forEach((d) => {
        const color = d.hitRate >= 60 ? 'var(--green)' : d.hitRate >= 45 ? 'var(--cyan)' : 'var(--red)';
        html += `
        <tr>
          <td>${d.direction}</td>
          <td>${d.totalRecommends}</td>
          <td style="color: var(--green)">${d.hitCount}</td>
          <td style="color: var(--red)">${d.missCount}</td>
          <td style="color: ${color}; font-weight: 600;">${d.hitRate}%</td>
        </tr>
      `;
      });

      html += '</tbody></table></div>';
      el.innerHTML = html;

      // 延迟触发进度条加载动画
      requestAnimationFrame(() => {
        document.querySelectorAll('.hit-rank-bar').forEach((bar) => {
          setTimeout(() => {
            bar.style.width = bar.dataset.width + '%';
          }, 60);
        });
      });
    })
    .catch((e) => {
      el.innerHTML = `<div class="loading">${e.message}</div>`;
    });
}

// ========== 命中率筛选 ==========
const filterDirMap = {
  胜平负: ['全部', '胜', '平', '负'],
  让球: ['全部', '让胜', '让平', '让负'],
  进球数: [
    '全部',
    '总进球-1、2球',
    '总进球-2、3球',
    '总进球-3、4球',
    '总进球-1、2、3球',
    '总进球-2、3、4球',
    '总进球-3、4、5球',
  ],
  双选: ['全部', '平、让平', '让胜、让平', '让平、让负', '胜、平', '平、负'],
  半全场: ['全部', '半全场-胜胜', '半全场-负负'],
};

// 自定义下拉
function toggleDD(id, evt) {
  // 阻止事件冒泡到 document，避免被全局监听器立即关闭
  if (evt) {
    evt.stopPropagation();
    evt.preventDefault();
  }
  const dd = document.getElementById(id);
  if (!dd) return;
  const wasOpen = dd.classList.contains('open');
  closeAllDD();
  if (!wasOpen) {
    dd.classList.add('open');
    // 用 fixed 定位，彻底脱离父容器裁剪
    const menu = dd.querySelector('.filter-dd-menu');
    const trigger = dd.querySelector('.filter-dd-trigger');
    if (!menu || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vh = window.innerHeight;
    const menuH = Math.min(menu.scrollHeight || 220, 220);
    // 智能定位：下方空间不足时，菜单向上展开
    const spaceBelow = vh - rect.bottom - 6;
    const spaceAbove = rect.top - 6;
    menu.style.position = 'fixed';
    menu.style.left = rect.left + 'px';
    menu.style.width = rect.width + 'px';
    menu.style.right = 'auto';
    menu.style.maxHeight = menuH + 'px';
    menu.style.overflowY = 'auto';
    menu.style.WebkitOverflowScrolling = 'touch';
    if (spaceBelow >= menuH || spaceBelow >= spaceAbove) {
      // 向下展开
      menu.style.top = rect.bottom + 6 + 'px';
      menu.style.bottom = 'auto';
    } else {
      // 向上展开
      menu.style.bottom = vh - rect.top + 6 + 'px';
      menu.style.top = 'auto';
    }
  }
}
function selectDD(id, val, text) {
  const dd = document.getElementById(id);
  if (!dd) return;
  dd.setAttribute('data-val', val);
  dd.querySelector('.filter-dd-text').textContent = text;
  dd.querySelectorAll('.filter-dd-option').forEach(function (o) {
    o.classList.toggle('selected', o.getAttribute('data-val') === val);
  });
  closeAllDD();
}
function getDDVal(id) {
  const el = document.getElementById(id);
  return el ? el.getAttribute('data-val') || '' : '';
}
function closeAllDD() {
  document.querySelectorAll('.filter-dd.open').forEach(function (d) {
    d.classList.remove('open');
  });
}
// 监听 click/touchend 关闭下拉（兼容移动端）
function handleDocClose(e) {
  if (!e.target) return;
  const inDD = e.target.closest('.filter-dd');
  if (!inDD) closeAllDD();
}
document.addEventListener('click', handleDocClose);
document.addEventListener('touchend', function (e) {
  // mobile touchend 300ms later to avoid immediate close
  setTimeout(function () {
    handleDocClose(e);
  }, 50);
});

function resetFilterResult() {
  document.getElementById('filterResult').innerHTML = '<div class="hint-box">选择筛选条件后点击"查询"按钮</div>';
}

function loadFilterLeagues() {
  api('filter-stats', {})
    .then(function (stats) {
      document.getElementById('statMatches').textContent = stats.matchCount || 0;
      document.getElementById('statLeagues').textContent = stats.leagueCount || 0;
      document.getElementById('statDirs').textContent = stats.directionCount || 0;
      // 填充联赛下拉
      const menu = document.querySelector('#dd-league .filter-dd-menu');
      let html =
        '<li data-val="" class="filter-dd-option selected" onclick="selectDD(\'dd-league\',\'\',\'全部\')">全部</li>';
      (stats.leagues || []).forEach(function (l) {
        html +=
          '<li data-val="' +
          l +
          '" class="filter-dd-option" onclick="selectDD(\'dd-league\',\'' +
          l +
          "','" +
          l +
          '\')">' +
          l +
          '</li>';
      });
      menu.innerHTML = html;
      // 如有待回填数据，展示提示
      if (stats.staleCount > 0) {
        document.getElementById('filterResult').innerHTML =
          '<div class="hint-box" style="color:var(--amber);font-size:12px;">' +
          '⚠ ' +
          stats.staleCount +
          ' 条推荐结果尚未确定，可能需要回填。<br>' +
          '<span style="color:var(--text3);">运行 <code>node backfill_results.js</code> 补全数据</span></div>';
      }
    })
    .catch(function () {
      document.getElementById('statMatches').textContent = '-';
      document.getElementById('statLeagues').textContent = '-';
      document.getElementById('statDirs').textContent = '-';
    });
}

function onDDTypeChange() {
  const type = getDDVal('dd-dirType');
  const ddDir = document.getElementById('dd-dir');
  // 综合排名没有二级选项
  if (!type || type === '综合排名') {
    ddDir.style.display = 'none';
    return;
  }
  const options = filterDirMap[type] || [];
  const menu = ddDir.querySelector('.filter-dd-menu');
  let html = '<li data-val="" class="filter-dd-option selected" onclick="selectDD(\'dd-dir\',\'\',\'全部\')">全部</li>';
  options.forEach(function (d) {
    html +=
      '<li data-val="' +
      d +
      '" class="filter-dd-option" onclick="selectDD(\'dd-dir\',\'' +
      d +
      "','" +
      d +
      '\')">' +
      d +
      '</li>';
  });
  menu.innerHTML = html;
  ddDir.setAttribute('data-val', '');
  ddDir.querySelector('.filter-dd-text').textContent = '全部';
  ddDir.style.display = 'block';
}

function onRankTypeChange() {
  const type = getDDVal('dd-rankType');
  const ddRank = document.getElementById('dd-rank');
  if (type === '全部') {
    ddRank.style.display = 'none';
    return;
  }
  ddRank.style.display = 'block';
  ddRank.setAttribute('data-val', '0');
  ddRank.querySelector('.filter-dd-text').textContent = '全部';
}

function doFilterQuery() {
  const league = getDDVal('dd-league');
  const timeRange = getDDVal('dd-time');
  const directionType = getDDVal('dd-dirType');
  const ddDir = document.getElementById('dd-dir');
  let direction = ddDir.style.display !== 'none' ? getDDVal('dd-dir') : '';
  if (direction === '全部') direction = '';
  const rankType = getDDVal('dd-rankType') || '全部';
  let rankTop = 0;
  if (rankType !== '全部') {
    rankTop = parseInt(getDDVal('dd-rank')) || 0;
  }

  const resultEl = document.getElementById('filterResult');
  resultEl.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  api('hit-rate-filter', {
    league: league,
    timeRange: timeRange,
    directionType: directionType,
    direction: direction,
    rankType: rankType,
    rankTop: rankTop,
  })
    .then(function (data) {
      if (!data) {
        resultEl.innerHTML = '<div class="loading">查询失败</div>';
        return;
      }

      let html = '';

      if (data.totalCount === 0) {
        html += '<div class="loading" style="padding:20px;color:var(--text2)">暂无符合条件的数据</div>';
      } else {
        const rateVal = parseFloat(data.hitRate) || 0;
        const ringColor = rateVal >= 50 ? '#34D399' : rateVal >= 40 ? '#FBBF24' : '#EF4444';
        const r = 36,
          c = 2 * Math.PI * r;
        const dashVal = c * (1 - rateVal / 100);

        const condTags = data.conditionSummary.split(' | ');
        let condHtml = '<div class="filter-cond-tags">';
        for (let i = 0; i < condTags.length; i++) {
          if (i > 0) condHtml += '<span class="filter-cond-pipe">|</span>';
          condHtml += '<span>' + condTags[i] + '</span>';
        }
        condHtml += '</div>';

        html += '<div class="filter-result-card">';
        html += '<div class="filter-result-head">筛选结果</div>';
        html += condHtml;
        html += '<div class="filter-result-row">';
        html +=
          '<div class="filter-result-side"><div class="filter-result-num">' +
          data.hitCount +
          '</div><div class="filter-result-label">命中场次</div></div>';
        html += '<div class="filter-ring-wrap">';
        html += '<svg class="filter-ring-svg" viewBox="0 0 80 80">';
        html += '<circle class="filter-ring-bg" cx="40" cy="40" r="' + r + '"/>';
        html +=
          '<circle class="filter-ring-fill" cx="40" cy="40" r="' +
          r +
          '" stroke="' +
          ringColor +
          '" stroke-dasharray="' +
          c +
          '" stroke-dashoffset="' +
          dashVal +
          '"/>';
        html +=
          '<text class="filter-ring-pct" x="40" y="40" text-anchor="middle" dominant-baseline="central" fill="' +
          ringColor +
          '" transform="rotate(90,40,40)">' +
          rateVal +
          '%</text>';
        html += '</svg></div>';
        html +=
          '<div class="filter-result-side"><div class="filter-result-num">' +
          data.totalCount +
          '</div><div class="filter-result-label">符合条件场次</div></div>';
        html += '</div></div>';
      }

      // 结果详情卡片：近15天数据（无论是否有结果都显示）
      if (data.dailyResults && data.dailyResults.length > 0) {
        html += '<div class="filter-detail-card">';
        html += '<div class="filter-detail-head">结果详情</div>';
        html +=
          '<div class="filter-detail-header-row"><span>近15天</span><span>符合场次/命中场次</span><span>命中率</span></div>';
        data.dailyResults.forEach(function (d) {
          const dr = parseFloat(d.hitRate) || 0;
          html +=
            '<div class="filter-detail-row"><span>' +
            d.date +
            '</span><span>' +
            d.totalMatch +
            '/' +
            d.hitMatch +
            '</span><span>' +
            dr.toFixed(1) +
            '%</span></div>';
        });
        html += '</div>';
      }

      resultEl.innerHTML = html;
    })
    .catch(function (e) {
      resultEl.innerHTML = '<div class="loading">' + e.message + '</div>';
      incomeLoaded = false; // 失败后允许重试
    });
}

// ========== 方案收入 ==========
var incomeLoaded = false;
function loadIncome(force) {
  if (!force && incomeLoaded) return; // 避免重复加载
  incomeLoaded = true;
  const resultEl = document.getElementById('incomeResult');
  if (!resultEl) return;
  resultEl.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  const timeVal = getDDVal('dd-incTime');
  const days = timeVal === 'all' ? 0 : parseInt(timeVal) || 0;
  const plan = getDDVal('dd-incPlan') || 'all';

  api('income-stats', { days: days, plan: plan })
    .then(function (data) {
      const s = data.summary || {};
      document.getElementById('incTotalPlans').textContent = s.totalPlans || 0;
      document.getElementById('incWinRate').textContent = (s.winRate || 0) + '%';

      const incomeEl = document.getElementById('incTotalIncome');
      const income = s.totalIncome || 0;
      incomeEl.textContent = income;
      incomeEl.style.color = income >= 0 ? '#EF4444' : '#22C55E';

      const records = data.records || [];
      if (records.length === 0) {
        resultEl.innerHTML = '<div class="hint-box">暂无方案收入数据</div>';
        return;
      }

      let html = '<div class="income-list">';
      html +=
        '<div class="income-header-row"><span>时间</span><span class="inc-col-hit">命中数</span><span class="inc-col-rate">命中率</span><span class="inc-col-income">盈利</span></div>';

      records.forEach(function (r) {
        const incColor = r.income >= 0 ? '#EF4444' : '#22C55E';
        const incPrefix = r.income >= 0 ? '' : '';
        const dateShort = r.date.slice(5).replace('-', '/');

        html +=
          '<div class="income-row">' +
          '<span class="income-date">' +
          dateShort +
          '</span>' +
          '<span class="income-hit">' +
          (r.hitCount || 0) +
          '/' +
          (r.totalPlans || 0) +
          '</span>' +
          '<span class="income-rate">' +
          (r.hitRate || 0) +
          '%</span>' +
          '<span class="income-value" style="color:' +
          incColor +
          '">' +
          r.income +
          '</span>' +
          '</div>';
      });
      html += '</div>';
      resultEl.innerHTML = html;
    })
    .catch(function (e) {
      resultEl.innerHTML = '<div class="loading">' + e.message + '</div>';
      incomeLoaded = false; // 失败后允许重试
    });
}

// ========== AI深度解析 ==========
// ★ P0-2: AI 轮询单例 — 同一时间只允许一个 AI 弹窗在轮询
let _aiActivePolling = null; // { matchId, timer, modalEl }

function showAIPrediction(matchId) {
  // ★ P0-2: 如果已有活跃的 AI 轮询，先清理旧的
  if (_aiActivePolling) {
    if (_aiActivePolling.timer) {
      clearInterval(_aiActivePolling.timer);
      _aiActivePolling.timer = null;
    }
    _aiActivePolling = null;
  }

  // 获取比赛信息
  const teams = document.querySelectorAll('#detailContent .team-name');
  const homeTeam = teams[0] ? teams[0].textContent : '主队';
  const awayTeam = teams[1] ? teams[1].textContent : '客队';

  // 显示加载态
  let html =
    '<div class="ai-modal-header"><span class="ai-modal-title">AI深度解析</span><button class="ai-modal-close" onclick="closeAI()">✕</button></div>';
  html +=
    '<div class="ai-content"><div style="text-align:center;padding:60px 20px;color:var(--cyan);"><div style="font-size:40px;margin-bottom:16px;">⏳</div><div style="font-size:16px;font-weight:600;">正在交叉分析中...</div><div style="font-size:12px;color:var(--text3);margin-top:8px;">DeepSeek + 豆包 双模型并行，先到先得</div></div></div>';
  document.getElementById('aiModal').innerHTML = html;
  document.getElementById('aiOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';

  // 注册为活跃轮询
  _aiActivePolling = { matchId: matchId, timer: null, modalEl: document.getElementById('aiModal') };

  // 轮询计时变量
  const pollStartTime = Date.now();
  let estimatedTotalSec = 35;
  let retryCount = 0;
  const maxRetries = 30;
  let pollTimer = null;
  const modalEl = document.getElementById('aiModal');

  function updateWaitUI() {
    const elapsed = Math.floor((Date.now() - pollStartTime) / 1000);
    const remaining = Math.max(1, estimatedTotalSec - elapsed);
    const progress = Math.min(98, Math.floor((elapsed / Math.max(estimatedTotalSec, 1)) * 100));

    const inner = modalEl ? modalEl.querySelector('.ai-content') : null;
    if (!inner) return;
    inner.innerHTML =
      '<div style="text-align:center;padding:60px 20px;">' +
      '<div style="font-size:40px;margin-bottom:16px;">⏳</div>' +
      '<div style="font-size:16px;font-weight:600;color:var(--cyan);">正在交叉分析中...</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:6px;">DeepSeek + 豆包 双模型并行，先到先得</div>' +
      '<div style="margin-top:20px;width:220px;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;margin-left:auto;margin-right:auto;">' +
      '<div style="width:' +
      progress +
      '%;height:100%;background:var(--cyan);border-radius:2px;transition:width 0.5s ease;"></div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:10px;">' +
      (remaining > 0 ? '首个结果预计还需约 ' + remaining + ' 秒' : '正在收尾，请稍候...') +
      '</div>' +
      '<div style="font-size:10px;color:var(--text3);margin-top:4px;">已等待 ' +
      elapsed +
      ' 秒</div>' +
      '</div>';
  }

  function startWaitUI() {
    updateWaitUI();
    pollTimer = setInterval(function () {
      if (pollTimer) updateWaitUI();
    }, 1000);
    // ★ P0-2: 同步到全局单例
    if (_aiActivePolling) _aiActivePolling.timer = pollTimer;
  }

  function stopWaitUI() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    // ★ P0-2: 清除全局单例引用
    if (_aiActivePolling && _aiActivePolling.timer === pollTimer) {
      _aiActivePolling.timer = null;
    }
  }

  // 渲染部分结果 + badge
  function renderAIContentWithBadge(content, ht, at, badge) {
    renderAIContent(content, ht, at);
    const dis = modalEl ? modalEl.querySelector('.ai-disclaimer') : null;
    if (dis) {
      dis.insertAdjacentHTML(
        'beforebegin',
        '<div style="margin:12px 20px;padding:8px 14px;border-radius:8px;background:rgba(34,211,238,0.08);border:1px solid rgba(34,211,238,0.2);font-size:12px;color:var(--cyan);text-align:center;">⏳ ' +
          (badge || '交叉验证中...') +
          '</div>',
      );
    }
  }

  // 调用 API
  api('ai-predict', { matchId: matchId })
    .then(function (d) {
      if (d.content) {
        stopWaitUI();
        if (d.pendingMerge) {
          const st = d.readySource === 'deepseek' ? 'DeepSeek' : d.readySource === 'doubao' ? '豆包' : '一方';
          renderAIContentWithBadge(d.content, homeTeam, awayTeam, st + '已完成，另一模型交叉验证中...');
          let mr = 0;
          (function pm() {
            mr++;
            if (mr > 30) return;
            setTimeout(function () {
              api('ai-predict', { matchId: matchId })
                .then(function (r2) {
                  if (r2.content && !r2.pendingMerge) renderAIContent(r2.content, homeTeam, awayTeam);
                  else pm();
                })
                .catch(function () {
                  pm();
                });
            }, 2000);
          })();
        } else {
          renderAIContent(d.content, homeTeam, awayTeam);
        }
      } else if (d.pending) {
        if (d.estimatedWait) estimatedTotalSec = Math.min(d.estimatedWait, 35);
        startWaitUI();

        function retry() {
          if (retryCount >= maxRetries) {
            stopWaitUI();
            const ac = document.getElementById('aiModal');
            if (ac) {
              const inner = ac.querySelector('.ai-content');
              if (inner)
                inner.innerHTML =
                  '<div style="text-align:center;padding:60px 20px;color:var(--amber);"><div style="font-size:40px;margin-bottom:12px;">⏰</div><div style="font-size:16px;font-weight:600;">分析生成超时</div><div style="font-size:12px;color:var(--text3);margin-top:8px;">双模型验证耗时较长，请稍后重试</div><button style="margin-top:20px;padding:10px 28px;border-radius:24px;background:var(--cyan);color:var(--bg);border:none;cursor:pointer;font-size:14px;font-weight:600;" onclick="showAIPrediction(\'' +
                  matchId +
                  '\')">重新生成</button></div>';
            }
            return;
          }
          retryCount++;
          api('ai-predict', { matchId: matchId })
            .then(function (rd) {
              if (rd.content) {
                stopWaitUI();
                if (rd.pendingMerge) {
                  const s2 = rd.readySource === 'deepseek' ? 'DeepSeek' : rd.readySource === 'doubao' ? '豆包' : '一方';
                  renderAIContentWithBadge(rd.content, homeTeam, awayTeam, s2 + '已完成，另一模型交叉验证中...');
                  let mr2 = 0;
                  (function pm2() {
                    mr2++;
                    if (mr2 > 30) return;
                    setTimeout(function () {
                      api('ai-predict', { matchId: matchId })
                        .then(function (r3) {
                          if (r3.content && !r3.pendingMerge) renderAIContent(r3.content, homeTeam, awayTeam);
                          else pm2();
                        })
                        .catch(function () {
                          pm2();
                        });
                    }, 2000);
                  })();
                } else {
                  renderAIContent(rd.content, homeTeam, awayTeam);
                }
              } else {
                setTimeout(retry, 2000);
              }
            })
            .catch(function () {
              setTimeout(retry, 2000);
            });
        }
        setTimeout(retry, 2000);
      } else {
        stopWaitUI();
        document.getElementById('aiModal').querySelector('.ai-content').innerHTML =
          '<div style="text-align:center;padding:60px 20px;color:var(--amber);">分析未就绪，请稍后重试</div>';
      }
    })
    .catch(function () {
      stopWaitUI();
      document.getElementById('aiModal').querySelector('.ai-content').innerHTML =
        '<div style="text-align:center;padding:60px 20px;color:var(--amber);">请求失败，请检查网络</div>';
    });
}

// 根据 API 返回的 content 渲染 AI 弹窗
function renderAIContent(content, homeTeam, awayTeam) {
  const c = content || {};
  const conf = typeof c.confidence === 'number' ? c.confidence : 70;
  const preds = c['预测建议'] || [];
  const baseStr = c['基础面'] || {};
  const stateStr = c['状态面'] || {};
  const motiStr = c['动机面'] || {};
  const posStr = c['对位面'] || {};
  const mktStr = c['市场面'] || {};
  const highlight = c['核心看点'] || {};
  const baseTable = baseStr['攻防全景数据'];

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // 智能截断：优先在句号处截断
  function clip(s, max) {
    s = s || '';
    if (s.length <= max) return s;
    let idx = s.lastIndexOf('。', max);
    if (idx > max * 0.5) return s.substring(0, idx + 1);
    idx = s.lastIndexOf('，', max);
    if (idx > max * 0.5) return s.substring(0, idx) + '...';
    return s.substring(0, max - 3) + '...';
  }
  // 如果内容为空返回假
  function has(s) {
    return s && (typeof s === 'string' ? s.trim().length > 0 : true);
  }

  let html = '';
  html +=
    '<div class="ai-modal-header"><span class="ai-modal-title">AI深度解析</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>';
  html += '<div class="ai-content">';

  // ── 比赛信息 ──
  html +=
    '<div class="ai-match-info"><div class="ai-team"><div class="ai-team-logo">' +
    esc(homeTeam[0]) +
    '</div><div class="ai-team-name">' +
    esc(homeTeam) +
    '</div></div><div class="ai-vs-section"><div class="ai-vs-text">VS</div></div><div class="ai-team"><div class="ai-team-logo away">' +
    esc(awayTeam[0]) +
    '</div><div class="ai-team-name">' +
    esc(awayTeam) +
    '</div></div></div>';

  // ── AI核心观点 ──
  const coreView = esc(highlight['核心看点'] || c['核心观点'] || '');
  const varRemind = esc(highlight['变数提醒'] || c['变数提醒'] || '');
  const icons = ['🏆', '⚽', '📊'];
  html += '<div class="ai-core-view">';
  html +=
    '<div class="ai-core-header"><span class="ai-core-icon">💡</span><span class="ai-core-title">AI核心观点</span></div>';
  html += '<div class="ai-core-content">' + clip(coreView, 120) + '</div>';
  if (varRemind) html += '<div class="ai-core-desc">' + clip(varRemind, 80) + '</div>';
  html += '<div class="ai-predict-row">';
  preds.forEach(function (p, i) {
    const val = esc(p['建议方向'] || '');
    html += '<div class="ai-predict-card">';
    html +=
      '<div class="ai-predict-head"><span class="ai-predict-icon">' +
      (icons[i] || '●') +
      '</span><span class="ai-predict-name">' +
      esc(p['玩法'] || '') +
      '</span></div>';
    html += '<div class="ai-predict-value">' + val + '</div>';
    html += '<div class="ai-predict-line"></div>';
    html += '<div class="ai-predict-sub">' + clip(esc(p['核心逻辑'] || ''), 50) + '</div>';
    html += '</div>';
  });
  html += '</div></div>';

  // ═══ 01 基础面 ═══
  const bRank = baseStr['积分排名'] || '';
  const bHasRank = bRank.length > 5;
  const bHasTable = baseTable && baseTable.rows && baseTable.rows.length >= 3;
  const bHasBaseCon = has(baseStr['核心结论']);
  if (bHasRank || bHasTable || bHasBaseCon) {
    html +=
      '<div id="ai-sec-01" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">01</span><span class="ai-sec-name">基础面</span>';
    if (baseStr['概括']) html += '<span class="ai-sec-desc">' + clip(esc(baseStr['概括']), 20) + '</span>';
    html += '</div>';
    if (bHasRank) {
      // 智能拆分主客队排名：队名→句号→首字多级匹配
      let rankHome = '',
        rankAway = '';
      let idxH = -1,
        idxA = -1;
      // 1. 全名匹配
      idxH = bRank.indexOf(homeTeam);
      idxA = bRank.indexOf(awayTeam);
      // 2. 队名前两字匹配
      if (idxH < 0 && homeTeam.length >= 2) idxH = bRank.indexOf(homeTeam.substring(0, 2));
      if (idxA < 0 && awayTeam.length >= 2) idxA = bRank.indexOf(awayTeam.substring(0, 2));
      // 3. 队名首字匹配
      if (idxH < 0) idxH = bRank.indexOf(homeTeam[0]);
      if (idxA < 0) idxA = bRank.indexOf(awayTeam[0]);
      // 4. 单队匹配时按句号分拆
      if (idxH >= 0 && idxA < 0) {
        var dots = [];
        for (var di = idxH + 1; di < bRank.length; di++) {
          if (bRank[di] === '。' || bRank[di] === '；') dots.push(di);
        }
        if (dots.length > 0 && dots[0] > idxH && dots[0] < bRank.length - 3) {
          idxA = dots[0] + 1;
        }
      } else if (idxA >= 0 && idxH < 0) {
        var dots = [];
        for (var di = idxA + 1; di < bRank.length; di++) {
          if (bRank[di] === '。' || bRank[di] === '；') dots.push(di);
        }
        if (dots.length > 0 && dots[0] > idxA && dots[0] < bRank.length - 3) {
          idxH = dots[0] + 1;
        }
      }
      // 按位置分段
      if (idxH >= 0 && idxA >= 0) {
        if (idxA > idxH) {
          rankHome = clip(esc(bRank.substring(0, idxA)), 60);
          rankAway = clip(esc(bRank.substring(idxA)), 60);
        } else {
          rankAway = clip(esc(bRank.substring(0, idxH)), 60);
          rankHome = clip(esc(bRank.substring(idxH)), 60);
        }
      }
      if (rankHome || rankAway) {
        html +=
          '<div class="ai-rank-dual"><div class="ai-rank-col"><div class="ai-rank-h">' +
          esc(homeTeam) +
          '</div><div class="ai-rank-val">' +
          (rankHome || '\u2014') +
          '</div></div><div class="ai-rank-col"><div class="ai-rank-h">' +
          esc(awayTeam) +
          '</div><div class="ai-rank-val">' +
          (rankAway || '\u2014') +
          '</div></div></div>';
      } else {
        html += '<div class="ai-rank-single"><div class="ai-rank-val">' + clip(esc(bRank), 120) + '</div></div>';
      }
    }
    if (bHasTable) {
      html += '<div class="ai-data-compare"><div class="ai-data-title">攻防数据对比</div>';
      baseTable.rows.forEach(function (row) {
        if (row.length < 3) return;
        const label = row[0],
          hv = row[1],
          av = row[2];
        const isShooter = label.indexOf('射手') >= 0;
        if (isShooter) {
          html +=
            '<div class="ai-shooter-dual"><div class="ai-shooter-item home"><span class="ai-shooter-tag">主</span><span class="ai-shooter-desc">' +
            esc(hv) +
            '</span></div><div class="ai-shooter-divider"></div><div class="ai-shooter-item away"><span class="ai-shooter-tag">客</span><span class="ai-shooter-desc">' +
            esc(av) +
            '</span></div></div>';
        } else {
          const hn = parseFloat(hv),
            an = parseFloat(av);
          const hp = isNaN(hn) || isNaN(an) ? 50 : Math.round((hn / (hn + an)) * 100);
          html +=
            '<div class="ai-data-row"><span class="ai-data-label">' +
            esc(label) +
            '</span><span class="ai-data-home">' +
            esc(hv) +
            '</span><div class="ai-progress-bar"><div class="ai-progress" style="width:' +
            hp +
            '%"></div></div><span class="ai-data-away">' +
            esc(av) +
            '</span></div>';
        }
      });
      html += '</div>';
    }
    if (bHasBaseCon)
      html +=
        '<div class="ai-item-conclusion"><div class="ai-item-label">核心结论</div><div class="ai-item-text">' +
        clip(esc(baseStr['核心结论']), 120) +
        '</div></div>';
    html += '</div>';
  }

  // ═══ 02 状态面 ═══
  const hf = (stateStr['主队近况'] || '').match(/(\d+)胜(\d+)平(\d+)负/),
    af = (stateStr['客队近况'] || '').match(/(\d+)胜(\d+)平(\d+)负/);
  const hasHistory = has(stateStr['历史对阵']);
  const injTable = stateStr['伤病影响'];
  const hasInj = injTable && injTable.rows && injTable.rows.length;
  const hasStateCon = has(stateStr['核心结论']);
  if (hf || af || hasHistory || hasInj || hasStateCon) {
    html +=
      '<div id="ai-sec-02" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">02</span><span class="ai-sec-name">状态面</span></div>';
    if (hf || af) {
      html += '<div class="ai-form-title">近期战绩对比</div>';
    }
    if (hf) {
      html += '<div class="ai-form-row"><span class="ai-form-label">' + esc(homeTeam) + '</span>';
      for (var i = 0; i < parseInt(hf[1]); i++) html += '<span class="ai-form-dot w">W</span>';
      for (i = 0; i < parseInt(hf[2]); i++) html += '<span class="ai-form-dot d">D</span>';
      for (i = 0; i < parseInt(hf[3]); i++) html += '<span class="ai-form-dot l">L</span>';
      html += '<span class="ai-form-summary">' + hf[1] + 'W ' + hf[2] + 'D ' + hf[3] + 'L</span></div>';
    }
    if (af) {
      html += '<div class="ai-form-row"><span class="ai-form-label">' + esc(awayTeam) + '</span>';
      for (var i = 0; i < parseInt(af[1]); i++) html += '<span class="ai-form-dot w">W</span>';
      for (i = 0; i < parseInt(af[2]); i++) html += '<span class="ai-form-dot d">D</span>';
      for (i = 0; i < parseInt(af[3]); i++) html += '<span class="ai-form-dot l">L</span>';
      html += '<span class="ai-form-summary">' + af[1] + 'W ' + af[2] + 'D ' + af[3] + 'L</span></div>';
    }
    if (hasHistory)
      html +=
        '<div class="ai-item"><div class="ai-item-label">历史交锋</div><div class="ai-item-text">' +
        clip(esc(stateStr['历史对阵']), 120) +
        '</div></div>';
    if (hasInj) {
      html += '<div class="ai-injury-title">伤停对比</div>';
      injTable.rows.forEach(function (row) {
        if (row.length < 3) return;
        const isHome = row[0].indexOf('主') >= 0 || row[0].indexOf(homeTeam) >= 0;
        const tag = isHome ? esc(homeTeam[0]) : esc(awayTeam[0]);
        const tagClass = isHome ? 'home' : 'away';
        html +=
          '<div class="ai-injury-row"><div class="ai-injury-head"><span class="ai-injury-badge ' +
          tagClass +
          '">' +
          tag +
          '</span><span class="ai-injury-team">' +
          esc(row[0]) +
          '</span></div><div class="ai-injury-detail">' +
          esc(row[1]) +
          '</div></div>';
      });
    }
    if (hasStateCon)
      html +=
        '<div class="ai-item-conclusion"><div class="ai-item-label">核心结论</div><div class="ai-item-text">' +
        clip(esc(stateStr['核心结论']), 120) +
        '</div></div>';
    html += '</div>';
  }

  // ═══ 03 动机面 ═══
  const hasWill = has(motiStr['战意强度']);
  html +=
    '<div id="ai-sec-03" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">03</span><span class="ai-sec-name">动机面</span></div>';
  if (hasWill)
    html +=
      '<div class="ai-item"><div class="ai-item-label">战意强度</div><div class="ai-item-text">' +
      clip(esc(motiStr['战意强度']), 120) +
      '</div></div>';
  html += '</div>';

  // ═══ 04 对位面 ═══
  const posGood = has(posStr['攻防博弈']) || has(posStr['节奏控制']);
  const posBad = has(posStr['主场氛围']) || has(posStr['战术与教练风格']);
  const hasPosCon = has(posStr['核心结论']);
  if (posGood || posBad || hasPosCon) {
    html +=
      '<div id="ai-sec-04" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">04</span><span class="ai-sec-name">对位面</span></div>';
    html += '<div class="ai-swp-grid">';
    // 主队优势
    html +=
      '<div class="ai-swp-card good"><div class="ai-swp-card-head"><span class="ai-swp-card-icon good">\u25B2</span><span class="ai-swp-card-label">主队优势</span></div>';
    if (has(posStr['攻防博弈']))
      html += '<div class="ai-swp-card-item">' + clip(esc(posStr['攻防博弈']), 70) + '</div>';
    if (has(posStr['节奏控制']))
      html += '<div class="ai-swp-card-item">' + clip(esc(posStr['节奏控制']), 70) + '</div>';
    html += '</div>';
    // 客队隐患
    html +=
      '<div class="ai-swp-card bad"><div class="ai-swp-card-head"><span class="ai-swp-card-icon bad">\u25BC</span><span class="ai-swp-card-label">客队隐患</span></div>';
    if (has(posStr['主场氛围']))
      html += '<div class="ai-swp-card-item">' + clip(esc(posStr['主场氛围']), 70) + '</div>';
    if (has(posStr['战术与教练风格']))
      html += '<div class="ai-swp-card-item">' + clip(esc(posStr['战术与教练风格']), 70) + '</div>';
    html += '</div></div>';
    if (hasPosCon)
      html +=
        '<div class="ai-item-conclusion amber"><div class="ai-item-label">综合判断</div><div class="ai-item-text">' +
        clip(esc(posStr['核心结论']), 120) +
        '</div></div>';
    html += '</div>';
  }

  // ═══ 05 市场面 ═══
  const hasOdds = has(mktStr['盘口与赔率']) || has(mktStr['大小球']);
  const hasMktCon = has(mktStr['核心结论']);
  if (hasOdds || hasMktCon) {
    html +=
      '<div id="ai-sec-05" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">05</span><span class="ai-sec-name">市场面</span></div>';
    // 支持率数据：优先使用AI置信度推导，否则不显示进度条
    if (has(mktStr['盘口与赔率']))
      html +=
        '<div class="ai-item"><div class="ai-item-label">盘口与赔率</div><div class="ai-item-text">' +
        clip(esc(mktStr['盘口与赔率']), 120) +
        '</div></div>';
    if (has(mktStr['大小球']))
      html +=
        '<div class="ai-item"><div class="ai-item-label">大小球</div><div class="ai-item-text">' +
        clip(esc(mktStr['大小球']), 120) +
        '</div></div>';
    if (hasMktCon)
      html +=
        '<div class="ai-item-conclusion amber"><div class="ai-item-label">市场解读</div><div class="ai-item-text">' +
        clip(esc(mktStr['核心结论']), 120) +
        '</div></div>';
    html += '</div>';
  }

  // ═══ 06 预测建议 ═══
  html +=
    '<div id="ai-sec-06" class="ai-section-content" style="border-left-color:rgba(52,211,153,0.3)"><div class="ai-sec-title"><span class="ai-sec-num">06</span><span class="ai-sec-name">预测建议</span></div><div class="ai-predict-table">';
  preds.forEach(function (p) {
    html +=
      '<div class="ai-predict-tr"><span class="ai-predict-td type">' +
      esc(p['玩法'] || '') +
      '</span><span class="ai-predict-td suggest">' +
      esc(p['建议方向'] || '') +
      '</span><span class="ai-predict-td logic">' +
      esc(p['核心逻辑'] || '') +
      '</span><span class="ai-predict-td check">\u2713</span></div>';
  });
  html += '</div></div>';
  html += '<div class="ai-disclaimer">本分析为AI生成，仅供参考，请理性对待</div>';

  html += '</div>';
  document.getElementById('aiModal').innerHTML = html;
}

function closeAI() {
  // ★ P0-2: 清理活跃轮询
  if (_aiActivePolling) {
    if (_aiActivePolling.timer) {
      clearInterval(_aiActivePolling.timer);
      _aiActivePolling.timer = null;
    }
    _aiActivePolling = null;
  }
  document.getElementById('aiOverlay').classList.remove('active');
  document.body.style.overflow = '';
}

// ========== 排行榜日期切换 ==========
var rankDate = '';
var rankDateOffset = 0;

function updateRankDateBar() {
  const d = new Date();
  d.setDate(d.getDate() + rankDateOffset);
  rankDate =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const el = document.getElementById('rankDateCurrent');
  if (!el) return;
  const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const week = weekNames[d.getDay()];
  const mmdd = String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
  const today = new Date().toDateString() === d.toDateString();
  const prefix = today ? '今天 ' : '';
  el.textContent = prefix + mmdd + ' ' + week;
}

function shiftRankDate(delta) {
  const newOffset = rankDateOffset + delta;
  const d = new Date();
  d.setDate(d.getDate() + newOffset);
  const newDate =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  if (newDate < MIN_PLAN_DATE) return; // 不早于4月25日
  rankDateOffset = newOffset;
  updateRankDateBar();
  loadRanking();
}

function goRankToday() {
  rankDateOffset = 0;
  updateRankDateBar();
  loadRanking();
}

// ========== 今日方案 ==========
var planDate = ''; // YYYY-MM-DD
let planDateOffset = 0;
var planTab = 'expert'; // 'expert' | 'score'
var MIN_PLAN_DATE = '2026-03-19'; // 最早有数据的日期

function updatePlanDateBar() {
  const d = new Date();
  d.setDate(d.getDate() + planDateOffset);
  planDate =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const el = document.getElementById('planDateCurrent');
  if (!el) return;
  const today = new Date();
  const todayStr =
    today.getFullYear() +
    '-' +
    String(today.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(today.getDate()).padStart(2, '0');
  const prefix = planDate === todayStr ? '今天 ' : '';
  const mmdd = planDate.slice(5).replace('-', '/');
  const week = WEEK_NAMES[new Date(planDate).getDay()];
  el.textContent = prefix + mmdd + ' ' + week;
}

function shiftPlanDate(delta) {
  const newOffset = planDateOffset + delta;
  const d = new Date();
  d.setDate(d.getDate() + newOffset);
  const newDate =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  if (newDate < MIN_PLAN_DATE) return; // 不早于4月25日
  planDateOffset = newOffset;
  updatePlanDateBar();
  if (planTab === 'expert') loadPlanList();
  else loadScorePlanList();
}

function goPlanToday() {
  planDateOffset = 0;
  updatePlanDateBar();
  if (planTab === 'expert') loadPlanList();
  else loadScorePlanList();
}

function switchPlanTab(tab) {
  planTab = tab;
  // 更新标签栏样式
  document.querySelectorAll('#planTabBar .filter-tag').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });
  // 加载对应方案
  if (tab === 'expert') loadPlanList();
  else loadScorePlanList();
}

function loadPlanList() {
  const el = document.getElementById('planList');
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载方案中...</div>';

  const params = { date: planDate };
  api('plan-list', params)
    .then(function (data) {
      if (data.date && data.date !== planDate) {
        planDate = data.date;
        const planEl = document.getElementById('planDateCurrent');
        if (planEl) {
          const mmdd = data.date.slice(5).replace('-', '/');
          planEl.textContent = mmdd + ' ' + WEEK_NAMES[new Date(data.date).getDay()];
        }
      }
      const plans = data.plans || [];
      if (plans.length === 0) {
        // 当天无方案时自动回退到最近有方案的日期
        const now = new Date();
        const todayStr =
          now.getFullYear() +
          '-' +
          String(now.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(now.getDate()).padStart(2, '0');
        if (planDate === todayStr) {
          const d2 = new Date();
          d2.setDate(d2.getDate() + planDateOffset - 1);
          const prevDateStr =
            d2.getFullYear() +
            '-' +
            String(d2.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(d2.getDate()).padStart(2, '0');
          if (prevDateStr >= MIN_PLAN_DATE) {
            planDateOffset--;
            updatePlanDateBar();
            loadPlanList();
            return;
          }
        }
        el.innerHTML =
          '<div style=\"text-align:center;padding:80px 0;color:var(--text3);font-size:14px;\">当日暂无竞彩方案</div>';
        return;
      }

      el.innerHTML = plans
        .map(function (p, i) {
          const matches = p.matches || [];

          // 判断方案整体中奖状态
          let isWon = false,
            isLose = false;
          let allWon = matches.length > 0;
          let anyLose = false,
            anyUndetermined = false;
          for (let mi2 = 0; mi2 < matches.length; mi2++) {
            if (!matches[mi2].isMatchWon) allWon = false;
            if (matches[mi2].isMatchLose) anyLose = true;
            if (!matches[mi2].isMatchWon && !matches[mi2].isMatchLose) anyUndetermined = true;
          }
          isWon = allWon;
          isLose = anyLose && !isWon;
          if (anyUndetermined) {
            isWon = false;
            isLose = false;
          }

          const planName = p.planName || '方案' + (i + 1);

          // 金额
          const amountVal = (p.amount || 1000).toFixed(0);
          const prizeVal = (p.maxPrize || 0).toFixed(0);
          const prizeLabel = isWon ? '中奖金额' : isLose ? '预计奖金' : '预计最高奖金';

          // 截单时间：基于第一场比赛开赛时间，提前30分钟；周一至五22:00之后截单21:30；周六日23:00之后截单22:30
          let cutoffDisplay = '';
          if (matches.length > 0 && matches[0].startTime) {
            const stParts = matches[0].startTime.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
            if (stParts) {
              const stMonth = parseInt(stParts[1]) - 1,
                stDay = parseInt(stParts[2]),
                stHour = parseInt(stParts[3]),
                stMin = parseInt(stParts[4]);
              const pYear = parseInt(planDate.slice(0, 4));
              const kickoff = new Date(pYear, stMonth, stDay, stHour, stMin);
              if (!isNaN(kickoff.getTime())) {
                const mp = planDate.split('-');
                const matchDateOnly = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]));
                const kickoffDateOnly = new Date(kickoff.getFullYear(), kickoff.getMonth(), kickoff.getDate());
                const isCrossMidnight = kickoffDateOnly > matchDateOnly;
                let cutoff;
                if (isCrossMidnight) {
                  // 跨日比赛：用比赛日期的星期几，固定晚间截单
                  const matchDow = matchDateOnly.getDay();
                  if (matchDow >= 1 && matchDow <= 5)
                    cutoff = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]), 21, 30);
                  else cutoff = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]), 22, 30);
                } else {
                  cutoff = new Date(kickoff.getTime() - 30 * 60 * 1000);
                  const dow = kickoff.getDay();
                  if (dow >= 1 && dow <= 5 && stHour >= 22) cutoff = new Date(pYear, stMonth, stDay, 21, 30);
                  else if ((dow === 0 || dow === 6) && stHour >= 23) cutoff = new Date(pYear, stMonth, stDay, 22, 30);
                }
                const pad2 = function (n) {
                  return String(n).padStart(2, '0');
                };
                cutoffDisplay =
                  '截单时间：' +
                  pad2(cutoff.getMonth() + 1) +
                  '/' +
                  pad2(cutoff.getDate()) +
                  ' ' +
                  pad2(cutoff.getHours()) +
                  ':' +
                  pad2(cutoff.getMinutes());
              }
            }
          }

          // 辅助：解析某场比赛的方向赔率显示（含子方向中/未中着色）
          function resolveMatchOddsHtml(match, planIdx) {
            const dir = match.direction || '';
            const oddsObj = match.odds || {};
            const parts = dir ? dir.split(/[、，,]/) : [];
            const subResults = match.subResults || [];
            const resolved = [];

            let commonPrefix = '';
            if (parts.length > 1 && parts[0].length > 1) {
              for (let cl = 1; cl <= parts[0].length; cl++) {
                const cand = parts[0].substring(0, cl);
                let ok = true;
                for (let pi = 1; pi < parts.length; pi++) {
                  if (parts[pi].indexOf(cand) !== 0) {
                    ok = false;
                    break;
                  }
                }
                if (!ok) break;
                commonPrefix = cand;
              }
            }

            parts.forEach(function (pt) {
              const label = pt.trim();
              const ft = commonPrefix ? commonPrefix + label.replace(commonPrefix, '') : label.trim();
              let val = null;
              let isRQ = false; // 标记是否已尝试RQ取值（防止fallback到SPF）

              if (ft === '让胜' || ft.indexOf('让胜') >= 0) {
                val = oddsObj.rqspf && oddsObj.rqspf.home;
                isRQ = true;
              } else if (ft === '让平' || ft.indexOf('让平') >= 0) {
                val = oddsObj.rqspf && oddsObj.rqspf.draw;
                isRQ = true;
              } else if (ft === '让负' || ft.indexOf('让负') >= 0) {
                val = oddsObj.rqspf && oddsObj.rqspf.away;
                isRQ = true;
              } else if (ft.indexOf('总进球') >= 0 && oddsObj.totalGoals) {
                const gm = ft.match(/(\d+\+?)/);
                if (gm) val = oddsObj.totalGoals[gm[1]];
              }
              // 总进球子选项（如"3球"）：不含"总进球"前缀的回退
              if (!val && ft.indexOf('球') >= 0 && oddsObj.totalGoals) {
                const gm2 = ft.match(/(\d+\+?)/);
                if (gm2) val = oddsObj.totalGoals[gm2[1]];
              }
              // 半全场方向（半全场-胜胜、半全场-平胜 等）
              const isHalfFull = ft.indexOf('半全场-') === 0;
              if (!val && isHalfFull && oddsObj.halfFull) {
                const hfName = ft.replace('半全场-', '');
                const hfMap = {
                  胜胜: 'hh',
                  平胜: 'dh',
                  胜负: 'ha',
                  胜平: 'hd',
                  平平: 'dd',
                  平负: 'da',
                  负胜: 'ah',
                  负平: 'ad',
                  负负: 'aa',
                };
                const hfKey = hfMap[hfName];
                if (hfKey) val = oddsObj.halfFull[hfKey];
              }
              // SPF fallback 仅对非RQ/非总进球方向生效
              // ★ 半全场无赔率数据时不回退到SPF（SPF赔率与半全场差异太大）
              if (!val && !isRQ && !isHalfFull) {
                if (ft.indexOf('胜') >= 0 && ft.length <= 2) val = oddsObj.spf && oddsObj.spf.home;
                else if (ft.indexOf('平') >= 0 && ft.length <= 2) val = oddsObj.spf && oddsObj.spf.draw;
                else if (ft.indexOf('负') >= 0 && ft.length <= 2) val = oddsObj.spf && oddsObj.spf.away;
              }
              if (!val && !isRQ && oddsObj.spf) val = oddsObj.spf.home || oddsObj.spf.draw || oddsObj.spf.away;

              // 查找此子方向的结果状态
              let subR = null;
              for (let si = 0; si < subResults.length; si++) {
                if (subResults[si].direction === label) {
                  subR = subResults[si];
                  break;
                }
              }
              let subCls = '';
              if (subR && subR.result !== null && subR.result !== undefined) {
                subCls =
                  subR.result === 1
                    ? ' plan-direction-hit'
                    : subR.result === -1
                      ? ' plan-direction-undetermined'
                      : ' plan-direction-miss';
              }

              let displayLabel = label;
              if (displayLabel.indexOf('总进球-') === 0) {
                displayLabel = displayLabel.replace('总进球-', '');
                if (displayLabel.indexOf('球') < 0) displayLabel += '球';
              }
              if (val) resolved.push('<span class=\"' + subCls + '\">' + displayLabel + '(' + val + ')</span>');
              else resolved.push('<span class=\"' + subCls + '\">' + displayLabel + '(-)</span>');
            });
            return resolved.join('<span style=\"color:#fff\"> + </span>');
          }

          // 构建比赛表格行
          let matchRows = '';
          for (let mi = 0; mi < matches.length; mi++) {
            const m = matches[mi];
            const isMw = m.isMatchWon === true;
            const isMl = m.isMatchLose === true;
            const matchOddsHtml = resolveMatchOddsHtml(m, i);

            const numText = m.matchNum || '';
            let matchDateShort = '',
              matchTime = '';
            if (m.startTime) {
              const tm = m.startTime.match(/(\d{2}:\d{2})/);
              if (tm) matchTime = tm[1];
              const dm = m.startTime.match(/(\d{2})\/(\d{2})/) || m.startTime.match(/(\d{2})-(\d{2})/);
              if (dm) matchDateShort = dm[1] + '/' + dm[2];
            }
            const timeDisp = matchDateShort || matchTime ? (matchDateShort + ' ' + matchTime).trim() : '';

            matchRows +=
              '<tr>' +
              '<td class="match-info-col">' +
              '<div class="match-num-text">' +
              numText +
              '</div>' +
              (timeDisp ? '<div class="match-time-sub">' + timeDisp + '</div>' : '') +
              '</td>' +
              '<td class="team-col">' +
              '<span class="plan-team-home">' +
              (m.homeName || '') +
              '</span>' +
              '<span class="plan-team-vs">vs</span>' +
              '<span class="plan-team-away">' +
              (m.visitName || '') +
              '</span>' +
              '</td>' +
              '<td class="odds-col">' +
              matchOddsHtml +
              '</td>' +
              '</tr>';
          }

          return (
            '<div class="plan-card">' +
            // ═══ 头部 ═══
            '<div class="plan-card-head">' +
            '<div class="plan-left">' +
            '<span class="plan-soccer-icon"><img src="/assets/plan_icon.png?v=1" alt="" decoding="async"/></span>' +
            '<span class="plan-name">' +
            planName +
            '</span>' +
            '</div>' +
            '<span class="plan-pub-time">' +
            cutoffDisplay +
            '</span>' +
            '</div>' +
            // ═══ 数据行 ═══
            '<div class="plan-amount-row">' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">方案金额</div>' +
            '<div class="plan-amount-value plan-money-value">' +
            amountVal +
            '<span class="unit">元</span></div>' +
            '</div>' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">' +
            prizeLabel +
            '</div>' +
            '<div class="plan-amount-value plan-money-value">' +
            prizeVal +
            '<span class="unit">元</span></div>' +
            '</div>' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">方案状态</div>' +
            '<div class="plan-amount-value plan-status-' +
            (isWon ? 'won' : isLose ? 'lost' : 'pending') +
            '">' +
            (isWon ? '已中奖' : isLose ? '未中奖' : '未开奖') +
            '</div>' +
            '</div>' +
            '</div>' +
            // ═══ 分割线 ═══
            '<div class="plan-divider"></div>' +
            // ═══ 方案信息 ═══
            '<div class="plan-info-grid">' +
            '<div class="plan-info-left">' +
            '<div>玩法</div>' +
            '<div>场数/过关</div>' +
            '<div>注数/倍/票</div>' +
            '</div>' +
            '<div class="plan-info-right">' +
            '<div>' +
            (p.playType || '混合投注') +
            '</div>' +
            '<div>' +
            ((p.matchCount || 1) + '场' + (p.passType || '单关')) +
            '</div>' +
            '<div>' +
            (p.betCount || 250) +
            '注' +
            (p.multiplier || 25) +
            '倍' +
            (p.ticketCount || 10) +
            '票</div>' +
            '</div>' +
            (isWon
              ? '<div class="plan-win-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#EF4444" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="18" font-weight="900" fill="#EF4444" transform="rotate(-10,19,19)">中</text></svg></div>'
              : '') +
            (isLose
              ? '<div class="plan-lose-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#9AA6B2" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="16" font-weight="900" fill="#9AA6B2" transform="rotate(-10,19,19)">未中</text></svg></div>'
              : '') +
            '</div>' +
            // ═══ 比赛表格 ═══
            '<div class="plan-match-section">' +
            '<table class="plan-match-table">' +
            '<thead><tr><th>场次</th><th>对阵</th><th>方向(赔率)</th></tr></thead>' +
            '<tbody>' +
            matchRows +
            '</tbody>' +
            '</table>' +
            '</div>' +
            '</div>'
          );
        })
        .join('');
    })
    .catch(function (e) {
      el.innerHTML = '<div style="text-align:center;padding:80px 0;color:var(--text3);">' + e.message + '</div>';
    });
}

// ========== 比分方案 ==========
function loadScorePlanList() {
  const el = document.getElementById('planList');
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载单关比分方案中...</div>';

  const params = { date: planDate };
  api('score-plan-list', params)
    .then(function (data) {
      if (data.date && data.date !== planDate) {
        planDate = data.date;
        const planEl = document.getElementById('planDateCurrent');
        if (planEl) {
          const mmdd = data.date.slice(5).replace('-', '/');
          planEl.textContent = mmdd + ' ' + WEEK_NAMES[new Date(data.date).getDay()];
        }
      }
      const plans = data.plans || [];
      const notice = data.notice || '';

      // 显示提示信息
      if (plans.length === 0) {
        if (notice) {
          el.innerHTML =
            '<div class="plan-notice"><span class="notice-icon"><img src="/assets/expressionless-face.svg" width="32" height="32" alt="" decoding="async"/></span>' +
            notice +
            '</div>';
        } else {
          const now = new Date();
          const todayStr =
            now.getFullYear() +
            '-' +
            String(now.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(now.getDate()).padStart(2, '0');
          if (planDate === todayStr) {
            const d2 = new Date();
            d2.setDate(d2.getDate() + planDateOffset - 1);
            const prevDateStr =
              d2.getFullYear() +
              '-' +
              String(d2.getMonth() + 1).padStart(2, '0') +
              '-' +
              String(d2.getDate()).padStart(2, '0');
            if (prevDateStr >= MIN_PLAN_DATE) {
              planDateOffset--;
              updatePlanDateBar();
              loadScorePlanList();
              return;
            }
          }
          el.innerHTML =
            '<div class="plan-notice"><span class="notice-icon">📊</span>今日暂无符合条件的单关比分方案</div>';
        }
        return;
      }

      el.innerHTML = plans
        .map(function (p, i) {
          const scores = p.selectedScores || [];
          const isWon = p.isScoreWon || false;
          const isLose = p.isScoreLose || false;

          // 截单时间
          let cutoffDisplay = '';
          if (p.startTime) {
            const stParts = p.startTime.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
            if (stParts) {
              const stMonth = parseInt(stParts[1]) - 1,
                stDay = parseInt(stParts[2]),
                stHour = parseInt(stParts[3]),
                stMin = parseInt(stParts[4]);
              const pYear = parseInt(planDate.slice(0, 4));
              const kickoff = new Date(pYear, stMonth, stDay, stHour, stMin);
              if (!isNaN(kickoff.getTime())) {
                const mp = planDate.split('-');
                const matchDateOnly = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]));
                const kickoffDateOnly = new Date(kickoff.getFullYear(), kickoff.getMonth(), kickoff.getDate());
                const isCrossMidnight = kickoffDateOnly > matchDateOnly;
                let cutoff;
                if (isCrossMidnight) {
                  const matchDow = matchDateOnly.getDay();
                  if (matchDow >= 1 && matchDow <= 5)
                    cutoff = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]), 21, 30);
                  else cutoff = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]), 22, 30);
                } else {
                  cutoff = new Date(kickoff.getTime() - 30 * 60 * 1000);
                  const dow = kickoff.getDay();
                  if (dow >= 1 && dow <= 5 && stHour >= 22) cutoff = new Date(pYear, stMonth, stDay, 21, 30);
                  else if ((dow === 0 || dow === 6) && stHour >= 23) cutoff = new Date(pYear, stMonth, stDay, 22, 30);
                }
                const pad2 = function (n) {
                  return String(n).padStart(2, '0');
                };
                cutoffDisplay =
                  '截单时间：' +
                  pad2(cutoff.getMonth() + 1) +
                  '/' +
                  pad2(cutoff.getDate()) +
                  ' ' +
                  pad2(cutoff.getHours()) +
                  ':' +
                  pad2(cutoff.getMinutes());
              }
            }
          }

          const amountVal = (p.amount || 1000).toFixed(0);
          const prizeNum = isWon ? p.winningPrize || 0 : p.maxPrize || 0;
          const prizeVal = prizeNum > 0 ? prizeNum.toFixed(0) : isWon ? '--' : '0';
          const prizeLabel = isWon ? '中奖金额' : isLose ? '预计奖金' : '预计最高奖金';
          const statusText = isWon ? '已中奖' : isLose ? '未中奖' : '未开奖';

          // 比分标签
          let scoreTags = '';
          for (let si = 0; si < scores.length; si++) {
            const s = scores[si];
            scoreTags += '<span class="plan-score-tag">' + s.score + ' (' + s.odds.toFixed(2) + ')</span>';
          }

          // 队伍对阵行
          const teamRow = (p.homeName || '') + ' vs ' + (p.visitName || '');

          return (
            '<div class="plan-card score-plan">' +
            // 头部
            '<div class="plan-card-head">' +
            '<div class="plan-left">' +
            '<span class="plan-soccer-icon"><img src="/assets/plan_icon.png?v=1" alt="" decoding="async"/></span>' +
            '<span class="plan-name" style="color: var(--amber);">' +
            (p.planName || '单关比分方案') +
            '</span>' +
            '</div>' +
            '<span class="plan-pub-time">' +
            cutoffDisplay +
            '</span>' +
            '</div>' +
            // 数据行
            '<div class="plan-amount-row">' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">方案金额</div>' +
            '<div class="plan-amount-value plan-money-value">' +
            amountVal +
            '<span class="unit">元</span></div>' +
            '</div>' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">' +
            prizeLabel +
            '</div>' +
            '<div class="plan-amount-value plan-money-value">' +
            prizeVal +
            '<span class="unit">元</span></div>' +
            '</div>' +
            '<div class="plan-amount-col">' +
            '<div class="plan-amount-label">方案状态</div>' +
            '<div class="plan-amount-value plan-status-' +
            (isWon ? 'won' : isLose ? 'lost' : 'pending') +
            '">' +
            statusText +
            '</div>' +
            '</div>' +
            '</div>' +
            // 分割线
            '<div class="plan-divider"></div>' +
            // 方案信息
            '<div class="plan-info-grid">' +
            '<div class="plan-info-left">' +
            '<div>玩法</div>' +
            '<div>过关</div>' +
            '<div>赔率组合</div>' +
            '</div>' +
            '<div class="plan-info-right">' +
            '<div>' +
            (p.playType || '单场比分') +
            '</div>' +
            '<div>' +
            (p.passType || '比分单关') +
            '</div>' +
            '<div class="plan-odds-combo">' +
            (p.oddsDisplay || '') +
            '</div>' +
            '</div>' +
            '</div>' +
            // 比赛表格
            '<div class="plan-match-section">' +
            '<table class="plan-match-table">' +
            '<thead><tr><th>场次</th><th>对阵</th><th>方向(赔率)</th></tr></thead>' +
            '<tbody>' +
            '<tr>' +
            '<td class="match-info-col">' +
            '<div class="match-num-text">' +
            (p.matchNum || '') +
            '</div>' +
            '</td>' +
            '<td class="team-col">' +
            '<span class="plan-team-home">' +
            (p.homeName || '') +
            '</span>' +
            '<span class="plan-team-vs">vs</span>' +
            '<span class="plan-team-away">' +
            (p.visitName || '') +
            '</span>' +
            '</td>' +
            '<td class="odds-col">' +
            '<div class="plan-score-scores">' +
            scoreTags +
            '</div>' +
            '</td>' +
            '</tr>' +
            '</tbody>' +
            '</table>' +
            '</div>' +
            // 量化参考信息
            '<div class="plan-score-meta">' +
            '<span>大球率 ' +
            (p.bigBallRatio || '--') +
            '%</span>' +
            '<span>进攻优势 ' +
            (p.attackAdvantage || '--') +
            '</span>' +
            '<span>进球区间 ' +
            (p.goalRange || '--') +
            '</span>' +
            '<span>强队 ' +
            (p.strongSide === 'home' ? '主队' : '客队') +
            '</span>' +
            '</div>' +
            '</div>'
          );
        })
        .join('');
    })
    .catch(function (e) {
      el.innerHTML = '<div style="text-align:center;padding:80px 0;color:var(--text3);">' + e.message + '</div>';
    });
}

// 启动
loadHome();

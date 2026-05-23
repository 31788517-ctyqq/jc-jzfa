const API = '/api';
const DIR_COLORS = {
  '胜': '#EF4444', '平': '#FBBF24', '负': '#60A5FA',
  '胜平': '#34D399', '平负': '#F472B6', '胜负': '#A78BFA',
  '让胜': '#18E0E0', '让平': '#F59E0B', '让负': '#94A3B8'
};
const CAT_NAMES = ['综合排名', '胜平负', '半全场', '进球数', '双选', '让球'];
const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

let currentPage = 'home', detailMatchId = null;
let selectedCategory = '', selectedDirection = '';
let selectedMatchDate = '';

function getWeekDay(dateStr) {
  return WEEK_NAMES[new Date(dateStr).getDay()];
}

function api(action, data = {}, retries = 2) {
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data })
  }).then(r => r.json()).then(d => {
    if (d.code === 1) return d.data;
    // pending 状态透传（如 AI 后台生成中），不抛异常
    if (d.pending) return d;
    throw new Error(d.msg || '服务器错误');
  }).catch(err => {
    if (retries > 0) {
      console.warn(`[API] ${action} 请求失败，重试中 (${3 - retries}/2):`, err.message);
      return new Promise(resolve => setTimeout(resolve, 1000)).then(() => api(action, data, retries - 1));
    }
    throw err;
  });
}

// 导航栏滚动隐藏
let lastScrollY = 0;
window.addEventListener('scroll', () => {
  const navbar = document.getElementById('navbar');
  const currentScroll = window.scrollY;
  if (currentScroll > 80 && currentScroll > lastScrollY) {
    navbar.classList.add('hidden');
  } else {
    navbar.classList.remove('hidden');
  }
  lastScrollY = currentScroll;
}, { passive: true });

var weekDates = [];       // [{weekNum, matchDate, label}]
var selectedWeekIdx = 0;   // 当前竞彩期号在 weekDates 中的索引

function formatDate(d) {
  var y = d.getFullYear(), m = (d.getMonth()+1).toString().padStart(2,'0'), day = d.getDate().toString().padStart(2,'0');
  return y+'-'+m+'-'+day;
}
function formatDateCN(d) {
  var m = (d.getMonth()+1).toString().padStart(2,'0'), day = d.getDate().toString().padStart(2,'0');
  return m+'月'+day+'日 '+WEEK_NAMES[d.getDay()];
}

function shiftWeek(delta) {
  var newIdx = selectedWeekIdx + delta;
  if (newIdx < 0 || newIdx >= weekDates.length) return;
  selectedWeekIdx = newIdx;
  updateDateBar();
  loadMatchList();
}
function goToday() {
  // 找到今天或最近的竞彩期号
  var today = formatDate(new Date()).slice(5);
  var now = new Date();
  var todayWeek = WEEK_NAMES[now.getDay()];
  var best = 0;
  // 首选：matchDate==today 且 weekNum==todayWeek；其次：matchDate<=today 的最大 matchDate
  weekDates.forEach(function(w,i){
    if(w.matchDate===today&&w.weekNum===todayWeek){best=i}
  });
  if(weekDates[best]&&weekDates[best].matchDate===today&&weekDates[best].weekNum===todayWeek){
    // 已精确匹配
  } else {
    weekDates.forEach(function(w,i){if(w.matchDate<=today)best=i});
  }
  selectedWeekIdx = best;
  updateDateBar();
  loadMatchList();
}
function updateDateBar() {
  var el = document.getElementById('dateCurrent');
  if (!el) return;
  var w = weekDates[selectedWeekIdx];
  if (w) {
    var today = formatDate(new Date()).slice(5);
    var prefix = w.matchDate === today ? '今天 ' : '';
    // 如 "今天 05/19 周二" 或 "04/01 周三"
    el.textContent = prefix + w.matchDate.replace('-','/') + ' ' + w.weekNum;
  } else {
    el.textContent = '加载中...';
  }
}
function initWeekDates() {
  api('week-dates', {}).then(function(list) {
    weekDates = list || [];
    if (weekDates.length) {
      var today = formatDate(new Date()).slice(5);
      selectedWeekIdx = 0;
      weekDates.forEach(function(w, i) { if (w.matchDate <= today) selectedWeekIdx = i; });
      updateDateBar();
      loadMatchList();
    }
  });
}

function switchTab(tab) {
  currentPage = tab;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + (tab === 'detail' ? 'detail' : tab)).classList.add('active');
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  const tabEl = document.getElementById('tab-' + (tab === 'detail' ? 'rank' : tab));
  if (tabEl) tabEl.classList.add('active');
  // 详情页和筛选页显示返回按钮
  document.getElementById('navBack').style.display = (tab === 'detail' || tab === 'filter') ? 'flex' : 'none';

  const titles = {
    home: '竞彩推荐监控',
    match: '今日比赛',
    detail: '比赛详情',
    rank: '推荐排行榜',
    hit: '命中率统计',
    filter: '命中率筛选'
  };
  document.getElementById('navTitle').textContent = titles[tab] || '竞彩推荐监控';

  if (tab === 'home') loadHome();
  if (tab === 'match') {
    if (weekDates.length > 0) { updateDateBar(); loadMatchList(); }
    else initWeekDates();
  }
  if (tab === 'rank') loadRanking();
  if (tab === 'hit') loadHitRate();
  if (tab === 'filter') { loadFilterLeagues(); resetFilterResult(); }
}

var lastPage='home';
function goBack() { switchTab(lastPage); }

// 首页
function loadHome() {
  // 首页：ranking-list + match-list 同时发起，用 Promise.all 减少等待
  var rankP = api('ranking-list', {}).catch(function() { return {}; });
  var matchP = api('match-list', { date: new Date().toISOString().slice(0,10) }).catch(function() { return []; });
  Promise.all([rankP, matchP]).then(function(r) {
    var rank = r[0], matches = r[1];
    document.getElementById('matchCount').textContent = matches.length || '-';
    document.getElementById('maxRankCount').textContent = rank.topExpertCount||0;
  });
}

// 比赛列表
function loadMatchList() {
  const el = document.getElementById('matchList');
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';
  
  var params = { _t: Date.now() };
  var w = weekDates[selectedWeekIdx];
  if (w) { params.weekNum = w.weekNum; params.matchDate = w.matchDate; }
  else { params.date = formatDate(new Date()); }
  
  api('match-list', params).then(matches => {
    el.innerHTML = matches.map(m => {
      const statusText = { 0: '未开始', 1: '进行中', 2: '已结束', 3: '取消' }[m.matchStatus] || '未知';
      const roundText = m.num || '';
      const timeStr = m.startTime ? m.startTime.slice(5) : '';
      const startDate = m.startTime ? m.startTime.slice(0,5) : '';
      const isLive = m.matchStatus === 1 || m.matchStatus === 2;
      const scoreText = m.score || '';
      const halfText = m.halfScore || '';
      const durText = m.duration || '';
      const yellowText = m.yellow || '';
      const redText = m.red || '';
      var scoreDisplay = '';
      var extraInfo = '';
      if (isLive && scoreText) {
        var parts = scoreText.replace('-',':').split(':');
        if (parts.length === 2) scoreDisplay = '<span class="match-score">' + parts[0] + ' : ' + parts[1] + '</span>';
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
            <span class="match-num">${roundText}</span>
          </div>
          <div class="match-teams">
            <span class="team-name">${m.homeName}</span>
            ${isLive && scoreDisplay ? scoreDisplay : '<span class="vs">VS</span>'}
            <span class="team-name">${m.visitName}</span>
          </div>
          <div class="match-info">
            <span class="match-experts">${m.recommNum ? m.recommNum+'位专家推荐' : ''}</span>
            <span class="match-time">${startDate ? startDate.replace('-','/') + ' ' : ''}${timeStr}</span>
          </div>
          <div class="match-status" style="color:${m.matchStatus===1?'var(--cyan)':m.matchStatus===2?'var(--green)':m.matchStatus===3?'var(--red)':'var(--text2)'}">${statusText} ${extraInfo}</div>
        </div>
      `;
    }).join('');
  }).catch(e => {
    el.innerHTML = `<div class="loading">${e.message}</div>`;
  });
}

// 比赛详情
function goDetail(matchId) {
  lastPage=currentPage;
  detailMatchId = matchId;
  const el = document.getElementById('detailContent');
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';
  switchTab('detail');

  Promise.all([
    api('match-detail', { matchId }),
    api('recommend-trend', { matchId })
  ]).then(([detail, trend]) => {
    const match = detail.match || detail;
    const recommends = detail.recommends || [];
    const statusText = { 0: '未开始', 1: '进行中', 2: '已结束' }[match.matchStatus] || '未知';
    const roundText = match.num || '';
    const isLive = match.matchStatus === 1 || match.matchStatus === 2;
    const scoreText = match.score || '';
    const halfText = match.halfScore || '';
    const durText = match.duration || '';
    const yellowText = match.yellow || '';
    const redText = match.red || '';
    var scoreDisplay = '';
    var extraText = '';
    if (isLive && scoreText) {
      var parts = scoreText.replace('-',':').split(':');
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
          <span class="match-num" style="background: ${match.matchStatus === 0 ? 'rgba(34,211,238,0.1)' : 'rgba(52,211,153,0.1)'}; color: ${match.matchStatus === 0 ? 'var(--cyan)' : 'var(--green)'}">${statusText}</span>
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
    var hitMap={};
    recommends.forEach(function(r){if(r.result===1)hitMap[r.type]=true});

    let dirItems = (trend.lastResult || []).filter(r => r.num > 0);
    if (dirItems.length === 0 && recommends.length > 0) {
      const typeMap = {};
      recommends.forEach(r => {
        if (!typeMap[r.type]) typeMap[r.type] = 0;
        typeMap[r.type] += (r.num || 0);
      });
      dirItems = Object.keys(typeMap).map(t => ({ type: t, num: typeMap[t] }));
    }
    var isFinished=match.matchStatus===2;
    dirItems.sort((a, b) => (b.num || 0) - (a.num || 0)).forEach(r => {
      var isHit=isFinished&&hitMap[r.type];
      var hitFlag=isHit?'<img src="/assets/worldcup/flag-hit.png" class="hit-flag" alt="">':'';
      var hitClass=isHit?' hit':'';
      html += `
        <div class="dir-item${hitClass}">
          <span class="dir-name">${hitFlag}${r.type}</span>
          <span class="dir-count">${r.num}位</span>
        </div>
      `;
    });
    html += '</div></div>';
    
    el.innerHTML = html;

    // 延迟检查 AI 核心看点卡片（不阻塞详情页渲染）
    setTimeout(function() {
      api('ai-predict-status', {}).then(function(status) {
        if (!status || !status.canShowCards) {
          var aiCard = document.getElementById('detailContent').querySelector('.ai-card');
          if (aiCard) aiCard.style.display = 'none';
        }
      }).catch(function() {});
    }, 100);

    setTimeout(() => {
      const chartEl = document.getElementById('trendChart');
      const top5 = (trend.lastResult || []).sort((a, b) => b.num - a.num).slice(0, 5);

      // 无趋势数据时展示占位样式
      if (!trend.timeLabels || trend.timeLabels.length === 0) {
        chartEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;color:#64748B;">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" opacity="0.5"><path d="M14 25C14 27 15.07 32 29 32C42.93 32 44 27 44 25C44 23 44 10 44 10H29H14C14 10 14 23 14 25Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M29 16H23V21L26 24L29 21V16Z" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 16V10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 40L43 40" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 14H4C4 14 5 19 6 22C7 25 14 24 14 24" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>
          <div style="margin-top:12px;font-size:13px;color:#94A3B8;">趋势数据收集中</div>
          <div style="margin-top:4px;font-size:11px;color:#4B5563;">每20分钟更新一个数据点</div>
        </div>`;
        return;
      }

      const chart = echarts.init(chartEl);
      const colors = ['#EF4444', '#FBBF24', '#34D399', '#18E0E0', '#A78BFA'];
      
      const series = trend.series
        .filter(s => top5.some(t => t.type === s.name))
        .slice(0, 5)
        .map((s, i) => ({
          name: s.name,
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2, color: colors[i] },
          itemStyle: { color: colors[i] },
          data: s.data
        }));

      chart.setOption({
        color: colors,
        tooltip: { trigger: 'axis' },
        legend: { 
          bottom: 0, 
          icon: 'circle',
          itemWidth: 8,
          itemHeight: 8,
          textStyle: { fontSize: 10, color: '#94A3B8' }
        },
        grid: { left: '2%', right: '4%', bottom: '18%', top: '5%', containLabel: true },
        xAxis: {
          type: 'category',
          data: trend.timeLabels,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { fontSize: 10, color: '#64748B' }
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { fontSize: 10, color: '#64748B' },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.03)' } }
        },
        series
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

  api('ranking-list', params).then(data => {
    // 日期标签：显示当前排行数据的竞彩期号
    const dateEl = document.getElementById('rankingDateLabel');
    if (data.matchDateLabel) {
      const today = new Date().toISOString().slice(0,10);
      const prefix = data.effectiveDate === today ? '今天 ' : '';
      dateEl.textContent = prefix + data.matchDateLabel;
      dateEl.style.display = 'block';
    } else {
      dateEl.style.display = 'none';
    }

    // 分类筛选
    const catOrder = CAT_NAMES.filter(c => c === '综合排名' || (data.categories && data.categories[c]));
    catEl.innerHTML = catOrder.map(c => {
      const isActive = (c === '综合排名' && !selectedCategory) || c === selectedCategory;
      return `<div class="filter-tag ${isActive ? 'active' : ''}" onclick="selectCategory('${c}')">${c}</div>`;
    }).join('');

    // 二级筛选
    if (selectedCategory && data.categories && data.categories[selectedCategory]) {
      subEl.style.display = 'flex';
      const dirs = data.categories[selectedCategory].directions;
      subEl.innerHTML = dirs.map(d => {
        const isActive = d.name === selectedDirection;
        return `<div class="filter-tag ${isActive ? 'active' : ''}" onclick="selectDirection('${d.name.replace(/'/g, "\\'")}')">${d.name}</div>`;
      }).join('');
    } else {
      subEl.style.display = 'none';
    }

    // 排名列表
    const topCount = data.ranking.length > 0 ? data.ranking[0].expertCount : 1;
    el.innerHTML = data.ranking.map(item => {
      const r = item.rank;
      let badgeClass = 'normal', badgeContent = r;
      if (r === 1) { badgeClass = 'gold'; badgeContent = '🥇'; }
      else if (r === 2) { badgeClass = 'silver'; badgeContent = '🥈'; }
      else if (r === 3) { badgeClass = 'bronze'; badgeContent = '🥉'; }
      
      const pct = Math.round(item.expertCount / topCount * 100);
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
        </div>
      `;
    }).join('');

    // 延迟触发进度条动画
    requestAnimationFrame(() => {
      el.querySelectorAll('.rank-progress-fill').forEach(el => {
        setTimeout(() => {
          el.style.width = el.dataset.width + '%';
        }, 80);
      });
    });
  });
}

function selectCategory(cat) {
  if (cat === '综合排名') { selectedCategory = ''; selectedDirection = ''; }
  else { selectedCategory = cat; selectedDirection = ''; }
  loadRanking();
}

function selectDirection(dir) {
  selectedDirection = dir;
  loadRanking();
}

// 命中率统计
function loadHitRate() {
  const el = document.getElementById('hitContent');
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  api('hit-rate-stats', { days: 60 }).then(data => {
    if (!data || !data.directionStats) {
      el.innerHTML = '<div class="loading">命中率统计需要时间积累</div>';
      return;
    }

    const top3Rate = data.top3HitRate!==undefined ? data.top3HitRate : 0;

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
            <div class="stat-big-label">场次前三命中率</div>
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

    data.directionStats.forEach(d => {
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
      document.querySelectorAll('.hit-rank-bar').forEach(bar => {
        setTimeout(() => {
          bar.style.width = bar.dataset.width + '%';
        }, 60);
      });
    });
  }).catch(e => {
    el.innerHTML = `<div class="loading">${e.message}</div>`;
  });
}

// ========== 命中率筛选 ==========
const filterDirMap = {
  '胜平负': ['全部', '胜', '平', '负'],
  '让球':   ['全部', '让胜', '让平', '让负'],
  '进球数': ['全部', '总进球-1、2球', '总进球-2、3球', '总进球-3、4球', '总进球-1、2、3球', '总进球-2、3、4球', '总进球-3、4、5球'],
  '双选':   ['全部', '平、让平', '让胜、让平', '让平、让负', '胜、平', '平、负'],
  '半全场': ['全部', '半全场-胜胜', '半全场-负负']
};

// 自定义下拉
function toggleDD(id, evt) {
  // 阻止事件冒泡到 document，避免被全局监听器立即关闭
  if (evt) { evt.stopPropagation(); evt.preventDefault(); }
  var dd = document.getElementById(id);
  if (!dd) return;
  var wasOpen = dd.classList.contains('open');
  closeAllDD();
  if (!wasOpen) {
    dd.classList.add('open');
    // 用 fixed 定位，彻底脱离父容器裁剪
    var menu = dd.querySelector('.filter-dd-menu');
    var trigger = dd.querySelector('.filter-dd-trigger');
    if (!menu || !trigger) return;
    var rect = trigger.getBoundingClientRect();
    var vh = window.innerHeight;
    var menuH = Math.min(menu.scrollHeight || 220, 220);
    // 智能定位：下方空间不足时，菜单向上展开
    var spaceBelow = vh - rect.bottom - 6;
    var spaceAbove = rect.top - 6;
    menu.style.position = 'fixed';
    menu.style.left = rect.left + 'px';
    menu.style.width = rect.width + 'px';
    menu.style.right = 'auto';
    menu.style.maxHeight = menuH + 'px';
    menu.style.overflowY = 'auto';
    menu.style.WebkitOverflowScrolling = 'touch';
    if (spaceBelow >= menuH || spaceBelow >= spaceAbove) {
      // 向下展开
      menu.style.top = (rect.bottom + 6) + 'px';
      menu.style.bottom = 'auto';
    } else {
      // 向上展开
      menu.style.bottom = (vh - rect.top + 6) + 'px';
      menu.style.top = 'auto';
    }
  }
}
function selectDD(id, val, text) {
  var dd = document.getElementById(id);
  if (!dd) return;
  dd.setAttribute('data-val', val);
  dd.querySelector('.filter-dd-text').textContent = text;
  dd.querySelectorAll('.filter-dd-option').forEach(function(o) {
    o.classList.toggle('selected', o.getAttribute('data-val') === val);
  });
  closeAllDD();
}
function getDDVal(id) {
  var el = document.getElementById(id);
  return el ? (el.getAttribute('data-val') || '') : '';
}
function closeAllDD() {
  document.querySelectorAll('.filter-dd.open').forEach(function(d) { d.classList.remove('open'); });
}
// 监听 click/touchend 关闭下拉（兼容移动端）
function handleDocClose(e) {
  if (!e.target) return;
  var inDD = e.target.closest('.filter-dd');
  if (!inDD) closeAllDD();
}
document.addEventListener('click', handleDocClose);
document.addEventListener('touchend', function(e) {
  // mobile touchend 300ms later to avoid immediate close
  setTimeout(function() { handleDocClose(e); }, 50);
});

function resetFilterResult() {
  document.getElementById('filterResult').innerHTML = '<div class="hint-box">选择筛选条件后点击"查询"按钮</div>';
}

function loadFilterLeagues() {
  api('filter-stats', {}).then(function(stats) {
    document.getElementById('statMatches').textContent = stats.matchCount || 0;
    document.getElementById('statLeagues').textContent = stats.leagueCount || 0;
    document.getElementById('statDirs').textContent = stats.directionCount || 0;
    // 填充联赛下拉
    var menu = document.querySelector('#dd-league .filter-dd-menu');
    var html = '<li data-val="" class="filter-dd-option selected" onclick="selectDD(\'dd-league\',\'\',\'全部\')">全部</li>';
    (stats.leagues || []).forEach(function(l) {
      html += '<li data-val="' + l + '" class="filter-dd-option" onclick="selectDD(\'dd-league\',\'' + l + '\',\'' + l + '\')">' + l + '</li>';
    });
    menu.innerHTML = html;
    // 如有待回填数据，展示提示
    if (stats.staleCount > 0) {
      document.getElementById('filterResult').innerHTML =
        '<div class="hint-box" style="color:var(--amber);font-size:12px;">' +
        '⚠ ' + stats.staleCount + ' 条推荐结果尚未确定，可能需要回填。<br>' +
        '<span style="color:var(--text3);">运行 <code>node backfill_results.js</code> 补全数据</span></div>';
    }
  }).catch(function() {
    document.getElementById('statMatches').textContent = '-';
    document.getElementById('statLeagues').textContent = '-';
    document.getElementById('statDirs').textContent = '-';
  });
}

function onDDTypeChange() {
  var type = getDDVal('dd-dirType');
  var ddDir = document.getElementById('dd-dir');
  // 综合排名没有二级选项
  if (!type || type === '综合排名') { ddDir.style.display = 'none'; return; }
  var options = filterDirMap[type] || [];
  var menu = ddDir.querySelector('.filter-dd-menu');
  var html = '<li data-val="" class="filter-dd-option selected" onclick="selectDD(\'dd-dir\',\'\',\'全部\')">全部</li>';
  options.forEach(function(d) {
    html += '<li data-val="' + d + '" class="filter-dd-option" onclick="selectDD(\'dd-dir\',\'' + d + '\',\'' + d + '\')">' + d + '</li>';
  });
  menu.innerHTML = html;
  ddDir.setAttribute('data-val', '');
  ddDir.querySelector('.filter-dd-text').textContent = '全部';
  ddDir.style.display = 'block';
}

function onRankTypeChange() {
  var type = getDDVal('dd-rankType');
  var ddRank = document.getElementById('dd-rank');
  if (type === '全部') { ddRank.style.display = 'none'; return; }
  ddRank.style.display = 'block';
  ddRank.setAttribute('data-val', '0');
  ddRank.querySelector('.filter-dd-text').textContent = '全部';
}

function doFilterQuery() {
  var league = getDDVal('dd-league');
  var timeRange = getDDVal('dd-time');
  var directionType = getDDVal('dd-dirType');
  var ddDir = document.getElementById('dd-dir');
  var direction = (ddDir.style.display !== 'none') ? getDDVal('dd-dir') : '';
  if (direction === '全部') direction = '';
  var rankType = getDDVal('dd-rankType') || '全部';
  var rankTop = 0;
  if (rankType !== '全部') { rankTop = parseInt(getDDVal('dd-rank')) || 0; }

  var resultEl = document.getElementById('filterResult');
  resultEl.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  api('hit-rate-filter', {
    league: league,
    timeRange: timeRange,
    directionType: directionType,
    direction: direction,
    rankType: rankType,
    rankTop: rankTop
  }).then(function(data) {
    if (!data) {
      resultEl.innerHTML = '<div class="loading">查询失败</div>';
      return;
    }

    var html = '';

    if (data.totalCount === 0) {
      html += '<div class="loading" style="padding:20px;color:var(--text2)">暂无符合条件的数据</div>';
    } else {
      var rateVal = parseFloat(data.hitRate) || 0;
      var ringColor = rateVal >= 50 ? '#34D399' : rateVal >= 40 ? '#FBBF24' : '#EF4444';
      var r = 36, c = 2 * Math.PI * r;
      var dashVal = c * (1 - rateVal / 100);

      var condTags = data.conditionSummary.split(' | ');
      var condHtml = '<div class="filter-cond-tags">';
      for (var i = 0; i < condTags.length; i++) {
        if (i > 0) condHtml += '<span class="filter-cond-pipe">|</span>';
        condHtml += '<span>' + condTags[i] + '</span>';
      }
      condHtml += '</div>';

      html += '<div class="filter-result-card">';
      html += '<div class="filter-result-head">筛选结果</div>';
      html += condHtml;
      html += '<div class="filter-result-row">';
      html += '<div class="filter-result-side"><div class="filter-result-num">' + data.hitCount + '</div><div class="filter-result-label">命中场次</div></div>';
      html += '<div class="filter-ring-wrap">';
      html += '<svg class="filter-ring-svg" viewBox="0 0 80 80">';
      html += '<circle class="filter-ring-bg" cx="40" cy="40" r="' + r + '"/>';
      html += '<circle class="filter-ring-fill" cx="40" cy="40" r="' + r + '" stroke="' + ringColor + '" stroke-dasharray="' + c + '" stroke-dashoffset="' + dashVal + '"/>';
      html += '<text class="filter-ring-pct" x="40" y="40" text-anchor="middle" dominant-baseline="central" fill="' + ringColor + '" transform="rotate(90,40,40)">' + rateVal + '%</text>';
      html += '</svg></div>';
      html += '<div class="filter-result-side"><div class="filter-result-num">' + data.totalCount + '</div><div class="filter-result-label">符合条件场次</div></div>';
      html += '</div></div>';
    }

    // 结果详情卡片：近15天数据（无论是否有结果都显示）
    if (data.dailyResults && data.dailyResults.length > 0) {
      html += '<div class="filter-detail-card">';
      html += '<div class="filter-detail-head">结果详情</div>';
      html += '<div class="filter-detail-header-row"><span>近15天</span><span>符合场次/命中场次</span><span>命中率</span></div>';
      data.dailyResults.forEach(function(d) {
        var dr = parseFloat(d.hitRate) || 0;
        html += '<div class="filter-detail-row"><span>' + d.date + '</span><span>' + d.totalMatch + '/' + d.hitMatch + '</span><span>' + dr.toFixed(1) + '%</span></div>';
      });
      html += '</div>';
    }

    resultEl.innerHTML = html;
  }).catch(function(e) {
    resultEl.innerHTML = '<div class="loading">' + e.message + '</div>';
  });
}

// ========== AI深度解析 ==========
function showAIPrediction(matchId) {
  // 获取比赛信息
  var teams = document.querySelectorAll('#detailContent .team-name');
  var homeTeam = teams[0] ? teams[0].textContent : '主队';
  var awayTeam = teams[1] ? teams[1].textContent : '客队';

  // 显示加载态
  var html = '<div class="ai-modal-header"><span class="ai-modal-title">AI深度解析</span><button class="ai-modal-close" onclick="closeAI()">✕</button></div>';
  html += '<div class="ai-content"><div style="text-align:center;padding:60px 20px;color:var(--cyan);"><div style="font-size:40px;margin-bottom:16px;">⏳</div><div style="font-size:16px;font-weight:600;">正在生成分析...</div><div style="font-size:12px;color:var(--text3);margin-top:8px;">正在搜索比赛信息并生成五维分析</div></div></div>';
  document.getElementById('aiModal').innerHTML = html;
  document.getElementById('aiOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';

  // 调用 API
  api('ai-predict', { matchId: matchId }).then(function(d) {
    if (d.fromCache || d.content) {
      renderAIContent(d.content, homeTeam, awayTeam);
    } else if (d.pending) {
      // 后台生成中，2秒后重试
      var retryCount = 0;
      function retry() {
        if (retryCount >= 15) { document.getElementById('aiModal').querySelector('.ai-content').innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--amber);">生成超时，请稍后再试</div>'; return; }
        retryCount++;
        api('ai-predict', { matchId: matchId }).then(function(rd) {
          if (rd.content) { renderAIContent(rd.content, homeTeam, awayTeam); }
          else { setTimeout(retry, 3000); }
        }).catch(function() { setTimeout(retry, 3000); });
      }
      setTimeout(retry, 2000);
    } else {
      document.getElementById('aiModal').querySelector('.ai-content').innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--amber);">分析未就绪，请稍后重试</div>';
    }
  }).catch(function() {
    document.getElementById('aiModal').querySelector('.ai-content').innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--amber);">请求失败，请检查网络</div>';
  });
}

// 根据 API 返回的 content 渲染 AI 弹窗
function renderAIContent(content, homeTeam, awayTeam) {
  var c = content || {};
  var conf = typeof c.confidence === 'number' ? c.confidence : 70;
  var preds = c['预测建议'] || [];
  var baseStr = c['基础面'] || {};
  var stateStr = c['状态面'] || {};
  var motiStr = c['动机面'] || {};
  var posStr = c['对位面'] || {};
  var mktStr = c['市场面'] || {};
  var highlight = c['核心看点'] || {};
  var baseTable = baseStr['攻防全景数据'];

  function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  // 智能截断：优先在句号处截断
  function clip(s, max) { s = s || ''; if (s.length <= max) return s; var idx = s.lastIndexOf('。', max); if (idx > max * 0.5) return s.substring(0, idx + 1); idx = s.lastIndexOf('，', max); if (idx > max * 0.5) return s.substring(0, idx) + '...'; return s.substring(0, max - 3) + '...'; }
  // 如果内容为空返回假
  function has(s) { return s && (typeof s === 'string' ? s.trim().length > 0 : true); }

  var html = '';
  html += '<div class="ai-modal-header"><span class="ai-modal-title">AI深度解析</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>';
  html += '<div class="ai-content">';

  // ── 比赛信息 ──
  html += '<div class="ai-match-info"><div class="ai-team"><div class="ai-team-logo">' + esc(homeTeam[0]) + '</div><div class="ai-team-name">' + esc(homeTeam) + '</div></div><div class="ai-vs-section"><div class="ai-vs-text">VS</div></div><div class="ai-team"><div class="ai-team-logo away">' + esc(awayTeam[0]) + '</div><div class="ai-team-name">' + esc(awayTeam) + '</div></div></div>';

  // ── AI核心观点 ──
  var coreView = esc(highlight['核心看点'] || c['核心观点'] || '');
  var varRemind = esc(highlight['变数提醒'] || c['变数提醒'] || '');
  var icons = ['🏆', '⚽', '📊'];
  html += '<div class="ai-core-view">';
  html += '<div class="ai-core-header"><span class="ai-core-icon">💡</span><span class="ai-core-title">AI核心观点</span></div>';
  html += '<div class="ai-core-content">' + clip(coreView, 120) + '</div>';
  if (varRemind) html += '<div class="ai-core-desc">' + clip(varRemind, 80) + '</div>';
  html += '<div class="ai-predict-row">';
  preds.forEach(function(p, i) {
    var val = esc(p['建议方向'] || '');
    html += '<div class="ai-predict-card">';
    html += '<div class="ai-predict-head"><span class="ai-predict-icon">' + (icons[i] || '●') + '</span><span class="ai-predict-name">' + esc(p['玩法'] || '') + '</span></div>';
    html += '<div class="ai-predict-value">' + val + '</div>';
    html += '<div class="ai-predict-line"></div>';
    html += '<div class="ai-predict-sub">' + clip(esc(p['核心逻辑'] || ''), 50) + '</div>';
    html += '</div>';
  });
  html += '</div></div>';

  // ═══ 01 基础面 ═══
  var bRank = baseStr['积分排名'] || '';
  var bHasRank = bRank.length > 5;
  var bHasTable = baseTable && baseTable.rows && baseTable.rows.length >= 3;
  var bHasBaseCon = has(baseStr['核心结论']);
  if (bHasRank || bHasTable || bHasBaseCon) {
    html += '<div id="ai-sec-01" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">01</span><span class="ai-sec-name">基础面</span>'; if (baseStr['概括']) html += '<span class="ai-sec-desc">' + clip(esc(baseStr['概括']), 20) + '</span>'; html += '</div>';
    if (bHasRank) {
      // 智能拆分主客队排名描述
      var rankHome = clip(esc(bRank), 60), rankAway = '';
      var idxH = bRank.indexOf(homeTeam); var idxA = bRank.indexOf(awayTeam);
      if (idxH >= 0 && idxA >= 0 && idxA > idxH) {
        rankHome = clip(esc(bRank.substring(0, idxA)), 60);
        rankAway = clip(esc(bRank.substring(idxA)), 60);
      } else if (idxA >= 0 && idxH >= 0 && idxH > idxA) {
        rankAway = clip(esc(bRank.substring(0, idxH)), 60);
        rankHome = clip(esc(bRank.substring(idxH)), 60);
      } else if (bRank.length > 60) {
        rankAway = clip(esc(bRank.substring(60)), 60);
      }
      html += '<div class="ai-rank-dual"><div class="ai-rank-col"><div class="ai-rank-h">' + esc(homeTeam) + '</div><div class="ai-rank-val">' + rankHome + '</div></div><div class="ai-rank-col"><div class="ai-rank-h">' + esc(awayTeam) + '</div><div class="ai-rank-val">' + (rankAway || '\u2014') + '</div></div></div>';
    }
    if (bHasTable) {
      html += '<div class="ai-data-compare"><div class="ai-data-title">攻防数据对比</div>';
      baseTable.rows.forEach(function(row) { if (row.length < 3) return; var label = row[0], hv = row[1], av = row[2]; var hn = parseFloat(hv), an = parseFloat(av); var hp = isNaN(hn) || isNaN(an) ? 50 : Math.round(hn / (hn + an) * 100); html += '<div class="ai-data-row"><span class="ai-data-label">' + esc(label) + '</span><span class="ai-data-home">' + esc(hv) + '</span><div class="ai-progress-bar"><div class="ai-progress" style="width:' + hp + '%"></div></div><span class="ai-data-away">' + esc(av) + '</span></div>'; });
      html += '</div>';
    }
    if (bHasBaseCon) html += '<div class="ai-item-conclusion"><div class="ai-item-label">核心结论</div><div class="ai-item-text">' + clip(esc(baseStr['核心结论']), 120) + '</div></div>';
    html += '</div>';
  }

  // ═══ 02 状态面 ═══
  var hf = (stateStr['主队近况'] || '').match(/(\d+)胜(\d+)平(\d+)负/), af = (stateStr['客队近况'] || '').match(/(\d+)胜(\d+)平(\d+)负/);
  var hasHistory = has(stateStr['历史对阵']); var injTable = stateStr['伤病影响']; var hasInj = injTable && injTable.rows && injTable.rows.length; var hasStateCon = has(stateStr['核心结论']);
  if (hf || af || hasHistory || hasInj || hasStateCon) {
    html += '<div id="ai-sec-02" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">02</span><span class="ai-sec-name">状态面</span></div>';
    if (hf || af) { html += '<div class="ai-form-title">近期战绩对比</div>'; }
    if (hf) { html += '<div class="ai-form-row"><span class="ai-form-label">' + esc(homeTeam) + '</span>'; for (var i = 0; i < parseInt(hf[1]); i++) html += '<span class="ai-form-dot w">W</span>'; for (i = 0; i < parseInt(hf[2]); i++) html += '<span class="ai-form-dot d">D</span>'; for (i = 0; i < parseInt(hf[3]); i++) html += '<span class="ai-form-dot l">L</span>'; html += '<span class="ai-form-summary">' + hf[1] + 'W ' + hf[2] + 'D ' + hf[3] + 'L</span></div>'; }
    if (af) { html += '<div class="ai-form-row"><span class="ai-form-label">' + esc(awayTeam) + '</span>'; for (var i = 0; i < parseInt(af[1]); i++) html += '<span class="ai-form-dot w">W</span>'; for (i = 0; i < parseInt(af[2]); i++) html += '<span class="ai-form-dot d">D</span>'; for (i = 0; i < parseInt(af[3]); i++) html += '<span class="ai-form-dot l">L</span>'; html += '<span class="ai-form-summary">' + af[1] + 'W ' + af[2] + 'D ' + af[3] + 'L</span></div>'; }
    if (hasHistory) html += '<div class="ai-item"><div class="ai-item-label">历史交锋</div><div class="ai-item-text">' + clip(esc(stateStr['历史对阵']), 120) + '</div></div>';
    if (hasInj) { html += '<div class="ai-injury-title">伤停对比</div>'; injTable.rows.forEach(function(row) { if (row.length < 3) return; html += '<div class="ai-injury-row"><span class="ai-injury-team">' + esc(row[0]) + '</span><span class="ai-injury-player">' + clip(esc(row[1]), 12) + '</span><span class="ai-injury-status ' + (row[2].indexOf('缺') >= 0 || row[2].indexOf('停') >= 0 ? 'out' : 'doubt') + '">' + esc(row[2]) + '</span>'; if (row[3]) html += '<span class="ai-injury-effect ' + (row[3].indexOf('高') >= 0 ? 'high' : 'low') + '">' + esc(row[3]) + '</span>'; html += '</div>'; }); }
    if (hasStateCon) html += '<div class="ai-item-conclusion"><div class="ai-item-label">核心结论</div><div class="ai-item-text">' + clip(esc(stateStr['核心结论']), 120) + '</div></div>';
    html += '</div>';
  }

  // ═══ 03 动机面 ═══
  var hasWill = has(motiStr['战意强度']);
  html += '<div id="ai-sec-03" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">03</span><span class="ai-sec-name">动机面</span></div>';
  if (hasWill) html += '<div class="ai-item"><div class="ai-item-label">战意强度</div><div class="ai-item-text">' + clip(esc(motiStr['战意强度']), 120) + '</div></div>';
  html += '</div>';

  // ═══ 04 对位面 ═══
  var posGood = has(posStr['攻防博弈']) || has(posStr['节奏控制']);
  var posBad = has(posStr['主场氛围']) || has(posStr['战术与教练风格']);
  var hasPosCon = has(posStr['核心结论']);
  if (posGood || posBad || hasPosCon) {
    html += '<div id="ai-sec-04" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">04</span><span class="ai-sec-name">对位面</span></div>';
    html += '<div class="ai-swp-grid"><div class="ai-swp-col"><div class="ai-swp-title good">\u25b2 主队优势</div>';
    if (has(posStr['攻防博弈'])) html += '<div class="ai-swp-item">' + clip(esc(posStr['攻防博弈']), 70) + '</div>';
    if (has(posStr['节奏控制'])) html += '<div class="ai-swp-item">' + clip(esc(posStr['节奏控制']), 70) + '</div>';
    html += '</div><div class="ai-swp-col"><div class="ai-swp-title bad">\u25bc 客队隐患</div>';
    if (has(posStr['主场氛围'])) html += '<div class="ai-swp-item">' + clip(esc(posStr['主场氛围']), 70) + '</div>';
    if (has(posStr['战术与教练风格'])) html += '<div class="ai-swp-item">' + clip(esc(posStr['战术与教练风格']), 70) + '</div>';
    html += '</div></div>';
    if (hasPosCon) html += '<div class="ai-item-conclusion amber"><div class="ai-item-label">综合判断</div><div class="ai-item-text">' + clip(esc(posStr['核心结论']), 120) + '</div></div>';
    html += '</div>';
  }

  // ═══ 05 市场面 ═══
  var hasOdds = has(mktStr['盘口与赔率']) || has(mktStr['大小球']); var hasMktCon = has(mktStr['核心结论']);
  if (hasOdds || hasMktCon) {
    html += '<div id="ai-sec-05" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">05</span><span class="ai-sec-name">市场面</span></div>';
    // 支持率数据：优先使用AI置信度推导，否则不显示进度条
    if (has(mktStr['盘口与赔率'])) html += '<div class="ai-item"><div class="ai-item-label">盘口与赔率</div><div class="ai-item-text">' + clip(esc(mktStr['盘口与赔率']), 120) + '</div></div>';
    if (has(mktStr['大小球'])) html += '<div class="ai-item"><div class="ai-item-label">大小球</div><div class="ai-item-text">' + clip(esc(mktStr['大小球']), 120) + '</div></div>';
    if (hasMktCon) html += '<div class="ai-item-conclusion amber"><div class="ai-item-label">市场解读</div><div class="ai-item-text">' + clip(esc(mktStr['核心结论']), 120) + '</div></div>';
    html += '</div>';
  }

  // ═══ 06 预测建议 ═══
  html += '<div id="ai-sec-06" class="ai-section-content" style="border-left-color:rgba(52,211,153,0.3)"><div class="ai-sec-title"><span class="ai-sec-num">06</span><span class="ai-sec-name">预测建议</span></div><div class="ai-predict-table">';
  preds.forEach(function(p) {
    html += '<div class="ai-predict-tr"><span class="ai-predict-td type">' + esc(p['玩法'] || '') + '</span><span class="ai-predict-td suggest">' + esc(p['建议方向'] || '') + '</span><span class="ai-predict-td logic">' + esc(p['核心逻辑'] || '') + '</span><span class="ai-predict-td check">\u2713</span></div>';
  });
  html += '</div></div>';
  html += '<div class="ai-disclaimer">本分析为AI生成，仅供参考，请理性对待</div>';

  html += '</div>';
  document.getElementById('aiModal').innerHTML = html;
}

function closeAI() {
  document.getElementById('aiOverlay').classList.remove('active');
  document.body.style.overflow = '';
}

// 启动
loadHome();

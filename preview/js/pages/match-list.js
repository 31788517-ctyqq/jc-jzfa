import { api } from '../api.js';
import { formatDate, getCache, setCache } from '../utils.js';
import * as state from '../vendor.js';
// ═══ PK 选择状态（全局存储，避免模块加载时序问题） ═══
import { loadCSS } from '../vendor.js';
loadCSS('../../css/page-match.css');

window.__ms = window.__ms || {};
let allMatchesData = [];

/** 清空所有选择 */
export function clearMatchPicks() {
  window.__ms = {};
  document.querySelectorAll('.match-card.picked').forEach(function (r) {
    r.classList.remove('picked');
  });
  document.querySelectorAll('.mc-chk:checked').forEach(function (c) {
    c.checked = false;
  });
  const bar = document.getElementById('matchPkBar');
  if (bar) bar.style.display = 'none';
  const cntEl = document.getElementById('mpkBarCount');
  if (cntEl) cntEl.textContent = '0';
}

/** 打开 PK 弹窗 */
export function startMatchPK() {
  const sm = window.__ms || {};
  const picked = allMatchesData.filter(function (item) {
    return sm[item.matchId];
  });
  if (picked.length < 2) return;
  if (window.openPKMulti) {
    window.openPKMulti(picked);
    clearMatchPicks();
  }
}
window.startMatchPK = startMatchPK;

function readPendingMatchFocus() {
  try {
    const raw = sessionStorage.getItem('pendingMatchFocus');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearPendingMatchFocus() {
  try {
    sessionStorage.removeItem('pendingMatchFocus');
  } catch (e) {}
}

function focusPendingMatch(matches) {
  const pending = readPendingMatchFocus();
  if (!pending) return;
  const currentWeek = state.weekDates[state.selectedWeekIdx] || null;
  const targetId = String(pending.matchId || '').trim();
  let card = targetId ? document.getElementById('mc-' + targetId) : null;
  if (!card) {
    const targetNum = String(pending.matchNum || '').trim();
    const matched = (Array.isArray(matches) ? matches : []).find(function (m) {
      const matchId = String(m.matchId || m.dataId || '').trim();
      const matchNum = String(m.num || m.matchNum || m.matchId || m.dataId || '').trim();
      return (targetId && matchId === targetId) || (targetNum && matchNum === targetNum);
    });
    if (matched) card = document.getElementById('mc-' + matched.matchId);
  }
  if (!card && pending.matchDate && currentWeek && currentWeek.matchDate && pending.matchDate !== currentWeek.matchDate)
    return;
  if (!card) return;
  document.querySelectorAll('.match-card.match-focus-target').forEach(function (el) {
    el.classList.remove('match-focus-target');
  });
  card.classList.add('match-focus-target');
  requestAnimationFrame(function () {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  window.setTimeout(function () {
    card.classList.remove('match-focus-target');
  }, 2600);
  clearPendingMatchFocus();
}

// 渲染比赛列表 HTML（共用逻辑）
function renderMatchHTML(matches) {
  allMatchesData = matches;
  window.__ms = {};
  const bar = document.getElementById('matchPkBar');
  if (bar) bar.style.display = 'none';
  const pkHint =
    matches.length > 0
      ? '<div class="pk-hint"><span class="pk-hint-icon">💡</span><span class="pk-hint-text">选择两场以上进行PK，自动生成PK方案建议</span></div>'
      : '';
  return (
    pkHint +
    matches
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
        // ★ 让球信息
        const concedeNum = m.concede != null ? Number(m.concede) : 0;
        const concedeLabel =
          concedeNum > 0
            ? '<span class="match-handicap-tag rq-pos">+' + concedeNum + '</span>'
            : concedeNum < 0
              ? '<span class="match-handicap-tag rq-neg">' + concedeNum + '</span>'
              : '';
        let scoreDisplay = '';
        let extraInfo = '';
        if (isLive && scoreText) {
          const parts = scoreText.replace('-', ':').split(':');
          if (parts.length === 2) scoreDisplay = '<span class="match-score">' + parts[0] + ' : ' + parts[1] + '</span>';
        }
        if (m.matchStatus === 1 && durText && durText !== '未') {
          extraInfo += '<span class="match-dur">' + durText + '</span>';
        }
        if (isLive && yellowText && yellowText !== '-') {
          extraInfo += '<span class="match-card-stat yellow"><span class="stat-dot"></span>' + yellowText + '</span>';
        }
        if (isLive && redText && redText !== '-') {
          extraInfo += '<span class="match-card-stat red"><span class="stat-dot"></span>' + redText + '</span>';
        }
        if (halfText) {
          extraInfo += '<span class="match-half">(半 ' + halfText + ')</span>';
        }
        // ★ 让球数显示在半场比分后面
        if (concedeLabel) {
          extraInfo += ' ' + concedeLabel;
        }
        return `
      <div class="match-card" id="mc-${m.matchId}" onclick="goDetail('${m.matchId}')">
        <div class="match-header">
          <div class="match-header-left">
            <label class="mc-chk-wrap" onclick="event.stopPropagation()">
              <input type="checkbox" class="mc-chk" onchange="(function(id){var s=window.__ms||{};if(s[id])delete s[id];else s[id]=1;window.__ms=s;var c=Object.keys(s).length;var b=document.getElementById('matchPkBar');b.style.display=c>=2?'flex':'none';var e=document.getElementById('mpkBarCount');if(e)e.textContent=c;var r=document.getElementById('mc-'+id);if(r){if(s[id])r.classList.add('picked');else r.classList.remove('picked')}})('${m.matchId}')" />
            </label>
            <span class="match-league">${m.leagueName}</span>
          </div>
          <div class="match-header-right">
            ${m.isSingleGame ? '<span class="match-single-badge">单关</span>' : ''}
            <span class="match-num">${roundText}</span>
          </div>
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
        <div class="match-actions">
          <span class="match-ai-tag" onclick="event.stopPropagation();showAIPrediction('${m.matchId}','${(m.homeName || '').replace(/'/g, "\\'")}','${(m.visitName || '').replace(/'/g, "\\'")}')">🤖 AI分析</span>
          ${m.hasGongshoudao ? `<span class="match-gs-tag" onclick="event.stopPropagation();showGongshoudao('${m.matchId}','${(m.leagueName || '').replace(/'/g, "\\'")}','${(m.homeName || '').replace(/'/g, "\\'")}','${(m.visitName || '').replace(/'/g, "\\'")}','${m.num || ''}','${(m.startTime || '').replace(/'/g, "\\'")}')">⚔️ 功守道</span>` : ''}
          <span class="match-bet-btn" onclick="event.stopPropagation();window.switchTab('scheme')">我要做方案</span>
        </div>
      </div>
    `;
      })
      .join('')
  );
}

// 接收预取数据直接渲染（跳过 API 调用）
export function loadMatchListFromData(matches) {
  const el = document.getElementById('matchList');
  if (!el) return;
  const list = matches || [];
  el.innerHTML = renderMatchHTML(list);
  focusPendingMatch(list);
}

export function loadMatchList(prefetchedApi) {
  const el = document.getElementById('matchList');
  if (!el) return;
  // ★ P0: 保留骨架屏不销毁，仅追加加载态指示（避免白屏闪烁）
  const skel = el.querySelector('.page-skeleton');
  if (!skel) {
    el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';
  }

  const w = state.weekDates[state.selectedWeekIdx];
  const cacheKey = 'match-list:' + (w ? w.matchDate : formatDate(new Date()));

  // ★ P1: sessionStorage 缓存命中
  const cached = getCache(cacheKey);
  if (cached) {
    el.innerHTML = renderMatchHTML(cached);
    focusPendingMatch(cached);
    return;
  }

  // ★ P1: 使用预取的 API Promise 或新建请求
  const apiPromise = prefetchedApi && prefetchedApi.then ? prefetchedApi : api('match-list', _buildMatchParams(w));

  apiPromise
    .then(function (matches) {
      setCache(cacheKey, matches);
      el.innerHTML = renderMatchHTML(matches);
      focusPendingMatch(matches);
    })
    .catch(function (e) {
      el.innerHTML = '<div class="loading">' + e.message + '</div>';
    });
}

function _buildMatchParams(w) {
  const params = { _t: Date.now() };
  if (w) {
    params.weekNum = w.weekNum;
    params.matchDate = w.matchDate;
  } else {
    params.date = formatDate(new Date());
  }
  return params;
}

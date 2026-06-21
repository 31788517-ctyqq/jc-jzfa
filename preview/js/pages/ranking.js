import { api } from '../api.js';
import { CAT_NAMES, MIN_PLAN_DATE, formatDate } from '../utils.js';
import * as state from '../vendor.js';
import { loadCSS } from '../vendor.js';
loadCSS('../../css/page-rank.css');

let _rankReqSeq = 0;

function _buildRankParams() {
  const params = {};
  if (state.selectedCategory && state.selectedDirection) params.direction = state.selectedDirection;
  else if (state.selectedCategory) params.category = state.selectedCategory;
  if (state.rankDate) params.date = state.rankDate;
  return params;
}

function _rankCacheKey(params) {
  return 'ranking-list:' + (params.date || '') + '|' + (params.category || '') + '|' + (params.direction || '');
}

function _normalizeRankingDataForRender(data) {
  if (data && Array.isArray(data.ranking)) return data;
  if (!Array.isArray(data)) return { ranking: [], categories: {} };
  return {
    ranking: data.map(function (item, idx) {
      return {
        rank: idx + 1,
        matchId: item.matchId,
        homeName: item.homeName || '',
        visitName: item.visitName || '',
        leagueName: item.leagueName || item.league || '',
        num: item.num || item.matchNum || '',
        direction: item.direction || item.topDirection || '',
        expertCount: Number(item.expertCount || item.topNum || item.recommNum || 0),
        isHit: !!item.isHit,
      };
    }),
    categories: {},
  };
}

function _renderRanking(data, options) {
  options = options || {};
  const el = document.getElementById('rankList');
  const catEl = document.getElementById('catFilterBar');
  const subEl = document.getElementById('subFilterBar');
  if (!el) return;

  const normalized = _normalizeRankingDataForRender(data);

  if (!options.keepCategoryBar && catEl) {
    const catOrder = CAT_NAMES.filter((c) => c === '综合排名' || (normalized.categories && normalized.categories[c]));
    catEl.innerHTML = catOrder
      .map((c) => {
        const isActive = (c === '综合排名' && !state.selectedCategory) || c === state.selectedCategory;
        return (
          '<div class="filter-tag ' +
          (isActive ? 'active' : '') +
          '" onclick="selectCategory(\'' +
          c +
          '\')">' +
          c +
          '</div>'
        );
      })
      .join('');
  }

  if (
    !options.keepCategoryBar &&
    state.selectedCategory &&
    normalized.categories &&
    normalized.categories[state.selectedCategory]
  ) {
    if (subEl) {
      subEl.style.display = 'flex';
      subEl.style.justifyContent = 'flex-start';
      subEl.style.gap = '6px';
      const dirs = normalized.categories[state.selectedCategory].directions;
      subEl.innerHTML = dirs
        .map((d) => {
          const isActive = d.name === state.selectedDirection;
          return (
            '<div class="filter-tag ' +
            (isActive ? 'active' : '') +
            '" onclick="selectDirection(\'' +
            d.name.replace(/'/g, "\\'") +
            '\')">' +
            d.name +
            '</div>'
          );
        })
        .join('');
    }
  } else if (!options.keepCategoryBar) {
    if (subEl) subEl.style.display = 'none';
  }

  const topCount = normalized.ranking.length > 0 ? Number(normalized.ranking[0].expertCount || 1) : 1;
  if (normalized.ranking.length === 0) {
    el.innerHTML = '<p style="color:#6b7280;text-align:center;padding:20px">暂无推荐数据</p>';
    return;
  }

  el.innerHTML = normalized.ranking
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

      const pct = Math.round((Number(item.expertCount || 0) / topCount) * 100);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let matchDate = new Date((item.date || '').slice(0, 10));
      if (isNaN(matchDate.getTime())) matchDate = today;
      const showAI = matchDate >= today;
      let aiTagHtml = '';
      if (showAI) {
        const h = (item.homeName || '').replace(/'/g, '&apos;');
        const v = (item.visitName || '').replace(/'/g, '&apos;');
        aiTagHtml =
          '<div class="rank-ai-tag" onclick="event.stopPropagation();showAIPrediction(\'' +
          item.matchId +
          "','" +
          h +
          "','" +
          v +
          '\')">🤖 AI解析</div>';
      }
      return `
        <div class="rank-card" onclick="goDetail('${item.matchId}')">
          <div class="rank-badge ${badgeClass}">${badgeContent}</div>
          <div class="rank-content">
            <div class="rank-teams">${item.homeName} vs ${item.visitName}</div>
            <div class="rank-meta">${item.leagueName || ''} · ${item.num || ''}</div>
            <div class="rank-direction">${item.direction || ''} · ${Number(item.expertCount || 0)}位专家</div>
            <div class="rank-progress">
              <div class="rank-progress-fill" data-width="${isFinite(pct) ? pct : 0}"></div>
            </div>
          </div>
          ${aiTagHtml}
          ${item.isHit ? '<div class="rank-hit-stamp">中</div>' : ''}
        </div>
      `;
    })
    .join('');

  requestAnimationFrame(() => {
    el.querySelectorAll('.rank-progress-fill').forEach((fill) => {
      fill.style.width = (fill.dataset.width || 0) + '%';
    });
  });
}

export function loadRanking(cat, dir, prefetchedApi) {
  if (cat !== undefined) state.setSelectedCategory(cat);
  if (dir !== undefined) state.setSelectedDirection(dir);

  var el = document.getElementById('rankList');
  if (!el) return;

  var params = _buildRankParams();
  var cacheKey = _rankCacheKey(params);
  var reqId = ++_rankReqSeq;

  var cached = state.getCache(cacheKey);
  if (cached) {
    _renderRanking(cached);
    return;
  }
  // 首页 home-bundle 已含轻量 ranking，首开推荐榜可先秒开预览
  var canUseHomePreview = !params.category && !params.direction;
  var homePreview = canUseHomePreview ? state.getCache('ranking-list:home') : null;
  if (Array.isArray(homePreview) && homePreview.length > 0) {
    _renderRanking(homePreview, { keepCategoryBar: true });
  } else {
    el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';
  }

  // ★ P1: 使用预取的 API Promise 或新建请求
  var apiPromise = prefetchedApi && prefetchedApi.then ? prefetchedApi : api('ranking-list', params);

  apiPromise
    .then(function (data) {
      if (reqId !== _rankReqSeq) return;

      if ((data.ranking || []).length === 0 && !state.selectedCategory && !state.selectedDirection) {
        const now2 = new Date();
        const todayStr2 =
          now2.getFullYear() +
          '-' +
          String(now2.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(now2.getDate()).padStart(2, '0');
        if (state.rankDate === todayStr2 || state.rankDate === '') {
          const d3 = new Date();
          d3.setDate(d3.getDate() + state.rankDateOffset - 1);
          if (formatDate(d3) >= MIN_PLAN_DATE) {
            state.setRankDateOffset(state.rankDateOffset - 1);
            updateRankDateBar();
            loadRanking();
            return;
          }
        }
      }

      state.setCache(cacheKey, data);
      _renderRanking(data);
    })
    .catch(function (e) {
      if (reqId !== _rankReqSeq) return;
      el.innerHTML = '<p style="color:#dc2626;text-align:center;padding:20px">加载失败，请重试</p>';
      console.error('[ranking]', e.message);
    });
}

export function selectCategory(cat) {
  if (cat === '综合排名') {
    state.setSelectedCategory('');
    state.setSelectedDirection('');
  } else {
    state.setSelectedCategory(cat);
    state.setSelectedDirection('');
  }
  loadRanking();
}

export function selectDirection(dir) {
  state.setSelectedDirection(dir);
  loadRanking();
}

// 智能日期停靠：页面加载时定位到 weekDates 中 <= 今天的最近日期
export function _autoSetRankBestDate() {
  const weekDates = state.weekDates || [];
  if (weekDates.length === 0) return;
  const today = formatDate(new Date());
  const todayMD = today.slice(5);
  const dates = weekDates.map(function (w) { return w.matchDate; });
  // 如果今天有比赛数据，直接待在今天
  if (dates.indexOf(todayMD) >= 0) return;
  // 否则找到 <= 今天的最新日期
  let latestMD = '';
  dates.forEach(function (md) {
    if (md <= todayMD && md > latestMD) latestMD = md;
  });
  if (latestMD) {
    const d = new Date();
    const latestDate = new Date(
      d.getFullYear(),
      parseInt(latestMD.slice(0, 2), 10) - 1,
      parseInt(latestMD.slice(3), 10),
    );
    const diffDays = Math.floor((d.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 0) {
      state.setRankDateOffset(-diffDays);
      updateRankDateBar();
      loadRanking();
    }
  }
}

export function updateRankDateBar() {
  const d = new Date();
  d.setDate(d.getDate() + state.rankDateOffset);
  state.setRankDate(
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
  );
  const el = document.getElementById('rankDateCurrent');
  if (!el) return;
  const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const week = weekNames[d.getDay()];
  const mmdd = String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
  const today = new Date().toDateString() === d.toDateString();
  const prefix = today ? '今天 ' : '';
  el.textContent = prefix + mmdd + ' ' + week;
}

export function shiftRankDate(delta) {
  const newOffset = state.rankDateOffset + delta;
  const d = new Date();
  d.setDate(d.getDate() + newOffset);
  const newDate = formatDate(d);
  if (newDate < MIN_PLAN_DATE) return;
  state.setRankDateOffset(newOffset);
  updateRankDateBar();
  loadRanking();
}

export function goRankToday() {
  state.setRankDateOffset(0);
  updateRankDateBar();
  loadRanking();
}

import { api } from '../api.js';
import { CAT_NAMES, MIN_PLAN_DATE } from '../utils.js';
import * as state from '../state.js';

export function loadRanking(cat, dir) {
  if (cat !== undefined) state.setSelectedCategory(cat);
  if (dir !== undefined) state.setSelectedDirection(dir);

  const el = document.getElementById('rankList');
  const catEl = document.getElementById('catFilterBar');
  const subEl = document.getElementById('subFilterBar');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  const params = {};
  if (state.selectedCategory && state.selectedDirection) params.direction = state.selectedDirection;
  else if (state.selectedCategory) params.category = state.selectedCategory;
  if (state.rankDate) params.date = state.rankDate;

  api('ranking-list', params).then(data => {
    if ((data.ranking || []).length === 0 && !state.selectedCategory && !state.selectedDirection) {
      var now2 = new Date();
      var todayStr2 = now2.getFullYear() + '-' + String(now2.getMonth() + 1).padStart(2, '0') + '-' + String(now2.getDate()).padStart(2, '0');
      if (state.rankDate === todayStr2 || state.rankDate === '') {
        var d3 = new Date();
        d3.setDate(d3.getDate() + state.rankDateOffset - 1);
        if (d3.toISOString().slice(0, 10) >= MIN_PLAN_DATE) {
          state.setRankDateOffset(state.rankDateOffset - 1);
          updateRankDateBar();
          loadRanking();
          return;
        }
      }
    }

    if (catEl) {
      const catOrder = CAT_NAMES.filter(c => c === '综合排名' || (data.categories && data.categories[c]));
      catEl.innerHTML = catOrder.map(c => {
        const isActive = (c === '综合排名' && !state.selectedCategory) || c === state.selectedCategory;
        return `<div class="filter-tag ${isActive ? 'active' : ''}" onclick="selectCategory('${c}')">${c}</div>`;
      }).join('');
    }

    if (state.selectedCategory && data.categories && data.categories[state.selectedCategory]) {
      if (subEl) {
        subEl.style.display = 'flex';
        const dirs = data.categories[state.selectedCategory].directions;
        subEl.innerHTML = dirs.map(d => {
          const isActive = d.name === state.selectedDirection;
          return `<div class="filter-tag ${isActive ? 'active' : ''}" onclick="selectDirection('${d.name.replace(/'/g, "\\'")}')">${d.name}</div>`;
        }).join('');
      }
    } else {
      if (subEl) subEl.style.display = 'none';
    }

    const topCount = data.ranking.length > 0 ? data.ranking[0].expertCount : 1;
    el.innerHTML = data.ranking.map(item => {
      const r = item.rank;
      let badgeClass = 'normal', badgeContent = r;
      if (r === 1) { badgeClass = 'gold'; badgeContent = '🥇'; }
      else if (r === 2) { badgeClass = 'silver'; badgeContent = '🥈'; }
      else if (r === 3) { badgeClass = 'bronze'; badgeContent = '🥉'; }

      const pct = Math.round(item.expertCount / topCount * 100);
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
    }).join('');

    requestAnimationFrame(() => {
      el.querySelectorAll('.rank-progress-fill').forEach(fill => {
        setTimeout(() => {
          fill.style.width = fill.dataset.width + '%';
        }, 80);
      });
    });
  });
}

export function selectCategory(cat) {
  if (cat === '综合排名') { state.setSelectedCategory(''); state.setSelectedDirection(''); }
  else { state.setSelectedCategory(cat); state.setSelectedDirection(''); }
  loadRanking();
}

export function selectDirection(dir) {
  state.setSelectedDirection(dir);
  loadRanking();
}

export function updateRankDateBar() {
  var d = new Date();
  d.setDate(d.getDate() + state.rankDateOffset);
  state.setRankDate(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  var el = document.getElementById('rankDateCurrent');
  if (!el) return;
  var weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var week = weekNames[d.getDay()];
  var mmdd = String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
  var today = new Date().toDateString() === d.toDateString();
  var prefix = today ? '今天 ' : '';
  el.textContent = prefix + mmdd + ' ' + week;
}

export function shiftRankDate(delta) {
  var newOffset = state.rankDateOffset + delta;
  var d = new Date();
  d.setDate(d.getDate() + newOffset);
  var newDate = d.toISOString().slice(0, 10);
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

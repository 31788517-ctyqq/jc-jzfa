import { api } from '../api.js';
import { formatDate } from '../utils.js';
import * as state from '../state.js';

export function loadMatchList() {
  const el = document.getElementById('matchList');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  var params = { _t: Date.now() };
  var w = state.weekDates[state.selectedWeekIdx];
  if (w) { params.weekNum = w.weekNum; params.matchDate = w.matchDate; }
  else { params.date = formatDate(new Date()); }

  api('match-list', params).then(matches => {
    el.innerHTML = matches.map(m => {
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
      var scoreDisplay = '';
      var extraInfo = '';
      if (isLive && scoreText) {
        var parts = scoreText.replace('-', ':').split(':');
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
          ${m.hasGongshoudao ? `<div class="match-gs-wrap" onclick="event.stopPropagation();showGongshoudao('${m.matchId}','${(m.leagueName || '').replace(/'/g, "\\'")}','${(m.homeName || '').replace(/'/g, "\\'")}','${(m.visitName || '').replace(/'/g, "\\'")}','${m.num || ''}','${(m.startTime || '').replace(/'/g, "\\'")}')"><span class="match-gs-tag">⚔️ 功守道量化</span></div>` : ''}
        </div>
      `;
    }).join('');
  }).catch(e => {
    el.innerHTML = `<div class="loading">${e.message}</div>`;
  });
}

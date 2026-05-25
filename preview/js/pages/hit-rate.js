import { api } from '../api.js';

export function loadHitRate() {
  const el = document.getElementById('hitContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  api('hit-rate-stats', { days: 60 }).then(data => {
    if (!data || !data.directionStats) {
      el.innerHTML = '<div class="loading">命中率统计需要时间积累</div>';
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

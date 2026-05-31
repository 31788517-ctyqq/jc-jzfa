import { API } from '../utils.js';

export function loadHitRate() {
  const el = document.getElementById('hitContent');
  if (!el) return;

  // 立即显示骨架屏
  el.innerHTML = `
    <div class="hit-skeleton">
      <div class="hit-sk-summary">
        <div class="hit-sk-card"></div>
        <div class="hit-sk-card"></div>
      </div>
      <div class="hit-sk-rank"></div>
      <div class="hit-sk-table"></div>
    </div>
  `;

  // 命中率专用请求：15s 超时 + 2 次重试
  fetchHitRateStats({ days: 60 })
    .then((data) => {
      if (!data || !data.directionStats) {
        el.innerHTML = `
          <div class="hit-empty">
            <span class="hit-empty-icon">📊</span>
            <div class="hit-empty-title">暂无统计数据</div>
            <div class="hit-empty-desc">命中率统计需要历史数据积累<br>请先运行爬虫抓取历史数据</div>
            <button class="hit-retry-btn" onclick="document.dispatchEvent(new Event('retryHitRate'))">重新加载</button>
          </div>
        `;
        return;
      }
      renderHitRate(el, data);
    })
    .catch((e) => {
      el.innerHTML = `
        <div class="hit-empty">
          <span class="hit-empty-icon">⚠️</span>
          <div class="hit-empty-title">加载失败</div>
          <div class="hit-empty-desc">${e.message || '网络异常，请稍后重试'}</div>
          <button class="hit-retry-btn" onclick="document.dispatchEvent(new Event('retryHitRate'))">重新加载</button>
        </div>
      `;
    });
}

/**
 * 命中率专用请求封装（15s 超时，2 次重试）
 */
function fetchHitRateStats(data, retries = 2) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'hit-rate-stats', data }),
    signal: ctrl.signal,
  })
    .then((r) => {
      clearTimeout(timer);
      return r.json();
    })
    .then((d) => {
      if (d.code === 1) return d.data;
      throw new Error(d.msg || '服务器错误');
    })
    .catch((err) => {
      clearTimeout(timer);
      if (err.name === 'AbortError') err = new Error('请求超时');
      if (retries > 0) {
        console.warn(`[HitRate] 请求失败，重试中 (${2 - retries + 1}/2):`, err.message);
        return new Promise((resolve) => setTimeout(resolve, 800)).then(() =>
          fetchHitRateStats(data, retries - 1)
        );
      }
      throw err;
    });
}

/**
 * 渲染命中率数据
 */
function renderHitRate(el, data) {
  const top3Rate = data.top3HitRate !== undefined ? data.top3HitRate : 0;

  let html = `
    <div class="stats-header" style="animation: fadeUp 0.3s ease;">
      <div style="font-size: 11px; color: var(--cyan); margin-bottom: 12px;">近${data.totalDays || 60}天完赛数据概览</div>
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
  let rankHTML = `<div class="hit-ranking-card" style="animation: fadeUp 0.4s ease;">
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
    <div class="chart-box" style="margin-top: 16px; animation: fadeUp 0.5s ease;">
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

  // 渐进式动画：排名条逐行展开
  requestAnimationFrame(() => {
    const bars = document.querySelectorAll('.hit-rank-bar');
    bars.forEach((bar, i) => {
      setTimeout(() => {
        bar.style.width = bar.dataset.width + '%';
      }, 40 * i);
    });
  });
}

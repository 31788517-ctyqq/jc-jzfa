import { API } from '../vendor.js?v=202606152148';

export function loadHitRate() {
  const el = document.getElementById('hitContent');
  if (!el) return;
  el.classList.remove('page-skeleton');
  el.classList.add('hit-content');

  // 立即显示骨架屏（带色块，减少白屏感知）
  el.innerHTML = `
    <div class="hit-skeleton">
      <div class="hit-sk-summary">
        <div class="hit-sk-card hit-sk-card--color"></div>
        <div class="hit-sk-card hit-sk-card--color"></div>
      </div>
      <div class="hit-sk-rank">
        ${Array.from({ length: 6 }, (_, i) => {
          const styles = [
            'hit-sk-bar hit-sk-bar--high',
            'hit-sk-bar hit-sk-bar--mid',
            'hit-sk-bar hit-sk-bar--high',
            'hit-sk-bar hit-sk-bar--low',
            'hit-sk-bar hit-sk-bar--mid',
            'hit-sk-bar hit-sk-bar--low',
          ];
          return (
            '<div class="hit-sk-bar-row"><span class="hit-sk-dot"></span><div class="' + styles[i] + '"></div></div>'
          );
        }).join('')}
      </div>
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
        return new Promise((resolve) => setTimeout(resolve, 800)).then(() => fetchHitRateStats(data, retries - 1));
      }
      throw err;
    });
}

/**
 * 渲染命中率数据
 */
function getHitRateBarStyle(rate) {
  const value = Number(rate || 0);
  if (value >= 60) {
    return 'linear-gradient(90deg, #a7eee6 0%, #5bd4c8 100%)';
  }
  if (value >= 45) {
    return 'linear-gradient(90deg, #d7ebee 0%, #7faeb6 100%)';
  }
  return 'linear-gradient(90deg, #ffd9d0 0%, #f46f59 100%)';
}

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
          <div class="stat-big-value" style="color:#FF7F50">${top3Rate}%</div>
          <div class="stat-big-label">每日≥3场命中率</div>
        </div>
      </div>
    </div>
  `;

  // 过滤掉命中率 0% 的方向
  const nonZeroDirections = data.directionStats.filter(function (d) {
    return d.hitRate > 0;
  });
  const top10 = nonZeroDirections.slice(0, 10);
  let rankHTML = `<div class="hit-ranking-card" style="animation: fadeUp 0.4s ease;">
    <div class="hit-ranking-title">各方向命中排名</div>`;

  top10.forEach((d, i) => {
    const r = i + 1;
    const barStyle = getHitRateBarStyle(d.hitRate);
    const top3Class = r <= 3 ? ' top3' : '';
    rankHTML += `
      <div class="hit-rank-row">
        <span class="hit-rank-num${top3Class}">${r}</span>
        <span class="hit-rank-label">${d.direction}</span>
        <div class="hit-rank-bar-bg">
          <div class="hit-rank-bar" style="background:${barStyle};" data-width="${d.hitRate}"></div>
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
    if (d.hitRate === 0) return; // 隐藏命中率 0% 的方向
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

  // ★ 模型维度命中率（from prediction_outcomes）
  if (data.modelStats && data.modelStats.length > 0) {
    html += '<div class="chart-box" style="margin-top:16px; animation:fadeUp 0.55s ease;">';
    html += '<div class="chart-title" style="margin-bottom:12px;">模型维度 · 方向命中率</div>';
    html += '<table class="data-table" style="display:table;"><thead><tr>';
    html += '<th>模型</th><th>总预测</th><th>命中</th><th>命中率</th>';
    html += '</tr></thead><tbody>';
    data.modelStats.forEach(function (m) {
      var label = m.modelName;
      if (label === 'expert_consensus') label = '专家共识';
      else if (label === 'DeepSeek') label = 'DeepSeek AI';
      else if (label === 'doubao') label = '豆包 AI';
      var color =
        m.hitRate >= 60
          ? 'var(--green)'
          : m.hitRate >= 50
            ? 'var(--cyan)'
            : m.hitRate >= 40
              ? 'var(--amber)'
              : 'var(--red)';
      html += '<tr>';
      html += '<td style="font-weight:600;">' + label + '</td>';
      html += '<td>' + m.total + '</td>';
      html += '<td style="color:var(--green)">' + m.hits + '</td>';
      html += '<td style="color:' + color + ';font-weight:700;">' + m.hitRate + '%</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  }

  // 日趋势图：近30天各方向命中率走势
  if (data.dailyTrend && data.dailyTrend.length > 0) {
    html += '<div class="chart-box" style="margin-top:16px; animation:fadeUp 0.6s ease;">';
    html += '<div class="chart-title" style="margin-bottom:12px;">日趋势 · 各方向命中率</div>';
    html += '<div class="daily-trend-wrap">';
    // 表头
    html += '<table class="daily-trend-table"><thead><tr><th>日期</th>';
    var trendDates = data.dailyTrend.slice(-14); // 取最近14天
    // 收集所有方向名
    var allDirs = {};
    trendDates.forEach(function (day) {
      (day.directions || []).forEach(function (dir) {
        if (dir.direction) allDirs[dir.direction] = true;
      });
    });
    var dirNames = Object.keys(allDirs).slice(0, 6); // 最多展示6个方向
    dirNames.forEach(function (dir) {
      html += '<th class="dtt-dir">' + dir + '</th>';
    });
    html += '</tr></thead><tbody>';
    trendDates.forEach(function (day) {
      html += '<tr><td class="dtt-date">' + day.date.slice(5) + '</td>';
      dirNames.forEach(function (dir) {
        var found = (day.directions || []).find(function (d) {
          return d.direction === dir;
        });
        var rate = found ? found.hitRate : null;
        var cls = rate !== null ? (rate >= 60 ? 'dtt-high' : rate >= 45 ? 'dtt-mid' : 'dtt-low') : '';
        html += '<td class="' + cls + '">' + (rate !== null ? rate + '%' : '-') + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
  }

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

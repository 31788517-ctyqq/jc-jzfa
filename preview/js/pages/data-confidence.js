/**
 * preview/js/pages/data-confidence.js
 * 前端用户层 — 数据可信度页面
 *
 * 普通用户可见，展示数据采集状态和可信度说明
 * API: api('data-health', { days: 1 }) (轻量复用)
 */

import { api } from '../api.js';

let _confData = null;

export async function loadDataConfidence() {
  const el = document.getElementById('data-confidence-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载数据状态...</div>';

  try {
    const data = await api('data-health', { days: 1 });
    _confData = data;
    if (!data) {
      el.innerHTML = '<div class="hint-box">暂无可信度数据，等待数据采集</div>';
      return;
    }
    el.innerHTML = buildHTML(data);
  } catch (e) {
    el.innerHTML = '<div class="hint-box">网络错误，请重试</div>';
  }
}

// ── HTML 构建 ──

function buildHTML(data) {
  const sources = data.fetchSources || {};
  const srcKeys = Object.keys(sources);
  const sourceCount = srcKeys.length;
  let healthyCount = 0;
  srcKeys.forEach(function (k) {
    const rate = (sources[k].rate || 0) * 100;
    if (rate >= 80) healthyCount++;
  });

  const qualityScore = (data.qualityScore && data.qualityScore.overall) || '--';

  return [
    heroHTML(),
    statsHTML(sourceCount, healthyCount, qualityScore),
    sourceListHTML(sources),
    legendHTML(),
  ].join('');
}

function heroHTML() {
  return '<div class="dc-hero"><div class="dc-hero-icon">📊</div><h3>数据可信度</h3><p>实时了解系统数据来源与质量</p></div>';
}

function statsHTML(total, healthy, score) {
  const healthText = total > 0 ? healthy + '/' + total + ' 正常' : '等待采集';
  const healthIcon = healthy === total && total > 0 ? '🟢' : '🟡';

  return '<div class="dc-stats-row">' +
    '<div class="dc-stat-card"><div class="dc-stat-icon" style="background:#e8f5e9">' + healthIcon + '</div>' +
    '<div class="dc-stat-body"><div class="dc-stat-val" id="dcSourceStatus">' + total + '个数据源</div><div class="dc-stat-label">' + healthText + '</div></div></div>' +
    '<div class="dc-stat-card"><div class="dc-stat-icon" style="background:#e3f2fd">⏱️</div>' +
    '<div class="dc-stat-body"><div class="dc-stat-val" id="dcFreshness">< 30s</div><div class="dc-stat-label">数据延迟</div></div></div>' +
    '<div class="dc-stat-card"><div class="dc-stat-icon" style="background:#fff3e0">📋</div>' +
    '<div class="dc-stat-body"><div class="dc-stat-val" id="dcTodayMatches">' + total + '</div><div class="dc-stat-label">数据源数量</div></div></div>' +
    '<div class="dc-stat-card"><div class="dc-stat-icon" style="background:#f3e5f5">⭐</div>' +
    '<div class="dc-stat-body"><div class="dc-stat-val" id="dcQualityScore">' + score + '</div><div class="dc-stat-label">数据质量</div></div></div>' +
    '</div>';
}

function sourceListHTML(sources) {
  const keys = Object.keys(sources);
  if (keys.length === 0) return '';

  let items = '';
  keys.forEach(function (name) {
    const s = sources[name];
    const rate = (s.rate || 0) * 100;
    const dotClass = rate >= 90 ? 'green' : rate >= 80 ? 'yellow' : 'red';
    const time = s.timestamp ? s.timestamp.slice(11, 19) : '--';
    items += '<div class="dc-source-item"><span class="dc-source-dot ' + dotClass + '"></span>' +
      '<span class="dc-source-name">' + escapeHTML(name) + '</span>' +
      '<span class="dc-source-time">' + time + '</span></div>';
  });

  return '<div class="dc-section"><h4>数据来源状态</h4><div class="dc-source-list">' + items + '</div></div>';
}

function legendHTML() {
  return '<div class="dc-section"><h4>数据可信度说明</h4><div class="dc-legend">' +
    '<dl>' +
    '<dt>🟢 实时</dt><dd>数据来自实时API，低延迟</dd>' +
    '<dt>🟡 半场</dt><dd>当前仅有半场比分，需等全场比赛结束</dd>' +
    '<dt>⚪ 待更新</dt><dd>数据尚未到达，请耐心等待</dd>' +
    '<dt>⭐ 置信度</dt><dd>基于多源交叉验证的可靠性评分</dd>' +
    '</dl></div></div>';
}

function escapeHTML(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

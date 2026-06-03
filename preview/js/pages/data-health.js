/**
 * preview/js/pages/data-health.js
 * 数据健康监控看板 — 蓝图 §17.8
 *
 * 低频管理员页面，展示数据源抓取成功率、完整性门禁、最近告警
 * 数据来源: API /api/data-health → data-quality.js monitor
 */

import { api } from '../api.js';

// ═══════════════════════════════════════════════════════
// 页面入口
// ═══════════════════════════════════════════════════════

export async function loadDataHealth() {
  const el = document.getElementById('data-health-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载健康数据...</div>';

  try {
    const res = await api('/api', { action: 'data-health' });
    if (!res || res.code !== 1) {
      el.innerHTML = '<div class="empty-state">数据加载失败</div>';
      return;
    }

    const data = res.data || {};
    el.innerHTML = buildHealthHTML(data);
  } catch (e) {
    console.error('[DataHealth] 加载失败:', e);
    el.innerHTML = '<div class="empty-state">网络错误，请重试</div>';
  }
}

// ═══════════════════════════════════════════════════════
// HTML 构建
// ═══════════════════════════════════════════════════════

function buildHealthHTML(data) {
  const { fetchSources = {}, completeness = {}, recentAlerts = [], dbSize = {}, mismatchDetails = [] } = data;

  return `
    <!-- 数据源抓取成功率 -->
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">数据源抓取成功率</span>
        <span class="chart-hint">门禁: ≥90%</span>
      </div>
      <div class="md-health-bars">
        ${buildHealthBars(fetchSources)}
      </div>
    </div>

    <!-- 完整性检查 -->
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">最近数据完整性</span>
        <span class="chart-hint">门禁: ≥85%</span>
      </div>
      <div class="filter-stats-row">
        <div class="filter-stat-item">
          <div class="filter-stat-value" style="color:${data.matchCount ? 'var(--cyan)' : 'var(--text2)'}">${data.matchCount || 0}</div>
          <div class="filter-stat-label">今日比赛</div>
        </div>
        <div class="filter-stat-divider"></div>
        <div class="filter-stat-item">
          <div class="filter-stat-value" style="color:${(data.completeness || 0) >= 85 ? 'var(--green)' : 'var(--red)'}">${data.completeness || 0}%</div>
          <div class="filter-stat-label">完整度</div>
        </div>
        <div class="filter-stat-divider"></div>
        <div class="filter-stat-item">
          <div class="filter-stat-value">${dbSize.sizeMB ? dbSize.sizeMB.toFixed(1) + 'MB' : '--'}</div>
          <div class="filter-stat-label">数据库</div>
        </div>
      </div>
      ${mismatchDetails.length > 0 ? buildMismatchTable(mismatchDetails) : ''}
    </div>

    <!-- 最近告警 -->
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">最近告警</span>
      </div>
      ${buildAlertsList(recentAlerts)}
    </div>

    <!-- 检查清单 -->
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">门禁状态</span>
      </div>
      <div class="dir-item" style="padding:8px 0">
        <span>📊 500.com 赔率</span>
        <span style="margin-left:auto;color:${(fetchSources['500.com'] || {}).rate >= 0.9 ? 'var(--green)' : 'var(--red)'}">
          ${((fetchSources['500.com'] || {}).rate * 100 || 0).toFixed(1)}%
          ${(fetchSources['500.com'] || {}).rate >= 0.9 ? ' ✅' : ' ⚠️'}
        </span>
      </div>
      <div class="dir-item" style="padding:8px 0">
        <span>📈 米斗推荐</span>
        <span style="margin-left:auto;color:${(fetchSources.midou || {}).rate >= 0.9 ? 'var(--green)' : 'var(--red)'}">
          ${((fetchSources.midou || {}).rate * 100 || 0).toFixed(1)}%
          ${(fetchSources.midou || {}).rate >= 0.9 ? ' ✅' : ' ⚠️'}
        </span>
      </div>
      <div class="dir-item" style="padding:8px 0">
        <span>🤖 DeepSeek AI</span>
        <span style="margin-left:auto;color:${(fetchSources.deepseek || {}).rate >= 0.9 ? 'var(--green)' : 'var(--amber)'}">
          ${((fetchSources.deepseek || {}).rate * 100 || 0).toFixed(1)}%
          ${(fetchSources.deepseek || {}).rate >= 0.9 ? ' ✅' : ' ⚠️'}
        </span>
      </div>
      <div class="dir-item" style="padding:8px 0">
        <span>📋 积分榜</span>
        <span style="margin-left:auto;color:${(fetchSources.standings || {}).rate >= 0.9 ? 'var(--green)' : 'var(--red)'}">
          ${((fetchSources.standings || {}).rate * 100 || 0).toFixed(1)}%
          ${(fetchSources.standings || {}).rate >= 0.9 ? ' ✅' : ' ⚠️'}
        </span>
      </div>
    </div>
  `;
}

function buildHealthBars(sources) {
  if (!sources || Object.keys(sources).length === 0) {
    return '<div class="empty-state">暂无数据源统计数据</div>';
  }

  return Object.entries(sources).map(([name, info]) => {
    const rate = (info.rate || 0) * 100;
    const barColor = rate >= 90 ? 'var(--green)' : rate >= 80 ? 'var(--amber)' : 'var(--red)';
    const icon = rate >= 90 ? '✅' : rate >= 80 ? '⚠️' : '🔴';

    return `
      <div class="md-health-bar-row" style="margin-bottom:12px">
        <div class="md-health-bar-label" style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="color:var(--text);font-size:var(--fs-sm)">${icon} ${name}</span>
          <span style="color:${barColor};font-size:var(--fs-sm);font-weight:700">${rate.toFixed(1)}%</span>
        </div>
        <div class="md-health-bar-track" style="height:8px;background:rgba(255,255,255,.05);border-radius:4px;overflow:hidden">
          <div class="md-health-bar-fill" style="width:${rate}%;height:100%;background:${barColor};border-radius:4px;transition:width 0.3s"></div>
        </div>
        <div class="md-health-bar-detail" style="font-size:var(--fs-xs);color:var(--text3);margin-top:2px">
          成功 ${info.success || 0} / 总计 ${info.total || 0} | 更新: ${info.timestamp || '--'}
        </div>
      </div>
    `;
  }).join('');
}

function buildAlertsList(alerts) {
  if (!alerts || alerts.length === 0) {
    return '<div class="empty-state" style="color:var(--green)">✅ 无告警，系统运行正常</div>';
  }

  return alerts.slice(0, 10).map(a => {
    const levelColor = a.level === 'P0' ? 'var(--red)' : a.level === 'P1' ? 'var(--amber)' : 'var(--text2)';

    return `
      <div class="md-alert-item" style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.03)">
        <div style="display:flex;gap:8px;align-items:flex-start">
          <span style="color:${levelColor};font-weight:700;font-size:var(--fs-xs);white-space:nowrap">[${a.level}]</span>
          <div>
            <div style="font-size:var(--fs-sm);color:var(--text)">${a.message || ''}</div>
            <div style="font-size:var(--fs-xs);color:var(--text3)">${a.time || ''} · ${a.source || ''}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function buildMismatchTable(details) {
  if (!details || details.length === 0) return '';

  return `
    <div style="margin-top:12px;font-size:var(--fs-xs);color:var(--amber);padding:8px;background:rgba(251,191,36,0.06);border-radius:8px">
      <b>⚠️ 数据不一致</b>
      ${details.map(d => `<div style="margin-top:4px">· ${d}</div>`).join('')}
    </div>
  `;
}

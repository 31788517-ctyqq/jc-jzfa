import { api } from '../api.js';
import { formatDate } from '../utils.js';
import { loadECharts, echartsReady } from '../charts.js';
import * as state from '../state.js';

export function goDetail(matchId) {
  if (state.currentPage === 'home') state.setSavedScrollY(window.scrollY);
  state.setLastPage(state.currentPage);
  state.setDetailMatchId(matchId);
  const el = document.getElementById('detailContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';
  window.switchTab('detail');

  Promise.all([
    api('match-detail', { matchId }),
    api('recommend-trend', { matchId })
  ]).then(([detail, trend]) => {
    const match = detail.match || detail;
    const recommends = detail.recommends || [];
    const hasResults = recommends.some(function (r) { return r.result !== null; });
    const statusText = match.matchStatus === 2 || hasResults ? '已结束' : { 0: '未开始', 1: '进行中' }[match.matchStatus] || '未知';
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
      var parts = scoreText.replace('-', ':').split(':');
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
          <span class="match-num" style="background: ${match.matchStatus === 0 && !hasResults ? 'rgba(34,211,238,0.1)' : 'rgba(52,211,153,0.1)'}; color: ${match.matchStatus === 0 && !hasResults ? 'var(--cyan)' : 'var(--green)'}">${statusText}</span>
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

    var hitMap = {};
    recommends.forEach(function (r) { if (r.result === 1) hitMap[r.type] = true; });

    let dirItems = (trend.lastResult || []).filter(r => r.num > 0);
    if (dirItems.length === 0 && recommends.length > 0) {
      const typeMap = {};
      recommends.forEach(r => {
        if (!typeMap[r.type]) typeMap[r.type] = 0;
        typeMap[r.type] += (r.num || 0);
      });
      dirItems = Object.keys(typeMap).map(t => ({ type: t, num: typeMap[t] }));
    }
    var isFinished = match.matchStatus === 2 || recommends.some(function (r) { return r.result !== null; });
    dirItems.sort((a, b) => (b.num || 0) - (a.num || 0)).forEach(r => {
      var isHit = isFinished && hitMap[r.type];
      var hitFlag = isHit ? '<img src="/assets/worldcup/flag-hit.png" class="hit-flag" alt="">' : '';
      var hitClass = isHit ? ' hit' : '';
      html += `
        <div class="dir-item${hitClass}">
          <span class="dir-name">${hitFlag}${r.type}</span>
          <span class="dir-count">${r.num}位</span>
        </div>
      `;
    });
    html += '</div></div>';

    el.innerHTML = html;

    // AI 核心看点卡片隐藏逻辑：比赛日期早于今天则隐藏
    var matchDate = (match.date || '').slice(0, 10);
    var todayStr = formatDate(new Date());
    var isPastMatch = matchDate && matchDate < todayStr;
    if (isPastMatch) {
      var aiCard = el.querySelector('.ai-card');
      if (aiCard) aiCard.style.display = 'none';
    }

    setTimeout(() => {
      const chartEl = document.getElementById('trendChart');
      if (!chartEl) return;
      const top5 = (trend.lastResult || []).sort((a, b) => b.num - a.num).slice(0, 5);

      // 少于2个数据点时不渲染（线图需≥2个点才可读）
      if (!trend || !trend.timeLabels || trend.timeLabels.length < 2 || (trend.series || []).length === 0) {
        chartEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;color:#64748B;">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" opacity="0.5"><path d="M14 25C14 27 15.07 32 29 32C42.93 32 44 27 44 25C44 23 44 10 44 10H29H14C14 10 14 23 14 25Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M29 16H23V21L26 24L29 21V16Z" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 16V10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 40L43 40" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 14H4C4 14 5 19 6 22C7 25 14 24 14 24" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>
          <div style="margin-top:12px;font-size:13px;color:#94A3B8;">趋势数据收集中</div>
          <div style="margin-top:4px;font-size:11px;color:#4B5563;">每20分钟更新一个数据点</div>
        </div>`;
        return;
      }

      loadECharts().then(function () {
        if (!echartsReady) return;
        var existInstance = echarts.getInstanceByDom(chartEl);
        if (existInstance) existInstance.dispose();
        const chart = echarts.init(chartEl);
        const colors = ['#EF4444', '#FBBF24', '#34D399', '#18E0E0', '#A78BFA'];

        var matchedSeries = trend.series.filter(function (s) {
          return top5.some(function (t) { return t.type === s.name; });
        });
        if (matchedSeries.length === 0) matchedSeries = trend.series.slice(0, 5);
        const series = matchedSeries.slice(0, 5).map(function (s, i) {
          return {
            name: s.name,
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { width: 2, color: colors[i] },
            itemStyle: { color: colors[i] },
            data: s.data
          };
        });

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
      });
    }, 100);
  });
}

export function closeAI() {
  var overlay = document.getElementById('aiOverlay');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

export function showAIPrediction(matchId, homeTeam, awayTeam) {
  if (!homeTeam || !awayTeam) {
    var teams = document.querySelectorAll('#detailContent .team-name');
    homeTeam = (teams[0] ? teams[0].textContent : null) || homeTeam || '主队';
    awayTeam = (teams[1] ? teams[1].textContent : null) || awayTeam || '客队';
  }

  // 显示加载态
  var html = '<div class="ai-modal-header"><span class="ai-modal-title">AI深度解析</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>';
  html += '<div class="ai-content"><div style="text-align:center;padding:60px 20px;color:var(--cyan);"><div style="font-size:40px;margin-bottom:16px;">⏳</div><div style="font-size:16px;font-weight:600;">正在交叉分析中...</div><div style="font-size:12px;color:var(--text3);margin-top:8px;">DeepSeek + 豆包 双模型交叉验证</div></div></div>';
  var modalEl = document.getElementById('aiModal');
  if (modalEl) modalEl.innerHTML = html;
  var overlayEl = document.getElementById('aiOverlay');
  if (overlayEl) overlayEl.classList.add('active');
  document.body.style.overflow = 'hidden';

  // 轮询计时变量
  var pollStartTime = Date.now();
  var estimatedTotalSec = 35; // 首个模型预估（比双模型快）
  var retryCount = 0;
  var maxRetries = 30; // 90秒（2秒间隔 × 30 + 首次2秒）
  var pollTimer = null;

  // 更新等待界面
  function updateWaitUI() {
    var elapsed = Math.floor((Date.now() - pollStartTime) / 1000);
    var remaining = Math.max(1, estimatedTotalSec - elapsed);
    var progress = Math.min(98, Math.floor(elapsed / Math.max(estimatedTotalSec, 1) * 100));

    var inner = modalEl ? modalEl.querySelector('.ai-content') : null;
    if (!inner) return;
    inner.innerHTML = '<div style="text-align:center;padding:60px 20px;">' +
      '<div style="font-size:40px;margin-bottom:16px;">⏳</div>' +
      '<div style="font-size:16px;font-weight:600;color:var(--cyan);">正在交叉分析中...</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:6px;">DeepSeek + 豆包 双模型并行，先到先得</div>' +
      '<div style="margin-top:20px;width:220px;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;margin-left:auto;margin-right:auto;">' +
        '<div style="width:' + progress + '%;height:100%;background:var(--cyan);border-radius:2px;transition:width 0.5s ease;"></div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:10px;">' +
        (remaining > 0 ? '首个结果预计还需约 ' + remaining + ' 秒' : '正在收尾，请稍候...') +
      '</div>' +
      '<div style="font-size:10px;color:var(--text3);margin-top:4px;">已等待 ' + elapsed + ' 秒</div>' +
    '</div>';
  }

  function startWaitUI() {
    updateWaitUI();
    // 每秒更新一次进度条
    pollTimer = setInterval(function () {
      if (pollTimer) updateWaitUI();
    }, 1000);
  }

  function stopWaitUI() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ★ 后端等待60s双模型并行，前端直接拿结果
  startWaitUI();

  function pollForMerge(matchId, homeTeam, awayTeam, retries) {
    retries = retries || 0;
    if (retries >= 20) return; // 最多轮询60秒
    setTimeout(function () {
      api('ai-predict', { matchId: matchId }, { timeout: 15000 }).then(function (rd) {
        if (rd.content && !rd.pendingMerge && (rd.dualModel || rd.merged)) {
          // 合并版就绪 → 静默更新展示
          renderAIContent(rd.content, homeTeam, awayTeam);
        } else {
          pollForMerge(matchId, homeTeam, awayTeam, retries + 1);
        }
      }).catch(function () {
        pollForMerge(matchId, homeTeam, awayTeam, retries + 1);
      });
    }, 3000);
  }

  api('ai-predict', { matchId: matchId }, { timeout: 70000 }).then(function (d) {
    stopWaitUI();
    if (d.content) {
      if (d.dualModel && d.merged) {
        // 双模型合并版直接展示
        renderAIContent(d.content, homeTeam, awayTeam);
      } else if (d.singleModel || d.pendingMerge) {
        // 单模型先到先得 → 先展示，后台轮询合并版
        var badge = (d.readySource === 'deepseek' ? 'DeepSeek' : '豆包') + ' 已完成，另一模型验证中...';
        renderAIContentWithBadge(d.content, homeTeam, awayTeam, badge);
        pollForMerge(matchId, homeTeam, awayTeam, 0);
      } else {
        renderAIContent(d.content, homeTeam, awayTeam);
      }
    } else {
      var ac = document.getElementById('aiModal');
      if (ac) {
        var inner = ac.querySelector('.ai-content');
        if (inner) inner.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--amber);"><div style="font-size:40px;margin-bottom:12px;">⏰</div><div style="font-size:16px;font-weight:600;">分析未就绪</div><div style="font-size:12px;color:var(--text3);margin-top:8px;">请稍后重试</div><button style="margin-top:20px;padding:10px 28px;border-radius:24px;background:var(--cyan);color:var(--bg);border:none;cursor:pointer;font-size:14px;font-weight:600;" onclick="showAIPrediction(\'' + matchId + '\')">重试</button></div>';
      }
    }
  }).catch(function (e) {
    stopWaitUI();
    var ac = document.getElementById('aiModal');
    if (ac) {
      var inner = ac.querySelector('.ai-content');
      var msg = e && e.message ? e.message : '网络连接失败';
      if (inner) inner.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--amber);"><div style="font-size:40px;margin-bottom:12px;">⚠️</div><div style="font-size:16px;font-weight:600;">请求失败</div><div style="font-size:12px;color:var(--text3);margin-top:8px;">' + msg + '</div><button style="margin-top:16px;padding:8px 20px;border-radius:20px;background:var(--cyan);color:var(--bg);border:none;cursor:pointer;font-size:13px;" onclick="showAIPrediction(\'' + matchId + '\')">重试</button></div>';
    }
  });
}

export function renderAIContent(content, homeTeam, awayTeam) {
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

  function esc(s) { var str = (s == null ? '' : String(s)); return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function clip(s, max) { var str = (s == null ? '' : String(s)); if (str.length <= max) return str; var idx = str.lastIndexOf('。', max); if (idx > max * 0.5) return str.substring(0, idx + 1); idx = str.lastIndexOf('，', max); if (idx > max * 0.5) return str.substring(0, idx) + '...'; return str.substring(0, max - 3) + '...'; }
  function has(s) { return s && (typeof s === 'string' ? s.trim().length > 0 : true); }

  var html = '';
  html += '<div class="ai-modal-header"><span class="ai-modal-title">AI深度解析</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>';
  html += '<div class="ai-content">';

  html += '<div class="ai-match-info"><div class="ai-team"><div class="ai-team-logo">' + esc(homeTeam[0]) + '</div><div class="ai-team-name">' + esc(homeTeam) + '</div></div><div class="ai-vs-section"><div class="ai-vs-text">VS</div></div><div class="ai-team"><div class="ai-team-logo away">' + esc(awayTeam[0]) + '</div><div class="ai-team-name">' + esc(awayTeam) + '</div></div></div>';

  var coreView = esc(highlight['核心看点'] || c['核心观点'] || '');
  var varRemind = esc(highlight['变数提醒'] || c['变数提醒'] || '');
  var icons = ['🏆', '⚽', '📊'];
  html += '<div class="ai-core-view">';
  html += '<div class="ai-core-header"><span class="ai-core-icon">💡</span><span class="ai-core-title">AI核心观点</span></div>';
  html += '<div class="ai-core-content">' + clip(coreView, 120) + '</div>';
  if (varRemind) html += '<div class="ai-core-desc">' + clip(varRemind, 80) + '</div>';
  html += '<div class="ai-predict-row">';
  preds.forEach(function (p, i) {
    var val = esc(p['建议方向'] || '');
    html += '<div class="ai-predict-card">';
    html += '<div class="ai-predict-head"><span class="ai-predict-icon">' + (icons[i] || '●') + '</span><span class="ai-predict-name">' + esc(p['玩法'] || '') + '</span></div>';
    html += '<div class="ai-predict-value">' + val + '</div>';
    html += '<div class="ai-predict-line"></div>';
    html += '<div class="ai-predict-sub">' + clip(esc(p['核心逻辑'] || ''), 50) + '</div>';
    html += '</div>';
  });
  html += '</div></div>';

  // 01 基础面
  var bRank = baseStr['积分排名'] || '';
  var bHasRank = bRank.length > 5;
  var bHasTable = baseTable && baseTable.rows && baseTable.rows.length >= 3;
  var bHasBaseCon = has(baseStr['核心结论']);
  if (bHasRank || bHasTable || bHasBaseCon) {
    html += '<div id="ai-sec-01" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">01</span><span class="ai-sec-name">基础面</span>'; if (baseStr['概括']) html += '<span class="ai-sec-desc">' + clip(esc(baseStr['概括']), 20) + '</span>'; html += '</div>';
    if (bHasRank) {
      var rankHome = '', rankAway = '';
      var idxH = -1, idxA = -1;
      idxH = bRank.indexOf(homeTeam); idxA = bRank.indexOf(awayTeam);
      if (idxH < 0 && homeTeam.length >= 2) idxH = bRank.indexOf(homeTeam.substring(0, 2));
      if (idxA < 0 && awayTeam.length >= 2) idxA = bRank.indexOf(awayTeam.substring(0, 2));
      if (idxH < 0) idxH = bRank.indexOf(homeTeam[0]);
      if (idxA < 0) idxA = bRank.indexOf(awayTeam[0]);
      if (idxH >= 0 && idxA < 0) {
        var dots = []; for (var di = idxH + 1; di < bRank.length; di++) { if (bRank[di] === '。' || bRank[di] === '；') dots.push(di); }
        if (dots.length > 0 && dots[0] > idxH && dots[0] < bRank.length - 3) { idxA = dots[0] + 1; }
      } else if (idxA >= 0 && idxH < 0) {
        var dots2 = []; for (var di2 = idxA + 1; di2 < bRank.length; di2++) { if (bRank[di2] === '。' || bRank[di2] === '；') dots2.push(di2); }
        if (dots2.length > 0 && dots2[0] > idxA && dots2[0] < bRank.length - 3) { idxH = dots2[0] + 1; }
      }
      if (idxH >= 0 && idxA >= 0) {
        if (idxA > idxH) { rankHome = clip(esc(bRank.substring(0, idxA)), 60); rankAway = clip(esc(bRank.substring(idxA)), 60); }
        else { rankAway = clip(esc(bRank.substring(0, idxH)), 60); rankHome = clip(esc(bRank.substring(idxH)), 60); }
      }
      if (rankHome || rankAway) {
        html += '<div class="ai-rank-dual"><div class="ai-rank-col"><div class="ai-rank-h">' + esc(homeTeam) + '</div><div class="ai-rank-val">' + (rankHome || '\u2014') + '</div></div><div class="ai-rank-col"><div class="ai-rank-h">' + esc(awayTeam) + '</div><div class="ai-rank-val">' + (rankAway || '\u2014') + '</div></div></div>';
      } else {
        html += '<div class="ai-rank-single"><div class="ai-rank-val">' + clip(esc(bRank), 120) + '</div></div>';
      }
    }
    if (bHasTable) {
      var adCheck = baseStr['_attackDefenseCheck'];
      var hasAdConflict = adCheck && adCheck.detected;
      html += '<div class="ai-data-compare"><div class="ai-data-title">攻防数据对比';
      if (hasAdConflict) html += ' <span style="font-size:10px;color:var(--amber);">⚠️ 双模型数据不一致</span>';
      html += '</div>';

      // 构建冲突快速索引
      var adConflictMap = {};
      if (adCheck && adCheck.conflicts) {
        adCheck.conflicts.forEach(function (c) { adConflictMap[c.label] = c; });
      }

      baseTable.rows.forEach(function (row) {
        if (row.length < 3) return;
        var label = row[0], hv = row[1], av = row[2];
        var isShooter = (label.indexOf('射手') >= 0);
        var rowConflict = adConflictMap[label];
        var isConflict = rowConflict && rowConflict.conflict;

        if (isShooter) {
          html += '<div class="ai-shooter-dual"><div class="ai-shooter-item home"><span class="ai-shooter-tag">主</span><span class="ai-shooter-desc">' + esc(hv) + '</span></div><div class="ai-shooter-divider"></div><div class="ai-shooter-item away"><span class="ai-shooter-tag">客</span><span class="ai-shooter-desc">' + esc(av) + '</span></div></div>';
          if (isConflict) {
            html += '<div style="margin:2px 0 6px 10px;font-size:10px;color:var(--text3);display:flex;justify-content:space-around;">';
            html += '<span>豆包: ' + esc(rowConflict.dbHome || '--') + ' / ' + esc(rowConflict.dbAway || '--') + '</span>';
            html += '</div>';
          }
        } else {
          var hn = parseFloat(hv), an = parseFloat(av);
          var hp = isNaN(hn) || isNaN(an) ? 50 : Math.round(hn / (hn + an) * 100);
          html += '<div class="ai-data-row' + (isConflict ? '' : '') + '">';
          html += '<span class="ai-data-label">' + esc(label);
          if (isConflict) html += ' <span style="font-size:9px;color:var(--amber);">⚠</span>';
          html += '</span>';
          html += '<span class="ai-data-home">' + esc(hv) + '</span>';
          html += '<div class="ai-progress-bar"><div class="ai-progress" style="width:' + hp + '%"></div></div>';
          html += '<span class="ai-data-away">' + esc(av) + '</span>';
          html += '</div>';

          // 豆包对比行（仅冲突时显示）
          if (isConflict && rowConflict.dbHome && rowConflict.dbAway) {
            var dbHn = parseFloat(rowConflict.dbHome), dbAn = parseFloat(rowConflict.dbAway);
            var dbHp = isNaN(dbHn) || isNaN(dbAn) ? 50 : Math.round(dbHn / (dbHn + dbAn) * 100);
            html += '<div class="ai-data-row" style="opacity:0.6;padding:2px 0 6px 0;font-size:11px;">';
            html += '<span class="ai-data-label" style="font-size:10px;color:#a855f7;">豆包</span>';
            html += '<span class="ai-data-home" style="font-size:12px;color:#a855f7;">' + esc(rowConflict.dbHome) + '</span>';
            html += '<div class="ai-progress-bar"><div class="ai-progress" style="width:' + dbHp + '%;background:linear-gradient(90deg,#a855f7,rgba(168,85,247,0.4));"></div></div>';
            html += '<span class="ai-data-away" style="font-size:12px;color:#a855f7;">' + esc(rowConflict.dbAway) + '</span>';
            html += '</div>';
          }
        }
      });
      html += '</div>';
    }
    if (bHasBaseCon) html += '<div class="ai-item-conclusion"><div class="ai-item-label">核心结论</div><div class="ai-item-text">' + clip(esc(baseStr['核心结论']), 120) + '</div></div>';
    html += '</div>';
  }

  // 02 状态面
  var hf = (stateStr['主队近况'] || '').match(/(\d+)胜(\d+)平(\d+)负/), af = (stateStr['客队近况'] || '').match(/(\d+)胜(\d+)平(\d+)负/);
  var hasHistory = has(stateStr['历史对阵']); var injTable = stateStr['伤病影响']; var hasInj = injTable && injTable.rows && injTable.rows.length; var hasStateCon = has(stateStr['核心结论']);
  var rfc = stateStr['_recentFormCheck']; // 近期战绩交叉验证数据
  if (hf || af || hasHistory || hasInj || hasStateCon) {
    html += '<div id="ai-sec-02" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">02</span><span class="ai-sec-name">状态面</span></div>';
    if (hf || af) { html += '<div class="ai-form-title">近期战绩对比</div>'; }

    // 辅助函数：渲染 W/D/L 小圆点
    function renderFormDots(w, d, l) {
      var dots = '';
      for (var di = 0; di < w; di++) dots += '<span class="ai-form-dot w">W</span>';
      for (var di = 0; di < d; di++) dots += '<span class="ai-form-dot d">D</span>';
      for (var di = 0; di < l; di++) dots += '<span class="ai-form-dot l">L</span>';
      return dots;
    }

    // 渲染主队近期战绩
    if (rfc && rfc.conflicts && rfc.conflicts.home && rfc.conflicts.home.conflict) {
      var hc = rfc.conflicts.home;
      var dsH = hc.deepseek, dbH = hc.doubao;
      html += '<div class="ai-form-row" style="flex-wrap:wrap;gap:6px;padding:8px 10px;">';
      html += '<span class="ai-form-label" style="width:100%;margin-bottom:2px;">' + esc(homeTeam) + ' <span style="font-size:10px;color:var(--amber);">⚠️ 双模型数据不一致</span></span>';
      if (dsH && dbH) {
        html += '<div style="display:flex;width:100%;gap:8px;">';
        html += '<div style="flex:1;padding:6px 8px;background:rgba(34,211,238,0.06);border-radius:6px;border:1px solid rgba(34,211,238,0.15);">';
        html += '<div style="font-size:10px;color:var(--cyan);margin-bottom:3px;">DeepSeek</div>';
        html += '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' + renderFormDots(dsH.w, dsH.d, dsH.l) + '<span class="ai-form-summary">' + dsH.w + 'W ' + dsH.d + 'D ' + dsH.l + 'L</span></div></div>';
        html += '<div style="flex:1;padding:6px 8px;background:rgba(168,85,247,0.06);border-radius:6px;border:1px solid rgba(168,85,247,0.15);">';
        html += '<div style="font-size:10px;color:#a855f7;margin-bottom:3px;">豆包</div>';
        html += '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' + renderFormDots(dbH.w, dbH.d, dbH.l) + '<span class="ai-form-summary">' + dbH.w + 'W ' + dbH.d + 'D ' + dbH.l + 'L</span></div></div>';
        html += '</div>';
      }
      html += '</div>';
    } else if (hf) {
      html += '<div class="ai-form-row"><span class="ai-form-label">' + esc(homeTeam) + '</span>';
      html += renderFormDots(parseInt(hf[1]), parseInt(hf[2]), parseInt(hf[3]));
      html += '<span class="ai-form-summary">' + hf[1] + 'W ' + hf[2] + 'D ' + hf[3] + 'L</span></div>';
    }

    // 渲染客队近期战绩
    if (rfc && rfc.conflicts && rfc.conflicts.away && rfc.conflicts.away.conflict) {
      var ac = rfc.conflicts.away;
      var dsA = ac.deepseek, dbA = ac.doubao;
      html += '<div class="ai-form-row" style="flex-wrap:wrap;gap:6px;padding:8px 10px;">';
      html += '<span class="ai-form-label" style="width:100%;margin-bottom:2px;">' + esc(awayTeam) + ' <span style="font-size:10px;color:var(--amber);">⚠️ 双模型数据不一致</span></span>';
      if (dsA && dbA) {
        html += '<div style="display:flex;width:100%;gap:8px;">';
        html += '<div style="flex:1;padding:6px 8px;background:rgba(34,211,238,0.06);border-radius:6px;border:1px solid rgba(34,211,238,0.15);">';
        html += '<div style="font-size:10px;color:var(--cyan);margin-bottom:3px;">DeepSeek</div>';
        html += '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' + renderFormDots(dsA.w, dsA.d, dsA.l) + '<span class="ai-form-summary">' + dsA.w + 'W ' + dsA.d + 'D ' + dsA.l + 'L</span></div></div>';
        html += '<div style="flex:1;padding:6px 8px;background:rgba(168,85,247,0.06);border-radius:6px;border:1px solid rgba(168,85,247,0.15);">';
        html += '<div style="font-size:10px;color:#a855f7;margin-bottom:3px;">豆包</div>';
        html += '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' + renderFormDots(dbA.w, dbA.d, dbA.l) + '<span class="ai-form-summary">' + dbA.w + 'W ' + dbA.d + 'D ' + dbA.l + 'L</span></div></div>';
        html += '</div>';
      }
      html += '</div>';
    } else if (af) {
      html += '<div class="ai-form-row"><span class="ai-form-label">' + esc(awayTeam) + '</span>';
      html += renderFormDots(parseInt(af[1]), parseInt(af[2]), parseInt(af[3]));
      html += '<span class="ai-form-summary">' + af[1] + 'W ' + af[2] + 'D ' + af[3] + 'L</span></div>';
    }

    if (hasHistory) html += '<div class="ai-item"><div class="ai-item-label">历史交锋</div><div class="ai-item-text">' + clip(esc(stateStr['历史对阵']), 120) + '</div></div>';
    if (hasInj) { html += '<div class="ai-injury-title">伤停对比</div>'; injTable.rows.forEach(function (row) { if (row.length < 3) return; var isHome = (row[0].indexOf('主') >= 0 || row[0].indexOf(homeTeam) >= 0); var tag = isHome ? esc(homeTeam[0]) : esc(awayTeam[0]); var tagClass = isHome ? 'home' : 'away'; html += '<div class="ai-injury-row"><div class="ai-injury-head"><span class="ai-injury-badge ' + tagClass + '">' + tag + '</span><span class="ai-injury-team">' + esc(row[0]) + '</span></div><div class="ai-injury-detail">' + esc(row[1]) + '</div></div>'; }); }
    if (hasStateCon) html += '<div class="ai-item-conclusion"><div class="ai-item-label">核心结论</div><div class="ai-item-text">' + clip(esc(stateStr['核心结论']), 120) + '</div></div>';
    html += '</div>';
  }

  // 03 动机面
  var hasWill = has(motiStr['战意强度']);
  html += '<div id="ai-sec-03" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">03</span><span class="ai-sec-name">动机面</span></div>';
  if (hasWill) html += '<div class="ai-item"><div class="ai-item-label">战意强度</div><div class="ai-item-text">' + clip(esc(motiStr['战意强度']), 120) + '</div></div>';
  html += '</div>';

  // 04 对位面
  var posGood = has(posStr['攻防博弈']) || has(posStr['节奏控制']);
  var posBad = has(posStr['主场氛围']) || has(posStr['战术与教练风格']);
  var hasPosCon = has(posStr['核心结论']);
  if (posGood || posBad || hasPosCon) {
    html += '<div id="ai-sec-04" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">04</span><span class="ai-sec-name">对位面</span></div>';
    html += '<div class="ai-swp-grid">';
    html += '<div class="ai-swp-card good"><div class="ai-swp-card-head"><span class="ai-swp-card-icon good">\u25B2</span><span class="ai-swp-card-label">主队优势</span></div>';
    if (has(posStr['攻防博弈'])) html += '<div class="ai-swp-card-item">' + clip(esc(posStr['攻防博弈']), 70) + '</div>';
    if (has(posStr['节奏控制'])) html += '<div class="ai-swp-card-item">' + clip(esc(posStr['节奏控制']), 70) + '</div>';
    html += '</div>';
    html += '<div class="ai-swp-card bad"><div class="ai-swp-card-head"><span class="ai-swp-card-icon bad">\u25BC</span><span class="ai-swp-card-label">客队隐患</span></div>';
    if (has(posStr['主场氛围'])) html += '<div class="ai-swp-card-item">' + clip(esc(posStr['主场氛围']), 70) + '</div>';
    if (has(posStr['战术与教练风格'])) html += '<div class="ai-swp-card-item">' + clip(esc(posStr['战术与教练风格']), 70) + '</div>';
    html += '</div></div>';
    if (hasPosCon) html += '<div class="ai-item-conclusion amber"><div class="ai-item-label">综合判断</div><div class="ai-item-text">' + clip(esc(posStr['核心结论']), 120) + '</div></div>';
    html += '</div>';
  }

  // 05 市场面
  var hasOdds = has(mktStr['盘口与赔率']) || has(mktStr['大小球']); var hasMktCon = has(mktStr['核心结论']);
  if (hasOdds || hasMktCon) {
    html += '<div id="ai-sec-05" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">05</span><span class="ai-sec-name">市场面</span></div>';
    if (has(mktStr['盘口与赔率'])) html += '<div class="ai-item"><div class="ai-item-label">盘口与赔率</div><div class="ai-item-text">' + clip(esc(mktStr['盘口与赔率']), 120) + '</div></div>';
    if (has(mktStr['大小球'])) html += '<div class="ai-item"><div class="ai-item-label">大小球</div><div class="ai-item-text">' + clip(esc(mktStr['大小球']), 120) + '</div></div>';
    if (hasMktCon) html += '<div class="ai-item-conclusion amber"><div class="ai-item-label">市场解读</div><div class="ai-item-text">' + clip(esc(mktStr['核心结论']), 120) + '</div></div>';
    html += '</div>';
  }

  // 06 预测建议
  html += '<div id="ai-sec-06" class="ai-section-content" style="border-left-color:rgba(52,211,153,0.3)"><div class="ai-sec-title"><span class="ai-sec-num">06</span><span class="ai-sec-name">预测建议</span></div><div class="ai-predict-table">';
  preds.forEach(function (p) {
    html += '<div class="ai-predict-tr"><span class="ai-predict-td type">' + esc(p['玩法'] || '') + '</span><span class="ai-predict-td suggest">' + esc(p['建议方向'] || '') + '</span><span class="ai-predict-td logic">' + esc(p['核心逻辑'] || '') + '</span><span class="ai-predict-td check">\u2713</span></div>';
  });
  html += '</div></div>';
  html += '<div class="ai-disclaimer">本分析为AI生成，仅供参考，请理性对待</div>';
  html += '</div>';

  var modalEl2 = document.getElementById('aiModal');
  if (modalEl2) modalEl2.innerHTML = html;
}

// 渲染部分结果 + 交叉验证中 badge
export function renderAIContentWithBadge(content, homeTeam, awayTeam, badgeText) {
  renderAIContent(content, homeTeam, awayTeam);
  // 在 disclaimer 前插入合并等待提示
  var modal = document.getElementById('aiModal');
  if (!modal) return;
  var dis = modal.querySelector('.ai-disclaimer');
  if (dis) {
    dis.insertAdjacentHTML('beforebegin',
      '<div style="margin:12px 20px;padding:8px 14px;border-radius:8px;background:rgba(34,211,238,0.08);border:1px solid rgba(34,211,238,0.2);font-size:12px;color:var(--cyan);text-align:center;">' +
        '⏳ ' + (badgeText || '交叉验证中...') +
      '</div>'
    );
  }
}

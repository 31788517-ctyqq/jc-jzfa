import { api } from '../api.js';
import { formatDate } from '../utils.js';
import { loadECharts, echartsReady } from '../charts.js';
import * as state from '../state.js';

// AI 深度解析缓存：{ matchId: { content: ..., hash: ... } }
var predictionCache = {};
var _aiModalMatchId = null; // ★ 缓存的 matchId，供"我要做方案"按钮使用
(function restoreCache() {
  try {
    var saved = sessionStorage.getItem('__ai_prediction_cache');
    if (saved) {
      var parsed = JSON.parse(saved);
      var today = formatDate(new Date());
      Object.keys(parsed).forEach(function (k) {
        if (parsed[k] && parsed[k]._date === today) predictionCache[k] = parsed[k];
      });
    }
  } catch (e) {}
})();
function persistPredictionCache() {
  try {
    var toSave = {};
    var today = formatDate(new Date());
    Object.keys(predictionCache).forEach(function (k) {
      var v = predictionCache[k];
      if (v) toSave[k] = { content: v.content, hash: v.hash, _date: today };
    });
    sessionStorage.setItem('__ai_prediction_cache', JSON.stringify(toSave));
  } catch (e) {}
}

export function goDetail(matchId) {
  if (state.currentPage === 'home') state.setSavedScrollY(window.scrollY);
  state.setLastPage(state.currentPage);
  state.setDetailMatchId(matchId);
  // ★ 先切换标签，确保 page-detail 容器已创建
  window.switchTab('detail');
  const el = document.getElementById('detailContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  Promise.all([api('match-detail', { matchId }), api('recommend-trend', { matchId })]).then(([detail, trend]) => {
    const match = detail.match || detail;
    const recommends = detail.recommends || [];
    const hasResults = recommends.some(function (r) {
      return r.result !== null;
    });
    const statusText =
      match.matchStatus === 2 || hasResults ? '已结束' : { 0: '未开始', 1: '进行中' }[match.matchStatus] || '未知';
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

    // ★ 蓝图新增：四个数据区块（数据为空自动跳过）
    if (detail.consensus) {
      html += renderConsensusBar(detail.consensus);
    }
    if (detail.gsData) {
      html += renderGsSummary(detail.gsData);
    }
    if (detail.features && hasRecentForm(detail.features)) {
      html += renderRecentForm(match, detail.features);
    }
    if (detail.standings && (detail.standings.home || detail.standings.away)) {
      html += renderStandingsContext(match, detail.standings);
    }
    if (detail.h2h && detail.h2h.length > 0) {
      html += renderH2HSummary(match, detail.h2h);
    }

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
    recommends.forEach(function (r) {
      if (r.result === 1) hitMap[r.type] = true;
    });

    let dirItems = (trend.lastResult || []).filter((r) => r.num > 0);
    if (dirItems.length === 0 && recommends.length > 0) {
      const typeMap = {};
      recommends.forEach((r) => {
        if (!typeMap[r.type]) typeMap[r.type] = 0;
        typeMap[r.type] += r.num || 0;
      });
      dirItems = Object.keys(typeMap).map((t) => ({ type: t, num: typeMap[t] }));
    }
    var isFinished =
      match.matchStatus === 2 ||
      recommends.some(function (r) {
        return r.result !== null;
      });
    dirItems
      .sort((a, b) => (b.num || 0) - (a.num || 0))
      .forEach((r) => {
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
          return top5.some(function (t) {
            return t.type === s.name;
          });
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
            data: s.data,
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
            textStyle: { fontSize: 10, color: '#94A3B8' },
          },
          grid: { left: '2%', right: '4%', bottom: '18%', top: '5%', containLabel: true },
          xAxis: {
            type: 'category',
            data: trend.timeLabels,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { fontSize: 10, color: '#64748B' },
          },
          yAxis: {
            type: 'value',
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { fontSize: 10, color: '#64748B' },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.03)' } },
          },
          series,
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

// ★ 从 AI 弹窗跳转方案设计页
window.goFromAIToScheme = function() {
  if (_aiModalMatchId) {
    try { sessionStorage.setItem('preselectMatch', _aiModalMatchId); } catch(e) {}
  }
  closeAI();
  window.switchTab('scheme');
};

export function showAIPrediction(matchId, homeTeam, awayTeam) {
  _aiModalMatchId = matchId; // ★ 缓存 matchId
  if (!homeTeam || !awayTeam) {
    var teams = document.querySelectorAll('#detailContent .team-name');
    homeTeam = (teams[0] ? teams[0].textContent : null) || homeTeam || '主队';
    awayTeam = (teams[1] ? teams[1].textContent : null) || awayTeam || '客队';
  }

  var modalEl = document.getElementById('aiModal');
  var overlayEl = document.getElementById('aiOverlay');

  // ═══ 缓存命中：直接渲染 + 后台静默检查是否有更新 ═══
  if (predictionCache[matchId]) {
    var cached = predictionCache[matchId];
    // 立即展示缓存内容，跳过加载动画
    renderCachedContent(cached.content, homeTeam, awayTeam, cached.content, matchId);
    if (overlayEl) overlayEl.classList.add('active');
    document.body.style.overflow = 'hidden';

    // 后台静默校验：有变化时无声更新
    api('ai-predict', { matchId: matchId }, 2)
      .then(function (d) {
        var newHash = JSON.stringify(d.content || '');
        if (newHash !== cached.hash && d.content) {
          // 内容有变化，静默更新缓存和 DOM
          predictionCache[matchId] = { content: d, hash: newHash };
          persistPredictionCache();
          renderCachedContent(d, homeTeam, awayTeam, d, matchId);
        }
        // hash 未变 → 不做任何事，用户已看到内容
      });
    return;
  }

  // ═══ 首次访问：走完整模拟加载流程 ═══
  doFakeLoading(matchId, homeTeam, awayTeam, modalEl, overlayEl, null);
}

function renderCachedContent(content, homeTeam, awayTeam, newData, matchId) {
  // 直接用缓存内容渲染，跳过加载动画
  var resultData = newData || content;
  if (resultData && resultData.content) {
    if (resultData.dualModel && resultData.merged) {
      renderAIContent(resultData.content, homeTeam, awayTeam);
    } else if (resultData.singleModel && resultData.failedSource) {
      var failBadge = (resultData.failedSource === 'deepseek' ? 'DeepSeek' : '豆包') + ' 分析未成功，仅展示 ' + (resultData.readySource === 'deepseek' ? 'DeepSeek' : '豆包') + ' 结果';
      renderAIContentWithBadge(resultData.content, homeTeam, awayTeam, failBadge);
    } else if (resultData.singleModel || resultData.pendingMerge) {
      var badge = (resultData.readySource === 'deepseek' ? 'DeepSeek' : '豆包') + ' 已完成，另一模型分析中...';
      renderAIContentWithBadge(resultData.content, homeTeam, awayTeam, badge);
    } else {
      renderAIContent(resultData.content, homeTeam, awayTeam);
    }
    if (resultData.shujuMissing) {
      showShujuMissingNotice();
    }
  } else if (resultData && resultData.notReady) {
    var ac = document.getElementById('aiModal');
    if (ac) {
      var inr = ac.querySelector('.ai-content');
      if (inr)
        inr.innerHTML =
          '<div style="text-align:center;padding:40px 20px;color:var(--cyan);"><div style="font-size:48px;margin-bottom:16px;">📋</div><div style="font-size:16px;font-weight:600;">分析生成中</div><div style="font-size:12px;color:var(--text3);margin-top:8px;line-height:1.6;">' +
          (resultData.msg || 'AI 深度解析由定时任务（11:30 / 16:30）统一生成<br>到时间后刷新页面即可查看') +
          '</div><button style="margin-top:16px;padding:10px 28px;border-radius:24px;background:var(--cyan);color:var(--bg);border:none;cursor:pointer;font-size:14px;font-weight:600;margin-right:8px;" onclick="closeAI();showAIPrediction(\'' + (matchId || '') + '\',\'' + (homeTeam || '').replace(/'/g, "\\'") + '\',\'' + (awayTeam || '').replace(/'/g, "\\'") + '\')">刷新重试</button><button style="margin-top:16px;padding:10px 28px;border-radius:24px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-size:14px;" onclick="closeAI()">关闭</button></div>';
    }
  }
}

function doFakeLoading(matchId, homeTeam, awayTeam, modalEl, overlayEl, preloadedData) {
  // 显示加载态
  var html =
    '<div class="ai-modal-header"><span class="ai-modal-title">AI深度解析</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>';
  html +=
    '<div class="ai-content"><div style="text-align:center;padding:60px 20px;color:var(--cyan);"><div style="font-size:40px;margin-bottom:16px;">⏳</div><div style="font-size:16px;font-weight:600;">正在交叉分析中...</div><div style="font-size:12px;color:var(--text3);margin-top:8px;">DeepSeek + 豆包 双模型交叉验证</div></div></div>';
  if (modalEl) modalEl.innerHTML = html;
  if (overlayEl) overlayEl.classList.add('active');
  document.body.style.overflow = 'hidden';

  // ═══ 假进度条：模拟实时 AI 运算耗时（3-5s） ═══
  var fakeDurationSec = Math.floor(Math.random() * 3) + 3; // 3-5 秒
  var fakeStartTime = Date.now();
  var pendingResult = preloadedData; // 可能已有预加载数据
  var apiDone = !!preloadedData;     // 如果预加载了数据则标记已完成
  var apiError = null;               // API 异常暂存
  var pollTimer = null;
  var rendered = false;              // 防止重复渲染

  function updateFakeProgress() {
    var elapsed = (Date.now() - fakeStartTime) / 1000;
    var progress = Math.min(99, Math.floor((elapsed / fakeDurationSec) * 100));
    var remaining = Math.max(0, Math.ceil(fakeDurationSec - elapsed));

    var inner = modalEl ? modalEl.querySelector('.ai-content') : null;
    if (!inner || rendered) return;

    var descText = 'DeepSeek + 豆包 双模型并行，先到先得';
    if (apiDone && pendingResult) {
      descText = '双模型分析完成，正在融合结果...';
    } else if (apiError) {
      descText = '网络波动，正在重试连接...';
    }

    inner.innerHTML =
      '<div style="text-align:center;padding:60px 20px;">' +
      '<div style="font-size:40px;margin-bottom:16px;">⏳</div>' +
      '<div style="font-size:16px;font-weight:600;color:var(--cyan);">正在交叉分析中...</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:6px;">' + descText + '</div>' +
      '<div style="margin-top:20px;width:260px;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;margin-left:auto;margin-right:auto;">' +
      '<div style="width:' + progress + '%;height:100%;background:linear-gradient(90deg,var(--cyan),rgba(0,245,233,0.4));border-radius:3px;transition:width 0.3s ease;"></div>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--text3);margin-top:10px;">预计还需约 ' + remaining + ' 秒</div>' +
      '<div style="font-size:10px;color:var(--text3);margin-top:4px;opacity:0.6;">已分析 ' + Math.floor(elapsed) + ' 秒</div>' +
      '</div>';
  }

  // 进度条更新频率（200ms 更平滑）
  updateFakeProgress();
  pollTimer = setInterval(function () {
    if (rendered) { clearInterval(pollTimer); pollTimer = null; return; }
    updateFakeProgress();
  }, 200);

  // ★ P1-2: 后台静默请求（如果还没有预加载数据）
  var minAnimMs = 3000; // 最少展示 3 秒加载动画
  var animStart = Date.now();
  var resolveTimer = null;

  // 统一结果渲染函数（两个条件同时满足：API 完成 + 动画至少跑了 minAnimMs）
  function tryRenderResult() {
    if (rendered) return;
    var apiReady = pendingResult || apiError;
    var animDone = (Date.now() - animStart) >= minAnimMs;
    if (!apiReady || !animDone) return;

    rendered = true;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (resolveTimer) { clearInterval(resolveTimer); resolveTimer = null; }

    // notReady → 带重试按钮
    if (pendingResult && pendingResult.notReady) {
      var ac = document.getElementById('aiModal');
      if (ac) {
        var inr = ac.querySelector('.ai-content');
        if (inr)
          inr.innerHTML =
            '<div style="text-align:center;padding:40px 20px;color:var(--cyan);"><div style="font-size:48px;margin-bottom:16px;">📋</div><div style="font-size:16px;font-weight:600;">分析生成中</div><div style="font-size:12px;color:var(--text3);margin-top:8px;line-height:1.6;">' +
            (pendingResult.msg || 'AI 分析正在后台生成，请稍后重试') +
            '</div><button style="margin-top:16px;padding:10px 28px;border-radius:24px;background:var(--cyan);color:var(--bg);border:none;cursor:pointer;font-size:14px;font-weight:600;margin-right:8px;" onclick="closeAI();showAIPrediction(\'' + matchId + '\',\'' + homeTeam.replace(/'/g, "\\'") + '\',\'' + awayTeam.replace(/'/g, "\\'") + '\')">刷新重试</button><button style="margin-top:16px;padding:10px 28px;border-radius:24px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-size:14px;" onclick="closeAI()">关闭</button></div>';
      }
      return;
    }

    // 有内容 → 渲染
    if (pendingResult && pendingResult.content) {
      if (pendingResult.dualModel && pendingResult.merged) {
        renderAIContent(pendingResult.content, homeTeam, awayTeam);
      } else if (pendingResult.singleModel && pendingResult.failedSource) {
        var failBadge = (pendingResult.failedSource === 'deepseek' ? 'DeepSeek' : '豆包') + ' 分析未成功，仅展示 ' + (pendingResult.readySource === 'deepseek' ? 'DeepSeek' : '豆包') + ' 结果';
        renderAIContentWithBadge(pendingResult.content, homeTeam, awayTeam, failBadge);
      } else if (pendingResult.singleModel || pendingResult.pendingMerge) {
        var badge = (pendingResult.readySource === 'deepseek' ? 'DeepSeek' : '豆包') + ' 已完成，另一模型分析中...';
        renderAIContentWithBadge(pendingResult.content, homeTeam, awayTeam, badge);
        pollForMerge(matchId, homeTeam, awayTeam, 0);
      } else {
        renderAIContent(pendingResult.content, homeTeam, awayTeam);
      }
      if (pendingResult.shujuMissing) {
        showShujuMissingNotice();
      }
      return;
    }

    // API 异常（重试按钮 + 关闭按钮）
    var ac2 = document.getElementById('aiModal');
    if (ac2) {
      var inr2 = ac2.querySelector('.ai-content');
      var msg = apiError || '分析服务暂时不可用';
      if (inr2)
        inr2.innerHTML =
          '<div style="text-align:center;padding:60px 20px;color:var(--amber);"><div style="font-size:40px;margin-bottom:12px;">⚠️</div><div style="font-size:16px;font-weight:600;">请求失败</div><div style="font-size:12px;color:var(--text3);margin-top:8px;">' +
          msg +
          '</div><button style="margin-top:16px;padding:8px 24px;border-radius:24px;background:var(--cyan);color:var(--bg);border:none;cursor:pointer;font-size:13px;margin-right:8px;" onclick="closeAI();showAIPrediction(\'' + matchId + '\',\'' + homeTeam.replace(/'/g, "\\'") + '\',\'' + awayTeam.replace(/'/g, "\\'") + '\')">重新加载</button><button style="padding:8px 24px;border-radius:24px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-size:13px;" onclick="closeAI()">关闭</button></div>';
    }
  }

  // API 回调处理
  function onApiResult(d, errMsg) {
    if (d) {
      pendingResult = d;
      apiDone = true;
      var contentHash = JSON.stringify(d.content || '');
      predictionCache[matchId] = { content: d, hash: contentHash };
      persistPredictionCache();
    } else if (errMsg) {
      apiError = errMsg;
    }
    tryRenderResult();
  }

  if (!preloadedData) {
    api('ai-predict', { matchId: matchId }, 2)
      .then(function (d) { onApiResult(d, null); })
      .catch(function (e) { onApiResult(null, (e && e.message) || '网络连接失败'); });
  }

  // 300ms 轮询检查（取代固定的 setTimeout，API 返回后立即尝试渲染）
  resolveTimer = setInterval(function () {
    if (rendered) { clearInterval(resolveTimer); resolveTimer = null; return; }
    tryRenderResult();
  }, 300);

  function pollForMerge(matchId, homeTeam, awayTeam, retries) {
    retries = retries || 0;
    if (retries >= 15) return;
    var delay = Math.min(1000 * Math.pow(2, retries), 30000);
    setTimeout(function () {
      api('ai-predict', { matchId: matchId }, 2)
        .then(function (rd) {
          if (rd.content && !rd.pendingMerge && (rd.dualModel || rd.merged)) {
            renderAIContent(rd.content, homeTeam, awayTeam);
          } else if (rd.content && rd.singleModel && rd.failedSource) {
            // 已确认失败，无需再更新
          } else if (rd.content && !rd.pendingMerge && rd.singleModel) {
            // 单模型已就绪
          } else {
            pollForMerge(matchId, homeTeam, awayTeam, retries + 1);
          }
        })
        .catch(function () {
          pollForMerge(matchId, homeTeam, awayTeam, retries + 1);
        });
    }, delay);
  }
}

/** 在弹窗底部插入 500.com 数据缺失提示 */
function showShujuMissingNotice() {
  var modal = document.getElementById('aiModal');
  if (!modal) return;
  var dis = modal.querySelector('.ai-disclaimer');
  if (dis) {
    dis.insertAdjacentHTML(
      'afterend',
      '<div style="margin:8px 20px;padding:10px 14px;border-radius:8px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);font-size:12px;color:#FBBF24;text-align:center;">' +
        '📊 500.com 近10场及交战数据尚未入库，攻防对比和近期战绩图表可能基于AI知识预估。已触发后台数据抓取，稍后重试可获得精确统计。' +
        '</div>',
    );
  }
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

  function esc(s) {
    var str = s == null ? '' : String(s);
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function clip(s, max) {
    var str = s == null ? '' : String(s);
    if (str.length <= max) return str;
    var idx = str.lastIndexOf('。', max);
    if (idx > max * 0.5) return str.substring(0, idx + 1);
    idx = str.lastIndexOf('，', max);
    if (idx > max * 0.5) return str.substring(0, idx) + '...';
    return str.substring(0, max - 3) + '...';
  }
  function has(s) {
    return s && (typeof s === 'string' ? s.trim().length > 0 : true);
  }

  var html = '';
  html +=
    '<div class="ai-modal-header"><span class="ai-modal-title">AI深度解析</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>';
  html += '<div class="ai-content">';

  html +=
    '<div class="ai-match-info"><div class="ai-team"><div class="ai-team-logo">' +
    esc(homeTeam[0]) +
    '</div><div class="ai-team-name">' +
    esc(homeTeam) +
    '</div></div><div class="ai-vs-section"><div class="ai-vs-text">VS</div></div><div class="ai-team"><div class="ai-team-logo away">' +
    esc(awayTeam[0]) +
    '</div><div class="ai-team-name">' +
    esc(awayTeam) +
    '</div></div></div>';

  var coreView = esc(highlight['核心看点'] || c['核心观点'] || '');
  var varRemind = esc(highlight['变数提醒'] || c['变数提醒'] || '');
  var icons = ['🏆', '⚽', '📊'];
  html += '<div class="ai-core-view">';
  html +=
    '<div class="ai-core-header"><span class="ai-core-icon">💡</span><span class="ai-core-title">AI核心观点</span></div>';
  html += '<div class="ai-core-content">' + clip(coreView, 120) + '</div>';
  if (varRemind) html += '<div class="ai-core-desc">' + clip(varRemind, 80) + '</div>';
  html += '<div class="ai-predict-row">';
  preds.forEach(function (p, i) {
    var val = esc(p['建议方向'] || '');
    html += '<div class="ai-predict-card">';
    html +=
      '<div class="ai-predict-head"><span class="ai-predict-icon">' +
      (icons[i] || '●') +
      '</span><span class="ai-predict-name">' +
      esc(p['玩法'] || '') +
      '</span></div>';
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
    html +=
      '<div id="ai-sec-01" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">01</span><span class="ai-sec-name">基础面</span>';
    if (baseStr['概括']) html += '<span class="ai-sec-desc">' + clip(esc(baseStr['概括']), 20) + '</span>';
    html += '</div>';
    if (bHasRank) {
      var rankHome = '',
        rankAway = '';
      var idxH = -1,
        idxA = -1;
      idxH = bRank.indexOf(homeTeam);
      idxA = bRank.indexOf(awayTeam);
      if (idxH < 0 && homeTeam.length >= 2) idxH = bRank.indexOf(homeTeam.substring(0, 2));
      if (idxA < 0 && awayTeam.length >= 2) idxA = bRank.indexOf(awayTeam.substring(0, 2));
      if (idxH < 0) idxH = bRank.indexOf(homeTeam[0]);
      if (idxA < 0) idxA = bRank.indexOf(awayTeam[0]);
      if (idxH >= 0 && idxA < 0) {
        var dots = [];
        for (var di = idxH + 1; di < bRank.length; di++) {
          if (bRank[di] === '。' || bRank[di] === '；') dots.push(di);
        }
        if (dots.length > 0 && dots[0] > idxH && dots[0] < bRank.length - 3) {
          idxA = dots[0] + 1;
        }
      } else if (idxA >= 0 && idxH < 0) {
        var dots2 = [];
        for (var di2 = idxA + 1; di2 < bRank.length; di2++) {
          if (bRank[di2] === '。' || bRank[di2] === '；') dots2.push(di2);
        }
        if (dots2.length > 0 && dots2[0] > idxA && dots2[0] < bRank.length - 3) {
          idxH = dots2[0] + 1;
        }
      }
      if (idxH >= 0 && idxA >= 0) {
        if (idxA > idxH) {
          rankHome = clip(esc(bRank.substring(0, idxA)), 60);
          rankAway = clip(esc(bRank.substring(idxA)), 60);
        } else {
          rankAway = clip(esc(bRank.substring(0, idxH)), 60);
          rankHome = clip(esc(bRank.substring(idxH)), 60);
        }
      }
      if (rankHome || rankAway) {
        html +=
          '<div class="ai-rank-dual"><div class="ai-rank-col"><div class="ai-rank-h">' +
          esc(homeTeam) +
          '</div><div class="ai-rank-val">' +
          (rankHome || '\u2014') +
          '</div></div><div class="ai-rank-col"><div class="ai-rank-h">' +
          esc(awayTeam) +
          '</div><div class="ai-rank-val">' +
          (rankAway || '\u2014') +
          '</div></div></div>';
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
        adCheck.conflicts.forEach(function (c) {
          adConflictMap[c.label] = c;
        });
      }

      baseTable.rows.forEach(function (row) {
        if (row.length < 3) return;
        var label = row[0],
          hv = row[1],
          av = row[2];
        var isShooter = label.indexOf('射手') >= 0;
        var rowConflict = adConflictMap[label];
        var isConflict = rowConflict && rowConflict.conflict;

        if (isShooter) {
          html +=
            '<div class="ai-shooter-dual"><div class="ai-shooter-item home"><span class="ai-shooter-tag">主</span><span class="ai-shooter-desc">' +
            esc(hv) +
            '</span></div><div class="ai-shooter-divider"></div><div class="ai-shooter-item away"><span class="ai-shooter-tag">客</span><span class="ai-shooter-desc">' +
            esc(av) +
            '</span></div></div>';
          if (isConflict) {
            html +=
              '<div style="margin:2px 0 6px 10px;font-size:10px;color:var(--text3);display:flex;justify-content:space-around;">';
            html +=
              '<span>豆包: ' + esc(rowConflict.dbHome || '--') + ' / ' + esc(rowConflict.dbAway || '--') + '</span>';
            html += '</div>';
          }
        } else {
          var hn = parseFloat(hv),
            an = parseFloat(av);
          var hp = isNaN(hn) || isNaN(an) ? 50 : Math.round((hn / (hn + an)) * 100);
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
            var dbHn = parseFloat(rowConflict.dbHome),
              dbAn = parseFloat(rowConflict.dbAway);
            var dbHp = isNaN(dbHn) || isNaN(dbAn) ? 50 : Math.round((dbHn / (dbHn + dbAn)) * 100);
            html += '<div class="ai-data-row" style="opacity:0.6;padding:2px 0 6px 0;font-size:11px;">';
            html += '<span class="ai-data-label" style="font-size:10px;color:#a855f7;">豆包</span>';
            html +=
              '<span class="ai-data-home" style="font-size:12px;color:#a855f7;">' + esc(rowConflict.dbHome) + '</span>';
            html +=
              '<div class="ai-progress-bar"><div class="ai-progress" style="width:' +
              dbHp +
              '%;background:linear-gradient(90deg,#a855f7,rgba(168,85,247,0.4));"></div></div>';
            html +=
              '<span class="ai-data-away" style="font-size:12px;color:#a855f7;">' + esc(rowConflict.dbAway) + '</span>';
            html += '</div>';
          }
        }
      });
      html += '</div>';
    }
    if (bHasBaseCon)
      html +=
        '<div class="ai-item-conclusion"><div class="ai-item-label">核心结论</div><div class="ai-item-text">' +
        clip(esc(baseStr['核心结论']), 120) +
        '</div></div>';
    html += '</div>';
  }

  // 02 状态面
  var hf = (stateStr['主队近况'] || '').match(/(\d+)胜(\d+)平(\d+)负/),
    af = (stateStr['客队近况'] || '').match(/(\d+)胜(\d+)平(\d+)负/);
  var hasHistory = has(stateStr['历史对阵']);
  var injTable = stateStr['伤病影响'];
  var hasInj = injTable && injTable.rows && injTable.rows.length;
  var hasStateCon = has(stateStr['核心结论']);
  var rfc = stateStr['_recentFormCheck']; // 近期战绩交叉验证数据
  if (hf || af || hasHistory || hasInj || hasStateCon) {
    html +=
      '<div id="ai-sec-02" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">02</span><span class="ai-sec-name">状态面</span></div>';
    if (hf || af) {
      html += '<div class="ai-form-title">近期战绩对比</div>';
    }

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
      var dsH = hc.deepseek,
        dbH = hc.doubao;
      html += '<div class="ai-form-row" style="flex-wrap:wrap;gap:6px;padding:8px 10px;">';
      html +=
        '<span class="ai-form-label" style="width:100%;margin-bottom:2px;">' +
        esc(homeTeam) +
        ' <span style="font-size:10px;color:var(--amber);">⚠️ 双模型数据不一致</span></span>';
      if (dsH && dbH) {
        html += '<div style="display:flex;width:100%;gap:8px;">';
        html +=
          '<div style="flex:1;padding:6px 8px;background:rgba(34,211,238,0.06);border-radius:6px;border:1px solid rgba(34,211,238,0.15);">';
        html += '<div style="font-size:10px;color:var(--cyan);margin-bottom:3px;">DeepSeek</div>';
        html +=
          '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' +
          renderFormDots(dsH.w, dsH.d, dsH.l) +
          '<span class="ai-form-summary">' +
          dsH.w +
          'W ' +
          dsH.d +
          'D ' +
          dsH.l +
          'L</span></div></div>';
        html +=
          '<div style="flex:1;padding:6px 8px;background:rgba(168,85,247,0.06);border-radius:6px;border:1px solid rgba(168,85,247,0.15);">';
        html += '<div style="font-size:10px;color:#a855f7;margin-bottom:3px;">豆包</div>';
        html +=
          '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' +
          renderFormDots(dbH.w, dbH.d, dbH.l) +
          '<span class="ai-form-summary">' +
          dbH.w +
          'W ' +
          dbH.d +
          'D ' +
          dbH.l +
          'L</span></div></div>';
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
      var dsA = ac.deepseek,
        dbA = ac.doubao;
      html += '<div class="ai-form-row" style="flex-wrap:wrap;gap:6px;padding:8px 10px;">';
      html +=
        '<span class="ai-form-label" style="width:100%;margin-bottom:2px;">' +
        esc(awayTeam) +
        ' <span style="font-size:10px;color:var(--amber);">⚠️ 双模型数据不一致</span></span>';
      if (dsA && dbA) {
        html += '<div style="display:flex;width:100%;gap:8px;">';
        html +=
          '<div style="flex:1;padding:6px 8px;background:rgba(34,211,238,0.06);border-radius:6px;border:1px solid rgba(34,211,238,0.15);">';
        html += '<div style="font-size:10px;color:var(--cyan);margin-bottom:3px;">DeepSeek</div>';
        html +=
          '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' +
          renderFormDots(dsA.w, dsA.d, dsA.l) +
          '<span class="ai-form-summary">' +
          dsA.w +
          'W ' +
          dsA.d +
          'D ' +
          dsA.l +
          'L</span></div></div>';
        html +=
          '<div style="flex:1;padding:6px 8px;background:rgba(168,85,247,0.06);border-radius:6px;border:1px solid rgba(168,85,247,0.15);">';
        html += '<div style="font-size:10px;color:#a855f7;margin-bottom:3px;">豆包</div>';
        html +=
          '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' +
          renderFormDots(dbA.w, dbA.d, dbA.l) +
          '<span class="ai-form-summary">' +
          dbA.w +
          'W ' +
          dbA.d +
          'D ' +
          dbA.l +
          'L</span></div></div>';
        html += '</div>';
      }
      html += '</div>';
    } else if (af) {
      html += '<div class="ai-form-row"><span class="ai-form-label">' + esc(awayTeam) + '</span>';
      html += renderFormDots(parseInt(af[1]), parseInt(af[2]), parseInt(af[3]));
      html += '<span class="ai-form-summary">' + af[1] + 'W ' + af[2] + 'D ' + af[3] + 'L</span></div>';
    }

    if (hasHistory)
      html +=
        '<div class="ai-item"><div class="ai-item-label">历史交锋</div><div class="ai-item-text">' +
        clip(esc(stateStr['历史对阵']), 120) +
        '</div></div>';
    if (hasInj) {
      html += '<div class="ai-injury-title">伤停对比</div>';
      injTable.rows.forEach(function (row) {
        if (row.length < 3) return;
        var isHome = row[0].indexOf('主') >= 0 || row[0].indexOf(homeTeam) >= 0;
        var tag = isHome ? esc(homeTeam[0]) : esc(awayTeam[0]);
        var tagClass = isHome ? 'home' : 'away';
        html +=
          '<div class="ai-injury-row"><div class="ai-injury-head"><span class="ai-injury-badge ' +
          tagClass +
          '">' +
          tag +
          '</span><span class="ai-injury-team">' +
          esc(row[0]) +
          '</span></div><div class="ai-injury-detail">' +
          esc(row[1]) +
          '</div></div>';
      });
    }
    if (hasStateCon)
      html +=
        '<div class="ai-item-conclusion"><div class="ai-item-label">核心结论</div><div class="ai-item-text">' +
        clip(esc(stateStr['核心结论']), 120) +
        '</div></div>';
    html += '</div>';
  }

  // 03 动机面
  var hasWill = has(motiStr['战意强度']);
  html +=
    '<div id="ai-sec-03" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">03</span><span class="ai-sec-name">动机面</span></div>';
  if (hasWill)
    html +=
      '<div class="ai-item"><div class="ai-item-label">战意强度</div><div class="ai-item-text">' +
      clip(esc(motiStr['战意强度']), 120) +
      '</div></div>';
  html += '</div>';

  // 04 对位面
  var posGood = has(posStr['攻防博弈']) || has(posStr['节奏控制']);
  var posBad = has(posStr['主场氛围']) || has(posStr['战术与教练风格']);
  var hasPosCon = has(posStr['核心结论']);
  if (posGood || posBad || hasPosCon) {
    html +=
      '<div id="ai-sec-04" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">04</span><span class="ai-sec-name">对位面</span></div>';
    html += '<div class="ai-swp-grid">';
    html +=
      '<div class="ai-swp-card good"><div class="ai-swp-card-head"><span class="ai-swp-card-icon good">\u25B2</span><span class="ai-swp-card-label">主队优势</span></div>';
    if (has(posStr['攻防博弈']))
      html += '<div class="ai-swp-card-item">' + clip(esc(posStr['攻防博弈']), 70) + '</div>';
    if (has(posStr['节奏控制']))
      html += '<div class="ai-swp-card-item">' + clip(esc(posStr['节奏控制']), 70) + '</div>';
    html += '</div>';
    html +=
      '<div class="ai-swp-card bad"><div class="ai-swp-card-head"><span class="ai-swp-card-icon bad">\u25BC</span><span class="ai-swp-card-label">客队隐患</span></div>';
    if (has(posStr['主场氛围']))
      html += '<div class="ai-swp-card-item">' + clip(esc(posStr['主场氛围']), 70) + '</div>';
    if (has(posStr['战术与教练风格']))
      html += '<div class="ai-swp-card-item">' + clip(esc(posStr['战术与教练风格']), 70) + '</div>';
    html += '</div></div>';
    if (hasPosCon)
      html +=
        '<div class="ai-item-conclusion amber"><div class="ai-item-label">综合判断</div><div class="ai-item-text">' +
        clip(esc(posStr['核心结论']), 120) +
        '</div></div>';
    html += '</div>';
  }

  // 05 市场面
  var hasOdds = has(mktStr['盘口与赔率']) || has(mktStr['大小球']);
  var hasMktCon = has(mktStr['核心结论']);
  if (hasOdds || hasMktCon) {
    html +=
      '<div id="ai-sec-05" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">05</span><span class="ai-sec-name">市场面</span></div>';
    if (has(mktStr['盘口与赔率']))
      html +=
        '<div class="ai-item"><div class="ai-item-label">盘口与赔率</div><div class="ai-item-text">' +
        clip(esc(mktStr['盘口与赔率']), 120) +
        '</div></div>';
    if (has(mktStr['大小球']))
      html +=
        '<div class="ai-item"><div class="ai-item-label">大小球</div><div class="ai-item-text">' +
        clip(esc(mktStr['大小球']), 120) +
        '</div></div>';
    if (hasMktCon)
      html +=
        '<div class="ai-item-conclusion amber"><div class="ai-item-label">市场解读</div><div class="ai-item-text">' +
        clip(esc(mktStr['核心结论']), 120) +
        '</div></div>';
    html += '</div>';
  }

  // 06 预测建议
  html +=
    '<div id="ai-sec-06" class="ai-section-content" style="border-left-color:rgba(52,211,153,0.3)"><div class="ai-sec-title"><span class="ai-sec-num">06</span><span class="ai-sec-name">预测建议</span></div><div class="ai-predict-table">';
  preds.forEach(function (p) {
    html +=
      '<div class="ai-predict-tr"><span class="ai-predict-td type">' +
      esc(p['玩法'] || '') +
      '</span><span class="ai-predict-td suggest">' +
      esc(p['建议方向'] || '') +
      '</span><span class="ai-predict-td logic">' +
      esc(p['核心逻辑'] || '') +
      '</span><span class="ai-predict-td check">\u2713</span></div>';
  });
  html += '</div></div>';

  // ★ 我要做方案按钮
  html += '<div style="text-align:center;padding:8px 0 16px 0;">';
  html += '<span class="match-bet-btn" onclick="goFromAIToScheme()" style="cursor:pointer;">我要做方案</span>';
  html += '</div>';

  // ★ P2-1: 空内容兜底 — 如果所有主要 section 都无有效内容，显示提示
  var hasAnyContent = false;
  ['基础面', '状态面', '动机面', '对位面', '市场面', '核心看点'].forEach(function (sec) {
    var s = c[sec];
    if (!s) return;
    var keys = Object.keys(s).filter(function (k) { return k[0] !== '_'; });
    keys.forEach(function (k) {
      var v = s[k];
      if (v !== undefined && v !== null && v !== '' && (!Array.isArray(v) || v.length > 0)) {
        hasAnyContent = true;
      }
    });
  });
  if (!hasAnyContent && (!c['预测建议'] || !c['预测建议'].length)) {
    html =
      '<div class="ai-modal-header"><span class="ai-modal-title">AI深度解析</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>' +
      '<div class="ai-content">' +
      '<div style="text-align:center;padding:40px 20px;color:var(--amber);"><div style="font-size:36px;margin-bottom:12px;">📭</div><div style="font-size:15px;font-weight:600;margin-bottom:8px;">暂无可分析内容</div><div style="font-size:12px;color:var(--text3);">AI 模型尚未生成该比赛的完整分析数据，请稍后重试或刷新页面</div>' +
      '<button style="margin-top:16px;padding:10px 28px;border-radius:24px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-size:14px;" onclick="closeAI()">关闭</button>' +
      '</div>' +
      '<div class="ai-disclaimer">本分析为AI生成，仅供参考，请理性对待</div>' +
      '</div>';
    var modalEl3 = document.getElementById('aiModal');
    if (modalEl3) modalEl3.innerHTML = html;
    return;
  }

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
    dis.insertAdjacentHTML(
      'beforebegin',
      '<div style="margin:12px 20px;padding:8px 14px;border-radius:8px;background:rgba(34,211,238,0.08);border:1px solid rgba(34,211,238,0.2);font-size:12px;color:var(--cyan);text-align:center;">' +
        '⏳ ' +
        (badgeText || '交叉验证中...') +
        '</div>',
    );
  }
}

// =============================================================
// * 蓝图新增渲染函数
// =============================================================

function renderConsensusBar(consensus) {
  if (!consensus || !consensus.models || consensus.models.length === 0) return '';
  var badgeClass = consensus.consensus === 'strong' ? 'strong'
    : consensus.consensus === 'weak' ? 'weak'
    : consensus.consensus === 'meltdown' ? 'melt' : 'neutral';
  var badgeText = consensus.consensus === 'strong' ? 'STRONG'
    : consensus.consensus === 'weak' ? 'WEAK'
    : consensus.consensus === 'meltdown' ? 'MELT' : 'NEUTRAL';
  var cells = consensus.models.map(function(m) {
    var icon = m.direction === 'home' ? '\ud83c\udfe0' : m.direction === 'draw' ? '\ud83e\udd1d' : '\u2708\ufe0f';
    var dirLabel = m.direction === 'home' ? '\u4e3b\u80dc' : m.direction === 'draw' ? '\u5e73\u5c40' : '\u5ba2\u80dc';
    var cls = m.direction === consensus.mainDirection ? 'agree' : 'dissent';
    return '<div class="consensus-cell ' + cls + '"><div class="consensus-model">' + m.model + '</div><div class="consensus-result">' + icon + ' ' + dirLabel + '</div><div class="consensus-confidence">' + (m.confidence || '--') + '%</div></div>';
  }).join('');
  var mainLabel = consensus.mainDirection === 'home' ? '\u4e3b\u80dc' : consensus.mainDirection === 'draw' ? '\u5e73\u5c40' : '\u5ba2\u80dc';
  return '<div class="chart-box consensus-bar"><div class="consensus-header"><span class="consensus-title">\u591a\u6a21\u578b\u9884\u6d4b\u5171\u8bc6</span><span class="consensus-badge ' + badgeClass + '">' + badgeText + '</span></div><div class="consensus-grid">' + cells + '</div><div class="consensus-summary">' + consensus.agreeCount + '/' + consensus.totalCount + ' \u6a21\u578b\u4e00\u81f4\u770b <span style="color:var(--cyan);font-weight:700">' + mainLabel + '</span></div></div>';
}

function renderGsSummary(gsData) {
  if (!gsData) return '';
  var parts = [];
  if (gsData.homePower !== undefined && gsData.guestPower !== undefined) parts.push('\u5b9e\u529b: ' + gsData.homePower + ' vs ' + gsData.guestPower);
  if (gsData.goalLine !== undefined) parts.push('\u5927\u5c0f\u7403: ' + gsData.goalLine.toFixed(1));
  if (gsData.predictedScore) parts.push('\u9884\u6d4b\u6bd4\u5206: ' + gsData.predictedScore);
  if (gsData.fusionConsensus) parts.push('\u5171\u8bc6: ' + gsData.fusionConsensus);
  if (parts.length === 0) return '';
  return '<div class="chart-box" style="padding:10px 16px;font-size:var(--fs-sm);color:var(--text2);display:flex;flex-wrap:wrap;gap:12px"><span>\u26a1 \u529f\u5b88\u9053</span>' + parts.map(function(p) { return '<span style="color:var(--cyan)">' + p + '</span>'; }).join('') + '</div>';
}

function hasRecentForm(features) {
  return !!(features.home_win_pct_6 !== undefined || features.away_win_pct_6 !== undefined);
}

function renderRecentForm(match, features) {
  var homeName = match.homeName || '\u4e3b\u961f';
  var awayName = match.visitName || '\u5ba2\u961f';
  function makeDots(prefix) {
    var wr = features[prefix + '_win_pct_6'];
    if (wr === undefined) return '<span style="color:var(--text3);font-size:var(--fs-sm)">\u65e0\u6570\u636e</span>';
    var wins = Math.round(wr * 6);
    var dots = '';
    for (var i = 0; i < 6; i++) {
      var cls = i < wins ? 'w' : 'l';
      dots += '<span class="ai-form-dot ' + cls + '">' + (cls === 'w' ? 'W' : 'L') + '</span>';
    }
    return dots;
  }
  function pct(val) { return val !== undefined ? Math.round(val * 100) + '%' : '--'; }
  return '<div class="chart-box"><div class="chart-header"><span class="chart-title">\u8fd1\u671f\u6218\u7ee9 \u00b7 \u8fd16\u573a</span></div><div class="ai-form-row"><span class="ai-form-label">' + homeName + '</span>' + makeDots('home') + '<span class="ai-form-summary">\u80dc\u7387 ' + pct(features.home_win_pct_6) + ' | \u5747\u8fdb\u7403 ' + (features.home_goal_avg_6 !== undefined ? features.home_goal_avg_6.toFixed(1) : '--') + '</span></div><div class="ai-form-row"><span class="ai-form-label">' + awayName + '</span>' + makeDots('away') + '<span class="ai-form-summary">\u80dc\u7387 ' + pct(features.away_win_pct_6) + ' | \u5747\u8fdb\u7403 ' + (features.away_goal_avg_6 !== undefined ? features.away_goal_avg_6.toFixed(1) : '--') + '</span></div></div>';
}

function renderStandingsContext(match, standings) {
  if (!standings || (!standings.home && !standings.away)) return '';
  var home = standings.home;
  var away = standings.away;
  var homeTxt = home ? (match.homeName || '\u4e3b\u961f') + ' \u7b2c' + home.rank + '\u4f4d (' + (home.points || '?') + '\u5206)' : '--';
  var awayTxt = away ? (match.visitName || '\u5ba2\u961f') + ' \u7b2c' + away.rank + '\u4f4d (' + (away.points || '?') + '\u5206)' : '--';
  var diffTxt = '';
  if (standings.rankDiff !== null && standings.rankDiff !== undefined) {
    diffTxt = ' \u6392\u540d\u5dee: ' + Math.abs(standings.rankDiff);
    if (Math.abs(standings.rankDiff) <= 2) diffTxt += ' | \ud83d\udd25 \u5173\u952e\u6218';
    else if (Math.abs(standings.rankDiff) <= 5) diffTxt += ' | \u666e\u901a';
  }
  return '<div class="chart-box" style="padding:12px 16px"><div class="chart-header" style="margin-bottom:8px"><span class="chart-title">\ud83c\udfc6 \u8054\u8d5b\u6392\u540d</span></div><div style="font-size:var(--fs-sm);color:var(--text2)">' + homeTxt + '</div><div style="font-size:var(--fs-sm);color:var(--text2)">' + awayTxt + '</div>' + (diffTxt ? '<div style="font-size:var(--fs-xs);color:var(--cyan);margin-top:4px">' + diffTxt + '</div>' : '') + '</div>';
}


function renderH2HSummary(match, h2h) {
  if (!h2h || h2h.length === 0) return '';
  var last5 = h2h.slice(0, 5);
  var homeName = match.homeName || '';
  var awayName = match.visitName || '';
  var homeWins = 0, awayWins = 0, draws = 0, totalGoals = 0;
  last5.forEach(function(r) {
    if (r.home_team === homeName && r.home_score > r.away_score) homeWins++;
    else if (r.away_team === homeName && r.away_score > r.home_score) homeWins++;
    else if (r.home_team === awayName && r.home_score > r.away_score) awayWins++;
    else if (r.away_team === awayName && r.away_score > r.home_score) awayWins++;
    else draws++;
    totalGoals += (r.home_score || 0) + (r.away_score || 0);
  });
  var avgGoals = last5.length > 0 ? (totalGoals / last5.length).toFixed(1) : '--';
  var lastMatch = h2h[0];
  var lastTxt = lastMatch ? lastMatch.match_date + ' ' + lastMatch.home_team + ' ' + lastMatch.home_score + '-' + lastMatch.away_score + ' ' + lastMatch.away_team : '';

  return '<div class="chart-box" style="padding:12px 16px">' +
    '<div class="chart-header" style="margin-bottom:8px"><span class="chart-title">历史交锋</span><span class="chart-hint">近' + last5.length + '次</span></div>' +
    '<div class="filter-stats-row">' +
    '<div class="filter-stat-item"><div class="filter-stat-value" style="color:var(--green)">' + homeWins + '</div><div class="filter-stat-label">' + homeName + '胜</div></div>' +
    '<div class="filter-stat-divider"></div>' +
    '<div class="filter-stat-item"><div class="filter-stat-value" style="color:var(--amber)">' + draws + '</div><div class="filter-stat-label">平局</div></div>' +
    '<div class="filter-stat-divider"></div>' +
    '<div class="filter-stat-item"><div class="filter-stat-value" style="color:var(--red)">' + awayWins + '</div><div class="filter-stat-label">' + awayName + '胜</div></div>' +
    '<div class="filter-stat-divider"></div>' +
    '<div class="filter-stat-item"><div class="filter-stat-value">' + avgGoals + '</div><div class="filter-stat-label">均进球</div></div>' +
    '</div>' +
    (lastMatch ? '<div style="font-size:var(--fs-xs);color:var(--text3);margin-top:6px">最近: ' + lastMatch + '</div>' : '') +
    '</div>';
}

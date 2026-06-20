import { api } from '../api.js';
import { formatDate } from '../utils.js';
import { loadECharts, echartsReady } from '../charts.js?v=202606080308';
import * as state from '../vendor.js';
// AI 深度解析缓存：{ matchId: { content: ..., hash: ... } }
import { loadCSS } from '../vendor.js';
loadCSS('../../css/page-match.css');

const predictionCache = {};
let _aiModalMatchId = null; // ★ 缓存的 matchId，供"我要做方案"按钮使用
(function restoreCache() {
  try {
    const saved = sessionStorage.getItem('__ai_prediction_cache');
    if (saved) {
      const parsed = JSON.parse(saved);
      const today = formatDate(new Date());
      Object.keys(parsed).forEach(function (k) {
        if (parsed[k] && parsed[k]._date === today) predictionCache[k] = parsed[k];
      });
    }
  } catch (e) {}
})();
function persistPredictionCache() {
  try {
    const toSave = {};
    const today = formatDate(new Date());
    Object.keys(predictionCache).forEach(function (k) {
      const v = predictionCache[k];
      if (v) toSave[k] = { content: v.content, hash: v.hash, _date: today };
    });
    sessionStorage.setItem('__ai_prediction_cache', JSON.stringify(toSave));
  } catch (e) {}
}

// ★ 赔率辅助函数

// ── SPF 方向 ──
function _spfKey(dir) {
  if (dir === '胜' || dir === '主胜') return 'home';
  if (dir === '平' || dir === '和局') return 'draw';
  if (dir === '负' || dir === '客胜') return 'away';
  return null;
}
function _rqspfKey(dir) {
  if (dir === '让胜') return 'home';
  if (dir === '让平') return 'draw';
  if (dir === '让负') return 'away';
  return null;
}
function _singleOdds(odds, dir) {
  if (!odds) return null;
  const spfK = _spfKey(dir);
  if (spfK && odds.spf) return odds.spf[spfK] || null;
  const rqK = _rqspfKey(dir);
  if (rqK && odds.rqspfList && odds.rqspfList.length > 0) {
    let rq = odds.rqspfList.find(function (r) {
      return Number(r.handicap) === 0;
    });
    if (!rq) rq = odds.rqspfList[0];
    return rq[rqK] || null;
  }
  return null;
}

// ── Dutch 合并 ──
function _dutchOdds(arr) {
  if (!arr || arr.length === 0) return null;
  if (arr.length === 1) return arr[0];
  let invSum = 0;
  arr.forEach(function (o) {
    invSum += 1 / o;
  });
  return invSum > 0 ? 1 / invSum : null;
}

// ── 总进球解析 ("总进球-2、3球" → ["2","3"]) ──
function _parseJqs(dir) {
  if (!dir || dir.indexOf('总进球') !== 0) return null;
  // 去掉 "总进球-" 前缀，再按分隔符拆分
  const body = dir.replace(/^总进球-?/, '').replace(/球$/, '');
  const subs = body.split(/[、,]/).filter(function (s) {
    return s && s.trim();
  });
  if (subs.length === 0) return null;
  return subs.map(function (s) {
    return s.trim();
  });
}
function _jqsOdds(odds, goals) {
  if (!odds || !odds.jqs || odds.jqs.length === 0) return null;
  if (goals.length === 1) {
    const found = odds.jqs.find(function (r) {
      return String(r.goals) === String(goals[0]);
    });
    return found ? found.odds : null;
  }
  const vals = [];
  goals.forEach(function (g) {
    const f = odds.jqs.find(function (r) {
      return String(r.goals) === String(g);
    });
    if (f) vals.push(f.odds);
  });
  return vals.length > 0 ? _dutchOdds(vals) : null;
}

// ── 半全场解析 ("半全场-胜胜" → ["胜胜"]) ──
function _parseBqc(dir) {
  if (!dir || dir.indexOf('半全场') !== 0) return null;
  const body = dir.replace(/^半全场-?/, '');
  const subs = body.split(/[、,]/).filter(function (s) {
    return s && s.trim();
  });
  if (subs.length === 0) return null;
  return subs.map(function (s) {
    return s.trim();
  });
}
function _bqcOdds(odds, combos) {
  if (!odds || !odds.bqc || odds.bqc.length === 0) return null;
  if (combos.length === 1) {
    const found = odds.bqc.find(function (r) {
      return r.combo === combos[0];
    });
    return found ? found.odds : null;
  }
  const vals = [];
  combos.forEach(function (c) {
    const f = odds.bqc.find(function (r) {
      return r.combo === c;
    });
    if (f) vals.push(f.odds);
  });
  return vals.length > 0 ? _dutchOdds(vals) : null;
}

// ── 比分解析 ("比分-1:0" → ["1:0"]) ──
function _parseBf(dir) {
  if (!dir || dir.indexOf('比分') !== 0) return null;
  const body = dir.replace(/^比分-?/, '');
  const subs = body.split(/[、,]/).filter(function (s) {
    return s && s.trim();
  });
  if (subs.length === 0) return null;
  return subs.map(function (s) {
    return s.trim();
  });
}
function _bfOdds(odds, scores) {
  if (!odds || !odds.bf || odds.bf.length === 0) return null;
  if (scores.length === 1) {
    const found = odds.bf.find(function (r) {
      return r.score === scores[0];
    });
    return found ? found.odds : null;
  }
  const vals = [];
  scores.forEach(function (s) {
    const f = odds.bf.find(function (r) {
      return r.score === s;
    });
    if (f) vals.push(f.odds);
  });
  return vals.length > 0 ? _dutchOdds(vals) : null;
}

// ── 主调度 ──
function _dirOdds(odds, direction) {
  if (!odds) return null;
  if (!direction) return null;

  // 1) SPF/RQSPF 单方向
  const single = _singleOdds(odds, direction);
  if (single !== null) return single;

  // 2) JQS 总进球
  const jqsParts = _parseJqs(direction);
  if (jqsParts) return _jqsOdds(odds, jqsParts);

  // 3) BQC 半全场
  const bqcParts = _parseBqc(direction);
  if (bqcParts) return _bqcOdds(odds, bqcParts);

  // 4) BF 比分
  const bfParts = _parseBf(direction);
  if (bfParts) return _bfOdds(odds, bfParts);

  // 5) SPF/RQSPF 组合方向（带分隔符如"胜、平"，或连写如"胜平"）
  let parts = direction.split(/[、,]/).filter(function (s) {
    return s && s.trim();
  });
  if (parts.length === 1 && parts[0] === direction) {
    parts = direction.split('').filter(function (s) {
      return s;
    });
  }
  if (parts.length <= 1) return null;

  const vals = [];
  parts.forEach(function (d) {
    const v = _singleOdds(odds, d);
    if (v !== null) vals.push(v);
  });
  return vals.length > 0 ? _dutchOdds(vals) : null;
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

  Promise.all([
    api('match-detail', { matchId }),
    api('recommend-trend', { matchId }),
    api('match-odds', { matchId }).catch(function (e) {
      return null;
    }),
  ]).then(([detail, trend, oddsData]) => {
    const match = detail.match || detail;
    const recommends = detail.recommends || [];
    const hasResults = recommends.some(function (r) {
      return r.result !== null;
    });
    const statusText = match.matchStatus === 2 ? '已结束' : match.matchStatus === 1 ? '进行中' : '未开始';
    const roundText = match.num || match.matchNum || '竞彩';
    const isLive = match.matchStatus === 1 || match.matchStatus === 2;
    const scoreText = match.score || '';
    const halfText = match.halfScore || '';
    const durText = match.duration || '';
    const yellowText = match.yellow || '';
    const redText = match.red || '';
    let scoreDisplay = '';
    let extraText = '';
    if (isLive && scoreText) {
      const parts = scoreText.replace('-', ':').split(':');
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
          <span class="match-num" style="background: ${match.matchStatus === 0 ? 'rgba(34,211,238,0.1)' : 'rgba(52,211,153,0.1)'}; color: ${match.matchStatus === 0 ? 'var(--cyan)' : 'var(--green)'}">${statusText}</span>
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

    const hitMap = {};
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
    const isFinished =
      match.matchStatus === 2 ||
      recommends.some(function (r) {
        return r.result !== null;
      });
    dirItems
      .sort((a, b) => (b.num || 0) - (a.num || 0))
      .forEach((r) => {
        const isHit = isFinished && hitMap[r.type];
        const hitFlag = isHit ? '<img src="/assets/worldcup/flag-hit.png" class="hit-flag" alt="">' : '';
        const hitClass = isHit ? ' hit' : '';
        let oddsText = '';
        const ov = _dirOdds(oddsData, r.type);
        if (ov !== null) {
          oddsText = ' <span style="color:#60A5FA;font-size:13px;font-weight:500;">(' + ov.toFixed(1) + ')</span>';
        }
        html += `
        <div class="dir-item${hitClass}">
          <span class="dir-name">${hitFlag}${r.type}${oddsText}</span>
          <span class="dir-count">${r.num}位</span>
        </div>
      `;
      });
    html += '</div></div>';

    el.innerHTML = html;
    el.classList.remove('page-skeleton'); // 移除骨架屏 padding，卡片宽度对齐今日比赛

    // AI 核心看点卡片隐藏逻辑：比赛日期早于今天则隐藏
    const matchDate = (match.date || '').slice(0, 10);
    const todayStr = formatDate(new Date());
    const isPastMatch = matchDate && matchDate < todayStr;
    if (isPastMatch) {
      const aiCard = el.querySelector('.ai-card');
      if (aiCard) aiCard.style.display = 'none';
    }

    setTimeout(() => {
      const chartEl = document.getElementById('trendChart');
      if (!chartEl) return;
      const top5 = (trend.lastResult || []).sort((a, b) => b.num - a.num).slice(0, 5);

      // 无数据点时不渲染
      if (!trend || !trend.timeLabels || trend.timeLabels.length < 1 || (trend.series || []).length === 0) {
        chartEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;color:#64748B;">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" opacity="0.5"><path d="M14 25C14 27 15.07 32 29 32C42.93 32 44 27 44 25C44 23 44 10 44 10H29H14C14 10 14 23 14 25Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M29 16H23V21L26 24L29 21V16Z" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 16V10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 40L43 40" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 14H4C4 14 5 19 6 22C7 25 14 24 14 24" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>
          <div style="margin-top:12px;font-size:13px;color:#94A3B8;">暂无趋势数据</div>
        </div>`;
        return;
      }

      // 单点快照标记：仅1个数据点时用柱状图（折线图需≥2点才有意义）
      const isSingleShot = trend.timeLabels.length === 1;

      loadECharts().then(function () {
        if (!echartsReady) return;
        const existInstance = echarts.getInstanceByDom(chartEl);
        if (existInstance) existInstance.dispose();
        const chart = echarts.init(chartEl);
        // ★ 5 色语义渐变体系 — 每个方向独立色相，保留渐变质感
        // 配色策略：高饱和主色 → 渐淡底部，视觉区分 + 统一风格
        const DIR_PALETTE = [
          { r: 99, g: 102, b: 241 }, // 0: 靛蓝 #6366F1
          { r: 236, g: 72, b: 153 }, // 1: 玫红 #EC4899
          { r: 34, g: 197, b: 94 }, // 2: 翠绿 #22C55E
          { r: 251, g: 191, b: 36 }, // 3: 琥珀 #FBBF24
          { r: 126, g: 166, b: 189 }, // 4: 青 #7EA6BD
        ];
        function buildBarColor(index, value, maxVal) {
          const c = DIR_PALETTE[index % DIR_PALETTE.length];
          const ratio = maxVal > 0 ? Math.min(value / maxVal, 1) : 0;
          return {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (0.65 + ratio * 0.3) + ')' },
              { offset: 1, color: 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (0.12 + ratio * 0.18) + ')' },
            ],
          };
        }
        function barBorderColor(cIndex) {
          const c = DIR_PALETTE[cIndex % DIR_PALETTE.length];
          return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.28)';
        }
        function barShadowColor(cIndex) {
          const c = DIR_PALETTE[cIndex % DIR_PALETTE.length];
          return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.14)';
        }
        function hexFromPalette(i) {
          const c = DIR_PALETTE[i % DIR_PALETTE.length];
          return (
            '#' +
            ('0' + c.r.toString(16)).slice(-2) +
            ('0' + c.g.toString(16)).slice(-2) +
            ('0' + c.b.toString(16)).slice(-2)
          );
        }
        const colors = DIR_PALETTE.map(function (_, i) {
          return hexFromPalette(i);
        });

        let matchedSeries = trend.series.filter(function (s) {
          return top5.some(function (t) {
            return t.type === s.name;
          });
        });
        if (matchedSeries.length === 0) matchedSeries = trend.series.slice(0, 5);
        const activeSeries = matchedSeries.slice(0, 5);

        // 计算最大值用于颜色映射
        const allVals = [];
        activeSeries.forEach(function (s) {
          s.data.forEach(function (v) {
            if (v != null) allVals.push(v);
          });
        });
        const maxVal = Math.max.apply(null, allVals.length ? allVals : [1]);

        const series = activeSeries.map(function (s, i) {
          if (isSingleShot) {
            const val = s.data[0] || 0;
            return {
              name: s.name,
              type: 'bar',
              barMaxWidth: 44,
              barGap: '30%',
              showBackground: true,
              backgroundStyle: {
                color: 'rgba(126,166,189,0.04)',
                borderRadius: [8, 8, 0, 0],
              },
              label: {
                show: true,
                position: 'top',
                fontSize: 11,
                fontWeight: 700,
                fontFamily: 'DIN Alternate, Bahnschrift, sans-serif',
                fontVariantNumeric: 'tabular-nums',
                formatter: function (p) {
                  return p.value + ' 位';
                },
                color: '#A0B4C4',
              },
              itemStyle: {
                color: buildBarColor(i, val, maxVal),
                borderRadius: [8, 8, 0, 0],
                borderColor: barBorderColor(i),
                borderWidth: 0.5,
                shadowBlur: 10,
                shadowColor: barShadowColor(i),
                shadowOffsetY: 3,
              },
              data: s.data,
            };
          }
          // 折线图模式：每条线用对应色相
          return {
            name: s.name,
            type: 'line',
            smooth: 0.35,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { width: 2.2, color: hexFromPalette(i) },
            itemStyle: { color: hexFromPalette(i) },
            areaStyle:
              i === 0
                ? {
                    color: {
                      type: 'linear',
                      x: 0,
                      y: 0,
                      x2: 0,
                      y2: 1,
                      colorStops: [
                        { offset: 0, color: 'rgba(99,102,241,0.10)' },
                        { offset: 1, color: 'rgba(99,102,241,0)' },
                      ],
                    },
                  }
                : null,
            data: s.data,
          };
        });

        const option = {
          color: colors,
          tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(17,24,32,0.94)',
            borderColor: 'rgba(126,166,189,0.18)',
            borderWidth: 1,
            borderRadius: 10,
            padding: [10, 14],
            textStyle: { color: '#E2E0DC', fontSize: 12 },
            extraCssText: 'box-shadow: 0 6px 20px rgba(0,0,0,0.25);',
            formatter: function (params) {
              let h =
                '<div style="font-weight:700;margin-bottom:6px;font-size:13px;">' +
                (params[0] ? params[0].axisValue : '') +
                '</div>';
              params.forEach(function (p) {
                h +=
                  '<div style="display:flex;justify-content:space-between;gap:24px;margin-top:4px;">' +
                  '<span>' +
                  p.marker +
                  ' ' +
                  p.seriesName +
                  '</span>' +
                  '<span style="font-weight:600;color:' +
                  (p.color || '#A0B4C4') +
                  ';">' +
                  p.value +
                  ' 位</span></div>';
              });
              return h;
            },
          },
          legend: {
            type: 'scroll',
            bottom: 0,
            icon: 'roundRect',
            itemWidth: 12,
            itemHeight: 5,
            borderRadius: 2,
            textStyle: { fontSize: 10, color: '#7A8B9C', fontWeight: 500 },
            pageTextStyle: { color: '#586575' },
            pageIconColor: '#7EA6BD',
            pageIconInactiveColor: '#2a3a44',
            selector: false,
          },
          grid: {
            left: '3%',
            right: '5%',
            bottom: isSingleShot ? '30%' : '18%',
            top: isSingleShot ? '20%' : '6%',
            containLabel: true,
          },
          xAxis: {
            type: 'category',
            data: trend.timeLabels,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { fontSize: 11, color: '#7A8B9C', fontWeight: 600 },
          },
          yAxis: {
            type: 'value',
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: {
              fontSize: 10,
              color: '#586575',
              fontFamily: 'DIN Alternate, Bahnschrift, sans-serif',
              fontVariantNumeric: 'tabular-nums',
            },
            splitLine: { lineStyle: { color: 'rgba(126,166,189,0.06)', type: 'dashed' } },
          },
          series: series,
        };

        // 单点快照时在图表内部左上角加轻量标记
        if (isSingleShot) {
          option.graphic = [
            {
              type: 'text',
              left: 8,
              top: 6,
              style: {
                text: '\u5b9e\u65f6\u5feb\u7167 \u00B7 \u6bcf20\u5206\u949f\u66f4\u65b0',
                fontSize: 10,
                fill: '#FBBF24',
                fontWeight: 500,
              },
            },
          ];
        }

        chart.setOption(option);
      });
    }, 100);
  });
}

export function closeAI() {
  const overlay = document.getElementById('aiOverlay');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

// ★ 从 AI 弹窗跳转方案设计页
window.goFromAIToScheme = function () {
  if (_aiModalMatchId) {
    try {
      sessionStorage.setItem('preselectMatch', _aiModalMatchId);
    } catch (e) {}
  }
  closeAI();
  window.switchTab('scheme');
};

export function showAIPrediction(matchId, homeTeam, awayTeam) {
  _aiModalMatchId = matchId; // ★ 缓存 matchId
  if (!homeTeam || !awayTeam) {
    const teams = document.querySelectorAll('#detailContent .team-name');
    homeTeam = (teams[0] ? teams[0].textContent : null) || homeTeam || '主队';
    awayTeam = (teams[1] ? teams[1].textContent : null) || awayTeam || '客队';
  }

  const modalEl = document.getElementById('aiModal');
  const overlayEl = document.getElementById('aiOverlay');

  // ═══ 缓存命中：直接渲染 + 后台静默检查是否有更新 ═══
  if (predictionCache[matchId]) {
    const cached = predictionCache[matchId];
    // 立即展示缓存内容，跳过加载动画
    renderCachedContent(cached.content, homeTeam, awayTeam, cached.content, matchId);
    if (overlayEl) overlayEl.classList.add('active');
    document.body.style.overflow = 'hidden';

    // 后台静默校验：有变化时无声更新
    api('ai-predict', { matchId: matchId }, 2).then(function (d) {
      const newHash = JSON.stringify(d.content || '');
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
  const resultData = newData || content;
  if (resultData && resultData.content) {
    if (resultData.dualModel && resultData.merged) {
      renderAIContent(resultData.content, homeTeam, awayTeam);
    } else if (resultData.singleModel && resultData.failedSource) {
      const failBadge =
        (resultData.failedSource === 'deepseek' ? 'DeepSeek' : '豆包') +
        ' 分析未成功，仅展示 ' +
        (resultData.readySource === 'deepseek' ? 'DeepSeek' : '豆包') +
        ' 结果';
      renderAIContentWithBadge(resultData.content, homeTeam, awayTeam, failBadge);
    } else if (resultData.singleModel || resultData.pendingMerge) {
      const badge = (resultData.readySource === 'deepseek' ? 'DeepSeek' : '豆包') + ' 已完成，另一模型分析中...';
      renderAIContentWithBadge(resultData.content, homeTeam, awayTeam, badge);
    } else {
      renderAIContent(resultData.content, homeTeam, awayTeam);
    }
    if (resultData.shujuMissing) {
      showShujuMissingNotice();
    }
    showDataGateNotice(resultData.dataGate);
  } else if (resultData && resultData.notReady) {
    const ac = document.getElementById('aiModal');
    if (ac) {
      const inr = ac.querySelector('.ai-content');
      if (inr)
        inr.innerHTML =
          '<div style="text-align:center;padding:40px 20px;color:var(--cyan);"><div style="font-size:48px;margin-bottom:16px;">📋</div><div style="font-size:16px;font-weight:600;">分析生成中</div><div style="font-size:12px;color:var(--text3);margin-top:8px;line-height:1.6;">' +
          (resultData.msg || 'AI 深度解析由定时任务（11:30 / 16:30）统一生成<br>到时间后刷新页面即可查看') +
          '</div>' +
          _renderDataGateNoticeHtml(resultData.dataGate) +
          '<button style="margin-top:16px;padding:10px 28px;border-radius:24px;background:var(--cyan);color:var(--bg);border:none;cursor:pointer;font-size:14px;font-weight:600;margin-right:8px;" onclick="closeAI();showAIPrediction(\'' +
          (matchId || '') +
          "','" +
          (homeTeam || '').replace(/'/g, "\\'") +
          "','" +
          (awayTeam || '').replace(/'/g, "\\'") +
          '\')">刷新重试</button><button style="margin-top:16px;padding:10px 28px;border-radius:24px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-size:14px;" onclick="closeAI()">关闭</button></div>';
    }
  }
}

function doFakeLoading(matchId, homeTeam, awayTeam, modalEl, overlayEl, preloadedData) {
  // 显示加载态
  let html =
    '<div class="ai-modal-header"><span class="ai-modal-title">AI深度解析</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>';
  html +=
    '<div class="ai-content"><div style="text-align:center;padding:60px 20px;color:var(--cyan);"><div style="font-size:40px;margin-bottom:16px;">⏳</div><div style="font-size:16px;font-weight:600;">正在交叉分析中...</div><div style="font-size:12px;color:var(--text3);margin-top:8px;">DeepSeek + 豆包 双模型交叉验证</div></div></div>';
  if (modalEl) modalEl.innerHTML = html;
  if (overlayEl) overlayEl.classList.add('active');
  document.body.style.overflow = 'hidden';

  // ═══ 假进度条：模拟实时 AI 运算耗时（3-5s） ═══
  const fakeDurationSec = Math.floor(Math.random() * 3) + 3; // 3-5 秒
  const fakeStartTime = Date.now();
  let pendingResult = preloadedData; // 可能已有预加载数据
  let apiDone = !!preloadedData; // 如果预加载了数据则标记已完成
  let apiError = null; // API 异常暂存
  let pollTimer = null;
  let rendered = false; // 防止重复渲染

  function updateFakeProgress() {
    const elapsed = (Date.now() - fakeStartTime) / 1000;
    const progress = Math.min(99, Math.floor((elapsed / fakeDurationSec) * 100));
    const remaining = Math.max(0, Math.ceil(fakeDurationSec - elapsed));

    const inner = modalEl ? modalEl.querySelector('.ai-content') : null;
    if (!inner || rendered) return;

    let descText = 'DeepSeek + 豆包 双模型并行，先到先得';
    if (apiDone && pendingResult) {
      descText = '双模型分析完成，正在融合结果...';
    } else if (apiError) {
      descText = '网络波动，正在重试连接...';
    }

    inner.innerHTML =
      '<div style="text-align:center;padding:60px 20px;">' +
      '<div style="font-size:40px;margin-bottom:16px;">⏳</div>' +
      '<div style="font-size:16px;font-weight:600;color:var(--cyan);">正在交叉分析中...</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:6px;">' +
      descText +
      '</div>' +
      '<div style="margin-top:20px;width:260px;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;margin-left:auto;margin-right:auto;">' +
      '<div style="width:' +
      progress +
      '%;height:100%;background:linear-gradient(90deg,var(--cyan),rgba(0,245,233,0.4));border-radius:3px;transition:width 0.3s ease;"></div>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--text3);margin-top:10px;">预计还需约 ' +
      remaining +
      ' 秒</div>' +
      '<div style="font-size:10px;color:var(--text3);margin-top:4px;opacity:0.6;">已分析 ' +
      Math.floor(elapsed) +
      ' 秒</div>' +
      '</div>';
  }

  // 进度条更新频率（200ms 更平滑）
  updateFakeProgress();
  pollTimer = setInterval(function () {
    if (rendered) {
      clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    updateFakeProgress();
  }, 200);

  // ★ P1-2: 后台静默请求（如果还没有预加载数据）
  const minAnimMs = 3000; // 最少展示 3 秒加载动画
  const animStart = Date.now();
  let resolveTimer = null;

  // 统一结果渲染函数（两个条件同时满足：API 完成 + 动画至少跑了 minAnimMs）
  function tryRenderResult() {
    if (rendered) return;
    const apiReady = pendingResult || apiError;
    const animDone = Date.now() - animStart >= minAnimMs;
    if (!apiReady || !animDone) return;

    rendered = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (resolveTimer) {
      clearInterval(resolveTimer);
      resolveTimer = null;
    }

    // notReady → 带重试按钮
    if (pendingResult && pendingResult.notReady) {
      const ac = document.getElementById('aiModal');
      if (ac) {
        const inr = ac.querySelector('.ai-content');
        if (inr)
          inr.innerHTML =
            '<div style="text-align:center;padding:40px 20px;color:var(--cyan);"><div style="font-size:48px;margin-bottom:16px;">📋</div><div style="font-size:16px;font-weight:600;">分析生成中</div><div style="font-size:12px;color:var(--text3);margin-top:8px;line-height:1.6;">' +
            (pendingResult.msg || 'AI 分析正在后台生成，请稍后重试') +
            '</div>' +
            _renderDataGateNoticeHtml(pendingResult.dataGate) +
            '<button style="margin-top:16px;padding:10px 28px;border-radius:24px;background:var(--cyan);color:var(--bg);border:none;cursor:pointer;font-size:14px;font-weight:600;margin-right:8px;" onclick="closeAI();showAIPrediction(\'' +
            matchId +
            "','" +
            homeTeam.replace(/'/g, "\\'") +
            "','" +
            awayTeam.replace(/'/g, "\\'") +
            '\')">刷新重试</button><button style="margin-top:16px;padding:10px 28px;border-radius:24px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-size:14px;" onclick="closeAI()">关闭</button></div>';
      }
      return;
    }

    // 有内容 → 渲染
    if (pendingResult && pendingResult.content) {
      if (pendingResult.dualModel && pendingResult.merged) {
        renderAIContent(pendingResult.content, homeTeam, awayTeam);
      } else if (pendingResult.singleModel && pendingResult.failedSource) {
        const failBadge =
          (pendingResult.failedSource === 'deepseek' ? 'DeepSeek' : '豆包') +
          ' 分析未成功，仅展示 ' +
          (pendingResult.readySource === 'deepseek' ? 'DeepSeek' : '豆包') +
          ' 结果';
        renderAIContentWithBadge(pendingResult.content, homeTeam, awayTeam, failBadge);
      } else if (pendingResult.singleModel || pendingResult.pendingMerge) {
        const badge = (pendingResult.readySource === 'deepseek' ? 'DeepSeek' : '豆包') + ' 已完成，另一模型分析中...';
        renderAIContentWithBadge(pendingResult.content, homeTeam, awayTeam, badge);
        pollForMerge(matchId, homeTeam, awayTeam, 0);
      } else {
        renderAIContent(pendingResult.content, homeTeam, awayTeam);
      }
      if (pendingResult.shujuMissing) {
        showShujuMissingNotice();
      }
      showDataGateNotice(pendingResult.dataGate);

      return;
    }

    // API 异常（重试按钮 + 关闭按钮）
    const ac2 = document.getElementById('aiModal');
    if (ac2) {
      const inr2 = ac2.querySelector('.ai-content');
      const msg = apiError || '分析服务暂时不可用';
      if (inr2)
        inr2.innerHTML =
          '<div style="text-align:center;padding:60px 20px;color:var(--amber);"><div style="font-size:40px;margin-bottom:12px;">⚠️</div><div style="font-size:16px;font-weight:600;">请求失败</div><div style="font-size:12px;color:var(--text3);margin-top:8px;">' +
          msg +
          '</div><button style="margin-top:16px;padding:8px 24px;border-radius:24px;background:var(--cyan);color:var(--bg);border:none;cursor:pointer;font-size:13px;margin-right:8px;" onclick="closeAI();showAIPrediction(\'' +
          matchId +
          "','" +
          homeTeam.replace(/'/g, "\\'") +
          "','" +
          awayTeam.replace(/'/g, "\\'") +
          '\')">重新加载</button><button style="padding:8px 24px;border-radius:24px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-size:13px;" onclick="closeAI()">关闭</button></div>';
    }
  }

  // API 回调处理
  function onApiResult(d, errMsg) {
    if (d) {
      pendingResult = d;
      apiDone = true;
      const contentHash = JSON.stringify(d.content || '');
      predictionCache[matchId] = { content: d, hash: contentHash };
      persistPredictionCache();
    } else if (errMsg) {
      apiError = errMsg;
    }
    tryRenderResult();
  }

  if (!preloadedData) {
    api('ai-predict', { matchId: matchId }, 2)
      .then(function (d) {
        onApiResult(d, null);
      })
      .catch(function (e) {
        onApiResult(null, (e && e.message) || '网络连接失败');
      });
  }

  // 300ms 轮询检查（取代固定的 setTimeout，API 返回后立即尝试渲染）
  resolveTimer = setInterval(function () {
    if (rendered) {
      clearInterval(resolveTimer);
      resolveTimer = null;
      return;
    }
    tryRenderResult();
  }, 300);

  function pollForMerge(matchId, homeTeam, awayTeam, retries) {
    retries = retries || 0;
    if (retries >= 15) return;
    const delay = Math.min(1000 * Math.pow(2, retries), 30000);
    setTimeout(function () {
      api('ai-predict', { matchId: matchId }, 2)
        .then(function (rd) {
          if (rd.content && !rd.pendingMerge && (rd.dualModel || rd.merged)) {
            renderAIContent(rd.content, homeTeam, awayTeam);
            showDataGateNotice(rd.dataGate);
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
  const modal = document.getElementById('aiModal');
  if (!modal) return;
  const dis = modal.querySelector('.ai-disclaimer');
  if (dis) {
    dis.insertAdjacentHTML(
      'afterend',
      '<div style="margin:8px 20px;padding:10px 14px;border-radius:8px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);font-size:12px;color:#FBBF24;text-align:center;">' +
        '📊 近10场及交战数据尚未入库，攻防对比和近期战绩图表可能基于AI知识预估。已触发后台数据抓取，稍后重试可获得精确统计。' +
        '</div>',
    );
  }
}

function _escapeGateText(s) {
  const str = s == null ? '' : String(s);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _renderDataGateNoticeHtml(gate) {
  if (!gate) return '';
  let ready = (gate.readyItems || []).map(function (x) {
    return x && x.label ? x.label : '';
  });
  let missing = (gate.missingItems || []).map(function (x) {
    return x && x.label ? x.label : '';
  });
  let pendingOptional = (gate.optionalItems || [])
    .filter(function (x) {
      return x && x.ready === false;
    })
    .map(function (x) {
      return x.label || '';
    });

  ready = ready.filter(Boolean);
  missing = missing.filter(Boolean);
  pendingOptional = pendingOptional.filter(Boolean);

  const passed = !!gate.passed;
  const title = passed ? '✅ 生成前关键数据已就绪' : '⚠️ 生成前关键数据缺失';
  const bg = passed ? 'rgba(34,197,94,0.08)' : 'rgba(251,191,36,0.08)';
  const border = passed ? 'rgba(34,197,94,0.25)' : 'rgba(251,191,36,0.24)';
  const color = passed ? '#4ADE80' : '#FBBF24';

  let detail =
    '已具备：' +
    _escapeGateText(ready.length ? ready.join('、') : '无') +
    '<br>缺失：' +
    _escapeGateText(missing.length ? missing.join('、') : '无');
  if (pendingOptional.length > 0) {
    detail += '<br>待补充：' + _escapeGateText(pendingOptional.join('、'));
  }

  return (
    '<div class="ai-gate-notice" style="margin:12px 20px;padding:10px 14px;border-radius:8px;background:' +
    bg +
    ';border:1px solid ' +
    border +
    ';font-size:12px;color:' +
    color +
    ';line-height:1.65;text-align:left;">' +
    '<div style="font-weight:600;margin-bottom:4px;">' +
    title +
    '</div><div style="color:#E5E7EB;">' +
    detail +
    '</div></div>'
  );
}

function showDataGateNotice(gate) {
  if (!gate) return;
  const modal = document.getElementById('aiModal');
  if (!modal) return;
  const dis = modal.querySelector('.ai-disclaimer');
  if (!dis) return;
  const old = modal.querySelector('.ai-gate-notice');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  dis.insertAdjacentHTML('beforebegin', _renderDataGateNoticeHtml(gate));
}

export function renderAIContent(content, homeTeam, awayTeam) {
  const c = content || {};
  const conf = typeof c.confidence === 'number' ? c.confidence : 70;
  const preds = c['预测建议'] || [];
  const baseStr = c['基础面'] || {};
  const stateStr = c['状态面'] || {};
  const motiStr = c['动机面'] || {};
  const posStr = c['对位面'] || {};
  const mktStr = c['市场面'] || {};
  const highlight = c['核心看点'] || {};
  const baseTable = baseStr['攻防全景数据'];

  function esc(s) {
    const str = s == null ? '' : String(s);
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function clip(s, max) {
    const str = s == null ? '' : String(s);
    if (str.length <= max) return str;
    let idx = str.lastIndexOf('。', max);
    if (idx > max * 0.5) return str.substring(0, idx + 1);
    idx = str.lastIndexOf('，', max);
    if (idx > max * 0.5) return str.substring(0, idx) + '...';
    return str.substring(0, max - 3) + '...';
  }
  function has(s) {
    return s && (typeof s === 'string' ? s.trim().length > 0 : true);
  }

  let html = '';
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

  const coreView = esc(highlight['核心看点'] || c['核心观点'] || '');
  const varRemind = esc(highlight['变数提醒'] || c['变数提醒'] || '');
  const icons = ['🏆', '⚽', '📊'];
  html += '<div class="ai-core-view">';
  html +=
    '<div class="ai-core-header"><span class="ai-core-icon">💡</span><span class="ai-core-title">AI核心观点</span></div>';
  html += '<div class="ai-core-content">' + clip(coreView, 120) + '</div>';
  if (varRemind) html += '<div class="ai-core-desc">' + clip(varRemind, 80) + '</div>';
  html += '<div class="ai-predict-row">';
  preds.forEach(function (p, i) {
    const val = esc(p['建议方向'] || '');
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
  const bRank = baseStr['积分排名'] || '';
  const bHasRank = bRank.length > 5;
  const bHasTable = baseTable && baseTable.rows && baseTable.rows.length >= 3;
  const bHasBaseCon = has(baseStr['核心结论']);
  if (bHasRank || bHasTable || bHasBaseCon) {
    html +=
      '<div id="ai-sec-01" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">01</span><span class="ai-sec-name">基础面</span>';
    if (baseStr['概括']) html += '<span class="ai-sec-desc">' + clip(esc(baseStr['概括']), 20) + '</span>';
    html += '</div>';
    if (bHasRank) {
      let rankHome = '',
        rankAway = '';
      let idxH = -1,
        idxA = -1;
      idxH = bRank.indexOf(homeTeam);
      idxA = bRank.indexOf(awayTeam);
      if (idxH < 0 && homeTeam.length >= 2) idxH = bRank.indexOf(homeTeam.substring(0, 2));
      if (idxA < 0 && awayTeam.length >= 2) idxA = bRank.indexOf(awayTeam.substring(0, 2));
      if (idxH < 0) idxH = bRank.indexOf(homeTeam[0]);
      if (idxA < 0) idxA = bRank.indexOf(awayTeam[0]);
      if (idxH >= 0 && idxA < 0) {
        const dots = [];
        for (let di = idxH + 1; di < bRank.length; di++) {
          if (bRank[di] === '。' || bRank[di] === '；') dots.push(di);
        }
        if (dots.length > 0 && dots[0] > idxH && dots[0] < bRank.length - 3) {
          idxA = dots[0] + 1;
        }
      } else if (idxA >= 0 && idxH < 0) {
        const dots2 = [];
        for (let di2 = idxA + 1; di2 < bRank.length; di2++) {
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
      const adCheck = baseStr['_attackDefenseCheck'];
      const hasAdConflict = adCheck && adCheck.detected;
      html += '<div class="ai-data-compare"><div class="ai-data-title">攻防数据对比';
      if (hasAdConflict) html += ' <span style="font-size:10px;color:var(--amber);">⚠️ 双模型数据不一致</span>';
      html += '</div>';

      // 构建冲突快速索引
      const adConflictMap = {};
      if (adCheck && adCheck.conflicts) {
        adCheck.conflicts.forEach(function (c) {
          adConflictMap[c.label] = c;
        });
      }

      baseTable.rows.forEach(function (row) {
        if (row.length < 3) return;
        const label = row[0],
          hv = row[1],
          av = row[2];
        const isShooter = label.indexOf('射手') >= 0;
        const rowConflict = adConflictMap[label];
        const isConflict = rowConflict && rowConflict.conflict;

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
          const hn = parseFloat(hv),
            an = parseFloat(av);
          const hp = isNaN(hn) || isNaN(an) ? 50 : Math.round((hn / (hn + an)) * 100);
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
            const dbHn = parseFloat(rowConflict.dbHome),
              dbAn = parseFloat(rowConflict.dbAway);
            const dbHp = isNaN(dbHn) || isNaN(dbAn) ? 50 : Math.round((dbHn / (dbHn + dbAn)) * 100);
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
  const hf = (stateStr['主队近况'] || '').match(/(\d+)胜(\d+)平(\d+)负/),
    af = (stateStr['客队近况'] || '').match(/(\d+)胜(\d+)平(\d+)负/);
  const hasHistory = has(stateStr['历史对阵']);
  const injTable = stateStr['伤病影响'];
  const hasInj = injTable && injTable.rows && injTable.rows.length;
  const hasStateCon = has(stateStr['核心结论']);
  const rfc = stateStr['_recentFormCheck']; // 近期战绩交叉验证数据
  if (hf || af || hasHistory || hasInj || hasStateCon) {
    html +=
      '<div id="ai-sec-02" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">02</span><span class="ai-sec-name">状态面</span></div>';
    if (hf || af) {
      html += '<div class="ai-form-title">近期战绩对比</div>';
    }

    // 辅助函数：渲染 W/D/L 小圆点
    function renderFormDots(w, d, l) {
      let dots = '';
      for (var di = 0; di < w; di++) dots += '<span class="ai-form-dot w">W</span>';
      for (var di = 0; di < d; di++) dots += '<span class="ai-form-dot d">D</span>';
      for (var di = 0; di < l; di++) dots += '<span class="ai-form-dot l">L</span>';
      return dots;
    }

    // 渲染主队近期战绩
    if (rfc && rfc.conflicts && rfc.conflicts.home && rfc.conflicts.home.conflict) {
      const hc = rfc.conflicts.home;
      const dsH = hc.deepseek,
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
      const ac = rfc.conflicts.away;
      const dsA = ac.deepseek,
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
        const isHome = row[0].indexOf('主') >= 0 || row[0].indexOf(homeTeam) >= 0;
        const tag = isHome ? esc(homeTeam[0]) : esc(awayTeam[0]);
        const tagClass = isHome ? 'home' : 'away';
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
  const hasWill = has(motiStr['战意强度']);
  html +=
    '<div id="ai-sec-03" class="ai-section-content"><div class="ai-sec-title"><span class="ai-sec-num">03</span><span class="ai-sec-name">动机面</span></div>';
  if (hasWill)
    html +=
      '<div class="ai-item"><div class="ai-item-label">战意强度</div><div class="ai-item-text">' +
      clip(esc(motiStr['战意强度']), 120) +
      '</div></div>';
  html += '</div>';

  // 04 对位面
  const posGood = has(posStr['攻防博弈']) || has(posStr['节奏控制']);
  const posBad = has(posStr['主场氛围']) || has(posStr['战术与教练风格']);
  const hasPosCon = has(posStr['核心结论']);
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
  const hasOdds = has(mktStr['盘口与赔率']) || has(mktStr['大小球']);
  const hasMktCon = has(mktStr['核心结论']);
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
  let hasAnyContent = false;
  ['基础面', '状态面', '动机面', '对位面', '市场面', '核心看点'].forEach(function (sec) {
    const s = c[sec];
    if (!s) return;
    const keys = Object.keys(s).filter(function (k) {
      return k[0] !== '_';
    });
    keys.forEach(function (k) {
      const v = s[k];
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
    const modalEl3 = document.getElementById('aiModal');
    if (modalEl3) modalEl3.innerHTML = html;
    return;
  }

  html += '<div class="ai-disclaimer">本分析为AI生成，仅供参考，请理性对待</div>';
  html += '</div>';

  const modalEl2 = document.getElementById('aiModal');
  if (modalEl2) modalEl2.innerHTML = html;
}

// 渲染部分结果 + 交叉验证中 badge
export function renderAIContentWithBadge(content, homeTeam, awayTeam, badgeText) {
  renderAIContent(content, homeTeam, awayTeam);
  // 在 disclaimer 前插入合并等待提示
  const modal = document.getElementById('aiModal');
  if (!modal) return;
  const dis = modal.querySelector('.ai-disclaimer');
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
  const badgeClass =
    consensus.consensus === 'strong'
      ? 'strong'
      : consensus.consensus === 'weak'
        ? 'weak'
        : consensus.consensus === 'meltdown'
          ? 'melt'
          : 'neutral';
  const badgeText =
    consensus.consensus === 'strong'
      ? 'STRONG'
      : consensus.consensus === 'weak'
        ? 'WEAK'
        : consensus.consensus === 'meltdown'
          ? 'MELT'
          : 'NEUTRAL';
  const cells = consensus.models
    .map(function (m) {
      const dirLabel =
        m.direction === 'home' ? '\u4e3b\u80dc' : m.direction === 'draw' ? '\u5e73\u5c40' : '\u5ba2\u80dc';
      const cls = m.direction === consensus.mainDirection ? 'agree' : 'dissent';
      return (
        '<div class="consensus-cell ' +
        cls +
        '"><div class="consensus-model">' +
        m.model +
        '</div><div class="consensus-result">' +
        dirLabel +
        '</div><div class="consensus-confidence">' +
        (m.confidence || '--') +
        '%</div></div>'
      );
    })
    .join('');
  const mainLabel =
    consensus.mainDirection === 'home'
      ? '\u4e3b\u80dc'
      : consensus.mainDirection === 'draw'
        ? '\u5e73\u5c40'
        : '\u5ba2\u80dc';
  return (
    '<div class="chart-box consensus-bar"><div class="consensus-header"><span class="consensus-title">\u591a\u6a21\u578b\u9884\u6d4b\u5171\u8bc6</span><span class="consensus-badge ' +
    badgeClass +
    '">' +
    badgeText +
    '</span></div><div class="consensus-grid">' +
    cells +
    '</div><div class="consensus-summary">' +
    consensus.agreeCount +
    '/' +
    consensus.totalCount +
    ' \u6a21\u578b\u4e00\u81f4\u770b <span style="color:var(--cyan);font-weight:700">' +
    mainLabel +
    '</span></div></div>'
  );
}

function renderGsSummary(gsData) {
  if (!gsData) return '';
  const parts = [];
  if (gsData.homePower !== undefined && gsData.guestPower !== undefined)
    parts.push('\u5b9e\u529b: ' + gsData.homePower + ' vs ' + gsData.guestPower);
  if (gsData.goalLine !== undefined) parts.push('\u5927\u5c0f\u7403: ' + gsData.goalLine.toFixed(1));
  if (gsData.predictedScore) parts.push('\u9884\u6d4b\u6bd4\u5206: ' + gsData.predictedScore);
  if (gsData.fusionConsensus) parts.push('\u5171\u8bc6: ' + gsData.fusionConsensus);
  if (parts.length === 0) return '';
  return (
    '<div class="chart-box" style="padding:10px 16px;font-size:var(--fs-sm);color:var(--text2);display:flex;flex-wrap:wrap;gap:12px"><span>\u26a1 \u529f\u5b88\u9053</span>' +
    parts
      .map(function (p) {
        return '<span style="color:var(--cyan)">' + p + '</span>';
      })
      .join('') +
    '</div>'
  );
}

function hasRecentForm(features) {
  return !!(features.home_win_pct_6 !== undefined || features.away_win_pct_6 !== undefined);
}

function renderRecentForm(match, features) {
  const homeName = match.homeName || '\u4e3b\u961f';
  const awayName = match.visitName || '\u5ba2\u961f';
  function makeDots(prefix) {
    const wr = features[prefix + '_win_pct_6'];
    if (wr === undefined) return '<span style="color:var(--text3);font-size:var(--fs-sm)">\u65e0\u6570\u636e</span>';
    const wins = Math.round(wr * 6);
    let dots = '';
    for (let i = 0; i < 6; i++) {
      const cls = i < wins ? 'w' : 'l';
      dots += '<span class="ai-form-dot ' + cls + '">' + (cls === 'w' ? 'W' : 'L') + '</span>';
    }
    return dots;
  }
  function pct(val) {
    return val !== undefined ? Math.round(val * 100) + '%' : '--';
  }
  return (
    '<div class="chart-box"><div class="chart-header"><span class="chart-title">\u8fd1\u671f\u6218\u7ee9 \u00b7 \u8fd16\u573a</span></div><div class="ai-form-row"><span class="ai-form-label">' +
    homeName +
    '</span>' +
    makeDots('home') +
    '<span class="ai-form-summary">\u80dc\u7387 ' +
    pct(features.home_win_pct_6) +
    ' | \u5747\u8fdb\u7403 ' +
    (features.home_goal_avg_6 !== undefined ? features.home_goal_avg_6.toFixed(1) : '--') +
    '</span></div><div class="ai-form-row"><span class="ai-form-label">' +
    awayName +
    '</span>' +
    makeDots('away') +
    '<span class="ai-form-summary">\u80dc\u7387 ' +
    pct(features.away_win_pct_6) +
    ' | \u5747\u8fdb\u7403 ' +
    (features.away_goal_avg_6 !== undefined ? features.away_goal_avg_6.toFixed(1) : '--') +
    '</span></div></div>'
  );
}

function renderStandingsContext(match, standings) {
  if (!standings || (!standings.home && !standings.away)) return '';
  const home = standings.home;
  const away = standings.away;
  const homeTxt = home
    ? (match.homeName || '\u4e3b\u961f') + ' \u7b2c' + home.rank + '\u4f4d (' + (home.points || '?') + '\u5206)'
    : '--';
  const awayTxt = away
    ? (match.visitName || '\u5ba2\u961f') + ' \u7b2c' + away.rank + '\u4f4d (' + (away.points || '?') + '\u5206)'
    : '--';
  let diffTxt = '';
  if (standings.rankDiff !== null && standings.rankDiff !== undefined) {
    diffTxt = ' \u6392\u540d\u5dee: ' + Math.abs(standings.rankDiff);
    if (Math.abs(standings.rankDiff) <= 2) diffTxt += ' | \ud83d\udd25 \u5173\u952e\u6218';
    else if (Math.abs(standings.rankDiff) <= 5) diffTxt += ' | \u666e\u901a';
  }
  return (
    '<div class="chart-box" style="padding:12px 16px"><div class="chart-header" style="margin-bottom:8px"><span class="chart-title">\ud83c\udfc6 \u8054\u8d5b\u6392\u540d</span></div><div style="font-size:var(--fs-sm);color:var(--text2)">' +
    homeTxt +
    '</div><div style="font-size:var(--fs-sm);color:var(--text2)">' +
    awayTxt +
    '</div>' +
    (diffTxt ? '<div style="font-size:var(--fs-xs);color:var(--cyan);margin-top:4px">' + diffTxt + '</div>' : '') +
    '</div>'
  );
}

function renderH2HSummary(match, h2h) {
  if (!h2h || h2h.length === 0) return '';
  const last5 = h2h.slice(0, 5);
  const homeName = match.homeName || '';
  const awayName = match.visitName || '';
  let homeWins = 0,
    awayWins = 0,
    draws = 0,
    totalGoals = 0;
  last5.forEach(function (r) {
    if (r.home_team === homeName && r.home_score > r.away_score) homeWins++;
    else if (r.away_team === homeName && r.away_score > r.home_score) homeWins++;
    else if (r.home_team === awayName && r.home_score > r.away_score) awayWins++;
    else if (r.away_team === awayName && r.away_score > r.home_score) awayWins++;
    else draws++;
    totalGoals += (r.home_score || 0) + (r.away_score || 0);
  });
  const avgGoals = last5.length > 0 ? (totalGoals / last5.length).toFixed(1) : '--';
  const lastMatch = h2h[0];
  const lastTxt = lastMatch
    ? lastMatch.match_date +
      ' ' +
      lastMatch.home_team +
      ' ' +
      lastMatch.home_score +
      '-' +
      lastMatch.away_score +
      ' ' +
      lastMatch.away_team
    : '';

  return (
    '<div class="chart-box" style="padding:12px 16px">' +
    '<div class="chart-header" style="margin-bottom:8px"><span class="chart-title">历史交锋</span><span class="chart-hint">近' +
    last5.length +
    '次</span></div>' +
    '<div class="filter-stats-row">' +
    '<div class="filter-stat-item"><div class="filter-stat-value" style="color:var(--green)">' +
    homeWins +
    '</div><div class="filter-stat-label">' +
    homeName +
    '胜</div></div>' +
    '<div class="filter-stat-divider"></div>' +
    '<div class="filter-stat-item"><div class="filter-stat-value" style="color:var(--amber)">' +
    draws +
    '</div><div class="filter-stat-label">平局</div></div>' +
    '<div class="filter-stat-divider"></div>' +
    '<div class="filter-stat-item"><div class="filter-stat-value" style="color:var(--red)">' +
    awayWins +
    '</div><div class="filter-stat-label">' +
    awayName +
    '胜</div></div>' +
    '<div class="filter-stat-divider"></div>' +
    '<div class="filter-stat-item"><div class="filter-stat-value">' +
    avgGoals +
    '</div><div class="filter-stat-label">均进球</div></div>' +
    '</div>' +
    (lastMatch
      ? '<div style="font-size:var(--fs-xs);color:var(--text3);margin-top:6px">最近: ' + lastMatch + '</div>'
      : '') +
    '</div>'
  );
}

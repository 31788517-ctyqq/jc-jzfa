import { api } from '../api.js';
import { formatDate, setCache, getCache } from '../utils.js';

function getMatchLabel(item) {
  return String((item && (item.num || item.matchNum || item.matchId || item.dataId)) || '').trim();
}

function extractMatchDate(value) {
  var text = String(value || '').trim();
  var fullDate = text.match(/^\d{4}-(\d{2}-\d{2})/);
  if (fullDate) return fullDate[1];
  var matched = text.match(/(\d{2}-\d{2})/);
  return matched ? matched[1] : '';
}

function resolveHottestTarget(hottest, matches) {
  if (!hottest) return null;
  var hottestId = String(hottest.matchId || hottest.dataId || '').trim();
  var hottestNum = getMatchLabel(hottest);
  var matched = (Array.isArray(matches) ? matches : []).find(function (m) {
    var matchId = String(m.matchId || m.dataId || '').trim();
    var matchNum = getMatchLabel(m);
    return (hottestId && matchId === hottestId) || (hottestNum && matchNum === hottestNum);
  });
  var target = matched || hottest;
  var rawMatchDate =
    (target && (target.matchDate || target.date || target.match_day)) ||
    hottest.matchDate ||
    hottest.date ||
    hottest.match_day ||
    (target && target.startTime) ||
    hottest.startTime ||
    '';
  return {
    matchId: String((target && (target.matchId || target.dataId)) || hottestId || '').trim(),
    matchNum: getMatchLabel(target) || hottestNum,
    matchDate: extractMatchDate(rawMatchDate),
    homeName: String((target && target.homeName) || hottest.homeName || '').trim(),
    visitName: String((target && target.visitName) || hottest.visitName || '').trim(),
  };
}

window.goHomeHottestMatch = function () {
  var target = window.__homeHottestTarget || null;
  try {
    if (target) sessionStorage.setItem('pendingMatchFocus', JSON.stringify(target));
    else sessionStorage.removeItem('pendingMatchFocus');
  } catch (e) {}
  if (window.switchTab) window.switchTab('match');
};

function cacheHomeMatches(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return;
  var raw = matches[0].date || matches[0].matchDate || matches[0].startTime || formatDate(new Date());
  var full = String(raw).match(/\d{4}-\d{2}-\d{2}/);
  var short = String(raw).match(/\d{2}-\d{2}/);
  if (full) {
    setCache('match-list:' + full[0], matches);
    setCache('match-list:' + full[0].slice(5), matches);
  } else if (short) {
    setCache('match-list:' + short[0], matches);
  }
}

/** P0-1 优化：纯渲染函数，可从缓存或API数据调用 */
function _renderHomeStats(matches, rankData) {
  cacheHomeMatches(matches);

  // 今日比赛
  var mcEl = document.getElementById('homeMatchCount');
  if (mcEl) mcEl.textContent = Array.isArray(matches) ? String(matches.length) : '0';
  var liveCount = Array.isArray(matches)
    ? matches.filter(function (m) {
        var status = String(m.matchStatus || m.status || m.state || '').toLowerCase();
        return /进行|上半|下半|中场|live|playing|in_progress/.test(status);
      }).length
    : 0;
  var metaEl = document.getElementById('homeMatchMeta');
  if (metaEl) metaEl.textContent = '进行中 ' + liveCount + ' 场';

  // 最多推荐（综合排行第一的场次标签 + 方向）
  var mrEl = document.getElementById('homeMaxRank');
  var topExpertCount = rankData.topExpertCount || 0;
  if (mrEl) mrEl.textContent = topExpertCount;
  var ranking = Array.isArray(rankData.ranking) ? rankData.ranking : [];
  var topRank = ranking.length > 0 ? ranking[0] : null;
  var maxRankMetaEl = document.getElementById('homeMaxRankMeta');
  if (maxRankMetaEl) {
    var topLabel = topRank ? topRank.num || topRank.matchNum || topRank.matchId || '' : '';
    var topDirection = topRank ? topRank.direction || '' : '';
    maxRankMetaEl.textContent = topLabel && topDirection ? topLabel + '@' + topDirection : topLabel || '-';
  }

  // 最热场次（按该场比赛所有方向推荐专家总数排序，取总数最多的）
  var hottest = ranking.reduce(function (best, item) {
    var bestTotal = best ? best.totalExpertCount || best.expertCount || 0 : 0;
    var itemTotal = item.totalExpertCount || item.expertCount || 0;
    if (!best || itemTotal > bestTotal) return item;
    return best;
  }, null);
  var hmEl = document.getElementById('homeHottest');
  if (hmEl) hmEl.textContent = hottest ? hottest.totalExpertCount || hottest.expertCount || 0 : '-';
  var hottestMetaEl = document.getElementById('homeHottestMeta');
  if (hottestMetaEl) {
    hottestMetaEl.textContent = hottest ? hottest.num || hottest.matchNum || hottest.matchId || '-' : '-';
  }
  window.__homeHottestTarget = resolveHottestTarget(hottest, matches);
}

// ═══ 世界杯区块 ═══
function loadWorldCupSection() {
  var section = document.getElementById('wcSection');
  if (!section) return;
  section.style.display = 'none'; // 默认隐藏，有数据再显示

  var today = formatDate(new Date());

  // 卡片3：今日比赛数据（始终有）
  var matchP = api('match-list', {}).catch(function () { return []; });

  // 获取最近有数据的日期列表
  var datesP = api('week-dates', {}).catch(function () { return []; });

  Promise.all([matchP, datesP]).then(function (r) {
    var matches = r[0] || [];
    var dateList = (r[1] && r[1].dates) ? r[1].dates : [];

    // 卡片3：今日 — 仅统计世界杯联赛标签的比赛
    var wcMatches = (Array.isArray(matches) ? matches : []).filter(function (m) {
      return (m.leagueName || '').indexOf('世界杯') >= 0;
    });
    var todayCount = wcMatches.length;
    var todayMM = today.slice(5).replace('-', '/');
    var tag3 = document.getElementById('wcTag3');
    var date3 = document.getElementById('wcDate3');
    if (tag3) tag3.textContent = todayCount + '场';
    if (date3) date3.textContent = todayMM;

    // 找到今天之前的两个有效日期
    var pastDates = [];
    if (Array.isArray(dateList)) {
      for (var di = dateList.length - 1; di >= 0; di--) {
        var dd = dateList[di];
        if (dd && dd < today) { pastDates.push(dd); if (pastDates.length >= 2) break; }
      }
    }

    // 如果没有 dateList，尝试最近的 2 天
    if (pastDates.length < 2) {
      var d = new Date(); d.setDate(d.getDate() - 1);
      for (var ri = 0; ri < 3; ri++) {
        var dd2 = formatDate(d);
        if (dd2 < today) { pastDates.push(dd2); if (pastDates.length >= 2) break; }
        d.setDate(d.getDate() - 1);
      }
    }

    if (pastDates.length === 0) { section.style.display = 'block'; return; }

    // 按日期升序排列（卡片1最早 → 卡片2中间 → 卡片3今天）
    pastDates.sort();

    // 批量获取前两天的专家方案数据
    var planPromises = pastDates.map(function (dt) {
      return api('plan-list', { date: dt }).catch(function () { return {}; });
    });

    Promise.all(planPromises).then(function (planResults) {
      for (var pi = 0; pi < Math.min(planResults.length, 2); pi++) {
        var cardIdx = pi + 1;
        var planData = planResults[pi] || {};
        var plans = planData.plans || [];
        var dt = pastDates[pi] || '';
        var ddText = dt.slice(5).replace('-', '/');

        // 统计中奖方案数
        var wonCount = 0, settledCount = 0;
        plans.forEach(function (p) {
          if (p.isPlanWon === true) { wonCount++; settledCount++; }
          else if (p.isPlanLose === true || p.isPlanWon === false) { settledCount++; }
        });

        var allSettled = settledCount >= plans.length && plans.length > 0;
        var tagEl = document.getElementById('wcTag' + cardIdx);
        var dateEl = document.getElementById('wcDate' + cardIdx);

        if (tagEl) {
          if (plans.length === 0) {
            tagEl.textContent = '-';
            tagEl.className = 'wc-tag black';
          } else if (allSettled) {
            tagEl.textContent = plans.length + '中' + wonCount;
            tagEl.className = wonCount > 0 ? 'wc-tag coral' : 'wc-tag gray';
          } else {
            tagEl.textContent = plans.length + '场';
            tagEl.className = 'wc-tag green';
          }
        }
        if (dateEl) dateEl.textContent = ddText;
      }
      section.style.display = 'block';
    });
  });
}

export function loadHome() {
  var initialMatchCountEl = document.getElementById('homeMatchCount');
  if (initialMatchCountEl && initialMatchCountEl.textContent === '-') initialMatchCountEl.textContent = '0';

  // ★ 世界杯区块
  loadWorldCupSection();

  // ★ P0-1 优化：乐观渲染 — 有缓存立即渲染，无缓存等网络（getCache 内置 TTL 检查）
  var today = new Date().toISOString().slice(0, 10);
  var cachedMatches = getCache('match-list:' + today) || getCache('match-list:' + today.slice(5));
  var cachedRank = getCache('ranking-list:home');
  if (cachedMatches) {
    _renderHomeStats(cachedMatches, cachedRank || {});
  }

  // 后台静默刷新（始终发起）
  var rankP = api('ranking-list', {}).catch(function () {
    return {};
  });
  var matchP = api('match-list', {}).catch(function () {
    return [];
  });
  Promise.all([rankP, matchP]).then(function (r) {
    var rankData = r[0], matches = r[1];
    // 缓存 ranking 列表（5分钟TTL）
    setCache('ranking-list:home', rankData);
    _renderHomeStats(matches, rankData);
  });

  // ── 近7日推荐盈利图表 ──
  loadHomeProfitChart();

  // ── 消息提醒引擎（仅首页加载时运行） ──
  NotiEngine.run();
}

// ═══ 近7日推荐盈利 SVG 折线图 ═══
function loadHomeProfitChart() {
  api('daily-profit-7d', { days: 7 })
    .then(function (data) {
      if (!data || !data.dates || !data.profits || data.dates.length === 0) return;
      var dates = data.dates.slice(0, 7),
        profits = data.profits.slice(0, 7).map(function (v) {
          return v === null ? 0 : v;
        });

      // ★ 至少保留 2 个点才能画线
      if (dates.length < 2) return;

      renderProfitChartNative(dates, profits);
      var section = document.getElementById('homeProfitChartSection');
      if (section) section.style.display = 'block';
    })
    .catch(function () {});
}

function renderProfitChartNative(dates, profits) {
  var n = profits.length;
  if (n === 0) return;

  var svgW = 320,
    svgH = 232;
  var padX = 10,
    chartW = svgW - padX * 2;

  // ── 1. Y 轴范围（非对称：正负按实际数据比例） ──
  var maxVal = Math.max.apply(null, profits.concat([0]));
  var minVal = Math.min.apply(null, profits.concat([0]));
  var posMax = maxVal > 0 ? Math.ceil((maxVal * 1.12) / 500) * 500 : 500;
  var negMax = minVal < 0 ? Math.ceil((Math.abs(minVal) * 1.12) / 500) * 500 : 0;
  var yMin = -negMax;
  var yMax = posMax;
  if (negMax === 0) yMin = 0;
  if (posMax === 0) yMax = 0;
  if (yMax === yMin) {
    yMax += 500;
    yMin -= 500;
  }
  function toY(v) {
    return svgH * (1 - (v - yMin) / (yMax - yMin));
  }
  var baseY = toY(0);

  // ── 2. X 轴 ──
  var xs = [];
  for (var i = 0; i < n; i++) xs.push(padX + (chartW / Math.max(n - 1, 1)) * i);

  // ── 3. 分段折线 ──
  var segs = [],
    cur = null;
  function add(i) {
    var x = xs[i],
      y = toY(profits[i]),
      p = x.toFixed(1) + ',' + y.toFixed(1),
      up = profits[i] >= 0;
    if (!cur || cur.up !== up) {
      if (cur) {
        cur.lx = x;
        cur.ly = y;
        segs.push(cur);
      }
      cur = { up: up, path: 'M' + p, pts: [[x, y]], lx: x, ly: y };
    } else {
      var px = cur.pts[cur.pts.length - 1][0],
        py = cur.pts[cur.pts.length - 1][1],
        d = (x - px) / 3;
      cur.path +=
        ' C' + (px + d).toFixed(1) + ',' + py.toFixed(1) + ' ' + (x - d).toFixed(1) + ',' + y.toFixed(1) + ' ' + p;
      cur.pts.push([x, y]);
      cur.lx = x;
      cur.ly = y;
    }
  }
  for (var i = 0; i < n; i++) add(i);
  if (cur) segs.push(cur);

  // ── 4. 构建 SVG ──
  var defsEl = document.getElementById('profitDefs');
  var pathsEl = document.getElementById('profitPaths');
  if (defsEl) {
    defsEl.innerHTML =
      '<linearGradient id="profitG" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#ff6464" stop-opacity=".25"/>' +
      '<stop offset="100%" stop-color="#ff6464" stop-opacity="0"/>' +
      '</linearGradient>' +
      '<linearGradient id="lossG" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#29c782" stop-opacity=".2"/>' +
      '<stop offset="100%" stop-color="#29c782" stop-opacity="0"/>' +
      '</linearGradient>';
  }
  if (pathsEl) {
    var pathHtml = '';
    // 零线
    pathHtml +=
      '<line x1="0" y1="' +
      baseY.toFixed(1) +
      '" x2="' +
      svgW +
      '" y2="' +
      baseY.toFixed(1) +
      '" stroke="#dce2e5" stroke-width="1" stroke-dasharray="4,3"/>';

    // ★ 构建一条连续路径（贯穿所有点，用于描边连线）
    var continuousPath = 'M' + xs[0].toFixed(1) + ',' + toY(profits[0]).toFixed(1);
    for (var ci = 1; ci < n; ci++) {
      var px = xs[ci - 1],
        py = toY(profits[ci - 1]);
      var cx_ = xs[ci],
        cy_ = toY(profits[ci]);
      var d_ = (cx_ - px) / 3;
      continuousPath +=
        ' C' +
        (px + d_).toFixed(1) +
        ',' +
        py.toFixed(1) +
        ' ' +
        (cx_ - d_).toFixed(1) +
        ',' +
        cy_.toFixed(1) +
        ' ' +
        cx_.toFixed(1) +
        ',' +
        cy_.toFixed(1);
    }

    // ★ 连续描边线（全量连接所有红绿点）— 浅色不抢数字注意力
    pathHtml +=
      '<path class="profit-stroke" fill="none" stroke="#c0cad6" stroke-width="1.8"' +
      ' stroke-linecap="round" stroke-linejoin="round" d="' +
      continuousPath +
      '"/>';

    // 分段填充区域（按正负着色）
    segs.forEach(function (s) {
      var grad = s.up ? 'url(#profitG)' : 'url(#lossG)';
      var fillD =
        s.path +
        ' L' +
        s.lx.toFixed(1) +
        ',' +
        baseY.toFixed(1) +
        ' L' +
        s.pts[0][0].toFixed(1) +
        ',' +
        baseY.toFixed(1) +
        ' Z';
      pathHtml += '<path class="profit-area" fill="' + grad + '" d="' + fillD + '"/>';
    });
    // 数据点空心圆
    for (var i = 0; i < n; i++) {
      var cx = xs[i].toFixed(1),
        cy = toY(profits[i]).toFixed(1);
      var cs = profits[i] >= 0 ? '#ff5858' : '#22c878';
      pathHtml += '<circle cx="' + cx + '" cy="' + cy + '" r="4.5" fill="#fff" stroke="' + cs + '" stroke-width="2"/>';
    }
    pathsEl.innerHTML = pathHtml;

    // ★ 动画：计算连续描边路径的实际长度，设置精确的 dasharray（总时长 1.6s，延迟 0.4s 后开始）
    var allStrokes = pathsEl.querySelectorAll('.profit-stroke');
    allStrokes.forEach(function (sp) {
      var len = sp.getTotalLength();
      sp.style.strokeDasharray = len;
      sp.style.strokeDashoffset = len;
      requestAnimationFrame(function () {
        setTimeout(function () {
          sp.style.transition = 'stroke-dashoffset 1.6s cubic-bezier(0.22,1,0.36,1)';
          sp.style.strokeDashoffset = '0';
        }, 400);
      });
    });

    // ★ 填充区域延迟淡入（线条画完后 0.3s 开始，即 t≈2.3s）
    var areaPaths = pathsEl.querySelectorAll('.profit-area');
    areaPaths.forEach(function (ap) {
      ap.style.opacity = '0';
      ap.style.transition = 'none';
      setTimeout(function () {
        ap.style.transition = 'opacity 0.7s ease';
        ap.style.opacity = '1';
      }, 2300);
    });
  }

  // ── 5. Y 轴标签 ──
  var yaxisEl = document.getElementById('profitYaxis');
  if (yaxisEl) {
    var yHtml = '';
    var step = (yMax - yMin) / 5;
    for (var j = 0; j <= 5; j++) {
      var v = yMax - step * j;
      var iv = Math.round(v);
      yHtml += '<span>' + (iv >= 0 ? '+' + iv : '' + iv) + '</span>';
    }
    yaxisEl.innerHTML = yHtml;
  }

  // ── 6. 数据标签（跳过 0 值，智能避让） ──
  var tagsEl = document.getElementById('profitTags');
  if (tagsEl) {
    // 预计算：标记哪些索引需要显示标签
    var tagIdx = [];
    for (var i = 0; i < n; i++) {
      if (profits[i] !== 0) tagIdx.push(i);
    }
    // 为连续同向标签分配交错高度，避免水平重叠
    var yOffs = {};
    var runDir = 0,
      runCnt = 0;
    for (var k = 0; k < tagIdx.length; k++) {
      var i = tagIdx[k];
      var dir = profits[i] >= 0 ? 1 : -1;
      if (dir !== runDir) {
        runDir = dir;
        runCnt = 0;
      }
      yOffs[i] = dir > 0 ? -(24 + (runCnt % 3) * 16) : 28 + (runCnt % 3) * 16;
      runCnt++;
    }
    var tHtml = '';
    for (var k = 0; k < tagIdx.length; k++) {
      var i = tagIdx[k];
      var vy = toY(profits[i]),
        vx = xs[i];
      var xP = ((vx / svgW) * 100).toFixed(2);
      var yOff = yOffs[i];
      // 边界感知：标签靠近上下边界时反转偏移方向
      var rawTop = ((vy + yOff) / svgH) * 100;
      if (rawTop < 4) {
        yOff = Math.abs(yOff);
      } else if (rawTop > 92) {
        yOff = -Math.abs(yOff);
      }
      var yP = ((vy + yOff) / svgH) * 100;
      yP = Math.max(3, Math.min(94, yP)).toFixed(2);
      var c = profits[i] >= 0 ? 'win' : 'loss';
      tHtml +=
        '<div class="profit-tag ' +
        c +
        '" style="left:' +
        xP +
        '%;top:' +
        yP +
        '%">' +
        (profits[i] >= 0 ? '+' : '') +
        profits[i].toFixed(0) +
        '</div>';
    }
    tagsEl.innerHTML = tHtml;
  }

  // ── 7. X 轴日期（n>5 时隔一个显示，避免拥挤） ──
  var xEl = document.getElementById('profitXaxis');
  if (xEl) {
    var dHtml = '';
    var showStep = n > 5 ? 2 : 1;
    for (var i = 0; i < n; i += showStep) {
      dHtml += '<span>' + (dates[i] || '') + '</span>';
    }
    // 确保最后一个日期始终显示
    if (showStep > 1 && (n - 1) % showStep !== 0) {
      dHtml += '<span>' + (dates[n - 1] || '') + '</span>';
    }
    xEl.innerHTML = dHtml;
  }

  // ── 8. 统计卡片 ──
  var total = 0,
    maxV = -Infinity,
    maxI = -1;
  for (var i = 0; i < n; i++) {
    total += profits[i];
    if (profits[i] > maxV) {
      maxV = profits[i];
      maxI = i;
    }
  }
  function fmt(n) {
    return (n >= 0 ? '+' : '') + n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  var tc = total >= 0 ? 'positive' : 'negative';

  function set(id, v) {
    var e = document.getElementById(id);
    if (e) e.textContent = v;
  }
  function setClass(id, cls) {
    var e = document.getElementById(id);
    if (e) e.className = cls;
  }
  set('statsTotal', fmt(total));
  setClass('statsTotal', total >= 0 ? 'positive' : 'negative');

  var growth = null;
  if (profits[0] !== 0 && isFinite(total / Math.abs(profits[0]))) {
    growth = (total / Math.abs(profits[0])) * 100;
  }
  set('statsGrowth', growth !== null ? (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%' : '--');
  setClass('statsGrowth', growth !== null ? (growth >= 0 ? 'positive' : 'negative') : '');

  set('statsMax', fmt(maxV));
  setClass('statsMax', 'positive');
  var mdEl = document.getElementById('statsMaxDate');
  if (mdEl) mdEl.textContent = maxI >= 0 ? dates[maxI] : '--';
}

// ═══════════════════════════════════════════════════════════
// ★ 消息提醒引擎 (NotiEngine)
// 核心原则：不打扰用户，每天最多推送一条消息
// ═══════════════════════════════════════════════════════════

var APP_VERSION = '20260610';

var NotiEngine = {
  _candidates: [],
  _consumed: false,

  /** 首页加载时调用 — 仅收集+Badge，不弹窗 */
  run: function () {
    this._collect()
      .then(
        function (msgs) {
          var filtered = NotiEngine._dedupeAndExpire(msgs);
          var sorted = NotiEngine._prioritize(filtered);
          var result = NotiEngine._dailyGuard(sorted);
          NotiEngine._updateBadge(result);
        }.bind(this),
      )
      .catch(function () {});
  },

  /** 收集所有满足触发条件的消息 */
  _collect: function () {
    var msgs = [];
    var self = this;

    // 1. 首次欢迎消息 (P0)
    if (!localStorage.getItem('noti:welcome_seen')) {
      msgs.push(self._buildWelcome());
    }

    // 异步收集需要 API 的消息类型
    return api('daily-profit-7d', { days: 7 })
      .then(function (data) {
        // 2. 专家博热5连红 (P1) - 基于多日数据聚合
        if (data && data.profits && Array.isArray(data.profits)) {
          var streakResult = self._checkStreak(data.profits);
          if (streakResult && !self._isRead('streak', streakResult.startDate)) {
            msgs.push(self._buildStreak(streakResult));
          }

          // 3. 7日盈利突破 (P1)
          var total = data.total || 0;
          if (total >= 1000) {
            var todayStr = new Date().toISOString().slice(0, 10);
            if (!self._isRead('profit', todayStr)) {
              msgs.push(self._buildProfitBreakthrough(data));
            }
          }
        }

        // 4. 系统版本更新 (P2)
        var seenVer = localStorage.getItem('noti:version_seen');
        if (seenVer !== APP_VERSION) {
          msgs.push(self._buildVersionUpdate());
        }

        return msgs;
      })
      .catch(function () {
        // API 失败时返回仅本地类型的消息（欢迎 + 版本）
        var seenVer = localStorage.getItem('noti:version_seen');
        if (seenVer !== APP_VERSION) {
          msgs.push(self._buildVersionUpdate());
        }
        return msgs;
      });
  },

  /** 检查连续盈利天数（5天） */
  _checkStreak: function (profits) {
    if (!Array.isArray(profits)) return null;
    var streak = 0;
    var startDate = null;
    for (var i = profits.length - 1; i >= 0; i--) {
      if ((profits[i] || 0) > 0) {
        streak++;
        startDate = this._dateOffset(i - profits.length + 1);
      } else break;
    }
    if (streak >= 5) {
      var days = [];
      var dayTotal = 0;
      for (var j = 0; j < Math.min(streak, 5); j++) {
        var idx = profits.length - streak + j;
        var val = profits[idx] || 0;
        dayTotal += val;
        days.push({ date: this._dateOffset(idx - profits.length + 1), profit: val });
      }
      return { startDate: startDate, days: days, total: dayTotal };
    }
    return null;
  },

  /** 计算日期偏移字符串 */
  _dateOffset: function (offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(5, 10); // MM-DD
  },

  /** 构建欢迎消息 */
  _buildWelcome: function () {
    return {
      id: 'welcome',
      type: 'welcome',
      priority: 'P0',
      title: '🎉 欢迎使用竞彩推荐监控系统！',
      body:
        '这是您的智能方案决策助手\n' +
        '\n' +
        '专家组方案 — 资深专家组的热门推荐方向；\n' +
        'AI深度分析 — 双AI模型融合，五维分析预测；\n' +
        '功守道分析 — 攻守数据建模，预判比赛走势；\n' +
        '多模型竞争 — 模型PK竞争，提高命中率；\n' +
        '\n' +
        '开始探索吧，祝您盈利长红！',
      btnText: '知道了',
      action: 'welcome_dismiss',
      storageKey: 'noti:welcome_seen',
      expiresAt: null,
      createdAt: new Date().toISOString(),
    };
  },

  /** 构建连红消息 */
  _buildStreak: function (data) {
    var lines = data.days
      .map(function (d) {
        return '\u2022 ' + d.date + ' 日盈利 +' + d.profit.toFixed(0) + ' 元 \u2705';
      })
      .join('\n');

    return {
      id: 'streak_' + data.startDate,
      type: 'streak',
      priority: 'P1',
      title: '🔥 专家博热 5 连红！',
      body:
        '专家博热方案连续 5 天盈利为正，状态极佳：\n' +
        lines +
        '\n\u2022 5日累计 +' +
        data.total.toFixed(0) +
        ' 元 \n\n' +
        '连红势头强劲，查看今日方案跑上节奏 →',
      btnText: '查看',
      action: 'nav_plan',
      storageKey: 'noti:streak_' + data.startDate,
      expiresAt: Date.now() + 3 * 24 * 3600000,
      createdAt: new Date().toISOString(),
    };
  },

  /** 构建盈利突破消息 */
  _buildProfitBreakthrough: function (data) {
    var total = data.total || 0;
    var maxDayProfit = 0,
      maxDate = '';
    var winDays = 0;
    if (data.profits && Array.isArray(data.profits)) {
      for (var i = 0; i < data.profits.length; i++) {
        if (data.profits[i] > maxDayProfit) {
          maxDayProfit = data.profits[i];
          maxDate = data.dates ? data.dates[i] || '' : '';
        }
        if ((data.profits[i] || 0) > 0) winDays++;
      }
    }
    var yieldRate = total > 0 ? ((total / 7000) * 100).toFixed(1) : '0';

    return {
      id: 'profit_' + new Date().toISOString().slice(0, 10),
      type: 'profit',
      priority: 'P1',
      title: '💰 专家方案盈利突破！',
      body:
        '近 7 日专家博热方案总盈利 +' +
        total.toFixed(0) +
        ' 元 \n\n' +
        '\u2022 最高单日 +' +
        maxDayProfit.toFixed(0) +
        ' 元（' +
        maxDate +
        '）\n' +
        '\u2022 盈利天数 ' +
        winDays +
        '/7 天\n' +
        '\u2022 累计收益率 ' +
        yieldRate +
        '%\n\n' +
        '稳定盈利中，保持跟进 →',
      btnText: '查看',
      action: 'nav_income',
      storageKey: 'noti:profit_' + new Date().toISOString().slice(0, 10),
      expiresAt: Date.now() + 24 * 3600000,
      createdAt: new Date().toISOString(),
    };
  },

  /** 构建版本更新消息 */
  _buildVersionUpdate: function () {
    return {
      id: 'ver_' + APP_VERSION,
      type: 'version',
      priority: 'P2',
      title: '🆕 系统更新 V' + APP_VERSION,
      body:
        '本次更新内容：\n' +
        '新增消息提醒中心，支持多类消息自动收集与优先级排序\n' +
        '每天最多推送1条消息，严格遵循"不打扰"原则\n' +
        '优化用户体验，Badge+弹窗分离展示\n\n' +
        '更多细节请继续探索新功能！',
      btnText: '知道了',
      action: 'version_dismiss',
      storageKey: 'noti:version_seen',
      expiresAt: Date.now() + 7 * 24 * 3600000,
      createdAt: new Date().toISOString(),
      extraData: APP_VERSION,
    };
  },

  /** 检查某条消息是否已读 */
  _isRead: function (type, key) {
    var lsKey = 'noti:' + type + '_' + (key || '');
    return !!localStorage.getItem(lsKey);
  },

  /** 去重 + 过期清理 */
  _dedupeAndExpire: function (msgs) {
    var now = Date.now();
    var self = this;
    return msgs.filter(function (msg) {
      // 已消费的过滤
      if (msg.consumed) return false;
      // 过期的清理并移除标记
      if (msg.expiresAt && now > msg.expiresAt) {
        try {
          localStorage.removeItem(msg.storageKey);
        } catch (e) {}
        return false;
      }
      return true;
    });
  },

  /** 优先级排序 P0 > P1 > P2 */
  _prioritize: function (msgs) {
    var order = { P0: 0, P1: 1, P2: 2 };
    return msgs.sort(function (a, b) {
      var pa = order[a.priority] !== undefined ? order[a.priority] : 99;
      var pb = order[b.priority] !== undefined ? order[b.priority] : 99;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  },

  /**
   * ⭐ 日限守卫 — 每天最多推送1条消息
   * @param {Array} sortedMessages 已排序候选列表
   * @returns {{ pushed: Object|null, waiting: Array }}
   */
  _dailyGuard: function (sortedMessages) {
    var markerStr = localStorage.getItem('noti:daily_push_marker');
    var marker = null;
    try {
      marker = markerStr ? JSON.parse(markerStr) : null;
    } catch (e) {}
    var today = new Date().toISOString().slice(0, 10);

    // 今天已经推送过 → 全部降级为静候
    if (marker && marker.date === today) {
      this._candidates = sortedMessages;
      return { pushed: null, waiting: sortedMessages };
    }

    // 今天还没推送 → 取第一名
    var pushed = sortedMessages.length > 0 ? sortedMessages[0] : null;
    var waiting = sortedMessages.slice(1);

    if (pushed) {
      localStorage.setItem(
        'noti:daily_push_marker',
        JSON.stringify({
          date: today,
          pushedId: pushed.id,
          pushedAt: new Date().toISOString(),
        }),
      );
    }

    this._candidates = sortedMessages;
    return { pushed: pushed, waiting: waiting };
  },

  /**
   * 更新 Badge 数字（含静候消息的总数）
   * 不自动弹出弹窗！
   */
  _updateBadge: function (result) {
    var totalCount = (result.pushed ? 1 : 0) + (result.waiting ? result.waiting.length : 0);
    var badgeEl = document.getElementById('notiBadge');
    if (!badgeEl) return;

    if (totalCount <= 0) {
      badgeEl.style.display = 'none';
      badgeEl.textContent = '';
      badgeEl.classList.remove('bell-pulse');
    } else {
      badgeEl.style.display = 'inline-flex';
      badgeEl.textContent = totalCount > 9 ? '9+' : String(totalCount);
      badgeEl.classList.add('bell-pulse');
    }
  },

  // ── UI 渲染方法（由 App.showNotifications 调用） ──

  showNotifications: function () {
    var overlay = document.getElementById('notiOverlay');
    var body = document.getElementById('notiBody');
    var countEl = document.getElementById('notiCount');

    if (!overlay || !body) return;

    // 顶部对齐首页统计卡片，上限防止弹窗被推到底部
    var homeStats = document.querySelector('#page-home .home-stats');
    var notiTop = 80; // fallback
    if (homeStats) {
      var statsTop = Math.round(homeStats.getBoundingClientRect().top);
      notiTop = Math.max(16, statsTop);
    }
    // 保证弹窗至少有 340px 可用高度，且不超出视口
    notiTop = Math.max(16, Math.min(notiTop, window.innerHeight - 380));
    overlay.style.setProperty('--noti-top', notiTop + 'px');

    var hasCandidates = this._candidates && this._candidates.length > 0;
    console.log('[NotiEngine] showNotifications: candidates=' + (hasCandidates ? this._candidates.length : 0) + ' notiTop=' + notiTop);

    // 更新计数
    countEl.textContent = hasCandidates ? this._candidates.length : 0;

    // 渲染卡片或空状态
    var html = '';
    if (hasCandidates) {
      for (var i = 0; i < this._candidates.length; i++) {
        var msg = this._candidates[i];
        html +=
          '<div class="noti-card" data-id="' +
          msg.id +
          '">' +
          '<div class="noti-card-title">' +
          this._escapeHtml(msg.title) +
          '</div>' +
          '<div class="noti-card-body">' +
          this._formatBody(msg.body) +
          '</div>' +
          '<button class="noti-card-btn" onclick=\"App.consumeNoti(\'' +
          msg.id +
          "', '" +
          (msg.action || '') +
          '\')\">' +
          (msg.btnText || '\u77E5\u9053\u4E86') +
          '</button></div>';
      }
    } else {
      // 空状态：暂无新消息
      html =
        '<div class="noti-empty">' +
        '<div class="noti-empty-icon">🔔</div>' +
        '<div class="noti-empty-text">暂无新消息</div>' +
        '<div class="noti-empty-sub">有新消息时将在此显示</div>' +
        '</div>';
    }
    body.innerHTML = html;

    overlay.classList.add('active');
  },

  closeNotifications: function () {
    var overlay = document.getElementById('notiOverlay');
    if (overlay) overlay.classList.remove('active');
  },

  consumeNoti: function (msgId, action) {
    var idx = -1;
    for (var i = 0; i < this._candidates.length; i++) {
      if (this._candidates[i].id === msgId) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;

    var msg = this._candidates[idx];

    // 标记已读
    if (msg.storageKey) {
      if (msg.extraData) {
        localStorage.setItem(msg.storageKey, msg.extraData);
      } else {
        localStorage.setItem(msg.storageKey, '1');
      }
    }

    // 执行动作
    this._doAction(action);

    // 移除该条消息
    this._candidates.splice(idx, 1);
    msg.consumed = true;

    // 更新 UI
    this._refreshModal();
    this._updateBadge({ pushed: null, waiting: this._candidates });
  },

  markAllRead: function () {
    for (var i = 0; i < this._candidates.length; i++) {
      var msg = this._candidates[i];
      if (msg.storageKey) {
        if (msg.extraData) {
          localStorage.setItem(msg.storageKey, msg.extraData);
        } else {
          localStorage.setItem(msg.storageKey, '1');
        }
      }
    }
    this._candidates = [];
    this.closeNotifications();
    this._updateBadge({ pushed: null, waiting: [] });
  },

  _refreshModal: function () {
    var body = document.getElementById('notiBody');
    var countEl = document.getElementById('notiCount');
    if (!body) return;

    var hasCandidates = this._candidates && this._candidates.length > 0;

    countEl.textContent = hasCandidates ? this._candidates.length : 0;

    if (!hasCandidates) {
      body.innerHTML =
        '<div class="noti-empty">' +
        '<div class="noti-empty-icon">🔔</div>' +
        '<div class="noti-empty-text">暂无新消息</div>' +
        '<div class="noti-empty-sub">有新消息时将在此显示</div>' +
        '</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < this._candidates.length; i++) {
      var msg = this._candidates[i];
      html +=
        '<div class="noti-card" data-id="' +
        msg.id +
        '">' +
        '<div class="noti-card-title">' +
        this._escapeHtml(msg.title) +
        '</div>' +
        '<div class="noti-card-body">' +
        this._formatBody(msg.body) +
        '</div>' +
        '<button class="noti-card-btn" onclick=\"App.consumeNoti(\'' +
        msg.id +
        "', '" +
        (msg.action || '') +
        '\')\">' +
        (msg.btnText || '\u77E5\u9053\u4E86') +
        '</button></div>';
    }
    body.innerHTML = html;
  },

  _doAction: function (action) {
    switch (action) {
      case 'nav_plan':
        this.closeNotifications();
        if (typeof window.switchTab === 'function') window.switchTab('plan');
        break;
      case 'nav_income':
        this.closeNotifications();
        if (typeof window.switchTab === 'function') window.switchTab('income');
        break;
      case 'welcome_dismiss':
      case 'version_dismiss':
      default:
        break;
    }
  },

  _escapeHtml: function (s) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(s));
    return div.innerHTML;
  },

  _formatBody: function (text) {
    return text.replace(/\n/g, '<br>');
  },
};

/** 全局挂载点 — 被 index.html 中的 onclick 调用 */
window.App = window.App || {};
window.App.showNotifications = function () {
  NotiEngine.showNotifications();
};
window.App.closeNotifications = function () {
  NotiEngine.closeNotifications();
};
window.App.consumeNoti = function (id, action) {
  NotiEngine.consumeNoti(id, action);
};
window.App.markAllRead = function () {
  NotiEngine.markAllRead();
};

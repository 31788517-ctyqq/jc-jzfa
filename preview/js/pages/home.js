import { api } from '../api.js';
import { formatDate, setCache } from '../utils.js';

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

export function loadHome() {
  var initialMatchCountEl = document.getElementById('homeMatchCount');
  if (initialMatchCountEl && initialMatchCountEl.textContent === '-') initialMatchCountEl.textContent = '0';
  var rankP = api('ranking-list', {}).catch(function () {
    return {};
  });
  var matchP = api('match-list', {}).catch(function () {
    return [];
  });
  Promise.all([rankP, matchP]).then(function (r) {
    var rankData = r[0],
      matches = r[1];
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
      var bestTotal = best ? (best.totalExpertCount || best.expertCount || 0) : 0;
      var itemTotal = item.totalExpertCount || item.expertCount || 0;
      if (!best || itemTotal > bestTotal) return item;
      return best;
    }, null);
    var hmEl = document.getElementById('homeHottest');
    if (hmEl) hmEl.textContent = hottest ? (hottest.totalExpertCount || hottest.expertCount || 0) : '-';
    var hottestMetaEl = document.getElementById('homeHottestMeta');
    if (hottestMetaEl) {
      hottestMetaEl.textContent = hottest ? hottest.num || hottest.matchNum || hottest.matchId || '-' : '-';
    }
    window.__homeHottestTarget = resolveHottestTarget(hottest, matches);
  });

  // ── 近7日推荐盈利图表 ──
  loadHomeProfitChart();

  // ── 消息提醒引擎（仅首页加载时运行） ──
  NotiEngine.run();
}

// ═══ 近7日推荐盈利 SVG 折线图 ═══
function loadHomeProfitChart() {
  var skel = document.getElementById('profitSkeleton');
  if (skel) skel.style.display = 'block';
  api('daily-profit-7d', { days: 7 }).then(function (data) {
    if (!data || !data.dates || !data.profits || data.dates.length === 0) { hideSkel(); return; }
    var dates = data.dates.slice(0, 7),
      profits = data.profits.slice(0, 7).map(function (v) { return v === null ? 0 : v; });

    // ★ 至少保留 2 个点才能画线
    if (dates.length < 2) { hideSkel(); return; }

    var section = document.getElementById('homeProfitChartSection');
    if (section) section.style.display = 'block';
    hideSkel();
    renderProfitChartNative(dates, profits);
    var card = section && section.querySelector('.profit-card');
    if (card) { card.classList.remove('chart-anim-in'); void card.offsetWidth; card.classList.add('chart-anim-in'); }
  }).catch(function () { hideSkel(); });
  function hideSkel() { var s = document.getElementById('profitSkeleton'); if (s) s.style.display = 'none'; }
}

function renderProfitChartNative(dates, profits) {
  var n = profits.length;
  if (n === 0) return;

  var svgW = 320, svgH = 232;
  var padX = 10, chartW = svgW - padX * 2;

  // ── 1. Y 轴范围（非对称：正负按实际数据比例） ──
  var maxVal = Math.max.apply(null, profits.concat([0]));
  var minVal = Math.min.apply(null, profits.concat([0]));
  var posMax = maxVal > 0 ? Math.ceil(maxVal * 1.12 / 500) * 500 : 500;
  var negMax = minVal < 0 ? Math.ceil(Math.abs(minVal) * 1.12 / 500) * 500 : 0;
  var yMin = -negMax;
  var yMax = posMax;
  if (negMax === 0) yMin = 0;
  if (posMax === 0) yMax = 0;
  if (yMax === yMin) { yMax += 500; yMin -= 500; }
  function toY(v) { return svgH * (1 - (v - yMin) / (yMax - yMin)); }
  var baseY = toY(0);

  // ── 2. X 轴 ──
  var xs = [];
  for (var i = 0; i < n; i++) xs.push(padX + (chartW / Math.max(n - 1, 1)) * i);

  // ── 3. 分段折线 ──
  var segs = [], cur = null;
  function add(i) {
    var x = xs[i], y = toY(profits[i]), p = x.toFixed(1) + ',' + y.toFixed(1), up = profits[i] >= 0;
    if (!cur || cur.up !== up) {
      if (cur) { cur.lx = x; cur.ly = y; segs.push(cur); }
      cur = { up: up, path: 'M' + p, pts: [[x, y]], lx: x, ly: y };
    } else {
      var px = cur.pts[cur.pts.length - 1][0], py = cur.pts[cur.pts.length - 1][1], d = (x - px) / 3;
      cur.path += ' C' + (px + d).toFixed(1) + ',' + py.toFixed(1) + ' '
        + (x - d).toFixed(1) + ',' + y.toFixed(1) + ' ' + p;
      cur.pts.push([x, y]); cur.lx = x; cur.ly = y;
    }
  }
  for (var i = 0; i < n; i++) add(i);
  if (cur) segs.push(cur);

  // ── 4. 构建 SVG ──
  var defsEl = document.getElementById('profitDefs');
  var pathsEl = document.getElementById('profitPaths');
  if (defsEl) {
    defsEl.innerHTML =
      '<linearGradient id="profitG" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0%" stop-color="#ff6464" stop-opacity=".25"/>'
      + '<stop offset="100%" stop-color="#ff6464" stop-opacity="0"/>'
      + '</linearGradient>'
      + '<linearGradient id="lossG" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0%" stop-color="#29c782" stop-opacity=".2"/>'
      + '<stop offset="100%" stop-color="#29c782" stop-opacity="0"/>'
      + '</linearGradient>';
  }
    if (pathsEl) {
    var pathHtml = '';
    // 零线
    pathHtml += '<line x1="0" y1="' + baseY.toFixed(1) + '" x2="' + svgW + '" y2="' + baseY.toFixed(1)
      + '" stroke="#dce2e5" stroke-width="1" stroke-dasharray="4,3"/>';

    // ★ 构建一条连续路径（贯穿所有点，用于描边连线）
    var continuousPath = 'M' + xs[0].toFixed(1) + ',' + toY(profits[0]).toFixed(1);
    for (var ci = 1; ci < n; ci++) {
      var px = xs[ci - 1], py = toY(profits[ci - 1]);
      var cx_ = xs[ci], cy_ = toY(profits[ci]);
      var d_ = (cx_ - px) / 3;
      continuousPath += ' C' + (px + d_).toFixed(1) + ',' + py.toFixed(1) + ' '
        + (cx_ - d_).toFixed(1) + ',' + cy_.toFixed(1) + ' '
        + cx_.toFixed(1) + ',' + cy_.toFixed(1);
    }

    // ★ 连续描边线（全量连接所有红绿点）— 浅色不抢数字注意力
    pathHtml += '<path class="profit-stroke" fill="none" stroke="#c0cad6" stroke-width="1.8"'
      + ' stroke-linecap="round" stroke-linejoin="round" d="' + continuousPath + '"/>';

    // 分段填充区域（按正负着色）
    segs.forEach(function (s) {
      var grad = s.up ? 'url(#profitG)' : 'url(#lossG)';
      var fillD = s.path + ' L' + s.lx.toFixed(1) + ',' + baseY.toFixed(1)
        + ' L' + s.pts[0][0].toFixed(1) + ',' + baseY.toFixed(1) + ' Z';
      pathHtml += '<path class="profit-area" fill="' + grad + '" d="' + fillD + '"/>';
    });
    // 数据点空心圆
    for (var i = 0; i < n; i++) {
      var cx = xs[i].toFixed(1), cy = toY(profits[i]).toFixed(1);
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
      setTimeout(function () { ap.style.transition = 'opacity 0.7s ease'; ap.style.opacity = '1'; }, 2300);
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
    var runDir = 0, runCnt = 0;
    for (var k = 0; k < tagIdx.length; k++) {
      var i = tagIdx[k];
      var dir = profits[i] >= 0 ? 1 : -1;
      if (dir !== runDir) { runDir = dir; runCnt = 0; }
      yOffs[i] = dir > 0 ? -(24 + (runCnt % 3) * 16) : 28 + (runCnt % 3) * 16;
      runCnt++;
    }
    var tHtml = '';
    for (var k = 0; k < tagIdx.length; k++) {
      var i = tagIdx[k];
      var vy = toY(profits[i]), vx = xs[i];
      var xP = ((vx / svgW) * 100).toFixed(2);
      var yOff = yOffs[i];
      // 边界感知：标签靠近上下边界时反转偏移方向
      var rawTop = ((vy + yOff) / svgH) * 100;
      if (rawTop < 4) { yOff = Math.abs(yOff); }
      else if (rawTop > 92) { yOff = -Math.abs(yOff); }
      var yP = (((vy + yOff) / svgH) * 100);
      yP = Math.max(3, Math.min(94, yP)).toFixed(2);
      var c = profits[i] >= 0 ? 'win' : 'loss';
      tHtml += '<div class="profit-tag ' + c + '" style="left:' + xP + '%;top:' + yP + '%">'
        + (profits[i] >= 0 ? '+' : '') + profits[i].toFixed(0) + '</div>';
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
  var total = 0, maxV = -Infinity, maxI = -1;
  for (var i = 0; i < n; i++) { total += profits[i]; if (profits[i] > maxV) { maxV = profits[i]; maxI = i; } }
  function fmt(n) { return (n >= 0 ? '+' : '') + n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  var tc = total >= 0 ? 'positive' : 'negative';

  function set(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
  function setClass(id, cls) { var e = document.getElementById(id); if (e) e.className = cls; }
  set('statsTotal', fmt(total));
  setClass('statsTotal', total >= 0 ? 'positive' : 'negative');

  var growth = null;
  if (profits[0] !== 0 && isFinite(total / Math.abs(profits[0]))) {
    growth = total / Math.abs(profits[0]) * 100;
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
    this._collect().then(
      function (msgs) {
        var filtered = NotiEngine._dedupeAndExpire(msgs);
        var sorted = NotiEngine._prioritize(filtered);
        var result = NotiEngine._dailyGuard(sorted);
        NotiEngine._updateBadge(result);
      }.bind(this)
    ).catch(function () {});
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
    return api('daily-profit-7d', { days: 7 }).then(function (data) {
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
    }).catch(function () {
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
      title: '\u{1F389} \u6B22\u8FCE\u4F7F\u7528\u7ADEE5F69\u63A8\u8350\u76D1\u63A7\u7CFB\u7EDF\uFF01',
      body: '\u8FD9\u91CC\u662F\u60A8\u7684\u667A\u80FD\u65B9\u6848\u51B3\u7B56\u52A9\u624B\uFF1A\n' +
            '\n' +
            '\u{1F4CA} \u4E13\u5BB6\u535A\u70ED\u65B9\u6848 \u2014 \uFFFD\uFFFD\uFFFD\u8D44\u6DF1\u4E13\u5BB6\u7684\u70ED\u95E8\u63A8\u8350\u65B9\u5411\uFF1B\n' +
            'AI\u6DF1\u5EA6\u5206\u6790-\u53CCAI\u6A21\u578B\u878D\u5408\uFF0C\u4E94\u7EF4\u5206\u6790\u9884\u6D4B\uFF1B\n' +
            '\u2694\uFE0F \u529F\u5B88\u9053\u5206\u6790 \u2014 \u653B\u5B88\u6570\u636E\u5EFA\u6A21\uFF0C\u9884\u5224\u6BD4\u8D5B\u8D70\u52BF\uFF1B\n' +
            '\u{1F504} \u591A\u6A21\u578B\u7ADE\u4E89 \u2014 \u6A21\u578bPK\u7ADE\u4E89\uFF0C\u63D0\u9AD8\u547D\u4E2D\u7387\uFF1B\n' +
            '\n' +
            '\u5F00\u59CB\u63A2\u7D22\u5427\uFF0C\u795D\u60A8\u76C8\u5229\u957F\u7EA2 \u{1F340}',
      btnText: '\u77E5\u9053\u4E86',
      action: 'welcome_dismiss',
      storageKey: 'noti:welcome_seen',
      expiresAt: null,
      createdAt: new Date().toISOString()
    };
  },

  /** 构建连红消息 */
  _buildStreak: function (data) {
    var lines = data.days.map(function (d) {
      return '\u2022 ' + d.date + ' \u65E5\u76C8\u5229 +' + d.profit.toFixed(0) + ' \u5143 \u2705';
    }).join('\n');

    return {
      id: 'streak_' + data.startDate,
      type: 'streak',
      priority: 'P1',
      title: '\u{1F525} \u4E13\u5BB6\u535A\u70ED 5 \u8FDE\u7EA2\uFF01',
      body: '\u4E13\u5BB6\u535A\u70ED\u65B9\u6848\u8FDE\u7EED 5 \u5929\u76C8\u5229\u4E3A\u6B63\uFF0C\u72B6\u6001\u6781\u4F73\uFF1A\n' + lines +
            '\n\u2022 5\u65E5\u7D2F\u8BA1 +' + data.total.toFixed(0) + ' \u5143 \u{1F3AF}\n\n' +
            '\u8FDE\u7EA2\u52BF\u5934\u5F3A\u52B2\uFF0C\u67E5\u770B\u4ECA\u65E5\u65B9\u6848\u8DD1\u4E0A\u8282\u594F \u2192',
      btnText: '\u67E5\u770B',
      action: 'nav_plan',
      storageKey: 'noti:streak_' + data.startDate,
      expiresAt: Date.now() + 3 * 24 * 3600000,
      createdAt: new Date().toISOString()
    };
  },

  /** 构建盈利突破消息 */
  _buildProfitBreakthrough: function (data) {
    var total = data.total || 0;
    var maxDayProfit = 0, maxDate = '';
    var winDays = 0;
    if (data.profits && Array.isArray(data.profits)) {
      for (var i = 0; i < data.profits.length; i++) {
        if (data.profits[i] > maxDayProfit) {
          maxDayProfit = data.profits[i];
          maxDate = data.dates ? (data.dates[i] || '') : '';
        }
        if ((data.profits[i] || 0) > 0) winDays++;
      }
    }
    var yieldRate = total > 0 ? ((total / 7000) * 100).toFixed(1) : '0';

    return {
      id: 'profit_' + new Date().toISOString().slice(0, 10),
      type: 'profit',
      priority: 'P1',
      title: '\u{1F4B0} \u4E13\u5BB6\u65B9\u6848\u76C8\u5229\u7A81\u7834\uFF01',
      body: '\u8FD1 7 \u65E5\u4E13\u5BB6\u535A\u70ED\u65B9\u6848\u603B\u76C8\u5229 +' + total.toFixed(0) + ' \u5143 \u{1F3AF}\n' +
            '\u2022 \u6700\u9AD8\u5355\u65E5 +' + maxDayProfit.toFixed(0) + ' \u5143\uFF08' + maxDate + '\uFF09\n' +
            '\u2022 \u76C8\u5229\u5929\u6570 ' + winDays + '/7 \u5929\n' +
            '\u2022 \u7D2F\u8BA1\u6536\u76CA\u7387 ' + yieldRate + '%\n\n' +
            '\u7A33\u5B9A\u76C8\u5229\u4E2D\uFF0C\u4FDD\u6301\u8DDF\u8FDB \u2192',
      btnText: '\u67E5\u770B',
      action: 'nav_income',
      storageKey: 'noti:profit_' + new Date().toISOString().slice(0, 10),
      expiresAt: Date.now() + 24 * 3600000,
      createdAt: new Date().toISOString()
    };
  },

  /** 构建版本更新消息 */
  _buildVersionUpdate: function () {
    return {
      id: 'ver_' + APP_VERSION,
      type: 'version',
      priority: 'P2',
      title: '\u{1F195} \u7CFB\u7EDF\u66F4\u65B0 V' + APP_VERSION,
      body: '\u672C\u6B21\u66F4\u65B0\u5185\u5BB9\uFF1A\n' +
            '\u2728 \u65B0\u589E\u6D88\u606F\u63D0\u9192\u4E2D\u5FC3\uFF0C\u652F\u6301\u591A\u7C7B\u6D88\u606F\u81EA\u52A8\u6536\u96C6\u4E0E\u4F18\u5148\u7EA7\u6392\u5E8F\n' +
            '\u{1F4CA} \u6BCF\u5929\u6700\u591A\u63A8\u90011\u6761\u6D88\u606F\uFF0C\u4E25\u683C\u9075\u5FAA\u201C\u4E0D\u6253\u6270\u201D\u539F\u5219\n' +
            '\u{1FAE7} \u4F18\u5316\u7528\u6237\u4F53\u9A8C\uFF0CBadge+\u5F39\u7A97\u5206\u79BB\u5C55\u793A\n\n' +
            '\u66F4\u591A\u7EC6\u8282\u8BF7\u7EE7\u7EED\u63A2\u7D22\u65B0\u529F\u80FD \u2192',
      btnText: '\u77E5\u9053\u4E86',
      action: 'version_dismiss',
      storageKey: 'noti:version_seen',
      expiresAt: Date.now() + 7 * 24 * 3600000,
      createdAt: new Date().toISOString(),
      extraData: APP_VERSION
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
        try { localStorage.removeItem(msg.storageKey); } catch(e) {}
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
    try { marker = markerStr ? JSON.parse(markerStr) : null; } catch(e) {}
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
      localStorage.setItem('noti:daily_push_marker', JSON.stringify({
        date: today,
        pushedId: pushed.id,
        pushedAt: new Date().toISOString()
      }));
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
    if (!this._candidates || this._candidates.length === 0) return;

    var overlay = document.getElementById('notiOverlay');
    var body = document.getElementById('notiBody');
    var countEl = document.getElementById('notiCount');

    if (!overlay || !body) return;

    // 顶部对齐首页三个统计卡片：按实际 DOM 位置动态计算，避免不同屏幕高度偏移
    var homeStats = document.querySelector('#page-home .home-stats');
    if (homeStats) {
      var statsTop = Math.round(homeStats.getBoundingClientRect().top);
      overlay.style.setProperty('--noti-top', Math.max(16, statsTop) + 'px');
    }

    // 更新计数
    countEl.textContent = this._candidates.length;

    // 渲染卡片
    var html = '';
    for (var i = 0; i < this._candidates.length; i++) {
      var msg = this._candidates[i];
      html += '<div class="noti-card" data-id="' + msg.id + '">' +
        '<div class="noti-card-title">' + this._escapeHtml(msg.title) + '</div>' +
        '<div class="noti-card-body">' + this._formatBody(msg.body) + '</div>' +
        '<button class="noti-card-btn" onclick=\"App.consumeNoti(\'' + msg.id + '\', \'' + (msg.action || '') + '\')\">' +
        (msg.btnText || '\u77E5\u9053\u4E86') + '</button></div>';
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
      if (this._candidates[i].id === msgId) { idx = i; break; }
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

    countEl.textContent = this._candidates.length;

    if (this._candidates.length === 0) {
      this.closeNotifications();
      return;
    }

    var html = '';
    for (var i = 0; i < this._candidates.length; i++) {
      var msg = this._candidates[i];
      html += '<div class="noti-card" data-id="' + msg.id + '">' +
        '<div class="noti-card-title">' + this._escapeHtml(msg.title) + '</div>' +
        '<div class="noti-card-body">' + this._formatBody(msg.body) + '</div>' +
        '<button class="noti-card-btn" onclick=\"App.consumeNoti(\'' + msg.id + '\', \'' + (msg.action || '') + '\')\">' +
        (msg.btnText || '\u77E5\u9053\u4E86') + '</button></div>';
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
  }
};

/** 全局挂载点 — 被 index.html 中的 onclick 调用 */
window.App = window.App || {};
window.App.showNotifications = function () { NotiEngine.showNotifications(); };
window.App.closeNotifications = function () { NotiEngine.closeNotifications(); };
window.App.consumeNoti = function (id, action) { NotiEngine.consumeNoti(id, action); };
window.App.markAllRead = function () { NotiEngine.markAllRead(); };

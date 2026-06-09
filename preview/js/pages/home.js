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
}

// ═══ 近7日推荐盈利 SVG 折线图 ═══
function loadHomeProfitChart() {
  api('daily-profit-7d', { days: 7 }).then(function (data) {
    if (!data || !data.dates || !data.profits || data.dates.length === 0) return;
    var dates = data.dates.slice(0, 7),
      profits = data.profits.slice(0, 7).map(function (v) { return v === null ? 0 : v; });
    // ★ 补齐到 7 天：不足 7 天时在前方补空
    while (dates.length < 7) { dates.unshift('--'); profits.unshift(0); }
    var section = document.getElementById('homeProfitChartSection');
    if (section) section.style.display = 'block';
    renderProfitChartNative(dates, profits);
  }).catch(function () {});
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
    // 填充 + 描边
    segs.forEach(function (s) {
      var grad = s.up ? 'url(#profitG)' : 'url(#lossG)';
      var stk = s.up ? '#ff5858' : '#22c878';
      var fillD = s.path + ' L' + s.lx.toFixed(1) + ',' + baseY.toFixed(1)
        + ' L' + s.pts[0][0].toFixed(1) + ',' + baseY.toFixed(1) + ' Z';
      pathHtml += '<path fill="' + grad + '" d="' + fillD + '"/>'
        + '<path fill="none" stroke="' + stk + '" stroke-width="2.5"'
        + ' stroke-linecap="round" stroke-linejoin="round" d="' + s.path + '"/>';
    });
    // 数据点空心圆
    for (var i = 0; i < n; i++) {
      var cx = xs[i].toFixed(1), cy = toY(profits[i]).toFixed(1);
      var cs = profits[i] >= 0 ? '#ff5858' : '#22c878';
      pathHtml += '<circle cx="' + cx + '" cy="' + cy + '" r="4.5" fill="#fff" stroke="' + cs + '" stroke-width="2"/>';
    }
    pathsEl.innerHTML = pathHtml;
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

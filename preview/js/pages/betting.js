/**
 * 投注弹窗 v7 — 方案设计页风格 + 功守道弹窗头 + 玩法上下文 + 赔率箭头 + 规则提示
 * 字号参考: sodds-btn(11px/16px) | 线条: 1px | 卡片: 白底透明边框(去蓝色遮罩)
 */
import { api } from '../api.js';

let _currentMatch = null, _selectedBets = [], _oddsData = {};
let _activePlayType = 'mixed'; // ★ 玩法上下文
var _topDirections = []; // ★ 推荐排行榜 Top5 方向

var ALL_SCORES = (function () {
  var home = ['1:0','2:0','2:1','3:0','3:1','3:2','4:0','4:1','4:2','5:0','5:1','5:2','胜其它'];
  var draw = ['0:0','1:1','2:2','3:3','平其它'];
  var away = ['0:1','0:2','1:2','0:3','1:3','2:3','0:4','1:4','2:4','0:5','1:5','2:5','负其它'];
  return home.concat(draw, away);
})();
var FIXED_JQS = ['0','1','2','3','4','5','6','7+'];
var FIXED_BQC = ['胜胜','胜平','胜负','平胜','平平','平负','负胜','负平','负负'];
// ★ 竞彩规则：木桶原则上限
var PLAY_LIMITS = { spf: 8, rqspf: 8, jqs: 6, bf: 4, bqc: 4 };
var PLAY_NAMES = { spf: '胜平负', rqspf: '让球胜平负', bf: '比分', jqs: '总进球', bqc: '半全场' };

export function openBetting(matchId, matchData, activePlayType) {
  if (!matchId || !matchData) return;
  _currentMatch = matchData; _selectedBets = []; _oddsData = {};
  _activePlayType = activePlayType || 'mixed'; // ★ 接收玩法上下文

  // ★ 始终销毁旧 overlay 重建，避免复用脏状态
  var oldOverlay = document.getElementById('betOverlay');
  if (oldOverlay) oldOverlay.remove();

  var overlay = document.createElement('div');
  overlay.id = 'betOverlay';
  overlay.className = 'ai-overlay';
  overlay.onclick = function (e) {
    if (e.target === overlay) { closeBetting(); }
  };
  document.body.appendChild(overlay);

  overlay.innerHTML = '<div class="ai-modal" style="display:flex;align-items:center;justify-content:center;min-height:200px;">' +
    '<div style="text-align:center;color:#aabbcc;padding:60px 0;">' +
    '<div class="loading-spinner" style="margin:0 auto 16px;"></div>加载中...</div></div>';
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  loadOddsData(matchId).then(function () {
    return loadTopDirections(matchId);
  }).then(function () { render(); applyDirectionHighlights(); });
}

export function closeBetting() {
  var o = document.getElementById('betOverlay');
  if (o) {
    o.classList.remove('active');
    o.innerHTML = '';  // ★ 清理 DOM，避免残留内容
  }
  document.body.style.overflow = '';
  _currentMatch = null; _selectedBets = []; _oddsData = {}; _topDirections = [];

  // ★ 清理 betting-confirm 监听器（scheme-design.js 注册的）
  if (window._bettingConfirmHandler) {
    window.removeEventListener('betting-confirm', window._bettingConfirmHandler);
    window._bettingConfirmHandler = null;
  }
}
window._betClose = closeBetting;

async function loadOddsData(matchId) {
  try {
    var r = await api('match-odds', { matchId: matchId });
    if (r && r.spf) {
      _oddsData = r;
      // ★ 确定本场的让球数（优先 batch-match-odds 已缓存数据）
      var targetHcp = null;
      if (_currentMatch && _currentMatch._odds && _currentMatch._odds.handicap != null) {
        targetHcp = Number(_currentMatch._odds.handicap);
      } else if (_currentMatch && _currentMatch.concede != null) {
        targetHcp = Number(_currentMatch.concede);
      }
      if (targetHcp === null) targetHcp = 0;

      // 从 match-odds 返回的 rqspfList 中找到匹配让球数的条目
      var matchedRq = null;
      if (r.rqspfList && Array.isArray(r.rqspfList) && r.rqspfList.length > 0) {
        for (var i = 0; i < r.rqspfList.length; i++) {
          if (Number(r.rqspfList[i].handicap) === targetHcp) { matchedRq = r.rqspfList[i]; break; }
        }
        // ★ 未匹配到精确让球数时，用 rqspfList 第一条的赔率，但让球数用 targetHcp
        if (!matchedRq) {
          matchedRq = Object.assign({}, r.rqspfList[0], { handicap: targetHcp });
        }
        _oddsData.rqspf = { home: matchedRq.home, draw: matchedRq.draw, away: matchedRq.away };
        _oddsData.handicap = Number(matchedRq.handicap);
      }
      // ★ 兜底：始终确保 handicap 有值
      if (_oddsData.handicap == null) {
        _oddsData.handicap = targetHcp;
      }
      // ★ 获取赔率变动趋势
      try {
        var batchRes = await api('batch-match-odds', { matchIds: [matchId] });
        var batchData = batchRes && batchRes[matchId];
        if (batchData && batchData.oddsDelta) {
          _oddsData.oddsDelta = batchData.oddsDelta;
          // ★ 同时存储按玩法分组的 Delta
          _oddsData.spfDelta = batchData.spfDelta || {};
          _oddsData.rqspfDelta = batchData.rqspfDelta || {};
          _oddsData.bfDelta = batchData.bfDelta || {};
          _oddsData.jqsDelta = batchData.jqsDelta || {};
          _oddsData.bqcDelta = batchData.bqcDelta || {};
          // ★ 走势信号
          _oddsData.deltaTrend = batchData.deltaTrend || {};
        }
      } catch (e) { /* 非关键 */ }
    } else { _oddsData = {}; }
  } catch (e) { console.warn(e); _oddsData = {}; }
}

/* ═══ 推荐排行榜 Top5 方向 ═══ */
async function loadTopDirections(matchId) {
  try {
    var r = await api('match-top-directions', { matchId: matchId });
    if (r && r.directions) {
      _topDirections = r.directions;
    } else {
      _topDirections = [];
    }
  } catch (e) {
    _topDirections = [];
  }
}

/**
 * 将推荐方向字符串解析为赔率卡片列表
 * 如: "平、让平" → [{playType:"spf", label:"平"}, {playType:"rqspf", label:"让平"}]
 * 如: "总进球-2、3球" → [{playType:"jqs", label:"2"}, {playType:"jqs", label:"3"}]
 */
function parseDirectionCards(dir) {
  if (!dir) return [];
  var s = String(dir).trim();
  var results = [];

  // 1) 总进球方向: "总进球-2、3球" / "总进球-3"
  if (s.indexOf('总进球') === 0) {
    var after = s.replace(/^总进球-/, '');
    var goals = after.split(/[、,]/);
    goals.forEach(function (g) {
      var clean = g.trim().replace('球', '');
      if (clean) results.push({ playType: 'jqs', label: clean });
    });
    return results;
  }

  // 2) 半全场方向: "半全场-胜胜、平胜"
  if (s.indexOf('半全场') === 0) {
    var after = s.replace(/^半全场-/, '');
    var halves = after.split(/[、,]/);
    halves.forEach(function (h) {
      var clean = h.trim();
      if (clean) results.push({ playType: 'bqc', label: clean });
    });
    return results;
  }

  // 3) 比分方向: "比分-1:0" / "比分-2:1、3:1"
  if (s.indexOf('比分') === 0) {
    var after = s.replace(/^比分-/, '');
    var scores = after.split(/[、,]/);
    scores.forEach(function (sc) {
      var clean = sc.trim();
      if (clean) results.push({ playType: 'bf', label: clean });
    });
    return results;
  }

  // 4) 胜平负 / 让球方向（含双选）
  var parts = s.split(/[、,]/);
  parts.forEach(function (p) {
    var clean = p.trim();
    if (clean === '让胜' || clean === '让平' || clean === '让负') {
      results.push({ playType: 'rqspf', label: clean });
    } else if (clean === '平' || clean === '胜' || clean === '负') {
      results.push({ playType: 'spf', label: clean });
    }
  });

  return results;
}

/** 构建方向→排名映射，O(1) 查找 */
function buildRankMap() {
  var map = {};
  _topDirections.forEach(function (item) {
    var cards = parseDirectionCards(item.direction);
    cards.forEach(function (card) {
      var key = card.playType + '|' + card.label;
      if (map[key] == null || item.rank < map[key]) {
        map[key] = item.rank;
      }
    });
  });
  return map;
}

/** 给对应卡片添加黄色底色 + 排名数字 badge */
function applyDirectionHighlights() {
  var overlay = document.getElementById('betOverlay');
  if (!overlay) return;
  var rankMap = buildRankMap();
  if (Object.keys(rankMap).length === 0) return;

  var allCards = overlay.querySelectorAll('.bet-cell, .bet-score-item, .bet-goal-item');
  allCards.forEach(function (card) {
    var cardKey = getCardKey(card);
    if (!cardKey) return;

    var rank = rankMap[cardKey];
    if (rank != null) {
      card.classList.add('rank-highlight');

      // 添加排名数字 badge
      var badge = document.createElement('span');
      badge.className = 'rank-badge-num';
      badge.textContent = rank;
      card.appendChild(badge);
    }
  });
}

/** 从 DOM 节点读取 data-* 属性获取 playType|label key */
function getCardKey(card) {
  var pt = card.getAttribute('data-play-type');
  var lb = card.getAttribute('data-label');
  if (pt && lb) return pt + '|' + lb;
  return null;
}

/* ═══ 全量渲染 ═══ */
function render() {
  var overlay = document.getElementById('betOverlay');
  if (!overlay || !_currentMatch) return;

  var m = _currentMatch;

  // ★ 玩法上下文提示标题
  var playTitle = _activePlayType !== 'mixed' ? '竞彩·' + (PLAY_NAMES[_activePlayType] || '混合过关') : '竞彩·混合过关';

  // ★ 玩法提示（对齐群彩：跨场可混合不同玩法，同场自动替换）
  var playHint = '';
  if (_activePlayType !== 'mixed') {
    var limit = PLAY_LIMITS[_activePlayType] || 8;
    playHint = '<div class="bet-play-hint">当前玩法：<b>' + PLAY_NAMES[_activePlayType] +
      '</b>（上限 ' + limit + ' 场） | 同场比赛仅保留一种玩法</div>';
  } else {
    playHint = '<div class="bet-play-hint">⚽ 支持跨场混合不同玩法 | 同场比赛点击新玩法自动替换 | 比分/半全场上限4场，总进球上限6场，SPF上限8场</div>';
  }

  overlay.innerHTML =
  '<div class="ai-modal" onclick="event.stopPropagation()">' +
    '<div class="bet-popup">' +

      /* ─── 弹窗头 ─── */
      '<div class="bet-popup-header">' +
        '<span class="bet-popup-title">' + escHtml(playTitle) + '</span>' +
        '<button class="bet-popup-close" onclick="_betClose()">&times;</button>' +
      '</div>' +

      /* ─── 赛事信息 (功守道风格) ─── */
      renderMatchSection(m) +

      /* ─── 规则提示 ─── */
      playHint +

      /* ─── 胜平负 / 让球胜平负 ─── */
      '<div class="bet-play-section' + (_activePlayType !== 'mixed' ? ' bet-play-section-dim' : '') + '">' +
        '<div class="bet-play-section-title">胜平负 / 让球胜平负</div>' +
        renderSPFGrid() +
        renderTrendRow() +
      '</div>' +

      /* ─── 比分 ─── */
      '<div class="bet-play-section' + (_activePlayType !== 'mixed' && _activePlayType !== 'bf' ? ' bet-play-section-dim' : '') + '">' +
        '<div class="bet-play-section-title">比分</div>' +
        renderScoreGrid() +
      '</div>' +

      /* ─── 总进球 ─── */
      '<div class="bet-play-section' + (_activePlayType !== 'mixed' && _activePlayType !== 'jqs' ? ' bet-play-section-dim' : '') + '">' +
        '<div class="bet-play-section-title">总进球</div>' +
        renderGoalGrid() +
      '</div>' +

      /* ─── 半全场 ─── */
      '<div class="bet-play-section' + (_activePlayType !== 'mixed' && _activePlayType !== 'bqc' ? ' bet-play-section-dim' : '') + '">' +
        '<div class="bet-play-section-title">半全场</div>' +
        renderHalfGrid() +
      '</div>' +

      /* ─── 底部按钮 ─── */
      '<div class="bet-footer">' +
        '<button class="bet-btn-cancel" onclick="_betClose()">取消</button>' +
        '<button class="bet-btn-confirm" id="betConfirmBtn"' + (_selectedBets.length === 0 ? ' disabled' : '') +
          ' onclick="_betConfirm()">确定</button>' +
      '</div>' +

    '</div>' +
  '</div>';
}

/* ─── 走势信号迷你行 ─── */
function renderTrendRow() {
  var trend = (_oddsData && _oddsData.deltaTrend) || {};
  var spfTrend = trend.spfTrend || '';
  var rqspfTrend = trend.rqspfTrend || '';

  if (!spfTrend && !rqspfTrend) return '';

  var html = '<div class="bet-trend-row">';
  if (spfTrend) {
    html += '<span class="bet-trend-label">SPF走势</span>';
    html += '<span class="bet-trend-chars">' + escHtml(spfTrend) + '</span>';
  }
  if (rqspfTrend) {
    html += '<span class="bet-trend-label">让球走势</span>';
    html += '<span class="bet-trend-chars">' + escHtml(rqspfTrend) + '</span>';
  }
  html += '</div>';
  return html;
}

/* ─── 赛事信息 — 功守道 gs-modal-head 风格 ─── */
function renderMatchSection(m) {
  var timeStr = formatTimeString(m.startTime);
  var num = m.num || '';
  var league = m.leagueName || '';

  var dateStr = '', clockStr = '';
  if (timeStr) {
    var parts = timeStr.split(' ');
    dateStr = parts[0] || '';
    clockStr = parts[1] || '';
  }

  var homeRank = m.homeRank != null ? '[' + m.homeRank + ']' : '';
  var awayRank = m.awayRank != null ? '[' + m.awayRank + ']' : '';

  return '<div class="bet-match-section">' +
    '<div class="bet-match-row">' +
      '<span class="bet-league-name">' + escHtml(league) + '</span>' +
      '<span class="bet-match-num">' + escHtml(num) + '</span>' +
    '</div>' +
    '<div class="bet-teams">' +
      (homeRank ? '<span class="bet-rank">[' + homeRank + ']</span>' : '') +
      escHtml(m.homeName || '') +
      ' vs ' +
      escHtml(m.visitName || '') +
      (awayRank ? '<span class="bet-rank">[' + awayRank + ']</span>' : '') +
    '</div>' +
    (timeStr ? '<div class="bet-match-time-text">' + escHtml(dateStr) + ' ' + escHtml(clockStr) + ' 截止</div>' : '') +
  '</div>';
}

/* ─── SPF + RQSPF 合并 ─── */
function renderSPFGrid() {
  var spf = (_oddsData && _oddsData.spf) || {};
  var rq = (_oddsData && _oddsData.rqspf) || {};
  // ★ 让球数优先级：_oddsData.handicap > _currentMatch._odds.handicap > _currentMatch.concede > 0
  var hcp = (_oddsData && _oddsData.handicap != null) ? Number(_oddsData.handicap)
    : ((_currentMatch && _currentMatch._odds && _currentMatch._odds.handicap != null) ? Number(_currentMatch._odds.handicap)
    : ((_currentMatch && _currentMatch.concede != null) ? Number(_currentMatch.concede) : 0));
  var delta = (_oddsData && _oddsData.oddsDelta) || {};

  var html = '<div class="bet-spf-grid">';

  // 行 1: [0] 胜 平 负
  html += '<div class="bet-cell handicap">0</div>';
  html += renderSPFCell('胜', spf.home, 'spf', null, false, delta['spf.home']);
  html += renderSPFCell('平', spf.draw, 'spf', null, false, delta['spf.draw']);
  html += renderSPFCell('负', spf.away, 'spf', null, true, delta['spf.away']);

  // 行 2: [handicap] 让胜 让平 让负
  var hcpLabel = formatHandicapLabel(hcp);
  html += '<div class="bet-cell handicap rq">' + hcpLabel + '</div>';
  html += renderSPFCell('让胜', rq.home, 'rqspf', hcp, false, delta['rqspf.home']);
  html += renderSPFCell('让平', rq.draw, 'rqspf', hcp, false, delta['rqspf.draw']);
  html += renderSPFCell('让负', rq.away, 'rqspf', hcp, true, delta['rqspf.away']);

  html += '</div>';
  return html;
}

function renderSPFCell(label, odds, playType, handicap, isLose, deltaDir) {
  var oddsVal = odds != null ? Number(odds) : null;
  var oddsStr = oddsVal != null ? oddsVal.toFixed(2) : '-';
  var noOdd = oddsVal == null;
  var sel = hasSelection(playType, label, handicap);

  // ★ 赔率变动箭头
  var arrowHtml = '';
  if (deltaDir === 'up') {
    arrowHtml = '<span class="bet-arrow-up">&#9650;</span>';
  } else if (deltaDir === 'down') {
    arrowHtml = '<span class="bet-arrow-down">&#9660;</span>';
  }

  var cls = 'bet-cell';
  if (isLose) cls += ' lose';
  if (sel) cls += ' selected';
  if (noOdd) cls += ' no-odds';

  return '<div class="' + cls + '"' +
    ' data-play-type="' + playType + '" data-label="' + escAttr(label) + '"' +
    (noOdd ? '' : ' onclick="_betSelect(\'' + playType + '\',\'' + escAttr(label) + '\',' + oddsVal + ',' + (handicap != null ? handicap : 'null') + ')"') +
    '>' +
    '<span class="bet-name">' + escHtml(label) + '</span>' +
    '<span class="bet-odds">' + escHtml(oddsStr) + arrowHtml + '</span>' +
  '</div>';
}

/* ─── 比分 7列 ─── */
function renderScoreGrid() {
  var bf = (_oddsData && _oddsData.bf) || [];
  var map = {}; bf.forEach(function (s) { map[s.score] = s.odds; });
  var bfDelta = (_oddsData && _oddsData.bfDelta) || {};

  var html = '<div class="bet-score-grid">';
  ALL_SCORES.forEach(function (score) {
    var v = map[score];
    var oddsVal = v != null ? Number(v) : null;
    var oddsStr = oddsVal != null ? oddsVal.toFixed(2) : '-';
    var noOdd = oddsVal == null;
    var sel = hasSelection('bf', score, null);
    var deltaDir = bfDelta[score] || null;

    // ★ 赔率变动箭头
    var arrowHtml = '';
    if (deltaDir === 'up') {
      arrowHtml = '<span class="bet-arrow-up">&#9650;</span>';
    } else if (deltaDir === 'down') {
      arrowHtml = '<span class="bet-arrow-down">&#9660;</span>';
    }

    var cls = 'bet-score-item';
    if (sel) cls += ' selected';
    if (noOdd) cls += ' no-odds';

    html += '<div class="' + cls + '"' +
      ' data-play-type="bf" data-label="' + escAttr(score) + '"' +
      (noOdd ? '' : ' onclick="_betSelect(\'bf\',\'' + escAttr(score) + '\',' + oddsVal + ',null)"') +
      '>' +
      '<span class="bet-score-val">' + escHtml(score) + '</span>' +
      '<span class="bet-score-odds">' + escHtml(oddsStr) + arrowHtml + '</span>' +
    '</div>';
  });
  return html + '</div>';
}

/* ─── 总进球 4列 ─── */
function renderGoalGrid() {
  var jqs = (_oddsData && _oddsData.jqs) || [];
  var map = {}; jqs.forEach(function (j) { map[j.goals] = j.odds; });
  var jqsDelta = (_oddsData && _oddsData.jqsDelta) || {};

  var html = '<div class="bet-goal-grid">';
  FIXED_JQS.forEach(function (g) {
    var v = map[g];
    var oddsVal = v != null ? Number(v) : null;
    var oddsStr = oddsVal != null ? oddsVal.toFixed(2) : '-';
    var noOdd = oddsVal == null;
    var sel = hasSelection('jqs', g, null);
    var deltaDir = jqsDelta[g] || null;

    // ★ 赔率变动箭头
    var arrowHtml = '';
    if (deltaDir === 'up') {
      arrowHtml = '<span class="bet-arrow-up">&#9650;</span>';
    } else if (deltaDir === 'down') {
      arrowHtml = '<span class="bet-arrow-down">&#9660;</span>';
    }

    var cls = 'bet-goal-item';
    if (sel) cls += ' selected';
    if (noOdd) cls += ' no-odds';

    html += '<div class="' + cls + '"' +
      ' data-play-type="jqs" data-label="' + escAttr(g) + '"' +
      (noOdd ? '' : ' onclick="_betSelect(\'jqs\',\'' + escAttr(g) + '\',' + oddsVal + ',null)"') +
      '>' +
      escHtml(g) +
      '<span class="bet-goal-odds">' + escHtml(oddsStr) + arrowHtml + '</span>' +
    '</div>';
  });
  return html + '</div>';
}

/* ─── 半全场 3列 ─── */
function renderHalfGrid() {
  var bqc = (_oddsData && _oddsData.bqc) || [];
  var map = {}; bqc.forEach(function (b) { map[b.combo] = b.odds; });
  var bqcDelta = (_oddsData && _oddsData.bqcDelta) || {};

  // ★ BQC delta key 映射：英缩写 → 中标签
  var BQC_DELTA_MAP = {
    'hh': '胜胜', 'hd': '胜平', 'ha': '胜负',
    'dh': '平胜', 'dd': '平平', 'da': '平负',
    'ah': '负胜', 'ad': '负平', 'aa': '负负',
  };

  var html = '<div class="bet-half-grid">';
  FIXED_BQC.forEach(function (c) {
    var v = map[c];
    var oddsVal = v != null ? Number(v) : null;
    var oddsStr = oddsVal != null ? oddsVal.toFixed(2) : '-';
    var noOdd = oddsVal == null;
    var sel = hasSelection('bqc', c, null);

    // ★ 查找 delta 方向（先直接匹配，再通过缩写字映射）
    var deltaDir = bqcDelta[c] || null;
    if (!deltaDir) {
      // 反向映射：中文标签 → 缩写
      for (var abbr in BQC_DELTA_MAP) {
        if (BQC_DELTA_MAP[abbr] === c) { deltaDir = bqcDelta[abbr] || null; break; }
      }
    }

    // ★ 赔率变动箭头
    var arrowHtml = '';
    if (deltaDir === 'up') {
      arrowHtml = '<span class="bet-arrow-up">&#9650;</span>';
    } else if (deltaDir === 'down') {
      arrowHtml = '<span class="bet-arrow-down">&#9660;</span>';
    }

    var cls = 'bet-goal-item';
    if (sel) cls += ' selected';
    if (noOdd) cls += ' no-odds';

    html += '<div class="' + cls + '"' +
      ' data-play-type="bqc" data-label="' + escAttr(c) + '"' +
      (noOdd ? '' : ' onclick="_betSelect(\'bqc\',\'' + escAttr(c) + '\',' + oddsVal + ',null)"') +
      '>' +
      escHtml(c) +
      '<span class="bet-goal-odds">' + escHtml(oddsStr) + arrowHtml + '</span>' +
    '</div>';
  });
  return html + '</div>';
}

/* ═══ 选择交互 - 多选 ═══ */
function _betSelect(playType, label, odds, handicap) {
  var key = playType + '|' + label + (handicap !== null ? '|' + handicap : '');
  var existingIdx = -1;
  for (var i = 0; i < _selectedBets.length; i++) {
    if (_selectedBets[i].key === key) { existingIdx = i; break; }
  }
  if (existingIdx >= 0) {
    _selectedBets.splice(existingIdx, 1);
  } else {
    _selectedBets.push({ key: key, playType: playType, label: label, odds: odds, handicap: handicap });
  }
  // ★ 不全量 render()，仅切换 DOM class + 更新按钮状态，避免页面跳动
  var overlay = document.getElementById('betOverlay');
  if (overlay) {
    var card = overlay.querySelector('[data-play-type="' + playType + '"][data-label="' + label + '"]');
    if (card) {
      if (existingIdx >= 0) {
        card.classList.remove('selected');
      } else {
        card.classList.add('selected');
      }
    }
    // 更新确定按钮 disabled 状态
    var btn = document.getElementById('betConfirmBtn');
    if (btn) btn.disabled = _selectedBets.length === 0;
  }
  applyDirectionHighlights();
}
window._betSelect = _betSelect;

function hasSelection(playType, label, handicap) {
  for (var i = 0; i < _selectedBets.length; i++) {
    var s = _selectedBets[i];
    if (s.playType === playType && s.label === label && (handicap === null || s.handicap === handicap)) return true;
  }
  return false;
}

function _betConfirm() {
  if (_selectedBets.length === 0) return;
  var m = _currentMatch;
  window.dispatchEvent(new CustomEvent('betting-confirm', { detail: {
    matchId: m.matchId, matchNum: m.num, homeName: m.homeName, visitName: m.visitName,
    selections: _selectedBets.map(function(s) { return { playType: s.playType, label: s.label, odds: s.odds, handicap: s.handicap }; }),
    timestamp: new Date().toISOString(),
  }}));
  closeBetting();
}
window._betConfirm = _betConfirm;

/* ═══ 工具函数 ═══ */
function formatTimeString(startTime) {
  if (!startTime) return '';
  var p = String(startTime).match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  return p ? p[1] + '-' + p[2] + ' ' + p[3] + ':' + p[4] : startTime;
}
function formatHandicapLabel(h) {
  return h > 0 ? '+' + h : h < 0 ? '' + h : '0';
}
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

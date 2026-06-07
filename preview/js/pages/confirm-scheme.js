// ==================== 确认方案页面 ====================
import { api } from '../api.js';

var _planData = null;       // 完整方案数据（包含 matches、金额、过关等）
var _matches = [];          // 已选比赛列表
var _selections = [];       // 选项列表
var _passTypes = [2];       // 过关类型
var _multiplier = 2;        // 倍数（竞彩规则：2-99倍）

// ★ 竞彩木桶原则配置（与 scheme-design.js 保持一致）
var PLAY_LIMITS = { spf: 8, rqspf: 8, jqs: 6, bf: 4, bqc: 4 };
var PLAY_NAMES = { spf: '胜平负', rqspf: '让球胜平负', bf: '比分', jqs: '总进球', bqc: '半全场' };

function calcConfirmMaxPass() {
  var matchIds = {};
  _selections.forEach(function(s) { matchIds[s.matchId] = true; });
  var uniqueCount = Object.keys(matchIds).length;
  if (uniqueCount < 2) return 1;

  var minLimit = 8;
  _selections.forEach(function(s) {
    var limit = PLAY_LIMITS[s.playType] || 8;
    if (limit < minLimit) minLimit = limit;
  });
  return Math.min(minLimit, uniqueCount);
}

// ═══ 页面入口 ═══
export function loadConfirmScheme() {
  // 从 sessionStorage 恢复数据
  var raw = sessionStorage.getItem('pendingConfirmPlan');
  if (!raw) {
    var el = document.getElementById('confirmContent');
    if (el) el.innerHTML = '<div class="hint-box" style="padding:60px 20px;text-align:center;color:#8899aa;">暂无方案数据，请返回方案设计页面重新选择比赛</div>';
    return;
  }
  try {
    _planData = JSON.parse(raw);
  } catch (e) {
    console.error('解析方案数据失败:', e);
    var el = document.getElementById('confirmContent');
    if (el) el.innerHTML = '<div class="hint-box" style="padding:60px 20px;text-align:center;color:#8899aa;">方案数据异常，请返回方案设计页面重新选择比赛</div>';
    return;
  }
  _matches = _planData.matches || [];
  _selections = _planData.selections || [];
  _passTypes = (_planData.passTypes && _planData.passTypes.length) ? _planData.passTypes : [2];
  _multiplier = _planData.multiplier || 1;

  render();
}

// ═══ 渲染 ═══
function render() {
  var el = document.getElementById('confirmContent');
  if (!el) return;

  // 计算统计数据
  var uniqueMatchIds = {};
  _selections.forEach(function (s) { uniqueMatchIds[s.matchId] = true; });
  var uniqueCount = Object.keys(uniqueMatchIds).length;

  var bets = calcBets(uniqueCount);
  var amount = bets * 2 * _multiplier;
  var maxWin = calcMaxWin(amount);

  // 按 matchId 分组（同场多方向分行）
  var groupedSelections = buildGroupedSelections();

  var html = '';

  // 方案预览卡片（plan-card 样式）
  html += renderPlanPreviewCard(bets, amount, maxWin, uniqueCount, groupedSelections);

  // 底部操作栏
  html += renderBottomBar(bets, amount, maxWin, uniqueCount);

  el.innerHTML = html;
}

// ═══ 按 matchId 分组 selections ═══
function buildGroupedSelections() {
  var matchMap = {};
  _matches.forEach(function (m) { matchMap[m.matchId] = m; });

  var groups = [];
  var visited = {};

  _selections.forEach(function (s) {
    if (!visited[s.matchId]) {
      visited[s.matchId] = true;
      groups.push({
        matchId: s.matchId,
        match: matchMap[s.matchId] || {},
        sels: [s],
      });
    } else {
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].matchId === s.matchId) {
          groups[i].sels.push(s);
          break;
        }
      }
    }
  });

  return groups;
}

// ═══ 方案预览卡片（plan-card 样式） ═══
function renderPlanPreviewCard(bets, amount, maxWin, uniqueCount, groupedSelections) {
  var playLabels = { spf: '胜平负', rqspf: '让球胜平负', bf: '比分', jqs: '总进球', bqc: '半全场' };

  var passLabel = _passTypes.length === 1
    ? _passTypes[0] + '关'
    : (_passTypes.length > 1 ? _passTypes.join('~') + '关' : '2关');

  // 资金分配：默认均分（若已有 allocation 则用已有的）
  var defaultAllocPerSel = _selections.length > 0 ? Math.round(amount / _selections.length * 100) / 100 : 0;

  // 构建比赛表格行（同场多方向分行，对阵合并）
  var matchRows = '';
  groupedSelections.forEach(function (g) {
    var m = g.match;
    var numText = m.matchNum || '';

    // 开赛时间
    var matchDateShort = '', matchTime = '';
    if (m.timeStr) {
      var tm = m.timeStr.match(/(\d{2}:\d{2})/);
      if (tm) matchTime = tm[1];
      var dm = m.timeStr.match(/(\d{1,2})[\/\-](\d{1,2})/);
      if (dm) matchDateShort = dm[1] + '/' + dm[2];
    }
    var timeDisp = matchDateShort || matchTime ? (matchDateShort + ' ' + matchTime).trim() : '';

    g.sels.forEach(function (s, si) {
      var playLabel = playLabels[s.playType] || s.playType;
      var dirDisplay = s.direction || s.oddsName || '';
      var oddsStr = s.odds != null ? Number(s.odds).toFixed(2) : '--';

      // 让球方向加前缀
      if (s.playType === 'rqspf') dirDisplay = '让' + dirDisplay;

      // ★ 获取 Delta 方向
      var deltaArrow = '';
      if (m._odds) {
        var groupedKey = s.playType + 'Delta'; // spfDelta, rqspfDelta, bfDelta, jqsDelta, bqcDelta
        var grouped = m._odds[groupedKey];
        if (grouped) {
          // 确定 fieldName：SPF/RQSPF 用中文方向名，BF/JQS/BQC 直接用方向值
          var fieldName = s.direction || s.oddsName || '';
          if (s.playType === 'rqspf') fieldName = s.direction || s.oddsName || '';
          // SPF: 胜/平/负, RQSPF: 胜/平/负 → 直接用方向名
          // BF/JQS/BQC: label 即是 fieldName
          var deltaDir = grouped[fieldName] || null;
          if (!deltaDir && s.playType === 'bqc') {
            // BQC: 尝试反向映射缩写
            var BQC_MAP_REV = { '胜胜': 'hh', '胜平': 'hd', '胜负': 'ha', '平胜': 'dh', '平平': 'dd', '平负': 'da', '负胜': 'ah', '负平': 'ad', '负负': 'aa' };
            var abbr = BQC_MAP_REV[fieldName];
            if (abbr) deltaDir = grouped[abbr] || null;
          }
          if (deltaDir === 'up') deltaArrow = ' <span style="color:#FF5B55;font-size:9px;">▲</span>';
          else if (deltaDir === 'down') deltaArrow = ' <span style="color:#34D399;font-size:9px;">▼</span>';
        }
      }

      matchRows += '<tr>';
      // 场次列（仅第一行显示）
      matchRows += '<td class="match-info-col">';
      if (si === 0) {
        matchRows += '<div class="match-num-text">' + numText + '</div>';
        if (timeDisp) matchRows += '<div class="match-time-sub">' + timeDisp + '</div>';
      }
      matchRows += '</td>';

      // 对阵列（仅第一行显示）
      matchRows += '<td class="team-col">';
      if (si === 0) {
        matchRows += '<span class="plan-team-home">' + (m.homeName || '') + '</span>'
          + '<span class="plan-team-vs">vs</span>'
          + '<span class="plan-team-away">' + (m.visitName || '') + '</span>';
      }
      matchRows += '</td>';

      // 投注(赔率)列：每行显示一个方向 + Delta 箭头
      matchRows += '<td class="odds-col">' + dirDisplay + ' ' + oddsStr + deltaArrow + '</td>';

      // ★ 资金分配列
      var allocVal = s.allocation != null ? s.allocation : defaultAllocPerSel;
      matchRows += '<td class="allocation-col"><span class="plan-alloc-val">' + allocVal.toFixed(0) + '</span><span class="plan-alloc-unit">元</span></td>';

      matchRows += '</tr>';
    });
  });

  var html = '<div class="plan-card" style="margin:12px 16px;">';

  // 头部
  html += '<div class="plan-card-head">';
  html += '<div class="plan-left">';
  html += '<span class="plan-soccer-icon">&#x26BD;</span>';
  html += '<span class="plan-name">我的方案</span>';
  html += '</div>';
  html += '<span class="bonus-opt-badge" onclick="event.stopPropagation();showBonusOptimize()" title="点击查看奖金优化方案">奖金优化</span>';
  html += '</div>';

  // 金额行（3列）
  html += '<div class="plan-amount-row">';
  html += '<div class="plan-amount-col"><div class="plan-amount-label">方案金额</div><div class="plan-amount-value">' + amount + '<span class="unit">元</span></div></div>';
  html += '<div class="plan-amount-col"><div class="plan-amount-label">预计奖金</div><div class="plan-amount-value">' + maxWin + '<span class="unit">元</span></div></div>';
  html += '<div class="plan-amount-col"><div class="plan-amount-label">方案状态</div><div class="plan-amount-value" style="color:#FFC928;">待确认</div></div>';
  html += '</div>';

  // 分割线
  html += '<div class="plan-divider"></div>';

  // 信息网格
  html += '<div class="plan-info-grid">';
  html += '<div class="plan-info-left"><div>玩法</div><div>场数/过关</div><div>注数/倍数</div></div>';
  html += '<div class="plan-info-right"><div>混合投注</div><div>' + uniqueCount + '场 ' + passLabel + '</div><div>' + bets + '注 ×' + _multiplier + '倍</div></div>';
  html += '</div>';

  // 比赛表格
  html += '<div class="plan-match-section">';
  html += '<table class="plan-match-table score-table"><thead><tr><th>场次</th><th>对阵</th><th>投注(赔率)</th><th>资金分配</th></tr></thead><tbody>';
  html += matchRows;
  html += '</tbody></table></div>';

  // ★ 比分方案元信息（大球率/进攻优势/进球区间/强队方向）
  var isSingleBf = uniqueCount === 1 && _selections.length > 0 && _selections.every(function(s) { return s.playType === 'bf'; });
  if (isSingleBf) {
    var sbfBigBall = '--', sbfAttack = '--', sbfGoal = '--', sbfStrong = '--';
    var sbfMeta = (_planData && _planData.scoreMeta) ? _planData.scoreMeta : (_matches.length > 0 && _matches[0]._meta) ? _matches[0]._meta : null;
    if (sbfMeta) {
      sbfBigBall = sbfMeta.bigBallRatio || '--';
      sbfAttack = sbfMeta.attackAdvantage || '--';
      sbfGoal = sbfMeta.goalRange || '--';
      sbfStrong = sbfMeta.strongSide || '--';
    }
    html += '<div class="plan-score-meta"><span>大球率 ' + sbfBigBall + '%</span><span>进攻优势 ' + sbfAttack + '</span><span>进球区间 ' + sbfGoal + '</span><span>强队 ' + sbfStrong + '</span></div>';
  }

  html += '</div>';
  return html;
}

// ═══ 渲染单个比赛卡片 ═══
function renderMatchCard(m, sel, idx) {
  // 赔率数据
  var odds = m._odds || m.oddsMap || {};
  var spf = odds.spf || {};

  var homeOdds = spf.home != null ? Number(spf.home).toFixed(2) : '--';
  var drawOdds = spf.draw != null ? Number(spf.draw).toFixed(2) : '--';
  var awayOdds = spf.away != null ? Number(spf.away).toFixed(2) : '--';

  // 判断哪个方向被选中
  var isHomeActive = sel.direction === '胜';
  var isDrawActive = sel.direction === '平';
  var isAwayActive = sel.direction === '负';

  var homeCls = 'cfm-opt' + (isHomeActive ? ' active' : '');
  var drawCls = 'cfm-opt' + (isDrawActive ? ' active' : '');
  var awayCls = 'cfm-opt' + (isAwayActive ? ' active' : '');

  // 玩法标签
  var playLabels = { spf: '胜平负', rqspf: '让球胜平负', bf: '比分', jqs: '总进球', bqc: '半全场' };
  var playLabel = playLabels[sel.playType] || sel.playType;
  var matchId = m.matchId || '';

  var html = '<div class="cfm-match-card" data-mid="' + matchId + '">';

  // 顶部删除按钮 + 玩法标签 + 比赛编号
  html += '<div class="cfm-card-top">';
  html += '<span class="cfm-del" onclick="confirmRemoveMatch(\'' + matchId + '\')">&#x2715;</span>';
  html += '<span class="cfm-match-num">' + (m.matchNum || '') + '</span>';
  html += '<span class="cfm-play-tag">' + playLabel + '</span>';
  html += '</div>';

  // 三列对阵 + 赔率
  html += '<div class="cfm-card-body">';
  // 主队列
  html += '<div class="' + homeCls + '" onclick="confirmTogglePick(\'' + matchId + '\',\'' + (sel.playType || 'spf') + '\',\'\胜\',\'' + homeOdds + '\')">';
  html += '<div class="cfm-opt-team">' + (m.homeName || '') + '</div>';
  html += '<div class="cfm-opt-odds">' + homeOdds + '</div>';
  html += '</div>';
  // 中间列：平 + 联赛时间
  html += '<div class="cfm-vs-wrap">';
  html += '<div class="' + drawCls + '" onclick="confirmTogglePick(\'' + matchId + '\',\'' + (sel.playType || 'spf') + '\',\'\平\',\'' + drawOdds + '\')">';
  html += '<span class="cfm-opt-label">平</span>';
  html += '<span class="cfm-opt-odds">' + drawOdds + '</span>';
  html += '</div>';
  html += '<div class="cfm-game-info">';
  html += '<span class="cfm-league">' + (m.league || '') + '</span>';
  html += '<span class="cfm-time">' + (m.timeStr || '') + '</span>';
  html += '</div>';
  html += '</div>';
  // 客队列
  html += '<div class="' + awayCls + '" onclick="confirmTogglePick(\'' + matchId + '\',\'' + (sel.playType || 'spf') + '\',\'\负\',\'' + awayOdds + '\')">';
  html += '<div class="cfm-opt-team">' + (m.visitName || '') + '</div>';
  html += '<div class="cfm-opt-odds">' + awayOdds + '</div>';
  html += '</div>';
  html += '</div>';

  html += '</div>';
  return html;
}

// ═══ 查找某场比赛的选中方向 ═══
function findSelectionByMatchId(matchId) {
  for (var i = 0; i < _selections.length; i++) {
    if (_selections[i].matchId === matchId) return _selections[i];
  }
  return null;
}

// ═══ 底部操作栏 ═══
function renderBottomBar(bets, amount, maxWin, uniqueCount) {
  // 过关显示
  var passLabel = '';
  if (_passTypes.length === 1) {
    passLabel = _passTypes[0] + '关';
  } else if (_passTypes.length > 1) {
    passLabel = _passTypes.join('~') + '关';
  } else {
    passLabel = '2关';
  }

  var html = '';
  html += '<div class="cfm-bottom-bar">';
  html += '<div class="cfm-bb-content">';
  // 第一行：过关 + 倍数
  html += '<div class="cfm-bb-row">';
  html += '<div class="cfm-bb-item">';
  html += '<span class="cfm-bb-label">过关</span>';
  html += '<span class="cfm-bb-pass" onclick="confirmShowPassPopup()">' + passLabel + ' <span class="cfm-bb-arrow">&#x25BE;</span></span>';
  html += '</div>';
  html += '<div class="cfm-bb-item">';
  html += '<span class="cfm-bb-label">倍数</span>';
  html += '<div class="cfm-bb-multi">';
  html += '<button class="cfm-bb-mbtn" onclick="confirmAdjustMultiplier(-1)">-</button>';
  html += '<span class="cfm-bb-mval" id="cfmMultiVal" onclick="confirmShowMultiplierPopup()">' + _multiplier + '</span>';
  html += '<button class="cfm-bb-mbtn" onclick="confirmAdjustMultiplier(1)">+</button>';
  html += '</div>';
  html += '</div>';
  html += '</div>';
  // 第二行：金额 + 奖金
  html += '<div class="cfm-bb-row">';
  html += '<div class="cfm-bb-item">';
  html += '<span class="cfm-bb-label">投注金额</span>';
  html += '<span class="cfm-bb-amount">' + bets + '注 <span class="cfm-bb-yuan">' + amount + '元</span></span>';
  html += '</div>';
  html += '<div class="cfm-bb-item">';
  html += '<span class="cfm-bb-label">预计奖金</span>';
  html += '<span class="cfm-bb-maxwin">' + maxWin + '元</span>';
  html += '</div>';
  html += '</div>';
  html += '</div>';
  // 双按钮：重选 + 保存
  html += '<div class="cfm-btn-row">';
  html += '<button class="cfm-reselect-btn" onclick="window.switchTab(\'scheme\')">重选</button>';
  html += '<button class="cfm-save-btn" onclick="confirmSavePlan()">保存</button>';
  html += '</div>';
  html += '</div>';

  return html;
}

// ═══ 组合数计算 ═══
function combination(n, k) {
  if (k > n || k < 0) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  var res = 1;
  for (var i = 1; i <= k; i++) {
    res = res * (n - i + 1) / i;
  }
  return Math.round(res);
}

// ═══ 辅助：计算 k 关过关的展开注数 ═══
function calcExpandedBets(matchGroups, matchIds, k) {
  var n = matchIds.length;
  if (k > n || k <= 0) return 0;

  var total = 0;
  // 递归生成所有 k-组合索引
  (function gen(start, combo) {
    if (combo.length === k) {
      var product = 1;
      for (var i = 0; i < combo.length; i++) {
        product *= matchGroups[matchIds[combo[i]]].length;
      }
      total += product;
      return;
    }
    for (var i = start; i < n; i++) {
      combo.push(i);
      gen(i + 1, combo);
      combo.pop();
    }
  })(0, []);
  return total;
}

// ═══ 计算注数和金额 ═══
function calcBets(uniqueCount) {
  var matchGroups = {};
  _selections.forEach(function(s) {
    if (!matchGroups[s.matchId]) matchGroups[s.matchId] = [];
    matchGroups[s.matchId].push(s);
  });
  var matchIds = Object.keys(matchGroups);
  var n = matchIds.length;
  if (n === 0) return 0;
  if (n === 1) {
    return matchGroups[matchIds[0]].length;
  }

  var total = 0;
  _passTypes.forEach(function(k) {
    total += calcExpandedBets(matchGroups, matchIds, k);
  });
  return total || 1;
}

// ═══ 计算最高奖金 ═══
function calcMaxWin(amount) {
  var matchGroups = {};
  _selections.forEach(function(s) {
    if (!matchGroups[s.matchId]) matchGroups[s.matchId] = [];
    matchGroups[s.matchId].push(s.odds || 1);
  });
  var matchIds = Object.keys(matchGroups);
  var n = matchIds.length;

  // 每场比赛的最大赔率
  var maxOddsPerMatch = {};
  matchIds.forEach(function(mid) {
    maxOddsPerMatch[mid] = Math.max.apply(null, matchGroups[mid]);
  });

  // 找所有过关类型中赔率乘积最高的 k-组合
  var bestProduct = 1;
  _passTypes.forEach(function(k) {
    if (k > n) return;
    // 按最大赔率降序取前 k 场
    var sorted = matchIds
      .map(function(mid) { return maxOddsPerMatch[mid]; })
      .sort(function(a, b) { return b - a; });
    var product = 1;
    for (var i = 0; i < k; i++) product *= sorted[i];
    if (product > bestProduct) bestProduct = product;
  });

  // 理论最高奖金 = 单注金额 × 最佳赔率乘积
  var singleBetAmount = 2 * _multiplier;
  return singleBetAmount > 0 ? Math.round(singleBetAmount * bestProduct * 100) / 100 : 0;
}

// ═══ 返回方案设计页 ═══
window.goSchemeDesign = function () {
  window.switchTab('scheme');
};

// ═══ 删除一场比赛 ═══
window.confirmRemoveMatch = function (matchId) {
  _selections = _selections.filter(function (s) { return s.matchId !== matchId; });
  _matches = _matches.filter(function (m) { return m.matchId !== matchId; });

  if (_matches.length === 0 && _selections.length === 0) {
    // 全部删除，返回方案设计页
    sessionStorage.removeItem('pendingConfirmPlan');
    window.switchTab('scheme');
    return;
  }

  // 更新过关类型（移除超出子比赛数量的过关）
  var uniqueMatchIds = {};
  _selections.forEach(function (s) { uniqueMatchIds[s.matchId] = true; });
  var uniqueCount = Object.keys(uniqueMatchIds).length;
  _passTypes = _passTypes.filter(function (k) { return k <= uniqueCount; });
  if (_passTypes.length === 0 && uniqueCount >= 2) _passTypes = [2];
  if (_passTypes.length === 0 && uniqueCount === 1) _passTypes = [1];

  updateSessionStore();
  render();
};

// ═══ 切换选中方向 ═══
window.confirmTogglePick = function (matchId, playType, direction, oddsVal) {
  var existingIdx = -1;
  for (var i = 0; i < _selections.length; i++) {
    if (_selections[i].matchId === matchId) {
      existingIdx = i;
      break;
    }
  }
  if (existingIdx >= 0) {
    _selections[existingIdx].playType = playType;
    _selections[existingIdx].direction = direction;
    _selections[existingIdx].odds = Number(oddsVal) || 0;
    _selections[existingIdx].oddsName = direction;
  } else {
    _selections.push({
      matchId: matchId,
      playType: playType,
      direction: direction,
      odds: Number(oddsVal) || 0,
      oddsName: direction,
      handicap: 0,
    });
  }
  updateSessionStore();
  render();
};

// ═══ 倍数调整 ═══
window.confirmAdjustMultiplier = function (delta) {
  _multiplier = Math.max(2, Math.min(99, _multiplier + delta));
  updateSessionStore();
  render();
};

// ═══ 倍数弹窗 ═══
var _confirmTempMultiplier = 2;

window.confirmShowMultiplierPopup = function () {
  _confirmTempMultiplier = _multiplier;
  var overlay = document.getElementById('confirmMultiplierOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'confirmMultiplierOverlay';
    overlay.className = 'ssb-overlay';
    overlay.onclick = function (e) { if (e.target === overlay) window.confirmCloseMultiplierPopup(); };
    overlay.innerHTML =
      '<div class="ssb-modal ssb-multi-modal">' +
      '<div class="ssb-modal-header"><div class="ssb-input-wrap"><input type="text" id="confirmSsBMultiInput" readonly value="2"/><span>倍</span></div><button class="ssb-modal-cancel" onclick="confirmCloseMultiplierPopup()">取消</button><button class="ssb-modal-confirm" onclick="confirmConfirmMultiplierPopup()">确定</button></div>' +
      '<div class="ssb-quick-row"><button onclick="confirmSetMultiQuick(2)">2</button><button onclick="confirmSetMultiQuick(5)">5</button><button onclick="confirmSetMultiQuick(10)">10</button><button onclick="confirmSetMultiQuick(20)">20</button><button onclick="confirmSetMultiQuick(50)">50</button></div>' +
      '<div class="ssb-keyboard">' +
      '<button onclick="confirmInputMultiDigit(\'1\')">1</button><button onclick="confirmInputMultiDigit(\'2\')">2</button><button onclick="confirmInputMultiDigit(\'3\')">3</button>' +
      '<button onclick="confirmInputMultiDigit(\'4\')">4</button><button onclick="confirmInputMultiDigit(\'5\')">5</button><button onclick="confirmInputMultiDigit(\'6\')">6</button>' +
      '<button onclick="confirmInputMultiDigit(\'7\')">7</button><button onclick="confirmInputMultiDigit(\'8\')">8</button><button onclick="confirmInputMultiDigit(\'9\')">9</button>' +
      '<button onclick="confirmInputMultiDigit(\'.\')" disabled>.</button><button onclick="confirmInputMultiDigit(\'0\')">0</button><button onclick="confirmBackspaceMulti()">⌫</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);
  }
  var input = document.getElementById('confirmSsBMultiInput');
  if (input) input.value = _confirmTempMultiplier;
  overlay.classList.add('active');
};

window.confirmCloseMultiplierPopup = function () {
  var overlay = document.getElementById('confirmMultiplierOverlay');
  if (overlay) overlay.classList.remove('active');
};

window.confirmConfirmMultiplierPopup = function () {
  _multiplier = Math.max(2, Math.min(99, parseInt(_confirmTempMultiplier) || 2));
  window.confirmCloseMultiplierPopup();
  updateSessionStore();
  render();
};

window.confirmSetMultiQuick = function (val) {
  _confirmTempMultiplier = val;
  var input = document.getElementById('confirmSsBMultiInput');
  if (input) input.value = _confirmTempMultiplier;
};

window.confirmInputMultiDigit = function (digit) {
  var input = document.getElementById('confirmSsBMultiInput');
  if (!input) return;
  var current = String(_confirmTempMultiplier);
  if (current === '0') current = digit;
  else if (current.length < 2) current += digit;
  _confirmTempMultiplier = parseInt(current) || 1;
  input.value = _confirmTempMultiplier;
};

window.confirmBackspaceMulti = function () {
  var input = document.getElementById('confirmSsBMultiInput');
  if (!input) return;
  var current = String(_confirmTempMultiplier);
  if (current.length > 1) current = current.slice(0, -1);
  else current = '2';
  _confirmTempMultiplier = parseInt(current) || 1;
  input.value = _confirmTempMultiplier;
};

// ═══ 过关弹窗 ═══
window.confirmShowPassPopup = function () {
  var uniqueMatchIds = {};
  _selections.forEach(function (s) { uniqueMatchIds[s.matchId] = true; });
  var n = Object.keys(uniqueMatchIds).length;
  if (n < 2) return;

  var matchGroups = {};
  _selections.forEach(function(s) {
    if (!matchGroups[s.matchId]) matchGroups[s.matchId] = [];
    matchGroups[s.matchId].push(s);
  });
  var matchIds = Object.keys(matchGroups);

  var overlay = document.getElementById('confirmPassOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'confirmPassOverlay';
    overlay.className = 'ssb-overlay';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.classList.remove('active'); };
    document.body.appendChild(overlay);
  }

  // ★ 应用木桶原则计算真正的过关上限
  var maxPass = calcConfirmMaxPass();

  // 构建木桶提示信息：说明各玩法上限
  var playTypes = {};
  _selections.forEach(function(s) { playTypes[s.playType] = true; });
  var playLimitParts = Object.keys(playTypes).map(function(pt) {
    return (PLAY_NAMES[pt] || pt) + '上限' + PLAY_LIMITS[pt] + '场';
  });
  var bucketHint = '';
  if (maxPass < n && maxPass < 8) {
    bucketHint = '（' + playLimitParts.join('+') + ' → 木桶上限' + maxPass + '关）';
  }

  var html = '<div class="ssb-modal ssb-pass-modal">';
  html += '<div class="ssb-modal-title">选择过关方式<button class="ssb-modal-close" onclick="closeConfirmPassPopup()">&#x2715;</button></div>';
  html += '<div class="ssb-pass-hint">当前：' + n + '场，上限：' + maxPass + '关' + bucketHint + '</div>';
  html += '<div class="ssb-pass-list">';
  for (var k = 2; k <= maxPass; k++) {
    var checked = _passTypes.indexOf(k) !== -1;
    var count = calcExpandedBets(matchGroups, matchIds, k) + '注';
    html += '<div class="ssb-pass-item">';
    html += '<label><input type="checkbox"' + (checked ? ' checked' : '') + ' onchange="confirmTogglePassType(' + k + ')"> ' + k + '关</label>';
    html += '<span class="ssb-pass-count">' + count + '</span>';
    html += '</div>';
  }
  html += '</div>';
  html += '<div class="ssb-modal-footer"><button class="ssb-modal-cancel" onclick="closeConfirmPassPopup()">取消</button><button class="ssb-modal-confirm" onclick="confirmConfirmPass()">确定</button></div>';
  html += '</div>';
  overlay.innerHTML = html;
  overlay.classList.add('active');
};

window.confirmTogglePassType = function (k) {
  // ★ 木桶上限过滤：禁止勾选超过玩法上限的过关类型
  var maxPass = calcConfirmMaxPass();
  if (k > maxPass) return;

  var idx = _passTypes.indexOf(k);
  if (idx !== -1) {
    _passTypes.splice(idx, 1);
  } else {
    _passTypes.push(k);
    _passTypes.sort(function (a, b) { return a - b; });
  }
  updateSessionStore();
};

window.closeConfirmPassPopup = function () {
  var overlay = document.getElementById('confirmPassOverlay');
  if (overlay) overlay.classList.remove('active');
};

window.confirmConfirmPass = function () {
  // ★ 过滤超出木桶上限的过关类型（防止残留脏数据）
  var maxPass = calcConfirmMaxPass();
  _passTypes = _passTypes.filter(function(k) { return k <= maxPass; });

  if (_passTypes.length === 0) {
    var uniqueMatchIds = {};
    _selections.forEach(function (s) { uniqueMatchIds[s.matchId] = true; });
    var n = Object.keys(uniqueMatchIds).length;
    _passTypes = [Math.min(n, 2, maxPass)];
  }
  var overlay = document.getElementById('confirmPassOverlay');
  if (overlay) overlay.classList.remove('active');
  updateSessionStore();
  render();
};

// ═══ 保存方案 ═══
window.confirmSavePlan = function () {
  if (_selections.length === 0) {
    alert('请至少选择一场比赛');
    return;
  }

  // 单关校验
  var uniqueMatchIds = {};
  _selections.forEach(function (s) { uniqueMatchIds[s.matchId] = true; });
  var uniqueMatches = Object.keys(uniqueMatchIds);

  if (uniqueMatches.length === 1) {
    var selMatch = _matches.find(function (m) { return m.matchId === uniqueMatches[0]; });

    // ★ BF/JQS/BQC 天生单关，无需 isSingleGame 标记；SPF/RQSPF 需要单关标记
    var hasSPF_RQSPF = _selections.some(function(s) { return s.playType === 'spf' || s.playType === 'rqspf'; });
    if (hasSPF_RQSPF && (!selMatch || selMatch.isSingleGame !== true)) {
      alert('⚽ 该场比赛未标记为「单关」场次，不支持单关胜平负投注\n\n请至少再选一场比赛组成串关。');
      return;
    }
  }

  // ★ 串关规则：同场比赛只能用同一玩法
  if (uniqueMatches.length >= 2) {
    var _spMap = {};
    for (var _si = 0; _si < _selections.length; _si++) {
      var _s = _selections[_si];
      if (!_spMap[_s.matchId]) {
        _spMap[_s.matchId] = _s.playType;
      } else if (_spMap[_s.matchId] !== _s.playType) {
        var _sm = _matches.find(function(x) { return x.matchId === _s.matchId; });
        var _sLabel = _sm ? (_sm.homeName + ' vs ' + _sm.visitName) : _s.matchId;
        alert('⚽ 串关规则：同场比赛只能用同一玩法\n\n' + _sLabel + ' 已同时选择了 ' + (PLAY_NAMES[_spMap[_s.matchId]] || _spMap[_s.matchId]) + ' 和 ' + (PLAY_NAMES[_s.playType] || _s.playType) + '，请统一为同一玩法。');
        return;
      }
    }
  }

  var uniqueCount = uniqueMatches.length;
  var bets = calcBets(uniqueCount);
  var amount = bets * 2 * _multiplier;
  var maxWin = calcMaxWin(amount);

  // ★ 竞技彩票单张金额上限 20000 元
  if (amount > 20000) {
    alert('⚽ 投注金额 ' + amount + ' 元超过单张彩票 20000 元上限，请减少倍数或调整方案');
    return;
  }

  // ★ 单注最高奖金限额：单场10万 / 2-3场20万 / 4-5场50万 / 6+场100万
  var prizeCap;
  if (uniqueCount === 1) prizeCap = 100000;
  else if (uniqueCount <= 3) prizeCap = 200000;
  else if (uniqueCount <= 5) prizeCap = 500000;
  else prizeCap = 1000000;

  if (maxWin > prizeCap) {
    alert('⚽ 预计奖金 ' + maxWin.toFixed(2) + ' 元超过 ' + (prizeCap / 10000).toFixed(0) + ' 万元限额（' + uniqueCount + '场过关最高奖金限额），请调整方案');
    return;
  }

  var matchDetails = _selections.map(function (s) {
    var m = _matches.find(function (x) { return x.matchId === s.matchId; }) || {};
    return {
      matchId: s.matchId,
      homeName: m.homeName || '',
      visitName: m.visitName || '',
      league: m.league || '',
      matchNum: m.matchNum || '',
      playType: s.playType,
      direction: s.direction,
      odds: s.odds,
      oddsName: s.oddsName,
    };
  });

  var plan = {
    type: 'user',
    matches: matchDetails,
    amount: amount,
    multiplier: _multiplier,
    betCount: bets,
    passTypes: _passTypes.length > 0 ? _passTypes : [2],
    note: (_passTypes.length > 1 ? '自由过关 ' : (_passTypes[0] === 1 ? '单关 ' : '串关方案 ')) +
      (_passTypes.length > 1 ? _passTypes.join('关+') + '关' : _passTypes[0] + '关') +
      '，共' + bets + '注 ×' + _multiplier + '倍',
    matchCount: Object.keys(_selections.reduce(function(acc, s) { acc[s.matchId] = true; return acc; }, {})).length,
    totalOdds: amount > 0 ? Math.round(maxWin / amount * 100) / 100 : 0,
    isWon: null,
    resultIncome: null,
  };

  api('my-plan-save', { plan: plan })
    .then(function () {
      // 清除临时数据
      sessionStorage.removeItem('pendingConfirmPlan');
      // 标记跳转目标为"我的方案"标签
      try { sessionStorage.setItem('pendingPlanTab', 'my'); } catch (e) {}
      window.switchTab('plan');
    })
    .catch(function (e) {
      alert('保存失败: ' + e.message);
    });
};

// ═══ 同步到 sessionStorage ═══
function updateSessionStore() {
  var uniqueMatchIds = {};
  _selections.forEach(function (s) { uniqueMatchIds[s.matchId] = true; });

  _planData.selections = _selections;
  _planData.passTypes = _passTypes;
  _planData.multiplier = _multiplier;

  try {
    sessionStorage.setItem('pendingConfirmPlan', JSON.stringify(_planData));
  } catch (e) {
    console.error('存储方案数据失败:', e);
  }
}

// ═══ 奖金优化弹窗 ═══
var _boStrategy = 'balanced'; // balanced | hot | cold
var _boRows = [];             // [{ pickId, playType, direction, matchLabel, odds, handicap, betCount }]
var _boBaseAmount = 0;

window.showBonusOptimize = function () {
  var bets = calcBets(Object.keys(
    _selections.reduce(function (acc, s) { acc[s.matchId] = true; return acc; }, {})
  ).length);
  _boBaseAmount = bets * 2 * (_multiplier || 1);
  if (!_boBaseAmount) _boBaseAmount = 2;

  // 构建行数据：每个选择一行
  _boRows = _selections.map(function (s, idx) {
    var m = _matches.find(function (x) { return x.matchId === s.matchId; }) || {};
    var playLabel = ({ spf: '', rqspf: '让', bf: '比分', jqs: '总进球', bqc: '半全场' })[s.playType] || '';
    var numText = (m.matchNum || '').replace(/^[周一二三四五六日]+/, '');
    var matchLabel = (m.homeName || '') + ' vs ' + (m.visitName || '');
    var dirLabel = (s.playType === 'rqspf' ? '让' : '') + (s.direction || s.oddsName || '');
    var desc = playLabel ? (playLabel + ' ' + dirLabel) : dirLabel;
    return {
      id: idx,
      matchNum: numText,
      matchLabel: matchLabel,
      direction: dirLabel,
      playType: s.playType,
      desc: desc,
      odds: Number(s.odds) || 1,
    };
  });

  if (_boRows.length === 0) { alert('暂无方案数据'); return; }

  _boStrategy = 'balanced';
  applyStrategy();

  // 弹窗容器
  var old = document.getElementById('bonusOptOverlay');
  if (old) old.remove();
  var overlay = document.createElement('div');
  overlay.id = 'bonusOptOverlay';
  overlay.className = 'ai-overlay';
  overlay.onclick = function (e) {
    if (e.target === overlay) closeBonusOpt();
  };
  document.body.appendChild(overlay);

  renderBonusOpt();
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
};

function applyStrategy() {
  var total = _boBaseAmount;
  var rows = _boRows;
  var n = rows.length;
  if (n === 0) return;

  if (_boStrategy === 'balanced') {
    // 奖金平均：weight_i = 1/odds_i / sum(1/odds_j)
    var totalInv = 0;
    rows.forEach(function (r) { totalInv += 1 / r.odds; });
    rows.forEach(function (r) {
      var weight = (1 / r.odds) / totalInv;
      r.betCount = Math.round(total * weight / 2);
      r.projected = Math.round(r.betCount * 2 * r.odds * 100) / 100;
    });
    // 修正取整误差
    var actualTotal = rows.reduce(function (s, r) { return s + r.betCount * 2; }, 0);
    var diff = total - actualTotal;
    if (diff !== 0 && rows.length > 0) {
      rows[0].betCount += Math.round(diff / 2);
      rows[0].projected = Math.round(rows[0].betCount * 2 * rows[0].odds * 100) / 100;
    }
  } else if (_boStrategy === 'hot') {
    // 博彩保本：热门（最低赔率）最大，其他保本
    // 找热门 = 最低赔率
    var hotIdx = 0;
    for (var i = 1; i < n; i++) { if (rows[i].odds < rows[hotIdx].odds) hotIdx = i; }
    // 其他行保本：betCount * 2 * odds >= total → betCount = ceil(total / 2 / odds)
    var safeguard = 0;
    rows.forEach(function (r, i) {
      if (i === hotIdx) return;
      r.betCount = Math.ceil(total / 2 / r.odds);
      safeguard += r.betCount * 2;
    });
    var remaining = total - safeguard;
    rows[hotIdx].betCount = Math.max(0, Math.floor(remaining / 2));
    rows.forEach(function (r) {
      r.projected = Math.round(r.betCount * 2 * r.odds * 100) / 100;
    });
  } else if (_boStrategy === 'cold') {
    // 奖金最高：冷门（最高赔率）最大，其他保本
    var coldIdx = 0;
    for (var j = 1; j < n; j++) { if (rows[j].odds > rows[coldIdx].odds) coldIdx = j; }
    var safeguard2 = 0;
    rows.forEach(function (r, i) {
      if (i === coldIdx) return;
      r.betCount = Math.ceil(total / 2 / r.odds);
      safeguard2 += r.betCount * 2;
    });
    var remaining2 = total - safeguard2;
    rows[coldIdx].betCount = Math.max(0, Math.floor(remaining2 / 2));
    rows.forEach(function (r) {
      r.projected = Math.round(r.betCount * 2 * r.odds * 100) / 100;
    });
  }
}

function renderBonusOpt() {
  var overlay = document.getElementById('bonusOptOverlay');
  if (!overlay) return;
  var total = _boBaseAmount;

  var tabBal = _boStrategy === 'balanced' ? ' active' : '';
  var tabHot = _boStrategy === 'hot' ? ' active' : '';
  var tabCold = _boStrategy === 'cold' ? ' active' : '';

  var persecond = total.toFixed(2) + '元 · ' + _boRows.length + '个选项';

  var rowsHtml = _boRows.map(function (r, idx) {
    // 判断基准行（热门/冷门标记）
    var isTarget = false;
    if (_boStrategy === 'hot') {
      var hotMin = Math.min.apply(null, _boRows.map(function (rr) { return rr.odds; }));
      isTarget = r.odds === hotMin;
    } else if (_boStrategy === 'cold') {
      var coldMax = Math.max.apply(null, _boRows.map(function (rr) { return rr.odds; }));
      isTarget = r.odds === coldMax;
    }
    var stepperCls = isTarget ? ' active' : '';
    var amountCls = r.projected >= _boBaseAmount ? ' bo-amount-hot' : '';

    return '<div class="bo-row' + (idx === _boRows.length - 1 ? '' : '') + '">' +
      '<div class="bo-cell bo-cell-pass"><span class="bo-pass-tag">' + (_passTypes.length > 0 && _passTypes[0] > 1 ? _passTypes[0] + '关' : '单关') + '</span></div>' +
      '<div class="bo-cell bo-cell-desc"><span class="bo-desc-line1">' + (r.matchNum || '') + ' ' + r.matchLabel + '</span><span class="bo-desc-line2">' + r.desc + '(' + r.odds.toFixed(2) + ')</span></div>' +
      '<div class="bo-cell bo-cell-bet"><div class="bo-stepper' + stepperCls + '">' +
        '<button class="bo-step-btn" onclick="boStep(' + idx + ',-10)">-</button>' +
        '<input class="bo-step-input" id="bo-inp-' + idx + '" value="' + r.betCount + '" onchange="boInput(' + idx + ',this.value)">' +
        '<button class="bo-step-btn" onclick="boStep(' + idx + ',10)">+</button>' +
      '</div></div>' +
      '<div class="bo-cell bo-cell-amount' + amountCls + '">' + r.projected.toFixed(2) + '</div>' +
      '</div>';
  }).join('');

  overlay.innerHTML =
    '<div class="ai-modal bo-modal-wrap" onclick="event.stopPropagation()">' +
    '<div class="bo-panel">' +
    '<div class="bo-header">' +
      '<span class="bo-title">奖金优化</span>' +
      '<button class="bo-close" onclick="closeBonusOpt()">&times;</button>' +
    '</div>' +
    '<div class="bo-tab-wrap">' +
      '<div class="bo-tab' + tabBal + '" onclick="boSwitchTab(\'balanced\')">奖金平均</div>' +
      '<div class="bo-tab' + tabHot + '" onclick="boSwitchTab(\'hot\')">博彩保本</div>' +
      '<div class="bo-tab' + tabCold + '" onclick="boSwitchTab(\'cold\')">奖金最高</div>' +
    '</div>' +
    '<div class="bo-desc-row"><span>总预算：<b>' + total.toFixed(2) + '</b> 元</span><span>' + persecond + '</span></div>' +
    '<div class="bo-thead"><div class="bo-th col-pass">过关</div><div class="bo-th col-desc">单注组合</div><div class="bo-th col-bet">注数分布</div><div class="bo-th col-amount">预测奖金</div></div>' +
    '<div class="bo-tbody">' + rowsHtml + '</div>' +
    '<div class="bo-footer"><button class="bet-btn-confirm" onclick="closeBonusOpt()">确认</button></div>' +
    '</div></div>';
}

window.boSwitchTab = function (tab) {
  _boStrategy = tab;
  applyStrategy();

  // ★ 不全量 renderBonusOpt()，仅切换标签 + 更新表格，避免页面跳动
  var overlay = document.getElementById('bonusOptOverlay');
  if (!overlay) return;

  // 1) 切换标签 active
  var tabs = overlay.querySelectorAll('.bo-tab');
  tabs.forEach(function(t) { t.classList.remove('active'); });
  var tabIdx = tab === 'balanced' ? 0 : tab === 'hot' ? 1 : 2;
  if (tabs[tabIdx]) tabs[tabIdx].classList.add('active');

  // 2) 重建表格行
  var total = _boBaseAmount;
  var rowsHtml = _boRows.map(function (r, idx) {
    var isTarget = false;
    if (_boStrategy === 'hot') {
      var hotMin = Math.min.apply(null, _boRows.map(function (rr) { return rr.odds; }));
      isTarget = r.odds === hotMin;
    } else if (_boStrategy === 'cold') {
      var coldMax = Math.max.apply(null, _boRows.map(function (rr) { return rr.odds; }));
      isTarget = r.odds === coldMax;
    }
    var stepperCls = isTarget ? ' active' : '';
    var amountCls = r.projected >= _boBaseAmount ? ' bo-amount-hot' : '';
    return '<div class="bo-row">' +
      '<div class="bo-cell bo-cell-pass"><span class="bo-pass-tag">' + (_passTypes.length > 0 && _passTypes[0] > 1 ? _passTypes[0] + '关' : '单关') + '</span></div>' +
      '<div class="bo-cell bo-cell-desc"><span class="bo-desc-line1">' + (r.matchNum || '') + ' ' + r.matchLabel + '</span><span class="bo-desc-line2">' + r.desc + '(' + r.odds.toFixed(2) + ')</span></div>' +
      '<div class="bo-cell bo-cell-bet"><div class="bo-stepper' + stepperCls + '">' +
        '<button class="bo-step-btn" onclick="boStep(' + idx + ',-10)">-</button>' +
        '<input class="bo-step-input" id="bo-inp-' + idx + '" value="' + r.betCount + '" onchange="boInput(' + idx + ',this.value)">' +
        '<button class="bo-step-btn" onclick="boStep(' + idx + ',10)">+</button>' +
      '</div></div>' +
      '<div class="bo-cell bo-cell-amount' + amountCls + '">' + r.projected.toFixed(2) + '</div>' +
      '</div>';
  }).join('');

  var tbody = overlay.querySelector('.bo-tbody');
  if (tbody) tbody.innerHTML = rowsHtml;
};

window.boStep = function (idx, delta) {
  var row = _boRows[idx];
  row.betCount = Math.max(0, row.betCount + Math.round(delta / 10));
  row.projected = Math.round(row.betCount * 2 * row.odds * 100) / 100;
  var inp = document.getElementById('bo-inp-' + idx);
  if (inp) inp.value = row.betCount;
  // 更新金额列
  updateBoAmounts();
};

window.boInput = function (idx, val) {
  var row = _boRows[idx];
  row.betCount = Math.max(0, parseInt(val) || 0);
  row.projected = Math.round(row.betCount * 2 * row.odds * 100) / 100;
  updateBoAmounts();
};

function updateBoAmounts() {
  _boRows.forEach(function (r, idx) {
    var cell = document.querySelector('#bonusOptOverlay .bo-row:nth-child(' + (idx + 1) + ') .bo-cell-amount');
    if (cell) {
      cell.textContent = r.projected.toFixed(2);
      if (r.projected >= _boBaseAmount) cell.classList.add('bo-amount-hot');
      else cell.classList.remove('bo-amount-hot');
    }
  });
}

function closeBonusOpt() {
  // ★ 将奖金优化分配回写到 _selections
  _boRows.forEach(function(r) {
    var s = _selections[r.id];
    if (s) {
      s.allocation = (r.betCount || 0) * 2;
    }
  });
  updateSessionStore();

  var o = document.getElementById('bonusOptOverlay');
  if (o) { o.classList.remove('active'); o.innerHTML = ''; }
  document.body.style.overflow = '';
  // ★ 重新渲染，让资金分配列立即看到变化
  render();
}
window.closeBonusOpt = closeBonusOpt;


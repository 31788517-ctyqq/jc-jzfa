// ==================== 确认方案页面 ====================
import { api } from '../api.js';
import { loadCSS } from '../vendor.js';
loadCSS('../../css/page-scheme.css');

let _planData = null; // 完整方案数据（包含 matches、金额、过关等）
let _matches = []; // 已选比赛列表
let _selections = []; // 选项列表
let _passTypes = [2]; // 过关类型
let _multiplier = 2; // 倍数（竞彩规则：2-99倍）

// ★ 竞彩木桶原则配置（与 scheme-design.js 保持一致）
const PLAY_LIMITS = { spf: 8, rqspf: 8, jqs: 6, bf: 4, bqc: 4 };
const PLAY_NAMES = { spf: '胜平负', rqspf: '让球胜平负', bf: '比分', jqs: '总进球', bqc: '半全场' };

function getMatchHandicapValue(m, selection) {
  const candidates = [
    m && m._odds && m._odds.rqspf ? m._odds.rqspf.handicap : undefined,
    m && m._odds ? m._odds.handicap : undefined,
    m && m.odds && m.odds.rqspf ? m.odds.rqspf.handicap : undefined,
    m && m.odds ? m.odds.handicap : undefined,
    m ? m.handicap : undefined,
    m ? m.rq : undefined,
    m ? m.concede : undefined,
    selection ? selection.handicap : undefined,
  ];
  for (let i = 0; i < candidates.length; i++) {
    const raw = candidates[i];
    if (raw === null || raw === undefined || raw === '') continue;
    const num = Number(raw);
    if (!isNaN(num)) return num;
  }
  return null;
}

function formatHandicapText(handicap) {
  if (handicap === null || handicap === undefined || handicap === '') return '--';
  const num = Number(handicap);
  if (isNaN(num)) return '--';
  if (num > 0) return '+' + num;
  if (num < 0) return String(num);
  return '0';
}

function renderConfirmTeams(m, selection) {
  const score = m.actualScore || '';
  const middle = score ? '<span class="plan-score-blue">' + score + '</span>' : '<span class="plan-team-vs">vs</span>';
  const handicapText = formatHandicapText(getMatchHandicapValue(m, selection));
  return (
    '<span class="plan-team-home">' +
    (m.homeName || '') +
    '</span>' +
    middle +
    '<span class="plan-team-away">' +
    (m.visitName || '') +
    '</span>' +
    '<span class="plan-handicap-badge">让球 ' +
    handicapText +
    '</span>'
  );
}

function calcConfirmMaxPass() {
  const matchIds = {};
  _selections.forEach(function (s) {
    matchIds[s.matchId] = true;
  });
  const uniqueCount = Object.keys(matchIds).length;
  if (uniqueCount < 2) return 1;

  let minLimit = 8;
  _selections.forEach(function (s) {
    const limit = PLAY_LIMITS[s.playType] || 8;
    if (limit < minLimit) minLimit = limit;
  });
  return Math.min(minLimit, uniqueCount);
}

// ═══ 页面入口 ═══
export function loadConfirmScheme() {
  // 从 sessionStorage 恢复数据
  const raw = sessionStorage.getItem('pendingConfirmPlan');
  if (!raw) {
    var el = document.getElementById('confirmContent');
    if (el)
      el.innerHTML =
        '<div class="hint-box" style="padding:60px 20px;text-align:center;color:#8899aa;">暂无方案数据，请返回方案设计页面重新选择比赛</div>';
    return;
  }
  try {
    _planData = JSON.parse(raw);
  } catch (e) {
    console.error('解析方案数据失败:', e);
    var el = document.getElementById('confirmContent');
    if (el)
      el.innerHTML =
        '<div class="hint-box" style="padding:60px 20px;text-align:center;color:#8899aa;">方案数据异常，请返回方案设计页面重新选择比赛</div>';
    return;
  }
  _matches = _planData.matches || [];
  _selections = _planData.selections || [];
  _passTypes = _planData.passTypes && _planData.passTypes.length ? _planData.passTypes : [2];
  _multiplier = _planData.multiplier || 1;

  render();
}

// ═══ 渲染 ═══
function render() {
  const el = document.getElementById('confirmContent');
  if (!el) return;

  // 计算统计数据
  const uniqueMatchIds = {};
  _selections.forEach(function (s) {
    uniqueMatchIds[s.matchId] = true;
  });
  const uniqueCount = Object.keys(uniqueMatchIds).length;

  const baseBets = calcBets(uniqueCount);
  const bets = _planData.optimizedBets != null ? _planData.optimizedBets : baseBets;
  const baseAmount = baseBets * 2 * _multiplier;
  // ★ 若奖金优化中调整了计划购买金额，则使用调整后的金额
  const amount = _planData.planAmount != null ? _planData.planAmount : baseAmount;
  // ★ 若从奖金优化弹窗带回了预计奖金，直接用它（弹窗内已正确计算）
  const calcWin = calcMaxWin(amount, bets);
  const maxWin = typeof calcWin === 'number' ? calcWin : calcWin && calcWin.value != null ? calcWin.value : calcWin;
  // P1+P2: 分层赔率数据（calcMaxWin 返回对象含附加属性）
  const passOdds = (calcWin && calcWin._passOdds) || {};
  const bestProduct = (calcWin && calcWin._bestProduct) || 1;
  const bestProductK = (calcWin && calcWin._bestProductK) || '';

  // 按 matchId 分组（同场多方向分行）
  const groupedSelections = buildGroupedSelections();

  let html = '';

  // 方案预览卡片（plan-card 样式）
  html += renderPlanPreviewCard(bets, amount, maxWin, uniqueCount, groupedSelections);

  // 底部操作栏
  html += renderBottomBar(bets, amount, maxWin, uniqueCount, passOdds, bestProductK);

  el.innerHTML = html;
}

// ═══ 按 matchId 分组 selections ═══
function buildGroupedSelections() {
  const matchMap = {};
  _matches.forEach(function (m) {
    matchMap[m.matchId] = m;
  });

  const groups = [];
  const visited = {};

  _selections.forEach(function (s) {
    if (!visited[s.matchId]) {
      visited[s.matchId] = true;
      groups.push({
        matchId: s.matchId,
        match: matchMap[s.matchId] || {},
        sels: [s],
      });
    } else {
      for (let i = 0; i < groups.length; i++) {
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
  const playLabels = { spf: '胜平负', rqspf: '让球胜平负', bf: '比分', jqs: '总进球', bqc: '半全场' };

  const passLabel =
    _passTypes.length === 1 ? _passTypes[0] + '关' : _passTypes.length > 1 ? _passTypes.join('~') + '关' : '2关';

  // 资金分配：默认均分（若已有 allocation 则用已有的）
  const defaultAllocPerSel = _selections.length > 0 ? Math.round((amount / _selections.length) * 100) / 100 : 0;

  // 构建比赛表格行（同场多方向分行，对阵合并）
  let matchRows = '';
  groupedSelections.forEach(function (g) {
    const m = g.match;
    const numText = m.matchNum || '';

    // 开赛时间
    let matchDateShort = '',
      matchTime = '';
    if (m.timeStr) {
      const tm = m.timeStr.match(/(\d{2}:\d{2})/);
      if (tm) matchTime = tm[1];
      const dm = m.timeStr.match(/(\d{1,2})[\/\-](\d{1,2})/);
      if (dm) matchDateShort = dm[1] + '/' + dm[2];
    }
    const timeDisp = matchDateShort || matchTime ? (matchDateShort + ' ' + matchTime).trim() : '';

    g.sels.forEach(function (s, si) {
      const playLabel = playLabels[s.playType] || s.playType;
      let dirDisplay = s.direction || s.oddsName || '';
      const oddsStr = s.odds != null ? Number(s.odds).toFixed(2) : '--';

      // 让球方向加前缀并补充让球数
      if (s.playType === 'rqspf') {
        dirDisplay = '让' + dirDisplay + '(' + formatHandicapText(getMatchHandicapValue(m, s)) + ')';
      }

      // ★ 获取 Delta 方向
      let deltaArrow = '';
      if (m._odds) {
        const groupedKey = s.playType + 'Delta'; // spfDelta, rqspfDelta, bfDelta, jqsDelta, bqcDelta
        const grouped = m._odds[groupedKey];
        if (grouped) {
          // 确定 fieldName：SPF/RQSPF 用中文方向名，BF/JQS/BQC 直接用方向值
          let fieldName = s.direction || s.oddsName || '';
          if (s.playType === 'rqspf') fieldName = s.direction || s.oddsName || '';
          // SPF: 胜/平/负, RQSPF: 胜/平/负 → 直接用方向名
          // BF/JQS/BQC: label 即是 fieldName
          let deltaDir = grouped[fieldName] || null;
          if (!deltaDir && s.playType === 'bqc') {
            // BQC: 尝试反向映射缩写
            const BQC_MAP_REV = {
              胜胜: 'hh',
              胜平: 'hd',
              胜负: 'ha',
              平胜: 'dh',
              平平: 'dd',
              平负: 'da',
              负胜: 'ah',
              负平: 'ad',
              负负: 'aa',
            };
            const abbr = BQC_MAP_REV[fieldName];
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
        matchRows += renderConfirmTeams(m, s);
      }
      matchRows += '</td>';

      // 投注(赔率)列：每行显示一个方向 + Delta 箭头
      matchRows += '<td class="odds-col">' + dirDisplay + '(' + oddsStr + ')' + deltaArrow + '</td>';

      // ★ 资金分配列
      const allocVal = s.allocation != null ? s.allocation : defaultAllocPerSel;
      matchRows +=
        '<td class="allocation-col"><span class="plan-alloc-val">' +
        allocVal.toFixed(0) +
        '</span><span class="plan-alloc-unit">元</span></td>';

      matchRows += '</tr>';
    });
  });

  let html = '<div class="plan-card" style="margin:12px 16px;">';

  // 头部
  html += '<div class="plan-card-head">';
  html += '<div class="plan-left">';
  html += '<span class="plan-soccer-icon">&#x26BD;</span>';
  html += '<span class="plan-name">我的方案</span>';
  html += '</div>';
  html +=
    '<span class="bonus-opt-badge" onclick="event.stopPropagation();showBonusOptimize()" title="点击查看奖金优化方案">奖金优化</span>';
  html += '</div>';

  // 金额行（3列）
  html += '<div class="plan-amount-row">';
  html +=
    '<div class="plan-amount-col"><div class="plan-amount-label">方案金额</div><div class="plan-amount-value plan-money-value">' +
    amount +
    '<span class="unit">元</span></div></div>';
  html +=
    '<div class="plan-amount-col"><div class="plan-amount-label">预计最高中奖金额</div><div class="plan-amount-value plan-money-value">' +
    maxWin +
    '<span class="unit">元</span></div></div>';
  html +=
    '<div class="plan-amount-col"><div class="plan-amount-label">方案状态</div><div class="plan-amount-value plan-status-pending">未开奖</div></div>';
  html += '</div>';

  // 分割线
  html += '<div class="plan-divider"></div>';

  // 信息网格
  html += '<div class="plan-info-grid">';
  html += '<div class="plan-info-left"><div>玩法</div><div>场数/过关</div><div>注数/倍数</div></div>';
  html +=
    '<div class="plan-info-right"><div>混合投注</div><div>' +
    uniqueCount +
    '场 ' +
    passLabel +
    '</div><div>' +
    bets +
    '注 ×' +
    _multiplier +
    '倍</div></div>';
  html += '</div>';

  // 比赛表格
  html += '<div class="plan-match-section">';
  html +=
    '<table class="plan-match-table score-table"><thead><tr><th>场次</th><th>对阵</th><th>方向(赔率)</th><th>资金分配</th></tr></thead><tbody>';
  html += matchRows;
  html += '</tbody></table></div>';

  // ★ 比分方案元信息（大球率/进攻优势/进球区间/强队方向）
  const isSingleBf =
    uniqueCount === 1 &&
    _selections.length > 0 &&
    _selections.every(function (s) {
      return s.playType === 'bf';
    });
  if (isSingleBf) {
    let sbfBigBall = '--',
      sbfAttack = '--',
      sbfGoal = '--',
      sbfStrong = '--';
    const sbfMeta =
      _planData && _planData.scoreMeta
        ? _planData.scoreMeta
        : _matches.length > 0 && _matches[0]._meta
          ? _matches[0]._meta
          : null;
    if (sbfMeta) {
      sbfBigBall = sbfMeta.bigBallRatio || '--';
      sbfAttack = sbfMeta.attackAdvantage || '--';
      sbfGoal = sbfMeta.goalRange || '--';
      sbfStrong = sbfMeta.strongSide || '--';
    }
    html +=
      '<div class="plan-score-meta"><span>大球率 ' +
      sbfBigBall +
      '%</span><span>进攻优势 ' +
      sbfAttack +
      '</span><span>进球区间 ' +
      sbfGoal +
      '</span><span>强队 ' +
      sbfStrong +
      '</span></div>';
  }

  html += '</div>';
  return html;
}

// ═══ 渲染单个比赛卡片 ═══
function renderMatchCard(m, sel, idx) {
  // 赔率数据
  const odds = m._odds || m.oddsMap || {};
  const spf = odds.spf || {};

  const homeOdds = spf.home != null ? Number(spf.home).toFixed(2) : '--';
  const drawOdds = spf.draw != null ? Number(spf.draw).toFixed(2) : '--';
  const awayOdds = spf.away != null ? Number(spf.away).toFixed(2) : '--';

  // 判断哪个方向被选中
  const isHomeActive = sel.direction === '胜';
  const isDrawActive = sel.direction === '平';
  const isAwayActive = sel.direction === '负';

  const homeCls = 'cfm-opt' + (isHomeActive ? ' active' : '');
  const drawCls = 'cfm-opt' + (isDrawActive ? ' active' : '');
  const awayCls = 'cfm-opt' + (isAwayActive ? ' active' : '');

  // 玩法标签
  const playLabels = { spf: '胜平负', rqspf: '让球胜平负', bf: '比分', jqs: '总进球', bqc: '半全场' };
  const playLabel = playLabels[sel.playType] || sel.playType;
  const matchId = m.matchId || '';

  let html = '<div class="cfm-match-card" data-mid="' + matchId + '">';

  // 顶部删除按钮 + 玩法标签 + 比赛编号
  html += '<div class="cfm-card-top">';
  html += '<span class="cfm-del" onclick="confirmRemoveMatch(\'' + matchId + '\')">&#x2715;</span>';
  html += '<span class="cfm-match-num">' + (m.matchNum || '') + '</span>';
  html += '<span class="cfm-play-tag">' + playLabel + '</span>';
  html += '</div>';

  // 三列对阵 + 赔率
  html += '<div class="cfm-card-body">';
  // 主队列
  html +=
    '<div class="' +
    homeCls +
    '" onclick="confirmTogglePick(\'' +
    matchId +
    "','" +
    (sel.playType || 'spf') +
    "','\胜','" +
    homeOdds +
    '\')">';
  html += '<div class="cfm-opt-team">' + (m.homeName || '') + '</div>';
  html += '<div class="cfm-opt-odds">' + homeOdds + '</div>';
  html += '</div>';
  // 中间列：平 + 联赛时间
  html += '<div class="cfm-vs-wrap">';
  html +=
    '<div class="' +
    drawCls +
    '" onclick="confirmTogglePick(\'' +
    matchId +
    "','" +
    (sel.playType || 'spf') +
    "','\平','" +
    drawOdds +
    '\')">';
  html += '<span class="cfm-opt-label">平</span>';
  html += '<span class="cfm-opt-odds">' + drawOdds + '</span>';
  html += '</div>';
  html += '<div class="cfm-game-info">';
  html += '<span class="cfm-league">' + (m.league || '') + '</span>';
  html += '<span class="cfm-time">' + (m.timeStr || '') + '</span>';
  html += '</div>';
  html += '</div>';
  // 客队列
  html +=
    '<div class="' +
    awayCls +
    '" onclick="confirmTogglePick(\'' +
    matchId +
    "','" +
    (sel.playType || 'spf') +
    "','\负','" +
    awayOdds +
    '\')">';
  html += '<div class="cfm-opt-team">' + (m.visitName || '') + '</div>';
  html += '<div class="cfm-opt-odds">' + awayOdds + '</div>';
  html += '</div>';
  html += '</div>';

  html += '</div>';
  return html;
}

// ═══ 查找某场比赛的选中方向 ═══
function findSelectionByMatchId(matchId) {
  for (let i = 0; i < _selections.length; i++) {
    if (_selections[i].matchId === matchId) return _selections[i];
  }
  return null;
}

// ═══ 底部操作栏 ═══
function renderBottomBar(bets, amount, maxWin, uniqueCount, passOdds, bestProductK) {
  // 过关显示
  let passLabel = '';
  if (_passTypes.length === 1) {
    passLabel = _passTypes[0] + '关';
  } else if (_passTypes.length > 1) {
    passLabel = _passTypes.join('~') + '关';
  } else {
    passLabel = '2关';
  }

  let html = '';
  html += '<div class="cfm-bottom-bar">';
  html += '<div class="cfm-bb-content">';
  // 第一行：过关 + 倍数
  html += '<div class="cfm-bb-row">';
  html += '<div class="cfm-bb-item">';
  html += '<span class="cfm-bb-label">过关</span>';
  html +=
    '<span class="cfm-bb-pass" onclick="confirmShowPassPopup()">' +
    passLabel +
    ' <span class="cfm-bb-arrow">&#x25BE;</span></span>';
  html += '</div>';
  html += '<div class="cfm-bb-item">';
  html += '<span class="cfm-bb-label">倍数</span>';
  html += '<div class="cfm-bb-multi">';
  html += '<button class="cfm-bb-mbtn" onclick="confirmAdjustMultiplier(-1)">-</button>';
  html +=
    '<span class="cfm-bb-mval" id="cfmMultiVal" onclick="confirmShowMultiplierPopup()">' + _multiplier + '</span>';
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
  html += '<span class="cfm-bb-label">预计最高中奖金额</span>';
  // P2: 分层展示 — 多过关时加 tooltip
  const winText = maxWin + '元';
  let pdTooltip = '';
  if (passOdds) {
    const pKeys = Object.keys(passOdds);
    if (pKeys.length > 1) {
      pdTooltip = pKeys
        .map(function (k) {
          const p = passOdds[k];
          return k + '关: ' + p.maxWinPerNote + '元';
        })
        .join('\n');
    }
  }
  html += '<span class="cfm-bb-maxwin"' + (pdTooltip ? ' title="' + pdTooltip + '"' : '') + '>' + winText + '</span>';
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
  let res = 1;
  for (let i = 1; i <= k; i++) {
    res = (res * (n - i + 1)) / i;
  }
  return Math.round(res);
}

// ═══ 辅助：计算 k 关过关的展开注数 ═══
function calcExpandedBets(matchGroups, matchIds, k) {
  const n = matchIds.length;
  if (k > n || k <= 0) return 0;

  let total = 0;
  // 递归生成所有 k-组合索引
  (function gen(start, combo) {
    if (combo.length === k) {
      let product = 1;
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
  const matchGroups = {};
  _selections.forEach(function (s) {
    if (!matchGroups[s.matchId]) matchGroups[s.matchId] = [];
    matchGroups[s.matchId].push(s);
  });
  const matchIds = Object.keys(matchGroups);
  const n = matchIds.length;
  if (n === 0) return 0;
  if (n === 1) {
    return matchGroups[matchIds[0]].length;
  }

  let total = 0;
  _passTypes.forEach(function (k) {
    total += calcExpandedBets(matchGroups, matchIds, k);
  });
  return total || 1;
}

// ═══ 计算有效赔率（同场多选：荷兰式） ═══
function calcEffectiveOdds(oddsArr) {
  const arr = (oddsArr || [])
    .map(function (x) {
      return Number(x) || 0;
    })
    .filter(function (x) {
      return x > 0;
    });
  if (arr.length === 0) return 0;
  if (arr.length === 1) return Math.round(arr[0] * 100) / 100;
  let invSum = 0;
  for (let i = 0; i < arr.length; i++) invSum += 1 / arr[i];
  return invSum > 0 ? Math.round((1 / invSum) * 100) / 100 : 0;
}

// ═══ 计算最高奖金（统一口径：有效赔率×过关乘积×金额/注数约束） ═══
function calcMaxWin(amount, betCount) {
  const matchGroups = {};
  _selections.forEach(function (s) {
    if (!matchGroups[s.matchId]) matchGroups[s.matchId] = [];
    matchGroups[s.matchId].push(s.odds || 1);
  });
  const matchIds = Object.keys(matchGroups);
  const n = matchIds.length;

  // 每场比赛的有效赔率（同场多选走荷兰式）
  const effectiveOddsPerMatch = {};
  matchIds.forEach(function (mid) {
    effectiveOddsPerMatch[mid] = calcEffectiveOdds(matchGroups[mid]);
  });

  // 按过关类型分层计算
  const passOdds = {};
  let bestProduct = 0;
  let bestProductK = 0;
  const singleBetAmount = 2 * _multiplier;

  _passTypes.forEach(function (k) {
    if (k > n) return;
    const sorted = matchIds
      .map(function (mid) {
        return Number(effectiveOddsPerMatch[mid]) || 0;
      })
      .filter(function (x) {
        return x > 0;
      })
      .sort(function (a, b) {
        return b - a;
      });
    if (sorted.length < k) return;

    let product = 1;
    for (let i = 0; i < k; i++) product *= sorted[i];
    product = Math.round(product * 100) / 100;
    passOdds[k] = { bestProduct: product, maxWinPerNote: Math.round(singleBetAmount * product * 100) / 100 };
    if (product > bestProduct) {
      bestProduct = product;
      bestProductK = k;
    }
  });

  const maxWinPerNote = singleBetAmount > 0 ? Math.round(singleBetAmount * bestProduct * 100) / 100 : 0;
  let safeBetCount = Number(betCount);
  if (!(safeBetCount > 0)) safeBetCount = 1;
  let safeAmount = Number(amount);
  if (!(safeAmount > 0)) safeAmount = safeBetCount * singleBetAmount;

  // 预算注数缩放：金额变化会线性影响预计最高奖金
  const baseAmount = safeBetCount * singleBetAmount;
  let budgetScale = baseAmount > 0 ? safeAmount / baseAmount : 1;
  if (!(budgetScale > 0)) budgetScale = 1;
  const maxWin = Math.round(maxWinPerNote * budgetScale * 100) / 100;

  return {
    value: maxWin,
    _maxWinPerNote: maxWinPerNote,
    _budgetScale: budgetScale,
    _passOdds: passOdds,
    _bestProductK: bestProductK,
    _bestProduct: bestProduct,
  };
}

// ═══ 返回方案设计页 ═══
window.goSchemeDesign = function () {
  window.switchTab('scheme');
};

// ═══ 删除一场比赛 ═══
window.confirmRemoveMatch = function (matchId) {
  _selections = _selections.filter(function (s) {
    return s.matchId !== matchId;
  });
  _matches = _matches.filter(function (m) {
    return m.matchId !== matchId;
  });

  if (_matches.length === 0 && _selections.length === 0) {
    // 全部删除，返回方案设计页
    sessionStorage.removeItem('pendingConfirmPlan');
    window.switchTab('scheme');
    return;
  }

  // 更新过关类型（移除超出子比赛数量的过关）
  const uniqueMatchIds = {};
  _selections.forEach(function (s) {
    uniqueMatchIds[s.matchId] = true;
  });
  const uniqueCount = Object.keys(uniqueMatchIds).length;
  _passTypes = _passTypes.filter(function (k) {
    return k <= uniqueCount;
  });
  if (_passTypes.length === 0 && uniqueCount >= 2) _passTypes = [2];
  if (_passTypes.length === 0 && uniqueCount === 1) _passTypes = [1];

  // ★ 删除比赛后，弹窗的优化结果失效，清除之
  if (_planData) {
    delete _planData.planAmount;
    delete _planData.optimizedBets;
    delete _planData.optimizedMaxWin;
  }

  updateSessionStore();
  render();
};

// ═══ 切换选中方向 ═══
window.confirmTogglePick = function (matchId, playType, direction, oddsVal) {
  let existingIdx = -1;
  for (let i = 0; i < _selections.length; i++) {
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
  // ★ 手动调倍数后，弹窗的优化结果失效，清除之
  if (_planData) {
    delete _planData.planAmount;
    delete _planData.optimizedBets;
    delete _planData.optimizedMaxWin;
  }
  updateSessionStore();
  render();
};

// ═══ 倍数弹窗 ═══
let _confirmTempMultiplier = 2;

window.confirmShowMultiplierPopup = function () {
  _confirmTempMultiplier = _multiplier;
  let overlay = document.getElementById('confirmMultiplierOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'confirmMultiplierOverlay';
    overlay.className = 'ssb-overlay';
    overlay.onclick = function (e) {
      if (e.target === overlay) window.confirmCloseMultiplierPopup();
    };
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
  const input = document.getElementById('confirmSsBMultiInput');
  if (input) input.value = _confirmTempMultiplier;
  overlay.classList.add('active');
};

window.confirmCloseMultiplierPopup = function () {
  const overlay = document.getElementById('confirmMultiplierOverlay');
  if (overlay) overlay.classList.remove('active');
};

window.confirmConfirmMultiplierPopup = function () {
  _multiplier = Math.max(2, Math.min(99, parseInt(_confirmTempMultiplier) || 2));
  // ★ 手动调倍数后，弹窗的优化结果失效，清除之
  if (_planData) {
    delete _planData.planAmount;
    delete _planData.optimizedBets;
    delete _planData.optimizedMaxWin;
  }
  window.confirmCloseMultiplierPopup();
  updateSessionStore();
  render();
};

window.confirmSetMultiQuick = function (val) {
  _confirmTempMultiplier = val;
  const input = document.getElementById('confirmSsBMultiInput');
  if (input) input.value = _confirmTempMultiplier;
};

window.confirmInputMultiDigit = function (digit) {
  const input = document.getElementById('confirmSsBMultiInput');
  if (!input) return;
  let current = String(_confirmTempMultiplier);
  if (current === '0') current = digit;
  else if (current.length < 2) current += digit;
  _confirmTempMultiplier = parseInt(current) || 1;
  input.value = _confirmTempMultiplier;
};

window.confirmBackspaceMulti = function () {
  const input = document.getElementById('confirmSsBMultiInput');
  if (!input) return;
  let current = String(_confirmTempMultiplier);
  if (current.length > 1) current = current.slice(0, -1);
  else current = '2';
  _confirmTempMultiplier = parseInt(current) || 1;
  input.value = _confirmTempMultiplier;
};

// ═══ 过关弹窗 ═══
window.confirmShowPassPopup = function () {
  const uniqueMatchIds = {};
  _selections.forEach(function (s) {
    uniqueMatchIds[s.matchId] = true;
  });
  const n = Object.keys(uniqueMatchIds).length;
  if (n < 2) return;

  const matchGroups = {};
  _selections.forEach(function (s) {
    if (!matchGroups[s.matchId]) matchGroups[s.matchId] = [];
    matchGroups[s.matchId].push(s);
  });
  const matchIds = Object.keys(matchGroups);

  let overlay = document.getElementById('confirmPassOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'confirmPassOverlay';
    overlay.className = 'ssb-overlay';
    overlay.onclick = function (e) {
      if (e.target === overlay) overlay.classList.remove('active');
    };
    document.body.appendChild(overlay);
  }

  // ★ 应用木桶原则计算真正的过关上限
  const maxPass = calcConfirmMaxPass();

  // 构建木桶提示信息：说明各玩法上限
  const playTypes = {};
  _selections.forEach(function (s) {
    playTypes[s.playType] = true;
  });
  const playLimitParts = Object.keys(playTypes).map(function (pt) {
    return (PLAY_NAMES[pt] || pt) + '上限' + PLAY_LIMITS[pt] + '场';
  });
  let bucketHint = '';
  if (maxPass < n && maxPass < 8) {
    bucketHint = '（' + playLimitParts.join('+') + ' → 上限' + maxPass + '关）';
  }

  let html = '<div class="ssb-modal ssb-pass-modal">';
  html +=
    '<div class="ssb-modal-title">选择过关方式<button class="ssb-modal-close" onclick="closeConfirmPassPopup()">&#x2715;</button></div>';
  html += '<div class="ssb-pass-hint">当前：' + n + '场，上限：' + maxPass + '关' + bucketHint + '</div>';
  html += '<div class="ssb-pass-list">';
  for (let k = 2; k <= maxPass; k++) {
    const checked = _passTypes.indexOf(k) !== -1;
    const count = calcExpandedBets(matchGroups, matchIds, k) + '注';
    html += '<div class="ssb-pass-item">';
    html +=
      '<label><input type="checkbox"' +
      (checked ? ' checked' : '') +
      ' onchange="confirmTogglePassType(' +
      k +
      ')"> ' +
      k +
      '关</label>';
    html += '<span class="ssb-pass-count">' + count + '</span>';
    html += '</div>';
  }
  html += '</div>';
  html +=
    '<div class="ssb-modal-footer"><button class="ssb-modal-cancel" onclick="closeConfirmPassPopup()">取消</button><button class="ssb-modal-confirm" onclick="confirmConfirmPass()">确定</button></div>';
  html += '</div>';
  overlay.innerHTML = html;
  overlay.classList.add('active');
};

window.confirmTogglePassType = function (k) {
  // ★ 木桶上限过滤：禁止勾选超过玩法上限的过关类型
  const maxPass = calcConfirmMaxPass();
  if (k > maxPass) return;

  const idx = _passTypes.indexOf(k);
  if (idx !== -1) {
    _passTypes.splice(idx, 1);
  } else {
    _passTypes.push(k);
    _passTypes.sort(function (a, b) {
      return a - b;
    });
  }
  updateSessionStore();
};

window.closeConfirmPassPopup = function () {
  const overlay = document.getElementById('confirmPassOverlay');
  if (overlay) overlay.classList.remove('active');
};

window.confirmConfirmPass = function () {
  // ★ 过滤超出木桶上限的过关类型（防止残留脏数据）
  const maxPass = calcConfirmMaxPass();
  _passTypes = _passTypes.filter(function (k) {
    return k <= maxPass;
  });

  if (_passTypes.length === 0) {
    const uniqueMatchIds = {};
    _selections.forEach(function (s) {
      uniqueMatchIds[s.matchId] = true;
    });
    const n = Object.keys(uniqueMatchIds).length;
    _passTypes = [Math.min(n, 2, maxPass)];
  }
  // ★ 过关类型改变后，弹窗的优化结果失效，清除之
  if (_planData) {
    delete _planData.planAmount;
    delete _planData.optimizedBets;
    delete _planData.optimizedMaxWin;
  }
  const overlay = document.getElementById('confirmPassOverlay');
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
  const uniqueMatchIds = {};
  _selections.forEach(function (s) {
    uniqueMatchIds[s.matchId] = true;
  });
  const uniqueMatches = Object.keys(uniqueMatchIds);

  if (uniqueMatches.length === 1) {
    const selMatch = _matches.find(function (m) {
      return m.matchId === uniqueMatches[0];
    });

    // ★ BF/JQS/BQC 天生单关，无需 isSingleGame 标记；SPF/RQSPF 需要单关标记
    const hasSPF_RQSPF = _selections.some(function (s) {
      return s.playType === 'spf' || s.playType === 'rqspf';
    });
    if (hasSPF_RQSPF && (!selMatch || selMatch.isSingleGame !== true)) {
      alert('⚽ 该场比赛未标记为「单关」场次，不支持单关胜平负投注\n\n请至少再选一场比赛组成串关。');
      return;
    }
  }

  // ★ 串关规则：同场比赛只能用同一玩法
  if (uniqueMatches.length >= 2) {
    const _spMap = {};
    for (let _si = 0; _si < _selections.length; _si++) {
      var _s = _selections[_si];
      if (!_spMap[_s.matchId]) {
        _spMap[_s.matchId] = _s.playType;
      } else if (_spMap[_s.matchId] !== _s.playType) {
        const _sm = _matches.find(function (x) {
          return x.matchId === _s.matchId;
        });
        const _sLabel = _sm ? _sm.homeName + ' vs ' + _sm.visitName : _s.matchId;
        alert(
          '⚽ 串关规则：同场比赛只能用同一玩法\n\n' +
            _sLabel +
            ' 已同时选择了 ' +
            (PLAY_NAMES[_spMap[_s.matchId]] || _spMap[_s.matchId]) +
            ' 和 ' +
            (PLAY_NAMES[_s.playType] || _s.playType) +
            '，请统一为同一玩法。',
        );
        return;
      }
    }
  }

  const uniqueCount = uniqueMatches.length;
  const baseBets = calcBets(uniqueCount);
  const bets = _planData.optimizedBets != null ? _planData.optimizedBets : baseBets;
  const baseAmount = baseBets * 2 * _multiplier;
  const amount = _planData.planAmount != null ? _planData.planAmount : baseAmount;
  const calcWin = calcMaxWin(amount, bets);
  const maxWin = typeof calcWin === 'number' ? calcWin : calcWin && calcWin.value != null ? calcWin.value : calcWin;
  // P1+P2: 分层赔率数据（calcMaxWin 返回对象含附加属性）
  const passOdds = (calcWin && calcWin._passOdds) || {};
  const bestProduct = (calcWin && calcWin._bestProduct) || 1;

  // ★ 竞技彩票单张金额上限 20000 元
  if (amount > 20000) {
    alert('⚽ 投注金额 ' + amount + ' 元超过单张彩票 20000 元上限，请减少倍数或调整方案');
    return;
  }

  // ★ 单注最高奖金限额：单场10万 / 2-3场20万 / 4-5场50万 / 6+场100万
  let prizeCap;
  if (uniqueCount === 1) prizeCap = 100000;
  else if (uniqueCount <= 3) prizeCap = 200000;
  else if (uniqueCount <= 5) prizeCap = 500000;
  else prizeCap = 1000000;

  if (maxWin > prizeCap) {
    alert(
      '⚽ 预计奖金 ' +
        maxWin.toFixed(2) +
        ' 元超过 ' +
        (prizeCap / 10000).toFixed(0) +
        ' 万元限额（' +
        uniqueCount +
        '场过关最高奖金限额），请调整方案',
    );
    return;
  }

  const matchDetails = _selections.map(function (s) {
    const m =
      _matches.find(function (x) {
        return x.matchId === s.matchId;
      }) || {};
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

  const plan = {
    type: 'user',
    matches: matchDetails,
    amount: amount,
    multiplier: _multiplier,
    betCount: bets,
    passTypes: _passTypes.length > 0 ? _passTypes : [2],
    note:
      (_passTypes.length > 1 ? '自由过关 ' : _passTypes[0] === 1 ? '单关 ' : '串关方案 ') +
      (_passTypes.length > 1 ? _passTypes.join('关+') + '关' : _passTypes[0] + '关') +
      '，共' +
      bets +
      '注 ×' +
      _multiplier +
      '倍',
    matchCount: Object.keys(
      _selections.reduce(function (acc, s) {
        acc[s.matchId] = true;
        return acc;
      }, {}),
    ).length,
    totalOdds: amount > 0 ? Math.round((maxWin / amount) * 100) / 100 : 0, // P1: 方案总金额口径回报比（避免倍数重复放大）

    passOdds: passOdds, // P1+P2: 分层赔率 {2:{bestProduct, maxWinPerNote}, 3:{...}}
    isWon: null,
    resultIncome: null,
  };

  api('my-plan-save', { plan: plan })
    .then(function () {
      // 清除临时数据
      sessionStorage.removeItem('pendingConfirmPlan');
      // 标记跳转目标为"我的方案"标签
      try {
        sessionStorage.setItem('pendingPlanTab', 'my');
      } catch (e) {}
      window.switchTab('plan');
    })
    .catch(function (e) {
      alert('保存失败: ' + e.message);
    });
};

// ═══ 同步到 sessionStorage ═══
function updateSessionStore() {
  const uniqueMatchIds = {};
  _selections.forEach(function (s) {
    uniqueMatchIds[s.matchId] = true;
  });

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
let _boStrategy = 'balanced'; // balanced | hot | cold
let _boRows = []; // [{ pickId, playType, direction, matchLabel, odds, handicap, betCount }]
let _boBaseAmount = 0;
let _boPlanAmount = 500; // 计划购买金额（元）

window.showBonusOptimize = function () {
  const bets = calcBets(
    Object.keys(
      _selections.reduce(function (acc, s) {
        acc[s.matchId] = true;
        return acc;
      }, {}),
    ).length,
  );
  _boBaseAmount = bets * 2 * (_multiplier || 1);
  if (!_boBaseAmount) _boBaseAmount = 2;

  // 构建行数据：每个选择一行
  _boRows = _selections.map(function (s, idx) {
    const m =
      _matches.find(function (x) {
        return x.matchId === s.matchId;
      }) || {};
    const playLabel = { spf: '', rqspf: '', bf: '比分', jqs: '总进球', bqc: '半全场' }[s.playType] || '';
    const numText = (m.matchNum || '').replace(/^[周一二三四五六日]+/, '');
    const matchLabel = (m.homeName || '') + ' vs ' + (m.visitName || '');
    const dirLabel = (s.playType === 'rqspf' ? '让' : '') + (s.direction || s.oddsName || '');
    const desc = playLabel ? playLabel + ' ' + dirLabel : dirLabel;
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

  if (_boRows.length === 0) {
    alert('暂无方案数据');
    return;
  }

  _boStrategy = 'balanced';
  // ★ 若已有调整过的计划购买金额则沿用，否则用基础金额
  _boPlanAmount = normalizePlanAmountEven(_planData.planAmount != null ? _planData.planAmount : _boBaseAmount || 500);
  // ★ 计算区默认注数：每个选项默认 1 注
  initDefaultBetCount();

  // 弹窗容器
  const old = document.getElementById('bonusOptOverlay');
  if (old) old.remove();
  const overlay = document.createElement('div');
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

function normalizePlanAmountEven(val) {
  const n = Math.max(0, parseInt(val, 10) || 0);
  return n - (n % 2);
}

function getStrategyTargetIndex() {
  if (!_boRows || _boRows.length === 0) return -1;
  let idx = 0;
  if (_boStrategy === 'hot') {
    for (let i = 1; i < _boRows.length; i++) if (_boRows[i].odds < _boRows[idx].odds) idx = i;
    return idx;
  }
  if (_boStrategy === 'cold') {
    for (let j = 1; j < _boRows.length; j++) if (_boRows[j].odds > _boRows[idx].odds) idx = j;
    return idx;
  }
  return 0;
}

function syncBoProjected() {
  _boRows.forEach(function (r) {
    r.betCount = Math.max(0, parseInt(r.betCount, 10) || 0);
    r.projected = Math.round(r.betCount * 2 * (Number(r.odds) || 0) * 100) / 100;
  });
}

function closeBudgetGap() {
  const maxBets = Math.floor(_boPlanAmount / 2);
  const totalBets = _boRows.reduce(function (s, r) {
    return s + (parseInt(r.betCount, 10) || 0);
  }, 0);

  if (totalBets > maxBets) {
    let overflow = totalBets - maxBets;
    const target = getStrategyTargetIndex();
    while (overflow > 0) {
      let changed = false;
      for (let i = 0; i < _boRows.length && overflow > 0; i++) {
        if (i === target) continue;
        if (_boRows[i].betCount > 0) {
          _boRows[i].betCount -= 1;
          overflow -= 1;
          changed = true;
        }
      }
      if (!changed) break;
    }
    while (overflow > 0 && target >= 0 && _boRows[target].betCount > 0) {
      _boRows[target].betCount -= 1;
      overflow -= 1;
    }
  }

  const afterBets = _boRows.reduce(function (s, r) {
    return s + (parseInt(r.betCount, 10) || 0);
  }, 0);
  const gap = maxBets - afterBets;
  if (gap > 0) {
    let targetIdx = getStrategyTargetIndex();
    if (targetIdx < 0) targetIdx = 0;
    _boRows[targetIdx].betCount += gap;
  }
}

function normalizeBoBudget() {
  _boPlanAmount = normalizePlanAmountEven(_boPlanAmount);
  syncBoProjected();
  closeBudgetGap();
  syncBoProjected();
}

function initDefaultBetCount() {
  _boRows.forEach(function (r) {
    r.betCount = 1;
  });
  normalizeBoBudget();
}

function applyStrategy() {
  const total = _boPlanAmount;
  const rows = _boRows;
  const n = rows.length;
  if (n === 0) return;

  if (_boStrategy === 'balanced') {
    // 奖金平均：weight_i = 1/odds_i / sum(1/odds_j)
    let totalInv = 0;
    rows.forEach(function (r) {
      totalInv += 1 / r.odds;
    });
    rows.forEach(function (r) {
      const weight = 1 / r.odds / totalInv;
      r.betCount = Math.round((total * weight) / 2);
      r.projected = Math.round(r.betCount * 2 * r.odds * 100) / 100;
    });
    // 修正取整误差
    const actualTotal = rows.reduce(function (s, r) {
      return s + r.betCount * 2;
    }, 0);
    const diff = total - actualTotal;
    if (diff !== 0 && rows.length > 0) {
      rows[0].betCount += Math.round(diff / 2);
      rows[0].projected = Math.round(rows[0].betCount * 2 * rows[0].odds * 100) / 100;
    }
  } else if (_boStrategy === 'hot') {
    // 博彩保本：热门（最低赔率）最大，其他保本
    // 找热门 = 最低赔率
    let hotIdx = 0;
    for (let i = 1; i < n; i++) {
      if (rows[i].odds < rows[hotIdx].odds) hotIdx = i;
    }
    // 其他行保本：betCount * 2 * odds >= total → betCount = ceil(total / 2 / odds)
    let safeguard = 0;
    rows.forEach(function (r, i) {
      if (i === hotIdx) return;
      r.betCount = Math.ceil(total / 2 / r.odds);
      safeguard += r.betCount * 2;
    });
    const remaining = total - safeguard;
    rows[hotIdx].betCount = Math.max(0, Math.floor(remaining / 2));
    rows.forEach(function (r) {
      r.projected = Math.round(r.betCount * 2 * r.odds * 100) / 100;
    });
  } else if (_boStrategy === 'cold') {
    // 奖金最高：冷门（最高赔率）最大，其他保本
    let coldIdx = 0;
    for (let j = 1; j < n; j++) {
      if (rows[j].odds > rows[coldIdx].odds) coldIdx = j;
    }
    let safeguard2 = 0;
    rows.forEach(function (r, i) {
      if (i === coldIdx) return;
      r.betCount = Math.ceil(total / 2 / r.odds);
      safeguard2 += r.betCount * 2;
    });
    const remaining2 = total - safeguard2;
    rows[coldIdx].betCount = Math.max(0, Math.floor(remaining2 / 2));
    rows.forEach(function (r) {
      r.projected = Math.round(r.betCount * 2 * r.odds * 100) / 100;
    });
  }

  // ★ 预算闭环：金额与注数严格一致（总投入 = 计划购买金额）
  normalizeBoBudget();
}

function renderBonusOpt() {
  const overlay = document.getElementById('bonusOptOverlay');
  if (!overlay) return;
  const total = _boPlanAmount;

  const tabBal = _boStrategy === 'balanced' ? ' active' : '';
  const tabHot = _boStrategy === 'hot' ? ' active' : '';
  const tabCold = _boStrategy === 'cold' ? ' active' : '';

  const persecond = total.toFixed(2) + '元 · ' + _boRows.length + '个选项';

  const rowsHtml = _boRows
    .map(function (r, idx) {
      // 判断基准行（热门/冷门标记）
      let isTarget = false;
      if (_boStrategy === 'hot') {
        const hotMin = Math.min.apply(
          null,
          _boRows.map(function (rr) {
            return rr.odds;
          }),
        );
        isTarget = r.odds === hotMin;
      } else if (_boStrategy === 'cold') {
        const coldMax = Math.max.apply(
          null,
          _boRows.map(function (rr) {
            return rr.odds;
          }),
        );
        isTarget = r.odds === coldMax;
      }
      const stepperCls = isTarget ? ' active' : '';
      const amountCls = r.projected >= _boPlanAmount ? ' bo-amount-hot' : '';

      return (
        '<div class="bo-row' +
        (idx === _boRows.length - 1 ? '' : '') +
        '">' +
        '<div class="bo-cell bo-cell-pass"><span class="bo-pass-tag">' +
        (_passTypes.length > 0 && _passTypes[0] > 1 ? _passTypes[0] + '关' : '单关') +
        '</span></div>' +
        '<div class="bo-cell bo-cell-desc"><span class="bo-desc-line1">' +
        (r.matchNum || '') +
        ' ' +
        r.matchLabel +
        '</span><span class="bo-desc-line2">' +
        r.desc +
        '(' +
        r.odds.toFixed(2) +
        ')</span></div>' +
        '<div class="bo-cell bo-cell-bet"><div class="bo-stepper' +
        stepperCls +
        '">' +
        '<button class="bo-step-btn" onclick="boStep(' +
        idx +
        ',-10)">-</button>' +
        '<input class="bo-step-input" id="bo-inp-' +
        idx +
        '" value="' +
        r.betCount +
        '" onchange="boInput(' +
        idx +
        ',this.value)">' +
        '<button class="bo-step-btn" onclick="boStep(' +
        idx +
        ',10)">+</button>' +
        '</div></div>' +
        '<div class="bo-cell bo-cell-amount' +
        amountCls +
        '">' +
        r.projected.toFixed(2) +
        '</div>' +
        '</div>'
      );
    })
    .join('');

  overlay.innerHTML =
    '<div class="ai-modal bo-modal-wrap" onclick="event.stopPropagation()">' +
    '<div class="bo-panel">' +
    '<div class="bo-header">' +
    '<span class="bo-title">奖金优化</span>' +
    '<button class="bo-close" onclick="closeBonusOpt()">&times;</button>' +
    '</div>' +
    '<div class="bo-tab-wrap">' +
    '<div class="bo-tab' +
    tabBal +
    '" onclick="boSwitchTab(\'balanced\')">奖金平均</div>' +
    '<div class="bo-tab' +
    tabHot +
    '" onclick="boSwitchTab(\'hot\')">博彩保本</div>' +
    '<div class="bo-tab' +
    tabCold +
    '" onclick="boSwitchTab(\'cold\')">奖金最高</div>' +
    '</div>' +
    '<div class="bo-desc-row"><span>总预算：<b>' +
    total.toFixed(2) +
    '</b> 元</span><span>' +
    persecond +
    '</span></div>' +
    '<div class="bo-thead"><div class="bo-th col-pass">过关</div><div class="bo-th col-desc">单注组合</div><div class="bo-th col-bet">注数分布</div><div class="bo-th col-amount">预测奖金</div></div>' +
    '<div class="bo-tbody">' +
    rowsHtml +
    '</div>' +
    '<div class="bo-plan-purchase">' +
    '<span class="bo-plan-label">计划购买</span>' +
    '<div class="bo-plan-stepper">' +
    '<button class="bo-plan-btn" onclick="boPlanStep(-10)">-</button>' +
    '<input class="bo-plan-input" id="boPlanInput" value="' +
    _boPlanAmount +
    '" onchange="boPlanInput(this.value)">' +
    '<button class="bo-plan-btn" onclick="boPlanStep(10)">+</button>' +
    '</div>' +
    '<span class="bo-plan-unit">元</span>' +
    '</div>' +
    '<div class="bo-plan-summary">共<b>' +
    _boPlanAmount +
    '</b>元  预计奖金:<span class="bo-plan-prize">' +
    calcPlanPrizeRange() +
    '</span></div>' +
    '<div class="bo-footer"><button class="bet-btn-confirm" onclick="closeBonusOpt()">确认</button></div>' +
    '</div></div>';
}

function calcPlanPrizeRange() {
  if (!_boRows.length) return '-';
  let minP = Infinity,
    maxP = -Infinity;
  _boRows.forEach(function (r) {
    if (r.projected < minP) minP = r.projected;
    if (r.projected > maxP) maxP = r.projected;
  });
  if (minP === Infinity) return '-';
  return minP.toFixed(2) + '~' + maxP.toFixed(2) + '元';
}

function updateBoPlanSummary() {
  const summary = document.querySelector('#bonusOptOverlay .bo-plan-summary');
  if (summary) {
    summary.innerHTML =
      '共<b>' + _boPlanAmount + '</b>元  预计奖金:<span class="bo-plan-prize">' + calcPlanPrizeRange() + '</span>';
  }
}

window.boPlanStep = function (delta) {
  _boPlanAmount = normalizePlanAmountEven(Math.max(0, _boPlanAmount + delta));
  applyStrategy();
  renderBonusOpt();
};

window.boPlanInput = function (val) {
  _boPlanAmount = normalizePlanAmountEven(Math.max(0, parseInt(val) || 0));
  applyStrategy();
  renderBonusOpt();
};

window.boSwitchTab = function (tab) {
  _boStrategy = tab;
  applyStrategy();

  // ★ 不全量 renderBonusOpt()，仅切换标签 + 更新表格，避免页面跳动
  const overlay = document.getElementById('bonusOptOverlay');
  if (!overlay) return;

  // 1) 切换标签 active
  const tabs = overlay.querySelectorAll('.bo-tab');
  tabs.forEach(function (t) {
    t.classList.remove('active');
  });
  const tabIdx = tab === 'balanced' ? 0 : tab === 'hot' ? 1 : 2;
  if (tabs[tabIdx]) tabs[tabIdx].classList.add('active');

  // 2) 重建表格行
  const total = _boBaseAmount;
  const rowsHtml = _boRows
    .map(function (r, idx) {
      let isTarget = false;
      if (_boStrategy === 'hot') {
        const hotMin = Math.min.apply(
          null,
          _boRows.map(function (rr) {
            return rr.odds;
          }),
        );
        isTarget = r.odds === hotMin;
      } else if (_boStrategy === 'cold') {
        const coldMax = Math.max.apply(
          null,
          _boRows.map(function (rr) {
            return rr.odds;
          }),
        );
        isTarget = r.odds === coldMax;
      }
      const stepperCls = isTarget ? ' active' : '';
      const amountCls = r.projected >= _boPlanAmount ? ' bo-amount-hot' : '';
      return (
        '<div class="bo-row">' +
        '<div class="bo-cell bo-cell-pass"><span class="bo-pass-tag">' +
        (_passTypes.length > 0 && _passTypes[0] > 1 ? _passTypes[0] + '关' : '单关') +
        '</span></div>' +
        '<div class="bo-cell bo-cell-desc"><span class="bo-desc-line1">' +
        (r.matchNum || '') +
        ' ' +
        r.matchLabel +
        '</span><span class="bo-desc-line2">' +
        r.desc +
        '(' +
        r.odds.toFixed(2) +
        ')</span></div>' +
        '<div class="bo-cell bo-cell-bet"><div class="bo-stepper' +
        stepperCls +
        '">' +
        '<button class="bo-step-btn" onclick="boStep(' +
        idx +
        ',-10)">-</button>' +
        '<input class="bo-step-input" id="bo-inp-' +
        idx +
        '" value="' +
        r.betCount +
        '" onchange="boInput(' +
        idx +
        ',this.value)">' +
        '<button class="bo-step-btn" onclick="boStep(' +
        idx +
        ',10)">+</button>' +
        '</div></div>' +
        '<div class="bo-cell bo-cell-amount' +
        amountCls +
        '">' +
        r.projected.toFixed(2) +
        '</div>' +
        '</div>'
      );
    })
    .join('');

  const tbody = overlay.querySelector('.bo-tbody');
  if (tbody) tbody.innerHTML = rowsHtml;
  // 更新计划购买摘要（切换策略后预测奖金会变）
  updateBoPlanSummary();
};

function redistributeExcept(fixedIdx) {
  const fixedRow = _boRows[fixedIdx];
  let fixedAmount = fixedRow.betCount * 2;
  let remaining = _boPlanAmount - fixedAmount;
  const otherRows = _boRows.filter(function (_, i) {
    return i !== fixedIdx;
  });
  const otherCount = otherRows.length;

  if (otherCount === 0) {
    if (fixedAmount > _boPlanAmount) {
      fixedRow.betCount = Math.max(0, Math.floor(_boPlanAmount / 2));
    }
    normalizeBoBudget();
    return;
  }

  if (remaining < 0) {
    fixedRow.betCount = Math.max(0, Math.floor(_boPlanAmount / 2));
    fixedAmount = fixedRow.betCount * 2;
    remaining = _boPlanAmount - fixedAmount;
  }

  let totalInv = 0;
  otherRows.forEach(function (r) {
    totalInv += 1 / r.odds;
  });

  otherRows.forEach(function (r) {
    const weight = totalInv > 0 ? 1 / r.odds / totalInv : 1 / otherCount;
    r.betCount = Math.round((remaining * weight) / 2);
  });

  const actualOtherTotal = otherRows.reduce(function (s, r) {
    return s + r.betCount * 2;
  }, 0);
  const diff = remaining - actualOtherTotal;
  if (diff !== 0 && otherRows.length > 0) {
    otherRows[0].betCount += Math.round(diff / 2);
  }

  normalizeBoBudget();
}

window.boStep = function (idx, delta) {
  const row = _boRows[idx];
  row.betCount = Math.max(0, row.betCount + Math.round(delta / 10));
  redistributeExcept(idx);
  renderBonusOpt();
};

window.boInput = function (idx, val) {
  const row = _boRows[idx];
  row.betCount = Math.max(0, parseInt(val) || 0);
  redistributeExcept(idx);
  renderBonusOpt();
};

function closeBonusOpt() {
  // ★ 关闭前先做预算闭环，确保金额/注数一致
  normalizeBoBudget();

  // ★ 将奖金优化分配回写到 _selections
  _boRows.forEach(function (r) {
    const s = _selections[r.id];
    if (s) {
      s.allocation = (r.betCount || 0) * 2;
    }
  });
  // ★ 保存计划购买金额和优化注数到方案数据（不覆盖统一奖金口径）
  const totalBets = _boRows.reduce(function (s, r) {
    return s + (r.betCount || 0);
  }, 0);
  _planData.planAmount = _boPlanAmount;
  _planData.optimizedBets = totalBets;
  delete _planData.optimizedMaxWin;
  updateSessionStore();

  const o = document.getElementById('bonusOptOverlay');
  if (o) {
    o.classList.remove('active');
    o.innerHTML = '';
  }
  document.body.style.overflow = '';
  // ★ 重新渲染，让资金分配列立即看到变化
  render();
}
window.closeBonusOpt = closeBonusOpt;

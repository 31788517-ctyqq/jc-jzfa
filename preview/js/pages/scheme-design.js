// ==================== 方案设计页面 (按设计图重构) ====================
import { api } from '../api.js';
import { formatDate, WEEK_NAMES } from '../utils.js';
import { loadCSS } from '../vendor.js';
loadCSS('../../css/page-scheme.css');

let _matches = []; // 比赛列表
let _selections = []; // [{matchId, playType, direction, odds, oddsName, handicap}]
let _activePlayType = 'mixed'; // mixed|spf|rqspf|bf|jqs|bqc
let _multiplier = 2; // 投注倍数（竞彩规则：2-99倍）
let _passTypes = [2]; // 过关类型数组，默认 2关，支持多选 [2,3,4,...]
let _schemeDateOffset = 0;
let _schemeDate = '';
let _matchDirections = {}; // { matchId: [{rank, direction, expertCount}] } ★ 推荐排行榜Top5
let _loadMatchesToken = 0; // ★ 防止异步回包串页

// ═══ 竞彩规则：木桶原则上限 ═══
const PLAY_LIMITS = { spf: 8, rqspf: 8, jqs: 6, bf: 4, bqc: 4 };
const PLAY_NAMES = { spf: '胜平负', rqspf: '让球胜平负', bf: '比分', jqs: '总进球', bqc: '半全场', mixed: '混合过关' };

// ★ 推荐方向 → 赔率按钮映射（用于黄色底色标记 + 排名数字）
function parseDirectionCards(dir) {
  if (!dir) return [];
  const s = String(dir).trim();
  const results = [];
  if (s.indexOf('总进球') === 0) {
    var after = s.replace(/^总进球-/, '');
    after.split(/[、,]/).forEach(function (g) {
      const c = g.trim().replace('球', '');
      if (c) results.push({ playType: 'jqs', label: c });
    });
    return results;
  }
  if (s.indexOf('半全场') === 0) {
    var after = s.replace(/^半全场-/, '');
    after.split(/[、,]/).forEach(function (h) {
      const c = h.trim();
      if (c) results.push({ playType: 'bqc', label: c });
    });
    return results;
  }
  if (s.indexOf('比分') === 0) {
    var after = s.replace(/^比分-/, '');
    after.split(/[、,]/).forEach(function (sc) {
      const c = sc.trim();
      if (c) results.push({ playType: 'bf', label: c });
    });
    return results;
  }
  s.split(/[、,]/).forEach(function (p) {
    const clean = p.trim();
    if (clean === '让胜' || clean === '让平' || clean === '让负') results.push({ playType: 'rqspf', label: clean });
    else if (clean === '胜' || clean === '平' || clean === '负') results.push({ playType: 'spf', label: clean });
  });
  return results;
}
function buildBtnRankMap(directions) {
  const map = {};
  directions.forEach(function (item) {
    const cards = parseDirectionCards(item.direction);
    cards.forEach(function (card) {
      const key = card.playType + '|' + card.label;
      if (map[key] == null || item.rank < map[key]) map[key] = item.rank;
    });
  });
  return map;
}

// ★ 推荐方向 → 赔率按钮映射（旧兼容，保留）
const RECOMM_TO_BTN = {
  胜: [{ playType: 'spf', dirName: '胜' }],
  平: [{ playType: 'spf', dirName: '平' }],
  负: [{ playType: 'spf', dirName: '负' }],
  让胜: [{ playType: 'rqspf', dirName: '胜' }],
  让平: [{ playType: 'rqspf', dirName: '平' }],
  让负: [{ playType: 'rqspf', dirName: '负' }],
  胜平: [
    { playType: 'spf', dirName: '胜' },
    { playType: 'spf', dirName: '平' },
  ],
  平负: [
    { playType: 'spf', dirName: '平' },
    { playType: 'spf', dirName: '负' },
  ],
  胜负: [
    { playType: 'spf', dirName: '胜' },
    { playType: 'spf', dirName: '负' },
  ],
};

// ═══ 工具函数 ═══
function escStr(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}
function normalizeMatchId(v) {
  return v == null ? '' : String(v);
}
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

// ═══ 木桶上限计算 ═══
function calcMaxPass() {
  const uniqueMatchIds = {};
  _selections.forEach(function (s) {
    uniqueMatchIds[s.matchId] = true;
  });
  const uniqueCount = Object.keys(uniqueMatchIds).length;
  // ★ 单关允许（1关），返回1表示可投单关
  if (uniqueCount < 2) return 1;

  let minLimit = 8;
  _selections.forEach(function (s) {
    const limit = PLAY_LIMITS[s.playType] || 8;
    if (limit < minLimit) minLimit = limit;
  });
  return Math.min(minLimit, uniqueCount);
}

// ═══ 自动推导过关类型（场次变化时）═══
function derivePassTypes() {
  const uniqueMatchIds = {};
  _selections.forEach(function (s) {
    uniqueMatchIds[s.matchId] = true;
  });
  const n = Object.keys(uniqueMatchIds).length;
  const maxPass = calcMaxPass();

  if (n < 2) {
    _passTypes = [1]; // 单关（必须为 [1]，空数组会导致 calcMaxWin 无法计算赔率乘积）
  } else {
    // 默认勾选 2关 到 min(n, maxPass, 5)
    const upper = Math.min(n, maxPass, 5);
    _passTypes = [];
    for (let i = 2; i <= upper; i++) _passTypes.push(i);
  }
}

// ═══ 计算总注数 ═══
function calcTotalBets() {
  const matchGroups = {};
  _selections.forEach(function (s) {
    if (!matchGroups[s.matchId]) matchGroups[s.matchId] = [];
    matchGroups[s.matchId].push(s);
  });
  const matchIds = Object.keys(matchGroups);
  const n = matchIds.length;
  if (n === 0) return 0;
  if (n === 1) {
    // 单关：该场比赛有几个选项就几注
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

// ═══ 计算金额和奖金 ═══
function calcAmountAndPrize() {
  const matchGroups = {};
  _selections.forEach(function (s) {
    if (!matchGroups[s.matchId]) matchGroups[s.matchId] = [];
    matchGroups[s.matchId].push(s.odds || 1);
  });
  const matchIds = Object.keys(matchGroups);

  const bets = calcTotalBets();
  const amount = bets * 2 * _multiplier;

  // 每场比赛的有效赔率（同场多选走荷兰式）
  const effectiveOddsPerMatch = {};
  matchIds.forEach(function (mid) {
    effectiveOddsPerMatch[mid] = calcEffectiveOdds(matchGroups[mid]);
  });

  // P2: 按过关类型分层计算最佳赔率乘积
  const passOdds = {};
  let bestProduct = 0;
  let bestProductK = 0;

  _passTypes.forEach(function (k) {
    if (k > matchIds.length) return;
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

    passOdds[k] = {
      bestProduct: product,
      maxWinPerNote: Math.round(2 * _multiplier * product * 100) / 100,
    };
    if (product > bestProduct) {
      bestProduct = product;
      bestProductK = k;
    }
  });

  // 最高奖金 = 单注金额 × 最佳赔率乘积
  const singleBetAmount = 2 * _multiplier;
  const maxWin = Math.round(singleBetAmount * bestProduct * 100) / 100;

  // P1: totalOdds = 单注最高回报比（maxWin / (betCount × 2元)）
  const totalOdds = bets > 0 ? Math.round((maxWin / (bets * 2)) * 100) / 100 : 0;

  return {
    bets: bets,
    amount: amount,
    maxWin: maxWin,
    totalOdds: totalOdds,
    passOdds: passOdds,
    bestProductK: bestProductK,
  };
}

// ═══ 页面入口 ═══
export function loadSchemeDesign() {
  _schemeDateOffset = 0;
  _activePlayType = 'mixed';
  // 恢复标签活跃状态
  document.querySelectorAll('#schemePlayTabs .filter-tag').forEach(function (t) {
    t.classList.toggle('active', t.getAttribute('data-type') === 'mixed');
  });
  updateSchemeDate();
  loadStats();
  loadMatches();
}

// ═══ 日期 ═══
function updateSchemeDate() {
  const d = new Date();
  d.setDate(d.getDate() + _schemeDateOffset);
  _schemeDate = formatDate(d);
  const el = document.getElementById('schemeDateBar');
  if (!el) return;
  const today = formatDate(new Date());
  const prefix = _schemeDate === today ? '今天 ' : '';
  const mmdd = _schemeDate.slice(5).replace('-', '/');
  const week = WEEK_NAMES[new Date(_schemeDate).getDay()];
  el.innerHTML =
    '<span class="date-current">&#x1F4C5; ' +
    week +
    ' ' +
    prefix +
    mmdd +
    ' <span id="schemeMatchTotal">共0场比赛</span></span>';
}

window.shiftSchemeDate = function (delta) {
  _schemeDateOffset += delta;
  updateSchemeDate();
  loadMatches();
};

// ═══ 统计卡片（用户特别要求，保留） ═══
function loadStats() {
  api('my-plan-stats', {})
    .then(function (stats) {
      const el = document.getElementById('schemeStats');
      if (!el) return;
      const incomeStr = stats.income >= 0 ? '+' + stats.income : String(stats.income);
      const incomeCls = stats.income >= 0 ? 'scheme-stat-pos' : 'scheme-stat-neg';
      el.innerHTML =
        '<div class="scheme-stat-item" onclick="try{sessionStorage.setItem(\'pendingPlanTab\',\'my\');}catch(e){}switchTab(\'plan\')"><div class="scheme-stat-val">' +
        (stats.count || 0) +
        '</div><div class="scheme-stat-lbl">历史方案</div></div>' +
        '<div class="scheme-stat-div"></div>' +
        '<div class="scheme-stat-item"><div class="scheme-stat-val ' +
        incomeCls +
        '">' +
        incomeStr +
        '</div><div class="scheme-stat-lbl">方案收入</div></div>' +
        '<div class="scheme-stat-div"></div>' +
        '<div class="scheme-stat-item"><div class="scheme-stat-val">' +
        (stats.hitRate || 0) +
        '%</div><div class="scheme-stat-lbl">命中率</div></div>';
    })
    .catch(function () {
      const el = document.getElementById('schemeStats');
      if (el)
        el.innerHTML =
          '<div class="scheme-stat-item"><div class="scheme-stat-val">0</div><div class="scheme-stat-lbl">历史方案</div></div>' +
          '<div class="scheme-stat-div"></div>' +
          '<div class="scheme-stat-item"><div class="scheme-stat-val">0</div><div class="scheme-stat-lbl">方案收入</div></div>' +
          '<div class="scheme-stat-div"></div>' +
          '<div class="scheme-stat-item"><div class="scheme-stat-val">0%</div><div class="scheme-stat-lbl">命中率</div></div>';
    });
}

// ═══ 比赛列表 ═══
function loadMatches() {
  const el = document.getElementById('schemeMatchList');
  if (!el) return;
  const token = ++_loadMatchesToken;
  _matchDirections = {}; // 切日期时清空推荐映射，避免旧高亮残留
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载场次中...</div>';

  // ★ 方案设计页仅显示未开赛比赛（hideFinished: true）
  api('match-list', { date: _schemeDate, hideFinished: true })
    .then(function (data) {
      if (token !== _loadMatchesToken) return;

      const now = new Date();
      // ★ 前端双重校验：过滤已开赛/已结束比赛（兜底服务端未及时更新）
      _matches = (data || []).filter(function (m) {
        if (m.matchStatus !== 0) return false;
        // 补充：解析开赛时间，排除已过期的比赛
        if (m.startTime) {
          const parts = String(m.startTime).match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
          if (parts) {
            const matchDate = new Date(
              parseInt(_schemeDate.slice(0, 4)),
              parseInt(parts[1]) - 1,
              parseInt(parts[2]),
              parseInt(parts[3]),
              parseInt(parts[4]),
            );
            if (matchDate <= now) return false;
          }
        }
        return true;
      });

      // 按开赛时间排序（越近的越靠前）
      _matches.sort(function (a, b) {
        const ta = a.startTime || '';
        const tb = b.startTime || '';
        return ta.localeCompare(tb);
      });

      const totalEl = document.getElementById('schemeMatchTotal');
      if (totalEl) totalEl.textContent = '共' + _matches.length + '场比赛';

      // ★ 首屏优化：先渲染卡片，再异步补赔率/高亮方向
      renderMatchList();
      applySchemeHighlights();

      const matchIds = _matches
        .map(function (m) {
          return m.matchId || m.id;
        })
        .filter(Boolean);
      if (matchIds.length === 0) return;

      // 1) 异步补赔率（不阻塞首屏）
      api('batch-match-odds', { matchIds: matchIds, date: _schemeDate })
        .then(function (oddsMap) {
          if (token !== _loadMatchesToken) return;
          _matches.forEach(function (m) {
            m._odds = (oddsMap && oddsMap[m.matchId || m.id]) || null;
          });
          _reRenderSafe();
        })
        .catch(function () {});

      // 2) 异步补推荐方向高亮（不阻塞首屏）
      loadAllDirections(matchIds)
        .then(function () {
          if (token !== _loadMatchesToken) return;
          _reRenderSafe();
        })
        .catch(function () {});
    })
    .catch(function (e) {
      if (token !== _loadMatchesToken) return;
      if (el) el.innerHTML = '<div class="hint-box">加载失败: ' + (e && e.message) + '</div>';
    });
}

// ★ 批量加载所有比赛的Top5推荐方向（并发受控，避免瞬时打爆接口）
function loadAllDirections(matchIds) {
  const queue = (matchIds || []).slice();
  const workerCount = Math.min(6, queue.length || 0);
  if (workerCount <= 0) return Promise.resolve();

  function worker() {
    const mid = queue.shift();
    if (!mid) return Promise.resolve();
    return api('match-top-directions', { matchId: mid })
      .then(function (r) {
        if (r && r.directions) _matchDirections[mid] = r.directions;
      })
      .catch(function () {})
      .then(worker);
  }

  const tasks = [];
  for (let i = 0; i < workerCount; i++) tasks.push(worker());
  return Promise.all(tasks);
}

// ★ 高亮赔率按钮：注入排名数字 + 黄色底色
function applySchemeHighlights() {
  const cards = document.querySelectorAll('#schemeMatchList .sodds-btn');
  cards.forEach(function (btn) {
    // 清除旧 badge
    const old = btn.querySelector('.scheme-rank-badge');
    if (old) old.remove();
    btn.classList.remove('rank-highlight');

    const mid = btn.getAttribute('data-mid');
    const pt = btn.getAttribute('data-play-type');
    const lb = btn.getAttribute('data-label');
    if (!mid || !pt || !lb) return;

    const dirs = _matchDirections[mid];
    if (!dirs || !dirs.length) return;

    const rankMap = buildBtnRankMap(dirs);
    const key = pt + '|' + lb;
    const rank = rankMap[key];
    if (rank != null) {
      btn.classList.add('rank-highlight');
      const badge = document.createElement('span');
      badge.className = 'scheme-rank-badge';
      badge.textContent = rank;
      btn.appendChild(badge);
    }
  });
}

// ═══ 防跳动安全渲染 ═══
function _reRenderSafe() {
  const st = window.scrollY || document.documentElement.scrollTop;
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden'; // ★ 锁死滚动
  renderMatchList();
  applySchemeHighlights();
  window.scrollTo(0, st); // 同步恢复位置
  // 下一帧恢复 overflow，让浏览器在无滚动状态下完成绘制
  requestAnimationFrame(function () {
    document.documentElement.style.overflow = prevOverflow || '';
  });
}

// ═══ 玩法切换 ═══
window.switchSchemePlay = function (type) {
  _activePlayType = type;
  document.querySelectorAll('#schemePlayTabs .filter-tag').forEach(function (t) {
    t.classList.toggle('active', t.getAttribute('data-type') === type);
  });
  // ★ BF/JQS/BQC 模式下预加载赔率数据
  if (type === 'bf' || type === 'jqs' || type === 'bqc') {
    preloadOtherOdds(type);
  }
  _reRenderSafe();
};

// ★ 预加载比分/总进球/半全场赔率（避免弹窗内数据为空）
function preloadOtherOdds(playType) {
  const ids = _matches
    .map(function (m) {
      return m.matchId || m.id || '';
    })
    .filter(Boolean);
  if (ids.length === 0) return;
  // 取前10场预加载（避免请求过多）
  const batch = ids.slice(0, 10);
  api('batch-match-odds', { matchIds: batch })
    .then(function (r) {
      if (!r) return;
      _matches.forEach(function (m) {
        const mid = m.matchId || m.id || '';
        const data = r[mid];
        if (data) {
          m._odds = m._odds || {};
          // ★ 同步 isSingleGame（batch-match-odds 返回单关标识，双写兼容）
          if (data.isSingleGame === true) {
            m.isSingleGame = true;
            m._odds.isSingleGame = true;
          }
          if (playType === 'bf') {
            m._odds.bf = data.bf || [];
            m._odds.bfDelta = data.bfDelta || {};
          }
          if (playType === 'jqs') {
            m._odds.jqs = data.jqs || [];
            m._odds.jqsDelta = data.jqsDelta || {};
          }
          if (playType === 'bqc') {
            m._odds.bqc = data.bqc || [];
            m._odds.bqcDelta = data.bqcDelta || {};
          }
        }
      });
      _reRenderSafe(); // 重新渲染以显示预加载的赔率
    })
    .catch(function () {});
}

// ═══ 渲染比赛卡片（按设计图：左侧联赛+编号+时间，右侧对阵+赔率矩阵） ═══
function renderMatchList() {
  const el = document.getElementById('schemeMatchList');
  if (!el) return;
  // ★ 禁用浏览器滚动锚定，防止 innerHTML 替换时页面跳动
  el.style.overflowAnchor = 'none';
  if (_matches.length === 0) {
    const today = formatDate(new Date());
    if (_schemeDate < today) {
      el.innerHTML = '<div class="hint-box">⏰ 该日期比赛已全部结束，请切换到今天或未来日期进行方案设计</div>';
    } else if (_schemeDate > today) {
      el.innerHTML = '<div class="hint-box">📅 ' + _schemeDate + ' 暂无开售比赛，请选择更近的日期</div>';
    } else {
      el.innerHTML = '<div class="hint-box">当日暂无比赛</div>';
    }
    return;
  }

  // ★ 玩法过滤提示
  let filterHint = '';
  if (_activePlayType !== 'mixed') {
    filterHint =
      '<div class="scheme-play-hint">当前玩法：<b>' +
      PLAY_NAMES[_activePlayType] +
      '</b>（上限 ' +
      PLAY_LIMITS[_activePlayType] +
      ' 场），切换玩法标签可查看全部玩法</div>';
  }

  const html =
    filterHint +
    _matches
      .map(function (m) {
        const id = normalizeMatchId(m.matchId || m.id || m.num || m.matchNum || '');
        const odds = m._odds || {};
        const spf = odds.spf || {};
        const rqspf = odds.rqspf || {};
        const handicap = odds.handicap != null ? odds.handicap : m.concede || 0;
        const hcpLabel = handicap > 0 ? '+' + handicap : handicap < 0 ? '' + handicap : '0';
        // ★ 单关标签：match-list 为主，batch-match-odds 兜底
        const isSingleGame = m.isSingleGame === true || (m._odds && m._odds.isSingleGame === true);
        const delta = odds.oddsDelta || {};

        // 时间格式化
        let timeStr = '';
        if (m.startTime) {
          const stParts = m.startTime.match(/(\\d{2})-(\\d{2})\\s+(\\d{2}):(\\d{2})/);
          if (stParts) timeStr = stParts[1] + '-' + stParts[2] + ' ' + stParts[3] + ':' + stParts[4];
          else timeStr = m.startTime;
        }

        // ★ 获取 delta 方向（优先使用 API 返回的按玩法分组 Delta）
        let deltaSpf = odds.spfDelta || {};
        let deltaRqspf = odds.rqspfDelta || {};
        // 兜底：从 raw oddsDelta 解析
        if (Object.keys(deltaSpf).length === 0 && odds.oddsDelta) {
          deltaSpf = getDeltaRaw(odds.oddsDelta, 'spf');
        }
        if (Object.keys(deltaRqspf).length === 0 && odds.oddsDelta) {
          deltaRqspf = getDeltaRaw(odds.oddsDelta, 'rqspf');
        }

        // 赔率矩阵：根据玩法类型决定显示哪些行
        // ★ BF/JQS/BQC 模式下隐藏 SPF/RQ，铺满专用赔率区域
        const showSpfRow = _activePlayType === 'mixed' || _activePlayType === 'spf';
        const showRqRow = _activePlayType === 'mixed' || _activePlayType === 'rqspf';

        // SPF 行：[0]
        let spfRow = '';
        if (showSpfRow) {
          const spfPending = odds.spfStatus === 'pending' && !spf.home && !spf.draw && !spf.away;
          if (spfPending) {
            spfRow =
              '<div class="sodds-row ' +
              (_activePlayType !== 'mixed' && _activePlayType !== 'spf' ? 'sodds-row-dim' : '') +
              '">' +
              '<span class="sodds-hcp">[0]</span>' +
              '<span class="sodds-pending" style="display:flex;align-items:center;justify-content:center;flex:1;color:var(--text3);font-size:12px;padding:8px 0">暂未开售</span>' +
              '</div>';
          } else {
            spfRow =
              '<div class="sodds-row ' +
              (_activePlayType !== 'mixed' && _activePlayType !== 'spf' ? 'sodds-row-dim' : '') +
              '">' +
              '<span class="sodds-hcp">[0]</span>' +
              renderOddsBtn(id, 'spf', '胜', spf.home, handicap, deltaSpf.home) +
              renderOddsBtn(id, 'spf', '平', spf.draw, handicap, deltaSpf.draw) +
              renderOddsBtn(id, 'spf', '负', spf.away, handicap, deltaSpf.away) +
              '</div>';
          }
        }

        // RQSPF 行：[handicap]
        let rqRow = '';
        if (showRqRow) {
          rqRow =
            '<div class="sodds-row ' +
            (_activePlayType !== 'mixed' && _activePlayType !== 'rqspf' ? 'sodds-row-dim' : '') +
            '">' +
            '<span class="sodds-hcp rq">[' +
            hcpLabel +
            ']</span>' +
            renderOddsBtn(id, 'rqspf', '胜', rqspf.home, handicap, deltaRqspf.home) +
            renderOddsBtn(id, 'rqspf', '平', rqspf.draw, handicap, deltaRqspf.draw) +
            renderOddsBtn(id, 'rqspf', '负', rqspf.away, handicap, deltaRqspf.away) +
            '</div>';
        }

        // 单关标签
        const singleBadge = isSingleGame ? '<span class="smc-single-badge" title="本场支持单关投注">单关</span>' : '';

        return (
          '<div class="scheme-match-card" data-mid="' +
          id +
          '">' +
          '<div class="smc-body">' +
          '<div class="smc-left">' +
          '<span class="smc-league">' +
          (m.leagueName || '') +
          '</span>' +
          '<span class="smc-num">' +
          (m.num || m.matchNum || '') +
          '</span>' +
          singleBadge +
          '<span class="smc-time">' +
          (timeStr || m.date || '') +
          '</span>' +
          renderOtherSection(id) +
          '</div>' +
          '<div class="smc-right">' +
          '<div class="smc-teams"><span>' +
          (m.homeName || '') +
          '</span><span class="smc-vs">VS</span><span>' +
          (m.visitName || '') +
          '</span></div>' +
          '<div class="sodds-matrix">' +
          (renderSpecialOddsRow(m, id) || spfRow + rqRow) +
          '</div>' +
          '</div>' +
          '</div>' +
          '<div class="smc-footer">' +
          '<button class="smc-ai-btn" onclick="event.stopPropagation();showAIPrediction(\'' +
          id +
          '\')">AI分析</button>' +
          '<button class="smc-gs-btn" onclick="event.stopPropagation();showGongshoudao(\'' +
          id +
          "','" +
          escStr(m.leagueName || '') +
          "','" +
          escStr(m.homeName || '') +
          "','" +
          escStr(m.visitName || '') +
          "','" +
          escStr(m.num || m.matchNum || '') +
          "','" +
          escStr(m.startTime || '') +
          '\')">功守道</button>' +
          '</div></div>'
        );
      })
      .join('');
  el.innerHTML = html;
  derivePassTypes();
  updateSummary();
}

// ═══ 赔率按钮（方向在上，赔率在下，选中高亮，赔率箭头） ═══
function renderOddsBtn(matchId, playType, dirName, oddsVal, handicap, deltaDir) {
  // ★ 玩法过滤：非当前玩法且非混合模式时按钮不可交互
  const isPlayActive = _activePlayType === 'mixed' || playType === _activePlayType;

  // ★ 多选高亮：遍历所有选择
  const isActive = _selections.some(function (s) {
    return (
      normalizeMatchId(s.matchId) === normalizeMatchId(matchId) && s.playType === playType && s.direction === dirName
    );
  });
  let cls = 'sodds-btn' + (isActive ? ' active' : '');
  if (!isPlayActive && _activePlayType !== 'mixed') cls += ' sodds-btn-dim';

  const oddsStr = oddsVal != null ? Number(oddsVal).toFixed(2) : '--';

  // ★ 赔率变动箭头
  let arrowHtml = '';
  if (deltaDir === 'up') {
    arrowHtml = '<span class="sodds-arrow-up">&#9650;</span>';
  } else if (deltaDir === 'down') {
    arrowHtml = '<span class="sodds-arrow-down">&#9660;</span>';
  }

  let clickAttr = '';
  if (isPlayActive) {
    clickAttr =
      ' onclick="selectSchemeOdds(\'' +
      matchId +
      "','" +
      playType +
      "','" +
      dirName +
      "'," +
      oddsVal +
      ',' +
      handicap +
      ')"';
  }

  return (
    '<button class="' +
    cls +
    '"' +
    ' data-mid="' +
    matchId +
    '" data-play-type="' +
    playType +
    '" data-label="' +
    escStr(dirName) +
    '"' +
    clickAttr +
    '>' +
    '<span class="sodds-dir">' +
    dirName +
    '</span>' +
    '<span class="sodds-val">' +
    oddsStr +
    arrowHtml +
    '</span></button>'
  );
}

// ═══ 获取赔率变动方向（扩展支持各玩法前缀） ═══
function getDeltaForField(delta, playPrefix) {
  if (!delta || Object.keys(delta).length === 0) return {};
  const result = {};
  const directions = ['home', 'draw', 'away'];
  directions.forEach(function (d) {
    const key = playPrefix + '.' + d;
    if (delta[key]) result[d] = delta[key]; // 'up', 'down', or 'flat'
  });
  return result;
}

// ★ 从 raw oddsDelta（dot 格式）解析 delta
function getDeltaRaw(rawDelta, playPrefix) {
  if (!rawDelta || Object.keys(rawDelta).length === 0) return {};
  const result = {};
  const directions = ['home', 'draw', 'away'];
  directions.forEach(function (d) {
    const key = playPrefix + '.' + d;
    if (rawDelta[key]) result[d] = rawDelta[key];
  });
  return result;
}

// ★ 获取任意玩法字段的 delta 方向
function getDeltaDirection(match, playPrefix, fieldName) {
  if (!match || !match._odds) return null;
  const groupedKey = playPrefix + 'Delta';
  const grouped = match._odds[groupedKey];
  if (grouped && grouped[fieldName]) return grouped[fieldName];
  // 兜底：从 raw oddsDelta 查找
  const raw = match._odds.oddsDelta || {};
  const key = playPrefix + '.' + fieldName;
  return raw[key] || null;
}

// ★ 渲染 Delta 摘要提示（用于"其它"区域）
function renderDeltaSummary(match, playPrefix) {
  const summaryKey = playPrefix + 'DeltaSummary';
  const summary = (match._odds && match._odds[summaryKey]) || {};
  const up = summary.up || 0;
  const down = summary.down || 0;
  if (up === 0 && down === 0) return '';
  const parts = [];
  if (up > 0) parts.push('<span class="sodds-arrow-up">&#9650;' + up + '</span>');
  if (down > 0) parts.push('<span class="sodds-arrow-down">&#9660;' + down + '</span>');
  return '<span class="smc-delta-sum">' + parts.join(' ') + '</span>';
}

// ═══ 选择 ═══
window.selectSchemeOdds = function (matchId, playType, dirName, oddsVal, handicap) {
  matchId = normalizeMatchId(matchId);
  // ★ 防止空 matchId 导致误判为同一场比赛
  if (!matchId) {
    console.warn('selectSchemeOdds: matchId 为空，忽略选择');
    return;
  }

  // ★ 木桶原则：检查玩法上限（按唯一比赛数，非选项数）
  if (_activePlayType !== 'mixed') {
    // 在特定玩法下，按"同玩法唯一比赛数"检查
    const limit = PLAY_LIMITS[playType] || 8;
    const samePlayMatches = {};
    _selections.forEach(function (s) {
      if (s.playType === playType) samePlayMatches[normalizeMatchId(s.matchId)] = true;
    });
    const samePlayCount = Object.keys(samePlayMatches).length;
    // 检查是否已有该场比赛的选择
    var hasThisMatch = _selections.some(function (s) {
      return normalizeMatchId(s.matchId) === matchId;
    });
    if (!hasThisMatch && samePlayCount >= limit) {
      alert('⚽ ' + PLAY_NAMES[playType] + '玩法最多选择 ' + limit + ' 场比赛');
      return;
    }
  } else {
    // 混合过关：检查所有玩法上限
    let totalMatches = 0;
    const totalMatchIds = {};
    _selections.forEach(function (s) {
      totalMatchIds[s.matchId] = true;
    });
    totalMatches = Object.keys(totalMatchIds).length;
    // 检查选中玩法中最苛刻的上限
    let minLimit = 8;
    _selections.forEach(function (s) {
      const l = PLAY_LIMITS[s.playType] || 8;
      if (l < minLimit) minLimit = l;
    });
    const newPlayLimit = PLAY_LIMITS[playType] || 8;
    if (newPlayLimit < minLimit) minLimit = newPlayLimit;
    var hasThisMatch = totalMatchIds[matchId];
    if (!hasThisMatch && totalMatches >= minLimit) {
      alert(
        '⚽ 当前方案受玩法限制，最多选择 ' +
          minLimit +
          ' 场比赛（' +
          _selections
            .map(function (s) {
              return PLAY_NAMES[s.playType] + '上限' + PLAY_LIMITS[s.playType] + '场';
            })
            .filter(function (v, i, a) {
              return a.indexOf(v) === i;
            })
            .join('，') +
          '）',
      );
      return;
    }
  }

  // ★ 切换式多选：已选则取消
  let existingIdx = -1;
  for (let i = 0; i < _selections.length; i++) {
    if (
      normalizeMatchId(_selections[i].matchId) === matchId &&
      _selections[i].playType === playType &&
      _selections[i].direction === dirName
    ) {
      existingIdx = i;
      break;
    }
  }
  if (existingIdx >= 0) {
    _selections.splice(existingIdx, 1);
    _reRenderSafe();
    return;
  }

  // ★ 同场比赛只能用同一玩法 + 移除重复方向
  _selections = _selections.filter(function (s) {
    if (normalizeMatchId(s.matchId) !== matchId) return true;
    if (s.playType !== playType) return false; // 同场不同玩法 → 清除
    if (s.direction === dirName) return false; // 重复方向 → 清除
    return true;
  });

  _selections.push({
    matchId: matchId,
    playType: playType,
    direction: dirName,
    odds: Number(oddsVal) || 0,
    oddsName: dirName,
    handicap: handicap || 0,
  });
  _reRenderSafe();
};

function findSelection(matchId) {
  const mid = normalizeMatchId(matchId);
  for (let i = 0; i < _selections.length; i++) {
    if (normalizeMatchId(_selections[i].matchId) === mid) return _selections[i];
  }
  return null;
}

function findOtherSelections(matchId) {
  const mid = normalizeMatchId(matchId);
  return _selections.filter(function (s) {
    return normalizeMatchId(s.matchId) === mid && ['bf', 'jqs', 'bqc'].indexOf(s.playType) !== -1;
  });
}

// ★ BF/JQS/BQC 专用赔率按钮行（4列网格 + 单场多选）
function renderSpecialOddsRow(m, matchId) {
  const odds = m._odds || {};

  // 通用渲染函数：4列网格
  function render4ColGrid(playType, items, getLabel, getOdds, getScore) {
    if (!items || items.length === 0) return '';
    const delta = odds[playType + 'Delta'] || {};
    const selSet = {};
    _selections
      .filter(function (s) {
        return normalizeMatchId(s.matchId) === normalizeMatchId(matchId) && s.playType === playType;
      })
      .forEach(function (s) {
        selSet[s.direction] = true;
      });
    const btns = items
      .map(function (item) {
        const label = getLabel(item),
          score = getScore ? getScore(item) : label;
        const o = getOdds(item);
        const oddsStr = o != null ? Number(o).toFixed(2) : '-';
        const sel = selSet[score];
        const arrow =
          delta[score] === 'up'
            ? ' <span style=\"color:#EF4444\">▲</span>'
            : delta[score] === 'down'
              ? ' <span style=\"color:#22C55E\">▼</span>'
              : '';
        const noOdd = o == null;
        const cls = 'sodds-btn' + (sel ? ' active' : '') + (noOdd ? ' sodds-btn-no-odds' : '');
        const onClick = noOdd
          ? ''
          : ' onclick="event.stopPropagation();selectSchemeOdds(\'' +
            matchId +
            "','" +
            playType +
            "','" +
            escStr(score) +
            "'," +
            o +
            ',null)"';
        return (
          '<button class="' +
          cls +
          '"' +
          onClick +
          ' style="flex:0 0 calc(25% - 2px);max-width:calc(25% - 2px);margin:1px;font-size:10px;padding:5px 2px;box-sizing:border-box">' +
          label +
          '<br><span style="font-size:9px;color:#00E5FF">' +
          oddsStr +
          arrow +
          '</span></button>'
        );
      })
      .join('');
    return '<div class="sodds-grid-4col" style="display:flex;flex-wrap:wrap;width:100%">' + btns + '</div>';
  }

  // 比分
  if (_activePlayType === 'bf') {
    const bfList = odds.bf || [];
    if (bfList.length === 0)
      return '<div class="sodds-grid-4col" style="display:flex;align-items:center;justify-content:center;flex:1;color:var(--text3);font-size:11px;padding:12px 0">赔率加载中，请稍候</div>';
    return render4ColGrid(
      'bf',
      bfList,
      function (s) {
        return s.score;
      },
      function (s) {
        return s.odds;
      },
      function (s) {
        return s.score;
      },
    );
  }

  // 总进球
  if (_activePlayType === 'jqs') {
    const jqsList = (odds.jqs || []).filter(function (x) {
      return FIXED_JQS.indexOf(String(x.goals)) >= 0;
    });
    if (jqsList.length === 0)
      return '<div class="sodds-grid-4col" style="display:flex;align-items:center;justify-content:center;flex:1;color:var(--text3);font-size:11px;padding:12px 0">赔率加载中，请稍候</div>';
    return render4ColGrid(
      'jqs',
      jqsList,
      function (s) {
        return String(s.goals).replace('+', '+');
      },
      function (s) {
        return s.odds;
      },
      function (s) {
        return String(s.goals);
      },
    );
  }

  // 半全场
  if (_activePlayType === 'bqc') {
    const BQC_ABBR_MAP = {
      hh: '胜胜',
      hd: '胜平',
      ha: '胜负',
      dh: '平胜',
      dd: '平平',
      da: '平负',
      ah: '负胜',
      ad: '负平',
      aa: '负负',
    };
    const bqcItems = [];
    const rawBqc = odds.bqc || [];
    FIXED_BQC.forEach(function (c) {
      const item = rawBqc.find(function (x) {
        const key = x.combo || x.label || x.key || '';
        return key === c || BQC_ABBR_MAP[key] === c;
      });
      if (item) bqcItems.push({ combo: c, odds: item.odds });
    });
    if (bqcItems.length === 0)
      return '<div class="sodds-grid-4col" style="display:flex;align-items:center;justify-content:center;flex:1;color:var(--text3);font-size:11px;padding:12px 0">赔率加载中，请稍候</div>';
    return render4ColGrid(
      'bqc',
      bqcItems,
      function (s) {
        return s.combo;
      },
      function (s) {
        return s.odds;
      },
      function (s) {
        return s.combo;
      },
    );
  }

  return '';
}

// ★ FIXED lists for rendering
var FIXED_JQS = ['0', '1', '2', '3', '4', '5', '6', '7+'];
var FIXED_BQC = ['胜胜', '胜平', '胜负', '平胜', '平平', '平负', '负胜', '负平', '负负'];

function renderOtherSection(matchId) {
  const m = _matches.find(function (x) {
    return normalizeMatchId(x.matchId || x.id) === normalizeMatchId(matchId);
  });
  const otherSels = findOtherSelections(matchId);
  // ★ SPF/RQSPF/BF/JQS/BQC 模式下禁用"其它"按钮（使用主页赔率或专用网格）
  const otherDisabled = _activePlayType !== 'mixed';
  const dimCls = otherDisabled ? ' smc-other-dim' : '';
  const clickAttr = otherDisabled ? '' : ' onclick="openSchemeBetting(\'' + matchId + '\')"';

  if (otherSels.length > 0) {
    // ★ BF/JQS/BQC 聚合显示：比分+4 / 总进球+5 / 半全场+3
    const _otPlay = otherSels[0].playType;
    const _otLabel = { bf: '比分', jqs: '总进球', bqc: '半全场' }[_otPlay] || _otPlay;
    const itemHtml = '<span class="smc-other-info">' + _otLabel + ' +' + otherSels.length + '</span>';
    return (
      '<span class="smc-other has-selection' +
      dimCls +
      '"' +
      clickAttr +
      '>' +
      '<span class="smc-other-label">其它</span>' +
      '<div class="smc-other-sep"></div>' +
      itemHtml +
      '</span>'
    );
  }
  return '<span class="smc-other' + dimCls + '"' + clickAttr + '>其它</span>';
}

// ═══ 更新底部栏 ═══
function updateSummary() {
  const bar = document.getElementById('schemeSummaryBar');
  if (!bar) return;
  const count = _selections.length;
  if (count === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';

  // 期号（根据方案日期计算，非固定"01"）
  const issueEl = document.getElementById('ssbIssueNum');
  if (issueEl) {
    const schemeDate = _schemeDate ? new Date(_schemeDate) : new Date();
    const y = String(schemeDate.getFullYear()).slice(2);
    const m = String(schemeDate.getMonth() + 1).padStart(2, '0');
    const day = schemeDate.getDate();
    const issueNum = y + m + String(day).padStart(2, '0');
    issueEl.textContent = issueNum;
  }

  // ★ 已选数量 = 场次数（非赔率卡片数）
  var uniqueMatchIds = {};
  _selections.forEach(function (s) {
    uniqueMatchIds[s.matchId] = true;
  });
  const matchCount = Object.keys(uniqueMatchIds).length;
  const badge = document.getElementById('schemeSelCountBadge');
  if (badge) badge.textContent = matchCount;

  // 过关显示
  var uniqueMatchIds = {};
  _selections.forEach(function (s) {
    uniqueMatchIds[s.matchId] = true;
  });
  const n = Object.keys(uniqueMatchIds).length;
  const passEl = document.getElementById('schemePassText');
  if (passEl) {
    if (n < 2) {
      passEl.textContent = '单关';
      passEl.style.pointerEvents = 'none';
      passEl.style.opacity = '0.5';
    } else {
      passEl.style.pointerEvents = '';
      passEl.style.opacity = '';
      if (_passTypes.length === 0) {
        passEl.textContent = n + '关';
      } else if (_passTypes.length === 1) {
        passEl.textContent = _passTypes[0] + '关';
      } else {
        const minPass = Math.min.apply(null, _passTypes);
        const maxPass = Math.max.apply(null, _passTypes);
        passEl.textContent = minPass + '~' + maxPass + '关';
      }
    }
  }

  // 倍数
  const mulEl = document.getElementById('ssbMultiplier');
  if (mulEl) mulEl.textContent = _multiplier;

  // 金额和奖金
  const calc = calcAmountAndPrize();
  const amtEl = document.getElementById('ssbAmount');
  const winEl = document.getElementById('ssbMaxWin');
  if (amtEl) amtEl.textContent = calc.amount;
  if (winEl) {
    // P2: 分层展示最高奖金 — 多过关时显示最优关级 + 最高奖金
    const pd = calc.passOdds || {};
    const keys = Object.keys(pd);
    if (keys.length > 1 && calc.bestProductK > 0) {
      winEl.textContent = calc.maxWin;
      winEl.title = keys
        .map(function (k) {
          const p = pd[k];
          return k + '关最高: ' + p.maxWinPerNote + '元（赔率积 ' + p.bestProduct + '）';
        })
        .join('\n');
    } else {
      winEl.textContent = calc.maxWin;
      winEl.title = '';
    }
  }
}

// ═══ 倍数弹窗 ═══
let _tempMultiplier = 2;

window.showMultiplierPopup = function () {
  _tempMultiplier = _multiplier;
  const overlay = document.getElementById('multiplierOverlay');
  const input = document.getElementById('ssbMultiInput');
  if (overlay && input) {
    overlay.classList.add('active');
    input.value = _tempMultiplier;
  }
};

window.closeMultiplierPopup = function () {
  const overlay = document.getElementById('multiplierOverlay');
  if (overlay) overlay.classList.remove('active');
};

window.confirmMultiplierPopup = function () {
  _multiplier = Math.max(2, Math.min(99, parseInt(_tempMultiplier) || 2));
  window.closeMultiplierPopup();
  updateSummary();
};

window.setMultiQuick = function (val) {
  _tempMultiplier = val;
  const input = document.getElementById('ssbMultiInput');
  if (input) input.value = _tempMultiplier;
};

window.inputMultiDigit = function (digit) {
  const input = document.getElementById('ssbMultiInput');
  if (!input) return;
  let current = String(_tempMultiplier);
  if (current === '0') current = digit;
  else if (current.length < 2) current += digit;
  _tempMultiplier = parseInt(current) || 1;
  input.value = _tempMultiplier;
};

window.backspaceMulti = function () {
  const input = document.getElementById('ssbMultiInput');
  if (!input) return;
  let current = String(_tempMultiplier);
  if (current.length > 1) current = current.slice(0, -1);
  else current = '2';
  _tempMultiplier = parseInt(current) || 1;
  input.value = _tempMultiplier;
};

// ═══ 过关弹窗 ═══
let _tempPassTypes = [];

window.showPassPopup = function () {
  const maxPass = calcMaxPass();
  if (maxPass < 1) return; // 无选项不弹

  _tempPassTypes = _passTypes.slice();
  const overlay = document.getElementById('passOverlay');
  const hint = document.getElementById('passHint');
  const list = document.getElementById('passList');

  if (!overlay || !list) return;

  const uniqueMatchIds = {};
  _selections.forEach(function (s) {
    uniqueMatchIds[s.matchId] = true;
  });
  const n = Object.keys(uniqueMatchIds).length;

  const matchGroups = {};
  _selections.forEach(function (s) {
    if (!matchGroups[s.matchId]) matchGroups[s.matchId] = [];
    matchGroups[s.matchId].push(s);
  });
  const matchIds = Object.keys(matchGroups);

  if (hint) hint.textContent = '当前：' + n + '场，上限：' + maxPass + '关';

  // ★ 渲染 1~8 关选项（1关=单关）
  let html = '';
  for (let k = 1; k <= 8; k++) {
    const disabled = k > maxPass || k > n;
    const checked = _tempPassTypes.indexOf(k) !== -1 && !disabled;
    var count;
    if (disabled) {
      count = '──';
    } else if (k === 1) {
      count = matchIds.length > 0 ? (matchGroups[matchIds[0]] ? matchGroups[matchIds[0]].length + '注' : '─') : '─';
    } else {
      count = calcExpandedBets(matchGroups, matchIds, k) + '注';
    }
    const cls = disabled ? 'ssb-pass-item disabled' : 'ssb-pass-item';
    html +=
      '<div class="' +
      cls +
      '">' +
      '<label><input type="checkbox"' +
      (checked ? ' checked' : '') +
      (disabled ? ' disabled' : '') +
      ' onchange="togglePassType(' +
      k +
      ')"> ' +
      k +
      '关' +
      (k === 1 ? '（单关）' : '') +
      '</label>' +
      '<span class="ssb-pass-count">' +
      count +
      '</span>' +
      '</div>';
  }
  list.innerHTML = html;

  overlay.classList.add('active');
};

window.togglePassType = function (k) {
  const idx = _tempPassTypes.indexOf(k);
  if (idx !== -1) _tempPassTypes.splice(idx, 1);
  else _tempPassTypes.push(k);
  _tempPassTypes.sort(function (a, b) {
    return a - b;
  });
};

window.closePassPopup = function () {
  const overlay = document.getElementById('passOverlay');
  if (overlay) overlay.classList.remove('active');
};

window.confirmPassPopup = function () {
  const uniqueMatchIds = {};
  _selections.forEach(function (s) {
    uniqueMatchIds[s.matchId] = true;
  });
  const n = Object.keys(uniqueMatchIds).length;
  // ★ 单关时默认 1关，多场默认 2关
  _passTypes = _tempPassTypes.length > 0 ? _tempPassTypes.slice() : n < 2 ? [1] : [2];
  window.closePassPopup();
  updateSummary();
};

// ═══ 清空 ═══
window.clearSchemeSelections = function () {
  _selections = [];
  _multiplier = 2;
  _passTypes = [2];
  _reRenderSafe();
};

// ═══ 确认方案（跳转到确认页面） ═══
window.saveUserPlan = function () {
  if (_selections.length === 0) {
    alert('请至少选择一场比赛');
    return;
  }

  // ★ 单关校验：仅唯一场次时检查
  const _uniqueMatchIds = {};
  _selections.forEach(function (s) {
    _uniqueMatchIds[s.matchId] = true;
  });
  const uniqueMatches = Object.keys(_uniqueMatchIds);

  if (uniqueMatches.length === 1) {
    const selMatch = _matches.find(function (m) {
      return normalizeMatchId(m.matchId || m.id) === normalizeMatchId(uniqueMatches[0]);
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
          return (x.matchId || x.id) === _s.matchId;
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

  // ★ 群彩风格：同场点击自动替换（不是禁止混合），跨场自由混合不同玩法
  // 木桶原则（每种玩法上限）在 _selections 组建时已校验

  // ★ 构建 matchDetails 用于确认页面（携带完整赔率数据）
  const matchDetails = _selections.map(function (s) {
    const m =
      _matches.find(function (x) {
        return (x.matchId || x.id) === s.matchId;
      }) || {};
    // 格式化时间
    let timeStr = '';
    if (m.startTime) {
      const stParts = m.startTime.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
      if (stParts) timeStr = stParts[1] + '-' + stParts[2] + ' ' + stParts[3] + ':' + stParts[4];
      else timeStr = m.startTime;
    }
    return {
      matchId: s.matchId,
      homeName: m.homeName || '',
      visitName: m.visitName || '',
      league: m.leagueName || '',
      matchNum: m.matchNum || m.num || '',
      playType: s.playType,
      direction: s.direction,
      odds: s.odds,
      oddsName: s.oddsName,
      timeStr: timeStr,
      isSingleGame: m.isSingleGame,
      _odds: m._odds || {},
    };
  });

  const planData = {
    matches: matchDetails,
    selections: _selections.slice(),
    passTypes: _passTypes.slice(),
    multiplier: _multiplier,
  };

  // ★ 存储到 sessionStorage，供确认页面读取
  try {
    sessionStorage.setItem('pendingConfirmPlan', JSON.stringify(planData));
  } catch (e) {
    console.error('存储方案数据失败:', e);
  }

  // ★ 跳转到确认方案页面
  window.switchTab('confirm-scheme');
};

// ═══ 打开投注弹窗 ═══
window.openSchemeBetting = function (matchId) {
  const m = _matches.find(function (x) {
    return normalizeMatchId(x.matchId || x.id) === normalizeMatchId(matchId);
  });
  if (!m) return;

  // ★ 始终删除旧 overlay 重建，避免复用脏状态
  const oldOverlay = document.getElementById('betOverlay');
  if (oldOverlay) oldOverlay.remove();

  const overlay = document.createElement('div');
  overlay.id = 'betOverlay';
  overlay.className = 'ai-overlay';
  overlay.onclick = function (e) {
    if (e.target === overlay) {
      // 使用完整清理流程（closeBetting 会同时清理 betting-confirm 监听器）
      if (window._betClose) window._betClose();
    }
  };
  document.body.appendChild(overlay);

  overlay.innerHTML =
    '<div class="ai-modal" style="display:flex;align-items:center;justify-content:center;min-height:200px;">' +
    '<div style="text-align:center;color:#aabbcc;padding:60px 0;">' +
    '<div class="loading-spinner" style="margin:0 auto 16px;"></div>加载中...</div></div>';
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  // 移除旧监听器
  const handler = window._bettingConfirmHandler;
  if (handler) window.removeEventListener('betting-confirm', handler);

  window._bettingConfirmHandler = function (e) {
    const result = e.detail;
    if (!result) return;

    // ★ 收集所有要添加的选择（兼容单选/多选）
    let incomingSelections = [];
    if (result.selections && result.selections.length > 0) {
      incomingSelections = result.selections;
    } else if (result.selection) {
      // 向后兼容旧单选格式
      incomingSelections = [
        { playType: result.playType, label: result.selection, odds: result.odds, handicap: result.handicap },
      ];
    }
    if (incomingSelections.length === 0) return;

    // ★ 群彩风格：弹窗结果直接替换同场旧选择（静默替换，不再弹窗拦截）
    // 竞彩场次隔离：弹窗内只允许操作一种玩法（betting.js 传入 _activePlayType 限制）
    _selections = _selections.filter(function (s) {
      return s.matchId !== matchId;
    });

    incomingSelections.forEach(function (s) {
      _selections.push({
        matchId: matchId,
        playType: s.playType || 'spf',
        direction: s.label || s.selection,
        odds: s.odds || 0,
        oddsName: s.label || s.selection,
        handicap: s.handicap || 0,
      });
    });

    _reRenderSafe();
    window.removeEventListener('betting-confirm', window._bettingConfirmHandler);
    window._bettingConfirmHandler = null;
  };

  window.addEventListener('betting-confirm', window._bettingConfirmHandler);

  // 动态加载投注模块并渲染（Vite/原生双兼容：禁止拼接 ?t，避免 dist chunk 路径失配）
  import('./betting.js')
    .then(function (betting) {
      if (betting.openBetting) {
        betting.openBetting(matchId, m, _activePlayType);
      }
    })
    .catch(function (e) {
      console.error('投注模块加载失败:', e);
      overlay.classList.remove('active');
      document.body.style.overflow = '';
      alert('投注模块加载失败');
    });
};

// ═══ 玩法切换（已移到文件顶部，此处为注释保留） ═══
// switchSchemePlay 已在文件顶部通过 window.switchSchemePlay 定义
// _activePlayType 默认为 'mixed'，通过 loadSchemeDesign() 初始化

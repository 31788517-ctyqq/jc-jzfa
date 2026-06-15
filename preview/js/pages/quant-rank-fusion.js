import { api } from '../vendor.js?v=202606152148';
import { getCache, setCache } from '../vendor.js?v=202606152148';
import { loadECharts, echartsReady } from '../charts.js?v=202606080308';

console.log('[V5.0-FUSION] quant-rank-fusion.js loaded — cross-tab selection enabled');

var quantDate = '';
var quantDateOffset = 0;
var currentTab = 'power';
var opportunityFilter = 'all';
var allData = [];
var pickedIds = {};
var sortKey = 'rank';
var sortAsc = true;

/** 归一化 fusionConsensus 中文→英文 */
function normalizeConsensus(raw) {
  var c = String(raw || '');
  if (c.indexOf('强一致') !== -1) return 'strong';
  if (c.indexOf('弱一致') !== -1) return 'weak';
  if (c.indexOf('熔断') !== -1) return 'meltdown';
  return '';
}

export function updateQuantDateBar() {
  var d = new Date();
  d.setDate(d.getDate() + quantDateOffset);
  quantDate =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  var el = document.getElementById('quantDateCurrent');
  if (!el) return;
  var weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var mmdd = String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
  var today = new Date().toDateString() === d.toDateString();
  el.textContent = (today ? '今天 ' : '') + mmdd + ' ' + weekNames[d.getDay()];
}

export function shiftQuantDate(delta) {
  quantDateOffset += delta;
  updateQuantDateBar();
  loadQuantRank();
}
export function goQuantToday() {
  quantDateOffset = 0;
  updateQuantDateBar();
  loadQuantRank();
}

export function toggleQuantDatePicker() {
  var el = document.getElementById('quantDatePicker');
  if (!el) return;
  el.style.display = el.style.display !== 'none' ? 'none' : 'block';
}

export function switchQuantTab(tab) {
  currentTab = tab;
  // ★ V5.0: 不再清空 pickedIds，支持跨标签选择
  updatePkBar();
  // 切换 tab 时重置回表格视图
  if (currentView === 'chart') switchQuantView('table');
  // 切换 tab 时重置排序键为默认
  if (tab === 'power') {
    sortKey = 'rank';
    sortAsc = true;
  } else if (tab === 'goal') {
    sortKey = 'totalSum';
    sortAsc = true;
  } else {
    sortKey = 'hotFocusNum';
    sortAsc = true;
  }
  document.querySelectorAll('#quantFilterBar .filter-tag').forEach(function (t) {
    t.classList.remove('active');
  });
  var t = document.querySelector('#quantFilterBar .filter-tag[data-tab="' + tab + '"]');
  if (t) t.classList.add('active');
  renderTable();
}

export function togglePick(ev, matchId) {
  ev.stopPropagation();
  // 利用浏览器原生 checkbox 切换，JS 只管理 pickedIds 和行样式
  if (pickedIds[matchId]) delete pickedIds[matchId];
  else pickedIds[matchId] = true;
  updatePkBar();
  var row = document.getElementById('qr-' + matchId);
  if (row) {
    if (pickedIds[matchId]) row.classList.add('picked');
    else row.classList.remove('picked');
  }
}

export function startPK() {
  var picked = allData.filter(function (item) {
    return pickedIds[item.matchId];
  });
  if (picked.length < 2) return;
  if (window.openPKMulti) {
    window.openPKMulti(picked);
    clearPicks();
  }
}

function clearPicks() {
  pickedIds = {};
  updatePkBar();
  document.querySelectorAll('.quant-card-row.picked').forEach(function (r) {
    r.classList.remove('picked');
  });
  document.querySelectorAll('.q-chk:checked').forEach(function (c) {
    c.checked = false;
  });
}

function updatePkBar() {
  var count = Object.keys(pickedIds).length;
  var bar = document.getElementById('quantPkBar');
  var cntEl = document.getElementById('pkBarCount');
  var btn = document.getElementById('pkBarBtn');
  if (bar) bar.style.display = count > 0 ? 'flex' : 'none';
  if (cntEl) cntEl.textContent = count;
  if (btn) btn.disabled = count < 2;
}

export function sortBy(key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else {
    sortKey = key;
    sortAsc = true;
  }
  renderTable();
}

export function switchQuantOpportunity(level) {
  opportunityFilter = level || 'all';
  renderTable();
}

function safeArrayField(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      var parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {}
    return value
      .split(/[、,，]/)
      .map(function (x) {
        return x.trim();
      })
      .filter(Boolean);
  }
  return [];
}

function decisionCodeOf(item) {
  var code = String(item.finalDecision || '').trim();
  if (code) return code;
  var level = String(item.decisionLevel || '').trim();
  if (level === '主推') return 'main_pick';
  if (level === '可做') return 'playable';
  if (level === '谨慎') return 'cautious';
  return 'watch';
}

function normalizeOpportunityFields(item) {
  var riskTags = safeArrayField(item.riskTags);
  var degradeReasons = safeArrayField(item.degradeReasons);
  var stars = Math.max(0, Math.min(5, parseInt(item.stars || item.directionStars || 0, 10) || 0));
  var level = item.decisionLevel || '';
  if (!level) {
    if (item.finalDecision === 'main_pick') level = '主推';
    else if (item.finalDecision === 'playable') level = '可做';
    else if (item.finalDecision === 'cautious') level = '谨慎';
    else if (stars >= 5) level = '主推';
    else if (stars >= 3) level = '可做';
    else if (stars >= 2) level = '谨慎';
    else level = '观望';
  }
  var finalDirection = item.finalDirection || item.direction || 'watch';
  var riskLevel = item.riskLevel || (riskTags.length > 0 || level === '观望' ? 'yellow' : 'green');
  if (item.fusionConsensus === 'meltdown') riskLevel = 'red';
  return Object.assign({}, item, {
    playType: item.playType || 'spf',
    finalDirection: finalDirection,
    decisionLevel: level,
    finalDecision: item.finalDecision || decisionCodeOf({ decisionLevel: level }),
    stars: stars,
    riskLevel: riskLevel,
    riskTags: riskTags,
    degradeReasons: degradeReasons,
    decisionNarrative: item.decisionNarrative || 'PK裁判：基于量化评分输出，详细原因可进入 PK 弹窗查看。',
  });
}

// ═══ 数据加载 ═══
export function loadQuantRank() {
  pickedIds = {}; // 切换日期时清空复选框状态
  updatePkBar();
  var wrap = document.getElementById('quantTableWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载数据中...</div>';
  var params = {};
  if (quantDate) params.date = quantDate;

  // ★ P1: sessionStorage 缓存命中（与 quant-rank.js 一致）
  var cacheKey = 'quant-rank-fusion:' + (quantDate || 'latest');
  var cachedData = getCache(cacheKey);
  if (cachedData) {
    allData = (Array.isArray(cachedData) ? cachedData : []).map(normalizeOpportunityFields);
    sortKey = 'rank';
    sortAsc = true;
    renderTable();
    return;
  }

  // ★ 三个 API 并行请求，消除串行等待
  Promise.all([
    api('ranking-list', params).catch(function () {
      return { ranking: [] };
    }),
    api('gongshoudao-all', params).catch(function () {
      return {};
    }),
    api('quant-hot', params).catch(function () {
      return {};
    }),
  ])
    .then(function (results) {
      var rankData = results[0] || {};
      var gsAllData = results[1] || {};
      var hotData = results[2] || {};
      var ranking = rankData.ranking || [];
      if (ranking.length === 0) {
        // 当天无数据 → 自动回退到前一天（和今日比赛页面规则一致）
        var now = new Date();
        var todayStr =
          now.getFullYear() +
          '-' +
          String(now.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(now.getDate()).padStart(2, '0');
        if (quantDateOffset === 0 && (quantDate === '' || quantDate === todayStr)) {
          var prev = new Date();
          prev.setDate(prev.getDate() - 1);
          var prevStr =
            prev.getFullYear() +
            '-' +
            String(prev.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(prev.getDate()).padStart(2, '0');
          if (prevStr >= '2026-03-19') {
            quantDateOffset = -1;
            updateQuantDateBar();
            loadQuantRank();
            return;
          }
        }
        wrap.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text3)">暂无比赛数据</div>';
        return;
      }
      // ⭐ 并行结果已就绪，直接合并数据
      var gsAllMap = gsAllData.gsData || {};
      var hotMap = hotData && hotData.hotData ? hotData.hotData : {};
      var gsResults = ranking.map(function (item) {
        return gsAllMap[item.matchId] || {};
      });
      allData = ranking.map(function (item, i) {
        var merged = mergeItem(item, gsResults[i] || {});
        // ⭐ 注入热度数据
        var hd = hotMap[item.matchId] || {};
        if (hd.staticDiff !== undefined && hd.staticDiff !== null) merged.staticDiff = hd.staticDiff;
        if (hd.heatIndex !== null && hd.heatIndex !== undefined) merged.heatIndex = hd.heatLabel || hd.heatIndex;
        if (hd.homeFeature) merged.homeFeature = hd.homeFeature;
        if (hd.guestFeature) merged.guestFeature = hd.guestFeature;
        if (hd.oddsLive !== null && hd.oddsLive !== undefined) merged.oddsLive = hd.oddsLive;
        if (hd.hotFocusNum !== null && hd.hotFocusNum !== undefined) merged.hotFocusNum = hd.hotFocusNum;
        if (hd.rq !== undefined && hd.rq !== null) merged.rq = hd.rq;
        // ★Phase2: 数据完整性标记
        merged.hasChange = hd.heatIndex != null && hd.heatIndex !== undefined;
        merged.hasYz = hd.hotFocusNum != null && hd.hotFocusNum !== undefined;
        // 计算整体完整度：0=全缺失，1=仅GS，2=GS+热度部分，3=全部就绪
        var score = 0;
        if (merged.hasGS) score += 1;
        if (merged.hasChange) score += 1;
        if (merged.hasYz) score += 1;
        merged.completenessScore = score;
        return normalizeOpportunityFields(merged);
      });
      sortKey = 'rank';
      sortAsc = true;
      setCache(cacheKey, allData);
      renderTable();
    })
    .catch(function () {
      wrap.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text3)">加载失败</div>';
    });
}

function mergeItem(item, gs) {
  var cw = gs.crossWin !== undefined ? gs.crossWin : '-';
  var cd = gs.crossDraw !== undefined ? gs.crossDraw : '-';
  var cl = gs.crossLose !== undefined ? gs.crossLose : '-';

  // ── 进球预测维度 ──

  // 综合大球比例 = (主队大球比例 + 客队大球比例 + 交锋大球比例) / 3 × 100
  var bigBall = gs.bigBallRatio != null ? gs.bigBallRatio : '-';

  // 攻防进球 = xgHome + xgAway（射门还原法 M3_A）
  var attDefGoal = gs.attDefGoal != null ? gs.attDefGoal : '-';

  // 实力进球 = 0.5 × (主队静态进球能力 + 客队静态进球能力) × (1 + 0.2 × Total_战)
  var strengthGoal = gs.strengthGoal != null ? gs.strengthGoal : '-';

  // 交锋进球 = H2H场均总进球（最近3-6次交锋）
  var headToHeadGoal = gs.h2hGoalAvg != null ? gs.h2hGoalAvg : '-';

  // 破甲和 = 主队进攻次数/(客队被射次数+0.5) + 客队进攻次数/(主队被射次数+0.5)
  var breakArmor = gs.breakArmorSum != null ? gs.breakArmorSum : '-';

  // ── 实力PK四维指标（PK.md 2.1-2.2） ──

  // ① 净胜球量化 = GD_q = ExpG_h - ExpG_a（后端按四维呼吸权重公式计算）
  var gdScore = gs.gdQ != null ? gs.gdQ : '-';
  var gdNum = gdScore === '-' ? 0 : gdScore;

  // ② 胜平负交叉 = (H_wins + A_losses) - (H_losses + A_wins)
  // 数据映射：hWins→主队胜场, aLosses→客队负场, hLosses→主队负场, aWins→客队胜场
  var crossValue;
  if (gs.hWins != null && gs.aLosses != null && gs.hLosses != null && gs.aWins != null) {
    crossValue = gs.hWins + gs.aLosses - (gs.hLosses + gs.aWins);
  } else {
    crossValue = '-';
  }
  var cvNum = crossValue === '-' ? 0 : crossValue;

  // ③ 综合实力 = Total_战 = 0.7×Static + 0.3×Dyn（V6.4 双轨实力量化）
  var pwScore = gs.totalStrength != null ? parseFloat(gs.totalStrength.toFixed(4)) : '-';
  var pwNum = pwScore === '-' ? 0 : pwScore;

  // ④ 攻守实力 = 进球分布计分法 V6.4（WinQiu_2×2 + WinQiu_1×1 + LoseQiu_0×2 + LoseQiu_1×1）
  var adCombined = gs.adWeightedComposite != null ? parseFloat(gs.adWeightedComposite.toFixed(4)) : '-';
  var adNum = adCombined === '-' ? 0 : adCombined;

  // 总排序 = 0.25 × 净胜球 + 0.25 × 胜平负交叉 + 0.25 × 综合实力 + 0.25 × 攻守实力
  var totalScore = parseFloat(((gdNum + cvNum + pwNum + adNum) / 4).toFixed(4));

  function goalTotalSum() {
    var b = bigBall === '-' ? 0 : Math.abs(bigBall);
    var a = attDefGoal === '-' ? 0 : Math.abs(attDefGoal);
    var s = strengthGoal === '-' ? 0 : Math.abs(strengthGoal);
    var h = headToHeadGoal === '-' ? 0 : Math.abs(headToHeadGoal);
    var r = breakArmor === '-' ? 0 : Math.abs(breakArmor);
    return parseFloat((b + a + s + h + r).toFixed(4));
  }

  return {
    matchId: item.matchId,
    num: item.num || '',
    homeName: item.homeName || '',
    visitName: item.visitName || '',
    leagueName: item.leagueName || '',
    date: item.date || '',
    matchStatus: item.matchStatus || 0,
    rank: item.rank || 99,
    totalScore: totalScore, // 总排序得分（四维等权合成）
    // 实力维度 — 四维指标原始值
    gdScore: gdScore, // 净胜球量化 = xgHome - xgAway
    crossValue: crossValue, // 胜平负交叉 = (H_win+G_loss-H_loss-G_win)/10
    pwScore: pwScore, // 综合实力 = Total_战
    adCombined: adCombined, // 攻守实力 = sigmoid加权合成
    // ★ P0-5: 胜平负交叉双组概率
    crossSpfWin: gs.crossSpfWin !== undefined ? gs.crossSpfWin : '-',
    crossSpfDraw: gs.crossSpfDraw !== undefined ? gs.crossSpfDraw : '-',
    crossSpfLose: gs.crossSpfLose !== undefined ? gs.crossSpfLose : '-',
    crossHcpWin: gs.crossHcpWin !== undefined ? gs.crossHcpWin : '-',
    crossHcpDraw: gs.crossHcpDraw !== undefined ? gs.crossHcpDraw : '-',
    crossHcpLose: gs.crossHcpLose !== undefined ? gs.crossHcpLose : '-',
    // ★ P1-1: M3.7 四重熔断
    fusionConsensus: normalizeConsensus(gs.fusionConsensus || ''),
    fusionFinalHome: gs.fusionFinalHome != null ? gs.fusionFinalHome : 0,
    fusionFinalAway: gs.fusionFinalAway != null ? gs.fusionFinalAway : 0,
    // ★ P1-2: 攻防格局
    attackPattern: gs.attackPattern || '',
    // 兼容旧字段
    totalAdvantage: gs.totalAdvantage || '-',
    totalAdvantageValue: Math.round(50 + pwScore * 100), // Total_战 映射到进度条
    goalDiff: gdScore, // 净胜球量化值
    crossWin: cw,
    crossDraw: cd,
    crossLose: cl,
    crossRq: gs.crossRq,
    attackAdvantageValue: gs.attackAdvantageValue || 0,
    defenseAdvantageValue: gs.defenseAdvantageValue || 0,
    hasGS: !!gs.attackPattern,
    // 进球维度（后端按 PK.md 公式计算）
    bigBallRatio: bigBall,
    attDefGoal: attDefGoal,
    strengthGoal: strengthGoal,
    headToHeadGoal: headToHeadGoal,
    breakArmor: breakArmor,
    totalSum: goalTotalSum(),
    // 热点维度（占位）
    rq: gs.crossRq !== undefined ? gs.crossRq : '-',
    hotFocusNum: '-',
    heatIndex: '-',
    homeFeature: '-',
    guestFeature: '-',
    staticDiff: gs.totalAdvantageValue || 0,
    oddsLive: '-',
    // M4: PK 裁判标准字段（优先消费后端 ranking-list 输出，缺失时前端兜底）
    playType: item.playType || 'spf',
    finalDirection: item.finalDirection || item.direction || 'watch',
    decisionLevel: item.decisionLevel || '',
    finalDecision: item.finalDecision || '',
    stars: item.stars || item.directionStars || 0,
    riskLevel: item.riskLevel || '',
    riskTags: safeArrayField(item.riskTags),
    degradeReasons: safeArrayField(item.degradeReasons),
    decisionNarrative: item.decisionNarrative || '',
    expectedValue: item.expectedValue !== undefined ? item.expectedValue : null,
    valueEdge: item.valueEdge !== undefined ? item.valueEdge : null,
    pkCompositeScore: item.pkCompositeScore !== undefined ? item.pkCompositeScore : null,
  };
}

function countByDecision(items) {
  var counts = { all: 0, main_pick: 0, playable: 0, cautious: 0, watch: 0 };
  (Array.isArray(items) ? items : []).forEach(function (item) {
    counts.all += 1;
    var code = decisionCodeOf(item);
    if (counts[code] === undefined) counts.watch += 1;
    else counts[code] += 1;
  });
  return counts;
}

function renderOpportunitySummary(items) {
  var counts = countByDecision(items);
  var configs = [
    ['all', '全部', counts.all],
    ['main_pick', '主推', counts.main_pick],
    ['playable', '可做', counts.playable],
    ['cautious', '谨慎', counts.cautious],
    ['watch', '观望', counts.watch],
  ];
  var h = '<div class="q-opportunity-summary" id="quantOpportunitySummary">';
  h += '<div class="q-opportunity-title"><b>机会分层</b><span>按 PK 裁判字段识别，风险场次不标稳胆</span></div>';
  h += '<div class="q-opportunity-tabs">';
  configs.forEach(function (cfg) {
    h +=
      '<button type="button" class="q-opportunity-tab' +
      (opportunityFilter === cfg[0] ? ' active' : '') +
      '" onclick="switchQuantOpportunity(\'' +
      cfg[0] +
      '\')"><span>' +
      cfg[1] +
      '</span><b>' +
      cfg[2] +
      '</b></button>';
  });
  h += '</div></div>';
  return h;
}

function renderDecisionBadge(item) {
  var code = decisionCodeOf(item);
  var dir = item.finalDirection === 'watch' ? '观望' : item.finalDirection || '观望';
  return (
    '<span class="q-decision-badge q-decision-' +
    code +
    '" title="' +
    esc(item.decisionNarrative || '') +
    '"><b>' +
    esc(item.decisionLevel || '观望') +
    '</b><em>' +
    esc(dir) +
    '｜' +
    '★'.repeat(Math.max(0, Math.min(5, item.stars || 0))) +
    '</em></span>'
  );
}

function renderRiskChips(item) {
  var tags = safeArrayField(item.riskTags).slice(0, 2);
  if (!tags.length) return '<span class="q-risk-chips"><i class="q-risk-empty">低风险</i></span>';
  return (
    '<span class="q-risk-chips">' +
    tags
      .map(function (tag) {
        return '<i>' + esc(tag) + '</i>';
      })
      .join('') +
    '</span>'
  );
}

// ═══ 渲染 — flex 卡片表格 ═══
function renderTable() {
  var wrap = document.getElementById('quantTableWrap');
  if (!wrap) return;

  var displayData = allData.filter(function (item) {
    return opportunityFilter === 'all' || decisionCodeOf(item) === opportunityFilter;
  });

  // 排序
  var sorted;
  if (currentTab === 'power') {
    sorted = displayData.slice();
  } else {
    sorted = displayData.slice().sort(function (a, b) {
      var va = getSortVal(a, sortKey),
        vb = getSortVal(b, sortKey);
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  // 列定义 — key, label, sortable, colCls
  var cols, renderRow;
  if (currentTab === 'power') {
    cols = [
      { key: 'match', label: '对阵', sortable: false, colCls: 'q-col-match', hdCls: 'q-match-hd' },
      { key: 'goalDiff', label: '净胜球\n量化', sortable: false, colCls: 'q-col-gd' },
      { key: 'cross', label: '胜平负\n交叉', sortable: false, colCls: 'q-col-cross' },
      { key: 'power', label: '综合\n实力', sortable: false, colCls: 'q-col-power' },
      { key: 'ad', label: '攻守\n实力', sortable: false, colCls: 'q-col-ad' },
    ];
    renderRow = function (item) {
      return renderGoalDiff(item) + renderCrossValue(item) + renderPower(item) + renderAdCombined(item);
    };
  } else if (currentTab === 'goal') {
    cols = [
      { key: 'match', label: '对阵', sortable: false, colCls: 'q-col-match', hdCls: 'q-match-hd' },
      { key: 'bigBallRatio', label: '综合大球\n比例', sortable: true, colCls: 'q-col-big' },
      { key: 'attDefGoal', label: '攻防\n进球', sortable: true, colCls: 'q-col-ag' },
      { key: 'strengthGoal', label: '实力\n进球', sortable: true, colCls: 'q-col-sg' },
      { key: 'headToHeadGoal', label: '交锋\n进球', sortable: true, colCls: 'q-col-hg' },
      { key: 'breakArmor', label: '破甲和', sortable: true, colCls: 'q-col-ba' },
    ];
    renderRow = function (item) {
      return (
        renderGoalCell(item, 'bigBallRatio') +
        renderGoalCell(item, 'attDefGoal') +
        renderGoalCell(item, 'strengthGoal') +
        renderGoalCell(item, 'headToHeadGoal') +
        renderGoalCell(item, 'breakArmor')
      );
    };
  } else {
    cols = [
      { key: 'match', label: '对阵', sortable: false, colCls: 'q-col-match', hdCls: 'q-match-hd' },
      { key: 'rq', label: '让球数', sortable: false, colCls: 'q-col-rq' },
      { key: 'hotFocusNum', label: '关注\n热度\n（万）', sortable: true, colCls: 'q-col-hot' },
      { key: 'heatIndex', label: '冷热\n指数', sortable: true, colCls: 'q-col-heat' },
      { key: 'oddsLive', label: '亚指\n临盘', sortable: false, colCls: 'q-col-ol' },
    ];
    renderRow = function (item) {
      return (
        renderHotCell(item, 'rq') +
        renderHotCell(item, 'hotFocusNum') +
        renderHotCell(item, 'heatIndex') +
        renderHotCell(item, 'oddsLive')
      );
    };
  }

  // 构建机会分层摘要 + 卡片表格
  var h = renderOpportunitySummary(allData);
  if (sorted.length === 0) {
    wrap.innerHTML = h + '<div style="text-align:center;padding:42px 20px;color:var(--text3)">当前分层暂无比赛</div>';
    updatePkBar();
    return;
  }
  h += '<div class="quant-card-list">';

  // 表头
  h += '<div class="quant-card-header">';
  h += '<span class="q-col-chk"></span>';
  cols.forEach(function (c) {
    var isActive = sortKey === c.key;
    var sortCls = '';
    if (isActive && c.sortable) {
      sortCls = sortAsc ? ' q-sort-asc' : ' q-sort-desc';
    }
    h +=
      '<span class="' +
      c.colCls +
      (c.hdCls ? ' ' + c.hdCls : '') +
      (c.sortable ? ' q-sortable' + sortCls : '') +
      '" onclick="' +
      (c.sortable ? "sortBy('" + c.key + "')" : '') +
      '">' +
      c.label.replace(/\n/g, '<br>') +
      '</span>';
  });
  h += '</div>';

  // 数据行
  sorted.forEach(function (item) {
    var p = !!pickedIds[item.matchId];
    h += '<div id="qr-' + item.matchId + '" class="quant-card-row' + (p ? ' picked' : '') + '">';
    h +=
      '<span class="q-col-chk"><input type="checkbox" class="q-chk" ' +
      (p ? 'checked' : '') +
      ' onclick="togglePick(event,\'' +
      item.matchId +
      '\')"/></span>';
    h += renderMatch(item);
    h += renderRow(item);
    h += '</div>';
  });

  h += '</div>';
  wrap.innerHTML = h;
  updatePkBar();

  // P2-6: 显示视图切换按钮
  var toggle = document.getElementById('quantViewToggle');
  if (toggle && allData.length > 0) {
    toggle.style.display = 'flex';
  }
}

// ── 对战列 ──
function shortTeam(name) {
  if (!name) return '--';
  return name.length > 3 ? name.slice(0, 3) + '..' : name;
}

function renderMatch(item) {
  var tagsHtml = renderTags(item);
  return (
    '<span class="q-col-match q-match-cell">' +
    '<div class="q-match-teams" title="' +
    esc(item.homeName) +
    '">' +
    esc(shortTeam(item.homeName)) +
    '</div>' +
    '<div class="q-match-vs">vs</div>' +
    '<div class="q-match-teams" title="' +
    esc(item.visitName) +
    '">' +
    esc(shortTeam(item.visitName)) +
    '</div>' +
    renderDecisionBadge(item) +
    renderRiskChips(item) +
    (tagsHtml ? tagsHtml : '') +
    '</span>'
  );
}

// ── 总排序（四维合成得分，保留2位小数） ──
function renderRank(totalScore) {
  if (totalScore === undefined || totalScore === null || isNaN(totalScore))
    return '<span class="q-col-rk"><span class="q-cell-num">-</span></span>';
  var n = parseFloat(totalScore);
  var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return (
    '<span class="q-col-rk"><span class="q-cell-num ' +
    cls +
    '">' +
    (n >= 0 ? '+' : '') +
    n.toFixed(2) +
    '</span></span>'
  );
}

// ── 净胜球量化（保留2位小数） ──
function renderGoalDiff(item) {
  var v = item.gdScore !== undefined ? item.gdScore : item.goalDiff;
  if (v === '-' || v === '?' || v === undefined || v === null)
    return '<span class="q-col-gd"><span class="q-cell-num">-</span></span>';
  var n = parseFloat(v);
  if (isNaN(n)) return '<span class="q-col-gd"><span class="q-cell-num">' + v + '</span></span>';
  var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return (
    '<span class="q-col-gd"><span class="q-cell-num ' +
    cls +
    '">' +
    (n >= 0 ? '+' : '') +
    n.toFixed(2) +
    '</span></span>'
  );
}
// ── 综合实力（Total_战，百分比化显示） ──
function renderPower(item) {
  var pv = item.pwScore;
  if (pv === '-' || pv === undefined || pv === null)
    return '<span class="q-col-power"><span class="q-cell-num" style="color:var(--text4)">-</span></span>';
  var pct = pv * 100;
  var cls = pv > 0 ? 'pos' : pv < 0 ? 'neg' : '';
  return (
    '<span class="q-col-power"><span class="q-cell-num ' +
    cls +
    '">' +
    (pct >= 0 ? '+' : '') +
    pct.toFixed(1) +
    '%</span></span>'
  );
}

// ── 胜平负交叉（只展示RC值） ──
function renderCrossValue(item) {
  var v = item.crossValue;
  if (v === '-' || v === undefined || v === null) {
    return '<span class="q-col-cross"><span class="q-cell-num" style="color:var(--text4)">-</span></span>';
  }
  var n = v;
  if (typeof n !== 'number' || isNaN(n))
    return '<span class="q-col-cross"><span class="q-cell-num">' + v + '</span></span>';
  var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return '<span class="q-col-cross"><span class="q-cell-num ' + cls + '">' + (n >= 0 ? '+' : '') + n + '</span></span>';
}

// ── 攻守实力（保留2位小数，含格局徽章 P1-2） ──
function renderAdCombined(item) {
  var v = item.adCombined;
  var patternBadge = '';
  if (item.attackPattern) {
    var pc = item.attackPattern === '对攻为主' ? 'atk' : item.attackPattern === '防守为主' ? 'def' : 'bal';
    patternBadge =
      '<span class="pattern-badge ' +
      pc +
      '" title="' +
      (item.attackPattern === '对攻为主'
        ? '进攻优势度>0.15 且 防守优势度>-0.05'
        : item.attackPattern === '防守为主'
          ? '防守优势度>0.15 且 进攻优势度>-0.05'
          : '攻守平衡') +
      '">' +
      item.attackPattern +
      '</span>';
  }
  if (v === '-' || v === undefined || v === null)
    return (
      '<span class="q-col-ad"><span class="q-cell-num" style="color:var(--text4)">-</span>' + patternBadge + '</span>'
    );
  var n = parseFloat(v);
  if (isNaN(n)) return '<span class="q-col-ad"><span class="q-cell-num">' + v + '</span>' + patternBadge + '</span>';
  var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return (
    '<span class="q-col-ad"><span class="q-cell-num ' +
    cls +
    '">' +
    (n >= 0 ? '+' : '') +
    n.toFixed(2) +
    '</span>' +
    patternBadge +
    '</span>'
  );
}

// ── 进球 tab 单元格 (统一 toFixed(1)) ──
function renderGoalCell(item, key) {
  var v = item[key];
  if (v === '-' || v === undefined || v === null) {
    return (
      '<span class="q-col-' + keyToCls(key) + '"><span class="q-cell-num" style="color:var(--text4)">-</span></span>'
    );
  }
  var n = parseFloat(v);
  if (isNaN(n)) return '<span class="q-col-' + keyToCls(key) + '"><span class="q-cell-num">' + v + '</span></span>';
  var formatted;
  if (key === 'bigBallRatio') {
    formatted = n.toFixed(1) + '%';
  } else {
    formatted = (n >= 0 ? '+' : '') + n.toFixed(1);
  }
  var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return (
    '<span class="q-col-' + keyToCls(key) + '"><span class="q-cell-num ' + cls + '">' + formatted + '</span></span>'
  );
}

function keyToCls(key) {
  var m = {
    totalSum: 'sum',
    bigBallRatio: 'big',
    attDefGoal: 'ag',
    strengthGoal: 'sg',
    headToHeadGoal: 'hg',
    breakArmor: 'ba',
  };
  return m[key] || 'sum';
}

// ── M3.7 四重验证单元格 (P1-1) ──
function renderFusionCell(item) {
  var consensus = item.fusionConsensus;
  if (!consensus)
    return '<span class="q-col-fusion"><span class="q-cell-num" style="color:var(--text4)">-</span></span>';
  var cls = 'fusion-' + consensus;
  var label =
    consensus === 'strong' ? '强一致' : consensus === 'weak' ? '弱一致' : consensus === 'meltdown' ? '⚠️熔断' : '';
  var h = item.fusionFinalHome != null ? item.fusionFinalHome.toFixed(2) : '-';
  var a = item.fusionFinalAway != null ? item.fusionFinalAway.toFixed(2) : '-';
  return (
    '<span class="q-col-fusion">' +
    '<span class="fusion-badge ' +
    cls +
    '" title="E_final=H' +
    h +
    '+A' +
    a +
    '">' +
    label +
    '</span>' +
    '<span style="display:block;font-size:9px;color:var(--text3);line-height:1.2">H' +
    h +
    '+A' +
    a +
    '</span>' +
    '</span>'
  );
}

// ── 热点 tab 单元格 (去图标) ──
function renderHotCell(item, key) {
  var v = item[key];
  if (v === '-' || v === undefined || v === null) {
    return '<span class="q-col-' + hotKeyToCls(key) + '"><span class="q-cell-num">-</span></span>';
  }
  if (key === 'heatIndex') {
    // 去掉后端可能附加的图标，只取数值
    var cleaned = String(v).replace(/[^\d.]/g, '');
    var n = parseFloat(cleaned);
    if (isNaN(n)) return '<span class="q-col-heat"><span class="q-cell-num">' + v + '</span></span>';
    var cls = n > 1.2 ? 'neg' : n < 0.8 ? 'cool' : 'pos';
    return '<span class="q-col-heat"><span class="q-cell-num ' + cls + '">' + n.toFixed(2) + '</span></span>';
  }
  if (key === 'staticDiff') {
    var n = parseFloat(v);
    if (isNaN(n)) return '<span class="q-col-sd"><span class="q-cell-num">' + v + '</span></span>';
    var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
    return (
      '<span class="q-col-sd"><span class="q-cell-num ' +
      cls +
      '">' +
      (n >= 0 ? '+' : '') +
      n.toFixed(2) +
      '</span></span>'
    );
  }
  if (key === 'hotFocusNum') {
    var n = parseFloat(v);
    if (isNaN(n)) return '<span class="q-col-hot"><span class="q-cell-num">' + v + '</span></span>';
    var fmt = (n / 10000).toFixed(1);
    return '<span class="q-col-hot"><span class="q-cell-num pos">' + fmt + '</span></span>';
  }
  // rq, homeFeature, guestFeature, oddsLive
  // 文本字段清理箭头符号后展示
  if (key === 'rq' || key === 'homeFeature' || key === 'guestFeature') {
    var cleaned = String(v).replace(/→/g, '').trim();
    return '<span class="q-col-' + hotKeyToCls(key) + '"><span class="q-cell-num">' + cleaned + '</span></span>';
  }
  var n = parseFloat(v);
  if (isNaN(n)) return '<span class="q-col-' + hotKeyToCls(key) + '"><span class="q-cell-num">' + v + '</span></span>';
  return '<span class="q-col-' + hotKeyToCls(key) + '"><span class="q-cell-num">' + n.toFixed(2) + '</span></span>';
}

function hotKeyToCls(key) {
  var m = {
    rq: 'rq',
    hotFocusNum: 'hot',
    heatIndex: 'heat',
    homeFeature: 'hf',
    guestFeature: 'gf',
    staticDiff: 'sd',
    oddsLive: 'ol',
  };
  return m[key] || 'ol';
}

// ── 排序值提取 ──
function getSortVal(item, key) {
  switch (key) {
    case 'rank':
      return parseFloat(item.totalScore) || 0;
    case 'goalDiff':
      return parseFloat(item.gdScore) || 0;
    case 'cross':
      return parseFloat(item.crossValue) || 0;
    case 'power':
      return parseFloat(item.pwScore) || 0;
    case 'ad':
      return parseFloat(item.adCombined) || 0;
    case 'totalSum':
      return parseFloat(item.totalSum) || 0;
    case 'bigBallRatio':
      return parseFloat(item.bigBallRatio) || 0;
    case 'attDefGoal':
      return parseFloat(item.attDefGoal) || 0;
    case 'strengthGoal':
      return parseFloat(item.strengthGoal) || 0;
    case 'headToHeadGoal':
      return parseFloat(item.headToHeadGoal) || 0;
    case 'breakArmor':
      return parseFloat(item.breakArmor) || 0;
    case 'hotFocusNum':
      return parseFloat(item.hotFocusNum) || 0;
    case 'heatIndex':
      var hv = String(item.heatIndex).replace(/[^\d.]/g, '');
      return parseFloat(hv) || 0;
    case 'staticDiff':
      return parseFloat(item.staticDiff) || 0;
    default:
      return 0;
  }
}

// ═══ P0-1: 智能标签系统 ═══
function computeTags(item) {
  var tags = [];
  var pwScore = parseFloat(item.pwScore) || 0;
  // 1. 绝对优势: pwScore >= 0.25
  if (pwScore >= 0.25) tags.push({ e: '🔥', t: '绝对优势', c: 'tag-dominance' });
  // 2. 模型打架: 熔断
  if (item.fusionConsensus === 'meltdown') tags.push({ e: '⚠️', t: '模型打架', c: 'tag-meltdown' });
  // 3. 实力均衡: -0.08 ~ +0.08
  if (pwScore >= -0.08 && pwScore <= 0.08) tags.push({ e: '🎯', t: '实力均衡', c: 'tag-balanced' });
  // 4. 过热风险: heatIndex >= 1.40
  var heatIdx = parseFloat(item.heatIndex);
  if (!isNaN(heatIdx) && heatIdx >= 1.4) {
    tags.push({ e: '💰', t: '过热风险 (' + heatIdx.toFixed(2) + ')', c: 'tag-overheat' });
  }
  // 5. 冷门潜质: heatIndex <= 0.85
  if (!isNaN(heatIdx) && heatIdx > 0 && heatIdx <= 0.85) {
    tags.push({ e: '🧊', t: '冷门潜质 (' + heatIdx.toFixed(2) + ')', c: 'tag-cold' });
  }
  // 6. 防守大战: adCombined > 0.15 且总进球期望<2.0
  var ad = parseFloat(item.adCombined) || 0;
  var totalGoals = item.strengthGoal !== undefined ? parseFloat(item.strengthGoal) : 0;
  if (ad > 0.15 && totalGoals > 0 && totalGoals < 2.0) tags.push({ e: '🛡️', t: '防守大战', c: 'tag-defense' });
  // 7. 对攻大战: adCombined > 0.15 且总进球期望>3.0
  if (ad > 0.15 && totalGoals > 3.0) tags.push({ e: '⚡', t: '对攻大战', c: 'tag-attack' });
  return tags;
}

function renderTags(item) {
  var tags = computeTags(item);
  if (!tags.length) return '';
  return (
    '<span class="q-match-tags">' +
    tags
      .map(function (t) {
        return '<span class="q-tag ' + t.c + '" title="' + esc(t.t) + '">' + t.e + '</span>';
      })
      .join('') +
    '</span>'
  );
}

// ═══ P2-5/P2-6: ECharts 图表视图 + 响应式切换 ═══
var currentView = 'table';
var chartInstance = null;
var chartResizeHandler = null;

export function switchQuantView(view) {
  currentView = view;
  var tableWrap = document.getElementById('quantTableWrap');
  var chartWrap = document.getElementById('quantChartWrap');
  var toggle = document.getElementById('quantViewToggle');
  var btns = toggle ? toggle.querySelectorAll('.qt-view-btn') : [];

  btns.forEach(function (b) {
    b.classList.toggle('active', b.dataset.view === view);
  });

  if (view === 'chart') {
    if (tableWrap) tableWrap.style.display = 'none';
    if (chartWrap) chartWrap.style.display = 'block';
    setTimeout(function () {
      renderChart();
    }, 100);
  } else {
    if (tableWrap) tableWrap.style.display = 'block';
    if (chartWrap) chartWrap.style.display = 'none';
  }
}

function renderChart() {
  var container = document.getElementById('quantChart');
  if (!container) return;

  // 懒加载 ECharts
  loadECharts().then(function () {
    if (!echartsReady || !window.echarts) return;
    _doRenderChart(container);
  });
}

function getQuantChartPalettes(tab) {
  if (tab === 'power') {
    return [
      { start: '#a7eee6', end: '#5bd4c8', shadow: 'rgba(91, 212, 200, 0.26)' },
      { start: '#d7ebee', end: '#7faeb6', shadow: 'rgba(127, 174, 182, 0.24)' },
      { start: '#f7e8c9', end: '#d9b36c', shadow: 'rgba(217, 179, 108, 0.24)' },
      { start: '#ffd9d0', end: '#f46f59', shadow: 'rgba(244, 111, 89, 0.24)' },
    ];
  }
  if (tab === 'goal') {
    return [
      { start: '#c7f1ea', end: '#67c9b7', shadow: 'rgba(103, 201, 183, 0.24)' },
      { start: '#d9ecef', end: '#6faab2', shadow: 'rgba(111, 170, 178, 0.24)' },
      { start: '#faecd0', end: '#d8ba78', shadow: 'rgba(216, 186, 120, 0.24)' },
      { start: '#ffe3db', end: '#ef8b77', shadow: 'rgba(239, 139, 119, 0.24)' },
    ];
  }
  return [
    { start: '#ffd9d0', end: '#f46f59', shadow: 'rgba(244, 111, 89, 0.24)' },
    { start: '#f7e8c9', end: '#d9b36c', shadow: 'rgba(217, 179, 108, 0.24)' },
  ];
}

function buildQuantBarColor(palette) {
  if (!palette) return '#5bd4c8';
  if (window.echarts && window.echarts.graphic && typeof window.echarts.graphic.LinearGradient === 'function') {
    return new window.echarts.graphic.LinearGradient(0, 0, 1, 0, [
      { offset: 0, color: palette.start },
      { offset: 1, color: palette.end },
    ]);
  }
  return palette.end;
}

function _doRenderChart(container) {
  var filtered = allData.filter(function (item) {
    return (
      currentTab === 'power' ||
      currentTab === 'goal' ||
      (currentTab === 'hot' && item.hotFocusNum !== '-' && item.hotFocusNum !== undefined)
    );
  });

  if (!filtered.length) {
    container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text3)">暂无数据</div>';
    return;
  }

  var n = filtered.length;

  // 短队名（三行：主队 / vs / 客队）
  var names = filtered.map(function (item) {
    return shortTeam(item.homeName) + '\nvs\n' + shortTeam(item.visitName);
  });

  // ═══ 根据 tab 定义指标组 + 配色 ═══
  var seriesDefs, palettes;
  if (currentTab === 'power') {
    seriesDefs = [
      { name: '综合实力', key: 'pwScore', fmt: 4, unit: '' },
      { name: '净胜球量化', key: 'gdScore', fmt: 2, unit: '' },
      { name: '胜平负交叉', key: 'crossValue', fmt: 0, unit: '' },
      { name: '攻守实力', key: 'adCombined', fmt: 4, unit: '' },
    ];
    palettes = getQuantChartPalettes('power');
  } else if (currentTab === 'goal') {
    seriesDefs = [
      { name: '综合大球比例', key: 'bigBallRatio', fmt: 1, unit: '%' },
      { name: '攻防进球', key: 'attDefGoal', fmt: 1, unit: '' },
      { name: '交锋进球', key: 'headToHeadGoal', fmt: 1, unit: '' },
      { name: '破甲和', key: 'breakArmor', fmt: 1, unit: '' },
    ];
    palettes = getQuantChartPalettes('goal');
  } else {
    seriesDefs = [
      { name: '关注热度', key: 'hotFocusNum', fmt: 1, unit: '万', divide: 10000 },
      { name: '冷热指数', key: 'heatIndex', fmt: 2, unit: '' },
    ];
    palettes = getQuantChartPalettes('hot');
  }

  // ═══ 提取原始值 + 带padding的min-max归一化（防止极端值贴0%/100%） ═══
  var metricsData = seriesDefs.map(function (def) {
    var rawVals = filtered.map(function (item) {
      var raw;
      if (def.key === 'heatIndex') {
        var c = String(item.heatIndex || '').replace(/[^\d.-]/g, '');
        raw = parseFloat(c);
      } else {
        raw = parseFloat(item[def.key]);
      }
      if (isNaN(raw)) return null;
      if (def.divide) raw = raw / def.divide;
      return raw;
    });
    var valid = rawVals.filter(function (v) {
      return v !== null;
    });
    var min = valid.length ? Math.min.apply(null, valid) : 0;
    var max = valid.length ? Math.max.apply(null, valid) : 1;
    var range = max - min || 1;
    // 给范围加 10% 双向 padding，避免极端值贴边
    var pad = range * 0.1;
    var paddedMin = min - pad;
    var paddedMax = max + pad;
    var paddedRange = paddedMax - paddedMin;
    var normVals = rawVals.map(function (v) {
      if (v === null) return null;
      var norm = ((v - paddedMin) / paddedRange) * 100;
      norm = Math.max(0, Math.min(100, norm));
      return parseFloat(norm.toFixed(1));
    });
    return { rawVals: rawVals, normVals: normVals, min: min, max: max, range: range };
  });

  // ═══ 构建统一单图 series（分组柱状图） ═══
  var chartColors = palettes.map(function (palette) {
    return buildQuantBarColor(palette);
  });

  var allSeries = seriesDefs.map(function (def, i) {
    var md = metricsData[i];
    var palette = palettes[i] || palettes[palettes.length - 1];
    var baseColor = chartColors[i];
    var shadowColor = palette && palette.shadow ? palette.shadow : 'rgba(91, 212, 200, 0.18)';

    var data = filtered.map(function (item, j) {
      var raw = md.rawVals[j];
      var norm = md.normVals[j];
      if (raw === null || norm === null) return null;

      var tags = computeTags(item);
      var tagStr = tags
        .map(function (t) {
          return t.e + t.t;
        })
        .join(' ');

      // 格式化原始值（tooltip 用）
      var rawStr;
      if (def.key === 'hotFocusNum') {
        rawStr = raw.toFixed(def.fmt) + '万';
      } else if (def.key === 'bigBallRatio') {
        rawStr = raw.toFixed(def.fmt) + '%';
      } else if (def.key === 'heatIndex') {
        rawStr = raw.toFixed(def.fmt);
      } else if (def.key === 'crossValue') {
        rawStr = (raw >= 0 ? '+' : '') + Math.round(raw);
      } else if (def.key === 'pwScore' || def.key === 'adCombined') {
        rawStr = (raw >= 0 ? '+' : '') + raw.toFixed(def.fmt);
      } else {
        rawStr = (raw >= 0 ? '+' : '') + raw.toFixed(def.fmt);
      }

      return {
        value: norm,
        _raw: raw,
        _rawStr: rawStr,
        _norm: norm,
        _tags: tagStr,
        _name: names[j],
        _defName: def.name,
      };
    });

    return {
      name: def.name,
      type: 'bar',
      data: data,
      barMaxWidth: 18,
      barCategoryGap: '10%',
      barGap: '6%',
      showBackground: true,
      backgroundStyle: {
        color: 'rgba(130, 158, 164, 0.08)',
        borderRadius: [0, 6, 6, 0],
      },
      emphasis: { itemStyle: { shadowBlur: 12, shadowColor: shadowColor } },
      itemStyle: {
        color: function (params) {
          if (!params.data || params.data.value == null) return 'transparent';
          return baseColor;
        },
        borderColor: 'rgba(255, 255, 255, 0.34)',
        borderWidth: 1,
        borderRadius: [0, 6, 6, 0],
      },
      label: {
        show: true,
        position: 'right',
        color: '#94A3B8',
        fontSize: 8,
        formatter: function (params) {
          if (!params.data || params.data._norm == null) return '';
          return params.data._norm + '%';
        },
      },
    };
  });

  // ═══ 动态高度 ═══
  var rowH = 52; // 三行对阵名需要更高行高
  var headerH = 60;
  container.style.height = Math.max(400, headerH + n * rowH + 40) + 'px';

  // ═══ 销毁旧实例 ═══
  if (chartInstance) {
    chartInstance.dispose();
    chartInstance = null;
  }

  chartInstance = echarts.init(container);
  chartInstance.setOption({
    color: chartColors,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(15,23,42,0.95)',
      borderColor: 'rgba(24,224,224,0.2)',
      textStyle: { color: '#E2E8F0', fontSize: 12 },
      formatter: function (params) {
        if (!params || !params.length) return '';
        var first = params[0];
        var html =
          '<b style="font-size:13px">' + (first.data && first.data._name ? first.data._name : first.name) + '</b>';
        params.forEach(function (p) {
          if (!p.data || p.data._raw == null) return;
          var raw = p.data._raw;
          var signClr = raw >= 0 ? '#22c55e' : '#ef4444';
          html +=
            '<br/>' +
            p.marker +
            ' ' +
            p.data._defName +
            '：<b style="color:' +
            signClr +
            '">' +
            p.data._rawStr +
            '</b>' +
            ' <span style="color:#64748B;font-size:10px">(' +
            p.data._norm +
            '%)</span>';
        });
        var tags =
          first.data && first.data._tags
            ? '<br/><span style="color:#94A3B8;font-size:10px">' + first.data._tags + '</span>'
            : '';
        html += tags;
        return html;
      },
    },
    legend: {
      data: seriesDefs.map(function (d) {
        return d.name;
      }),
      textStyle: { color: '#94A3B8', fontSize: 11 },
      top: 4,
      left: 'center',
      itemWidth: 12,
      itemHeight: 12,
      itemGap: 16,
    },
    grid: {
      left: '14%',
      right: '8%',
      top: 50,
      bottom: 16,
    },
    xAxis: {
      type: 'value',
      max: 100,
      min: 0,
      axisLabel: { color: '#64748B', fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: 'rgba(24,224,224,0.06)', type: 'dashed' } },
      axisLine: { lineStyle: { color: 'rgba(24,224,224,0.15)' } },
      splitNumber: 5,
    },
    yAxis: {
      type: 'category',
      data: names,
      axisLabel: { color: '#94A3B8', fontSize: 10, lineHeight: 14 },
      axisLine: { show: false },
      axisTick: { show: false },
      inverse: true,
      splitArea: {
        show: true,
        areaStyle: {
          color: ['transparent', 'rgba(255,255,255,0.03)'],
        },
      },
    },
    series: allSeries,
    backgroundColor: 'transparent',
  });

  // 清理旧 resize 监听，添加新的
  if (chartResizeHandler) window.removeEventListener('resize', chartResizeHandler);
  chartResizeHandler = function () {
    if (chartInstance) chartInstance.resize();
  };
  window.addEventListener('resize', chartResizeHandler);
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

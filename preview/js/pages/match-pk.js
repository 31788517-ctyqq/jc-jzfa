import { api } from '../api.js';

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function shortTeam(name) { if (!name) return '--'; return name.length > 3 ? name.slice(0, 3) + '..' : name; }

/** 打开多场PK弹窗 */
export function openPKMulti(pickedList, tab) {
  var overlay = document.getElementById('pkOverlay');
  if (!overlay || pickedList.length < 2) return;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  var modal = document.getElementById('pkModal');
  if (!modal) return;
  modal.innerHTML = '<div style="text-align:center;padding:80px 20px;color:var(--cyan)"><div style="font-size:36px;margin-bottom:12px">⚔️</div><div style="font-size:14px;font-weight:600">PK数据分析中...</div></div>';

  // 为每场补全 GS 数据（带 5 秒超时保护）
  var promises = pickedList.map(function (item) {
    if (item.hasGS && item.totalAdvantage) return Promise.resolve(item);
    return Promise.race([
      api('gongshoudao', { matchId: item.matchId }).then(function (gs) {
        return Object.assign({}, item, buildGSFields(gs));
      }),
      new Promise(function (resolve) { setTimeout(function () { resolve(item); }, 5000); })
    ]).catch(function () { return item; });
  });

  var totalTimeout = new Promise(function (resolve) {
    setTimeout(function () { resolve(null); }, 8000);
  });
  Promise.race([Promise.all(promises), totalTimeout]).then(function (fullList) {
    if (!fullList) fullList = pickedList;  // 超时则用原数据渲染
    var t = tab || 'power';
    if (t === 'power') renderPKPower(modal, fullList);
    else if (t === 'goal') renderPKGoal(modal, fullList);
    else renderPKHot(modal, fullList);
  });
}

function buildGSFields(gs) {
  gs = gs || {};
  return {
    totalAdvantage: gs.totalAdvantage || '-',
    totalAdvantageValue: gs.totalAdvantageValue || 0,
    attackWeightHome: gs.attackWeightHome || '50%',
    attackWeightAway: gs.attackWeightAway || '50%',
    defenseWeightHome: gs.defenseWeightHome || '50%',
    defenseWeightAway: gs.defenseWeightAway || '50%',
    attackPattern: gs.attackPattern || '',
    attackAdvantageValue: gs.attackAdvantageValue || 50,
    defenseAdvantageValue: gs.defenseAdvantageValue || 50,
    goalDiffHome: gs.goalDiffHome || '-',
    goalDiffAway: gs.goalDiffAway || '-',
    totalGoalsExpect: gs.totalGoalsExpect || '-',
    totalGoalsValue: gs.totalGoalsValue || 0,
    crossWin: gs.crossWin || '-',
    crossDraw: gs.crossDraw || '-',
    crossLose: gs.crossLose || '-',
    crossRq: gs.crossRq || 0,
    goalRange: (gs.goalRange || {}).range || '-',
    // ★ 新增 V24 字段
    xgHome: gs.xgHome != null ? gs.xgHome : 0,
    xgAway: gs.xgAway != null ? gs.xgAway : 0,
    adWeightedComposite: gs.adWeightedComposite != null ? gs.adWeightedComposite : 0,
    totalStrength: gs.totalStrength != null ? gs.totalStrength : 0,
    // ★ P1-3: 胜平负交叉双组概率
    crossSpfWin: gs.crossSpfWin || '-',
    crossSpfDraw: gs.crossSpfDraw || '-',
    crossSpfLose: gs.crossSpfLose || '-',
    crossHcpWin: gs.crossHcpWin || '-',
    crossHcpDraw: gs.crossHcpDraw || '-',
    crossHcpLose: gs.crossHcpLose || '-',
    // ★ P1-1: 四重熔断
    fusionConsensus: gs.fusionConsensus || '',
    fusionFinalHome: gs.fusionFinalHome != null ? gs.fusionFinalHome : 0,
    fusionFinalAway: gs.fusionFinalAway != null ? gs.fusionFinalAway : 0,
    // ★ 进球维度
    bigBallRatio: gs.bigBallRatio != null ? gs.bigBallRatio : 50,
    attDefGoal: gs.attDefGoal != null ? gs.attDefGoal : 0,
    strengthGoal: gs.strengthGoal != null ? gs.strengthGoal : 0,
    headToHeadGoal: gs.h2hGoalAvg != null ? gs.h2hGoalAvg : 2.5,
    breakArmor: gs.breakArmorSum != null ? gs.breakArmorSum : 0,
    totalSum: function () {
      var b = Math.abs(gs.bigBallRatio || 50) + Math.abs(gs.attDefGoal || 0) + Math.abs(gs.strengthGoal || 0) +
        Math.abs(gs.h2hGoalAvg || 2.5) + Math.abs(gs.breakArmorSum || 0);
      return parseFloat(b.toFixed(4));
    }(),
    hasGS: !!(gs.attackPattern)
  };
}

function renderPKGoal(modal, list) {
  var n = list.length;

  // ═══ 构建数据表 ═══
  var html =
    '<div class="pk2-header">' +
      '<span class="pk2-title">进球PK对比</span>' +
      '<span class="pk2-close" onclick="closePK()">✕</span>' +
    '</div>';

  // ── 表1：球队信息 + 基础指标 ──
  html += '<div class="pk2-section-label">核心指标对比</div>';
  html += '<div class="pk2-table-wrap"><table class="pk2-table">';

  // 表头
  html += '<thead><tr><th class="pk2-th-name">对阵</th><th class="pk2-th-num">合计</th>' +
    '<th class="pk2-th-num">大球<br>比例</th>' +
    '<th class="pk2-th-num">攻防进球<br>占比</th>' +
    '<th class="pk2-th-num">实力进球<br>占比</th>' +
    '<th class="pk2-th-num">交锋进球<br>占比</th>' +
    '<th class="pk2-th-num">破甲和<br>占比</th>' +
    '</tr></thead><tbody>';

  // 计算列合计
  var colSums = calcColSums(list);

  list.forEach(function (item, i) {
    var row = buildTableRow(item, i + 1, colSums, n);
    html += row;
  });

  // 合计行
  html += '<tr class="pk2-row-total">' +
    '<td class="pk2-td-name"><b>列合计</b></td>' +
    '<td class="pk2-td-num"></td>' +
    tdPct(colSums.bigBall, colSums.bigBall) +
    tdPct(colSums.attDef, colSums.attDef) +
    tdPct(colSums.power, colSums.power) +
    tdPct(colSums.cross, colSums.cross) +
    tdPct(colSums.armor, colSums.armor) +
    '</tr>';

  html += '</tbody></table></div>';

  // ── M3.7 四重验证展示 (P1-1) ──
  if (n === 2) {
    var fusionA = renderFusionInfo(list[0]);
    var fusionB = renderFusionInfo(list[1]);
    if (fusionA || fusionB) {
      html += '<div class="pk2-section-label">四重验证校准</div>';
      html += '<div class="pk2-fusion-row">';
      html += '<div class="pk2-fusion-team"><b>' + esc(shortTeam(list[0].homeName)) + '</b> ' + fusionA + '</div>';
      html += '<div class="pk2-fusion-team"><b>' + esc(shortTeam(list[1].homeName)) + '</b> ' + fusionB + '</div>';
      html += '</div>';
    }
  }

  // ── PK结果卡 ──
  html += '<div class="pk2-section-label">PK结果</div>';

  if (n === 2) {
    html += renderPKCard(list[0], list[1]);
  } else {
    // 多场：两两PK
    for (var ai = 0; ai < n - 1; ai++) {
      for (var bi = ai + 1; bi < n; bi++) {
        html += '<div style="font-size:10px;color:var(--text3);padding:8px 16px 2px">对决 ' + (ai + 1) + ' vs ' + (bi + 1) + '</div>';
        html += renderPKCard(list[ai], list[bi]);
      }
    }
  }

  // ── 底部按钮 ──
  html += renderPKSummary(list);
  html += renderComboRecommendations(list);
  html += '<div class="pk2-footer"><button class="pk2-done-btn" onclick="closePK()">完成</button></div>';

  modal.innerHTML = html;
}

// ═══ 列合计计算 ═══
function calcColSums(list) {
  var sums = { bigBall: 0, attDef: 0, power: 0, cross: 0, armor: 0 };
  list.forEach(function (item) {
    sums.bigBall  += Math.abs(parseFloat(item.bigBallRatio) || 0);
    sums.attDef   += Math.abs(parseFloat(item.attDefGoal) || 0);
    sums.power    += Math.abs(parseFloat(item.strengthGoal) || 0);
    sums.cross    += Math.abs(parseFloat(item.headToHeadGoal) || 0);
    sums.armor    += Math.abs(parseFloat(item.breakArmor) || 0);
  });
  return sums;
}

function calcRowValues(item) {
  var g = parseFloat(item.bigBallRatio) || 0;
  var a = parseFloat(item.attDefGoal) || 0;
  var p = parseFloat(item.strengthGoal) || 0;
  var c = parseFloat(item.headToHeadGoal) || 0;
  var r = parseFloat(item.breakArmor) || 0;
  return { bigBall: g, attDef: a, power: p, cross: c, armor: r };
}

function buildTableRow(item, idx, colSums, total) {
  var vals = calcRowValues(item);
  return '<tr class="pk2-row">' +
    '<td class="pk2-td-name"><div class="pk2-match-line">' + esc(item.homeName) + '</div>' +
      '<div class="pk2-match-vs">vs</div>' +
      '<div class="pk2-match-line">' + esc(item.visitName) + '</div></td>' +
    '<td class="pk2-td-num"></td>' +
    tdPctNum(vals.bigBall, colSums.bigBall) +
    tdPctNum(vals.attDef, colSums.attDef) +
    tdPctNum(vals.power, colSums.power) +
    tdPctNum(vals.cross, colSums.cross) +
    tdPctNum(vals.armor, colSums.armor) +
    '</tr>';
}

function tdPct(val, sum) {
  var pct = sum > 0 ? Math.round(Math.abs(val) / sum * 100) : 0;
  var cls = val >= 0 ? 'pk2-pct-pos' : 'pk2-pct-neg';
  return '<td class="pk2-td-num"><span class="' + cls + '">' + pct + '%</span></td>';
}

function tdPctNum(val, sum) {
  var d = Math.abs(val);
  var pct = sum > 0 ? Math.round(d / sum * 100) : 0;
  var label = val >= 0 ? '+' + d.toFixed(1) : d.toFixed(1);
  var cls = val >= 0 ? 'pk2-pct-pos' : 'pk2-pct-neg';
  return '<td class="pk2-td-num"><span class="' + cls + '">' + pct + '%</span></td>';
}

// ═══ PK结果卡片（通用） ═══
function renderPKCard(a, b) {
  var dims = [
    { label: '合计PK',      va: parseFloat(a.totalSum) || 0, vb: parseFloat(b.totalSum) || 0 },
    { label: '大球比例PK',  va: parseFloat(a.bigBallRatio) || 0, vb: parseFloat(b.bigBallRatio) || 0 },
    { label: '攻防进球PK',  va: parseFloat(a.attDefGoal) || 0, vb: parseFloat(b.attDefGoal) || 0 },
    { label: '实力进球PK',  va: parseFloat(a.strengthGoal) || 0, vb: parseFloat(b.strengthGoal) || 0 },
    { label: '交锋进球PK',  va: parseFloat(a.headToHeadGoal) || 0, vb: parseFloat(b.headToHeadGoal) || 0 },
    { label: '破甲和PK',    va: parseFloat(a.breakArmor) || 0, vb: parseFloat(b.breakArmor) || 0 }
  ];

  return buildPKCard(a, b, dims);
}

function buildPKCard(a, b, dims) {
  var aWins = 0, bWins = 0;

  var rows = dims.map(function (dim) {
    var result;
    if (dim.va > dim.vb) { result = 'a'; aWins++; }
    else if (dim.vb > dim.va) { result = 'b'; bWins++; }
    else { result = 'draw'; }

    return '<div class="pk2-result-row">' +
      '<span class="pk2-result-label">' + dim.label + '</span>' +
      '<span class="pk2-result-values">' +
        '<span class="' + (result === 'a' ? 'pk2-win' : '') + '">' + esc(shortTeam(a.homeName)) + ' (' + dim.va.toFixed(1) + ')</span>' +
        ' vs ' +
        '<span class="' + (result === 'b' ? 'pk2-win' : '') + '">' + esc(shortTeam(b.homeName)) + ' (' + dim.vb.toFixed(1) + ')</span>' +
      '</span>' +
      '<span class="pk2-result-arrow ' + (result === 'a' ? 'pk2-win' : result === 'b' ? 'pk2-lose' : '') + '">' +
        (result === 'a' ? esc(shortTeam(a.homeName)) + ' 胜' : result === 'b' ? esc(shortTeam(b.homeName)) + ' 胜' : '平') +
      '</span>' +
    '</div>';
  }).join('');

  return '<div class="pk2-card">' +
    '<div class="pk2-card-head">' +
      '<div class="pk2-card-team">' + esc(shortTeam(a.homeName)) + '</div>' +
      '<span class="pk2-card-vs">VS</span>' +
      '<div class="pk2-card-team">' + esc(shortTeam(b.homeName)) + '</div>' +
    '</div>' +
    '<div class="pk2-card-body">' + rows + '</div>' +
    '<div class="pk2-card-summary">总PK：' +
      '<b style="color:var(--cyan)">' + esc(shortTeam(a.homeName)) + ' (' + aWins + '胜)</b> ' +
      (aWins > bWins ? '👑' : aWins === bWins ? '⚖️ 平局' : '') +
      (bWins > aWins ? ' <b style="color:#f97316">' + esc(shortTeam(b.homeName)) + ' (' + bWins + '胜)</b> 👑' : '') +
    '</div></div>';
}

// ═══ 实力维度PK ═══
function renderPKPower(modal, list) {
  var n = list.length;
  var html =
    '<div class="pk2-header">' +
      '<span class="pk2-title">实力PK对比</span>' +
      '<span class="pk2-close" onclick="closePK()">✕</span>' +
    '</div>';

  html += '<div class="pk2-section-label">实力维度指标对比</div>';
  html += '<div class="pk2-table-wrap"><table class="pk2-table">';
  html += '<thead><tr><th class="pk2-th-name">对阵</th>' +
    '<th class="pk2-th-num">总排序</th>' +
    '<th class="pk2-th-num">净胜球<br>量化</th>' +
    '<th class="pk2-th-num">胜平负<br>交叉</th>' +
    '<th class="pk2-th-num">综合<br>实力</th>' +
    '<th class="pk2-th-num">攻守<br>实力</th>' +
    '</tr></thead><tbody>';

  var colSums = { gd: 0, cross: 0, power: 0, ad: 0 };
  list.forEach(function (item) {
    colSums.gd    += Math.abs(parseFloat(item.gdScore) || 0);
    colSums.cross += Math.abs(parseFloat(item.crossValue) || 0);
    colSums.power += Math.abs(parseFloat(item.pwScore) || 0);
    colSums.ad    += Math.abs(parseFloat(item.adCombined) || 0);
  });

  list.forEach(function (item, i) {
    var gd    = parseFloat(item.gdScore) || 0;
    var cross = parseFloat(item.crossValue) || 0;
    var power = parseFloat(item.pwScore) || 0;
    var ad    = parseFloat(item.adCombined) || 0;
    html += '<tr class="pk2-row">' +
      '<td class="pk2-td-name"><div class="pk2-match-line">' + esc(item.homeName) + '</div>' +
        '<div class="pk2-match-vs">vs</div>' +
        '<div class="pk2-match-line">' + esc(item.visitName) + '</div></td>' +
      '<td class="pk2-td-num">' + (item.rank || '-') + '</td>' +
      tdPctBar(gd, colSums.gd) +
      tdPctBarCross(cross, colSums.cross, item) +
      tdPctBar(power, colSums.power) +
      tdPctBar(ad, colSums.ad) +
      '</tr>';
  });

  html += '<tr class="pk2-row-total"><td class="pk2-td-name"><b>列合计</b></td>' +
    '<td class="pk2-td-num"></td>' +
    tdPct(colSums.gd, colSums.gd) +
    tdPct(colSums.cross, colSums.cross) +
    tdPct(colSums.power, colSums.power) +
    tdPct(colSums.ad, colSums.ad) +
    '</tr>';
  html += '</tbody></table></div>';

  html += '<div class="pk2-section-label">实力PK结果</div>';
  html += renderPowerPKCard(list);
  html += renderPKSummary(list);
  html += renderComboRecommendations(list);
  html += '<div class="pk2-footer"><button class="pk2-done-btn" onclick="closePK()">完成</button></div>';
  modal.innerHTML = html;
}

function renderPowerPKCard(list) {
  if (list.length === 2) return renderPowerDuel(list[0], list[1]);
  var html = '';
  for (var i = 0; i < list.length - 1; i++) {
    for (var j = i + 1; j < list.length; j++) {
      html += '<div style="font-size:10px;color:var(--text3);padding:8px 16px 2px">对决 ' + (i + 1) + ' vs ' + (j + 1) + '</div>';
      html += renderPowerDuel(list[i], list[j]);
    }
  }
  return html;
}

function renderPowerDuel(a, b) {
  var dims = [
    { label: '总排序PK',      va: a.rank || 99, vb: b.rank || 99, lowerWins: true },
    { label: '净胜球量化PK',  va: parseFloat(a.gdScore) || 0, vb: parseFloat(b.gdScore) || 0 },
    { label: '胜平负PK',      va: parseFloat(a.crossValue) || 0, vb: parseFloat(b.crossValue) || 0 },
    { label: '综合实力PK',    va: parseFloat(a.pwScore) || 0, vb: parseFloat(b.pwScore) || 0 },
    { label: '攻守实力PK',    va: parseFloat(a.adCombined) || 0, vb: parseFloat(b.adCombined) || 0 }
  ];

  var aWins = 0, bWins = 0;
  var rows = dims.map(function (d) {
    var result;
    if (d.lowerWins) {
      result = d.va < d.vb ? 'a' : d.vb < d.va ? 'b' : 'draw';
    } else {
      result = d.va > d.vb ? 'a' : d.vb > d.va ? 'b' : 'draw';
    }
    if (result === 'a') aWins++; else if (result === 'b') bWins++;
    return '<div class="pk2-result-row">' +
      '<span class="pk2-result-label">' + d.label + '</span>' +
      '<span class="pk2-result-values">' +
        '<span class="' + (result === 'a' ? 'pk2-win' : '') + '">' + esc(shortTeam(a.homeName)) + ' (' + (typeof d.va === 'number' ? d.va.toFixed(2) : d.va) + ')</span>' +
        ' vs ' +
        '<span class="' + (result === 'b' ? 'pk2-win' : '') + '">' + esc(shortTeam(b.homeName)) + ' (' + (typeof d.vb === 'number' ? d.vb.toFixed(2) : d.vb) + ')</span>' +
      '</span>' +
      '<span class="pk2-result-arrow ' + (result === 'a' ? 'pk2-win' : result === 'b' ? 'pk2-lose' : '') + '">' +
        (result === 'a' ? esc(shortTeam(a.homeName)) + ' 胜' : result === 'b' ? esc(shortTeam(b.homeName)) + ' 胜' : '平') +
      '</span>' +
    '</div>';
  }).join('');

  return '<div class="pk2-card">' +
    '<div class="pk2-card-head">' +
      '<div class="pk2-card-team">' + esc(shortTeam(a.homeName)) + '</div>' +
      '<span class="pk2-card-vs">VS</span>' +
      '<div class="pk2-card-team">' + esc(shortTeam(b.homeName)) + '</div>' +
    '</div>' +
    '<div class="pk2-card-body">' + rows + '</div>' +
    '<div class="pk2-card-summary">总PK：' +
      '<b style="color:var(--cyan)">' + esc(shortTeam(a.homeName)) + ' (' + aWins + '胜)</b> ' +
      (aWins > bWins ? '👑' : aWins === bWins ? '⚖️ 平局' : '') +
      (bWins > aWins ? ' <b style="color:#f97316">' + esc(shortTeam(b.homeName)) + ' (' + bWins + '胜)</b> 👑' : '') +
    '</div></div>';
}

// 百分比单元格（无进度条）
function tdPctBar(val, sum) {
  var absV = Math.abs(val);
  var pct = sum > 0 ? Math.round(absV / sum * 100) : 0;
  var sign = val >= 0 ? '+' : '';
  var cls = val >= 0 ? 'pk2-pct-pos' : 'pk2-pct-neg';
  return '<td class="pk2-td-num"><span class="' + cls + '">' + pct + '%</span></td>';
}

// ═══ P1-3: 胜平负交叉列（含双组概率迷你标签） ═══
function tdPctBarCross(val, sum, item) {
  var absV = Math.abs(val);
  var pct = sum > 0 ? Math.round(absV / sum * 100) : 0;
  var cls = val >= 0 ? 'pk2-pct-pos' : 'pk2-pct-neg';
  var mini = '';
  var spfW = item.crossSpfWin, spfD = item.crossSpfDraw, spfL = item.crossSpfLose;
  var hcpW = item.crossHcpWin, hcpD = item.crossHcpDraw, hcpL = item.crossHcpLose;
  if (spfW !== '-' && spfW !== undefined) {
    mini += '<span style="display:block;font-size:8px;color:#64748B;line-height:1.1;margin-top:1px">'
      + '胜' + Number(spfW).toFixed(0) + '%平' + Number(spfD).toFixed(0) + '%负' + Number(spfL).toFixed(0) + '%</span>';
  }
  return '<td class="pk2-td-num"><span class="' + cls + '">' + pct + '%</span>' + mini + '</td>';
}

// ═══ 热度维度PK ═══
function renderPKHot(modal, list) {
  var n = list.length;
  var html =
    '<div class="pk2-header">' +
      '<span class="pk2-title">热度PK对比</span>' +
      '<span class="pk2-close" onclick="closePK()">✕</span>' +
    '</div>';

  var hasHotData = list.some(function (item) { return item.hotFocusNum !== '-' && item.hotFocusNum !== undefined; });

  if (!hasHotData) {
    html += '<div style="text-align:center;padding:80px 20px;color:var(--text3);font-size:13px">' +
      '⚠️ 热点数据尚未接入<br><br>' +
      '含：让球数、关注热度、冷热指数、主客队特征、亚指临盘<br>' +
      '请等待后端数据接口就绪</div>';
    html += '<div class="pk2-footer"><button class="pk2-done-btn" onclick="closePK()">完成</button></div>';
    modal.innerHTML = html;
    return;
  }

  html += '<div class="pk2-section-label">热度维度指标对比</div>';
  html += '<div class="pk2-table-wrap"><table class="pk2-table">';
  html += '<thead><tr><th class="pk2-th-name">对阵</th>' +
    '<th class="pk2-th-num">关注热度<br>占比</th>' +
    '<th class="pk2-th-num">冷热指数<br>占比</th>' +
    '<th class="pk2-th-num">静态实力差<br>占比</th>' +
    '<th class="pk2-th-num">亚指临盘<br>占比</th>' +
    '</tr></thead><tbody>';

  var colSums = { hot: 0, heat: 0, diff: 0, odds: 0 };
  list.forEach(function (item) {
    colSums.hot  += Math.abs(parseFloat(item.hotFocusNum) || 0);
    colSums.heat += Math.abs(parseFloat(item.heatIndex) || 0);
    colSums.diff += Math.abs(parseFloat(item.staticDiff) || 0);
    colSums.odds += Math.abs(parseFloat(item.oddsLive) || 0);
  });

  list.forEach(function (item, i) {
    var hot  = parseFloat(item.hotFocusNum) || 0;
    var heat = parseFloat(item.heatIndex) || 0;
    var diff = parseFloat(item.staticDiff) || 0;
    var odds = parseFloat(item.oddsLive) || 0;
    html += '<tr class="pk2-row">' +
      '<td class="pk2-td-name"><div class="pk2-match-line">' + esc(item.homeName) + '</div>' +
        '<div class="pk2-match-vs">vs</div>' +
        '<div class="pk2-match-line">' + esc(item.visitName) + '</div></td>' +
      tdPctBar(hot,  colSums.hot) +
      tdPctBar(heat, colSums.heat) +
      tdPctBar(diff, colSums.diff) +
      tdPctBar(odds, colSums.odds) +
      '</tr>';
  });

  html += '<tr class="pk2-row-total"><td class="pk2-td-name"><b>列合计</b></td>' +
    tdPct(colSums.hot, colSums.hot) +
    tdPct(colSums.heat, colSums.heat) +
    tdPct(colSums.diff, colSums.diff) +
    tdPct(colSums.odds, colSums.odds) +
    '</tr>';
  html += '</tbody></table></div>';

  // ── PK结果卡 (P1-4) ──
  html += '<div class="pk2-section-label">热度PK结果</div>';
  if (n === 2) {
    html += renderHotPKCard(list[0], list[1]);
  } else {
    for (var ai = 0; ai < n - 1; ai++) {
      for (var bi = ai + 1; bi < n; bi++) {
        html += '<div style="font-size:10px;color:var(--text3);padding:8px 16px 2px">对决 ' + (ai + 1) + ' vs ' + (bi + 1) + '</div>';
        html += renderHotPKCard(list[ai], list[bi]);
      }
    }
  }

  html += renderPKSummary(list);
  html += renderComboRecommendations(list);
  html += '<div class="pk2-footer"><button class="pk2-done-btn" onclick="closePK()">完成</button></div>';
  modal.innerHTML = html;
}

// ═══ 热度PK结果卡片 (P1-4) ═══
function renderHotPKCard(a, b) {
  var h2 = function (v) {
    if (v === '-' || v === undefined || v === null) return 0;
    var cleaned = String(v).replace(/[^\d.\-]/g, '');
    return parseFloat(cleaned) || 0;
  };

  var dims = [
    { label: '关注热度PK',  va: h2(a.hotFocusNum), vb: h2(b.hotFocusNum) },
    { label: '冷热指数PK',  va: h2(a.heatIndex),   vb: h2(b.heatIndex) },
    { label: '实力差PK',    va: h2(a.staticDiff),  vb: h2(b.staticDiff) },
    { label: '亚指临盘PK',  va: h2(a.oddsLive),    vb: h2(b.oddsLive) }
  ];

  // P1-4: 热度解读标签
  var verdict = renderHeatVerdict(a, b);

  return buildPKCard(a, b, dims) + verdict;
}

// P1-4: 冷热指数解读
function renderHeatVerdict(a, b) {
  var hiA = parseFloat(a.heatIndex);
  var hiB = parseFloat(b.heatIndex);
  if (isNaN(hiA) && isNaN(hiB)) return '';

  var verdicts = [];
  var addV = function (name, hi) {
    if (isNaN(hi)) return;
    if (hi >= 1.40) verdicts.push('<span style="color:#f87171;font-weight:700">🔥 ' + name + '过热(' + hi.toFixed(2) + ')</span>');
    else if (hi <= 0.85) verdicts.push('<span style="color:#60a5fa;font-weight:700">🧊 ' + name + '冷藏(' + hi.toFixed(2) + ')</span>');
  };
  addV(esc(shortTeam(a.homeName)), hiA);
  addV(esc(shortTeam(b.homeName)), hiB);

  if (!verdicts.length) return '';

  return '<div style="margin:0 10px 8px;padding:8px 12px;border-radius:10px;' +
    'background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.15);font-size:11px;text-align:center">' +
    '📡 市场热度提示：' + verdicts.join(' · ') + '</div>';
}

// ═══ P1-1: 四重验证信息 ───
function renderFusionInfo(item) {
  if (!item.fusionConsensus) return '';
  var consensus = item.fusionConsensus;
  var cls = 'fusion-' + consensus;
  var label = consensus === 'strong' ? '强一致' : consensus === 'weak' ? '弱一致' : consensus === 'meltdown' ? '⚠️熔断' : '';
  var h = item.fusionFinalHome != null ? item.fusionFinalHome.toFixed(2) : '-';
  var a = item.fusionFinalAway != null ? item.fusionFinalAway.toFixed(2) : '-';
  return '<span class="fusion-badge ' + cls + '" title="最终基准值 H:' + h + ' A:' + a + '">' + label + '</span> ' +
    '<span style="font-size:11px;color:var(--text3)">E_final=H' + h + '+A' + a + '</span>';
}

// ═══ P0-2: PK增强汇总面板 ═══
function renderPKSummary(list) {
  var n = list.length;
  // 1. 平均综合实力
  var sumPw = 0, pwCount = 0;
  list.forEach(function (item) {
    var pw = parseFloat(item.pwScore) || parseFloat(item.totalStrength) || 0;
    sumPw += pw; pwCount++;
  });
  var avgPw = pwCount > 0 ? parseFloat((sumPw / pwCount).toFixed(2)) : 0;

  // 2. 主队优势率
  var homeAdv = 0;
  list.forEach(function (item) {
    var pw = parseFloat(item.pwScore) || parseFloat(item.totalStrength) || 0;
    if (pw > 0) homeAdv++;
  });
  var homeRatio = n > 0 ? Math.round(homeAdv / n * 100) : 0;

  // 3. 模型健康度
  var meltdownCount = 0;
  list.forEach(function (item) {
    if (item.fusionConsensus === 'meltdown') meltdownCount++;
  });
  var healthScore = n > 0 ? Math.round((1 - meltdownCount / n) * 100) : 100;

  // 4. 热度偏离度
  var heatDev = 0;
  list.forEach(function (item) {
    var hi = parseFloat(item.heatIndex);
    if (!isNaN(hi) && (hi > 1.2 || hi < 0.8)) heatDev++;
  });

  var pwCls = avgPw > 0 ? 'pk2-pct-pos' : avgPw < 0 ? 'pk2-pct-neg' : '';
  var healthCls = healthScore >= 80 ? 'pk2-pct-pos' : healthScore >= 50 ? '' : 'pk2-pct-neg';

  return '<div class="pk2-section-label">📊 综合评估</div>' +
    '<div class="pk2-summary-panel">' +
      '<div class="pk2-summary-row">' +
        '<span class="pk2-summary-label">平均综合实力</span>' +
        '<span class="pk2-summary-value ' + pwCls + '">' + (avgPw >= 0 ? '+' : '') + avgPw.toFixed(2) + '</span>' +
      '</div>' +
      '<div class="pk2-summary-row">' +
        '<span class="pk2-summary-label">主队优势率</span>' +
        '<span class="pk2-summary-value">' + homeRatio + '%（' + homeAdv + '/' + n + '场）</span>' +
      '</div>' +
      '<div class="pk2-summary-row">' +
        '<span class="pk2-summary-label">模型健康度</span>' +
        '<span class="pk2-summary-value ' + healthCls + '">' + healthScore + '%' +
        (meltdownCount > 0 ? ' <span style="font-size:9px;color:#ef5350">⚠️' + meltdownCount + '场熔断</span>' : '') +
        '</span>' +
      '</div>' +
      (heatDev > 0 ? '<div class="pk2-summary-row">' +
        '<span class="pk2-summary-label">热度偏离度</span>' +
        '<span class="pk2-summary-value" style="color:#fbbf24">' + heatDev + '场异常</span>' +
      '</div>' : '') +
    '</div>';
}

// ═══ P1-3: 组合推荐卡片 ═══
function renderComboRecommendations(list) {
  var n = list.length;
  if (n < 2 || n > 4) return '';

  // 为每场计算辅助信息
  var withInfo = list.map(function (item, i) {
    var pw = parseFloat(item.pwScore) || parseFloat(item.totalStrength) || 0;
    var hi = parseFloat(item.heatIndex);
    var meltdown = item.fusionConsensus === 'meltdown';
    var balanced = pw >= -0.08 && pw <= 0.08;
    var name = esc(shortTeam(item.homeName));
    return { idx: i, pw: pw, hi: isNaN(hi) ? 1.0 : hi, meltdown: meltdown, balanced: balanced, name: name, item: item };
  });

  // 正路组合: 选 pwScore 最高、无熔断、HI < 1.4
  var positive = withInfo.filter(function (x) { return !x.meltdown && x.hi < 1.4; })
    .sort(function (a, b) { return b.pw - a.pw; });
  if (positive.length === 0) positive = withInfo.slice().sort(function (a, b) { return b.pw - a.pw; });

  // 博冷组合: 选 HI < 0.85 或熔断的场次
  var cold = withInfo.filter(function (x) { return x.meltdown || x.hi < 0.85; })
    .sort(function (a, b) { return a.hi - b.hi; });
  if (cold.length === 0) cold = withInfo.slice().sort(function (a, b) { return a.hi - b.hi; });

  // 双选容错: 选实力均衡的场次
  var doubleChance = withInfo.filter(function (x) { return x.balanced; })
    .sort(function (a, b) { return Math.abs(a.pw) - Math.abs(b.pw); });
  if (doubleChance.length === 0) doubleChance = withInfo.slice().sort(function (a, b) { return Math.abs(a.pw) - Math.abs(b.pw); });

  // 选前2场
  var posPick = positive.slice(0, 2);
  var coldPick = cold.slice(0, 2);
  var dcPick = doubleChance.slice(0, 2);

  var html = '<div class="pk2-section-label">🧠 组合推荐</div><div class="pk2-combo-wrap">';

  // 正路组合
  if (posPick.length >= 2) {
    var names = posPick.map(function (x) { return x.name; }).join(' + ');
    html += '<div class="pk2-combo-card combo-positive">' +
      '<span class="pk2-combo-tag">🎯 正路组合</span>' +
      '<span class="pk2-combo-teams">' + names + '（主队方向）</span>' +
      '<span class="pk2-combo-hint">综合实力最高 · 低风险</span></div>';
  }

  // 博冷组合
  if (coldPick.length >= 2) {
    var cnames = coldPick.map(function (x) { return x.name; }).join(' + ');
    html += '<div class="pk2-combo-card combo-cold">' +
      '<span class="pk2-combo-tag">⚡ 博冷组合</span>' +
      '<span class="pk2-combo-teams">' + cnames + '</span>' +
      '<span class="pk2-combo-hint">冷热指数异常 · 高赔关注</span></div>';
  }

  // 双选容错
  if (dcPick.length >= 2) {
    var dcnames = dcPick.map(function (x) { return x.name; }).join(' + ');
    html += '<div class="pk2-combo-card combo-double">' +
      '<span class="pk2-combo-tag">🔒 双选容错</span>' +
      '<span class="pk2-combo-teams">' + dcnames + '（双选方向）</span>' +
      '<span class="pk2-combo-hint">实力均衡 · 胜/平或平/负</span></div>';
  }

  html += '</div>';
  return html;
}

export function closePK() {
  var overlay = document.getElementById('pkOverlay');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

export function openPK() {}

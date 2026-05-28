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
    '<th class="pk2-th-num">大球<br>占比</th>' +
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
  html += '<div class="pk2-footer"><button class="pk2-done-btn" onclick="closePK()">完成</button></div>';

  modal.innerHTML = html;
}

// ═══ 列合计计算 ═══
function calcColSums(list) {
  var sums = { bigBall: 0, attDef: 0, power: 0, cross: 0, armor: 0 };
  list.forEach(function (item) {
    sums.bigBall  += Math.abs(parseFloat(item.totalGoalsExpect) || 0);
    sums.attDef   += Math.abs(item.attackAdvantageValue + item.defenseAdvantageValue - 100) / 20;
    sums.power    += Math.abs(item.totalAdvantageValue - 50) / 10;
    sums.cross    += Math.abs((item.crossWin || 0) - (item.crossLose || 0));
    sums.armor    += Math.abs((item.attackAdvantageValue + item.defenseAdvantageValue) / 10);
  });
  return sums;
}

function calcRowValues(item) {
  var g = parseFloat(item.totalGoalsExpect) || 0;
  var a = (item.attackAdvantageValue + item.defenseAdvantageValue - 100) / 20;
  var p = (item.totalAdvantageValue - 50) / 10;
  var c = ((item.crossWin || 0) - (item.crossLose || 0));
  var r = (item.attackAdvantageValue + item.defenseAdvantageValue) / 10;
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

// ═══ PK结果卡片 ═══
function renderPKCard(a, b) {
  var dims = [
    { label: '进球数PK', keyA: 'totalGoalsExpect', keyB: 'totalGoalsExpect', fmt: 'num' },
    { label: '大小球PK', keyA: 'totalGoalsValue', keyB: 'totalGoalsValue', fmt: 'num' },
    { label: '攻防进球占比PK', keyA: 'attackAdvantageValue', keyB: 'attackAdvantageValue', fmt: 'val' },
    { label: '实力进球占比PK', keyA: 'totalAdvantageValue', keyB: 'totalAdvantageValue', fmt: 'val' },
    { label: '交锋进球占比PK', keyA: 'crossWin', keyB: 'crossWin', fmt: 'cross' },
    { label: '破甲和占比PK', keyA: 'attackAdvantageValue', keyB: 'attackAdvantageValue', fmt: 'armor' }
  ];

  var aWins = 0, bWins = 0;

  var rows = dims.map(function (dim) {
    var va = getDimVal(dim.keyA, a, dim.fmt);
    var vb = getDimVal(dim.keyB, b, dim.fmt);
    var result;
    if (va > vb) { result = 'a'; aWins++; }
    else if (vb > va) { result = 'b'; bWins++; }
    else { result = 'draw'; }

    return '<div class="pk2-result-row">' +
      '<span class="pk2-result-label">' + dim.label + '</span>' +
      '<span class="pk2-result-values">' +
        '<span class="' + (result === 'a' ? 'pk2-win' : '') + '">' + esc(shortTeam(a.homeName)) + ' (' + formatVal(va, dim.fmt) + ')</span>' +
        ' vs ' +
        '<span class="' + (result === 'b' ? 'pk2-win' : '') + '">' + esc(shortTeam(b.homeName)) + ' (' + formatVal(vb, dim.fmt) + ')</span>' +
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

function getDimVal(key, item, fmt) {
  if (fmt === 'cross') return (item.crossWin || 0) - (item.crossLose || 0);
  if (fmt === 'armor') return item.attackAdvantageValue + item.defenseAdvantageValue;
  if (fmt === 'val') return Number(item[key]) || 0;
  return parseFloat(String(item[key] || '0'));
}

function formatVal(val, fmt) {
  if (fmt === 'num') return Number(val).toFixed(1);
  if (fmt === 'cross') return (val >= 0 ? '胜+' : '负') + Math.abs(val).toFixed(0);
  if (fmt === 'armor') return Number(val).toFixed(0) + '点';
  return Number(val).toFixed(0);
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
    '<th class="pk2-th-num">净胜球<br>占比</th>' +
    '<th class="pk2-th-num">胜平负<br>占比</th>' +
    '<th class="pk2-th-num">综合实力<br>占比</th>' +
    '<th class="pk2-th-num">攻守实力<br>占比</th>' +
    '</tr></thead><tbody>';

  var colSums = { gd: 0, cross: 0, power: 0, ad: 0 };
  list.forEach(function (item) {
    colSums.gd    += Math.abs(parseFloat(String(item.goalDiff).split('/')[0]) || 0);
    colSums.cross += Math.abs((item.crossWin || 0) - (item.crossLose || 0));
    colSums.power += Math.abs((item.totalAdvantageValue || 0) - 50);
    colSums.ad    += Math.abs((item.attackAdvantageValue || 0) + (item.defenseAdvantageValue || 0) - 100);
  });

  list.forEach(function (item, i) {
    var gd    = parseFloat(String(item.goalDiff).split('/')[0]) || 0;
    var cross = (item.crossWin || 0) - (item.crossLose || 0);
    var power = (item.totalAdvantageValue || 0) - 50;
    var ad    = (item.attackAdvantageValue || 0) + (item.defenseAdvantageValue || 0) - 100;
    html += '<tr class="pk2-row">' +
      '<td class="pk2-td-name"><div class="pk2-match-line">' + esc(item.homeName) + '</div>' +
        '<div class="pk2-match-vs">vs</div>' +
        '<div class="pk2-match-line">' + esc(item.visitName) + '</div></td>' +
      '<td class="pk2-td-num">' + (item.rank || '-') + '</td>' +
      tdPctBar(gd, colSums.gd) +
      tdPctBar(cross, colSums.cross) +
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
    { label: '总排序PK',    va: a.rank || 99, vb: b.rank || 99, lowerWins: true },
    { label: '净胜球PK',    va: parseFloat(String(a.goalDiff).split('/')[0]) || 0, vb: parseFloat(String(b.goalDiff).split('/')[0]) || 0 },
    { label: '胜平负PK',    va: (a.crossWin || 0) - (a.crossLose || 0), vb: (b.crossWin || 0) - (b.crossLose || 0) },
    { label: '综合实力PK',  va: a.totalAdvantageValue || 0, vb: b.totalAdvantageValue || 0 },
    { label: '攻守实力PK',  va: (a.attackAdvantageValue || 0) + (a.defenseAdvantageValue || 0), vb: (b.attackAdvantageValue || 0) + (b.defenseAdvantageValue || 0) }
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
  html += '<div class="pk2-footer"><button class="pk2-done-btn" onclick="closePK()">完成</button></div>';
  modal.innerHTML = html;
}

export function closePK() {
  var overlay = document.getElementById('pkOverlay');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

export function openPK() {}

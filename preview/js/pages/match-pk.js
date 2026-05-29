import { api } from '../api.js';

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function shortTeam(name) { if (!name) return '--'; return name.length > 3 ? name.slice(0, 3) + '..' : name; }

// ═══════════════════════════════════════════
//  V5.0 三维度融合PK — 实战投注决策辅助
// ═══════════════════════════════════════════

/** 打开多场PK弹窗（不再区分 tab，融合三维度） */
export function openPKMulti(pickedList) {
  var overlay = document.getElementById('pkOverlay');
  if (!overlay || pickedList.length < 2) return;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  var modal = document.getElementById('pkModal');
  if (!modal) return;
  modal.innerHTML = '<div style="text-align:center;padding:80px 20px;color:var(--cyan)"><div style="font-size:36px;margin-bottom:12px">⚔️</div><div style="font-size:14px;font-weight:600">三维度融合分析中...</div></div>';

  // 为每场补全 GS 数据（带 5 秒超时保护）
  var promises = pickedList.map(function (item) {
    if (item.hasGS && item.pwScore !== undefined) return Promise.resolve(item);
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
    if (!fullList) fullList = pickedList;
    renderFusionPK(modal, fullList);
  });
}

function buildGSFields(gs) {
  gs = gs || {};
  // attDefGoal 已在后端限制 ≤6.5，此处兜底再限一次
  var attDefGoalVal = parseFloat(gs.attDefGoal) || 0;
  if (attDefGoalVal > 7.0) attDefGoalVal = 0; // 异常值丢弃

  // totalSum: 进球维度综合指标（V25修正：只累加合理范围内的进球相关值）
  var totalSumVal = function () {
    var bbr = Math.min(100, Math.max(0, Math.abs(gs.bigBallRatio || 0)));  // 0-100
    var adg = Math.min(6.5, Math.abs(attDefGoalVal));                        // 0-6.5
    var h2h = Math.min(5.0, Math.abs(gs.h2hGoalAvg || 0));                  // 0-5
    var ba  = Math.min(8.0, Math.abs(gs.breakArmorSum || 0));               // 0-8
    return parseFloat((bbr + adg * 10 + h2h * 8 + ba * 3).toFixed(1));
  }();

  // 熔断后融合总进球（作为备用指标）
  var fusionTotal = 0;
  var fHome = parseFloat(gs.fusionFinalHome);
  var fAway = parseFloat(gs.fusionFinalAway);
  if (!isNaN(fHome) && !isNaN(fAway)) {
    fusionTotal = parseFloat((fHome + fAway).toFixed(2));
  }

  return {
    totalAdvantage: gs.totalAdvantage || '-',
    totalAdvantageValue: gs.totalAdvantageValue || 0,
    attackPattern: gs.attackPattern || '',
    xgHome: gs.xgHome != null ? gs.xgHome : 0,
    xgAway: gs.xgAway != null ? gs.xgAway : 0,
    adWeightedComposite: gs.adWeightedComposite != null ? gs.adWeightedComposite : 0,
    totalStrength: gs.totalStrength != null ? gs.totalStrength : 0,
    crossSpfWin: gs.crossSpfWin || '-',
    crossSpfDraw: gs.crossSpfDraw || '-',
    crossSpfLose: gs.crossSpfLose || '-',
    crossHcpWin: gs.crossHcpWin || '-',
    crossHcpDraw: gs.crossHcpDraw || '-',
    crossHcpLose: gs.crossHcpLose || '-',
    fusionConsensus: gs.fusionConsensus || '',
    fusionFinalHome: fHome,
    fusionFinalAway: fAway,
    fusionFinalTotal: fusionTotal,
    bigBallRatio: gs.bigBallRatio != null ? gs.bigBallRatio : 0,
    attDefGoal: attDefGoalVal,
    headToHeadGoal: gs.h2hGoalAvg != null ? gs.h2hGoalAvg : 0,
    breakArmor: gs.breakArmorSum != null ? gs.breakArmorSum : 0,
    totalSum: totalSumVal,
    hasGS: !!(gs.attackPattern),
    gdScore: gs.gdQ != null ? gs.gdQ : 0,
    crossValue: (gs.hWins != null && gs.aLosses != null) ? (gs.hWins + gs.aLosses - gs.hLosses - gs.aWins) : 0,
    pwScore: gs.totalStrength != null ? parseFloat(gs.totalStrength.toFixed(4)) : 0,
    adCombined: gs.adWeightedComposite != null ? parseFloat(gs.adWeightedComposite.toFixed(4)) : 0
  };
}

// ═══════════════════════════════════════════
//  评分算法
// ═══════════════════════════════════════════

/** 归一化值到 [0,100] 区间 */
function normalize(val, min, max) {
  if (max - min < 0.0001) return 50;
  return parseFloat((((val - min) / (max - min)) * 100).toFixed(1));
}

/** 计算实力评分 0-100（按指定权重） */
function calcPowerScores(list) {
  // 净胜球量化×30% + 胜平负交叉×20% + 综合实力×30% + 攻守实力×20%
  var gds = list.map(function (x) { return parseFloat(x.gdScore) || 0; });
  var cvs = list.map(function (x) { return parseFloat(x.crossValue) || 0; });
  var pws = list.map(function (x) { return parseFloat(x.pwScore) || 0; });
  var ads = list.map(function (x) { return parseFloat(x.adCombined) || 0; });

  var gdMin = Math.min.apply(null, gds), gdMax = Math.max.apply(null, gds);
  var cvMin = Math.min.apply(null, cvs), cvMax = Math.max.apply(null, cvs);
  var pwMin = Math.min.apply(null, pws), pwMax = Math.max.apply(null, pws);
  var adMin = Math.min.apply(null, ads), adMax = Math.max.apply(null, ads);

  return list.map(function (item, i) {
    var sgd = normalize(gds[i], gdMin, gdMax);
    var scv = normalize(cvs[i], cvMin, cvMax);
    var spw = normalize(pws[i], pwMin, pwMax);
    var sad = normalize(ads[i], adMin, adMax);
    return parseFloat((sgd * 0.3 + scv * 0.2 + spw * 0.3 + sad * 0.2).toFixed(1));
  });
}

/** 计算进球评分 0-100（按指定权重） */
function calcGoalScores(list) {
  // 综合大球比例×30% + 攻防进球×30% + 交锋进球×20% + 破甲和×20%
  var bbrs = list.map(function (x) { return parseFloat(x.bigBallRatio) || (x.bigBallRatio === '-' ? 0 : 50); });
  var atts = list.map(function (x) { return parseFloat(x.attDefGoal) || (x.attDefGoal === '-' ? 0 : 0); });
  var h2hs = list.map(function (x) { return parseFloat(x.headToHeadGoal) || (x.headToHeadGoal === '-' ? 0 : 2.5); });
  var bkas = list.map(function (x) { return parseFloat(x.breakArmor) || (x.breakArmor === '-' ? 0 : 0); });

  var bbMin = Math.min.apply(null, bbrs), bbMax = Math.max.apply(null, bbrs);
  var atMin = Math.min.apply(null, atts), atMax = Math.max.apply(null, atts);
  var h2Min = Math.min.apply(null, h2hs), h2Max = Math.max.apply(null, h2hs);
  var bkMin = Math.min.apply(null, bkas), bkMax = Math.max.apply(null, bkas);

  return list.map(function (item, i) {
    var sbb = normalize(bbrs[i], bbMin, bbMax);
    var sat = normalize(atts[i], atMin, atMax);
    var sh2 = normalize(h2hs[i], h2Min, h2Max);
    var sbk = normalize(bkas[i], bkMin, bkMax);
    return parseFloat((sbb * 0.3 + sat * 0.3 + sh2 * 0.2 + sbk * 0.2).toFixed(1));
  });
}

/** 计算热度评分 0-100（1.0 最优） */
function calcHeatScores(list) {
  return list.map(function (item) {
    var hi = parseFloat(item.heatIndex);
    if (isNaN(hi) || hi <= 0) return 50;
    var score = 100 - 100 * Math.abs(1.0 - hi);
    return parseFloat(Math.max(0, Math.min(100, score)).toFixed(1));
  });
}

/** 计算健康评分 0-100 */
function calcHealthScores(list) {
  return list.map(function (item) {
    var c = item.fusionConsensus;
    if (c === 'strong') return 100;
    if (c === 'weak') return 70;
    if (c === 'meltdown') return 0;
    return 50;
  });
}

/** 计算综合信心分 */
function calcCompositeScore(pwr, goal, heat, health) {
  return parseFloat((0.45 * pwr + 0.25 * goal + 0.15 * heat + 0.15 * health).toFixed(1));
}

/** 为 pickedList 每个元素附加评分对象 */
function computeAllScores(list) {
  var powerScores = calcPowerScores(list);
  var goalScores = calcGoalScores(list);
  var heatScores = calcHeatScores(list);
  var healthScores = calcHealthScores(list);

  return list.map(function (item, i) {
    var pwr = powerScores[i];
    var goal = goalScores[i];
    var heat = heatScores[i];
    var health = healthScores[i];
    var comp = calcCompositeScore(pwr, goal, heat, health);
    return {
      item: item,
      powerScore: pwr,
      goalScore: goal,
      heatScore: heat,
      healthScore: health,
      compositeScore: comp,
      // 星级: 0-5
      stars: Math.round(comp / 20)
    };
  });
}

// ═══════════════════════════════════════════
//  方向推荐
// ═══════════════════════════════════════════

function getDirectionAdvice(scored) {
  var item = scored.item;
  var pw = parseFloat(item.pwScore) || 0;
  var hi = parseFloat(item.heatIndex);
  var meltdown = item.fusionConsensus === 'meltdown';
  var isNaNHi = isNaN(hi) || hi <= 0;

  if (meltdown) return { dir: '观望/避开', stars: 1, cls: 'dir-avoid', desc: '模型熔断' };

  if (pw >= 0.25 && !isNaNHi && hi < 1.40) return { dir: '主胜', stars: 5, cls: 'dir-home', desc: '绝对优势' };
  if (pw >= 0.08 && !meltdown) {
    if (!isNaNHi && hi >= 1.40) return { dir: '主胜（防冷）', stars: 3, cls: 'dir-home-caut', desc: '过热预警' };
    return { dir: '主胜', stars: 4, cls: 'dir-home', desc: '明显优势' };
  }
  if (pw > -0.08 && pw < 0.08) {
    if (pw > 0) return { dir: '胜/平双选', stars: 2, cls: 'dir-draw', desc: '实力均衡偏主' };
    return { dir: '平/负双选', stars: 2, cls: 'dir-draw', desc: '实力均衡偏客' };
  }
  if (pw <= -0.08 && !meltdown) {
    if (pw <= -0.25 && !isNaNHi && hi < 0.85) return { dir: '客胜（博冷）', stars: 4, cls: 'dir-away-cold', desc: '高赔机会' };
    return { dir: '客胜', stars: 3, cls: 'dir-away', desc: '客队优势' };
  }
  return { dir: '数据不足', stars: 1, cls: 'dir-avoid', desc: '' };
}

function getGoalDirection(scored) {
  var item = scored.item;
  var bbr = parseFloat(item.bigBallRatio) || 50;

  // 总进球期望（V25修正：attDefGoal 已由后端保障 ≤6.5，作为主指标）
  // 备选：headToHeadGoal 作为交锋进球参考，fusionFinalHome + fusionFinalAway 作为熔断后修正
  var totalGoals = parseFloat(item.attDefGoal);
  if (isNaN(totalGoals) || totalGoals <= 0) {
    totalGoals = parseFloat(item.headToHeadGoal) || 0;
  }

  // 熔断后融合值作为兜底（更保守的估计）
  var fusionTotal = 0;
  if (!isNaN(parseFloat(item.fusionFinalHome)) && !isNaN(parseFloat(item.fusionFinalAway))) {
    fusionTotal = parseFloat(item.fusionFinalHome) + parseFloat(item.fusionFinalAway);
  }

  // 如果 attDefGoal 异常（>6），切到融合值
  if (totalGoals > 6.0 && fusionTotal > 0) {
    totalGoals = fusionTotal;
  }

  // 默认进球参考值（数据库平均值）
  if (totalGoals <= 0) totalGoals = 2.5;

  var pattern = item.attackPattern;

  if (bbr >= 70 && totalGoals >= 3.0) return { dir: '大球', stars: 4, cls: 'dir-big', desc: '进球预期高' };
  if (bbr >= 65 && totalGoals >= 2.5) return { dir: '大球', stars: 3, cls: 'dir-big', desc: '倾向大球' };
  if (bbr <= 35 && totalGoals < 2.0) return { dir: '小球', stars: 4, cls: 'dir-small', desc: '进球预期极低' };
  if (bbr <= 50 && totalGoals < 2.5) return { dir: '小球', stars: 3, cls: 'dir-small', desc: '倾向小球' };
  if (pattern === '对攻为主') return { dir: '大球', stars: 3, cls: 'dir-big', desc: '对攻格局' };
  if (pattern === '防守为主') return { dir: '小球', stars: 3, cls: 'dir-small', desc: '防守格局' };
  if (totalGoals > 3.0) return { dir: '略偏大球', stars: 2, cls: 'dir-big', desc: '预期偏高' };
  if (totalGoals < 2.0) return { dir: '略偏小球', stars: 2, cls: 'dir-small', desc: '预期偏低' };
  if (bbr > 50) return { dir: '略偏大球', stars: 2, cls: 'dir-big', desc: '' };
  return { dir: '略偏小球', stars: 2, cls: 'dir-small', desc: '' };
}

function starStr(n) { return '⭐'.repeat(Math.max(1, Math.min(5, n))); }

// ═══════════════════════════════════════════
//  主渲染函数
// ═══════════════════════════════════════════

function renderFusionPK(modal, list) {
  var n = list.length;
  var scoredList = computeAllScores(list);
  // 按综合分降序排列
  var ranked = scoredList.slice().sort(function (a, b) { return b.compositeScore - a.compositeScore; });

  var html = '';
  html += '<div class="pk3-header">' +
    '<span class="pk3-title">三维度融合 PK 分析（' + n + '场）</span>' +
    '<span class="pk3-close" onclick="closePK()">✕</span>' +
    '</div>';

  // ── 模块一：场次综合评分卡 ──
  html += '<div class="pk3-section-label">📊 场次综合评分卡</div>';
  html += '<div class="pk3-score-cards">';
  ranked.forEach(function (scored, idx) {
    html += renderScoreCard(scored, idx + 1);
  });
  html += '</div>';

  // ── 模块二：横向对比总览表 ──
  html += '<div class="pk3-section-label">📈 横向对比总览（按综合信心分排序）</div>';
  html += renderComparisonTable(ranked);

  // ── 模块三：投注建议 ──
  html += '<div class="pk3-section-label">🔮 每场投注建议</div>';
  html += renderBettingAdviceList(ranked);

  // ── 模块四：串关推荐 ──
  html += renderComboRecommendations(ranked);

  // ── 模块五：风险预警 ──
  html += renderRiskPanel(ranked);

  // ── 综合评估 ──
  html += renderFusionSummary(ranked);

  // ── 底部按钮 ──
  html += '<div class="pk3-footer"><button class="pk3-done-btn" onclick="closePK()">关闭</button></div>';

  modal.innerHTML = html;
}

// ═══════════════════════════════════════════
//  模块一：场次综合评分卡
// ═══════════════════════════════════════════

function renderScoreCard(scored, rank) {
  var item = scored.item;
  var pwr = scored.powerScore;
  var goal = scored.goalScore;
  var heat = scored.heatScore;
  var comp = scored.compositeScore;

  var pwrBar = barHtml(pwr, pwr >= 50 ? 'bar-cyan' : 'bar-red');
  var goalBar = barHtml(goal, goal >= 50 ? 'bar-green' : 'bar-red');
  var heatBar = barHtml(heat, heat >= 60 ? 'bar-blue' : 'bar-amber');

  // 标签
  var pw = parseFloat(item.pwScore) || 0;
  var tags = [];
  if (pw >= 0.25) tags.push('<span class="pk3-tag-t">🔥绝对优势</span>');
  if (item.fusionConsensus === 'meltdown') tags.push('<span class="pk3-tag-t tag-red">⚠️模型打架</span>');
  if (pw >= -0.08 && pw <= 0.08) tags.push('<span class="pk3-tag-t tag-green">🎯实力均衡</span>');
  var hi = parseFloat(item.heatIndex);
  if (!isNaN(hi) && hi >= 1.40) tags.push('<span class="pk3-tag-t tag-amber">💰过热风险</span>');
  if (!isNaN(hi) && hi > 0 && hi <= 0.85) tags.push('<span class="pk3-tag-t tag-blue">🧊冷门潜质</span>');
  if (item.attackPattern === '对攻为主') tags.push('<span class="pk3-tag-t tag-orange">⚡对攻大战</span>');
  if (item.attackPattern === '防守为主') tags.push('<span class="pk3-tag-t tag-indigo">🛡️防守大战</span>');

  var dirAdvice = getDirectionAdvice(scored);
  var goalAdvice = getGoalDirection(scored);

  // 预期进球显示：优先攻防进球(attDefGoal)，其次交锋进球(headToHeadGoal)，兜底熔断融合值
  var totalGoalsExpect = parseFloat(item.attDefGoal);
  if (isNaN(totalGoalsExpect) || totalGoalsExpect <= 0) {
    totalGoalsExpect = parseFloat(item.headToHeadGoal) || 0;
  }
  // 异常值保护（>6.5球视为数据异常，使用熔断融合值替代）
  if (totalGoalsExpect > 6.5) {
    var ft = parseFloat(item.fusionFinalTotal) || 0;
    if (ft > 0) totalGoalsExpect = ft;
    else totalGoalsExpect = parseFloat(item.headToHeadGoal) || 2.5;
  }
  // 兜底默认值
  if (totalGoalsExpect <= 0) totalGoalsExpect = 2.5;

  var goalLabel = '（预期 ' + totalGoalsExpect.toFixed(1) + '球）';

  var fusionBadge = '';
  var consensus = item.fusionConsensus;
  if (consensus === 'strong') fusionBadge = '<span class="pk3-fusion-tag fusion-ok">✅强一致</span>';
  else if (consensus === 'weak') fusionBadge = '<span class="pk3-fusion-tag fusion-warn">⚠️弱一致</span>';
  else if (consensus === 'meltdown') fusionBadge = '<span class="pk3-fusion-tag fusion-bad">🔴熔断</span>';

  var rankBadge = rank <= 3 ? '<span class="pk3-rank-badge r' + rank + '">🥇</span>' : '';

  return '<div class="pk3-score-card">' +
    '<div class="pk3-sc-head">' +
      rankBadge +
      '<span class="pk3-sc-match">' + esc(shortTeam(item.homeName)) + ' vs ' + esc(shortTeam(item.visitName)) + '</span>' +
      '<span class="pk3-sc-comp">' + comp + '<small>分</small></span>' +
    '</div>' +
    '<div class="pk3-sc-body">' +
      '<div class="pk3-sc-row"><span class="pk3-sc-label">实力</span><span class="pk3-sc-bar">' + pwrBar + '</span><span class="pk3-sc-val">' + pwr + '</span></div>' +
      '<div class="pk3-sc-row"><span class="pk3-sc-label">进球</span><span class="pk3-sc-bar">' + goalBar + '</span><span class="pk3-sc-val">' + goal + '</span></div>' +
      '<div class="pk3-sc-row"><span class="pk3-sc-label">热度</span><span class="pk3-sc-bar">' + heatBar + '</span><span class="pk3-sc-val">' + heat + '</span></div>' +
    '</div>' +
    '<div class="pk3-sc-foot">' +
      '<div class="pk3-sc-advice">' +
        '<span class="pk3-sc-dir ' + dirAdvice.cls + '">→ ' + dirAdvice.dir + ' ' + starStr(dirAdvice.stars) + '</span>' +
        '<span class="pk3-sc-goal ' + goalAdvice.cls + '">🎯 ' + goalAdvice.dir + ' ' + goalLabel + '</span>' +
      '</div>' +
      (tags.length ? '<div class="pk3-sc-tags">' + tags.join('') + '</div>' : '') +
      (fusionBadge ? '<div class="pk3-sc-fusion">' + fusionBadge + '</div>' : '') +
    '</div>' +
    '</div>';
}

function barHtml(score, colorCls) {
  return '<div class="pk3-bar-bg"><div class="pk3-bar-fill ' + colorCls + '" style="width:' + score + '%"></div></div>';
}

// ═══════════════════════════════════════════
//  模块二：横向对比总览表
// ═══════════════════════════════════════════

function renderComparisonTable(ranked) {
  var html = '<div class="pk3-table-wrap"><table class="pk3-compare-table"><thead><tr>' +
    '<th>排名</th><th>对阵</th><th>实力</th><th>进球</th><th>热度</th><th>综合</th><th>方向推荐</th><th>进球预期</th>' +
    '</tr></thead><tbody>';

  ranked.forEach(function (scored, i) {
    var item = scored.item;
    var dirAdvice = getDirectionAdvice(scored);
    var goalAdvice = getGoalDirection(scored);
    // 预期进球（与评分卡保持一致）
    var totalGoals = parseFloat(item.attDefGoal);
    if (isNaN(totalGoals) || totalGoals <= 0) totalGoals = parseFloat(item.headToHeadGoal) || 0;
    if (totalGoals > 6.5 && parseFloat(item.fusionFinalTotal) > 0) totalGoals = parseFloat(item.fusionFinalTotal);
    if (totalGoals <= 0) totalGoals = 2.5;

    var rankEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    var rowCls = scored.compositeScore >= 65 ? 'row-high' : scored.compositeScore >= 45 ? 'row-mid' : 'row-low';
    var heatCls = scored.heatScore >= 70 ? 'val-good' : scored.heatScore >= 50 ? 'val-warn' : 'val-bad';

    html += '<tr class="' + rowCls + '">' +
      '<td class="col-rank">' + rankEmoji + '</td>' +
      '<td class="col-match"><span class="cmp-home">' + esc(shortTeam(item.homeName)) + '</span><span class="cmp-vs">vs</span><span class="cmp-away">' + esc(shortTeam(item.visitName)) + '</span></td>' +
      '<td class="col-num ' + (scored.powerScore >= 50 ? 'val-good' : 'val-bad') + '">' + scored.powerScore + '</td>' +
      '<td class="col-num ' + (scored.goalScore >= 50 ? 'val-good' : 'val-bad') + '">' + scored.goalScore + '</td>' +
      '<td class="col-num ' + heatCls + '">' + scored.heatScore + '</td>' +
      '<td class="col-comp"><b>' + scored.compositeScore + '</b><span class="star-row">' + starStr(scored.stars) + '</span></td>' +
      '<td class="col-dir ' + dirAdvice.cls + '">' + dirAdvice.dir + '</td>' +
      '<td class="col-goal ' + goalAdvice.cls + '">' + goalAdvice.dir + (totalGoals > 0 ? ' ' + totalGoals.toFixed(1) + '球' : '') + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

// ═══════════════════════════════════════════
//  模块三：投注建议列表
// ═══════════════════════════════════════════

function renderBettingAdviceList(ranked) {
  var html = '<div class="pk3-advice-list">';
  ranked.forEach(function (scored, i) {
    var item = scored.item;
    var dirAdvice = getDirectionAdvice(scored);
    var goalAdvice = getGoalDirection(scored);
    var pw = parseFloat(item.pwScore) || 0;
    var hi = parseFloat(item.heatIndex);
    var heatLabel = isNaN(hi) ? '-' : hi.toFixed(2);
    var meltdown = item.fusionConsensus === 'meltdown';

    html += '<div class="pk3-advice-card ' + dirAdvice.cls + '">' +
      '<div class="pk3-adv-head">' +
        '<span class="pk3-adv-match">' + esc(shortTeam(item.homeName)) + ' vs ' + esc(shortTeam(item.visitName)) + '</span>' +
        '<span class="pk3-adv-comp">综合 ' + scored.compositeScore + '分 ' + starStr(scored.stars) + '</span>' +
      '</div>' +
      '<div class="pk3-adv-body">' +
        '<div class="pk3-adv-row">' +
          '<span class="pk3-adv-label">方向</span>' +
          '<span class="pk3-adv-val ' + dirAdvice.cls + '">' + dirAdvice.dir + ' <small>' + starStr(dirAdvice.stars) + '</small></span>' +
          '<span class="pk3-adv-desc">' + dirAdvice.desc + '</span>' +
        '</div>' +
        '<div class="pk3-adv-row">' +
          '<span class="pk3-adv-label">进球</span>' +
          '<span class="pk3-adv-val ' + goalAdvice.cls + '">' + goalAdvice.dir + ' <small>' + starStr(goalAdvice.stars) + '</small></span>' +
          '<span class="pk3-adv-desc">' + goalAdvice.desc + '</span>' +
        '</div>' +
        (meltdown ? '<div class="pk3-adv-row pk3-adv-warn">⚠️ 模型熔断 — 建议避开或极小注博冷</div>' : '') +
        (!isNaN(hi) && hi >= 1.40 ? '<div class="pk3-adv-row pk3-adv-warn">⚠️ 热度指数 ' + heatLabel + ' — 过热预警，降低信心1级</div>' : '') +
        (!isNaN(hi) && hi > 0 && hi <= 0.85 ? '<div class="pk3-adv-row pk3-adv-info">💡 热度指数 ' + heatLabel + ' — 市场冷藏，可能是高赔逆向机会</div>' : '') +
      '</div>' +
    '</div>';
  });
  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════
//  模块四：串关推荐
// ═══════════════════════════════════════════

function renderComboRecommendations(ranked) {
  var n = ranked.length;
  if (n < 2) return '';

  // 为每场准备辅助信息
  var withInfo = ranked.map(function (scored) {
    var item = scored.item;
    var pw = parseFloat(item.pwScore) || 0;
    var hi = parseFloat(item.heatIndex);
    var meltdown = item.fusionConsensus === 'meltdown';
    var name = esc(shortTeam(item.homeName));
    var dirAdvice = getDirectionAdvice(scored);
    return {
      scored: scored, pw: pw, hi: isNaN(hi) ? 1.0 : hi,
      meltdown: meltdown, name: name,
      comp: scored.compositeScore, dir: dirAdvice.dir,
      balanced: pw >= -0.08 && pw <= 0.08
    };
  });

  // 正路：综合分 >= 55，无熔断，HI < 1.4
  var positive = withInfo.filter(function (x) { return !x.meltdown && x.hi < 1.40 && x.comp >= 55; })
    .sort(function (a, b) { return b.comp - a.comp; });
  if (positive.length < 2) positive = withInfo.filter(function (x) { return !x.meltdown; })
    .sort(function (a, b) { return b.comp - a.comp; });

  // 博冷：HI < 0.85 或熔断
  var cold = withInfo.filter(function (x) { return x.meltdown || (x.hi > 0 && x.hi < 0.85); })
    .sort(function (a, b) { return a.hi - b.hi; });
  if (cold.length < 2) cold = withInfo.filter(function (x) { return x.hi < 1.0; })
    .sort(function (a, b) { return a.hi - b.hi; });

  // 稳健/双选容错
  var steady = withInfo.filter(function (x) { return x.balanced; })
    .sort(function (a, b) { return Math.abs(a.pw) - Math.abs(b.pw); });

  var posPick = positive.slice(0, Math.min(2, positive.length));
  var coldPick = cold.slice(0, Math.min(2, cold.length));
  var steadyPick = steady.slice(0, Math.min(2, steady.length));

  // 去除和正路重复的稳健
  if (steadyPick.length >= 2 && posPick.length >= 2) {
    steadyPick = steadyPick.filter(function (x) {
      return posPick.every(function (p) { return p.name !== x.name; });
    });
    if (steadyPick.length < 2) steadyPick = [];
  }

  var hasAny = posPick.length >= 2 || coldPick.length >= 2 || steadyPick.length >= 2;
  if (!hasAny) return '';

  var html = '<div class="pk3-section-label">🤝 串关推荐</div><div class="pk3-combo-wrap">';

  if (posPick.length >= 2) {
    html += '<div class="pk3-combo-card combo-positive">' +
      '<span class="pk3-combo-tag">🎯 正路 2串1</span>' +
      '<span class="pk3-combo-teams">' + posPick.map(function (x) { return x.name; }).join(' + ') + '</span>' +
      '<span class="pk3-combo-hint">综合信心最高 · 低风险</span></div>';
  }

  if (coldPick.length >= 2) {
    html += '<div class="pk3-combo-card combo-cold">' +
      '<span class="pk3-combo-tag">⚡ 博冷 2串1</span>' +
      '<span class="pk3-combo-teams">' + coldPick.map(function (x) { return x.name; }).join(' + ') + '</span>' +
      '<span class="pk3-combo-hint">热度异常 · 高赔关注</span></div>';
  }

  if (steadyPick.length >= 2) {
    html += '<div class="pk3-combo-card combo-steady">' +
      '<span class="pk3-combo-tag">🛡️ 稳健 2串1</span>' +
      '<span class="pk3-combo-teams">' + steadyPick.map(function (x) { return x.name; }).join(' + ') + '</span>' +
      '<span class="pk3-combo-hint">实力均衡 · 双选容错</span></div>';
  }

  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════
//  模块五：风险预警面板
// ═══════════════════════════════════════════

function renderRiskPanel(ranked) {
  var risks = [];
  ranked.forEach(function (scored) {
    var item = scored.item;
    var name = esc(shortTeam(item.homeName));
    var hi = parseFloat(item.heatIndex);

    if (item.fusionConsensus === 'meltdown') {
      risks.push({ level: 'danger', text: '🔴 ' + name + ': 模型熔断 — 强烈建议避开' });
    }
    if (!isNaN(hi) && hi >= 1.40) {
      risks.push({ level: 'warn', text: '🟡 ' + name + ': 过热预警 (HI=' + hi.toFixed(2) + ') — 降低信心1级' });
    }
    if (!isNaN(hi) && hi > 0 && hi <= 0.85) {
      risks.push({ level: 'info', text: '🔵 ' + name + ': 市场冷藏 (HI=' + hi.toFixed(2) + ') — 逆向思维机会' });
    }
    if (scored.healthScore <= 50) {
      risks.push({ level: 'warn', text: '🟡 ' + name + ': 模型弱一致 — 参考价值打折' });
    }
  });

  // 整体健康度
  var meltdownCount = ranked.filter(function (s) { return s.item.fusionConsensus === 'meltdown'; }).length;
  var weakCount = ranked.filter(function (s) { return s.item.fusionConsensus === 'weak'; }).length;
  var healthPct = ranked.length > 0 ? Math.round((1 - (meltdownCount + weakCount * 0.5) / ranked.length) * 100) : 100;

  var html = '<div class="pk3-section-label">⚠️ 风险预警</div>';
  html += '<div class="pk3-risk-panel">';

  if (risks.length > 0) {
    html += '<div class="pk3-risk-list">';
    risks.forEach(function (r) {
      html += '<div class="pk3-risk-item ' + r.level + '">' + r.text + '</div>';
    });
    html += '</div>';
  } else {
    html += '<div class="pk3-risk-clear">✅ 所有场次均无异常风险</div>';
  }

  html += '<div class="pk3-risk-health">' +
    '<span>整体健康度：</span>' +
    '<span class="' + (healthPct >= 80 ? 'val-good' : healthPct >= 50 ? 'val-warn' : 'val-bad') + '">' + healthPct + '%</span>' +
    (meltdownCount > 0 ? ' <small style="color:#ef5350">(' + meltdownCount + '场熔断)</small>' : '') +
    '</div>';

  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════
//  综合评估面板
// ═══════════════════════════════════════════

function renderFusionSummary(ranked) {
  var n = ranked.length;
  if (n === 0) return '';

  var avgComp = parseFloat((ranked.reduce(function (s, x) { return s + x.compositeScore; }, 0) / n).toFixed(1));
  var avgPwr = parseFloat((ranked.reduce(function (s, x) { return s + x.powerScore; }, 0) / n).toFixed(1));

  var homeAdvCount = ranked.filter(function (s) {
    var pw = parseFloat(s.item.pwScore) || 0; return pw > 0;
  }).length;
  var homeRatio = Math.round(homeAdvCount / n * 100);

  var meltdownCount = ranked.filter(function (s) { return s.item.fusionConsensus === 'meltdown'; }).length;
  var healthScore = Math.round((1 - meltdownCount / n) * 100);

  var heatDevCount = ranked.filter(function (s) {
    var hi = parseFloat(s.item.heatIndex); return !isNaN(hi) && (hi > 1.2 || (hi > 0 && hi < 0.8));
  }).length;

  return '<div class="pk3-section-label">📊 综合评估</div>' +
    '<div class="pk3-summary-panel">' +
      '<div class="pk3-summary-row">' +
        '<span class="pk3-summary-label">平均综合信心分</span>' +
        '<span class="pk3-summary-value ' + (avgComp >= 60 ? 'val-good' : avgComp >= 40 ? 'val-warn' : 'val-bad') + '">' + avgComp + '分 ' + starStr(Math.round(avgComp / 20)) + '</span>' +
      '</div>' +
      '<div class="pk3-summary-row">' +
        '<span class="pk3-summary-label">平均实力评分</span>' +
        '<span class="pk3-summary-value">' + avgPwr + '分</span>' +
      '</div>' +
      '<div class="pk3-summary-row">' +
        '<span class="pk3-summary-label">主队优势率</span>' +
        '<span class="pk3-summary-value">' + homeRatio + '%（' + homeAdvCount + '/' + n + '场）</span>' +
      '</div>' +
      '<div class="pk3-summary-row">' +
        '<span class="pk3-summary-label">模型健康度</span>' +
        '<span class="pk3-summary-value ' + (healthScore >= 80 ? 'val-good' : healthScore >= 50 ? 'val-warn' : 'val-bad') + '">' + healthScore + '%' +
        (meltdownCount > 0 ? ' <small style="color:#ef5350">⚠️' + meltdownCount + '场熔断</small>' : '') + '</span>' +
      '</div>' +
      (heatDevCount > 0 ? '<div class="pk3-summary-row">' +
        '<span class="pk3-summary-label">热度偏离场次</span>' +
        '<span class="pk3-summary-value val-warn">' + heatDevCount + '场异常</span>' +
      '</div>' : '') +
    '</div>';
}

// ═══════════════════════════════════════════
//  关闭弹窗
// ═══════════════════════════════════════════

export function closePK() {
  var overlay = document.getElementById('pkOverlay');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

export function openPK() {}

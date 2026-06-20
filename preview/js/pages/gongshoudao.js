/**
import { loadCSS } from '../vendor.js';
loadCSS('../../css/page-gs.css');

 * 攻守道量化 — 弹窗模式
 * P1-1: 5分钟缓存，避免重复请求同一场比赛
 */
import { api } from '../api.js';
const _gsCache = {};

export function showGongshoudao(matchId, leagueName, homeName, visitName, matchNum, startTime) {
  // 打开弹窗 overlay
  const overlay = document.getElementById('aiOverlay');
  if (!overlay) return;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  const modal = document.getElementById('aiModal');
  if (!modal) return;

  // 显示骨架屏（模拟功守道内容结构，视觉过渡更平滑）
  modal.innerHTML =
    '<div class="ai-modal-header"><span class="ai-modal-title">功守道量化</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>' +
    '<div class="ai-content page-skeleton">' +
    // 头部信息骨架
    '<div class="gs-modal-head">' +
    '<div class="gs-modal-head-row"><span class="skel-bar w40" style="height:14px;margin:0"></span><span class="skel-bar w60" style="height:16px;margin:8px 0 4px"></span></div>' +
    '<div class="skel-bar w30" style="height:12px;margin:4px 0 0"></div>' +
    '</div>' +
    // 实力分析骨架
    '<div class="gs-modal-section">' +
    '<div class="gs-modal-sec-title"><span class="skel-bar w25" style="height:16px"></span></div>' +
    '<div class="skel-bar w90" style="height:12px;margin:8px 0"></div>' +
    '<div class="skel-bar w70" style="height:12px;margin:6px 0"></div>' +
    '<div class="skel-bar w80" style="height:12px;margin:6px 0"></div>' +
    '<div class="skel-bar w50" style="height:12px;margin:6px 0"></div>' +
    '<div class="skel-bar w60" style="height:12px;margin:6px 0"></div>' +
    '</div>' +
    // 大小球分析骨架
    '<div class="gs-modal-section">' +
    '<div class="gs-modal-sec-title"><span class="skel-bar w25" style="height:16px"></span></div>' +
    '<div class="skel-bar w65" style="height:12px;margin:8px 0"></div>' +
    '<div class="skel-bar w55" style="height:12px;margin:6px 0"></div>' +
    '<div class="skel-bar w75" style="height:12px;margin:6px 0"></div>' +
    '<div class="skel-bar w45" style="height:12px;margin:6px 0"></div>' +
    '</div>' +
    // 市场情报骨架
    '<div class="gs-modal-section">' +
    '<div class="gs-modal-sec-title"><span class="skel-bar w30" style="height:16px"></span></div>' +
    '<div class="skel-bar w60" style="height:12px;margin:8px 0"></div>' +
    '<div class="skel-bar w50" style="height:12px;margin:6px 0"></div>' +
    '</div>' +
    '</div>';

  // P1-1: 5分钟缓存（命中时直接渲染，跳过API请求）
  const cached = _gsCache[matchId];
  if (cached && Date.now() - cached.time < 300000) {
    const gs = cached.data;
    _renderGSBody(gs, startTime, leagueName, homeName, visitName, matchNum, matchId);
    return;
  }

  api('gongshoudao', { matchId: matchId })
    .then(function (data) {
      _gsCache[matchId] = { data: data || {}, time: Date.now() };
      _renderGSBody(data || {}, startTime, leagueName, homeName, visitName, matchNum, matchId);
    })
    .catch(function (e) {
      modal.innerHTML =
        '<div class="ai-modal-header"><span class="ai-modal-title">功守道量化</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>' +
        '<div class="ai-content"><div style="text-align:center;padding:60px 20px;color:var(--amber);">加载失败: ' +
        (e.message || '未知') +
        '</div></div>';
    });
}

// P1-1: 缓存渲染函数（从 showGongshoudao 提取，避免代码重复）
function _renderGSBody(gs, startTime, leagueName, homeName, visitName, matchNum, matchId) {
  const modal = document.getElementById('aiModal');
  if (!modal) return;
  // 格式化时间
  let timeFormatted = '';
  if (startTime) {
    const parts = startTime.split(' ');
    if (parts.length >= 2) {
      timeFormatted = parts[0].slice(5).replace('-', '/') + ' ' + parts[1].slice(0, 5);
    }
  }

  let html = '';
  html +=
    '<div class="ai-modal-header"><span class="ai-modal-title">功守道量化</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>';
  html += '<div class="ai-content">';

  // ====== 头部信息 ======
  html += '<div class="gs-modal-head">';
  html += '<div class="gs-modal-head-row">';
  html += '<span class="gs-modal-league">' + esc(leagueName) + '</span>';
  html += '<span class="gs-modal-teams">' + esc(homeName) + ' vs ' + esc(visitName) + '</span>';
  html += '<span class="gs-modal-num">' + esc(matchNum) + '</span>';
  html += '</div>';
  if (timeFormatted) html += '<div class="gs-modal-time">' + timeFormatted + '</div>';
  // ★ 数据时效标签
  if (gs.computedAt) {
    const dataAge = Math.floor((Date.now() - gs.computedAt) / 3600000);
    let ageLabel = '';
    let ageClass = '';
    if (dataAge < 1) {
      ageLabel =
        '数据更新于 ' + new Date(gs.computedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      ageClass = 'gs-data-fresh';
    } else if (dataAge < 24) {
      ageLabel = '数据更新于 ' + dataAge + '小时前';
      ageClass = 'gs-data-warn';
    } else {
      ageLabel = '数据可能已过期 (' + Math.floor(dataAge / 24) + '天前)';
      ageClass = 'gs-data-stale';
    }
    html +=
      '<div class="gs-modal-time" style="font-size:11px;color:var(--gray);"><span class="' +
      ageClass +
      '">' +
      ageLabel +
      '</span></div>';
  }
  html += '</div>';

  // ====== 实力分析 ======
  html += '<div class="gs-modal-section">';
  html += '<div class="gs-modal-sec-title"><span class="gs-title-icon">⚔️</span>实力分析</div>';

  html += gsRow('进攻优势', renderBar(gs.attackAdvantage || '+20%', gs.attackAdvantageValue || 60));
  html += gsRow('防守优势', renderBar(gs.defenseAdvantage || '-10%', gs.defenseAdvantageValue || 40, true));
  html += gsRow(
    '攻守格局',
    '<span class="gs-val-text">' +
      (gs.attackPattern || '攻守平衡') +
      '</span>' +
      '<span class="gs-note" style="margin-left:8px;">（进攻权重:' +
      (gs.attackDimWeight || gs.attackWeightHome || '50%') +
      ' | 防守权重:' +
      (gs.defenseDimWeight || gs.attackWeightAway || '50%') +
      '）</span>',
  );
  html += gsRow('综合攻守优势', renderBar(gs.totalAdvantage || '+50%', gs.totalAdvantageValue || 75));
  html += gsRow('实力阶梯', '<span class="gs-val-text">' + (gs.ladderLabel || '⚖️ 双方实力接近') + '</span>');
  // 胜平负交叉（不让球 + 让球 双组）
  const spfStr =
    '胜' + fmtCross(gs.crossSpfWin) + ' 平' + fmtCross(gs.crossSpfDraw) + ' 负' + fmtCross(gs.crossSpfLose) + '（让0）';
  const rqVal = gs.crossRq || 0;
  let hcpStr = '';
  if (rqVal !== 0) {
    hcpStr =
      ' + 让胜' +
      fmtCross(gs.crossHcpWin) +
      ' 让平' +
      fmtCross(gs.crossHcpDraw) +
      ' 让负' +
      fmtCross(gs.crossHcpLose) +
      '（让' +
      (rqVal > 0 ? '+' + rqVal : rqVal) +
      '）';
  }
  html += gsRow('胜平负交叉', '<span class="gs-vs">' + spfStr + hcpStr + '</span>');

  html += '</div>';

  // ====== 大小球分析 ======
  html += '<div class="gs-modal-section">';
  html += '<div class="gs-modal-sec-title"><span class="gs-title-icon">⚽</span>大小球分析</div>';

  html += gsRow(
    '主客权重',
    '<span class="gs-vs">主队 ' + (gs.homeWeight || '50%') + ' <i>vs</i> 客队 ' + (gs.awayWeight || '50%') + '</span>',
  );
  html += gsRow(
    '得失球',
    '<span class="gs-vs">主场 ' +
      (gs.goalDiffHome || '--') +
      ' <i>vs</i> 客场 ' +
      (gs.goalDiffAway || '--') +
      '</span>',
  );
  html += gsRow(
    '总进球期望',
    '<span class="gs-vs-row"><span class="gs-bar-group">' +
      renderBar(gs.totalGoalsExpect || '2.5', gs.totalGoalsValue || 42, false) +
      '</span><span class="gs-note">λ_total</span></span>',
  );
  html += gsRow(
    '进球区间',
    '<span class="gs-val-text">' + (gs.goalRange && gs.goalRange.range ? gs.goalRange.range : '2-4球') + '</span>',
  );
  html += gsRow(
    '主队预期进球',
    '<span class="gs-vs-row"><span class="gs-bar-group">' +
      renderBar((gs.xgHome || 1.5).toFixed(2), Math.min(100, Math.round(((gs.xgHome || 1.5) / 5) * 100))) +
      '</span><span class="gs-note">E_h</span></span>',
  );
  html += gsRow(
    '客队预期进球',
    '<span class="gs-vs-row"><span class="gs-bar-group">' +
      renderBar((gs.xgAway || 1.5).toFixed(2), Math.min(100, Math.round(((gs.xgAway || 1.5) / 5) * 100))) +
      '</span><span class="gs-note">E_a</span></span>',
  );
  // 四重熔断
  const consensusLabel = gs.fusionConsensus || '';
  if (consensusLabel) {
    const consensusVal = gs.fusionFused
      ? (gs.fusionFinalHome || 0).toFixed(2) + '/' + (gs.fusionFinalAway || 0).toFixed(2)
      : '--';
    html += gsRow(
      '四重验证基准',
      '<span class="gs-vs-row"><span class="gs-bar-group">' +
        renderBar(
          consensusVal,
          Math.min(100, Math.round((((gs.fusionFinalHome || 1) + (gs.fusionFinalAway || 1)) / 6) * 100)),
        ) +
        '</span><span class="gs-note" style="color:var(--amber);">' +
        consensusLabel +
        '</span></span>',
    );
  }

  html += '</div>';

  // ====== V7.0 市场情报交叉验证 ======
  if (gs.marketScore !== undefined) {
    let mktRiskClass = '';
    if (gs.marketRiskLevel === 'danger') mktRiskClass = 'gs-risk-danger';
    else if (gs.marketRiskLevel === 'warning') mktRiskClass = 'gs-risk-warning';
    else if (gs.marketRiskLevel === 'caution') mktRiskClass = 'gs-risk-caution';

    html += '<div class="gs-modal-section">';
    html += '<div class="gs-modal-sec-title"><span class="gs-title-icon">📈</span>市场情报交叉验证</div>';

    html += gsRow(
      '市场信号',
      '<span class="gs-vs-row"><span class="gs-bar-group">' +
        renderBar(gs.marketScore, gs.marketScore) +
        '</span><span class="gs-note ' +
        mktRiskClass +
        '">' +
        (gs.marketSignal || '--') +
        '</span></span>',
    );

    // 盘口位移
    if (gs.marketMovement && gs.marketMovement.direction) {
      const movDir = gs.marketMovement.direction;
      const movIcon = movDir.indexOf('降水') >= 0 ? '📉' : movDir.indexOf('升水') >= 0 ? '📈' : '➡️';
      const movClass = gs.marketMovement.severity === 'significant' ? 'gs-risk-warning' : '';
      html += gsRow(
        '盘口位移',
        '<span class="gs-val-text ' +
          movClass +
          '">' +
          movIcon +
          ' ' +
          movDir +
          '</span>' +
          (gs.marketMovement.probShift
            ? '<span class="gs-note"> 偏移 ' +
              (gs.marketMovement.probShift > 0 ? '+' : '') +
              (gs.marketMovement.probShift * 100).toFixed(1) +
              '%</span>'
            : ''),
      );
    }

    // 欧亚一致性
    if (gs.marketEuroAsia && gs.marketEuroAsia.detail) {
      const eaClass = gs.marketEuroAsia.consistent ? '' : 'gs-risk-danger';
      html += gsRow('欧亚一致性', '<span class="gs-val-text ' + eaClass + '">' + gs.marketEuroAsia.detail + '</span>');
    }

    // Market xG 反推
    if (gs.marketXg && gs.marketXg.total) {
      html += gsRow(
        '市场隐含xG',
        '<span class="gs-vs-row"><span class="gs-bar-group">' +
          renderBar(gs.marketXg.total.toFixed(2), Math.min(100, Math.round((gs.marketXg.total / 6) * 100))) +
          '</span><span class="gs-note">λ_market (盘口: ' +
          gs.marketXg.overUnderLine +
          ')</span></span>',
      );
      html += gsRow(
        '融合 xG',
        '<span class="gs-vs">H:' +
          (gs.fusedXgHome || '--').toFixed(2) +
          ' / A:' +
          (gs.fusedXgAway || '--').toFixed(2) +
          ' <i>（70%模型 + 30%市场）</i></span>',
      );
    }

    // 信号标签
    if (gs.marketSignalFlags && gs.marketSignalFlags.length > 0) {
      const flagsHtml = gs.marketSignalFlags
        .map(function (f) {
          let fc = 'gs-signal-tag';
          if (f.indexOf('⚠️') >= 0 || f.indexOf('背离') >= 0) fc += ' gs-signal-danger';
          else if (f.indexOf('支撑') >= 0 || f.indexOf('一致') >= 0) fc += ' gs-signal-good';
          return '<span class="' + fc + '">' + f + '</span>';
        })
        .join(' ');
      html += gsRow('信号标签', '<span class="gs-vs-row">' + flagsHtml + '</span>');
    }

    // 风险提示
    if (gs.marketRiskDetail) {
      html +=
        '<div class="gs-modal-note" style="margin-top:8px;padding:8px 12px;border-radius:6px;background:rgba(255,152,0,0.08);color:var(--amber);font-size:12px;">' +
        gs.marketRiskDetail +
        '</div>';
    }

    html += '</div>';
  }

  // ====== 净胜球分析 ======
  html += '<div class="gs-modal-section">';
  html += '<div class="gs-modal-sec-title"><span class="gs-title-icon">🎯</span>让球分析（7场阈值裁决）</div>';

  html += gsRow(
    '主队赢球期望',
    '<span class="gs-vs-row"><span class="gs-bar-group">' +
      renderBar(gs.homeWinExpect || '+0.50', gs.homeWinValue || 55) +
      '</span><span class="gs-note">Diff_exp</span></span>',
  );
  html += gsRow(
    '功守道战力',
    '<span class="gs-vs-row"><span class="gs-bar-group">' +
      renderBar(gs.totalAdvantage2 || '+2.5%', gs.totalAdvantage2Value || 55) +
      '</span><span class="gs-note">Total_战</span></span>',
  );
  html += gsRow(
    '动态锚点',
    '<span class="gs-val-text">' + (gs.anchor && gs.anchor.label ? gs.anchor.label : '--') + '</span>',
  );
  html += gsRow('输赢球分布', renderBar(gs.goalCount || '±0', gs.goalCountValue || 50, false));
  html += gsRow(
    '7场阈值判定',
    '<span class="gs-val-text">' + (gs.sevenMatch ? gs.sevenMatch.dimension1.label || '--' : '--') + '</span>',
  );
  // ★ V7.0: 显示概率 + 置信度
  if (gs.sevenMatch && gs.sevenMatch.dimension1.prob !== undefined) {
    html += gsRow(
      '穿盘概率(Beta-Binomial)',
      '<span class="gs-vs-row"><span class="gs-bar-group">' +
        renderBar(gs.sevenMatch.dimension1.probPct || '50%', Math.round((gs.sevenMatch.dimension1.prob || 0.5) * 100)) +
        '</span><span class="gs-note">置信度: ' +
        (gs.sevenMatch.dimension1.confidence || '--') +
        '</span></span>',
    );
  }

  html += '</div>';

  // ====== 比分 ======
  html += '<div class="gs-modal-section" id="gsScoreSection">';
  html +=
    '<div class="gs-modal-sec-title"><span class="gs-title-icon">📊</span>比分八阵裂变<span class="match-bet-btn" onclick="goFromGSToScheme(\'' +
    matchId +
    '\')" style="float:right;cursor:pointer;">我要做方案</span></div>';

  const scores = gs.scores || [
    { score: '1-1', percent: '50%' },
    { score: '2-1', percent: '30%' },
    { score: '0-1', percent: '20%' },
  ];
  const scoreOdds = gs.scoreOdds || {}; // { "1-0": 8.25, ... }

  // 智能分类：正兵/奇兵/伏兵
  // 规则：
  //   正兵 — 概率 > 8% 且净胜球方向与实力阶梯一致，或概率 > 12%
  //   奇兵 — 概率 3-8% 或方向不一致但有支撑，或概率 8-12% 但方向异常
  //   伏兵 — 概率 < 5% 但历史上有出现
  const ladderLevel = gs.ladderLevel || 0; // 正=主队优, 负=客队优
  let zhengBing = [],
    qiBing = [],
    fuBing = [];

  scores.forEach(function (s) {
    const pct = parseFloat(s.percent) || 0;
    const parts = s.score.split('-');
    const hVal = parseInt(parts[0]) || 0;
    const aVal = parseInt(parts[1]) || 0;
    const gd = hVal - aVal;
    const directionMatch = (ladderLevel > 0 && gd > 0) || (ladderLevel < 0 && gd < 0) || ladderLevel === 0;
    const homeWin = gd > 0,
      draw = gd === 0,
      awayWin = gd < 0;

    // 分类逻辑
    if (pct >= 12 || (pct >= 8 && directionMatch)) {
      zhengBing.push(s);
    } else if (pct >= 5 || (pct >= 3 && !directionMatch && pct >= 4)) {
      qiBing.push(s);
    } else {
      fuBing.push(s);
    }
  });

  // 确保各类别至少有一些内容
  if (zhengBing.length === 0 && scores.length > 0) {
    zhengBing = scores.slice(0, Math.min(3, scores.length));
    qiBing = scores.slice(zhengBing.length, Math.min(6, scores.length));
    fuBing = scores.slice(qiBing.length + zhengBing.length, scores.length);
  }
  if (qiBing.length === 0 && fuBing.length > 0) {
    qiBing = fuBing.splice(0, Math.min(2, fuBing.length));
  }

  function getScoreOddsFromPercent(pctStr) {
    if (!pctStr) return null;
    const p = parseFloat(pctStr);
    if (isNaN(p) || p <= 0) return null;
    return 1 / (p / 100);
  }

  function renderScoreCard(s, riskClass) {
    const odds = scoreOdds[s.score] !== undefined ? scoreOdds[s.score] : getScoreOddsFromPercent(s.percent);
    const oddsAttr = ' data-odds="' + (odds !== null ? odds : '--') + '"';
    const hasOdds = odds !== null;
    const riskLabel = riskClass || '';
    let riskDisplay = '';
    if (riskLabel === 'high') riskDisplay = '<div class="gs-score-risk gs-risk-high">高风险</div>';
    else if (riskLabel === 'cold') riskDisplay = '<div class="gs-score-risk gs-risk-cold">冷门</div>';
    return (
      '<div class="gs-score-card' +
      (!hasOdds ? ' no-odds' : '') +
      '" data-score="' +
      s.score +
      '"' +
      oddsAttr +
      '>' +
      '<div class="gs-score-val">' +
      s.score +
      '</div>' +
      '<div class="gs-score-pct">' +
      s.percent +
      '</div>' +
      riskDisplay +
      '</div>'
    );
  }

  if (zhengBing.length > 0) {
    html +=
      '<div class="gs-score-cat"><span class="gs-score-cat-label">正兵盘口</span><span class="gs-score-cat-hint">基本面最一致的比分方向</span></div>';
    html += '<div class="gs-score-grid">';
    zhengBing.forEach(function (s) {
      html += renderScoreCard(s, '');
    });
    html += '</div>';
  }
  if (qiBing.length > 0) {
    html +=
      '<div class="gs-score-cat"><span class="gs-score-cat-label">奇兵盘口</span><span class="gs-score-cat-hint">概率较低但有三重锁支撑的隐藏机会</span></div>';
    html += '<div class="gs-score-grid">';
    qiBing.forEach(function (s) {
      html += renderScoreCard(s, 'high');
    });
    html += '</div>';
  }
  if (fuBing.length > 0) {
    html +=
      '<div class="gs-score-cat"><span class="gs-score-cat-label">伏兵妖谱</span><span class="gs-score-cat-hint">历史交锋中曾出现过的冷门比分</span></div>';
    html += '<div class="gs-score-grid">';
    fuBing.forEach(function (s) {
      html += renderScoreCard(s, 'cold');
    });
    html += '</div>';
  }

  // 投注模拟表格容器
  html += '<div id="gsBetTableWrap" style="display:none;"></div>';
  // 提示框
  html += '<div class="gs-score-hint">点击单个或多个比分进行比分投注方案模拟</div>';

  html += '</div>'; // gs-modal-section (比分)

  html += '</div>'; // ai-content
  modal.innerHTML = html;

  // ━━━ 绑定比分卡片点击事件 ━━━
  const selectedScores = []; // [{ score, odds }]

  function renderBetTable() {
    const wrap = document.getElementById('gsBetTableWrap');
    if (!wrap) return;
    if (selectedScores.length === 0) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = 'block';

    const totalCapital = 1000;
    let tableHtml =
      '<table class="gs-score-bet-table"><thead><tr><th>选项</th><th>赔率</th><th>资金分配</th><th>预期奖金</th></tr></thead><tbody>';

    if (selectedScores.length === 1) {
      // 单选：全部投入
      const item = selectedScores[0];
      const payout = totalCapital * item.odds;
      tableHtml += '<tr>';
      tableHtml += '<td>' + item.score + '</td>';
      tableHtml += '<td class="gs-bet-odds">' + item.odds.toFixed(2) + '</td>';
      tableHtml += '<td class="gs-bet-alloc">' + totalCapital + '</td>';
      tableHtml += '<td class="gs-bet-payout">' + payout.toFixed(0) + '</td>';
      tableHtml += '</tr>';
      tableHtml +=
        '<tr class="gs-bet-summary-row"><td colspan="2">总投入</td><td class="gs-bet-val">' +
        totalCapital +
        '</td><td></td></tr>';
      tableHtml +=
        '<tr class="gs-bet-summary-row"><td colspan="2">期望收入</td><td></td><td class="gs-bet-income">' +
        payout.toFixed(0) +
        '</td></tr>';
    } else {
      // 多选：荷兰式均分（奖金相等）
      let sumInv = 0;
      selectedScores.forEach(function (it) {
        sumInv += 1 / it.odds;
      });
      const expectedIncome = totalCapital / sumInv;

      selectedScores.forEach(function (it) {
        const alloc = (totalCapital * (1 / it.odds)) / sumInv;
        const payout = alloc * it.odds;
        tableHtml += '<tr>';
        tableHtml += '<td>' + it.score + '</td>';
        tableHtml += '<td class="gs-bet-odds">' + it.odds.toFixed(2) + '</td>';
        tableHtml += '<td class="gs-bet-alloc">' + Math.round(alloc) + '</td>';
        tableHtml += '<td class="gs-bet-payout">' + Math.round(payout) + '</td>';
        tableHtml += '</tr>';
      });
      tableHtml +=
        '<tr class="gs-bet-summary-row"><td colspan="2">总投入</td><td class="gs-bet-val">' +
        totalCapital +
        '</td><td></td></tr>';
      tableHtml +=
        '<tr class="gs-bet-summary-row"><td colspan="2">期望收入</td><td></td><td class="gs-bet-income">≈' +
        Math.round(expectedIncome) +
        '</td></tr>';
    }

    tableHtml += '</tbody></table>';
    wrap.innerHTML = tableHtml;
  }

  // 事件委托：父容器监听
  const scoreSection = document.getElementById('gsScoreSection');
  if (scoreSection) {
    // closest() polyfill
    const closestEl = Element.prototype.closest
      ? function (el, sel) {
          return el.closest(sel);
        }
      : function (el, sel) {
          let e = el;
          while (e && e.nodeType === 1) {
            if (e.matches && e.matches(sel)) return e;
            e = e.parentNode;
          }
          return null;
        };

    scoreSection.addEventListener('click', function (e) {
      const card = closestEl(e.target, '.gs-score-card');
      if (!card) return;
      const score = card.getAttribute('data-score');
      const oddsAttr = card.getAttribute('data-odds');
      if (!score) return;
      // oddsAttr 可能为 '--'（无有效赔率/概率），跳过
      if (!oddsAttr || oddsAttr === '--') return;
      const odds = parseFloat(oddsAttr);
      if (isNaN(odds) || odds <= 0) return;

      // 切换选中
      let idx = -1;
      for (let i = 0; i < selectedScores.length; i++) {
        if (selectedScores[i].score === score) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        // 取消选中
        selectedScores.splice(idx, 1);
        card.classList.remove('selected');
      } else {
        // 选中
        selectedScores.push({ score: score, odds: odds });
        card.classList.add('selected');
      }
      renderBetTable();
    });
  }
}

// 行布局
function gsRow(label, content) {
  return (
    '<div class="gs-row"><span class="gs-row-label">' +
    label +
    '</span><div class="gs-row-body">' +
    content +
    '</div></div>'
  );
}

// 进度条
function renderBar(value, percent, negative) {
  const p = parseInt(percent) || 0;
  const valStr = String(value);
  const isNeg = negative || valStr.startsWith('-');
  const display = valStr.startsWith('-') || valStr.startsWith('+') ? valStr : '+' + valStr;
  return (
    '<div class="gs-bar-wrap"><div class="gs-bar-bg"><div class="gs-bar-fill' +
    (isNeg ? ' neg' : '') +
    '" style="width:' +
    p +
    '%"></div></div><span class="gs-bar-val' +
    (isNeg ? ' neg' : '') +
    '">' +
    display +
    '</span></div>'
  );
}

// 格式化交叉分布值：归一化值（0~1）→ 百分比显示
function fmtCross(v) {
  if (v === undefined || v === null) return '--';
  const n = Number(v);
  // 如果原始值范围已经 > 1（旧版计数），保持原样
  if (Math.abs(n) > 1.5) return Math.round(n) + '场';
  return Math.round(n * 100) + '%';
}

// ★ 从功守道弹窗跳转方案设计页
window.goFromGSToScheme = function (matchId) {
  if (matchId) {
    try {
      sessionStorage.setItem('preselectMatch', matchId);
    } catch (e) {}
  }
  // 关闭功守道弹窗
  const o = document.getElementById('gongshoudaoOverlay');
  if (o) o.classList.remove('active');
  document.body.style.overflow = '';
  window.switchTab('scheme');
};

function esc(s) {
  const str = s == null ? '' : String(s);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

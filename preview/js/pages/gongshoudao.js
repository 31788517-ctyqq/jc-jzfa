/**
 * 攻守道量化 — 弹窗模式
 */
import { api } from '../api.js';

export function showGongshoudao(matchId, leagueName, homeName, visitName, matchNum, startTime) {

  // 打开弹窗 overlay
  var overlay = document.getElementById('aiOverlay');
  if (!overlay) return;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  var modal = document.getElementById('aiModal');
  if (!modal) return;

  // 显示 loading
  modal.innerHTML = '<div class="ai-modal-header"><span class="ai-modal-title">功守道量化</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>' +
    '<div class="ai-content"><div style="text-align:center;padding:80px 20px;color:var(--cyan);"><div style="font-size:40px;margin-bottom:16px;">⏳</div><div style="font-size:16px;font-weight:600;">加载中...</div></div></div>';

  api('gongshoudao', { matchId: matchId }).then(function(data) {
    var gs = data || {};

    // 格式化时间
    var timeFormatted = '';
    if (startTime) {
      var parts = startTime.split(' ');
      if (parts.length >= 2) {
        timeFormatted = parts[0].slice(5).replace('-', '/') + ' ' + parts[1].slice(0, 5);
      }
    }

    var html = '';
    html += '<div class="ai-modal-header"><span class="ai-modal-title">功守道量化</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>';
    html += '<div class="ai-content">';

    // ====== 头部信息 ======
    html += '<div class="gs-modal-head">';
    html += '<div class="gs-modal-head-row">';
    html += '<span class="gs-modal-league">' + esc(leagueName) + '</span>';
    html += '<span class="gs-modal-teams">' + esc(homeName) + ' vs ' + esc(visitName) + '</span>';
    html += '<span class="gs-modal-num">' + esc(matchNum) + '</span>';
    html += '</div>';
    if (timeFormatted) html += '<div class="gs-modal-time">' + timeFormatted + '</div>';
    html += '</div>';

    // ====== 实力分析 ======
    html += '<div class="gs-modal-section">';
    html += '<div class="gs-modal-sec-title"><img src="/assets/gs-power.png" class="gs-title-icon" alt="">实力分析</div>';

    html += gsRow('进攻优势', renderBar(gs.attackAdvantage || '+20%', gs.attackAdvantageValue || 60));
    html += gsRow('防守优势', renderBar(gs.defenseAdvantage || '-10%', gs.defenseAdvantageValue || 40, true));
    html += gsRow('攻守格局', '<span class="gs-val-text">' + (gs.attackPattern || '攻守平衡') + '</span>' +
      '<span class="gs-note" style="margin-left:8px;">（进攻权重:' + (gs.attackDimWeight || gs.attackWeightHome || '50%') + ' | 防守权重:' + (gs.defenseDimWeight || gs.attackWeightAway || '50%') + '）</span>');
    html += gsRow('综合攻守优势', renderBar(gs.totalAdvantage || '+50%', gs.totalAdvantageValue || 75));
    html += gsRow('实力阶梯', '<span class="gs-val-text">' + (gs.ladderLabel || '⚖️ 双方实力接近') + '</span>');
    // 胜平负交叉（不让球 + 让球 双组）
    var spfStr = '胜' + fmtCross(gs.crossSpfWin) + ' 平' + fmtCross(gs.crossSpfDraw) + ' 负' + fmtCross(gs.crossSpfLose) + '（让0）';
    var rqVal = gs.crossRq || 0;
    var hcpStr = '';
    if (rqVal !== 0) {
      hcpStr = ' + 让胜' + fmtCross(gs.crossHcpWin) + ' 让平' + fmtCross(gs.crossHcpDraw) + ' 让负' + fmtCross(gs.crossHcpLose) + '（让' + (rqVal > 0 ? '+' + rqVal : rqVal) + '）';
    }
    html += gsRow('胜平负交叉', '<span class="gs-vs">' + spfStr + hcpStr + '</span>');

    html += '</div>';

    // ====== 大小球分析 ======
    html += '<div class="gs-modal-section">';
    html += '<div class="gs-modal-sec-title"><img src="/assets/gs-ball.png" class="gs-title-icon" alt="">大小球分析</div>';

    html += gsRow('主客权重', '<span class="gs-vs">主队 ' + (gs.homeWeight || '50%') + ' <i>vs</i> 客队 ' + (gs.awayWeight || '50%') + '</span>');
    html += gsRow('得失球', '<span class="gs-vs">主场 ' + (gs.goalDiffHome || '--') + ' <i>vs</i> 客场 ' + (gs.goalDiffAway || '--') + '</span>');
    html += gsRow('总进球期望', '<span class="gs-vs-row"><span class="gs-bar-group">' + renderBar(gs.totalGoalsExpect || '2.5', gs.totalGoalsValue || 42, false) + '</span><span class="gs-note">λ_total</span></span>');
    html += gsRow('进球区间', '<span class="gs-val-text">' + (gs.goalRange && gs.goalRange.range ? gs.goalRange.range : '2-4球') + '</span>');
    html += gsRow('主队预期进球', '<span class="gs-vs-row"><span class="gs-bar-group">' + renderBar((gs.xgHome || 1.5).toFixed(2), Math.min(100, Math.round((gs.xgHome || 1.5) / 5 * 100))) + '</span><span class="gs-note">E_h</span></span>');
    html += gsRow('客队预期进球', '<span class="gs-vs-row"><span class="gs-bar-group">' + renderBar((gs.xgAway || 1.5).toFixed(2), Math.min(100, Math.round((gs.xgAway || 1.5) / 5 * 100))) + '</span><span class="gs-note">E_a</span></span>');
    // 四重熔断
    var consensusLabel = gs.fusionConsensus || '';
    if (consensusLabel) {
      var consensusVal = gs.fusionFused ? (gs.fusionFinalHome || 0).toFixed(2) + '/' + (gs.fusionFinalAway || 0).toFixed(2) : '--';
      html += gsRow('四重验证基准', '<span class="gs-vs-row"><span class="gs-bar-group">' + renderBar(consensusVal, Math.min(100, Math.round(((gs.fusionFinalHome || 1) + (gs.fusionFinalAway || 1)) / 6 * 100))) + '</span><span class="gs-note" style="color:var(--amber);">' + consensusLabel + '</span></span>');
    }

    html += '</div>';

    // ====== 净胜球分析 ======
    html += '<div class="gs-modal-section">';
    html += '<div class="gs-modal-sec-title"><img src="/assets/gs-goal.png" class="gs-title-icon" alt="">让球分析（7场阈值裁决）</div>';

    html += gsRow('主队赢球期望', '<span class="gs-vs-row"><span class="gs-bar-group">' + renderBar(gs.homeWinExpect || '+0.50', gs.homeWinValue || 55) + '</span><span class="gs-note">Diff_exp</span></span>');
    html += gsRow('功守道战力', '<span class="gs-vs-row"><span class="gs-bar-group">' + renderBar(gs.totalAdvantage2 || '+2.5%', gs.totalAdvantage2Value || 55) + '</span><span class="gs-note">Total_战</span></span>');
    html += gsRow('动态锚点', '<span class="gs-val-text">' + (gs.anchor && gs.anchor.label ? gs.anchor.label : '--') + '</span>');
    html += gsRow('输赢球分布', renderBar(gs.goalCount || '±0', gs.goalCountValue || 50, false));
    html += gsRow('7场阈值判定', '<span class="gs-val-text">' + (gs.sevenMatch ? (gs.sevenMatch.dimension1.label || '--') : '--') + '</span>');

    html += '</div>';

    // ====== 比分 ======
    html += '<div class="gs-modal-section" id="gsScoreSection">';
    html += '<div class="gs-modal-sec-title"><img src="/assets/gs-score.png" class="gs-title-icon" alt="">比分八阵裂变</div>';

    var scores = gs.scores || [
      { score: '1-1', percent: '50%' },
      { score: '2-1', percent: '30%' },
      { score: '0-1', percent: '20%' }
    ];
    var scoreOdds = gs.scoreOdds || {}; // { "1-0": 8.25, ... }

    // 分类：正兵(前4)、奇兵(5-6)、伏兵(7-8)
    var zhengBing = scores.slice(0, 4);
    var qiBing = scores.slice(4, 6);
    var fuBing = scores.slice(6, 8);

    function getScoreOddsFromPercent(pctStr) {
      if (!pctStr) return null;
      var p = parseFloat(pctStr);
      if (isNaN(p) || p <= 0) return null;
      return (1 / (p / 100));
    }

    function renderScoreCard(s) {
      var odds = scoreOdds[s.score] !== undefined ? scoreOdds[s.score] : getScoreOddsFromPercent(s.percent);
      var oddsAttr = ' data-odds="' + (odds !== null ? odds : '--') + '"';
      var hasOdds = odds !== null;
      return '<div class="gs-score-card' + (!hasOdds ? ' no-odds' : '') + '" data-score="' + s.score + '"' + oddsAttr + '><div class="gs-score-val">' + s.score + '</div><div class="gs-score-pct">' + s.percent + '</div></div>';
    }

    if (zhengBing.length > 0) {
      html += '<div class="gs-score-cat"><span class="gs-score-cat-label">正兵盘口</span></div>';
      html += '<div class="gs-score-grid">';
      zhengBing.forEach(function(s) { html += renderScoreCard(s); });
      html += '</div>';
    }
    if (qiBing.length > 0) {
      html += '<div class="gs-score-cat"><span class="gs-score-cat-label">奇兵盘口</span></div>';
      html += '<div class="gs-score-grid">';
      qiBing.forEach(function(s) { html += renderScoreCard(s); });
      html += '</div>';
    }
    if (fuBing.length > 0) {
      html += '<div class="gs-score-cat"><span class="gs-score-cat-label">伏兵妖谱</span></div>';
      html += '<div class="gs-score-grid">';
      fuBing.forEach(function(s) { html += renderScoreCard(s); });
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
    var selectedScores = []; // [{ score, odds }]

    function renderBetTable() {
      var wrap = document.getElementById('gsBetTableWrap');
      if (!wrap) return;
      if (selectedScores.length === 0) {
        wrap.style.display = 'none';
        return;
      }
      wrap.style.display = 'block';

      var totalCapital = 1000;
      var tableHtml = '<table class="gs-score-bet-table"><thead><tr><th>选项</th><th>赔率</th><th>资金分配</th><th>预期奖金</th></tr></thead><tbody>';

      if (selectedScores.length === 1) {
        // 单选：全部投入
        var item = selectedScores[0];
        var payout = totalCapital * item.odds;
        tableHtml += '<tr>';
        tableHtml += '<td>' + item.score + '</td>';
        tableHtml += '<td class="gs-bet-odds">' + item.odds.toFixed(2) + '</td>';
        tableHtml += '<td class="gs-bet-alloc">' + totalCapital + '</td>';
        tableHtml += '<td class="gs-bet-payout">' + payout.toFixed(0) + '</td>';
        tableHtml += '</tr>';
        tableHtml += '<tr class="gs-bet-summary-row"><td colspan="2">总投入</td><td class="gs-bet-val">' + totalCapital + '</td><td></td></tr>';
        tableHtml += '<tr class="gs-bet-summary-row"><td colspan="2">期望收入</td><td></td><td class="gs-bet-income">' + payout.toFixed(0) + '</td></tr>';
      } else {
        // 多选：荷兰式均分（奖金相等）
        var sumInv = 0;
        selectedScores.forEach(function(it) { sumInv += 1 / it.odds; });
        var expectedIncome = totalCapital / sumInv;

        selectedScores.forEach(function(it) {
          var alloc = totalCapital * (1 / it.odds) / sumInv;
          var payout = alloc * it.odds;
          tableHtml += '<tr>';
          tableHtml += '<td>' + it.score + '</td>';
          tableHtml += '<td class="gs-bet-odds">' + it.odds.toFixed(2) + '</td>';
          tableHtml += '<td class="gs-bet-alloc">' + Math.round(alloc) + '</td>';
          tableHtml += '<td class="gs-bet-payout">' + Math.round(payout) + '</td>';
          tableHtml += '</tr>';
        });
        tableHtml += '<tr class="gs-bet-summary-row"><td colspan="2">总投入</td><td class="gs-bet-val">' + totalCapital + '</td><td></td></tr>';
        tableHtml += '<tr class="gs-bet-summary-row"><td colspan="2">期望收入</td><td></td><td class="gs-bet-income">≈' + Math.round(expectedIncome) + '</td></tr>';
      }

      tableHtml += '</tbody></table>';
      wrap.innerHTML = tableHtml;
    }

    // 事件委托：父容器监听
    var scoreSection = document.getElementById('gsScoreSection');
    if (scoreSection) {
      // closest() polyfill
      var closestEl = Element.prototype.closest
        ? function(el, sel) { return el.closest(sel); }
        : function(el, sel) {
            var e = el;
            while (e && e.nodeType === 1) {
              if (e.matches && e.matches(sel)) return e;
              e = e.parentNode;
            }
            return null;
          };

      scoreSection.addEventListener('click', function(e) {
        var card = closestEl(e.target, '.gs-score-card');
        if (!card) return;
        var score = card.getAttribute('data-score');
        var oddsAttr = card.getAttribute('data-odds');
        if (!score) return;
        // oddsAttr 可能为 '--'（无有效赔率/概率），跳过
        if (!oddsAttr || oddsAttr === '--') return;
        var odds = parseFloat(oddsAttr);
        if (isNaN(odds) || odds <= 0) return;

        // 切换选中
        var idx = -1;
        for (var i = 0; i < selectedScores.length; i++) {
          if (selectedScores[i].score === score) { idx = i; break; }
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

  }).catch(function(e) {
    modal.innerHTML = '<div class="ai-modal-header"><span class="ai-modal-title">功守道量化</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>' +
      '<div class="ai-content"><div style="text-align:center;padding:60px 20px;color:var(--amber);">加载失败: ' + (e.message || '未知') + '</div></div>';
  });
}

// 行布局
function gsRow(label, content) {
  return '<div class="gs-row"><span class="gs-row-label">' + label + '</span><div class="gs-row-body">' + content + '</div></div>';
}

// 进度条
function renderBar(value, percent, negative) {
  var p = parseInt(percent) || 0;
  var valStr = String(value);
  var isNeg = negative || valStr.startsWith('-');
  var display = (valStr.startsWith('-') || valStr.startsWith('+')) ? valStr : ('+' + valStr);
  return '<div class="gs-bar-wrap"><div class="gs-bar-bg"><div class="gs-bar-fill' + (isNeg ? ' neg' : '') + '" style="width:' + p + '%"></div></div><span class="gs-bar-val' + (isNeg ? ' neg' : '') + '">' + display + '</span></div>';
}

// 格式化交叉分布值：归一化值（0~1）→ 百分比显示
function fmtCross(v) {
  if (v === undefined || v === null) return '--';
  var n = Number(v);
  // 如果原始值范围已经 > 1（旧版计数），保持原样
  if (Math.abs(n) > 1.5) return Math.round(n) + '场';
  return Math.round(n * 100) + '%';
}

function esc(s) {
  var str = (s == null ? '' : String(s));
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

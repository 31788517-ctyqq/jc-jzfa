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
    html += gsRow('胜平负交叉', '<span class="gs-vs">胜' + fmtCross(gs.crossWin) + ' 平' + fmtCross(gs.crossDraw) + ' 负' + fmtCross(gs.crossLose) + ' <i>' + (gs.crossRq > 0 ? '客让' + gs.crossRq : gs.crossRq < 0 ? '主让' + Math.abs(gs.crossRq) : '平手') + '</i></span>');

    html += '</div>';

    // ====== 大小球分析 ======
    html += '<div class="gs-modal-section">';
    html += '<div class="gs-modal-sec-title"><img src="/assets/gs-ball.png" class="gs-title-icon" alt="">大小球分析</div>';

    html += gsRow('主客权重', '<span class="gs-vs">主队 ' + (gs.homeWeight || '50%') + ' <i>vs</i> 客队 ' + (gs.awayWeight || '50%') + '</span>');
    html += gsRow('得失球', '<span class="gs-vs">主场 ' + (gs.goalDiffHome || '--') + ' <i>vs</i> 客场 ' + (gs.goalDiffAway || '--') + '</span>');
    html += gsRow('总进球期望', '<span class="gs-vs-row"><span class="gs-bar-group">' + renderBar(gs.totalGoalsExpect || '2.5', gs.totalGoalsValue || 42, false) + '</span><span class="gs-note">λ_total</span></span>');
    html += gsRow('弹窗区间', '<span class="gs-val-text">' + (gs.goalRange && gs.goalRange.range ? gs.goalRange.range : '2-4球') + '</span>');

    html += '</div>';

    // ====== 净胜球分析 ======
    html += '<div class="gs-modal-section">';
    html += '<div class="gs-modal-sec-title"><img src="/assets/gs-goal.png" class="gs-title-icon" alt="">让球分析（7场阈值裁决）</div>';

    html += gsRow('预期净胜球差', '<span class="gs-vs-row"><span class="gs-bar-group">' + renderBar(gs.homeWinExpect || '+0.50', gs.homeWinValue || 55) + '</span><span class="gs-note">Diff_exp</span></span>');
    html += gsRow('功守道战力', '<span class="gs-vs-row"><span class="gs-bar-group">' + renderBar(gs.totalAdvantage2 || '+2.5%', gs.totalAdvantage2Value || 55) + '</span><span class="gs-note">Total_战</span></span>');
    html += gsRow('动态锚点', '<span class="gs-val-text">' + (gs.anchor && gs.anchor.label ? gs.anchor.label : '--') + '</span>');
    html += gsRow('输赢球分布', renderBar(gs.goalCount || '±0', gs.goalCountValue || 50, false));
    html += gsRow('7场阈值判定', '<span class="gs-val-text">' + (gs.sevenMatch ? (gs.sevenMatch.dimension1.label || '--') : '--') + '</span>');

    html += '</div>';

    // ====== 比分 ======
    html += '<div class="gs-modal-section">';
    html += '<div class="gs-modal-sec-title"><img src="/assets/gs-score.png" class="gs-title-icon" alt="">比分八阵裂变</div>';

    var scores = gs.scores || [
      { score: '1-1', percent: '50%' },
      { score: '2-1', percent: '30%' },
      { score: '0-1', percent: '20%' }
    ];

    // 分类：正兵(前4)、奇兵(5-6)、伏兵(7-8)
    var zhengBing = scores.slice(0, 4);
    var qiBing = scores.slice(4, 6);
    var fuBing = scores.slice(6, 8);

    if (zhengBing.length > 0) {
      html += '<div class="gs-score-cat"><span class="gs-score-cat-label">正兵盘口</span></div>';
      html += '<div class="gs-score-grid">';
      zhengBing.forEach(function(s) {
        html += '<div class="gs-score-card"><div class="gs-score-val">' + s.score + '</div><div class="gs-score-pct">' + s.percent + '</div></div>';
      });
      html += '</div>';
    }
    if (qiBing.length > 0) {
      html += '<div class="gs-score-cat"><span class="gs-score-cat-label">奇兵盘口</span></div>';
      html += '<div class="gs-score-grid">';
      qiBing.forEach(function(s) {
        html += '<div class="gs-score-card"><div class="gs-score-val">' + s.score + '</div><div class="gs-score-pct">' + s.percent + '</div></div>';
      });
      html += '</div>';
    }
    if (fuBing.length > 0) {
      html += '<div class="gs-score-cat"><span class="gs-score-cat-label">伏兵妖谱</span></div>';
      html += '<div class="gs-score-grid">';
      fuBing.forEach(function(s) {
        html += '<div class="gs-score-card"><div class="gs-score-val">' + s.score + '</div><div class="gs-score-pct">' + s.percent + '</div></div>';
      });
      html += '</div>';
    }

    html += '</div>';

    html += '</div>'; // ai-content
    modal.innerHTML = html;

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

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
  modal.innerHTML = '<div class="ai-modal-header"><span class="ai-modal-title">⚔️ 功守道量化</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>' +
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
    html += '<div class="ai-modal-header"><span class="ai-modal-title">⚔️ 功守道量化</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>';
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
    html += '<div class="gs-modal-sec-title"><span class="gs-icon">📊</span>实力分析</div>';

    html += gsRow('进攻优势', renderBar(gs.attackAdvantage || '+20%', gs.attackAdvantageValue || 60));
    html += gsRow('防守优势', renderBar(gs.defenseAdvantage || '-10%', gs.defenseAdvantageValue || 40, true));
    html += gsRow('攻守格局', '<span class="gs-val-text">' + (gs.attackPattern || '对攻为主') + '</span>');
    html += gsRow('进攻权重', '<span class="gs-vs">' + (gs.attackWeightHome || '30%') + ' <i>vs</i> ' + (gs.attackWeightAway || '50%') + '</span>');
    html += gsRow('防守权重', '<span class="gs-vs">' + (gs.defenseWeightHome || '40%') + ' <i>vs</i> ' + (gs.defenseWeightAway || '60%') + '</span>');
    html += gsRow('综合攻守优势', renderBar(gs.totalAdvantage || '+50%', gs.totalAdvantageValue || 75));

    html += '</div>';

    // ====== 大小球分析 ======
    html += '<div class="gs-modal-section">';
    html += '<div class="gs-modal-sec-title"><span class="gs-icon">📈</span>大小球分析</div>';

    html += gsRow('主客权重', '<span class="gs-vs">' + (gs.homeWeight || '30%') + ' <i>vs</i> ' + (gs.awayWeight || '50%') + '</span>');
    html += gsRow('得失球', '<span class="gs-vs">' + (gs.goalDiffHome || '30%') + ' <i>vs</i> ' + (gs.goalDiffAway || '50%') + '</span>');
    html += gsRow('总进球期望', renderBar(gs.totalGoalsExpect || '5.1', gs.totalGoalsValue || 70, false));

    html += '</div>';

    // ====== 净胜球分析 ======
    html += '<div class="gs-modal-section">';
    html += '<div class="gs-modal-sec-title"><span class="gs-icon">📊</span>净胜球分析</div>';

    html += gsRow('主队赢球期望', renderBar(gs.homeWinExpect || '+5.1', gs.homeWinValue || 40));
    html += gsRow('综合攻守优势', renderBar(gs.totalAdvantage2 || '+50%', gs.totalAdvantage2Value || 60));
    html += gsRow('输赢球个数', renderBar(gs.goalCount || '≥2', gs.goalCountValue || 50, false));
    html += gsRow('主客赛果验证', renderBar(gs.verifyResult || '2', gs.verifyValue || 40, false));

    html += '</div>';

    // ====== 比分 ======
    html += '<div class="gs-modal-section">';
    html += '<div class="gs-modal-sec-title"><span class="gs-icon">⚽</span>比分</div>';
    html += '<div class="gs-score-grid">';
    var scores = gs.scores || [
      { score: '1-1', percent: '50%' },
      { score: '2-1', percent: '30%' },
      { score: '0-1', percent: '30%' }
    ];
    scores.forEach(function(s) {
      html += '<div class="gs-score-card"><div class="gs-score-val">' + s.score + '</div><div class="gs-score-pct">' + s.percent + '</div></div>';
    });
    html += '</div></div>';

    html += '</div>'; // ai-content
    modal.innerHTML = html;

  }).catch(function(e) {
    modal.innerHTML = '<div class="ai-modal-header"><span class="ai-modal-title">⚔️ 功守道量化</span><button class="ai-modal-close" onclick="closeAI()">&times;</button></div>' +
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

function esc(s) {
  var str = (s == null ? '' : String(s));
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 攻守道详情页 - 严格按设计图实现
 */
import { api } from '../api.js';
import * as state from '../state.js';

export function showGongshoudao(matchId, leagueName, homeName, visitName, matchNum, startTime) {
  state.setLastPage(state.currentPage || 'home');
  state.setDetailMatchId(matchId);

  var el = document.getElementById('detailContent');
  if (!el) return;
  
  // 显示loading
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';
  window.switchTab('detail');

  api('gongshoudao', { matchId: matchId }).then(function(data) {
    var gs = data || {};
    
    // 格式化时间
    var timeStr = startTime || '';
    var timeFormatted = '';
    if (timeStr) {
      var parts = timeStr.split(' ');
      if (parts.length >= 2) {
        var datePart = parts[0].slice(5).replace('-', '/');
        var timePart = parts[1].slice(0, 5);
        timeFormatted = datePart + ' ' + timePart;
      }
    }

    var html = '';
    
    // ====== 头部信息卡片 ======
    html += '<div class="gs-header-card">';
    html += '<div class="gs-header-top">';
    html += '<span class="gs-league">' + esc(leagueName) + '</span>';
    html += '<span class="gs-teams-center">' + esc(homeName) + ' <span class="gs-vs-text">vs</span> ' + esc(visitName) + '</span>';
    html += '<span class="gs-match-num">' + esc(matchNum) + '</span>';
    html += '</div>';
    html += '<div class="gs-header-time">' + timeFormatted + '</div>';
    html += '</div>';

    // ====== 实力分析 ======
    html += '<div class="gs-section">';
    html += '<div class="gs-section-title"><span class="gs-icon">📊</span>实力分析</div>';
    
    // 进攻优势
    html += renderProgressRow('进攻优势', gs.attackAdvantage || '+20%', gs.attackAdvantageValue || 60);
    // 防守优势
    html += renderProgressRow('防守优势', gs.defenseAdvantage || '-10%', gs.defenseAdvantageValue || 40);
    // 攻守格局（纯文本）
    html += renderTextRow('攻守格局', gs.attackPattern || '对攻为主', 'right');
    // 进攻权重
    html += renderCompareRow('进攻权重', gs.attackWeightHome || '30%', gs.attackWeightAway || '50%');
    // 防守权重
    html += renderCompareRow('防守权重', gs.defenseWeightHome || '40%', gs.defenseWeightAway || '60%');
    // 综合攻守优势
    html += renderProgressRow('综合攻守优势', gs.totalAdvantage || '+50%', gs.totalAdvantageValue || 75);
    
    html += '</div>';

    // ====== 大小球分析 ======
    html += '<div class="gs-section">';
    html += '<div class="gs-section-title"><span class="gs-icon">📈</span>大小球分析</div>';
    
    // 主客权重
    html += renderCompareRow('主客权重', gs.homeWeight || '30%', gs.awayWeight || '50%');
    // 得失球
    html += renderCompareRow('得失球', gs.goalDiffHome || '30%', gs.goalDiffAway || '50%');
    // 总进球期望
    html += renderProgressRow('总进球期望', gs.totalGoalsExpect || '5.1', gs.totalGoalsValue || 70, false);
    
    html += '</div>';

    // ====== 净胜球分析 ======
    html += '<div class="gs-section">';
    html += '<div class="gs-section-title"><span class="gs-icon">📊</span>净胜球分析</div>';
    
    // 主队赢球期望
    html += renderProgressRow('主队赢球期望', gs.homeWinExpect || '+5.1', gs.homeWinValue || 40);
    // 综合攻守优势
    html += renderProgressRow('综合攻守优势', gs.totalAdvantage2 || '+50%', gs.totalAdvantage2Value || 60);
    // 输赢球个数
    html += renderProgressRow('输赢球个数', gs.goalCount || '≥2', gs.goalCountValue || 50, false);
    // 主客赛果验证
    html += renderProgressRow('主客赛果验证', gs.verifyResult || '2', gs.verifyValue || 40, false);
    
    html += '</div>';

    // ====== 比分 ======
    html += '<div class="gs-section">';
    html += '<div class="gs-section-title"><span class="gs-icon">⚽</span>比分</div>';
    html += '<div class="gs-score-grid">';
    var scores = gs.scores || [
      { score: '1-1', percent: '50%' },
      { score: '2-1', percent: '30%' },
      { score: '0-1', percent: '30%' }
    ];
    scores.forEach(function(s) {
      html += '<div class="gs-score-item">';
      html += '<div class="gs-score-value">' + s.score + '</div>';
      html += '<div class="gs-score-percent">' + s.percent + '</div>';
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';

    el.innerHTML = html;

  }).catch(function(e) {
    el.innerHTML = '<div class="loading">加载失败: ' + (e.message || '未知错误') + '</div>';
  });
}

// 渲染带进度条的行
function renderProgressRow(label, value, percent, showPercentBar) {
  if (showPercentBar === undefined) showPercentBar = true;
  var percentNum = parseInt(percent) || 0;
  // 处理负值显示
  var isNegative = String(value).startsWith('-');
  var displayValue = isNegative ? value : (showPercentBar && String(value).startsWith('+') ? value : (String(value).includes('%') ? value : '+' + value));
  
  var html = '<div class="gs-row">';
  html += '<div class="gs-label">' + label + '</div>';
  html += '<div class="gs-progress-wrap">';
  html += '<div class="gs-progress-bar">';
  html += '<div class="gs-progress-fill" style="width:' + percentNum + '%' + (isNegative ? ';background:var(--red)' : '') + '"></div>';
  html += '</div>';
  html += '</div>';
  html += '<div class="gs-value' + (isNegative ? ' negative' : '') + '">' + displayValue + '</div>';
  html += '</div>';
  return html;
}

// 渲染对比行（30% vs 50%）
function renderCompareRow(label, homeVal, awayVal) {
  var html = '<div class="gs-row">';
  html += '<div class="gs-label">' + label + '</div>';
  html += '<div class="gs-compare-wrap">';
  html += '<span class="gs-compare-home">' + homeVal + '</span>';
  html += '<span class="gs-compare-vs">vs</span>';
  html += '<span class="gs-compare-away">' + awayVal + '</span>';
  html += '</div>';
  html += '</div>';
  return html;
}

// 渲染纯文本行
function renderTextRow(label, value, align) {
  var html = '<div class="gs-row">';
  html += '<div class="gs-label">' + label + '</div>';
  html += '<div class="gs-text-wrap' + (align === 'right' ? ' right' : '') + '">';
  html += '<span class="gs-text-value">' + value + '</span>';
  html += '</div>';
  html += '</div>';
  return html;
}

function esc(s) {
  var str = (s == null ? '' : String(s));
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

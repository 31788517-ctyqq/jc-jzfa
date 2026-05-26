/**
 * 攻守道量化 — 球队攻防数据对比详情页
 */
import { api } from '../api.js';
import * as state from '../state.js';

export function showGongshoudao(matchId, homeName, visitName) {
  state.setLastPage(state.currentPage || 'home');
  state.setDetailMatchId(matchId);

  var el = document.getElementById('detailContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';
  window.switchTab('detail');

  api('gongshoudao', { matchId: matchId }).then(function(data) {
    var gs = data || {};
    var homeData = gs.home || {};
    var awayData = gs.away || {};
    var head2head = gs.head2head || {};
    var odds = gs.odds || {};

    function esc(s) { var str = (s == null ? '' : String(s)); return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function fmtNum(n, unit) { return (n != null ? n : '-') + (unit || ''); }

    var html = '';
    // ── 头部 ──
    html += '<div class="gs-header">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
    html += '<span style="font-size:18px;font-weight:700;color:var(--cyan);">⚔️ 攻守道量化</span>';
    html += '<span style="font-size:12px;color:var(--text3);">数据来源于历史比赛统计</span>';
    html += '</div>';
    html += '</div>';

    // ── 对战双方 ──
    html += '<div class="gs-teams">';
    html += '<div class="gs-team-card home"><div class="gs-team-badge">主</div><div class="gs-team-name">' + esc(homeName) + '</div></div>';
    html += '<div class="gs-vs">VS</div>';
    html += '<div class="gs-team-card away"><div class="gs-team-badge away">客</div><div class="gs-team-name">' + esc(visitName) + '</div></div>';
    html += '</div>';

    // ── 核心数据面板（六宫格） ──
    html += '<div class="gs-section"><div class="gs-section-title">📊 核心数据对比</div>';
    html += '<div class="gs-grid-2x3">';

    function dataCell(label, homeVal, awayVal, homeExtra, awayExtra) {
      var h = '<span class="gs-val">' + fmtNum(homeVal) + '</span>' + (homeExtra ? '<span class="gs-sub">' + homeExtra + '</span>' : '');
      var a = '<span class="gs-val">' + fmtNum(awayVal) + '</span>' + (awayExtra ? '<span class="gs-sub">' + awayExtra + '</span>' : '');
      return '<div class="gs-data-cell">' +
        '<div class="gs-cell-label">' + label + '</div>' +
        '<div class="gs-cell-row"><div class="gs-cell-item">' + h + '</div><div class="gs-cell-item">' + a + '</div></div>' +
        '</div>';
    }
    html += dataCell('近期胜率', homeData.winRate, awayData.winRate, homeData.winRateLabel, awayData.winRateLabel);
    html += dataCell('场均进球', homeData.avgGoal, awayData.avgGoal, '', '');
    html += dataCell('场均失球', homeData.avgConcede, awayData.avgConcede, '', '');
    html += dataCell('大球率', homeData.overRate, awayData.overRate, '', '');
    html += dataCell('赢盘率', homeData.handicapWinRate, awayData.handicapWinRate, '', '');
    html += dataCell('交锋优势', head2head.homeWin || '-', head2head.awayWin || '-',
      head2head.homeLabel || '', head2head.awayLabel || '');

    html += '</div></div>';

    // ── 近况与成绩 ──
    if ((homeData.recentForm && homeData.recentForm.length) || (awayData.recentForm && awayData.recentForm.length)) {
      html += '<div class="gs-section"><div class="gs-section-title">📈 近期战绩</div>';
      html += '<div class="gs-form-row"><span class="gs-form-team">' + esc(homeName) + '</span>';
      (homeData.recentForm || []).forEach(function(r) {
        var cls = r === 'W' || r === '胜' ? 'win' : r === 'L' || r === '负' ? 'lose' : r === 'D' || r === '平' ? 'draw' : 'normal';
        html += '<span class="gs-form-badge ' + cls + '">' + esc(r) + '</span>';
      });
      html += '</div>';
      html += '<div class="gs-form-row"><span class="gs-form-team">' + esc(visitName) + '</span>';
      (awayData.recentForm || []).forEach(function(r) {
        var cls = r === 'W' || r === '胜' ? 'win' : r === 'L' || r === '负' ? 'lose' : r === 'D' || r === '平' ? 'draw' : 'normal';
        html += '<span class="gs-form-badge ' + cls + '">' + esc(r) + '</span>';
      });
      html += '</div></div>';
    }

    // ── 攻防雷达（文字版） ──
    html += '<div class="gs-section"><div class="gs-section-title">🎯 攻防对比</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    ['进攻', '防守', '控球', '射门转化'].forEach(function(dim) {
      html += '<div class="gs-compare-bar">';
      html += '<div class="gs-compare-label">' + dim + '</div>';
      html += '<div class="gs-compare-row"><div class="gs-compare-fill home" style="width:50%"></div><div class="gs-compare-fill away" style="width:50%"></div></div>';
      html += '<div class="gs-compare-values"><span>' + esc(homeName[0]) + '</span><span>' + esc(visitName[0]) + '</span></div>';
      html += '</div>';
    });
    html += '</div></div>';

    // ── 赔率数据 ──
    if (odds.spf || odds.rqspf) {
      html += '<div class="gs-section"><div class="gs-section-title">💰 赔率数据</div>';
      html += '<div class="gs-odds-table">';
      if (odds.spf) {
        html += '<div class="gs-odds-row"><span>胜平负</span><span style="color:#EF4444">' + fmtNum(odds.spf.home) + '</span><span style="color:#22C55E">' + fmtNum(odds.spf.draw) + '</span><span style="color:#3B82F6">' + fmtNum(odds.spf.away) + '</span></div>';
      }
      if (odds.rqspf) {
        html += '<div class="gs-odds-row"><span>让球(' + (odds.rqspf.handicap || '-') + ')</span><span style="color:#EF4444">' + fmtNum(odds.rqspf.home) + '</span><span style="color:#22C55E">' + fmtNum(odds.rqspf.draw) + '</span><span style="color:#3B82F6">' + fmtNum(odds.rqspf.away) + '</span></div>';
      }
      html += '</div></div>';
    }

    // ── 综合建议 ──
    var suggestion = gs.suggestion || '';
    if (suggestion) {
      html += '<div class="gs-section"><div class="gs-section-title">💡 综合建议</div>';
      html += '<div class="gs-suggestion">' + esc(suggestion) + '</div></div>';
    }

    html += '<div class="gs-disclaimer">数据仅供参考，请理性对待</div>';
    el.innerHTML = html;

  }).catch(function(e) {
    el.innerHTML = '<div class="loading">加载失败: ' + (e.message || '未知错误') + '</div>';
  });
}

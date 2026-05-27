import { api } from '../api.js';

var quantDate = '';
var quantDateOffset = 0;

export function updateQuantDateBar() {
  var d = new Date();
  d.setDate(d.getDate() + quantDateOffset);
  quantDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  var el = document.getElementById('quantDateCurrent');
  if (!el) return;
  var weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var week = weekNames[d.getDay()];
  var mmdd = String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
  var today = new Date().toDateString() === d.toDateString();
  var prefix = today ? '今天 ' : '';
  el.textContent = prefix + mmdd + ' ' + week;
}

export function shiftQuantDate(delta) {
  var newOffset = quantDateOffset + delta;
  var d = new Date();
  d.setDate(d.getDate() + newOffset);
  quantDateOffset = newOffset;
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
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  el.style.display = 'block';
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getAttackPatternLabel(pattern) {
  var map = {
    '对攻为主': '⚔️ 对攻',
    '防守为主': '🛡️ 防守',
    '攻守平衡': '⚖️ 均衡'
  };
  return map[pattern] || pattern || '';
}

function getAdvantageClass(val) {
  if (val >= 70) return '';
  if (val >= 50) return 'amber';
  return 'red';
}

export function loadQuantRank() {
  var el = document.getElementById('quantList');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  var params = {};
  if (quantDate) params.date = quantDate;

  // 并行获取 ranking-list + 所有匹配的功守道数据
  api('ranking-list', params).then(function (rankData) {
    var ranking = rankData.ranking || [];
    if (ranking.length === 0) {
      el.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text3)">暂无数据</div>';
      updateStats(0, 0, 0);
      return;
    }

    // 批量获取功守道数据
    var gsPromises = ranking.map(function (item) {
      return api('gongshoudao', { matchId: item.matchId }).catch(function () { return null; });
    });

    Promise.all(gsPromises).then(function (gsResults) {
      var taggedCount = 0;
      var totalAdvantageSum = 0;
      var validCount = 0;

      var rows = ranking.map(function (item, i) {
        var gs = gsResults[i] || {};
        var hasGS = !!(gs.attackPattern);
        if (hasGS) {
          taggedCount++;
          if (typeof gs.totalAdvantageValue === 'number') {
            totalAdvantageSum += gs.totalAdvantageValue;
            validCount++;
          }
        }

        var r = item.rank || (i + 1);
        var rankClass = r === 1 ? 'top1' : r === 2 ? 'top2' : r === 3 ? 'top3' : '';

        // 量化分数条
        var scoreBarClass = '';
        if (hasGS) {
          var advVal = gs.totalAdvantageValue || 50;
          scoreBarClass = getAdvantageClass(advVal);
        }

        // PK按钮 + 量化标签
        var pkBtn = '<div class="quant-pk-btn" onclick="event.stopPropagation();openPK(\'' +
          item.matchId + '\',\'' +
          esc(item.homeName) + '\',\'' +
          esc(item.visitName) + '\',\'' +
          esc(item.leagueName) + '\',\'' +
          esc(item.num || '') + '\')">⚔️ 场次PK</div>';

        var gsTag = hasGS
          ? '<div class="quant-gs-tag">' + getAttackPatternLabel(gs.attackPattern) + '</div>'
          : '';

        var quantScores = '';
        if (hasGS) {
          quantScores = '<div class="quant-scores">' +
            '<div class="quant-score-bar ' + scoreBarClass + '"></div>' +
            '<div class="quant-score-item"><span class="quant-score-label">进攻</span><span class="quant-score-val">' + (gs.attackWeightHome || '50%') + '</span></div>' +
            '<div class="quant-score-item"><span class="quant-score-label">防守</span><span class="quant-score-val">' + (gs.defenseWeightHome || '50%') + '</span></div>' +
            '<div class="quant-score-item"><span class="quant-score-label">总优</span><span class="quant-score-val ' + scoreBarClass + '">' + (gs.totalAdvantage || '-') + '</span></div>' +
            '</div>';
        } else {
          quantScores = '<div style="font-size:11px;color:var(--text3);padding-top:4px;">暂无量化数据</div>';
        }

        return '<div class="quant-card">' +
          '<div class="quant-rank-num ' + rankClass + '">' + (r <= 3 ? '' : r) + '</div>' +
          '<div class="quant-body">' +
            '<div class="quant-match-info">' +
              '<span class="quant-league-tag">' + esc(item.leagueName) + '</span>' +
              '<span class="quant-match-num">' + esc(item.num) + '</span>' +
            '</div>' +
            '<div class="quant-teams">' + esc(item.homeName) + ' vs ' + esc(item.visitName) + '</div>' +
            quantScores +
            gsTag +
          '</div>' +
          pkBtn +
        '</div>';
      }).join('');

      updateStats(ranking.length, taggedCount, validCount > 0 ? Math.round(totalAdvantageSum / validCount) : 0);
      el.innerHTML = rows;
    });
  }).catch(function () {
    el.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text3)">加载失败，请重试</div>';
  });
}

function updateStats(total, tagged, avgScore) {
  var tEl = document.getElementById('quantTotalMatches');
  var gEl = document.getElementById('quantTaggedCount');
  var aEl = document.getElementById('quantAvgScore');
  if (tEl) tEl.textContent = total;
  if (gEl) gEl.textContent = tagged;
  if (aEl) aEl.textContent = avgScore + '分';
}

// ==================== 我的方案列表页 ====================
import { api } from '../api.js';
import { WEEK_NAMES, formatDateCN } from '../utils.js';

var _plans = [];
var _stats = {};

// ═══ 页面入口 ═══
export function loadMyPlan() {
  var el = document.getElementById('myPlanContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载方案中...</div>';
  api('my-plan-list', {}).then(function (data) {
    _plans = (data && data.plans) || [];
    _stats = (data && data.stats) || {};
    renderMyPlanList();
  }).catch(function (e) {
    if (el) el.innerHTML = '<div class="hint-box">加载失败: ' + (e && e.message) + '</div>';
  });
}

// ═══ 刷新统计和列表 ═══
export function refreshMyPlan() {
  loadMyPlan();
}

// ═══ 渲染方案列表（复用 plan-card 样式） ═══
function renderMyPlanList() {
  var el = document.getElementById('myPlanContent');
  if (!el) return;

  if (_plans.length === 0) {
    el.innerHTML =
      '<div class="plan-notice">' +
      '<span class="notice-icon">&#x1F375;</span>' +
      '稍稍等，马上就来' +
      '</div>';
    return;
  }

  var html = '';
  _plans.forEach(function (p, idx) {
    var matches = p.matches || [];
    var isWon = p.isWon === true;
    var isLose = p.isWon === false;
    var statusText = isWon ? '已中奖' : isLose ? '未中奖' : '未开奖';
    var statusCls = isWon ? 'plan-win' : isLose ? 'plan-lose' : 'plan-pending';
    var amountVal = (p.amount || 200).toFixed(0);
    var prizeVal = isWon ? (p.resultIncome != null ? '+' + p.resultIncome : '--')
      : (isLose ? '-' + amountVal : (function () {
          var totalOdds = Number(p.totalOdds) || 0;
          var amt = Number(p.amount) || 0;
          if (totalOdds > 0 && amt > 0) return Math.round(totalOdds * amt * 100) / 100;
          return '--';
        })());
    var totalOdds = p.totalOdds || (matches.reduce(function (pr, m) { return pr * (Number(m.odds) || 1); }, 1)).toFixed(2);
    var dateStr = (p.date || '').slice(5).replace('-', '/');
    var createdAt = p.createdAt ? p.createdAt.slice(0, 16).replace('T', ' ') : '';
    var note = p.note || '';
    var planName = note ? note : '我的方案 #' + (idx + 1);

    html += '<div class="plan-card user-plan-card" id="upcard-' + p.id + '">' +
      // 头部
      '<div class="plan-card-head">' +
      '<div class="plan-left">' +
      '<div class="plan-soccer-icon">⚽</div>' +
      '<div><div class="plan-name">' + planName + '</div>' +
      '<div class="plan-pub-time">' + dateStr + ' ' + createdAt + '</div></div>' +
      '</div>' +
      '</div>' +
      // 数据行
      '<div class="plan-amount-row">' +
      '<div class="plan-amount-col"><div class="plan-amount-label">方案金额</div><div class="plan-amount-value">' + amountVal + '<span class="unit">分</span></div></div>' +
      '<div class="plan-amount-col"><div class="plan-amount-label">组合赔率</div><div class="plan-amount-value">' + totalOdds + '</div></div>' +
      '<div class="plan-amount-col"><div class="plan-amount-label">' + (isWon ? '盈利' : '结果') + '</div><div class="plan-amount-value ' + (isWon ? 'plan-win-amount' : isLose ? 'plan-lose-amount' : '') + '">' + prizeVal + '</div></div>' +
      '</div>' +
      // 分割线
      '<div class="plan-divider"></div>' +
      // 比赛表格
      renderPlanMatchesTable(matches) +
      // 操作栏
      '<div class="mp-actions">' +
      '<button class="mp-delete-btn" onclick="deleteUserPlan(\'' + p.id + '\')">🗑 删除</button>' +
      '<button class="mp-share-btn" onclick="shareUserPlan(\'' + p.id + '\')">📤 分享</button>' +
      '</div>' +
      '</div>';
  });

  el.innerHTML = html;
}

// ═══ 方案比赛表格（复用 plan-match-table 样式） ═══
function renderPlanMatchesTable(matches) {
  if (!matches || matches.length === 0) return '';
  var rows = matches.map(function (m) {
    var oddsStr = m.odds != null ? String(m.odds) : '--';
    var dirDisplay = m.direction || m.oddsName || '';
    if (m.playType === 'rqspf') dirDisplay = '让' + dirDisplay;
    var playTypeMap = { 'spf': '胜平负', 'rqspf': '让球', 'jqs': '总进球', 'bqc': '半全场' };
    var playLabel = playTypeMap[m.playType] || m.playType || '--';
    return '<tr>' +
      '<td class="match-info-col"><span class="match-num-text">' + (m.matchNum || '') + '</span></td>' +
      '<td class="team-col"><span class="plan-team-home">' + (m.homeName || '') + '</span><span class="plan-team-vs">vs</span><span class="plan-team-away">' + (m.visitName || '') + '</span></td>' +
      '<td class="odds-col">' + playLabel + ' ' + dirDisplay + ' @' + oddsStr + '</td>' +
      '</tr>';
  }).join('');

  return '<div class="plan-match-section">' +
    '<table class="plan-match-table"><tbody>' + rows + '</tbody></table></div>';
}

// ═══ 删除方案 ═══
window.deleteUserPlan = function (planId) {
  if (!confirm('确定删除这个方案吗？')) return;
  api('my-plan-delete', { planId: planId }).then(function () {
    // 重新加载列表
    loadMyPlan();
  }).catch(function (e) {
    alert('删除失败: ' + e.message);
  });
};

// ═══ 分享方案（截图） ═══
window.shareUserPlan = function (planId) {
  var card = document.getElementById('upcard-' + planId);
  if (!card) { alert('方案卡片未找到'); return; }

  // 动态加载 html2canvas
  var loadHtml2Canvas = window.html2canvas
    ? Promise.resolve(window.html2canvas)
    : new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        script.onload = function () { resolve(window.html2canvas); };
        script.onerror = function () { reject(new Error('html2canvas 加载失败')); };
        document.head.appendChild(script);
      });

  loadHtml2Canvas.then(function (html2canvas) {
    // 截图前隐藏操作按钮
    var actions = card.querySelector('.mp-actions');
    if (actions) actions.style.display = 'none';

    html2canvas(card, {
      backgroundColor: '#0e1822',
      scale: 2,
      useCORS: true,
      allowTaint: true,
      onclone: function (clonedDoc) {
        var clonedActions = clonedDoc.querySelector('.mp-actions');
        if (clonedActions) clonedActions.style.display = 'none';
      },
    }).then(function (canvas) {
      // 恢复操作按钮
      if (actions) actions.style.display = '';

      // 尝试 Web Share API 或降级下载
      canvas.toBlob(function (blob) {
        if (!blob) return;
        var file = new File([blob], 'plan-' + planId + '.png', { type: 'image/png' });

        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({
            title: '竞彩方案分享',
            text: '来自竞彩推荐监控的自定义方案',
            files: [file],
          }).catch(function (e) {
            // 用户取消或微信不支持 files 时降级
            downloadImage(canvas, planId);
          });
        } else {
          downloadImage(canvas, planId);
        }
      }, 'image/png');
    }).catch(function (e) {
      if (actions) actions.style.display = '';
      alert('截图失败: ' + e.message);
    });
  }).catch(function (e) {
    alert('分享组件加载失败: ' + e.message);
  });
};

function downloadImage(canvas, planId) {
  var link = document.createElement('a');
  link.download = 'plan-' + planId + '.png';
  link.href = canvas.toDataURL('image/png');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

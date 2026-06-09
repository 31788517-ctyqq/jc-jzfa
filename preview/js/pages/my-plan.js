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
  api('my-plan-list', {})
    .then(function (data) {
      _plans = (data && data.plans) || [];
      _stats = (data && data.stats) || {};
      renderMyPlanList();
    })
    .catch(function (e) {
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
      '<div class="plan-notice">' + '<span class="notice-icon">&#x1F375;</span>' + '稍稍等，马上就来' + '</div>';
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
    var prizeVal = isWon
      ? p.resultIncome != null
        ? '+' + p.resultIncome
        : '--'
      : isLose
        ? '0'
        : (function () {
            var totalOdds = Number(p.totalOdds) || 0;
            var amt = Number(p.amount) || 0;
            if (totalOdds > 0 && amt > 0) return Math.round(totalOdds * amt * 100) / 100;
            return '--';
          })();
    var totalOdds =
      p.totalOdds ||
      matches
        .reduce(function (pr, m) {
          return pr * (Number(m.odds) || 1);
        }, 1)
        .toFixed(2);
    var dateStr = (p.date || '').slice(5).replace('-', '/');
    var createdAt = p.createdAt ? p.createdAt.slice(0, 16).replace('T', ' ') : '';
    var note = p.note || '';
    var planName = note ? note : '我的方案 #' + (idx + 1);

    html +=
      '<div class="plan-card user-plan-card" id="upcard-' +
      p.id +
      '">' +
      // 头部
      '<div class="plan-card-head">' +
      '<div class="plan-left">' +
      '<div class="plan-soccer-icon">⚽</div>' +
      '<div><div class="plan-name">' +
      planName +
      '</div>' +
      '<div class="plan-pub-time">' +
      dateStr +
      ' ' +
      createdAt +
      '</div></div>' +
      '</div>' +
      '</div>' +
      // 数据行
      '<div class="plan-amount-row">' +
      '<div class="plan-amount-col"><div class="plan-amount-label">方案金额</div><div class="plan-amount-value">' +
      amountVal +
      '<span class="unit">分</span></div></div>' +
      '<div class="plan-amount-col"><div class="plan-amount-label">组合赔率</div><div class="plan-amount-value">' +
      totalOdds +
      '</div></div>' +
      '<div class="plan-amount-col"><div class="plan-amount-label">' +
      (isWon ? '盈利' : '结果') +
      '</div><div class="plan-amount-value ' +
      (isWon ? 'plan-win-amount' : isLose ? 'plan-lose-amount' : '') +
      '">' +
      prizeVal +
      '</div></div>' +
      '</div>' +
      // 分割线
      '<div class="plan-divider"></div>' +
      // 比赛表格
      renderPlanMatchesTable(matches) +
      // 操作栏
      '<div class="mp-actions">' +
      '<button class="mp-delete-btn" onclick="deleteUserPlan(\'' +
      p.id +
      '\')">🗑 删除</button>' +
      '<button class="mp-share-btn" onclick="shareUserPlan(\'' +
      p.id +
      '\')">📤 分享</button>' +
      '</div>' +
      '</div>';
  });

  el.innerHTML = html;
}

// ═══ 方案比赛表格（复用 plan-match-table 样式） ═══
function renderPlanMatchesTable(matches) {
  if (!matches || matches.length === 0) return '';
  var rows = matches
    .map(function (m) {
      var oddsStr = m.odds != null ? String(m.odds) : '--';
      var dirDisplay = m.direction || m.oddsName || '';
      if (m.playType === 'rqspf') dirDisplay = '让' + dirDisplay;
      var playTypeMap = { spf: '胜平负', rqspf: '让球', jqs: '总进球', bqc: '半全场' };
      var playLabel = playTypeMap[m.playType] || m.playType || '--';
      // 赔率颜色：未中奖绿色 / 中奖红色 / 未开奖白色
      var oddsColor = '#ffffff';
      if (m.isMatchWon === true) oddsColor = '#EF4444';
      else if (m.isMatchLose === true) oddsColor = '#22C55E';
      return (
        '<tr>' +
        '<td class="match-info-col"><span class="match-num-text">' +
        (m.matchNum || '') +
        '</span></td>' +
        '<td class="team-col"><span class="plan-team-home">' +
        (m.homeName || '') +
        '</span><span class="plan-team-vs">vs</span><span class="plan-team-away">' +
        (m.visitName || '') +
        '</span></td>' +
        '<td class="odds-col" style="color:' +
        oddsColor +
        '">' +
        playLabel +
        ' ' +
        dirDisplay +
        ' @' +
        oddsStr +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  return (
    '<div class="plan-match-section">' + '<table class="plan-match-table"><tbody>' + rows + '</tbody></table></div>'
  );
}

// ═══ 自定义确认弹窗工厂 ═══
function _confirmDelete(planId, planName, onSuccess) {
  var overlay = document.createElement('div');
  overlay.className = 'del-overlay active';
  overlay.innerHTML =
    '<div class="del-modal">' +
    '<div class="del-modal-head">' +
    '<span class="del-modal-icon">&#x26A0;&#xFE0F;</span>' +
    '<span class="del-modal-title">确认删除</span>' +
    '</div>' +
    '<div class="del-modal-body">' +
    '<p>' +
    (planName ? '确定删除方案「' + planName + '」吗？' : '确定删除这个方案吗？') +
    '</p>' +
    '<p class="del-modal-sub">删除后无法恢复</p>' +
    '</div>' +
    '<div class="del-modal-foot">' +
    '<button class="del-btn-cancel">取消</button>' +
    '<button class="del-btn-confirm">确认删除</button>' +
    '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var close = function () {
    overlay.classList.remove('active');
    setTimeout(function () {
      overlay.remove();
    }, 300);
  };
  overlay.querySelector('.del-btn-cancel').onclick = close;
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close();
  });

  var confirmBtn = overlay.querySelector('.del-btn-confirm');
  confirmBtn.onclick = function () {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '删除中...';
    api('my-plan-delete', { planId: planId })
      .then(function () {
        close();
        onSuccess();
      })
      .catch(function (e) {
        var body = overlay.querySelector('.del-modal-body');
        var errEl = body.querySelector('.del-err');
        if (!errEl) {
          errEl = document.createElement('p');
          errEl.className = 'del-err';
          body.appendChild(errEl);
        }
        errEl.textContent = '删除失败: ' + (e && e.message);
        setTimeout(function () {
          confirmBtn.disabled = false;
          confirmBtn.textContent = '确认删除';
        }, 2500);
      });
  };
}

// ═══ 删除方案 ═══
window.deleteUserPlan = function (planId) {
  var card = document.getElementById('upcard-' + planId);
  var nameEl = card ? card.querySelector('.plan-name') : null;
  var planName = nameEl ? nameEl.textContent.trim() : '';
  _confirmDelete(planId, planName, function () {
    loadMyPlan();
  });
};

// ═══ 分享方案（截图） ═══
window.shareUserPlan = function (planId) {
  var card = document.getElementById('upcard-' + planId);
  if (!card) {
    _toast('方案卡片未找到', 'err');
    return;
  }

  var loadHtml2Canvas = window.html2canvas
    ? Promise.resolve(window.html2canvas)
    : new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        script.onload = function () {
          resolve(window.html2canvas);
        };
        script.onerror = function () {
          reject(new Error('html2canvas 加载失败'));
        };
        document.head.appendChild(script);
      });

  _toast('正在生成分享图片...', 'info');

  loadHtml2Canvas
    .then(function (html2canvas) {
      var shareEl = _buildShareCard(card);
      document.body.appendChild(shareEl);

      setTimeout(function () {
        html2canvas(shareEl, {
          scale: 1,
          useCORS: true,
          allowTaint: true,
          backgroundColor: null,
        })
          .then(function (canvas) {
            shareEl.remove();
            _showShareModal(planId, canvas, card);
          })
          .catch(function (e) {
            shareEl.remove();
            _toast('截图失败: ' + e.message, 'err');
          });
      }, 200);
    })
    .catch(function (e) {
      _toast('分享组件加载失败: ' + e.message, 'err');
    });
};

// ═══ 构建 750px 高品质分享卡片 DOM ═══
function _buildShareCard(cardEl) {
  var name = '';
  var nameEl = cardEl.querySelector('.plan-name');
  if (nameEl) name = nameEl.textContent.trim();

  var date = '';
  var dateEl = cardEl.querySelector('.plan-pub-time');
  if (dateEl) {
    date = dateEl.textContent.trim();
    var dm = date.match(/(\d{2}\/\d{2})/);
    if (dm) date = dm[1];
  }

  var amountCols = cardEl.querySelectorAll('.plan-amount-col');
  var amountLabel = '',
    amountValue = '';
  var prizeLabel = '',
    prizeValue = '';
  var statusText = '未开奖';

  if (amountCols.length >= 1) {
    var al = amountCols[0].querySelector('.plan-amount-label');
    var av = amountCols[0].querySelector('.plan-amount-value');
    amountLabel = al ? al.textContent.trim() : '';
    amountValue = av ? av.textContent.trim().replace(/\s+/g, '') : '';
  }
  if (amountCols.length >= 2) {
    var pl = amountCols[1].querySelector('.plan-amount-label');
    var pv = amountCols[1].querySelector('.plan-amount-value');
    prizeLabel = pl ? pl.textContent.trim() : '';
    prizeValue = pv ? pv.textContent.trim().replace(/\s+/g, '') : '';
  }
  if (amountCols.length >= 3) {
    var sv = amountCols[2].querySelector('.plan-amount-value');
    if (sv) statusText = sv.textContent.trim();
  }

  // my-plan 的 info 布局与 plans 不同（info-left / info-right）
  var infoLefts = cardEl.querySelectorAll('.plan-info-left > div');
  var infoRights = cardEl.querySelectorAll('.plan-info-right > div');
  var playType = '',
    passType = '',
    betCount = '';
  if (infoLefts.length >= 3 && infoRights.length >= 3) {
    var leftTexts = [];
    infoLefts.forEach(function (d) {
      leftTexts.push(d.textContent.trim());
    });
    var rightTexts = [];
    infoRights.forEach(function (d) {
      rightTexts.push(d.textContent.trim());
    });
    // 匹配标签到值
    for (var i = 0; i < leftTexts.length; i++) {
      if (leftTexts[i].indexOf('玩法') >= 0 || leftTexts[i].indexOf('混合') >= 0) {
        playType = rightTexts[i] || rightTexts[0] || '混合投注';
      }
      if (leftTexts[i].indexOf('过关') >= 0 || leftTexts[i].indexOf('场数') >= 0) {
        passType = rightTexts[i] || rightTexts[1] || '--';
      }
      if (leftTexts[i].indexOf('注') >= 0 || leftTexts[i].indexOf('倍数') >= 0) {
        betCount = rightTexts[i] || rightTexts[2] || '--';
      }
    }
    if (!playType && rightTexts[0]) playType = rightTexts[0];
    if (!passType && rightTexts[1]) passType = rightTexts[1];
    if (!betCount && rightTexts[2]) betCount = rightTexts[2];
  }

  var matchRowsEl = cardEl.querySelectorAll('.plan-match-table tbody tr');
  var matchRows = '';
  matchRowsEl.forEach(function (row) {
    var cells = row.querySelectorAll('td');
    if (cells.length < 3) return;
    var numEl = cells[0].querySelector('.match-num-text');
    var timeEl = cells[0].querySelector('.match-time-sub');
    var num = numEl ? numEl.textContent.trim() : '';
    var matchTime = timeEl ? timeEl.textContent.trim() : '';
    var homeEl = cells[1].querySelector('.plan-team-home');
    var awayEl = cells[1].querySelector('.plan-team-away');
    var home = homeEl ? homeEl.textContent.trim() : '';
    var away = awayEl ? awayEl.textContent.trim() : '';
    var odds = cells[2].textContent.trim().replace(/\s+/g, ' ').substring(0, 48);
    matchRows +=
      '<div class="table-row">' +
      '<div class="issue"><div class="issue-num">' +
      num +
      '</div>' +
      (matchTime ? '<div class="issue-time">' + matchTime + '</div>' : '') +
      '</div>' +
      '<div class="vs"><div class="vs-team">' +
      home +
      '</div><span class="vs-mid">VS</span><div class="vs-team">' +
      away +
      '</div></div>' +
      '<div class="bet"><strong>' +
      odds +
      '</strong></div>' +
      '</div>';
  });

  var amtNum = amountValue,
    amtUnit = '分';
  var amtMatch = amountValue.match(/^([\d.]+)(.*)/);
  if (amtMatch) {
    amtNum = amtMatch[1];
    amtUnit = amtMatch[2] || '分';
  }

  var pNum = prizeValue,
    pUnit = '分';
  var pMatch = prizeValue.match(/^([+\-]?[\d.]+)(.*)/);
  if (pMatch) {
    pNum = pMatch[1];
    pUnit = pMatch[2] || '分';
  }

  var shareDate = String(date || '').replace(/\//g, '-');
  var statusCls = 'status-pending';
  if (statusText.indexOf('未中奖') !== -1) statusCls = 'status-lost';
  else if (statusText.indexOf('已中奖') !== -1) statusCls = 'status-won';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:absolute;left:-9999px;top:0;width:750px;';
  wrapper.innerHTML =
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box;}' +
    '.share-card{' +
    'width:750px;min-height:1680px;padding:42px 40px 72px;' +
    'background:radial-gradient(circle at 16% 0%,rgba(10,216,255,.18),transparent 26%),radial-gradient(circle at 88% 18%,rgba(0,120,255,.10),transparent 24%),linear-gradient(180deg,#021b31 0%,#031224 24%,#020c18 100%);' +
    'position:relative;overflow:hidden;color:#fff;' +
    'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;' +
    '}' +
    '.share-card::before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,234,255,.02),transparent 22%,transparent 78%,rgba(0,234,255,.02));pointer-events:none;}' +
    '.share-card::after{content:"";position:absolute;inset:24px;border:1px solid rgba(0,234,255,.12);border-radius:28px;box-shadow:inset 0 0 32px rgba(0,234,255,.06);pointer-events:none;}' +
    '.header{display:flex;justify-content:space-between;align-items:flex-start;position:relative;z-index:1;}' +
    '.header-left{display:flex;align-items:flex-start;gap:16px;}' +
    '.football-icon{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.18);color:#fff;font-size:34px;box-shadow:0 0 18px rgba(0,234,255,.16);}' +
    '.title-block{display:flex;flex-direction:column;gap:10px;}' +
    '.scheme-title{font-size:60px;line-height:1;font-weight:800;color:#fff;letter-spacing:2px;text-shadow:0 0 12px rgba(255,255,255,.08);}' +
    '.title-mark{display:flex;align-items:center;gap:8px;padding-left:2px;}' +
    '.title-mark b{display:block;width:92px;height:5px;border-radius:999px;background:linear-gradient(90deg,#21e8ff,#0fb3ff);box-shadow:0 0 14px rgba(33,232,255,.35);}' +
    '.title-mark i{display:block;width:54px;height:5px;border-radius:999px;background:repeating-linear-gradient(90deg,rgba(33,232,255,.92),rgba(33,232,255,.92) 6px,transparent 6px,transparent 11px);opacity:.92;}' +
    '.scheme-date{padding-top:4px;color:#c6d3de;font-size:28px;font-weight:500;letter-spacing:1px;}' +
    '.stat-panel{margin-top:34px;padding:28px 0 26px;border-top:1px solid rgba(0,234,255,.14);border-bottom:1px solid rgba(0,234,255,.16);display:flex;align-items:stretch;position:relative;z-index:1;}' +
    '.stat-item{flex:1;text-align:center;padding:0 18px;}' +
    '.stat-label{color:#a7b9c8;font-size:24px;line-height:1.2;}' +
    '.stat-value{margin-top:18px;color:#1ee9ff;font-size:58px;font-weight:800;letter-spacing:1px;text-shadow:0 0 14px rgba(30,233,255,.18);}' +
    '.stat-value span{font-size:26px;color:#dbe8f4;margin-left:4px;}' +
    '.stat-status{margin-top:18px;font-size:56px;font-weight:800;letter-spacing:1px;}' +
    '.stat-status.status-pending{color:#ffd126;text-shadow:0 0 12px rgba(255,209,38,.18);}' +
    '.stat-status.status-won{color:#ff9a4e;text-shadow:0 0 12px rgba(255,154,78,.16);}' +
    '.stat-status.status-lost{color:#74e3c8;text-shadow:0 0 12px rgba(116,227,200,.14);}' +
    '.stat-line{width:1px;background:linear-gradient(180deg,transparent,rgba(0,234,255,.38),transparent);}' +
    '.base-info{margin-top:34px;position:relative;z-index:1;}' +
    '.info-row{display:grid;grid-template-columns:50px 170px 1fr;align-items:center;height:96px;border-bottom:1px dashed rgba(0,234,255,.14);}' +
    '.info-row:last-child{border-bottom:none;}' +
    '.info-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(0,234,255,.22);background:rgba(0,234,255,.05);color:#1ee9ff;font-size:22px;box-shadow:inset 0 0 12px rgba(0,234,255,.05);}' +
    '.label{color:#a7b9c8;font-size:28px;}' +
    '.value{color:#1ee9ff;font-size:34px;font-weight:700;letter-spacing:.5px;text-shadow:0 0 12px rgba(30,233,255,.14);}' +
    '.section-header{margin:34px 0 22px;display:flex;align-items:center;justify-content:center;gap:16px;position:relative;z-index:1;}' +
    '.section-line{width:74px;height:5px;border-radius:999px;background:linear-gradient(90deg,transparent,#1ee9ff 24%,#1ee9ff 76%,transparent);position:relative;}' +
    '.section-line::after{content:"";position:absolute;right:8px;top:0;width:24px;height:5px;border-radius:999px;background:repeating-linear-gradient(90deg,rgba(30,233,255,.9),rgba(30,233,255,.9) 5px,transparent 5px,transparent 9px);}' +
    '.section-text{font-size:34px;color:#fff;font-weight:700;letter-spacing:2px;}' +
    '.match-table{border:1px solid rgba(0,234,255,.16);border-radius:22px;background:linear-gradient(180deg,rgba(2,20,36,.72),rgba(1,12,24,.76));box-shadow:inset 0 0 22px rgba(0,234,255,.05);overflow:hidden;position:relative;z-index:1;}' +
    '.table-row{display:grid;grid-template-columns:150px 1fr 244px;min-height:152px;padding:0 8px;border-bottom:1px solid rgba(0,234,255,.10);}' +
    '.table-row:last-child{border-bottom:none;}' +
    '.issue,.vs,.bet{display:flex;align-items:center;justify-content:center;min-width:0;}' +
    '.issue{flex-direction:column;gap:8px;border-right:1px solid rgba(0,234,255,.10);}' +
    '.issue-num{color:#d7e3ee;font-size:22px;font-weight:700;}' +
    '.issue-time{color:#7d93a8;font-size:18px;font-weight:500;}' +
    '.vs{flex-direction:column;gap:8px;padding:20px 12px;}' +
    '.vs-team{color:#fff;font-size:26px;font-weight:700;line-height:1.25;text-align:center;word-break:break-all;}' +
    '.vs-mid{color:#8ea3b7;font-size:20px;font-weight:700;letter-spacing:1px;}' +
    '.bet{padding:20px 12px;border-left:1px solid rgba(0,234,255,.10);color:#fff;font-size:22px;font-weight:600;line-height:1.5;text-align:center;word-break:break-word;}' +
    '.bet strong{color:#1ee9ff;font-size:24px;text-shadow:0 0 10px rgba(30,233,255,.14);font-weight:800;}' +
    '.share-footer{margin-top:24px;display:flex;justify-content:center;position:relative;z-index:1;}' +
    '.share-footer span{width:160px;height:10px;border-radius:999px;border:1px solid rgba(0,234,255,.22);position:relative;display:block;}' +
    '.share-footer span::after{content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:34px;height:14px;border:1px solid rgba(0,234,255,.42);border-radius:999px;background:rgba(0,234,255,.10);box-shadow:0 0 14px rgba(0,234,255,.20);}' +
    '</style>' +
    '<div class="share-card">' +
    '<div class="header">' +
    '<div class="header-left">' +
    '<div class="football-icon">&#x26BD;</div>' +
    '<div class="title-block"><div class="scheme-title">' +
    name +
    '</div><div class="title-mark"><b></b><i></i></div></div>' +
    '</div>' +
    '<div class="scheme-date">' +
    shareDate +
    '</div>' +
    '</div>' +
    '<div class="stat-panel">' +
    '<div class="stat-item"><div class="stat-label">' +
    amountLabel +
    '</div><div class="stat-value">' +
    amtNum +
    '<span>' +
    amtUnit +
    '</span></div></div>' +
    '<div class="stat-line"></div>' +
    '<div class="stat-item"><div class="stat-label">' +
    prizeLabel +
    '</div><div class="stat-value">' +
    pNum +
    '<span>' +
    pUnit +
    '</span></div></div>' +
    '<div class="stat-line"></div>' +
    '<div class="stat-item"><div class="stat-label">方案状态</div><div class="stat-status ' +
    statusCls +
    '">' +
    statusText +
    '</div></div>' +
    '</div>' +
    '<div class="base-info">' +
    '<div class="info-row"><div class="info-icon">&#x2316;</div><div class="label">玩法</div><div class="value">' +
    playType +
    '</div></div>' +
    '<div class="info-row"><div class="info-icon">&#x25A3;</div><div class="label">场数/过关</div><div class="value">' +
    passType +
    '</div></div>' +
    '<div class="info-row"><div class="info-icon">&#x25CE;</div><div class="label">注数/倍数</div><div class="value">' +
    betCount +
    '</div></div>' +
    '</div>' +
    '<div class="section-header"><div class="section-line"></div><div class="section-text">赛事详情</div><div class="section-line"></div></div>' +
    '<div class="match-table">' +
    matchRows +
    '</div>' +
    '<div class="share-footer"><span></span></div>' +
    '</div>';

  return wrapper;
}

// ═══ 分享预览弹窗（通用） ═══
function _showShareModal(planId, canvas, cardEl) {
  var overlay = document.createElement('div');
  overlay.className = 'share-overlay active';
  var imgSrc = canvas.toDataURL('image/png');

  var infoLines = _extractPlanInfo(cardEl);

  overlay.innerHTML =
    '<div class="share-modal">' +
    '<div class="share-modal-header">' +
    '<span class="share-modal-title">&#x1F4E4; 分享方案</span>' +
    '<button class="share-modal-close">&times;</button>' +
    '</div>' +
    '<div class="share-modal-body">' +
    '<div class="share-img-wrap">' +
    '<img src="' +
    imgSrc +
    '" alt="方案截图" decoding="async" />' +
    '<div class="share-img-hint">&#x1F446; 长按图片可发送给微信好友</div>' +
    '</div>' +
    '</div>' +
    '<div class="share-modal-foot">' +
    '<button class="share-btn-copy">&#x1F4CB; 复制方案信息</button>' +
    '<button class="share-btn-save">&#x1F4BE; 保存图片</button>' +
    '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var close = function () {
    overlay.classList.remove('active');
    setTimeout(function () {
      overlay.remove();
    }, 300);
  };
  overlay.querySelector('.share-modal-close').onclick = close;
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close();
  });

  overlay.querySelector('.share-btn-copy').onclick = function () {
    navigator.clipboard
      .writeText(infoLines)
      .then(function () {
        var btn = overlay.querySelector('.share-btn-copy');
        btn.textContent = '\u2714 已复制';
        btn.classList.add('copied');
        setTimeout(function () {
          btn.textContent = '\uD83D\uDCCB 复制方案信息';
          btn.classList.remove('copied');
        }, 2000);
      })
      .catch(function () {
        var ta = document.createElement('textarea');
        ta.value = infoLines;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        var btn = overlay.querySelector('.share-btn-copy');
        btn.textContent = '\u2714 已复制';
        btn.classList.add('copied');
        setTimeout(function () {
          btn.textContent = '\uD83D\uDCCB 复制方案信息';
          btn.classList.remove('copied');
        }, 2000);
      });
  };

  overlay.querySelector('.share-btn-save').onclick = function () {
    var link = document.createElement('a');
    link.download = 'plan-' + planId + '.png';
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    _toast('图片已保存', 'ok');
  };
}

// ═══ 从方案卡片 DOM 提取文字信息 ═══
function _extractPlanInfo(cardEl) {
  var lines = [];
  var nameEl = cardEl.querySelector('.plan-name');
  if (nameEl) lines.push(nameEl.textContent.trim());
  lines.push('');

  var rows = cardEl.querySelectorAll('.plan-match-table tbody tr');
  rows.forEach(function (row) {
    var cells = row.querySelectorAll('td');
    if (cells.length >= 3) {
      var num = cells[0].textContent.trim().replace(/\s+/g, ' ');
      var teams = cells[1].textContent.trim().replace(/\s+/g, ' ');
      var odds = cells[2].textContent.trim().replace(/\s+/g, ' ');
      if (num || teams) lines.push((num || '') + '  ' + teams + '  ' + (odds || ''));
    }
  });

  var amountCols = cardEl.querySelectorAll('.plan-amount-col');
  if (amountCols.length >= 2) {
    var amtLabel = amountCols[0].querySelector('.plan-amount-label');
    var amtVal = amountCols[0].querySelector('.plan-amount-value');
    var prizeLabel = amountCols[1].querySelector('.plan-amount-label');
    var prizeVal = amountCols[1].querySelector('.plan-amount-value');
    lines.push('');
    if (amtLabel && amtVal)
      lines.push((amtLabel.textContent.trim() + ': ' + amtVal.textContent.trim()).replace(/\s+/g, ' '));
    if (prizeLabel && prizeVal)
      lines.push((prizeLabel.textContent.trim() + ': ' + prizeVal.textContent.trim()).replace(/\s+/g, ' '));
  }

  return lines.join('\n');
}

// ═══ Toast 轻提示 ═══
function _toast(msg, type) {
  var el = document.getElementById('shareToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'shareToast';
    el.style.cssText =
      'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 24px;border-radius:20px;font-size:13px;font-weight:600;pointer-events:none;transition:opacity 0.3s;opacity:0;';
    document.body.appendChild(el);
  }
  if (type === 'err') {
    el.style.background = 'rgba(239,68,68,0.9)';
    el.style.color = '#fff';
  } else if (type === 'ok') {
    el.style.background = 'rgba(34,197,94,0.9)';
    el.style.color = '#fff';
  } else {
    el.style.background = 'rgba(0,0,0,0.8)';
    el.style.color = '#fff';
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(function () {
    el.style.opacity = '0';
  }, 2000);
}

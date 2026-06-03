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
    '<p>' + (planName ? '确定删除方案「' + planName + '」吗？' : '确定删除这个方案吗？') + '</p>' +
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
    setTimeout(function () { overlay.remove(); }, 300);
  };
  overlay.querySelector('.del-btn-cancel').onclick = close;
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close();
  });

  var confirmBtn = overlay.querySelector('.del-btn-confirm');
  confirmBtn.onclick = function () {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '删除中...';
    api('my-plan-delete', { planId: planId }).then(function () {
      close();
      onSuccess();
    }).catch(function (e) {
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
  _confirmDelete(planId, planName, function () { loadMyPlan(); });
};

// ═══ 分享方案（截图） ═══
window.shareUserPlan = function (planId) {
  var card = document.getElementById('upcard-' + planId);
  if (!card) { _toast('方案卡片未找到', 'err'); return; }

  var loadHtml2Canvas = window.html2canvas
    ? Promise.resolve(window.html2canvas)
    : new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        script.onload = function () { resolve(window.html2canvas); };
        script.onerror = function () { reject(new Error('html2canvas 加载失败')); };
        document.head.appendChild(script);
      });

  _toast('正在生成分享图片...', 'info');

  loadHtml2Canvas.then(function (html2canvas) {
    var shareEl = _buildShareCard(card);
    document.body.appendChild(shareEl);

    setTimeout(function () {
      html2canvas(shareEl, {
        scale: 1,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
      }).then(function (canvas) {
        shareEl.remove();
        _showShareModal(planId, canvas, card);
      }).catch(function (e) {
        shareEl.remove();
        _toast('截图失败: ' + e.message, 'err');
      });
    }, 200);
  }).catch(function (e) {
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
  var amountLabel = '', amountValue = '';
  var prizeLabel = '', prizeValue = '';
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
  var playType = '', passType = '', betCount = '';
  if (infoLefts.length >= 3 && infoRights.length >= 3) {
    var leftTexts = [];
    infoLefts.forEach(function (d) { leftTexts.push(d.textContent.trim()); });
    var rightTexts = [];
    infoRights.forEach(function (d) { rightTexts.push(d.textContent.trim()); });
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
    var num = numEl ? numEl.textContent.trim() : '';
    var homeEl = cells[1].querySelector('.plan-team-home');
    var awayEl = cells[1].querySelector('.plan-team-away');
    var home = homeEl ? homeEl.textContent.trim() : '';
    var away = awayEl ? awayEl.textContent.trim() : '';
    var odds = cells[2].textContent.trim().replace(/\s+/g, ' ').substring(0, 40);
    matchRows +=
      '<div class="table-row">' +
      '<div class="issue">' + num + '</div>' +
      '<div class="vs"><div>' + home + '</div><span>VS</span><div>' + away + '</div></div>' +
      '<div class="bet">' + odds + '</div>' +
      '</div>';
  });

  var amtNum = amountValue, amtUnit = '分';
  var amtMatch = amountValue.match(/^([\d.]+)(.*)/);
  if (amtMatch) { amtNum = amtMatch[1]; amtUnit = amtMatch[2] || '分'; }

  var pNum = prizeValue, pUnit = '分';
  var pMatch = prizeValue.match(/^([+\-]?[\d.]+)(.*)/);
  if (pMatch) { pNum = pMatch[1]; pUnit = pMatch[2] || '分'; }

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:absolute;left:-9999px;top:0;width:750px;';
  wrapper.innerHTML =
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box;}' +
    '.share-card{' +
    'width:750px;min-height:1800px;padding:48px 40px 80px;' +
    'background:linear-gradient(180deg,#03233E 0px,#02131F 260px,#02131F 100%);' +
    'position:relative;overflow:hidden;' +
    'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;' +
    '}' +
    '.header{display:flex;justify-content:space-between;align-items:center;height:92px;}' +
    '.header-left{display:flex;align-items:center;}' +
    '.football-icon{font-size:48px;line-height:1;}' +
    '.scheme-title{font-size:64px;font-weight:700;color:#FFFFFF;margin-left:16px;}' +
    '.scheme-date{color:#AAB5C2;font-size:30px;}' +
    '.stat-panel{margin-top:44px;height:180px;display:flex;align-items:center;}' +
    '.stat-item{flex:1;text-align:center;}' +
    '.stat-label{color:#AAB5C2;font-size:24px;}' +
    '.stat-value{margin-top:28px;color:#18E8FF;font-size:60px;font-weight:700;}' +
    '.stat-value span{font-size:28px;}' +
    '.stat-status{margin-top:28px;color:#FFD126;font-size:60px;font-weight:700;}' +
    '.stat-line{width:2px;height:120px;background:rgba(0,234,255,.20);}' +
    '.section-divider{margin-top:12px;height:2px;background:rgba(0,234,255,.15);}' +
    '.base-info{margin-top:42px;}' +
    '.info-row{display:flex;align-items:center;height:88px;}' +
    '.label{width:180px;color:#AAB5C2;font-size:28px;}' +
    '.value{color:#18E8FF;font-size:34px;font-weight:600;}' +
    '.section-header{margin-top:52px;margin-bottom:20px;display:flex;align-items:center;gap:12px;}' +
    '.section-icon{font-size:32px;line-height:1;}' +
    '.section-text{font-size:26px;color:#AAB5C2;font-weight:600;}' +
    '.match-table{margin-top:0;border-radius:28px;overflow:hidden;' +
    'border:2px solid rgba(0,234,255,.18);background:rgba(0,20,32,.35);}' +
    '.table-head{height:92px;display:grid;grid-template-columns:160px 1fr 250px;' +
    'background:rgba(0,234,255,.04);border-bottom:1px solid rgba(0,234,255,.12);}' +
    '.table-head div{display:flex;align-items:center;justify-content:center;' +
    'color:#AAB5C2;font-size:24px;font-weight:600;}' +
    '.table-row{min-height:220px;display:grid;grid-template-columns:160px 1fr 250px;' +
    'border-bottom:1px solid rgba(0,234,255,.08);}' +
    '.table-row:last-child{border-bottom:none;}' +
    '.issue{display:flex;align-items:center;justify-content:center;' +
    'color:#AAB5C2;font-size:24px;font-weight:600;}' +
    '.vs{display:flex;flex-direction:column;justify-content:center;align-items:center;' +
    'color:#FFFFFF;font-size:28px;font-weight:700;line-height:56px;}' +
    '.vs span{color:#8D98A4;font-size:24px;}' +
    '.bet{display:flex;align-items:center;justify-content:center;' +
    'color:#FFFFFF;font-size:24px;font-weight:600;}' +
    '</style>' +
    '<div class="share-card">' +
    '<div class="header">' +
    '<div class="header-left">' +
    '<div class="football-icon">&#x26BD;</div>' +
    '<div class="scheme-title">' + name + '</div>' +
    '</div>' +
    '<div class="scheme-date">' + date + '</div>' +
    '</div>' +
    '<div class="stat-panel">' +
    '<div class="stat-item"><div class="stat-label">' + amountLabel + '</div><div class="stat-value">' + amtNum + '<span>' + amtUnit + '</span></div></div>' +
    '<div class="stat-line"></div>' +
    '<div class="stat-item"><div class="stat-label">' + prizeLabel + '</div><div class="stat-value">' + pNum + '<span>' + pUnit + '</span></div></div>' +
    '<div class="stat-line"></div>' +
    '<div class="stat-item"><div class="stat-label">方案状态</div><div class="stat-status">' + statusText + '</div></div>' +
    '</div>' +
    '<div class="section-divider"></div>' +
    '<div class="base-info">' +
    '<div class="info-row"><div class="label">玩法</div><div class="value">' + playType + '</div></div>' +
    '<div class="info-row"><div class="label">场数/过关</div><div class="value">' + passType + '</div></div>' +
    '<div class="info-row"><div class="label">注数/倍数</div><div class="value">' + betCount + '</div></div>' +
    '</div>' +
    '<div class="section-header"><div class="section-icon">&#x26BD;</div><div class="section-text">赛事详情</div></div>' +
    '<div class="match-table">' +
    '<div class="table-head"><div>场次</div><div>对阵</div><div>投注(赔率)</div></div>' +
    matchRows +
    '</div>' +
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
    '<img src="' + imgSrc + '" alt="方案截图" decoding="async" />' +
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
    setTimeout(function () { overlay.remove(); }, 300);
  };
  overlay.querySelector('.share-modal-close').onclick = close;
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close();
  });

  overlay.querySelector('.share-btn-copy').onclick = function () {
    navigator.clipboard.writeText(infoLines).then(function () {
      var btn = overlay.querySelector('.share-btn-copy');
      btn.textContent = '\u2714 已复制';
      btn.classList.add('copied');
      setTimeout(function () {
        btn.textContent = '\uD83D\uDCCB 复制方案信息';
        btn.classList.remove('copied');
      }, 2000);
    }).catch(function () {
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
    if (amtLabel && amtVal) lines.push((amtLabel.textContent.trim() + ': ' + amtVal.textContent.trim()).replace(/\s+/g, ' '));
    if (prizeLabel && prizeVal) lines.push((prizeLabel.textContent.trim() + ': ' + prizeVal.textContent.trim()).replace(/\s+/g, ' '));
  }

  return lines.join('\n');
}

// ═══ Toast 轻提示 ═══
function _toast(msg, type) {
  var el = document.getElementById('shareToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'shareToast';
    el.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 24px;border-radius:20px;font-size:13px;font-weight:600;pointer-events:none;transition:opacity 0.3s;opacity:0;';
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
  el._timer = setTimeout(function () { el.style.opacity = '0'; }, 2000);
}

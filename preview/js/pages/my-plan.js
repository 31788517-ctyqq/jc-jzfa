// ==================== 我的方案列表页 ====================
import { api } from '../vendor.js?v=202606152148';
import { WEEK_NAMES, formatDateCN, getCache, setCache } from '../vendor.js?v=202606152148';

var _plans = [];
var _stats = {};
var _reconcileEnabled = false;
var _reconcileLoading = false;
var _reconcileMap = {};

try {
  _reconcileEnabled = localStorage.getItem('my_plan_reconcile_enabled') === '1';
} catch (e) {
  _reconcileEnabled = false;
}

function getMatchHandicapValue(m, selection) {
  var candidates = [
    m && m.odds && m.odds.rqspf ? m.odds.rqspf.handicap : undefined,
    m && m.odds ? m.odds.handicap : undefined,
    m ? m.handicap : undefined,
    m ? m.rq : undefined,
    m ? m.concede : undefined,
    selection ? selection.handicap : undefined,
  ];
  for (var i = 0; i < candidates.length; i++) {
    var raw = candidates[i];
    if (raw === null || raw === undefined || raw === '') continue;
    var num = Number(raw);
    if (!isNaN(num)) return num;
  }
  return null;
}

function formatHandicapText(handicap) {
  if (handicap === null || handicap === undefined || handicap === '') return '--';
  var num = Number(handicap);
  if (isNaN(num)) return '--';
  if (num > 0) return '+' + num;
  if (num < 0) return String(num);
  return '0';
}

function renderMatchTeams(m, selection) {
  var score = m.actualScore || '';
  var middle = score ? '<span class="plan-score-blue">' + score + '</span>' : '<span class="plan-team-vs">vs</span>';
  var handicapText = formatHandicapText(getMatchHandicapValue(m, selection));
  return (
    '<span class="plan-team-home">' +
    (m.homeName || '') +
    '</span>' +
    middle +
    '<span class="plan-team-away">' +
    (m.visitName || '') +
    '</span>' +
    '<span class="plan-handicap-badge">让球 ' +
    handicapText +
    '</span>'
  );
}

// ═══ 页面入口 ═══
export function loadMyPlan() {
  var el = document.getElementById('myPlanContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载方案中...</div>';
  _reconcileMap = {};
  _reconcileLoading = false;

  // ★ P1: sessionStorage 缓存命中
  var cacheKey = 'my-plan-list:html';
  var cached = getCache(cacheKey);
  if (cached) {
    el.innerHTML = cached;
    return;
  }

  api('my-plan-list', {})
    .then(function (data) {
      _plans = (data && data.plans) || [];
      _stats = (data && data.stats) || {};
      renderMyPlanList();
      if (_reconcileEnabled) {
        _loadPlanReconcile();
      }
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

  var html = renderReconcileToolbar();

  if (_plans.length === 0) {
    el.innerHTML =
      html + '<div class="plan-notice">' + '<span class="notice-icon">&#x1F375;</span>' + '稍稍等，马上就来' + '</div>';
    return;
  }
  _plans.forEach(function (p, idx) {
    var matches = p.matches || [];
    var isWon = p.isWon === true;
    var isLose = p.isWon === false;
    var statusText = isWon ? '已中奖' : isLose ? '未中奖' : '未开奖';
    var statusCls = isWon ? 'plan-status-won' : isLose ? 'plan-status-lost' : 'plan-status-pending';
    var amountVal = (p.amount || 200).toFixed(0);
    var prizeLabel = isWon || isLose ? '中奖金额' : '预计最高中奖金额';
    var prizeVal = isWon
      ? p.resultIncome != null
        ? p.resultIncome
        : '--'
      : isLose
        ? '0'
        : (function () {
            var totalOdds = Number(p.totalOdds) || 0;
            var amt = Number(p.amount) || 0;
            if (totalOdds > 0 && amt > 0) return Math.round(totalOdds * amt * 100) / 100;
            return '--';
          })();

    var passTypeText =
      (p.passTypes || [2]).length > 1 ? (p.passTypes || [2]).join('~') + '关' : ((p.passTypes || [2])[0] || 2) + '关';
    var dateStr = (p.date || '').slice(5).replace('-', '/');
    var createdAt = p.createdAt ? p.createdAt.slice(0, 16).replace('T', ' ') : '';
    var planName = p.planName || p.note || '我的方案 #' + (idx + 1);

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
      '<div class="plan-amount-col"><div class="plan-amount-label">方案金额</div><div class="plan-amount-value plan-money-value">' +
      amountVal +
      '<span class="unit">元</span></div></div>' +
      '<div class="plan-amount-col"><div class="plan-amount-label">' +
      prizeLabel +
      '</div><div class="plan-amount-value plan-money-value">' +
      prizeVal +
      '<span class="unit">元</span></div></div>' +
      '<div class="plan-amount-col"><div class="plan-amount-label">方案状态</div><div class="plan-amount-value ' +
      statusCls +
      '">' +
      statusText +
      '</div></div>' +
      '</div>' +
      // 分割线
      '<div class="plan-divider"></div>' +
      '<div class="plan-info-grid">' +
      '<div class="plan-info-left"><div>玩法</div><div>场数/过关</div><div>注数/倍</div></div>' +
      '<div class="plan-info-right"><div>混合投注</div><div>' +
      (p.matchCount || matches.length) +
      '场 ' +
      passTypeText +
      '</div><div>' +
      (p.betCount || '--') +
      '注 ×' +
      (p.multiplier || 1) +
      '倍</div></div>' +
      '</div>' +
      // 比赛表格
      renderPlanMatchesTable(matches) +
      // 对账详情
      renderPlanReconcileBlock(p) +
      // 操作栏
      '<div class="mp-actions">' +
      '<button class="mp-delete-btn" onclick="deleteUserPlan(\'' +
      p.id +
      '\')">🗑 删除</button>' +
      '<button class="mp-share-btn" onclick="shareUserPlan(\'' +
      p.id +
      '\')">✨ 分享</button>' +
      '</div>' +
      '</div>';
  });

  el.innerHTML = html;
  setCache('my-plan-list:html', html);
}

function renderReconcileToolbar() {
  var checked = _reconcileEnabled ? ' checked' : '';
  var loading = _reconcileEnabled && _reconcileLoading ? '<span class="mp-rec-loading">对账中...</span>' : '';
  return (
    '<div class="mp-rec-toolbar">' +
    '<label class="mp-rec-switch"><input type="checkbox" ' +
    checked +
    ' onchange="togglePlanReconcile(this.checked)" /><span>🔎 对账</span></label>' +
    '<span class="mp-rec-tip">比分 / 中奖金额 / 组合赔率</span>' +
    loading +
    '</div>'
  );
}

function _fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '--';
  var n = Number(v);
  if (isNaN(n)) return '--';
  return Math.round(n * 100) / 100;
}

function _statusCN(st) {
  if (st === 'won') return '已中';
  if (st === 'lost') return '未中';
  return '未开奖';
}

function _fmtPassOddsMap(map) {
  if (!map) return '--';
  var keys = Object.keys(map).sort(function (a, b) {
    return Number(a) - Number(b);
  });
  if (!keys.length) return '--';
  return keys
    .map(function (k) {
      var v = Number(map[k]);
      return k + '关:' + (isNaN(v) ? '--' : Math.round(v * 100) / 100);
    })
    .join(' / ');
}

function renderPlanReconcileBlock(plan) {
  if (!_reconcileEnabled) return '';
  var rec = _reconcileMap[plan.id];
  if (_reconcileLoading && !rec) {
    return '<div class="mp-rec-box"><div class="mp-rec-row">⏳ 正在拉取对账数据...</div></div>';
  }
  if (!rec) {
    return '<div class="mp-rec-box"><div class="mp-rec-row">⚠️ 暂无对账数据</div></div>';
  }
  if (rec.error) {
    return '<div class="mp-rec-box"><div class="mp-rec-row">⚠️ 对账失败：' + rec.error + '</div></div>';
  }

  var score = rec.score || {};
  var bonus = rec.bonus || {};
  var odds = rec.odds || {};
  var scoreCls = score.driftCount > 0 ? ' drift' : '';
  var bonusCls = bonus.drift ? ' drift' : '';
  var oddsCls = odds.drift ? ' drift' : '';

  var scoreSample = '';
  if (score.items && score.items.length) {
    var top = score.items.slice(0, 2);
    scoreSample = top
      .map(function (it) {
        return (it.matchNum || '--') + ' ' + (it.rawScore || '--') + ' / ' + (it.aggScore || '--');
      })
      .join('；');
  }

  return (
    '<div class="mp-rec-box">' +
    '<div class="mp-rec-head">对账结果' +
    (rec.hasDrift ? '<span class="mp-rec-badge drift">有漂移</span>' : '<span class="mp-rec-badge">一致</span>') +
    '</div>' +
    '<div class="mp-rec-row' +
    scoreCls +
    '"><b>比分</b><span>原始/聚合：' +
    (scoreSample || '--') +
    '（漂移 ' +
    (score.driftCount || 0) +
    '/' +
    (score.total || 0) +
    '）</span></div>' +
    '<div class="mp-rec-row' +
    bonusCls +
    '"><b>中奖金额</b><span>原始 ' +
    _fmtMoney(bonus.rawIncome) +
    ' 元（' +
    _statusCN(bonus.rawStatus) +
    '） / 聚合 ' +
    _fmtMoney(bonus.aggIncome) +
    ' 元（' +
    _statusCN(bonus.aggStatus) +
    '）</span></div>' +
    '<div class="mp-rec-row' +
    oddsCls +
    '"><b>组合赔率</b><span>原始总赔 ' +
    _fmtMoney(odds.rawTotalOdds) +
    ' / 聚合总赔 ' +
    _fmtMoney(odds.aggTotalOdds) +
    '；原始关级 ' +
    _fmtPassOddsMap(odds.rawPassOdds) +
    '；聚合关级 ' +
    _fmtPassOddsMap(odds.aggPassOdds) +
    '</span></div>' +
    '</div>'
  );
}

function _loadPlanReconcile() {
  if (!_reconcileEnabled) return Promise.resolve();
  if (!_plans || !_plans.length) return Promise.resolve();
  _reconcileLoading = true;
  renderMyPlanList();
  var ids = _plans
    .map(function (p) {
      return p.id;
    })
    .filter(Boolean);
  return api('my-plan-reconcile', { planIds: ids }, 0)
    .then(function (ret) {
      _reconcileMap = (ret && ret.items) || {};
    })
    .catch(function (e) {
      console.warn('[my-plan-reconcile] ' + (e && e.message));
      _reconcileMap = {};
    })
    .finally(function () {
      _reconcileLoading = false;
      renderMyPlanList();
    });
}

window.togglePlanReconcile = function (enabled) {
  _reconcileEnabled = !!enabled;
  try {
    localStorage.setItem('my_plan_reconcile_enabled', _reconcileEnabled ? '1' : '0');
  } catch (e) {}
  if (_reconcileEnabled) {
    _loadPlanReconcile();
  } else {
    _reconcileLoading = false;
    _reconcileMap = {};
    renderMyPlanList();
  }
};

// ═══ 方案比赛表格（复用 plan-match-table 样式） ═══
function renderPlanMatchesTable(matches) {
  if (!matches || matches.length === 0) return '';
  var rows = matches
    .map(function (m) {
      var oddsStr = m.odds != null ? Number(m.odds).toFixed(2) : '--';
      var dirDisplay = m.direction || m.oddsName || '';
      if (m.playType === 'rqspf') {
        dirDisplay = '让' + dirDisplay + '(' + formatHandicapText(getMatchHandicapValue(m, m)) + ')';
      }
      var playTypeMap = { spf: '胜平负', rqspf: '让球', jqs: '总进球', bqc: '半全场', bf: '比分' };
      var playLabel = playTypeMap[m.playType] || m.playType || '--';
      // 赔率颜色：命中红 / 未命中绿 / 未开奖原色
      var oddsStyle = '';
      if (m.isMatchWon === true) oddsStyle = 'color:#EF4444;';
      else if (m.isMatchLose === true) oddsStyle = 'color:#34D399;';
      return (
        '<tr>' +
        '<td class="match-info-col"><span class="match-num-text">' +
        (m.matchNum || '') +
        '</span></td>' +
        '<td class="team-col">' +
        renderMatchTeams(m, m) +
        '</td>' +
        '<td class="odds-col"' +
        (oddsStyle ? ' style="' + oddsStyle + '"' : '') +
        '>' +
        playLabel +
        ' ' +
        dirDisplay +
        '(' +
        oddsStr +
        ')' +
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
          scale: 2,
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

// ═══ 构建 440px 新版分享海报（按分享参考图还原） ═══
function _buildShareCard(cardEl) {
  function pickText(root, selector) {
    var el = root.querySelector(selector);
    return el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function splitNumberUnit(value, defaultUnit) {
    var text = String(value || '').replace(/\s+/g, '');
    var match = text.match(/^([+\-]?[\d.]+)(.*)$/);
    if (!match) return { num: text || '--', unit: '' };
    return { num: match[1], unit: match[2] || defaultUnit || '' };
  }

  function normalizeDate(value) {
    var text = String(value || '');
    var m = text.match(/(\d{1,2})[\/\-](\d{1,2})/);
    if (!m) return '';
    return String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
  }

  function formatLastOrderTime(value) {
    var text = String(value || '').trim();
    var full = text.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[ T](\d{2}:\d{2})/);
    if (full)
      return '最后下单 ' + String(full[2]).padStart(2, '0') + '-' + String(full[3]).padStart(2, '0') + ' ' + full[4];
    var short = text.match(/(\d{1,2})[\/\-](\d{1,2})\s+(\d{2}:\d{2})/);
    if (short)
      return '最后下单 ' + String(short[1]).padStart(2, '0') + '-' + String(short[2]).padStart(2, '0') + ' ' + short[3];
    var timeOnly = text.match(/(\d{2}:\d{2})/);
    var day = normalizeDate(text);
    if (timeOnly && day) return '最后下单 ' + day + ' ' + timeOnly[1];
    return '';
  }

  function parseBet(rawValue) {
    var raw = String(rawValue || '')
      .replace(/[▲▼]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    var label = '胜平负：';
    var value = raw;
    var colon = raw.match(/^([^：:]{2,10})[：:]\s*(.+)$/);
    if (colon) {
      label = colon[1] + '：';
      value = colon[2];
    } else if (raw.indexOf('让球胜平负') >= 0 || /^让[胜平负]/.test(raw)) {
      label = '让球：';
      value = raw.replace(/让球胜平负/g, '');
    } else if (raw.indexOf('比分') >= 0 || /^\d+\s*[:：]\s*\d+/.test(raw)) {
      label = '比分：';
      value = raw.replace(/单场比分|比分/g, '');
    } else if (raw.indexOf('总进球') >= 0 || /\d\+?球/.test(raw)) {
      label = '总进球：';
      value = raw.replace(/总进球[-：:]?/g, '');
    } else if (raw.indexOf('半全场') >= 0) {
      label = '半全场：';
      value = raw.replace(/半全场[-：:]?/g, '');
    } else if (raw.indexOf('胜平负') >= 0) {
      label = '胜平负：';
      value = raw.replace(/胜平负/g, '');
    }
    value = value
      .replace(/@/g, ' ')
      .replace(/[（(]\s*([\d.]+)\s*[）)]/g, ' $1')
      .replace(/\s*\+\s*/g, ' + ')
      .replace(/\s+/g, ' ')
      .trim();
    return { label: label, value: value || '--' };
  }

  var name = pickText(cardEl, '.plan-name') || '方案一';
  var rawDate = pickText(cardEl, '.plan-pub-time');
  var amountCols = cardEl.querySelectorAll('.plan-amount-col');

  var amountLabel = amountCols[0] ? pickText(amountCols[0], '.plan-amount-label') : '方案金额';
  var amountValue = amountCols[0] ? pickText(amountCols[0], '.plan-amount-value') : '--元';
  var prizeLabel = amountCols[1] ? pickText(amountCols[1], '.plan-amount-label') : '预计最高中奖金额';
  var prizeValue = amountCols[1] ? pickText(amountCols[1], '.plan-amount-value') : '--元';
  var statusLabel = amountCols[2] ? pickText(amountCols[2], '.plan-amount-label') : '方案状态';
  var statusValue = amountCols[2] ? pickText(amountCols[2], '.plan-amount-value') : '未开奖';
  var statusText = statusValue || '未开奖';
  if (statusLabel.indexOf('状态') < 0) {
    statusText = statusValue.indexOf('+') === 0 ? '已中奖' : statusValue === '0' ? '未中奖' : '未开奖';
  }

  var infoRights = cardEl.querySelectorAll('.plan-info-right > div');
  var playType = infoRights[0] ? infoRights[0].textContent.trim().replace(/\s+/g, ' ') : '混合投注';
  var passType = infoRights[1] ? infoRights[1].textContent.trim().replace(/\s+/g, ' ') : '';
  var betCount = infoRights[2] ? infoRights[2].textContent.trim().replace(/\s+/g, ' ') : '';

  var matchRowsData = [];
  var last = { num: '', time: '', home: '', away: '', score: '', handicap: '' };
  cardEl.querySelectorAll('.plan-match-table tbody tr').forEach(function (row) {
    var cells = row.querySelectorAll('td');
    if (cells.length < 3) return;
    var num = pickText(cells[0], '.match-num-text') || last.num;
    var time = pickText(cells[0], '.match-time-sub') || last.time;
    var home = pickText(cells[1], '.plan-team-home') || last.home;
    var away = pickText(cells[1], '.plan-team-away') || last.away;
    var score = pickText(cells[1], '.plan-score-blue') || '';
    var handicap = pickText(cells[1], '.plan-handicap-badge') || '';
    if ((!home || !away) && cells[1]) {
      var teamText = cells[1].textContent.trim().replace(/\s+/g, ' ');
      var teamParts = teamText.split(/\s*(?:vs|VS)\s*/);
      if (!home && teamParts[0]) home = teamParts[0];
      if (!away && teamParts[1]) away = teamParts[1];
    }
    var bet = parseBet(cells[2].textContent);
    var betColor = '';
    var coloredBet = cells[2].querySelector('span[style*="color"]');
    if (coloredBet && coloredBet.style && coloredBet.style.color) betColor = coloredBet.style.color;
    if (num) last.num = num;
    if (time) last.time = time;
    if (home) last.home = home;
    if (away) last.away = away;
    if (score) last.score = score;
    if (handicap) last.handicap = handicap;
    matchRowsData.push({
      num: num,
      time: time,
      home: home,
      away: away,
      score: score,
      handicap: handicap,
      bet: bet,
      betColor: betColor,
    });
  });

  if (!passType) passType = (matchRowsData.length || 1) + '场';
  if (!betCount) betCount = '--';

  var shareDate = normalizeDate(rawDate) || (matchRowsData[0] ? normalizeDate(matchRowsData[0].time) : '');
  var lastOrderTime = formatLastOrderTime(rawDate) || shareDate;
  function formatMatchTime(value) {
    var text = String(value || '').trim();
    var m = text.match(/(\d{1,2})[\/\-](\d{1,2})\s+(\d{2}:\d{2})/);
    if (m) return String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0') + ' ' + m[3];
    if (/^\d{2}:\d{2}$/.test(text) && shareDate) return shareDate + ' ' + text;
    return text.replace(/\//g, '-');
  }

  var amountParts = splitNumberUnit(amountValue, '元');
  var prizeParts = splitNumberUnit(prizeValue, '元');
  var statusCls = statusText.indexOf('未中奖') >= 0 ? 'lost' : statusText.indexOf('已中奖') >= 0 ? 'won' : 'pending';
  var statusColor = statusCls === 'won' ? '#EF4444' : statusCls === 'lost' ? '#9CA3AF' : '#34D399';

  var targetIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2.6"></circle><path d="M19 5l-4 4M18.5 4.5h-3.5v3.5"></path></svg>';
  var ticketIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"></rect><path d="M9 5v14M15 5v14M5 10h14M5 15h14"></path><circle cx="12" cy="12" r="1.5"></circle></svg>';
  var coinIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="7" rx="6" ry="3"></ellipse><path d="M6 7v6c0 1.7 2.7 3 6 3s6-1.3 6-3V7"></path><path d="M6 13c0 1.7 2.7 3 6 3s6-1.3 6-3"></path></svg>';
  var calendarIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="5.5" width="15" height="14" rx="2"></rect><path d="M8 3.8v4M16 3.8v4M4.5 10h15M9 14l2 2 4-4"></path></svg>';

  var matchRowsHtml = matchRowsData.length
    ? matchRowsData
        .map(function (item) {
          return (
            '<div class="sp-match-row">' +
            '<div class="sp-issue"><span class="sp-cal">' +
            calendarIcon +
            '</span><div><div class="sp-issue-num">' +
            escapeHtml(item.num || '--') +
            '</div><div class="sp-issue-time">' +
            escapeHtml(formatMatchTime(item.time) || (shareDate ? shareDate + ' 03:00' : '--')) +
            '</div></div></div>' +
            '<div class="sp-teams"><div>' +
            escapeHtml(item.home || '--') +
            '</div><span>' +
            escapeHtml(item.score || 'VS') +
            '</span><div>' +
            escapeHtml(item.away || '--') +
            '</div>' +
            (item.handicap ? '<div class="sp-handicap">' + escapeHtml(item.handicap) + '</div>' : '') +
            '</div>' +
            '<div class="sp-bet"><span class="sp-bet-label">' +
            escapeHtml(item.bet.label) +
            '</span><span class="sp-bet-value"' +
            (item.betColor ? ' style="color:' + item.betColor + ';"' : '') +
            '>' +
            escapeHtml(item.bet.value) +
            '</span></div>' +
            '</div>'
          );
        })
        .join('')
    : '<div class="sp-empty-row">暂无赛事详情</div>';

  var css = [
    '*{margin:0;padding:0;box-sizing:border-box;}',
    '.sp-page{width:440px;min-height:780px;padding:30px 24px 40px;position:relative;overflow:hidden;background:radial-gradient(circle at 50% -10%,#ffffff 0%,#effcfc 38%,#f7ffff 70%,#ffffff 100%);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#152235;}',
    '.sp-page:before{content:"";position:absolute;inset:0;background:linear-gradient(115deg,rgba(30,176,172,.08),transparent 28%,rgba(30,176,172,.05) 72%,transparent);pointer-events:none;}',
    '.sp-card{position:relative;background:rgba(255,255,255,.93);border:1px solid rgba(255,255,255,.9);border-radius:18px;box-shadow:0 10px 30px rgba(36,128,138,.10),0 1px 0 rgba(255,255,255,.95) inset;overflow:hidden;}',
    '.sp-top{padding:16px 14px 12px;}',
    '.sp-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;}',
    '.sp-title-wrap{display:flex;align-items:center;gap:12px;}',
    '.sp-logo{width:36px;height:36px;border-radius:11px;background:linear-gradient(145deg,#35df57 0%,#13b93f 72%);display:flex;align-items:center;justify-content:center;font-size:24px;line-height:1;box-shadow:0 10px 18px rgba(20,186,61,.25);position:relative;}',
    '.sp-logo:after{content:"★";position:absolute;right:2px;bottom:0;color:#ffd44d;font-size:10px;text-shadow:0 1px 2px rgba(0,0,0,.15);}',
    '.sp-name{font-size:19px;font-weight:700;letter-spacing:.1px;color:#142235;line-height:36px;max-width:230px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.sp-date{font-size:11px;color:#667790;font-weight:400;padding-top:5px;text-align:right;line-height:1.35;max-width:132px;}',
    '.sp-stats{display:grid;grid-template-columns:repeat(3,1fr);align-items:center;margin:0 0 14px;}',
    '.sp-stat{height:61px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;}',
    '.sp-stat+.sp-stat{border-left:1px solid #e3ebf0;}',
    '.sp-stat-label{font-size:12px;line-height:1;color:#4d5d70;font-weight:500;margin-bottom:10px;}',
    '.sp-stat-value{font-size:24px;line-height:1;font-weight:700;color:#EF4444;letter-spacing:0;white-space:nowrap;}',
    '.sp-stat-value span{font-size:13px;font-weight:500;margin-left:3px;color:#203043;}',
    '.sp-status{font-size:23px;line-height:1;font-weight:700;white-space:nowrap;}',
    '.sp-status.pending{color:#34D399;}.sp-status.won{color:#EF4444;}.sp-status.lost{color:#9CA3AF;}',
    '.sp-info{height:140px;border-radius:15px;border:1px solid #e8eff3;background:rgba(255,255,255,.78);position:relative;overflow:hidden;box-shadow:none;}',
    '.sp-info:before{content:"";position:absolute;right:34px;bottom:31px;width:148px;height:44px;background:linear-gradient(100deg,transparent 0%,rgba(14,145,139,.10) 34%,rgba(14,145,139,.06) 54%,transparent 78%);transform:skewX(-18deg) rotate(-10deg);opacity:.42;}',
    '.sp-info:after{content:"";position:absolute;right:82px;bottom:32px;width:88px;height:2px;background:linear-gradient(90deg,transparent,rgba(14,145,139,.13),transparent);box-shadow:18px 12px 0 rgba(14,145,139,.09),-10px 24px 0 rgba(14,145,139,.06);transform:rotate(-13deg);}',
    '.sp-info-ball{position:absolute;right:15px;bottom:8px;width:80px;height:80px;border-radius:50%;opacity:.08;display:flex;align-items:center;justify-content:center;font-size:70px;filter:grayscale(.15);transform:rotate(-18deg);}',
    '.sp-info-row{height:46.66px;display:flex;align-items:center;padding:0 18px;position:relative;z-index:1;background:transparent;}',
    '.sp-info-row+.sp-info-row{border-top:1px solid #edf2f5;}',
    '.sp-i{width:28px;height:28px;border-radius:9px;background:rgba(33,189,180,.10);display:flex;align-items:center;justify-content:center;margin-right:13px;}',
    '.sp-i svg{width:18px;height:18px;fill:none;stroke:#0e918b;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;}',
    '.sp-info-label{width:84px;color:#48596c;font-size:13px;font-weight:500;}',
    '.sp-info-value{font-size:14px;color:#0e918b;font-weight:600;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.sp-section{height:40px;display:flex;align-items:center;justify-content:center;gap:12px;margin:16px 0 0;color:#142235;font-size:16px;font-weight:700;letter-spacing:.3px;}',
    '.sp-section:before,.sp-section:after{content:"";width:36px;height:3px;border-radius:3px;background:linear-gradient(90deg,transparent,#0e918b 45%,#0e918b 70%,transparent);}',
    '.sp-matches{position:relative;border-radius:19px;background:rgba(255,255,255,.94);box-shadow:0 10px 30px rgba(36,128,138,.10),0 1px 0 rgba(255,255,255,.95) inset;overflow:hidden;border:1px solid rgba(255,255,255,.9);}',
    '.sp-match-row{min-height:78px;display:grid;grid-template-columns:112px 1fr 120px;align-items:center;padding:0 12px;border-bottom:1px solid #edf2f5;background:transparent;}',
    '.sp-match-row:last-child{border-bottom:0;}',
    '.sp-issue{height:56px;display:flex;align-items:center;gap:9px;min-width:0;}',
    '.sp-cal{width:28px;height:28px;border-radius:9px;background:rgba(33,189,180,.09);display:flex;align-items:center;justify-content:center;flex:0 0 auto;}',
    '.sp-cal svg{width:18px;height:18px;fill:none;stroke:#0e918b;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;}',
    '.sp-issue-num{font-size:13px;font-weight:600;color:#26374b;white-space:nowrap;}',
    '.sp-issue-time{font-size:11px;color:#748299;margin-top:5px;white-space:nowrap;}',
    '.sp-teams{min-height:56px;border-left:1px solid #e3ebf0;border-right:1px solid #e3ebf0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 8px;}',
    '.sp-teams div{max-width:116px;font-size:14px;line-height:1.25;font-weight:600;color:#142235;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.sp-teams span{font-size:11px;line-height:1.5;color:#56677c;font-weight:500;}',
    '.sp-handicap{margin-top:2px;font-size:10px;color:#4b5e74;font-weight:600;}',
    '.sp-bet{padding-left:16px;font-size:13px;line-height:1.6;font-weight:600;color:#142235;}',
    '.sp-bet-label{white-space:nowrap;}.sp-bet-value{color:#0e918b;word-break:break-word;}',
    '.sp-empty-row{height:92px;display:flex;align-items:center;justify-content:center;color:#748299;font-size:13px;}',
    '.sp-footer-ball{position:absolute;left:-20px;bottom:-23px;width:112px;height:112px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:94px;opacity:.08;filter:grayscale(.1);transform:rotate(-16deg);}',
  ].join('');

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:absolute;left:-9999px;top:0;width:440px;background:transparent;';
  wrapper.innerHTML =
    '<style>' +
    css +
    '</style>' +
    '<div class="sp-page">' +
    '<div class="sp-card sp-top">' +
    '<div class="sp-head"><div class="sp-title-wrap"><div class="sp-logo">⚽</div><div class="sp-name">' +
    escapeHtml(name) +
    '</div></div><div class="sp-date">' +
    escapeHtml(lastOrderTime || '--') +
    '</div></div>' +
    '<div class="sp-stats"><div class="sp-stat"><div class="sp-stat-label">' +
    escapeHtml(amountLabel || '方案金额') +
    '</div><div class="sp-stat-value">' +
    escapeHtml(amountParts.num) +
    '<span>' +
    escapeHtml(amountParts.unit) +
    '</span></div></div><div class="sp-stat"><div class="sp-stat-label">' +
    escapeHtml(prizeLabel || '预计最高中奖金额') +
    '</div><div class="sp-stat-value">' +
    escapeHtml(prizeParts.num) +
    '<span>' +
    escapeHtml(prizeParts.unit) +
    '</span></div></div><div class="sp-stat"><div class="sp-stat-label">方案状态</div><div class="sp-status ' +
    statusCls +
    '" style="color:' +
    statusColor +
    '">' +
    escapeHtml(statusText) +
    '</div></div></div>' +
    '<div class="sp-info"><div class="sp-info-ball">⚽</div><div class="sp-info-row"><span class="sp-i">' +
    targetIcon +
    '</span><span class="sp-info-label">玩法</span><span class="sp-info-value">' +
    escapeHtml(playType || '混合投注') +
    '</span></div><div class="sp-info-row"><span class="sp-i">' +
    ticketIcon +
    '</span><span class="sp-info-label">场数/过关</span><span class="sp-info-value">' +
    escapeHtml(passType || '--') +
    '</span></div><div class="sp-info-row"><span class="sp-i">' +
    coinIcon +
    '</span><span class="sp-info-label">注数/倍数</span><span class="sp-info-value">' +
    escapeHtml(betCount || '--') +
    '</span></div></div>' +
    '</div>' +
    '<div class="sp-section">赛事详情</div>' +
    '<div class="sp-matches">' +
    matchRowsHtml +
    '</div>' +
    '<div class="sp-footer-ball">⚽</div>' +
    '</div>';
  return wrapper;
}

// ═══ 旧版 750px 分享卡片 DOM（保留兼容回退） ═══
function _buildLegacyShareCard(cardEl) {
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
    'width:750px;min-height:auto;padding:36px;background:linear-gradient(180deg,#eff6fb 0%,#f7fafc 40%,#ffffff 100%);' +
    'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;color:#1e293b;' +
    '}' +
    '.main-card{background:#fff;border-radius:24px;padding:32px 28px 26px;box-shadow:0 4px 24px rgba(15,23,42,.06),0 1px 4px rgba(15,23,42,.04);position:relative;overflow:hidden;}' +
    '.main-card::after{content:"";position:absolute;right:-20px;top:50%;transform:translateY(-50%);width:200px;height:200px;pointer-events:none;opacity:.07;' +
    "background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='46' fill='none' stroke='%230d9488' stroke-width='2.5'/%3E%3Cpath d='M50 4 L61 22 L82 22 L66 35 L72 55 L50 43 L28 55 L34 35 L18 22 L39 22 Z' fill='none' stroke='%230d9488' stroke-width='1.8'/%3E%3Cpath d='M18 22 L28 55 M82 22 L72 55 M39 22 L50 43 L61 22 M34 35 L66 35 M50 4 L50 43 M18 22 L82 22 M28 55 L72 55' stroke='%230d9488' stroke-width='1.2' opacity='.6'/%3E%3C/svg%3E\");" +
    'background-size:contain;background-repeat:no-repeat;}' +
    '.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;}' +
    '.header-left{display:flex;align-items:center;gap:14px;}' +
    '.football-icon{width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;' +
    'background:linear-gradient(135deg,#10b981 0%,#34d399 50%,#6ee7b7 100%);box-shadow:0 2px 10px rgba(16,185,129,.25);font-size:28px;color:#fff;}' +
    '.scheme-title{font-size:30px;font-weight:800;color:#0f172a;letter-spacing:.5px;line-height:1.2;}' +
    '.scheme-date{font-size:24px;font-weight:600;color:#94a3b8;letter-spacing:.5px;}' +
    '.stat-panel{display:flex;padding:20px 0;border-top:1px solid #eef2f6;border-bottom:1px solid #eef2f6;margin-bottom:0;}' +
    '.stat-item{flex:1;text-align:center;padding:0 8px;}' +
    '.stat-label{font-size:22px;color:#94a3b8;font-weight:500;line-height:1.2;}' +
    '.stat-value{margin-top:10px;font-size:44px;font-weight:800;color:#0d9488;letter-spacing:-.5px;line-height:1.1;}' +
    '.stat-value span{font-size:22px;color:#94a3b8;font-weight:500;margin-left:2px;}' +
    '.stat-status{margin-top:10px;font-size:42px;font-weight:800;letter-spacing:-.5px;}' +
    '.stat-status.status-pending{color:#34D399;}' +
    '.stat-status.status-won{color:#EF4444;}' +
    '.stat-status.status-lost{color:#9CA3AF;}' +
    '.base-info{padding-top:20px;}' +
    '.info-row{display:flex;align-items:center;height:76px;' +
    (amountCols.length > 1 ? 'border-bottom:1px solid #f1f5f9;' : '') +
    '}' +
    '.info-row:last-child{border-bottom:none;}' +
    '.info-icon{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;' +
    'background:linear-gradient(135deg,#ecfdf5,#d1fae5);color:#059669;font-size:20px;margin-right:14px;flex-shrink:0;}' +
    '.label{color:#64748b;font-size:24px;width:120px;flex-shrink:0;font-weight:500;}' +
    '.value{color:#0d9488;font-size:26px;font-weight:700;flex:1;}' +
    '.section-header{margin:28px 0 18px;display:flex;align-items:center;justify-content:center;gap:14px;}' +
    '.section-line{width:80px;height:1px;background:repeating-linear-gradient(90deg,#cbd5e1 0,#cbd5e1 4px,transparent 4px,transparent 8px);}' +
    '.section-text{font-size:26px;color:#475569;font-weight:700;letter-spacing:2px;}' +
    '.match-table{background:#fff;border-radius:22px;box-shadow:0 4px 24px rgba(15,23,42,.06),0 1px 4px rgba(15,23,42,.04);overflow:hidden;}' +
    '.table-row{display:grid;grid-template-columns:150px 1fr 240px;min-height:130px;padding:0 12px;' +
    'border-bottom:1px solid #f1f5f9;align-items:center;}' +
    '.table-row:last-child{border-bottom:none;}' +
    '.issue,.vs,.bet{display:flex;align-items:center;min-width:0;}' +
    '.issue{flex-direction:column;gap:6px;padding:14px 8px 14px 0;}' +
    '.issue-num{color:#334155;font-size:22px;font-weight:700;}' +
    '.issue-time{color:#94a3b8;font-size:18px;font-weight:400;}' +
    '.vs{flex-direction:column;gap:6px;padding:14px 10px;}' +
    '.vs-team{color:#1e293b;font-size:24px;font-weight:700;line-height:1.3;text-align:center;}' +
    '.vs-mid{color:#94a3b8;font-size:18px;font-weight:600;letter-spacing:1px;}' +
    '.bet{padding:14px 8px 14px 0;justify-content:flex-end;}' +
    '.bet strong{color:#0d9488;font-size:24px;font-weight:700;}' +
    '</style>' +
    '<div class="share-card">' +
    '<div class="main-card">' +
    '<div class="header">' +
    '<div class="header-left">' +
    '<div class="football-icon">&#x26BD;</div>' +
    '<div class="scheme-title">' +
    name +
    '</div>' +
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
    '<div class="stat-item"><div class="stat-label">' +
    prizeLabel +
    '</div><div class="stat-value">' +
    pNum +
    '<span>' +
    pUnit +
    '</span></div></div>' +
    '<div class="stat-item"><div class="stat-label">方案状态</div><div class="stat-status ' +
    statusCls +
    '">' +
    statusText +
    '</div></div>' +
    '</div>' +
    '<div class="base-info">' +
    '<div class="info-row"><div class="info-icon">&#x1F3CB;&#xFE0F;</div><div class="label">玩法</div><div class="value">' +
    playType +
    '</div></div>' +
    '<div class="info-row"><div class="info-icon">&#x1F3CF;&#xFE0F;</div><div class="label">场数/过关</div><div class="value">' +
    passType +
    '</div></div>' +
    '<div class="info-row"><div class="info-icon">&#x1F4B0;</div><div class="label">注数/倍数</div><div class="value">' +
    betCount +
    '</div></div>' +
    '</div>' +
    '</div>' +
    '<div class="section-header"><div class="section-line"></div><div class="section-text">赛事详情</div><div class="section-line"></div></div>' +
    '<div class="match-table">' +
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
    '<span class="share-modal-title">✨ 分享方案</span>' +
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

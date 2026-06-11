// ==================== 个人主页模块 ====================
import { api } from '../api.js';
import { WEEK_NAMES, formatDate, MIN_PLAN_DATE } from '../utils.js';
import { getAuthSession, clearAuthAll } from '../auth-client.js';

var _profileDateOffset = 0;
var _profileDate = '';
var _allPlans = [];

// ═══ 日期管理 ═══
function getProfileDate() {
  var d = new Date();
  d.setDate(d.getDate() + _profileDateOffset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function updateProfileDateBar() {
  _profileDate = getProfileDate();
  var el = document.getElementById('profilePlanDateCurrent');
  if (!el) return;
  var today = formatDate(new Date());
  var prefix = _profileDate === today ? '今天 ' : '';
  var mmdd = _profileDate.slice(5).replace('-', '/');
  var week = WEEK_NAMES[new Date(_profileDate).getDay()];
  el.textContent = prefix + mmdd + ' ' + week;

  var arrows = document.querySelectorAll('#profilePlanDateBar .date-arrow');
  if (arrows.length >= 2) {
    arrows[0].style.opacity = _profileDate <= MIN_PLAN_DATE ? '0.25' : '0.7';
    arrows[0].style.pointerEvents = _profileDate <= MIN_PLAN_DATE ? 'none' : 'auto';
    arrows[1].style.opacity = _profileDate >= today ? '0.25' : '0.7';
    arrows[1].style.pointerEvents = _profileDate >= today ? 'none' : 'auto';
  }
}

window.shiftProfileDate = function (delta) {
  var d = new Date();
  d.setDate(d.getDate() + _profileDateOffset + delta);
  var newDate =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  var today = formatDate(new Date());
  if (newDate < MIN_PLAN_DATE || newDate > today) return;
  _profileDateOffset += delta;
  updateProfileDateBar();
  renderProfilePlans();
};

window.toggleProfileDatePicker = function () {
  _profileDateOffset = 0;
  updateProfileDateBar();
  renderProfilePlans();
};

// ═══ 主入口 ═══
export function loadProfile() {
  var root = document.getElementById('profileContent');
  if (!root) return;

  var session = getAuthSession() || {};
  var userName = (session.user && session.user.username) || '-';

  _profileDateOffset = 0;
  _profileDate = getProfileDate();

  renderLayout(root, userName);
  loadProfileData();
  loadProfileSubscription(); // ★ Phase 4
}

// ═══ 渲染布局 ═══
function renderLayout(root, userName) {
  root.innerHTML =
    '<div class="auth-shell auth-shell-account">' +
    // ★ 右上角返回首页图标
    '<span class="auth-home-corner" onclick="switchTab(\'home\')" aria-label="返回首页" title="返回首页">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' +
    '</span>' +
    // Hero 头部
    '<div class="login-hero account-login-hero">' +
    '<div class="login-hero-copy">' +
    '<div class="login-hero-title">Hello!</div>' +
    '<div class="login-hero-subtitle">当前账号：' +
    userName +
    '</div>' +
    '</div>' +
    '<img class="login-eagle" src="/assets/login-eagle.png?v=202606110300" alt="" loading="eager" decoding="async" />' +
    '</div>' +
    // 主卡片
    '<div class="auth-card auth-login-card auth-account-card">' +
    // ★ 卡片右上角紧凑操作条
    '<div class="profile-actions-bar">' +
    '<span class="profile-act-link" onclick="switchTab(\'account-security\')">🔒 修改密码</span>' +
    '<span class="profile-act-sep">|</span>' +
    '<span class="profile-act-link profile-act-logout" onclick="handleProfileLogout()">🚪 退出登录</span>' +
    '</div>' +
    // ★ Phase 4: 订阅状态卡片
    '<div class="scheme-stats-card" id="profileSubCard" style="margin-top:8px">' +
    '<div class="profile-sub-status" id="profSubStatus">' +
    '<span id="profSubIcon">⚪</span>' +
    '<span id="profSubText">加载中...</span>' +
    '</div>' +
    '<div class="profile-sub-actions" id="profSubActions" style="margin-top:8px;display:flex;gap:8px;justify-content:center">' +
    '<span class="profile-act-link" onclick="switchTab(\'pricing\')">💎 开通会员</span>' +
    '<span class="profile-act-link" onclick="switchTab(\'subscription\')">📋 订阅管理</span>' +
    '</div>' +
    '</div>' +
    // ★ 管理后台入口（super_admin / ops_admin 可见）
    (function () {
      var s = getAuthSession();
      var roles = (s && s.roles) || [];
      if (roles.indexOf('super_admin') >= 0 || roles.indexOf('ops_admin') >= 0) {
        return '<div class="scheme-stats-card" style="margin-top:12px;cursor:pointer" onclick="switchTab(\'admin\')">' +
          '<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:4px 0">' +
          '<span style="font-size:18px">🔧</span><span style="font-size:14px;font-weight:600;color:var(--cyan)">管理后台</span>' +
          '<span style="font-size:12px;color:var(--text3);margin-left:auto">→</span>' +
          '</div></div>';
      }
      return '';
    })() +
    // ★ 卡片3：方案统计
    '<div class="scheme-stats-card" id="profileStats" style="margin-top:12px">' +
    '<div class="scheme-stat-item"><div class="scheme-stat-val" id="profStatPlans">-</div><div class="scheme-stat-lbl">历史方案</div></div>' +
    '<div class="scheme-stat-div"></div>' +
    '<div class="scheme-stat-item"><div class="scheme-stat-val" id="profStatIncome">-</div><div class="scheme-stat-lbl">方案收入(元)</div></div>' +
    '<div class="scheme-stat-div"></div>' +
    '<div class="scheme-stat-item"><div class="scheme-stat-val" id="profStatHit">-%</div><div class="scheme-stat-lbl">命中率</div></div>' +
    '</div>' +
    // ★ 卡片3：日期筛选栏
    '<div class="date-bar" id="profilePlanDateBar" style="margin-top:12px">' +
    '<span class="date-arrow" onclick="shiftProfileDate(-1)"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>' +
    '<span class="date-current" id="profilePlanDateCurrent" onclick="toggleProfileDatePicker()"></span>' +
    '<span class="date-arrow" onclick="shiftProfileDate(1)"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>' +
    '</div>' +
    // 方案列表
    '<div id="profilePlanList" style="margin-top:12px"></div>' +
    // 底部返回链接
    '<div class="auth-back-home" onclick="switchTab(\'home\')">返回首页 →</div>' +
    '</div>' +
    '</div>';
  updateProfileDateBar();
}

// ★ Phase 4: 加载订阅状态
function loadProfileSubscription() {
  api('subscription-status', {})
    .then(function (data) {
      var iconEl = document.getElementById('profSubIcon');
      var textEl = document.getElementById('profSubText');
      var actionsEl = document.getElementById('profSubActions');
      if (!iconEl || !textEl) return;

      if (data.status === 'active') {
        iconEl.textContent = '🟢';
        textEl.textContent = '已激活 · ' + (data.plan_name || '会员') + ' · 剩余 ' + (data.remaining_days || 0) + ' 天';
        if (actionsEl) actionsEl.innerHTML =
          '<span class="profile-act-link" onclick="switchTab(\'subscription\')">📋 订阅管理</span>' +
          '<span class="profile-act-link" onclick="switchTab(\'referral\')">💰 返利中心</span>';
      } else if (data.status === 'expiring_soon') {
        iconEl.textContent = '🟡';
        textEl.textContent = '即将到期 · 剩余 ' + (data.remaining_days || 0) + ' 天';
        if (actionsEl) actionsEl.innerHTML =
          '<span class="profile-act-link" onclick="switchTab(\'pricing\')">💎 续费</span>' +
          '<span class="profile-act-link" onclick="switchTab(\'subscription\')">📋 管理</span>';
      } else if (data.status === 'expired') {
        iconEl.textContent = '🔴';
        textEl.textContent = '已过期';
        if (actionsEl) actionsEl.innerHTML =
          '<span class="profile-act-link" onclick="switchTab(\'pricing\')">💎 重新订阅</span>';
      } else {
        iconEl.textContent = '⚪';
        textEl.textContent = '免费用户 · 畅享基础功能';
        if (actionsEl) actionsEl.innerHTML =
          '<span class="profile-act-link" onclick="switchTab(\'pricing\')">💎 开通会员</span>' +
          '<span class="profile-act-link" onclick="switchTab(\'referral\')">💰 邀请返利</span>';
      }
    })
    .catch(function () {
      var textEl = document.getElementById('profSubText');
      if (textEl) textEl.textContent = '(订阅查询失败)';
    });
}

// ═══ 数据加载 ═══
function loadProfileData() {
  api('my-plan-list', {})
    .then(function (data) {
      _allPlans = (data && data.plans) || [];
      var stats = (data && data.stats) || {};

      var statPlans = document.getElementById('profStatPlans');
      var statIncome = document.getElementById('profStatIncome');
      var statHit = document.getElementById('profStatHit');
      if (statPlans) statPlans.textContent = stats.totalPlans || _allPlans.length || '0';
      if (statIncome) statIncome.textContent = stats.totalIncome != null ? '+' + stats.totalIncome : '0';
      if (statHit) statHit.textContent = stats.hitRate != null ? stats.hitRate + '%' : '-%';

      renderProfilePlans();
    })
    .catch(function (e) {
      var el = document.getElementById('profilePlanList');
      if (el) el.innerHTML = '<div class="hint-box">加载失败: ' + (e && e.message) + '</div>';
    });
}

// ═══ 方案列表渲染 ═══
function renderProfilePlans() {
  var el = document.getElementById('profilePlanList');
  if (!el) return;

  _profileDate = getProfileDate();

  var filtered = _allPlans.filter(function (p) {
    var planDate = '';
    if (p.date) planDate = p.date;
    else if (p.createdAt) {
      var utcDate = new Date(p.createdAt);
      planDate =
        utcDate.getFullYear() +
        '-' +
        String(utcDate.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(utcDate.getDate()).padStart(2, '0');
    }
    return planDate === _profileDate;
  });

  if (filtered.length === 0) {
    el.innerHTML =
      '<div class="plan-notice"><span class="notice-icon">&#x1F375;</span>当日暂无方案</div>';
    return;
  }

  var cnNums = [
    '', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  ];

  var html = '';
  filtered.forEach(function (p, idx) {
    var matches = p.matches || [];
    var isWon = p.isWon === true;
    var isLose = p.isWon === false;
    var amountVal = (p.amount || 200).toFixed(0);
    var totalOdds =
      p.totalOdds ||
      matches
        .reduce(function (pr, m) {
          return pr * (Number(m.odds) || 1);
        }, 1)
        .toFixed(2);
    var prizeVal = isWon
      ? p.resultIncome != null
        ? '+' + p.resultIncome
        : '--'
      : isLose
        ? '0'
        : (function () {
            var to = Number(totalOdds) || 0;
            var amt = Number(p.amount) || 0;
            return to > 0 && amt > 0 ? Math.round(to * amt * 100) / 100 : '--';
          })();
    var statusText = isWon ? '已中奖' : isLose ? '未中奖' : '未开奖';
    var statusColor = isWon ? '#EF4444' : isLose ? '#22C55E' : 'var(--text)';
    var dateStr = (p.date || '').slice(5).replace('-', '/');
    var createdAt = p.createdAt ? p.createdAt.slice(0, 16).replace('T', ' ') : '';
    var note = p.note || '';
    var seqNum = idx + 1;
    var cnNum = seqNum <= 20 ? cnNums[seqNum] : String(seqNum);
    var planName = '方案' + cnNum;

    // 比赛行
    var matchRows = '';
    for (var mi = 0; mi < matches.length; mi++) {
      var m = matches[mi];
      var oddsStr = m.odds != null ? Number(m.odds).toFixed(2) : '--';
      var dirDisplay = m.direction || m.oddsName || '';
      if (m.playType === 'rqspf') dirDisplay = '让' + dirDisplay;
      var oddsColor = '#ffffff';
      if (m.isMatchWon === true) oddsColor = '#EF4444';
      else if (m.isMatchLose === true) oddsColor = '#22C55E';
      matchRows +=
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
        dirDisplay +
        '(' +
        oddsStr +
        ')</td>' +
        '</tr>';
    }

    // 中奖/未中印章
    var stampHtml = '';
    if (isWon)
      stampHtml =
        '<div class="plan-win-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#EF4444" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="18" font-weight="900" fill="#EF4444" transform="rotate(-10,19,19)">中</text></svg></div>';
    else if (isLose)
      stampHtml =
        '<div class="plan-lose-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#9CA3AF" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="16" font-weight="900" fill="#9CA3AF" transform="rotate(-10,19,19)">未中</text></svg></div>';

    html +=
      '<div class="plan-card" id="upcard-' +
      p.id +
      '">' +
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
      '</div></div>' +
      '<div class="plan-amount-row">' +
      '<div class="plan-amount-col"><div class="plan-amount-label">方案金额</div><div class="plan-amount-value" style="color:#EF4444;">' +
      amountVal +
      '<span class="unit">元</span></div></div>' +
      '<div class="plan-amount-col"><div class="plan-amount-label">预计最高奖金</div><div class="plan-amount-value" style="color:#EF4444;">' +
      prizeVal +
      '<span class="unit">元</span></div></div>' +
      '<div class="plan-amount-col"><div class="plan-amount-label">方案状态</div><div class="plan-amount-value" style="color:' +
      statusColor +
      ';">' +
      statusText +
      '</div>' + stampHtml + '</div>' +
      '</div>' +
      '<div class="plan-divider"></div>' +
      '<div class="plan-match-section"><table class="plan-match-table"><tbody>' +
      matchRows +
      '</tbody></table></div>' +
      '<div class="mp-actions">' +
      '<span class="mp-delete-btn" onclick="deleteProfilePlan(\'' +
      p.id +
      '\')">🗑 删除</span>' +
      '<span class="mp-share-btn" onclick="sharePlanCard(\'' +
      p.id +
      '\')">✨ 分享</span>' +
      '</div>' +
      '</div>';
  });
  el.innerHTML = html;
}

// ═══ 删除确认弹窗 ═══
function _confirmDelete(planId, planName, onSuccess) {
  var overlay = document.createElement('div');
  overlay.className = 'del-overlay active';
  overlay.innerHTML =
    '<div class="del-modal">' +
    '<div class="del-modal-head">' +
    '<span class="del-modal-icon">⚠️</span>' +
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

window.deleteProfilePlan = function (planId) {
  var card = document.getElementById('upcard-' + planId);
  var nameEl = card ? card.querySelector('.plan-name') : null;
  var planName = nameEl ? nameEl.textContent.trim() : '';
  _confirmDelete(planId, planName, function () {
    // 从本地列表移除后重新渲染
    _allPlans = _allPlans.filter(function (p) {
      return p.id !== planId;
    });
    renderProfilePlans();
  });
};

// ═══ 退出登录 ═══
window.handleProfileLogout = function () {
  api('auth-logout', {}, 0).catch(function () {});
  clearAuthAll();
  if (typeof window.switchTab === 'function') window.switchTab('login');
};

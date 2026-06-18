import { api } from '../api.js';
import { formatDate } from '../utils.js';
import { getAuthSession, clearAuthAll, hasAuthToken, hasReferralAccess } from '../auth-client.js';

var _profilePlanFilter = 'today';
var _allPlans = [];

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getDateByOffset(offset) {
  var d = new Date();
  d.setDate(d.getDate() + offset);
  return formatDate(d);
}

function getPlanDateValue(plan) {
  if (!plan) return '';
  if (plan.date) return plan.date;
  if (!plan.createdAt) return '';
  var dt = new Date(plan.createdAt);
  if (Number.isNaN(dt.getTime())) return '';
  return (
    dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0')
  );
}

function formatProfileMoney(value) {
  var num = Number(value);
  if (!Number.isFinite(num)) num = 0;
  var sign = num < 0 ? '-' : '';
  var abs = Math.round(Math.abs(num) * 100) / 100;
  var text = String(abs)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1');
  return sign + '¥' + text;
}

function formatProfileRate(value) {
  var num = Number(value);
  if (!Number.isFinite(num)) num = 0;
  return (Math.round(num * 10) / 10).toString().replace(/\.0$/, '') + '%';
}

function getProfileIcon(name) {
  if (name === 'home') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4.5v-5.5h3V21H18a1 1 0 0 0 1-1V9.5"/></svg>';
  }
  if (name === 'subscription') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>';
  }
  if (name === 'referral') {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm6 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3ZM9 13c-3.33 0-6 1.79-6 4v1h12v-1c0-2.21-2.67-4-6-4Zm6 0c-.39 0-.77.03-1.13.09A5.8 5.8 0 0 1 18 18v1h3v-1c0-2.21-2.69-4-6-4Z"/></svg>';
  }
  if (name === 'pricing') {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 4 8l3 10h10l3-10-8-5Zm0 2.3 4.62 2.88-1.96 6.52H9.34L7.38 8.18 12 5.3Z"/></svg>';
  }
  if (name === 'crown') {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.2 18.5c-.6 0-1-.5-.9-1.1l1.2-8c.1-.7 1-.9 1.5-.3l3.1 3.4 3.2-5.4c.4-.7 1.4-.7 1.8 0l3.2 5.4 3.1-3.4c.5-.6 1.4-.4 1.5.3l1.2 8c.1.6-.3 1.1-.9 1.1H5.2Zm1.7-2h10.2l-.5-3.5-2.2 2.4a1 1 0 0 1-1.6-.1L12 11.7l-1.8 3.1a1 1 0 0 1-1.6.1L6.4 13l-.5 3.5Z"/></svg>';
  }
  if (name === 'admin') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.33-1 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1-.33 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .33 1 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.26.3.46.65.6 1 .1.32.36.6.69.75.23.1.48.16.74.16H21a2 2 0 1 1 0 4h-.09c-.26 0-.51.06-.74.16-.33.15-.59.43-.69.75-.14.35-.34.7-.6 1Z"/></svg>';
  }
  if (name === 'lock') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="3"/><path d="M8 11V8a4 4 0 1 1 8 0v3"/></svg>';
  }
  if (name === 'logout') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>';
  }
  if (name === 'plans') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8a2 2 0 0 1 2 2v14H6V5a2 2 0 0 1 2-2Z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>';
  }
  if (name === 'income') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M9.5 9.5c0-1.1 1-2 2.5-2s2.5.9 2.5 2-1 1.7-2.5 2-2.5.9-2.5 2 1 2 2.5 2 2.5-.9 2.5-2M12 6.5v11"/></svg>';
  }
  if (name === 'hit') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12l5-5"/></svg>';
  }
  if (name === 'effort') {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4.5 14h5l-1 8 9.5-12H13l1-8z"/></svg>';
  }
  return '';
}

function buildProfileHubCard(tab, title, iconName, extraClass) {
  return (
    '' +
    '<button class="profile-entry-card' +
    (extraClass ? ' ' + extraClass : '') +
    '" type="button" onclick="switchTab(\'' +
    tab +
    '\')">' +
    '<span class="profile-entry-icon">' +
    getProfileIcon(iconName) +
    '</span>' +
    '<span class="profile-entry-title">' +
    title +
    '</span>' +
    '</button>'
  );
}

function buildProfileMembershipActions(primaryTab, primaryText) {
  return (
    '' +
    '<button class="profile-membership-btn is-primary" type="button" onclick="switchTab(\'' +
    primaryTab +
    '\')">' +
    primaryText +
    '</button>'
  );
}

function hasAdminRole() {
  var session = getAuthSession() || {};
  var roles = session.roles || [];
  return roles.indexOf('super_admin') >= 0 || roles.indexOf('ops_admin') >= 0 || roles.indexOf('admin') >= 0;
}

function renderAdminShortcut() {
  if (!hasAdminRole()) return '';
  return buildProfileHubCard('admin', '管理后台', 'admin', 'profile-entry-card-admin');
}

function updateProfilePlanFilterTabs() {
  var tabs = document.querySelectorAll('.profile-filter-btn');
  for (var i = 0; i < tabs.length; i++) {
    var isActive = tabs[i].getAttribute('data-filter') === _profilePlanFilter;
    tabs[i].classList.toggle('is-active', isActive);
  }
}

window.switchProfilePlanFilter = function (filter) {
  if (['yesterday', 'today', 'all'].indexOf(filter) < 0) return;
  _profilePlanFilter = filter;
  updateProfilePlanFilterTabs();
  renderProfilePlans();
};

export function loadProfile() {
  var root = document.getElementById('profileContent');
  if (!root) return;

  var session = getAuthSession() || {};
  var userName = (session.user && session.user.username) || '-';

  // ★ 修复：未登录显示引导，避免空白页（token 存在 localStorage.auth_token，不在 session 对象中）
  if (!session || !session.user || !hasAuthToken()) {
    root.innerHTML =
      '<div class="profile-shell-v2" style="padding:60px 20px;text-align:center">' +
      '<div style="font-size:64px;margin-bottom:16px">🔒</div>' +
      '<div style="font-size:18px;font-weight:700;color:#111;margin-bottom:8px">请先登录</div>' +
      '<div style="font-size:14px;color:#666;margin-bottom:24px">登录后可查看个人中心、历史方案和会员状态</div>' +
      '<button onclick="switchTab(\'login\')" style="display:inline-flex;align-items:center;justify-content:center;padding:12px 32px;border:none;border-radius:12px;background:linear-gradient(135deg,#1f7a68,#2ecc71);color:#fff;font-size:16px;font-weight:700;cursor:pointer">立即登录</button>' +
      '</div>';
    return;
  }

  _profilePlanFilter = 'today';
  _allPlans = [];

  renderLayout(root, userName);
  loadProfileData();
  loadProfileSubscription();
}

function renderLayout(root, userName) {
  root.innerHTML =
    '' +
    '<div class="auth-shell auth-shell-account profile-shell profile-shell-v2">' +
    '<div class="login-hero account-login-hero profile-hero">' +
    '<button class="profile-home-corner" type="button" onclick="switchTab(\'home\')" aria-label="返回首页" title="返回首页">返回首页</button>' +
    '<div class="login-hero-copy profile-hero-copy">' +
    '<div class="login-hero-title">个人中心</div>' +
    '<div class="login-hero-subtitle">当前账号：' +
    escapeHtml(userName) +
    '</div>' +
    '</div>' +
    '<img class="login-eagle profile-eagle" src="/laoying11.png" alt="" loading="eager" decoding="async" />' +
    '</div>' +
    '<div class="auth-card auth-login-card auth-account-card profile-account-card profile-account-card-v2">' +
    '<div class="profile-status-card profile-membership-card status-free" id="profileSubCard">' +
    '<div class="profile-status-main">' +
    '<span class="profile-status-flag"><span class="profile-status-crown" aria-hidden="true">' +
    getProfileIcon('crown') +
    '</span></span>' +
    '<span class="profile-status-copy">' +
    '<span class="profile-status-label">会员状态</span>' +
    '<span class="profile-status-value" id="profSubText">未开通会员</span>' +
    '</span>' +
    '</div>' +
    '<div class="profile-membership-actions" id="profSubActions">' +
    buildProfileMembershipActions('pricing', '立即开通') +
    '</div>' +
    '</div>' +
    '<div class="profile-entry-grid">' +
    buildProfileHubCard('subscription', '订阅中心', 'subscription') +
    (hasReferralAccess()
      ? buildProfileHubCard('referral', '邀请返利', 'referral')
      : buildProfileHubCard('referral', '邀请好友', 'referral')) +
    buildProfileHubCard('pricing', '会员套餐', 'pricing') +
    renderAdminShortcut() +
    '</div>' +
    '<div class="profile-stats-panel" id="profileStats">' +
    '<div class="profile-stat-item">' +
    '<div class="profile-stat-label">历史方案</div>' +
    '<div class="profile-stat-value" id="profStatPlans">0</div>' +
    '</div>' +
    '<div class="profile-stat-item profile-stat-item-income">' +
    '<div class="profile-stat-label">方案收入</div>' +
    '<div class="profile-stat-value" id="profStatIncome">¥0</div>' +
    '</div>' +
    '<div class="profile-stat-item profile-stat-item-hit">' +
    '<div class="profile-stat-label">命中率</div>' +
    '<div class="profile-stat-value" id="profStatHit">0%</div>' +
    '</div>' +
    '</div>' +
    '<div class="profile-history-section">' +
    '<div class="profile-plan-head">' +
    '<div class="profile-plan-title">我的历史方案</div>' +
    '</div>' +
    '<div class="profile-filter-bar">' +
    '<button class="profile-filter-btn" type="button" data-filter="yesterday" onclick="switchProfilePlanFilter(\'yesterday\')">昨天</button>' +
    '<button class="profile-filter-btn" type="button" data-filter="today" onclick="switchProfilePlanFilter(\'today\')">今天</button>' +
    '<button class="profile-filter-btn" type="button" data-filter="all" onclick="switchProfilePlanFilter(\'all\')">全部</button>' +
    '</div>' +
    '<div id="profilePlanList" class="profile-plan-list"></div>' +
    '</div>' +
    '<div class="profile-setting-list">' +
    '<button class="profile-setting-row" type="button" onclick="switchTab(\'account-security\')">' +
    '<span class="profile-setting-icon is-blue">' +
    getProfileIcon('lock') +
    '</span>' +
    '<span class="profile-setting-title">修改密码</span>' +
    '<span class="profile-setting-arrow">›</span>' +
    '</button>' +
    '<button class="profile-setting-row profile-setting-row-logout" type="button" onclick="handleProfileLogout()">' +
    '<span class="profile-setting-icon is-red">' +
    getProfileIcon('logout') +
    '</span>' +
    '<span class="profile-setting-title">退出登录</span>' +
    '<span class="profile-setting-arrow">›</span>' +
    '</button>' +
    '</div>' +
    '</div>' +
    '</div>';

  updateProfilePlanFilterTabs();
}

function loadProfileSubscription() {
  api('subscription-status', {}, 0)
    .then(function (data) {
      var cardEl = document.getElementById('profileSubCard');
      var textEl = document.getElementById('profSubText');
      var actionsEl = document.getElementById('profSubActions');
      if (!textEl || !actionsEl) return;

      if (cardEl) {
        cardEl.classList.remove('status-active', 'status-expiring', 'status-expired', 'status-free');
      }

      if (data.status === 'active') {
        if (cardEl) cardEl.classList.add('status-active');
        textEl.textContent = '已开通会员';
        actionsEl.innerHTML = buildProfileMembershipActions('subscription', '会员中心');
      } else if (data.status === 'expiring_soon') {
        if (cardEl) cardEl.classList.add('status-expiring');
        textEl.textContent = '会员即将到期';
        actionsEl.innerHTML = buildProfileMembershipActions('pricing', '立即续费');
      } else if (data.status === 'expired') {
        if (cardEl) cardEl.classList.add('status-expired');
        textEl.textContent = '会员已过期';
        actionsEl.innerHTML = buildProfileMembershipActions('pricing', '重新开通');
      } else {
        if (cardEl) cardEl.classList.add('status-free');
        textEl.textContent = '未开通会员';
        actionsEl.innerHTML = buildProfileMembershipActions('pricing', '立即开通');
      }
    })
    .catch(function () {
      var cardEl = document.getElementById('profileSubCard');
      var textEl = document.getElementById('profSubText');
      var actionsEl = document.getElementById('profSubActions');
      if (cardEl) {
        cardEl.classList.remove('status-active', 'status-expiring', 'status-expired');
        cardEl.classList.add('status-free');
      }
      if (textEl) textEl.textContent = '状态同步失败';
      if (actionsEl) actionsEl.innerHTML = buildProfileMembershipActions('subscription', '查看会员');
    });
}

function loadProfileData() {
  api('my-plan-list', {}, 0)
    .then(function (data) {
      _allPlans = (data && data.plans) || [];
      var stats = (data && data.stats) || {};

      var statPlans = document.getElementById('profStatPlans');
      var statIncome = document.getElementById('profStatIncome');
      var statHit = document.getElementById('profStatHit');
      if (statPlans)
        statPlans.textContent = String(stats.totalPlans != null ? stats.totalPlans : _allPlans.length || 0);
      if (statIncome) statIncome.textContent = formatProfileMoney(stats.totalIncome);
      if (statHit) statHit.textContent = formatProfileRate(stats.hitRate);

      renderProfilePlans();
    })
    .catch(function (e) {
      var el = document.getElementById('profilePlanList');
      if (el) el.innerHTML = '<div class="hint-box">加载失败: ' + escapeHtml((e && e.message) || '未知错误') + '</div>';
    });
}

function renderProfilePlans() {
  var el = document.getElementById('profilePlanList');
  if (!el) return;

  var today = getDateByOffset(0);
  var yesterday = getDateByOffset(-1);
  var filtered = _allPlans.filter(function (p) {
    var planDate = getPlanDateValue(p);
    if (_profilePlanFilter === 'today') return planDate === today;
    if (_profilePlanFilter === 'yesterday') return planDate === yesterday;
    return true;
  });

  filtered.sort(function (a, b) {
    var ad = (a.createdAt || a.date || '').toString();
    var bd = (b.createdAt || b.date || '').toString();
    return bd.localeCompare(ad);
  });

  if (filtered.length === 0) {
    el.innerHTML =
      '' +
      '<div class="profile-history-empty">' +
      '<div class="profile-history-empty-icon">' +
      getProfileIcon('effort') +
      '</div>' +
      '<div class="profile-history-empty-title">大家都等着你的方案呢</div>' +
      '</div>';
    return;
  }

  var cnNums = [
    '',
    '一',
    '二',
    '三',
    '四',
    '五',
    '六',
    '七',
    '八',
    '九',
    '十',
    '十一',
    '十二',
    '十三',
    '十四',
    '十五',
    '十六',
    '十七',
    '十八',
    '十九',
    '二十',
  ];

  var html = '';
  filtered.forEach(function (p, idx) {
    var matches = p.matches || [];
    var isWon = p.isWon === true;
    var isLose = p.isWon === false;
    var amountNum = Number(p.amount || 200);
    var amountVal = Math.round(amountNum);
    var totalOdds =
      p.totalOdds ||
      matches
        .reduce(function (pr, m) {
          return pr * (Number(m.odds) || 1);
        }, 1)
        .toFixed(2);
    var prizeVal = isWon
      ? p.resultIncome != null
        ? formatProfileMoney(p.resultIncome)
        : '--'
      : isLose
        ? '¥0'
        : (function () {
            var to = Number(totalOdds) || 0;
            var amt = Number(p.amount) || 0;
            return to > 0 && amt > 0 ? formatProfileMoney(Math.round(to * amt * 100) / 100) : '--';
          })();
    var statusText = isWon ? '已中奖' : isLose ? '未中奖' : '未开奖';
    var statusCls = isWon ? 'plan-status-won' : isLose ? 'plan-status-lost' : 'plan-status-pending';
    var planDate = getPlanDateValue(p);
    var dateStr = planDate ? planDate.slice(5).replace('-', '/') : '--/--';
    var createdAt = p.createdAt ? p.createdAt.slice(0, 16).replace('T', ' ') : '';
    var seqNum = idx + 1;
    var cnNum = seqNum <= 20 ? cnNums[seqNum] : String(seqNum);
    var planName = '方案' + cnNum;

    var matchRows = '';
    for (var mi = 0; mi < matches.length; mi++) {
      var m = matches[mi];
      var oddsStr = m.odds != null ? Number(m.odds).toFixed(2) : '--';
      var dirDisplay = m.direction || m.oddsName || '';
      if (m.playType === 'rqspf') dirDisplay = '让' + dirDisplay;
      // ★ V17: 单关双选方向展开 + 多方向拆行
      if (dirDisplay === '胜平') dirDisplay = '胜、平';
      else if (dirDisplay === '平负') dirDisplay = '平、负';
      var dirParts = dirDisplay ? dirDisplay.split(/[、，,]/) : [dirDisplay];
      var subResults = m.subResults || [];
      for (var di = 0; di < dirParts.length; di++) {
        var subDir = (dirParts[di] || '').trim();
        if (!subDir) continue;
        // ★ V17: 逐方向颜色 — 命中红 / 未中绿 / 未开队名色
        var subR = null;
        for (var si = 0; si < subResults.length; si++) {
          if (subResults[si].direction === subDir) { subR = subResults[si]; break; }
        }
        var dirCls = '';
        if (subR && subR.result !== null && subR.result !== undefined) {
          dirCls = subR.result === 1 ? ' plan-direction-hit' : subR.result === -1 ? ' plan-direction-undetermined' : ' plan-direction-miss';
        }
        var fullDir = escapeHtml(subDir) + '(' + oddsStr + ')';
        if (di === 0) {
          matchRows +=
            '<tr>' +
            '<td class="match-info-col"><span class="match-num-text">' +
            escapeHtml(m.matchNum || '') +
            '</span></td>' +
            '<td class="team-col"><span class="plan-team-home">' +
            escapeHtml(m.homeName || '') +
            '</span><span class="plan-team-vs">vs</span><span class="plan-team-away">' +
            escapeHtml(m.visitName || '') +
            '</span></td>' +
            '<td class="odds-col' + dirCls + '">' + fullDir + '</td>' +
            '</tr>';
        } else {
          matchRows +=
            '<tr>' +
            '<td class="match-info-col"></td>' +
            '<td class="team-col"></td>' +
            '<td class="odds-col' + dirCls + '">' + fullDir + '</td>' +
            '</tr>';
        }
      }
    }

    var stampHtml = '';
    if (isWon) {
      stampHtml =
        '<div class="plan-win-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#EF4444" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="18" font-weight="900" fill="#EF4444" transform="rotate(-10,19,19)">中</text></svg></div>';
    } else if (isLose) {
      stampHtml =
        '<div class="plan-lose-stamp"><svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="none" stroke="#9CA3AF" stroke-width="2"/><text x="19" y="25" text-anchor="middle" font-size="16" font-weight="900" fill="#9CA3AF" transform="rotate(-10,19,19)">未中</text></svg></div>';
    }

    html +=
      '' +
      '<div class="plan-card" id="upcard-' +
      p.id +
      '">' +
      '<div class="plan-card-head">' +
      '<div class="plan-left">' +
      '<div class="plan-soccer-icon">⚽</div>' +
      '<div><div class="plan-name">' +
      planName +
      '</div><div class="plan-pub-time">' +
      dateStr +
      (createdAt ? ' · ' + createdAt : '') +
      '</div></div>' +
      '</div></div>' +
      '<div class="plan-amount-row">' +
      '<div class="plan-amount-col"><div class="plan-amount-label">方案金额</div><div class="plan-amount-value plan-money-value">' +
      amountVal +
      '<span class="unit">元</span></div></div>' +
      '<div class="plan-amount-col"><div class="plan-amount-label">预计最高奖金</div><div class="plan-amount-value plan-money-value">' +
      prizeVal +
      '</div></div>' +
      '<div class="plan-amount-col"><div class="plan-amount-label">方案状态</div><div class="plan-amount-value ' +
      statusCls +
      '">' +
      statusText +
      '</div>' +
      stampHtml +
      '</div>' +
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

function _confirmDelete(planId, planName, onSuccess) {
  var overlay = document.createElement('div');
  overlay.className = 'del-overlay active';
  overlay.innerHTML =
    '' +
    '<div class="del-modal">' +
    '<div class="del-modal-head"><span class="del-modal-icon">⚠️</span><span class="del-modal-title">确认删除</span></div>' +
    '<div class="del-modal-body"><p>' +
    (planName ? '确定删除方案「' + planName + '」吗？' : '确定删除这个方案吗？') +
    '</p><p class="del-modal-sub">删除后无法恢复</p></div>' +
    '<div class="del-modal-foot"><button class="del-btn-cancel">取消</button><button class="del-btn-confirm">确认删除</button></div>' +
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
    api('my-plan-delete', { planId: planId }, 0)
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
    _allPlans = _allPlans.filter(function (p) {
      return p.id !== planId;
    });
    renderProfilePlans();
  });
};

window.handleProfileLogout = function () {
  api('auth-logout', {}, 0).catch(function () {});
  clearAuthAll();
  if (typeof window.switchTab === 'function') window.switchTab('login');
};

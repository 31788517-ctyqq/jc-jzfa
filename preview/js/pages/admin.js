/**
 * preview/js/pages/admin.js
 * 统一移动端管理后台 — 4 Tab: 用户 / 订阅 / 返利 / 系统
 *
 * 权限: super_admin 全功能; ops_admin 用户只读 + 系统运维
 * API 调用统一用新签名 api(action, data)，token 由 auth-client 自动注入
 */

import { api } from '../api.js';
import { getAuthSession } from '../auth-client.js';

// ═══════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════

var _currentTab = 'users';
var _container = null;
var ADMIN_ASSET_VERSION = '202606122040';

function _adminHomeIcon() {
  return '<svg class="adm-home-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4.5v-5.5h3V21H18a1 1 0 0 0 1-1V9.5"/></svg>';
}

function _admIcon(name) {
  var icons = {
    users:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/><path d="M18.5 9.5a3 3 0 0 1 0 6"/><path d="M20 19a5 5 0 0 0-3-4"/></svg>',
    payments:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 9l-8 12L4 9l8-6Z"/><path d="M4 9h16"/><path d="m9 9 3 12 3-12"/></svg>',
    referrals:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18"/><path d="M17 7.5c0-1.9-2-3-5-3s-5 1.1-5 3 1.7 2.8 5 3.5 5 1.6 5 3.5-2 3-5 3-5-1.1-5-3"/></svg>',
    system:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"/><path d="M19.4 15a8.5 8.5 0 0 0 .1-1.2 8.5 8.5 0 0 0-.1-1.3l2-1.5-2-3.5-2.4 1a8.3 8.3 0 0 0-2.2-1.3L14.5 4h-5l-.3 3.2A8.3 8.3 0 0 0 7 8.5l-2.4-1-2 3.5 2 1.5a8.5 8.5 0 0 0-.1 1.3c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a8.3 8.3 0 0 0 2.2 1.3l.3 3.2h5l.3-3.2a8.3 8.3 0 0 0 2.2-1.3l2.4 1 2-3.5-2-1.5Z"/></svg>',
    avatar:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z"/><path d="M4.6 21a7.4 7.4 0 0 1 14.8 0"/></svg>',
    role: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.9 8 7 10 4.1-2 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/></svg>',
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l11-7-11-7Z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z"/></svg>',
    svc_data:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 4v4M12 10v4M16 16v4"/></svg>',
    svc_cache:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v10H4z"/><path d="M8 7V5h8v2"/><path d="M8 17v2h8v-2"/></svg>',
    svc_ai:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 4.5A3.5 3.5 0 0 0 6 8v3a4 4 0 0 1-1.2 2.9L4 15h16l-.8-1.1A4 4 0 0 1 18 11V8a3.5 3.5 0 0 0-3.5-3.5"/><path d="M9 19a3 3 0 0 0 6 0"/></svg>',
  };
  return icons[name] || '';
}

function _ensureAdminCss() {
  var href = '/css/admin-v2.css?v=' + ADMIN_ASSET_VERSION;
  var links = document.querySelectorAll('link[rel="stylesheet"]');
  for (var i = 0; i < links.length; i++) {
    if ((links[i].getAttribute('href') || '').indexOf('/css/admin-v2.css') >= 0) {
      if (links[i].getAttribute('href') !== href) links[i].setAttribute('href', href);
      return;
    }
  }
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function _hasPerm(code) {
  var s = getAuthSession();
  if (!s) return false;
  var roles = s.roles || [];
  if (roles.indexOf('super_admin') >= 0) return true;
  var perms = s.permissions || [];
  return perms.indexOf(code) >= 0 || perms.indexOf('*') >= 0;
}

function _isAdmin() {
  var s = getAuthSession();
  var roles = (s && s.roles) || [];
  return roles.indexOf('super_admin') >= 0 || roles.indexOf('ops_admin') >= 0;
}

function _toast(msg, ms) {
  var old = document.querySelector('.adm-toast');
  if (old) old.remove();
  var el = document.createElement('div');
  el.className = 'adm-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function () {
    el.remove();
  }, ms || 2500);
}

function _showSheet(title, bodyHtml) {
  _closeSheet();
  var overlay = document.createElement('div');
  overlay.className = 'adm-overlay';
  overlay.id = 'admOverlay';
  overlay.innerHTML =
    '<div class="adm-sheet" style="position:relative">' +
    '<div class="adm-sheet-close" id="admSheetClose">&times;</div>' +
    '<div class="adm-sheet-title">' +
    title +
    '</div>' +
    '<div id="admSheetBody">' +
    bodyHtml +
    '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) _closeSheet();
  });
  document.getElementById('admSheetClose').addEventListener('click', _closeSheet);
}

function _closeSheet() {
  var el = document.getElementById('admOverlay');
  if (el) el.remove();
}

function _fmtDate(iso) {
  if (!iso) return '--';
  return iso.slice(0, 10);
}

function _cnErrorLine(line) {
  var text = String(line || '');
  var rules = [
    [/error/gi, '错误'],
    [/failed/gi, '失败'],
    [/timeout/gi, '超时'],
    [/connection refused/gi, '连接被拒绝'],
    [/connection reset/gi, '连接重置'],
    [/not found/gi, '未找到'],
    [/forbidden/gi, '无权限'],
    [/unauthorized/gi, '未授权'],
    [/internal server error/gi, '服务内部错误'],
    [/bad gateway/gi, '网关异常'],
    [/service unavailable/gi, '服务不可用'],
    [/database/gi, '数据库'],
    [/cache/gi, '缓存'],
    [/request/gi, '请求'],
    [/response/gi, '响应'],
    [/warning/gi, '警告'],
    [/exception/gi, '异常'],
  ];
  for (var i = 0; i < rules.length; i++) {
    text = text.replace(rules[i][0], rules[i][1]);
  }
  return text;
}

var _statusCN = {
  active: '正常',
  disabled: '禁用',
  locked: '锁定',
  expiring_soon: '即将到期',
  expired: '已过期',
  pending: '待处理',
  submitted: '已提交',
  settled: '已结算',
  paid: '已打款',
  rejected: '已驳回',
  completed: '已完成',
  cancelled: '已取消',
};

var _roleCN = {
  super_admin: '超级管理员',
  ops_admin: '运维管理员',
  analyst: '分析员',
  viewer: '访客',
};

var _planCN = {
  monthly: '月度套餐',
  quarterly: '季度套餐',
  yearly: '年度套餐',
};

var _sourceCN = {
  manual: '手动开通',
  system: '系统发放',
  wechat_pay: '微信支付',
};

var _withdrawMethodCN = {
  bank_card: '银行卡',
  wechat: '微信',
};

function _statusHtml(status) {
  var text = _statusCN[status] || (status ? '未知状态' : '--');
  return '<span class="adm-status adm-status-' + status + '">' + text + '</span>';
}

function _roleHtml(role) {
  var text = _roleCN[role] || (role ? '未知角色' : '--');
  return '<span class="adm-role adm-role-' + role + '">' + text + '</span>';
}

// ═══════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════

export function loadAdmin(container) {
  _ensureAdminCss();
  _container = container;
  if (!_isAdmin()) {
    _toast('无权限');
    if (typeof window.switchTab === 'function') window.switchTab('home');
    return;
  }

  var tab = 'users';
  try {
    var pending = sessionStorage.getItem('pendingAdminTab');
    if (pending) {
      tab = pending;
      sessionStorage.removeItem('pendingAdminTab');
    }
  } catch (e) {
    /* ignore */
  }

  var s = getAuthSession() || {};
  var roles = s.roles || [];
  var roleCode =
    roles.indexOf('super_admin') >= 0
      ? 'super_admin'
      : roles.indexOf('ops_admin') >= 0
        ? 'ops_admin'
        : roles[0] || 'viewer';

  container.innerHTML =
    '<div class="adm-wrap">' +
    '<div class="adm-hero">' +
    '<button class="adm-profile-back" type="button" onclick="switchTab(\'profile\')" aria-label="返回个人中心" title="返回个人中心">' +
    _adminHomeIcon() +
    '</button>' +
    '<div class="adm-hero-kicker">管理中枢</div>' +
    '<div class="adm-hero-head"><div class="adm-hero-title">移动端管理后台</div>' +
    _roleHtml(roleCode) +
    '</div>' +
    '<div class="adm-hero-desc">统一处理用户、订阅、返利与系统运维</div>' +
    '</div>' +
    '<div class="adm-tabs" id="admTabs"></div>' +
    '<div id="admPanel"></div>' +
    '</div>';

  _renderTabs(tab);
  _switchTab(tab);
}

function _renderTabs(active) {
  var tabs = [
    { key: 'users', icon: _admIcon('users'), label: '用户' },
    { key: 'payments', icon: _admIcon('payments'), label: '订阅' },
    { key: 'referrals', icon: _admIcon('referrals'), label: '返利' },
    { key: 'system', icon: _admIcon('system'), label: '系统' },
  ];

  var html = '';
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    html +=
      '<div class="adm-tab' +
      (t.key === active ? ' active' : '') +
      '" data-tab="' +
      t.key +
      '"><span class="adm-tab-icon">' +
      t.icon +
      '</span><span>' +
      t.label +
      '</span></div>';
  }
  var el = document.getElementById('admTabs');
  if (el) {
    el.innerHTML = html;
    el.addEventListener('click', function (e) {
      var tab = e.target.closest('.adm-tab');
      if (tab && tab.dataset.tab) _switchTab(tab.dataset.tab);
    });
  }
}

function _switchTab(tab) {
  _currentTab = tab;
  document.querySelectorAll('.adm-tab').forEach(function (el) {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  var panel = document.getElementById('admPanel');
  if (!panel) return;
  panel.innerHTML = '<div class="adm-loading">加载中...</div>';

  switch (tab) {
    case 'users':
      _renderUsersTab(panel);
      break;
    case 'payments':
      _renderPaymentsTab(panel);
      break;
    case 'referrals':
      _renderReferralsTab(panel);
      break;
    case 'system':
      _renderSystemTab(panel);
      break;
    default:
      panel.innerHTML = '<div class="adm-loading">未知页面</div>';
  }
}

// ═══════════════════════════════════════════════════════
// Tab 1: 用户管理
// ═══════════════════════════════════════════════════════

var _allUsers = [];

async function _renderUsersTab(panel) {
  try {
    _allUsers = await api('user-list', {});
  } catch (e) {
    panel.innerHTML = '<div class="adm-loading">加载失败: ' + (e.message || e) + '</div>';
    return;
  }

  var total = _allUsers.length;
  var disabled = _allUsers.filter(function (u) {
    return u.status === 'disabled';
  }).length;
  var today = new Date().toISOString().slice(0, 10);
  var todayNew = _allUsers.filter(function (u) {
    return (u.createdAt || '').slice(0, 10) === today;
  }).length;

  var canWrite = _hasPerm('user:create');

  panel.innerHTML =
    '<div class="adm-stats">' +
    '<div class="adm-stat adm-stat-users"><div class="adm-stat-icon">' +
    _admIcon('users') +
    '</div><div class="adm-stat-num">' +
    total +
    '</div><div class="adm-stat-lbl">总用户</div></div>' +
    '<div class="adm-stat adm-stat-new"><div class="adm-stat-icon">' +
    _admIcon('avatar') +
    '</div><div class="adm-stat-num">' +
    todayNew +
    '</div><div class="adm-stat-lbl">今日新增</div></div>' +
    '<div class="adm-stat adm-stat-disabled"><div class="adm-stat-icon">' +
    _admIcon('stop') +
    '</div><div class="adm-stat-num">' +
    disabled +
    '</div><div class="adm-stat-lbl">已禁用</div></div>' +
    '</div>' +
    '<div class="adm-filter">' +
    '<input class="adm-search" id="admUserSearch" placeholder="搜索用户名或用户ID..." />' +
    '<select class="adm-select" id="admUserFilter">' +
    '<option value="">全部</option><option value="active">正常</option>' +
    '<option value="disabled">禁用</option><option value="locked">锁定</option>' +
    '</select>' +
    '</div>' +
    '<div class="adm-list" id="admUserList"></div>' +
    (canWrite
      ? '<div class="adm-actions">' +
        '<button class="adm-btn adm-btn-primary" id="admCreateUser">创建用户</button>' +
        '<button class="adm-btn adm-btn-ghost" id="admRoleMgmt">角色权限管理</button>' +
        '</div>'
      : '');

  _filterUsers();

  var searchEl = document.getElementById('admUserSearch');
  var filterEl = document.getElementById('admUserFilter');
  var debounceTimer;
  if (searchEl)
    searchEl.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(_filterUsers, 200);
    });
  if (filterEl) filterEl.addEventListener('change', _filterUsers);

  var createBtn = document.getElementById('admCreateUser');
  if (createBtn) createBtn.addEventListener('click', _showCreateUser);
  var roleBtn = document.getElementById('admRoleMgmt');
  if (roleBtn) roleBtn.addEventListener('click', _showRoleMgmt);
}

function _filterUsers() {
  var q = (document.getElementById('admUserSearch') || {}).value || '';
  q = q.trim().toLowerCase();
  var status = (document.getElementById('admUserFilter') || {}).value || '';
  var canWrite = _hasPerm('user:disable');
  var canRole = _hasPerm('role:assign');
  var canReferral = _hasPerm('referral:admin');

  var filtered = _allUsers.filter(function (u) {
    if (status && u.status !== status) return false;
    if (q && u.username.toLowerCase().indexOf(q) < 0 && String(u.id).indexOf(q) < 0) return false;
    return true;
  });

  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var u = filtered[i];
    var rolesHtml = (u.roles || []).map(_roleHtml).join(' ') || _roleHtml('viewer');

    var actions = '';
    if (canRole)
      actions +=
        '<button class="adm-btn adm-btn-ghost adm-btn-sm" data-action="editRole" data-uid="' +
        u.id +
        '">' +
        _admIcon('role') +
        '编辑角色</button>';
    actions +=
      '<button class="adm-btn adm-btn-ghost adm-btn-sm" data-action="detail" data-uid="' +
      u.id +
      '">' +
      _admIcon('list') +
      '查看详情</button>';
    if (canWrite) {
      if (u.status === 'active')
        actions +=
          '<button class="adm-btn adm-btn-danger adm-btn-sm" data-action="disable" data-uid="' +
          u.id +
          '">' +
          _admIcon('stop') +
          '禁用</button>';
      else if (u.status === 'disabled')
        actions +=
          '<button class="adm-btn adm-btn-primary adm-btn-sm" data-action="enable" data-uid="' +
          u.id +
          '">' +
          _admIcon('play') +
          '启用</button>';
      if (u.status === 'locked')
        actions +=
          '<button class="adm-btn adm-btn-primary adm-btn-sm" data-action="unlock" data-uid="' +
          u.id +
          '">' +
          _admIcon('play') +
          '解锁</button>';
    }

    // ★ 返利权限开关
    if (canReferral) {
      actions +=
        '<button class="adm-btn adm-btn-sm ' +
        (u.referralEnabled ? 'adm-btn-warn' : 'adm-btn-primary') +
        '" data-action="toggleReferral" data-uid="' +
        u.id +
        '" data-enabled="' +
        (u.referralEnabled ? '1' : '0') +
        '">' +
        _admIcon('referrals') +
        (u.referralEnabled ? '关闭返利' : '开启返利') +
        '</button>';
    }

    html +=
      '<div class="adm-card adm-user-card">' +
      '<div class="adm-card-header"><div class="adm-user-head"><div class="adm-avatar">' +
      _admIcon('avatar') +
      '</div>' +
      '<div class="adm-user-title"><span class="adm-card-name">' +
      u.username +
      '</span>' +
      '<div class="adm-card-sub adm-user-meta">' +
      rolesHtml +
      '<span class="adm-dot"></span><span>注册 ' +
      _fmtDate(u.createdAt) +
      '</span></div></div></div>' +
      _statusHtml(u.status) +
      '</div>' +
      '<div class="adm-card-sub adm-user-login">最近登录 ' +
      _fmtDate(u.lastLoginAt) +
      '<span class="adm-dot"></span>需改密码: ' +
      (u.mustChangePassword ? '是' : '否') +
      '</div>' +
      '<div class="adm-card-actions">' +
      actions +
      '</div>' +
      '</div>';
  }

  var list = document.getElementById('admUserList');
  if (list) {
    list.innerHTML = html || '<div class="adm-loading">无匹配用户</div>';
    list.addEventListener('click', _handleUserAction);
  }
}

function _handleUserAction(e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  var uid = Number(btn.dataset.uid);
  var action = btn.dataset.action;
  var user = _allUsers.find(function (u) {
    return u.id === uid;
  });

  if (action === 'detail') _showUserDetail(user);
  else if (action === 'editRole') _showEditRole(user);
  else if (action === 'disable') _setUserStatus(uid, 'disabled');
  else if (action === 'enable') _setUserStatus(uid, 'active');
  else if (action === 'unlock') _unlockUser(uid);
  else if (action === 'toggleReferral') {
    var enabled = btn.dataset.enabled === '1';
    _toggleReferral(uid, !enabled);
  }
}

async function _setUserStatus(uid, status) {
  try {
    await api('user-update-status', { userId: uid, status: status });
    _toast(status === 'active' ? '已启用' : '已禁用');
    _switchTab('users');
  } catch (e) {
    _toast(e.message || '操作失败');
  }
}

async function _unlockUser(uid) {
  try {
    await api('user-update-status', { userId: uid, op: 'unlock' });
    _toast('已解锁');
    _switchTab('users');
  } catch (e) {
    _toast(e.message || '解锁失败');
  }
}

async function _toggleReferral(uid, enabled) {
  try {
    await api('user-toggle-referral', { userId: uid, enabled: enabled });
    _toast(enabled ? '已开启返利' : '已关闭返利');
    _switchTab('users');
  } catch (e) {
    _toast(e.message || '操作失败');
  }
}

function _showUserDetail(user) {
  if (!user) return;
  var rolesHtml = (user.roles || []).map(_roleHtml).join(' ');
  _showSheet(
    '用户详情 #' + user.id,
    '<div class="adm-form-group"><span class="adm-label">用户名</span><div>' +
      user.username +
      '</div></div>' +
      '<div class="adm-form-group"><span class="adm-label">状态</span><div>' +
      _statusHtml(user.status) +
      '</div></div>' +
      '<div class="adm-form-group"><span class="adm-label">角色</span><div>' +
      (rolesHtml || '--') +
      '</div></div>' +
      '<div class="adm-form-group"><span class="adm-label">注册时间</span><div>' +
      _fmtDate(user.createdAt) +
      '</div></div>' +
      '<div class="adm-form-group"><span class="adm-label">最近登录</span><div>' +
      _fmtDate(user.lastLoginAt) +
      '</div></div>' +
      '<div class="adm-form-group"><span class="adm-label">密码更新</span><div>' +
      _fmtDate(user.passwordUpdatedAt) +
      '</div></div>' +
      '<div class="adm-form-group"><span class="adm-label">需改密码</span><div>' +
      (user.mustChangePassword ? '是' : '否') +
      '</div></div>',
  );
}

function _showEditRole(user) {
  if (!user) return;
  var allRoles = ['super_admin', 'ops_admin', 'analyst', 'viewer'];
  var current = user.roles || [];
  var rows = '';
  for (var i = 0; i < allRoles.length; i++) {
    var r = allRoles[i];
    var checked = current.indexOf(r) >= 0 ? ' checked' : '';
    rows +=
      '<label class="adm-checkbox-row"><input type="checkbox" value="' +
      r +
      '"' +
      checked +
      ' />' +
      _roleHtml(r) +
      '</label>';
  }
  _showSheet(
    '编辑角色 — ' + user.username,
    rows +
      '<div style="margin-top:16px"><button class="adm-btn adm-btn-primary" id="admSaveRole" style="width:100%">保存</button></div>',
  );
  document.getElementById('admSaveRole').addEventListener('click', async function () {
    var checks = document.querySelectorAll('#admSheetBody input[type=checkbox]');
    var codes = [];
    checks.forEach(function (c) {
      if (c.checked) codes.push(c.value);
    });
    try {
      await api('user-role-update', { userId: user.id, roleCodes: codes });
      _closeSheet();
      _toast('角色已更新');
      _switchTab('users');
    } catch (e) {
      _toast(e.message || '保存失败');
    }
  });
}

function _showCreateUser() {
  _showSheet(
    '创建用户',
    '<div class="adm-form-group"><span class="adm-label">用户名</span>' +
      '<input class="adm-input" id="admNewUsername" placeholder="输入用户名" /></div>' +
      '<div class="adm-form-group"><span class="adm-label">初始角色</span>' +
      '<select class="adm-select adm-input" id="admNewRole">' +
      '<option value="viewer">访客</option><option value="analyst">分析员</option>' +
      '<option value="ops_admin">运维管理员</option><option value="super_admin">超级管理员</option>' +
      '</select></div>' +
      '<button class="adm-btn adm-btn-primary" id="admDoCreate" style="width:100%">创建</button>' +
      '<div class="adm-msg" id="admCreateMsg"></div>',
  );
  document.getElementById('admDoCreate').addEventListener('click', async function () {
    var username = (document.getElementById('admNewUsername') || {}).value || '';
    var roleCode = (document.getElementById('admNewRole') || {}).value || 'viewer';
    if (!username.trim()) {
      _toast('请输入用户名');
      return;
    }
    try {
      var result = await api('user-create', { username: username.trim(), roleCode: roleCode });
      _closeSheet();
      _showSheet(
        '用户创建成功',
        '<div class="adm-temp-pw">' +
          '<div style="font-size:13px;color:var(--text2)">临时密码（关闭后无法再次查看）</div>' +
          '<code>' +
          (result.tempPassword || '--') +
          '</code>' +
          '<div style="font-size:11px;color:var(--text3);margin-top:4px">请复制并转交用户，首次登录后必须修改密码</div>' +
          '</div>' +
          '<button class="adm-btn adm-btn-primary" id="admPwDone" style="width:100%">我已保存，关闭</button>',
      );
      document.getElementById('admPwDone').addEventListener('click', function () {
        _closeSheet();
        _switchTab('users');
      });
    } catch (e) {
      _toast(e.message || '创建失败');
    }
  });
}

var _permCN = {
  'auth:login': '登录',
  'auth:logout': '登出',
  'auth:change_password': '修改密码',
  'user:view': '查看用户',
  'user:create': '创建用户',
  'user:disable': '禁用用户',
  'user:unlock': '解锁用户',
  'user:force_reset_password': '强制重置密码',
  'role:view': '查看角色',
  'role:assign': '分配角色',
  'role:permission_manage': '管理角色权限',
  'plan:view': '查看方案',
  'plan:save': '保存方案',
  'plan:delete': '删除方案',
  'plan:share': '分享方案',
  'plan:confirm': '确认方案',
  'backtest:view': '查看回测',
  'dashboard:model_view': '模型仪表盘',
  'dashboard:data_health_view': '数据健康视图',
  'dashboard:experiment_compare': '实验对比',
  'gs:view': '查看功守道',
  'insight:batch_consensus': '批量共识',
  'insight:pk_compare': 'PK对比',
  'ops:sync_match_date': '同步比赛日期',
  'ops:sync_gov_schedule': '同步赛程',
  'ops:backfill': '数据回填',
  'ops:auto_heal': '自动修复',
  'ops:refill_consensus': '重填共识',
  'ops:error_log_view': '查看错误日志',
  'ops:refresh_predictions': '刷新预测',
  'payment:admin': '支付管理',
  'referral:admin': '返利管理',
};

async function _showRoleMgmt() {
  var roles;
  try {
    roles = await api('role-list', {});
  } catch (e) {
    _toast('加载角色失败');
    return;
  }

  var html = '';
  var list = Array.isArray(roles) ? roles : roles.roles || [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    var perms;
    if (r.code === 'super_admin') {
      perms = '* (全部权限)';
    } else {
      perms =
        (r.permissions || [])
          .map(function (p) {
            return _permCN[p] || p;
          })
          .join('、') || '--';
    }
    html +=
      '<div class="adm-card"><div class="adm-card-header">' +
      _roleHtml(r.code) +
      '</div><div class="adm-card-sub" style="word-break:break-all">' +
      perms +
      '</div></div>';
  }
  _showSheet('角色权限总览', '<div class="adm-list">' + html + '</div>');
}

// ═══════════════════════════════════════════════════════
// Tab 2: 订阅管理
// ═══════════════════════════════════════════════════════

async function _renderPaymentsTab(panel) {
  if (!_hasPerm('payment:admin')) {
    panel.innerHTML = '<div class="adm-loading">无权限查看订阅管理</div>';
    return;
  }
  panel.innerHTML = '<div class="adm-loading">加载中...</div>';

  try {
    var listData = await api('admin-subscription-list', { status: '', pageSize: 200 });
    var list = listData.list || listData || [];
    var total = listData.total || list.length;

    var active = 0,
      expiring = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].status === 'active') active++;
      if (list[i].status === 'expiring_soon') expiring++;
    }

    panel.innerHTML =
      '<div class="adm-stats">' +
      '<div class="adm-stat"><div class="adm-stat-num">' +
      total +
      '</div><div class="adm-stat-lbl">总订阅</div></div>' +
      '<div class="adm-stat"><div class="adm-stat-num">' +
      active +
      '</div><div class="adm-stat-lbl">有效中</div></div>' +
      '<div class="adm-stat"><div class="adm-stat-num">' +
      expiring +
      '</div><div class="adm-stat-lbl">即将到期</div></div>' +
      '</div>' +
      '<div class="adm-filter">' +
      '<select class="adm-select" id="admSubFilter" style="flex:1">' +
      '<option value="">全部</option><option value="active">正常</option>' +
      '<option value="expiring_soon">即将到期</option><option value="expired">已过期</option>' +
      '</select></div>' +
      '<div class="adm-list" id="admSubList"></div>' +
      '<div class="adm-card" style="margin-top:16px">' +
      '<div class="adm-card-header"><span class="adm-card-name">手动开通/赠送</span></div>' +
      '<div class="adm-form-inline">' +
      '<input class="adm-input" id="admGrantUid" type="number" placeholder="用户ID" style="max-width:100px" />' +
      '<select class="adm-select" id="admGrantPlan">' +
      '<option value="monthly">月度 ¥98</option><option value="quarterly">季度 ¥258</option>' +
      '<option value="yearly">年度 ¥888</option></select>' +
      '<button class="adm-btn adm-btn-primary" id="admGrantBtn">开通</button>' +
      '</div><div class="adm-msg" id="admGrantMsg"></div></div>';

    _renderSubList(list, '');

    document.getElementById('admSubFilter').addEventListener('change', function () {
      var st = this.value;
      var filtered = st
        ? list.filter(function (s) {
            return s.status === st;
          })
        : list;
      _renderSubList(filtered, st);
    });

    document.getElementById('admGrantBtn').addEventListener('click', _doGrant);
  } catch (e) {
    panel.innerHTML = '<div class="adm-loading">加载失败: ' + (e.message || e) + '</div>';
  }
}

function _renderSubList(list, status) {
  var el = document.getElementById('admSubList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div class="adm-loading">暂无数据</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    html +=
      '<div class="adm-card">' +
      '<div class="adm-card-header"><span class="adm-card-name">' +
      (s.username || '用户ID:' + s.user_id) +
      ' · ' +
      (s.plan_name || _planCN[s.plan_code] || s.plan_code || '--') +
      ' · ¥' +
      ((s.amount || 0) / 100).toFixed(0) +
      '</span></div>' +
      '<div class="adm-card-sub">' +
      _statusHtml(s.status) +
      ' · ' +
      _fmtDate(s.start_date) +
      ' → ' +
      _fmtDate(s.end_date) +
      '</div>' +
      '<div class="adm-card-sub">来源: ' +
      (_sourceCN[s.source] || s.source || '--') +
      '</div></div>';
  }
  el.innerHTML = html;
}

async function _doGrant() {
  var uid = parseInt((document.getElementById('admGrantUid') || {}).value);
  var plan = (document.getElementById('admGrantPlan') || {}).value || 'monthly';
  var msgEl = document.getElementById('admGrantMsg');
  if (!uid) {
    _toast('请输入用户ID');
    return;
  }
  try {
    var result = await api('admin-grant-subscription', { user_id: uid, plan_code: plan });
    if (msgEl) {
      msgEl.className = 'adm-msg adm-msg-ok';
      msgEl.textContent = '已开通，到期 ' + (result.end_date || '--');
    }
    _switchTab('payments');
  } catch (e) {
    if (msgEl) {
      msgEl.className = 'adm-msg adm-msg-err';
      msgEl.textContent = e.message || '开通失败';
    }
  }
}

// ═══════════════════════════════════════════════════════
// Tab 3: 返利管理
// ═══════════════════════════════════════════════════════

async function _renderReferralsTab(panel) {
  if (!_hasPerm('referral:admin')) {
    panel.innerHTML = '<div class="adm-loading">无权限查看返利管理</div>';
    return;
  }
  panel.innerHTML = '<div class="adm-loading">加载中...</div>';

  try {
    var commData = await api('admin-referral-commissions', { status: '', pageSize: 200 });
    var commList = commData.list || commData || [];
    var commTotal = commData.total || commList.length;

    var wData = await api('admin-referral-withdraw-list', { status: 'submitted', pageSize: 100 });
    var wList = wData.list || wData || [];
    var wCount = wData.total || wList.length;
    var wAmount = 0;
    wList.forEach(function (w) {
      wAmount += Number(w.amount || 0);
    });

    panel.innerHTML =
      '<div class="adm-stats">' +
      '<div class="adm-stat"><div class="adm-stat-num">' +
      commTotal +
      '</div><div class="adm-stat-lbl">返利笔数</div></div>' +
      '<div class="adm-stat"><div class="adm-stat-num">' +
      wCount +
      '</div><div class="adm-stat-lbl">待提现</div></div>' +
      '<div class="adm-stat"><div class="adm-stat-num">¥' +
      (wAmount / 100).toFixed(0) +
      '</div><div class="adm-stat-lbl">待提现金额</div></div>' +
      '</div>' +
      '<div class="adm-card" style="margin-bottom:12px"><div class="adm-card-header"><span class="adm-card-name">提现审核</span>' +
      '<span style="font-size:12px;color:var(--amber)">' +
      wCount +
      '笔待处理</span></div>' +
      '<div id="admWithdrawList"></div></div>' +
      '<div class="adm-filter"><select class="adm-select" id="admRefFilter" style="flex:1">' +
      '<option value="">全部</option><option value="pending">待结算</option>' +
      '<option value="settled">已结算</option></select>' +
      '<input class="adm-search" id="admRefSearch" placeholder="搜索邀请人..." /></div>' +
      '<div class="adm-list" id="admRefList"></div>';

    _renderWithdrawList(wList);
    _renderRefList(commList);

    document.getElementById('admRefFilter').addEventListener('change', function () {
      _refFilterApply(commList);
    });
    var refDebounce;
    document.getElementById('admRefSearch').addEventListener('input', function () {
      clearTimeout(refDebounce);
      refDebounce = setTimeout(function () {
        _refFilterApply(commList);
      }, 200);
    });
  } catch (e) {
    panel.innerHTML = '<div class="adm-loading">加载失败: ' + (e.message || e) + '</div>';
  }
}

function _refFilterApply(commList) {
  var st = (document.getElementById('admRefFilter') || {}).value || '';
  var q = ((document.getElementById('admRefSearch') || {}).value || '').trim().toLowerCase();
  var filtered = commList.filter(function (c) {
    if (st && c.status !== st) return false;
    if (q && (c.inviter_name || '').toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  _renderRefList(filtered);
}

function _renderRefList(list) {
  var el = document.getElementById('admRefList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div class="adm-loading">暂无数据</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    html +=
      '<div class="adm-card">' +
      '<div class="adm-card-sub">' +
      (c.inviter_name || '?') +
      ' → ' +
      (c.invitee_name || '?') +
      ' · ¥' +
      ((c.order_amount || 0) / 100).toFixed(0) +
      '·' +
      (c.rate || 0) +
      '%·¥' +
      ((c.commission_amount || 0) / 100).toFixed(0) +
      '</div>' +
      '<div class="adm-card-sub">' +
      _statusHtml(c.status || 'pending') +
      ' · ' +
      _fmtDate(c.created_at) +
      '</div></div>';
  }
  el.innerHTML = html;
}

function _renderWithdrawList(list) {
  var el = document.getElementById('admWithdrawList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div class="adm-card-sub">暂无待审核提现</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    var w = list[i];
    html +=
      '<div class="adm-card" style="margin-top:8px">' +
      '<div class="adm-card-sub">' +
      (w.username || '用户ID:' + w.user_id) +
      ' · ¥' +
      ((w.amount || 0) / 100).toFixed(0) +
      ' · ' +
      (_withdrawMethodCN[w.method] || w.method || '银行卡') +
      '</div>' +
      '<div class="adm-card-sub">收款人: ' +
      (w.payee_name || '--') +
      ' · 尾号 ' +
      (w.account_last4 || '****') +
      '</div>' +
      '<div class="adm-card-actions">' +
      '<button class="adm-btn adm-btn-primary adm-btn-sm" data-wid="' +
      w.id +
      '" data-wact="paid">✓ 打款</button>' +
      '<button class="adm-btn adm-btn-danger adm-btn-sm" data-wid="' +
      w.id +
      '" data-wact="rejected">✕ 驳回</button>' +
      '</div></div>';
  }
  el.innerHTML = html;
  el.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-wact]');
    if (!btn) return;
    _processWithdraw(Number(btn.dataset.wid), btn.dataset.wact);
  });
}

async function _processWithdraw(wid, newStatus) {
  var remark = newStatus === 'rejected' ? prompt('驳回原因:') : '已打款';
  if (newStatus === 'rejected' && !remark) return;
  try {
    await api('admin-referral-withdraw-process', { withdrawalId: wid, newStatus: newStatus, remark: remark || '' });
    _toast(newStatus === 'paid' ? '已打款' : '已驳回');
    _switchTab('referrals');
  } catch (e) {
    _toast(e.message || '操作失败');
  }
}

// ═══════════════════════════════════════════════════════
// Tab 4: 系统状态
// ═══════════════════════════════════════════════════════

async function _renderSystemTab(panel) {
  panel.innerHTML = '<div class="adm-loading">加载中...</div>';

  var healthHtml = '',
    cacheHtml = '',
    pipeHtml = '',
    errHtml = '';

  try {
    var [dhData, cacheData, errData] = await Promise.all([
      api('data-health', { days: 1 }).catch(function () {
        return null;
      }),
      api('cache-stats', {}).catch(function () {
        return null;
      }),
      api('error-log-summary', { limit: 5 }).catch(function () {
        return null;
      }),
    ]);

    // 服务状态概览
    var fetchRate = '--',
      cacheRate = '--',
      aiRate = '--';
    if (dhData && dhData.fetchSources) {
      var sources = dhData.fetchSources;
      var keys = Object.keys(sources);
      var sum = 0;
      keys.forEach(function (k) {
        sum += sources[k].successRate || 0;
      });
      fetchRate = keys.length ? (sum / keys.length).toFixed(1) + '%' : '--';
    }
    if (cacheData) cacheRate = ((cacheData.hitRate || 0) * 100).toFixed(1) + '%';
    if (dhData && dhData.prediction) aiRate = (dhData.prediction.successRate || 100) + '%';

    healthHtml =
      '<div class="adm-card">' +
      '<div class="adm-card-header"><span class="adm-card-name">服务状态</span></div>' +
      '<div class="adm-health-row"><span class="adm-health-name"><span class="adm-health-icon">' +
      _admIcon('svc_data') +
      '</span><span>数据抓取成功率</span></span><span class="adm-health-rate">' +
      fetchRate +
      '</span></div>' +
      '<div class="adm-health-row"><span class="adm-health-name"><span class="adm-health-icon">' +
      _admIcon('svc_cache') +
      '</span><span>缓存命中率</span></span><span class="adm-health-rate">' +
      cacheRate +
      '</span></div>' +
      '<div class="adm-health-row"><span class="adm-health-name"><span class="adm-health-icon">' +
      _admIcon('svc_ai') +
      '</span><span>AI 预测成功率</span></span><span class="adm-health-rate">' +
      aiRate +
      '</span></div>' +
      '</div>';

    // 管线健康
    if (dhData && dhData.fetchSources) {
      pipeHtml =
        '<div class="adm-card" style="margin-top:12px"><div class="adm-card-header"><span class="adm-card-name">管线健康</span></div>';
      var sources = dhData.fetchSources;
      Object.keys(sources).forEach(function (k) {
        var s = sources[k];
        var rate = s.successRate || 0;
        var cls = rate >= 95 ? 'adm-health-ok' : rate >= 80 ? 'adm-health-warn' : 'adm-health-err';
        pipeHtml +=
          '<div class="adm-health-row"><span class="adm-health-name">' +
          k +
          '</span>' +
          '<span class="adm-health-rate ' +
          cls +
          '">' +
          rate.toFixed(0) +
          '%</span>' +
          '<span class="adm-health-time">' +
          _fmtDate(s.lastSuccess) +
          '</span></div>';
      });
      pipeHtml += '</div>';
    }

    // 最近错误
    var errors = (errData && errData.errors) || [];
    if (errors.length) {
      errHtml =
        '<div class="adm-card" style="margin-top:12px"><div class="adm-card-header"><span class="adm-card-name">最近错误</span>' +
        '<span style="font-size:13px;color:var(--adm-muted)">最近 ' +
        errors.length +
        ' 条</span></div>';

      errors.forEach(function (line) {
        var safeLine = _cnErrorLine(line).replace(/</g, '&lt;');
        errHtml += '<div class="adm-log-item">' + safeLine + '</div>';
      });

      errHtml += '</div>';
    }
  } catch (e) {
    healthHtml = '<div class="adm-loading">系统数据加载失败</div>';
  }

  // 运维操作按钮
  var canOps = _hasPerm('ops:sync_match_date');
  var opsHtml = '';
  if (canOps) {
    opsHtml =
      '<div class="adm-card" style="margin-top:12px"><div class="adm-card-header"><span class="adm-card-name">运维操作</span></div>' +
      '<div class="adm-card-actions">' +
      '<button class="adm-btn adm-btn-ghost adm-btn-sm" data-ops="sync-match-date">同步比赛日期</button>' +
      '<button class="adm-btn adm-btn-ghost adm-btn-sm" data-ops="backfill-results">回填赛果</button>' +
      '<button class="adm-btn adm-btn-ghost adm-btn-sm" data-ops="auto-heal">自动修复</button>' +
      '<button class="adm-btn adm-btn-ghost adm-btn-sm" data-ops="refill-expert-consensus">补专家共识</button>' +
      '<button class="adm-btn adm-btn-ghost adm-btn-sm" data-ops="refresh-predictions">刷新AI预测</button>' +
      '</div><div class="adm-msg" id="admOpsMsg"></div></div>';
  }

  panel.innerHTML = healthHtml + pipeHtml + opsHtml + errHtml;

  if (canOps) {
    panel.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-ops]');
      if (!btn) return;
      _execOps(btn.dataset.ops);
    });
  }
}

async function _execOps(action) {
  var msgEl = document.getElementById('admOpsMsg');
  if (msgEl) {
    msgEl.className = 'adm-msg';
    msgEl.textContent = '执行中...';
  }
  try {
    var result = await api(action, {});
    var hint = (result && result.hint) || '操作完成';
    if (msgEl) {
      msgEl.className = 'adm-msg adm-msg-ok';
      msgEl.textContent = hint;
    }
    _toast(hint);
  } catch (e) {
    if (msgEl) {
      msgEl.className = 'adm-msg adm-msg-err';
      msgEl.textContent = e.message || '操作失败';
    }
  }
}

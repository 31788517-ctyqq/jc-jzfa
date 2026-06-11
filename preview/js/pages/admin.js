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
  setTimeout(function () { el.remove(); }, ms || 2500);
}

function _showSheet(title, bodyHtml) {
  _closeSheet();
  var overlay = document.createElement('div');
  overlay.className = 'adm-overlay';
  overlay.id = 'admOverlay';
  overlay.innerHTML =
    '<div class="adm-sheet" style="position:relative">' +
    '<div class="adm-sheet-close" id="admSheetClose">&times;</div>' +
    '<div class="adm-sheet-title">' + title + '</div>' +
    '<div id="admSheetBody">' + bodyHtml + '</div>' +
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

function _statusHtml(status) {
  return '<span class="adm-status adm-status-' + status + '">' + status + '</span>';
}

function _roleHtml(role) {
  return '<span class="adm-role adm-role-' + role + '">' + role + '</span>';
}

// ═══════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════

export function loadAdmin(container) {
  _container = container;
  if (!_isAdmin()) {
    _toast('无权限');
    if (typeof window.switchTab === 'function') window.switchTab('home');
    return;
  }

  var tab = 'users';
  try {
    var pending = sessionStorage.getItem('pendingAdminTab');
    if (pending) { tab = pending; sessionStorage.removeItem('pendingAdminTab'); }
  } catch (e) { /* ignore */ }

  container.innerHTML =
    '<div class="adm-wrap">' +
    '<div class="adm-tabs" id="admTabs"></div>' +
    '<div id="admPanel"></div>' +
    '</div>';

  _renderTabs(tab);
  _switchTab(tab);
}

function _renderTabs(active) {
  var tabs = [
    { key: 'users', icon: '👥', label: '用户' },
    { key: 'payments', icon: '💎', label: '订阅' },
    { key: 'referrals', icon: '💰', label: '返利' },
    { key: 'system', icon: '⚙️', label: '系统' },
  ];
  var html = '';
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    html += '<div class="adm-tab' + (t.key === active ? ' active' : '') +
      '" data-tab="' + t.key + '">' + t.icon + ' ' + t.label + '</div>';
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
    case 'users': _renderUsersTab(panel); break;
    case 'payments': _renderPaymentsTab(panel); break;
    case 'referrals': _renderReferralsTab(panel); break;
    case 'system': _renderSystemTab(panel); break;
    default: panel.innerHTML = '<div class="adm-loading">未知页面</div>';
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
  var disabled = _allUsers.filter(function (u) { return u.status === 'disabled'; }).length;
  var today = new Date().toISOString().slice(0, 10);
  var todayNew = _allUsers.filter(function (u) { return (u.createdAt || '').slice(0, 10) === today; }).length;

  var canWrite = _hasPerm('user:create');

  panel.innerHTML =
    '<div class="adm-stats">' +
    '<div class="adm-stat"><div class="adm-stat-num">' + total + '</div><div class="adm-stat-lbl">总用户</div></div>' +
    '<div class="adm-stat"><div class="adm-stat-num">' + todayNew + '</div><div class="adm-stat-lbl">今日新增</div></div>' +
    '<div class="adm-stat"><div class="adm-stat-num">' + disabled + '</div><div class="adm-stat-lbl">已禁用</div></div>' +
    '</div>' +
    '<div class="adm-filter">' +
    '<input class="adm-search" id="admUserSearch" placeholder="搜索用户名或ID..." />' +
    '<select class="adm-select" id="admUserFilter">' +
    '<option value="">全部</option><option value="active">正常</option>' +
    '<option value="disabled">禁用</option><option value="locked">锁定</option>' +
    '</select>' +
    '</div>' +
    '<div class="adm-list" id="admUserList"></div>' +
    (canWrite ?
      '<div class="adm-actions">' +
      '<button class="adm-btn adm-btn-primary" id="admCreateUser">创建用户</button>' +
      '<button class="adm-btn adm-btn-ghost" id="admRoleMgmt">角色权限管理</button>' +
      '</div>' : '');

  _filterUsers();

  var searchEl = document.getElementById('admUserSearch');
  var filterEl = document.getElementById('admUserFilter');
  var debounceTimer;
  if (searchEl) searchEl.addEventListener('input', function () {
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

  var filtered = _allUsers.filter(function (u) {
    if (status && u.status !== status) return false;
    if (q && u.username.toLowerCase().indexOf(q) < 0 && String(u.id).indexOf(q) < 0) return false;
    return true;
  });

  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var u = filtered[i];
    var rolesHtml = (u.roles || []).map(_roleHtml).join(' ') || '<span class="adm-role adm-role-viewer">viewer</span>';
    var actions = '';
    if (canRole) actions += '<button class="adm-btn adm-btn-ghost adm-btn-sm" data-action="editRole" data-uid="' + u.id + '">编辑角色</button>';
    actions += '<button class="adm-btn adm-btn-ghost adm-btn-sm" data-action="detail" data-uid="' + u.id + '">查看详情</button>';
    if (canWrite) {
      if (u.status === 'active') actions += '<button class="adm-btn adm-btn-danger adm-btn-sm" data-action="disable" data-uid="' + u.id + '">禁用</button>';
      else if (u.status === 'disabled') actions += '<button class="adm-btn adm-btn-primary adm-btn-sm" data-action="enable" data-uid="' + u.id + '">启用</button>';
      if (u.status === 'locked') actions += '<button class="adm-btn adm-btn-primary adm-btn-sm" data-action="unlock" data-uid="' + u.id + '">解锁</button>';
    }

    html +=
      '<div class="adm-card">' +
      '<div class="adm-card-header"><span class="adm-card-name">👤 ' + u.username + '</span>' + _statusHtml(u.status) + '</div>' +
      '<div class="adm-card-sub">' + rolesHtml + ' · 注册 ' + _fmtDate(u.createdAt) + '</div>' +
      '<div class="adm-card-sub">最近登录 ' + _fmtDate(u.lastLoginAt) + ' · 需改密码: ' + (u.mustChangePassword ? '是' : '否') + '</div>' +
      '<div class="adm-card-actions">' + actions + '</div>' +
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
  var user = _allUsers.find(function (u) { return u.id === uid; });

  if (action === 'detail') _showUserDetail(user);
  else if (action === 'editRole') _showEditRole(user);
  else if (action === 'disable') _setUserStatus(uid, 'disabled');
  else if (action === 'enable') _setUserStatus(uid, 'active');
  else if (action === 'unlock') _unlockUser(uid);
}

async function _setUserStatus(uid, status) {
  try {
    await api('user-update-status', { userId: uid, status: status });
    _toast(status === 'active' ? '已启用' : '已禁用');
    _switchTab('users');
  } catch (e) { _toast(e.message || '操作失败'); }
}

async function _unlockUser(uid) {
  try {
    await api('user-update-status', { userId: uid, op: 'unlock' });
    _toast('已解锁');
    _switchTab('users');
  } catch (e) { _toast(e.message || '解锁失败'); }
}

function _showUserDetail(user) {
  if (!user) return;
  var rolesHtml = (user.roles || []).map(_roleHtml).join(' ');
  _showSheet('用户详情 #' + user.id,
    '<div class="adm-form-group"><span class="adm-label">用户名</span><div>' + user.username + '</div></div>' +
    '<div class="adm-form-group"><span class="adm-label">状态</span><div>' + _statusHtml(user.status) + '</div></div>' +
    '<div class="adm-form-group"><span class="adm-label">角色</span><div>' + (rolesHtml || '--') + '</div></div>' +
    '<div class="adm-form-group"><span class="adm-label">注册时间</span><div>' + _fmtDate(user.createdAt) + '</div></div>' +
    '<div class="adm-form-group"><span class="adm-label">最近登录</span><div>' + _fmtDate(user.lastLoginAt) + '</div></div>' +
    '<div class="adm-form-group"><span class="adm-label">密码更新</span><div>' + _fmtDate(user.passwordUpdatedAt) + '</div></div>' +
    '<div class="adm-form-group"><span class="adm-label">需改密码</span><div>' + (user.mustChangePassword ? '是' : '否') + '</div></div>'
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
    rows += '<label class="adm-checkbox-row"><input type="checkbox" value="' + r + '"' + checked + ' />' + _roleHtml(r) + '</label>';
  }
  _showSheet('编辑角色 — ' + user.username,
    rows +
    '<div style="margin-top:16px"><button class="adm-btn adm-btn-primary" id="admSaveRole" style="width:100%">保存</button></div>'
  );
  document.getElementById('admSaveRole').addEventListener('click', async function () {
    var checks = document.querySelectorAll('#admSheetBody input[type=checkbox]');
    var codes = [];
    checks.forEach(function (c) { if (c.checked) codes.push(c.value); });
    try {
      await api('user-role-update', { userId: user.id, roleCodes: codes });
      _closeSheet();
      _toast('角色已更新');
      _switchTab('users');
    } catch (e) { _toast(e.message || '保存失败'); }
  });
}

function _showCreateUser() {
  _showSheet('创建用户',
    '<div class="adm-form-group"><span class="adm-label">用户名</span>' +
    '<input class="adm-input" id="admNewUsername" placeholder="输入用户名" /></div>' +
    '<div class="adm-form-group"><span class="adm-label">初始角色</span>' +
    '<select class="adm-select adm-input" id="admNewRole">' +
    '<option value="viewer">viewer</option><option value="analyst">analyst</option>' +
    '<option value="ops_admin">ops_admin</option><option value="super_admin">super_admin</option>' +
    '</select></div>' +
    '<button class="adm-btn adm-btn-primary" id="admDoCreate" style="width:100%">创建</button>' +
    '<div class="adm-msg" id="admCreateMsg"></div>'
  );
  document.getElementById('admDoCreate').addEventListener('click', async function () {
    var username = (document.getElementById('admNewUsername') || {}).value || '';
    var roleCode = (document.getElementById('admNewRole') || {}).value || 'viewer';
    if (!username.trim()) { _toast('请输入用户名'); return; }
    try {
      var result = await api('user-create', { username: username.trim(), roleCode: roleCode });
      _closeSheet();
      _showSheet('用户创建成功',
        '<div class="adm-temp-pw">' +
        '<div style="font-size:13px;color:var(--text2)">临时密码（关闭后无法再次查看）</div>' +
        '<code>' + (result.tempPassword || '--') + '</code>' +
        '<div style="font-size:11px;color:var(--text3);margin-top:4px">请复制并转交用户，首次登录后必须修改密码</div>' +
        '</div>' +
        '<button class="adm-btn adm-btn-primary" id="admPwDone" style="width:100%">我已保存，关闭</button>'
      );
      document.getElementById('admPwDone').addEventListener('click', function () {
        _closeSheet();
        _switchTab('users');
      });
    } catch (e) { _toast(e.message || '创建失败'); }
  });
}

async function _showRoleMgmt() {
  var roles;
  try {
    roles = await api('role-list', {});
  } catch (e) { _toast('加载角色失败'); return; }

  var html = '';
  var list = Array.isArray(roles) ? roles : (roles.roles || []);
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    var perms = (r.permissions || []).join(', ') || '--';
    if (r.code === 'super_admin') perms = '* (全部权限)';
    html += '<div class="adm-card"><div class="adm-card-header">' + _roleHtml(r.code) +
      '</div><div class="adm-card-sub" style="word-break:break-all">' + perms + '</div></div>';
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

    var active = 0, expiring = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].status === 'active') active++;
      if (list[i].status === 'expiring_soon') expiring++;
    }

    panel.innerHTML =
      '<div class="adm-stats">' +
      '<div class="adm-stat"><div class="adm-stat-num">' + total + '</div><div class="adm-stat-lbl">总订阅</div></div>' +
      '<div class="adm-stat"><div class="adm-stat-num">' + active + '</div><div class="adm-stat-lbl">有效中</div></div>' +
      '<div class="adm-stat"><div class="adm-stat-num">' + expiring + '</div><div class="adm-stat-lbl">即将到期</div></div>' +
      '</div>' +
      '<div class="adm-filter">' +
      '<select class="adm-select" id="admSubFilter" style="flex:1">' +
      '<option value="">全部</option><option value="active">活跃</option>' +
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
      var filtered = st ? list.filter(function (s) { return s.status === st; }) : list;
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
  if (!list.length) { el.innerHTML = '<div class="adm-loading">暂无数据</div>'; return; }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    html += '<div class="adm-card">' +
      '<div class="adm-card-header"><span class="adm-card-name">' +
      (s.username || 'ID:' + s.user_id) + ' · ' + (s.plan_name || s.plan_code) +
      ' · ¥' + ((s.amount || 0) / 100).toFixed(0) + '</span></div>' +
      '<div class="adm-card-sub">' + _statusHtml(s.status) + ' · ' +
      _fmtDate(s.start_date) + ' → ' + _fmtDate(s.end_date) + '</div>' +
      '<div class="adm-card-sub">来源: ' + (s.source || '--') + '</div></div>';
  }
  el.innerHTML = html;
}

async function _doGrant() {
  var uid = parseInt((document.getElementById('admGrantUid') || {}).value);
  var plan = (document.getElementById('admGrantPlan') || {}).value || 'monthly';
  var msgEl = document.getElementById('admGrantMsg');
  if (!uid) { _toast('请输入用户ID'); return; }
  try {
    var result = await api('admin-grant-subscription', { user_id: uid, plan_code: plan });
    if (msgEl) { msgEl.className = 'adm-msg adm-msg-ok'; msgEl.textContent = '已开通，到期 ' + (result.end_date || '--'); }
    _switchTab('payments');
  } catch (e) {
    if (msgEl) { msgEl.className = 'adm-msg adm-msg-err'; msgEl.textContent = e.message || '开通失败'; }
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
    wList.forEach(function (w) { wAmount += Number(w.amount || 0); });

    panel.innerHTML =
      '<div class="adm-stats">' +
      '<div class="adm-stat"><div class="adm-stat-num">' + commTotal + '</div><div class="adm-stat-lbl">返利笔数</div></div>' +
      '<div class="adm-stat"><div class="adm-stat-num">' + wCount + '</div><div class="adm-stat-lbl">待提现</div></div>' +
      '<div class="adm-stat"><div class="adm-stat-num">¥' + (wAmount / 100).toFixed(0) + '</div><div class="adm-stat-lbl">待提现金额</div></div>' +
      '</div>' +
      '<div class="adm-card" style="margin-bottom:12px"><div class="adm-card-header"><span class="adm-card-name">提现审核</span>' +
      '<span style="font-size:12px;color:var(--amber)">' + wCount + '笔待处理</span></div>' +
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
      refDebounce = setTimeout(function () { _refFilterApply(commList); }, 200);
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
  if (!list.length) { el.innerHTML = '<div class="adm-loading">暂无数据</div>'; return; }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    html += '<div class="adm-card">' +
      '<div class="adm-card-sub">' + (c.inviter_name || '?') + ' → ' + (c.invitee_name || '?') +
      ' · ¥' + ((c.order_amount || 0) / 100).toFixed(0) + '·' +
      (c.rate || 0) + '%·¥' + ((c.commission_amount || 0) / 100).toFixed(0) + '</div>' +
      '<div class="adm-card-sub">' + _statusHtml(c.status || 'pending') +
      ' · ' + _fmtDate(c.created_at) + '</div></div>';
  }
  el.innerHTML = html;
}

function _renderWithdrawList(list) {
  var el = document.getElementById('admWithdrawList');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="adm-card-sub">暂无待审核提现</div>'; return; }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    var w = list[i];
    html += '<div class="adm-card" style="margin-top:8px">' +
      '<div class="adm-card-sub">' + (w.username || 'ID:' + w.user_id) +
      ' · ¥' + ((w.amount || 0) / 100).toFixed(0) + ' · ' + (w.method || '银行卡') + '</div>' +
      '<div class="adm-card-sub">收款人: ' + (w.payee_name || '--') +
      ' · 尾号 ' + (w.account_last4 || '****') + '</div>' +
      '<div class="adm-card-actions">' +
      '<button class="adm-btn adm-btn-primary adm-btn-sm" data-wid="' + w.id + '" data-wact="paid">✓ 打款</button>' +
      '<button class="adm-btn adm-btn-danger adm-btn-sm" data-wid="' + w.id + '" data-wact="rejected">✕ 驳回</button>' +
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
  } catch (e) { _toast(e.message || '操作失败'); }
}

// ═══════════════════════════════════════════════════════
// Tab 4: 系统状态
// ═══════════════════════════════════════════════════════

async function _renderSystemTab(panel) {
  panel.innerHTML = '<div class="adm-loading">加载中...</div>';

  var healthHtml = '', cacheHtml = '', pipeHtml = '', errHtml = '';

  try {
    var [dhData, cacheData, errData] = await Promise.all([
      api('data-health', { days: 1 }).catch(function () { return null; }),
      api('cache-stats', {}).catch(function () { return null; }),
      api('error-log-summary', { limit: 5 }).catch(function () { return null; }),
    ]);

    // 服务状态概览
    var fetchRate = '--', cacheRate = '--', aiRate = '--';
    if (dhData && dhData.fetchSources) {
      var sources = dhData.fetchSources;
      var keys = Object.keys(sources);
      var sum = 0;
      keys.forEach(function (k) { sum += (sources[k].successRate || 0); });
      fetchRate = keys.length ? (sum / keys.length).toFixed(1) + '%' : '--';
    }
    if (cacheData) cacheRate = ((cacheData.hitRate || 0) * 100).toFixed(1) + '%';
    if (dhData && dhData.prediction) aiRate = (dhData.prediction.successRate || 100) + '%';

    healthHtml =
      '<div class="adm-card">' +
      '<div class="adm-card-header"><span class="adm-card-name">服务状态</span></div>' +
      '<div class="adm-health-row"><span class="adm-health-name">📊 数据抓取成功率</span><span class="adm-health-rate">' + fetchRate + '</span></div>' +
      '<div class="adm-health-row"><span class="adm-health-name">💾 缓存命中率</span><span class="adm-health-rate">' + cacheRate + '</span></div>' +
      '<div class="adm-health-row"><span class="adm-health-name">🧠 AI 预测成功率</span><span class="adm-health-rate">' + aiRate + '</span></div>' +
      '</div>';

    // 管线健康
    if (dhData && dhData.fetchSources) {
      pipeHtml = '<div class="adm-card" style="margin-top:12px"><div class="adm-card-header"><span class="adm-card-name">管线健康</span></div>';
      var sources = dhData.fetchSources;
      Object.keys(sources).forEach(function (k) {
        var s = sources[k];
        var rate = (s.successRate || 0);
        var cls = rate >= 95 ? 'adm-health-ok' : rate >= 80 ? 'adm-health-warn' : 'adm-health-err';
        pipeHtml += '<div class="adm-health-row"><span class="adm-health-name">' + k + '</span>' +
          '<span class="adm-health-rate ' + cls + '">' + rate.toFixed(0) + '%</span>' +
          '<span class="adm-health-time">' + _fmtDate(s.lastSuccess) + '</span></div>';
      });
      pipeHtml += '</div>';
    }

    // 最近错误
    var errors = (errData && errData.errors) || [];
    if (errors.length) {
      errHtml = '<div class="adm-card" style="margin-top:12px"><div class="adm-card-header"><span class="adm-card-name">最近错误</span>' +
        '<span style="font-size:11px;color:var(--text3)">最近 ' + errors.length + ' 条</span></div>';
      errors.forEach(function (line) {
        errHtml += '<div class="adm-log-item">' + line.replace(/</g, '&lt;') + '</div>';
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
    opsHtml = '<div class="adm-card" style="margin-top:12px"><div class="adm-card-header"><span class="adm-card-name">运维操作</span></div>' +
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
  if (msgEl) { msgEl.className = 'adm-msg'; msgEl.textContent = '执行中...'; }
  try {
    var result = await api(action, {});
    var hint = (result && result.hint) || '操作完成';
    if (msgEl) { msgEl.className = 'adm-msg adm-msg-ok'; msgEl.textContent = hint; }
    _toast(hint);
  } catch (e) {
    if (msgEl) { msgEl.className = 'adm-msg adm-msg-err'; msgEl.textContent = e.message || '操作失败'; }
  }
}

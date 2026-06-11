/**
 * preview/js/pages/admin.js
 * 统一移动端管理后台 — Shoelace Web Components 版
 *
 * 4 Tab: 用户 / 订阅 / 返利 / 系统
 * 权限: super_admin 全功能; ops_admin 用户只读 + 系统运维
 */
import { api } from '../api.js';
import { getAuthSession } from '../auth-client.js';

var _currentTab = 'users';
var _container = null;
var _allUsers = [];
var _slCssReady = false;

// 局部加载 Shoelace dark.css（仅注入 adminContent 的 Shadow DOM，不影响主站）
function _ensureSlCss() {
  if (_slCssReady) return;
  _slCssReady = true;
  var id = 'sl-dark-css-inline';
  if (document.getElementById(id)) return;
  var style = document.createElement('style');
  style.id = id;
  style.textContent =
    ':root, :host, .sl-theme-dark { color-scheme: dark;' +
    '--sl-color-gray-50:rgb(248 250 252);--sl-color-gray-100:rgb(241 245 249);' +
    '--sl-color-gray-200:rgb(226 232 240);--sl-color-gray-300:rgb(203 213 225);' +
    '--sl-color-gray-400:rgb(148 163 184);--sl-color-gray-500:rgb(100 116 139);' +
    '--sl-color-gray-600:rgb(71 85 105);--sl-color-gray-700:rgb(51 65 85);' +
    '--sl-color-gray-800:rgb(30 41 59);--sl-color-gray-900:rgb(15 23 42);' +
    '--sl-color-gray-950:rgb(2 6 23);' +
    '--sl-color-primary-50:rgb(236 253 255);--sl-color-primary-100:rgb(207 250 254);' +
    '--sl-color-primary-200:rgb(165 243 252);--sl-color-primary-300:rgb(103 232 249);' +
    '--sl-color-primary-400:rgb(34 211 238);--sl-color-primary-500:rgb(6 182 212);' +
    '--sl-color-primary-600:rgb(8 145 178);--sl-color-primary-700:rgb(14 116 144);' +
    '--sl-color-primary-800:rgb(21 94 117);--sl-color-primary-900:rgb(22 78 99);' +
    '--sl-color-primary-950:rgb(8 51 68);' +
    '--sl-color-success-50:rgb(240 253 244);--sl-color-success-400:rgb(74 222 128);' +
    '--sl-color-success-500:rgb(34 197 94);--sl-color-success-600:rgb(22 163 74);' +
    '--sl-color-warning-50:rgb(254 252 232);--sl-color-warning-400:rgb(250 204 21);' +
    '--sl-color-warning-500:rgb(234 179 8);--sl-color-warning-600:rgb(202 138 4);' +
    '--sl-color-danger-50:rgb(254 242 242);--sl-color-danger-400:rgb(248 113 113);' +
    '--sl-color-danger-500:rgb(239 68 68);--sl-color-danger-600:rgb(220 38 38);' +
    '--sl-color-neutral-50:rgb(250 250 250);--sl-color-neutral-100:rgb(245 245 245);' +
    '--sl-color-neutral-200:rgb(229 229 229);--sl-color-neutral-300:rgb(212 212 212);' +
    '--sl-color-neutral-400:rgb(163 163 163);--sl-color-neutral-500:rgb(115 115 115);' +
    '--sl-color-neutral-600:rgb(82 82 82);--sl-color-neutral-700:rgb(64 64 64);' +
    '--sl-color-neutral-800:rgb(38 38 38);--sl-color-neutral-900:rgb(23 23 23);' +
    '--sl-color-neutral-950:rgb(10 10 10);' +
    '--sl-color-text:var(--sl-color-neutral-100);--sl-color-bg:var(--sl-color-neutral-950);' +
    '--sl-border-radius-medium:8px;--sl-border-radius-large:12px;--sl-border-radius-x-large:16px;' +
    '--sl-input-border-color:var(--sl-color-neutral-700);--sl-input-background-color:var(--sl-color-neutral-900);' +
    '--sl-input-color:var(--sl-color-neutral-100);' +
    '--sl-panel-background-color:var(--sl-color-neutral-900);--sl-panel-border-color:var(--sl-color-neutral-800);' +
    '--sl-overlay-background-color:rgb(0 0 0 / 60%);' +
    '--sl-tooltip-background-color:var(--sl-color-neutral-800);--sl-tooltip-color:var(--sl-color-neutral-100);' +
    '}';
  document.head.appendChild(style);
}

// ── 工具 ──
function _isAdmin() {
  var s = getAuthSession();
  var roles = (s && s.roles) || [];
  return roles.indexOf('super_admin') >= 0 || roles.indexOf('ops_admin') >= 0;
}
function _hasPerm(code) {
  var s = getAuthSession();
  if (!s) return false;
  var roles = s.roles || [];
  if (roles.indexOf('super_admin') >= 0) return true;
  return (s.permissions || []).indexOf(code) >= 0 || (s.permissions || []).indexOf('*') >= 0;
}
function _fmtDate(iso) { return iso ? iso.slice(0, 10) : '--'; }
function _format(money) { return '¥' + ((money || 0) / 100).toFixed(0); }
function _roleBadge(role) {
  var m = { super_admin: ['danger','超级管理员'], ops_admin: ['warning','运维管理员'], analyst: ['primary','分析师'], viewer: ['neutral','用户'] };
  var v = m[role] || ['neutral', role];
  return '<sl-badge variant="' + v[0] + '" pill>' + v[1] + '</sl-badge>';
}
function _statusBadge(s) {
  var m = { active: ['success','正常'], disabled: ['danger','禁用'], locked: ['warning','锁定'],
    pending: ['warning','待处理'], settled: ['success','已结算'], submitted: ['warning','已提交'],
    expiring_soon: ['warning','即将到期'], expired: ['neutral','已过期'], paid: ['success','已打款'], rejected: ['danger','已驳回'] };
  var v = m[s] || ['neutral', s];
  return '<sl-badge variant="' + v[0] + '" pill>' + v[1] + '</sl-badge>';
}

// ── 主入口 ──
export function loadAdmin(container) {
  _container = container;
  _ensureSlCss(); // 局部注入 Shoelace 暗色主题变量
  if (!_isAdmin()) {
    _toast('无权限', 'danger');
    if (typeof window.switchTab === 'function') window.switchTab('home');
    return;
  }
  var tab = 'users';
  try { var p = sessionStorage.getItem('pendingAdminTab'); if (p) { tab = p; sessionStorage.removeItem('pendingAdminTab'); } } catch(e){}

  container.innerHTML =
    '<div class="adm-wrap sl-theme-dark">' +
    '<sl-tab-group id="admTabs" placement="top" activation="auto" no-scroll-controls>' +
    '<sl-tab slot="nav" panel="users" '   + (tab==='users'?' active':'') + '><sl-icon name="people-fill"></sl-icon> 用户</sl-tab>' +
    '<sl-tab slot="nav" panel="payments"' + (tab==='payments'?' active':'') + '><sl-icon name="credit-card"></sl-icon> 订阅</sl-tab>' +
    '<sl-tab slot="nav" panel="referrals"'+ (tab==='referrals'?' active':'') + '><sl-icon name="cash"></sl-icon> 返利</sl-tab>' +
    '<sl-tab slot="nav" panel="system"'   + (tab==='system'?' active':'') + '><sl-icon name="gear"></sl-icon> 系统</sl-tab>' +
    '<sl-tab-panel name="users"><div id="admPanel_users" class="adm-panel"></div></sl-tab-panel>' +
    '<sl-tab-panel name="payments"><div id="admPanel_payments" class="adm-panel"></div></sl-tab-panel>' +
    '<sl-tab-panel name="referrals"><div id="admPanel_referrals" class="adm-panel"></div></sl-tab-panel>' +
    '<sl-tab-panel name="system"><div id="admPanel_system" class="adm-panel"></div></sl-tab-panel>' +
    '</sl-tab-group></div>';

  _currentTab = tab;
  _switchTab(tab);

  var tg = container.querySelector('sl-tab-group');
  if (tg) tg.addEventListener('sl-tab-show', function(e) { _switchTab(e.detail.name); });
}

function _switchTab(tab) {
  _currentTab = tab;
  var panel = document.getElementById('admPanel_' + tab);
  if (!panel) return;
  panel.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--sl-color-neutral-400)"><sl-spinner></sl-spinner></div>';
  switch(tab) { case 'users': _renderUsers(panel); break; case 'payments': _renderPayments(panel); break; case 'referrals': _renderReferrals(panel); break; case 'system': _renderSystem(panel); break; }
}

// ══════════════════════════════════════════════════
// Tab 1: 用户管理
// ══════════════════════════════════════════════════
async function _renderUsers(panel) {
  try { _allUsers = await api('user-list', {}); } catch(e) { panel.innerHTML = '<sl-alert variant="danger" open>加载失败: ' + (e.message||e) + '</sl-alert>'; return; }
  var total = _allUsers.length;
  var disabled = _allUsers.filter(function(u){ return u.status==='disabled' }).length;
  var today = new Date().toISOString().slice(0,10);
  var tnew = _allUsers.filter(function(u){ return (u.createdAt||'').slice(0,10)===today }).length;
  var canWrite = _hasPerm('user:create');

  panel.innerHTML =
    '<div class="adm-stats">' +
    '<sl-card class="adm-stat"><div class="adm-num">' + total + '</div><small>总用户</small></sl-card>' +
    '<sl-card class="adm-stat"><div class="adm-num">' + tnew + '</div><small>今日新增</small></sl-card>' +
    '<sl-card class="adm-stat"><div class="adm-num">' + disabled + '</div><small>已禁用</small></sl-card>' +
    '</div>' +
    '<div class="adm-filter">' +
    '<sl-input id="admUserSearch" placeholder="搜索用户名或ID..." size="small" pill clearable>' +
    '<sl-icon name="search" slot="prefix"></sl-icon></sl-input>' +
    '<sl-select id="admUserFilter" size="small" pill value="" style="min-width:100px">' +
    '<sl-option value="">全部</sl-option><sl-option value="active">正常</sl-option>' +
    '<sl-option value="disabled">禁用</sl-option><sl-option value="locked">锁定</sl-option></sl-select>' +
    '</div><div id="admUserList"></div>' +
    (canWrite ? '<div class="adm-actions">' +
    '<sl-button id="admCreateUser" variant="primary" size="small"><sl-icon slot="prefix" name="person-plus"></sl-icon>创建用户</sl-button>' +
    '<sl-button id="admRoleMgmt" variant="default" size="small"><sl-icon slot="prefix" name="shield-lock"></sl-icon>角色权限管理</sl-button></div>' : '');

  _filterUsers();
  _debounce('admUserSearch', _filterUsers, 200);
  var sel = document.getElementById('admUserFilter');
  if (sel) sel.addEventListener('sl-change', _filterUsers);
  var cb = document.getElementById('admCreateUser');
  if (cb) cb.addEventListener('click', _showCreateUser);
  var rb = document.getElementById('admRoleMgmt');
  if (rb) rb.addEventListener('click', _showRoleMgmt);
}

function _filterUsers() {
  var q = ((document.getElementById('admUserSearch')||{}).value||'').trim().toLowerCase();
  var s = ((document.getElementById('admUserFilter')||{}).value||'');
  var cw = _hasPerm('user:disable'), cr = _hasPerm('role:assign');
  var filtered = _allUsers.filter(function(u){
    if (s && u.status !== s) return false;
    if (q && u.username.toLowerCase().indexOf(q)<0 && String(u.id).indexOf(q)<0) return false;
    return true;
  });
  var h = '';
  for (var i=0; i<filtered.length; i++) {
    var u = filtered[i];
    var rolesH = (u.roles||[]).map(_roleBadge).join(' ') || _roleBadge('viewer');
    var acts = '';
    if (cr) acts += '<sl-button size="small" variant="default" data-action="editRole" data-uid="' + u.id + '">角色</sl-button>';
    acts += '<sl-button size="small" variant="default" data-action="detail" data-uid="' + u.id + '">详情</sl-button>';
    if (cw) {
      if (u.status==='active') acts += '<sl-button size="small" variant="danger" data-action="disable" data-uid="' + u.id + '">禁用</sl-button>';
      else if (u.status==='disabled') acts += '<sl-button size="small" variant="success" data-action="enable" data-uid="' + u.id + '">启用</sl-button>';
      if (u.status==='locked') acts += '<sl-button size="small" variant="primary" data-action="unlock" data-uid="' + u.id + '">解锁</sl-button>';
    }
    h += '<sl-card class="adm-ucard"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
      '<strong>' + u.username + '</strong>' + _statusBadge(u.status) + '</div>' +
      '<div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<sl-tag size="small" variant="neutral">ID:' + u.id + '</sl-tag>' + rolesH + '</div>' +
      '<div style="margin-top:4px;font-size:12px;color:var(--sl-color-neutral-400)">' +
      '注册 ' + _fmtDate(u.createdAt) + ' | 最近登录 ' + _fmtDate(u.lastLoginAt) +
      (u.mustChangePassword ? ' | 需改密' : '') + '</div>' +
      '<sl-divider></sl-divider><div class="adm-card-actions">' + acts + '</div></sl-card>';
  }
  var el = document.getElementById('admUserList');
  if (!el) return;
  el.innerHTML = h || '<sl-alert variant="neutral" open>暂无用户</sl-alert>';
  _bindCardActions(el);
}

function _bindCardActions(el) {
  el.querySelectorAll('[data-action]').forEach(function(b){
    b.addEventListener('click', function(){
      var act = this.dataset.action, uid = parseInt(this.dataset.uid);
      switch(act) {
        case 'editRole': _showRoleEditor(uid); break;
        case 'detail': _showUserDetail(uid); break;
        case 'disable': _setUserStatus(uid,'disabled'); break;
        case 'enable': _setUserStatus(uid,'active'); break;
        case 'unlock': _setUserStatus(uid,'unlock_op'); break;
      }
    });
  });
}

async function _setUserStatus(uid, op) {
  try {
    await api('user-update-status', { userId: uid, status: op === 'unlock_op' ? 'active' : op, op: op === 'unlock_op' ? 'unlock' : undefined });
    _toast('操作成功','success');
    _switchTab('users');
  } catch(e) { _toast(e.message||'操作失败','danger'); }
}

function _showUserDetail(uid) {
  var u = _allUsers.find(function(x){ return x.id === uid; });
  if (!u) return;
  var roles = (u.roles||[]).map(_roleBadge).join(' ') || _roleBadge('viewer');
  var body = '<div style="display:flex;flex-direction:column;gap:12px">' +
    '<div><sl-tag size="small">ID:' + u.id + '</sl-tag></div>' +
    '<div><small style="color:var(--sl-color-neutral-400)">角色</small><div style="margin-top:4px">' + roles + '</div></div>' +
    '<div><small style="color:var(--sl-color-neutral-400)">状态</small><div style="margin-top:4px">' + _statusBadge(u.status) + '</div></div>' +
    '<div><small style="color:var(--sl-color-neutral-400)">注册时间</small><div style="color:var(--sl-color-neutral-300)">' + _fmtDate(u.createdAt) + '</div></div>' +
    '<div><small style="color:var(--sl-color-neutral-400)">最近登录</small><div style="color:var(--sl-color-neutral-300)">' + _fmtDate(u.lastLoginAt) + '</div></div>' +
    '<div><small style="color:var(--sl-color-neutral-400)">登录IP</small><div style="color:var(--sl-color-neutral-300)">' + (u.lastLoginIp||'--') + '</div></div>' +
    '<div><small style="color:var(--sl-color-neutral-400)">需改密码</small><div style="color:var(--sl-color-neutral-300)">' + (u.mustChangePassword?'是':'否') + '</div></div>' +
    '</div>';
  _showDialog('用户详情: ' + u.username, body, null);
}

// ── 创建用户 ──
async function _showCreateUser() {
  var body = '<div style="display:flex;flex-direction:column;gap:14px">' +
    '<sl-input id="admNewUser" label="用户名" placeholder="至少3位" required></sl-input>' +
    '<sl-select id="admNewRole" label="角色" value="viewer">' +
    '<sl-option value="super_admin">超级管理员</sl-option><sl-option value="ops_admin">运维管理员</sl-option>' +
    '<sl-option value="analyst">分析师</sl-option><sl-option value="viewer">普通用户</sl-option></sl-select>' +
    '<div id="admNewPW" style="background:var(--sl-color-neutral-900);border-radius:8px;padding:14px;text-align:center;display:none">' +
    '<small style="color:var(--sl-color-neutral-400)">临时密码</small><br>' +
    '<code id="admNewPWCode" style="font-size:20px;font-weight:700;color:var(--sl-color-warning-500)"></code></div>' +
    '</div>';
  _showDialog('创建用户', body, async function() {
    var name = (document.getElementById('admNewUser')||{}).value||'';
    var role = (document.getElementById('admNewRole')||{}).value||'viewer';
    if (!name || name.length < 3) { _toast('用户名至少3位','warning'); return false; }
    try {
      var r = await api('user-create', { username: name, roleCode: role });
      if (r.tempPassword) {
        var pwEl = document.getElementById('admNewPW');
        var codeEl = document.getElementById('admNewPWCode');
        if (pwEl) pwEl.style.display = 'block';
        if (codeEl) codeEl.textContent = r.tempPassword;
      }
      _switchTab('users'); _toast('创建成功','success');
    } catch(e) { _toast(e.message||'创建失败','danger'); return false; }
  });
}

// ── 角色编辑 ──
async function _showRoleEditor(uid) {
  var u = _allUsers.find(function(x){ return x.id === uid; });
  if (!u) return;
  var current = u.roles || [];
  var roles = (await api('role-list',{})).list || await api('role-list',{}) || [];
  var opts = ''; roles.forEach(function(r){
    var checked = current.indexOf(r.code) >= 0 ? ' checked' : '';
    opts += '<sl-checkbox value="' + r.code + '"' + checked + '>' + r.name + '</sl-checkbox>';
  });
  _showDialog('编辑角色: ' + u.username, '<div style="display:flex;flex-direction:column;gap:6px">' + opts + '</div>', async function() {
    var checks = document.querySelectorAll('.adm-dlg-body sl-checkbox[checked]');
    var codes = []; checks.forEach(function(c){ codes.push(c.value); });
    try {
      await api('user-role-update', { userId: uid, roleCodes: codes });
      _toast('角色已更新','success'); _switchTab('users');
    } catch(e) { _toast(e.message||'更新失败','danger'); return false; }
  });
}

// ── 角色权限管理 ──
async function _showRoleMgmt() {
  var roles = (await api('role-list',{})).list || await api('role-list',{}) || [];
  var body = '';
  roles.forEach(function(r){
    body += '<sl-details summary="' + r.name + '" style="margin-bottom:8px"><div style="font-size:12px;color:var(--sl-color-neutral-400)">';
    (r.permissions||[]).forEach(function(p){ body += '<sl-tag size="small" variant="neutral" style="margin:2px">' + p + '</sl-tag> '; });
    body += '</div></sl-details>';
  });
  _showDialog('角色权限总览', '<div style="max-height:60vh;overflow-y:auto">' + body + '</div>', null);
}

// ══════════════════════════════════════════════════
// Tab 2: 订阅管理
// ══════════════════════════════════════════════════
async function _renderPayments(panel) {
  if (!_hasPerm('payment:admin')) { panel.innerHTML = '<sl-alert variant="warning" open>无权限</sl-alert>'; return; }
  try {
    var d = await api('admin-subscription-list', { status: '', pageSize: 200 });
    var list = d.list || d || [];
    var total = d.total || list.length;
    var active = 0, expiring = 0;
    list.forEach(function(s){ if(s.status==='active') active++; if(s.status==='expiring_soon') expiring++; });
    panel.innerHTML =
      '<div class="adm-stats">' +
      '<sl-card class="adm-stat"><div class="adm-num">' + total + '</div><small>总订阅</small></sl-card>' +
      '<sl-card class="adm-stat"><div class="adm-num">' + active + '</div><small>有效中</small></sl-card>' +
      '<sl-card class="adm-stat"><div class="adm-num">' + expiring + '</div><small>即将到期</small></sl-card>' +
      '</div>' +
      '<div class="adm-filter"><sl-select id="admSubFilter" size="small" pill value="" style="flex:1">' +
      '<sl-option value="">全部</sl-option><sl-option value="active">活跃</sl-option>' +
      '<sl-option value="expiring_soon">即将到期</sl-option><sl-option value="expired">已过期</sl-option>' +
      '</sl-select></div><div id="admSubList"></div>' +
      '<sl-card style="margin-top:12px"><strong style="display:block;margin-bottom:10px">手动开通/赠送</strong>' +
      '<div class="adm-form-inline"><sl-input id="admGrantUid" type="number" placeholder="用户ID" size="small"></sl-input>' +
      '<sl-select id="admGrantPlan" size="small" value="monthly"><sl-option value="monthly">月度 ¥98</sl-option>' +
      '<sl-option value="quarterly">季度 ¥258</sl-option><sl-option value="yearly">年度 ¥888</sl-option></sl-select>' +
      '<sl-button id="admGrantBtn" variant="primary" size="small">开通</sl-button></div>' +
      '<div id="admGrantMsg" style="margin-top:8px;font-size:12px"></div></sl-card>';
    _renderSubs(list);
    var sf = document.getElementById('admSubFilter');
    if (sf) sf.addEventListener('sl-change', function(){ _renderSubs(list, this.value); });
    var gb = document.getElementById('admGrantBtn');
    if (gb) gb.addEventListener('click', _doGrant);
  } catch(e) { panel.innerHTML = '<sl-alert variant="danger" open>加载失败: ' + (e.message||e) + '</sl-alert>'; }
}
function _renderSubs(list, filter) {
  var f = filter ? list.filter(function(s){ return s.status===filter }) : list;
  var el = document.getElementById('admSubList');
  if (!el) return;
  if (!f.length) { el.innerHTML = '<sl-alert variant="neutral" open>暂无数据</sl-alert>'; return; }
  el.innerHTML = f.map(function(s){
    return '<sl-card class="adm-ucard"><div style="display:flex;justify-content:space-between"><strong>' +
      (s.username||'ID:'+s.user_id) + '</strong><span style="font-size:13px;color:var(--sl-color-primary-400)">' +
      (s.plan_name||s.plan_code) + ' · ' + _format(s.amount) + '</span></div>' +
      '<div style="margin-top:6px;display:flex;align-items:center;gap:8px">' + _statusBadge(s.status) +
      '<span style="font-size:12px;color:var(--sl-color-neutral-400)">' + _fmtDate(s.start_date) + ' → ' + _fmtDate(s.end_date) + '</span></div>' +
      '<div style="font-size:11px;color:var(--sl-color-neutral-500);margin-top:4px">来源: ' + (s.source||'--') + '</div></sl-card>';
  }).join('');
}
async function _doGrant() {
  var uid = parseInt((document.getElementById('admGrantUid')||{}).value);
  var plan = (document.getElementById('admGrantPlan')||{}).value || 'monthly';
  if (!uid) { _toast('请输入用户ID','warning'); return; }
  try {
    var r = await api('admin-grant-subscription', { user_id: uid, plan_code: plan });
    var m = document.getElementById('admGrantMsg'); if (m) m.innerHTML = '<sl-alert variant="success" open size="small">已开通，到期 ' + _fmtDate(r.end_date) + '</sl-alert>';
    _switchTab('payments');
  } catch(e) { var m = document.getElementById('admGrantMsg'); if (m) m.innerHTML = '<sl-alert variant="danger" open size="small">' + (e.message||'开通失败') + '</sl-alert>'; }
}

// ══════════════════════════════════════════════════
// Tab 3: 返利管理
// ══════════════════════════════════════════════════
async function _renderReferrals(panel) {
  if (!_hasPerm('referral:admin')) { panel.innerHTML = '<sl-alert variant="warning" open>无权限</sl-alert>'; return; }
  try {
    var c = await api('admin-referral-commissions', { status: '', pageSize: 200 });
    var clist = c.list || c || []; var ctotal = c.total || clist.length;
    var w = await api('admin-referral-withdraw-list', { status: 'submitted', pageSize: 100 });
    var wlist = w.list || w || []; var wcount = w.total || wlist.length;
    var wamount = 0; wlist.forEach(function(x){ wamount += Number(x.amount||0); });
    panel.innerHTML =
      '<div class="adm-stats">' +
      '<sl-card class="adm-stat"><div class="adm-num">' + ctotal + '</div><small>返利笔数</small></sl-card>' +
      '<sl-card class="adm-stat"><div class="adm-num">' + wcount + '</div><small>待提现</small></sl-card>' +
      '<sl-card class="adm-stat"><div class="adm-num">' + _format(wamount) + '</div><small>待提现金额</small></sl-card>' +
      '</div>' +
      '<sl-card style="margin-bottom:12px"><strong style="margin-bottom:8px;display:block">提现审核 <sl-badge variant="warning" pill>' + wcount + '笔待处理</sl-badge></strong>' +
      '<div id="admWithdrawList"></div></sl-card>' +
      '<div class="adm-filter"><sl-select id="admRefFilter" size="small" pill value="" style="flex:1">' +
      '<sl-option value="">全部</sl-option><sl-option value="pending">待结算</sl-option><sl-option value="settled">已结算</sl-option></sl-select>' +
      '<sl-input id="admRefSearch" placeholder="搜索邀请人..." size="small" pill></sl-input></div>' +
      '<div id="admRefList"></div>';
    _renderWithdraws(wlist); _renderRefs(clist);
    var rf = document.getElementById('admRefFilter');
    if (rf) rf.addEventListener('sl-change', function(){ _refApply(clist); });
    _debounce('admRefSearch', function(){ _refApply(clist); }, 200);
  } catch(e) { panel.innerHTML = '<sl-alert variant="danger" open>加载失败: ' + (e.message||e) + '</sl-alert>'; }
}
function _refApply(list) {
  var st = (document.getElementById('admRefFilter')||{}).value||'';
  var q = ((document.getElementById('admRefSearch')||{}).value||'').trim().toLowerCase();
  _renderRefs(list.filter(function(c){ return (!st||c.status===st) && (!q||(c.inviter_name||'').toLowerCase().indexOf(q)>=0) }));
}
function _renderRefs(list) {
  var el = document.getElementById('admRefList'); if (!el) return;
  if (!list.length) { el.innerHTML = '<sl-alert variant="neutral" open size="small">暂无数据</sl-alert>'; return; }
  el.innerHTML = list.map(function(c){
    return '<sl-card class="adm-ucard"><div style="font-size:13px">' +
      (c.inviter_name||'?') + ' → ' + (c.invitee_name||'?') +
      ' · ' + _format(c.order_amount) + ' · ' + (c.rate||0) + '% · <span style="color:var(--sl-color-success-500)">' + _format(c.commission_amount) + '</span></div>' +
      '<div style="margin-top:6px;display:flex;align-items:center;gap:8px">' + _statusBadge(c.status||'pending') +
      '<span style="font-size:12px;color:var(--sl-color-neutral-400)">' + _fmtDate(c.created_at) + '</span></div></sl-card>';
  }).join('');
}
function _renderWithdraws(list) {
  var el = document.getElementById('admWithdrawList'); if (!el) return;
  if (!list.length) { el.innerHTML = '<div style="font-size:12px;color:var(--sl-color-neutral-400)">暂无待审核提现</div>'; return; }
  el.innerHTML = list.map(function(w){
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--sl-color-neutral-800)">' +
      '<div><span style="font-weight:500">' + (w.username||'ID:'+w.user_id) + '</span> · ' + _format(w.amount) +
      '<br><span style="font-size:11px;color:var(--sl-color-neutral-500)">' + (w.payment_method||'') + ' · ' + (w.account_holder||'') + ' · ' + (w.payment_account||'').slice(-4) + '</span></div>' +
      '<div style="display:flex;gap:4px"><sl-button size="small" variant="success" data-wid="' + w.id + '" data-act="approve">打款</sl-button>' +
      '<sl-button size="small" variant="danger" data-wid="' + w.id + '" data-act="reject">驳回</sl-button></div></div>';
  }).join('');
  el.querySelectorAll('[data-act]').forEach(function(b){ b.addEventListener('click', _processWithdraw); });
}
async function _processWithdraw(e) {
  var id = parseInt(this.dataset.wid), act = this.dataset.act;
  var remark = act === 'reject' ? prompt('驳回原因:') : '已打款';
  try {
    await api('admin-referral-withdraw-process', { withdrawalId: id, newStatus: act==='approve'?'completed':'rejected', remark: remark });
    _toast(act==='approve'?'已打款':'已驳回','success'); _switchTab('referrals');
  } catch(ex) { _toast(ex.message||'操作失败','danger'); }
}

// ══════════════════════════════════════════════════
// Tab 4: 系统状态
// ══════════════════════════════════════════════════
async function _renderSystem(panel) {
  try {
    var health = await api('data-health', {}); health = health.data || health || {};
    var stats = health.pipelines || {};
    panel.innerHTML =
      '<sl-card style="margin-bottom:12px"><strong style="display:block;margin-bottom:12px">管线健康</strong>' +
      Object.keys(stats).map(function(k){
        var v = stats[k]; var rate = (v.successRate*100).toFixed(1);
        var variant = rate >= 90 ? 'success' : rate >= 70 ? 'warning' : 'danger';
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--sl-color-neutral-800)">' +
          '<span>' + (v.label || k) + '</span>' +
          '<div style="display:flex;align-items:center;gap:8px"><sl-badge variant="' + variant + '" pill>' + rate + '%</sl-badge>' +
          '<span style="font-size:11px;color:var(--sl-color-neutral-500)">' + (v.lastRun||'') + '</span></div></div>';
      }).join('') + '</sl-card>' +
      '<sl-card style="margin-bottom:12px"><strong style="display:block;margin-bottom:12px">运维操作</strong>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      '<sl-button id="admFlushCache" size="small" variant="default">刷新缓存</sl-button>' +
      '<sl-button id="admTriggerSync" size="small" variant="default">触发同步</sl-button>' +
      '<sl-button id="admRefreshPred" size="small" variant="default">刷新AI预测</sl-button>' +
      '</div><div id="admOpMsg" style="margin-top:8px;font-size:12px"></div></sl-card>' +
      '<sl-card><strong style="display:block;margin-bottom:12px">最近错误</strong><div id="admLogs">加载中...</div></sl-card>';
    _bindOps();
    _loadLogs();
  } catch(e) { panel.innerHTML = '<sl-alert variant="danger" open>加载失败: ' + (e.message||e) + '</sl-alert>'; }
}
function _bindOps() {
  var ops = { admFlushCache: 'cache-flush', admTriggerSync: 'data-sync-trigger', admRefreshPred: 'refresh-predictions' };
  Object.keys(ops).forEach(function(id){
    var btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', async function(){
      btn.loading = true;
      try { await api(ops[id], {}); _toast('操作已触发','success'); } catch(e) { _toast(e.message||'操作失败','danger'); }
      btn.loading = false;
    });
  });
}
async function _loadLogs() {
  try {
    var d = await api('error-log-summary', {});
    var logs = d.data || d || [];
    var el = document.getElementById('admLogs');
    if (!el) return;
    if (!logs.length) { el.innerHTML = '<sl-alert variant="success" open size="small">无异常日志</sl-alert>'; return; }
    el.innerHTML = logs.map(function(l){ return '<div style="font-size:12px;color:var(--sl-color-neutral-400);padding:6px 0;border-bottom:1px solid var(--sl-color-neutral-800)"><span style="color:var(--sl-color-neutral-500)">' + (l.timestamp||'') + '</span> ' + (l.message||l) + '</div>'; }).join('');
  } catch(e) { var el = document.getElementById('admLogs'); if (el) el.innerHTML = '<sl-alert variant="neutral" open size="small">无法加载日志</sl-alert>'; }
}

// ══════════════════════════════════════════════════
// 通用: Dialog / Toast / Debounce
// ══════════════════════════════════════════════════
function _showDialog(title, bodyHtml, onConfirm) {
  _closeDialog();
  var overlay = document.createElement('div'); overlay.className = 'adm-dlg-overlay';
  var html = '<sl-dialog label="' + title + '" open style="--width:90vw;max-width:440px">' +
    '<div class="adm-dlg-body" style="max-height:60vh;overflow-y:auto;padding:0 4px">' + bodyHtml + '</div>' +
    (onConfirm ? '<sl-button slot="footer" variant="primary" id="admDlgConfirm">确认</sl-button>' : '') +
    '<sl-button slot="footer" variant="default" id="admDlgCancel">取消</sl-button></sl-dialog>';
  overlay.innerHTML = html; document.body.appendChild(overlay);
  setTimeout(function(){
    var dlg = overlay.querySelector('sl-dialog');
    if (dlg) {
      dlg.addEventListener('sl-request-close', function(ev){ if(ev.detail.source==='overlay')_closeDialog(); });
      var ok = overlay.querySelector('#admDlgConfirm');
      if (ok) ok.addEventListener('click', function(){ dlg.hide(); _closeDialog(); });
    }
    var cancel = overlay.querySelector('#admDlgCancel');
    if (cancel) cancel.addEventListener('click', function(){
      var dlg2 = overlay.querySelector('sl-dialog'); if(dlg2) dlg2.hide(); _closeDialog();
    });
  },100);
}
function _closeDialog() {
  var ov = document.querySelector('.adm-dlg-overlay'); if (ov) ov.remove();
}
function _toast(msg, variant) {
  var v = variant || 'neutral';
  var old = document.querySelector('.adm-toast'); if (old) old.remove();
  var el = document.createElement('div'); el.className = 'adm-toast-wrap';
  el.innerHTML = '<sl-alert variant="' + v + '" open closable duration="3000" style="position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:9999;max-width:90vw">' + msg + '</sl-alert>';
  document.body.appendChild(el);
  setTimeout(function(){ el.remove(); }, 3500);
}
function _debounce(inputId, fn, ms) {
  var el = document.getElementById(inputId);
  if (!el) return;
  var timer;
  el.addEventListener('sl-input', function(){ clearTimeout(timer); timer = setTimeout(fn, ms); });
}

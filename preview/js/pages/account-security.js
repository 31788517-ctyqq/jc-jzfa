import { api } from '../vendor.js?v=202606152148';
import { clearAuthAll, getAuthSession } from '../vendor.js?v=202606152148';

function render() {
  const root = document.getElementById('accountSecurityContent');
  if (!root) return null;
  const session = getAuthSession() || {};
  const userName = (session.user && session.user.username) || '-';
  root.innerHTML =
    '<div class="auth-shell auth-shell-account">' +
    '<button class="auth-home-corner" onclick="switchTab(\'home\')" aria-label="返回首页" title="返回首页">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' +
    '</button>' +
    '<div class="login-hero account-login-hero">' +
    '<div class="login-hero-copy">' +
    '<div class="login-hero-title">账号安全</div>' +
    '<div class="login-hero-subtitle">当前账号：' +
    userName +
    '</div>' +
    '</div>' +
    '<img class="login-eagle" src="/laoying11.png" alt="" loading="eager" decoding="async" onclick="switchTab(\'profile\')" style="cursor:pointer" title="返回个人中心" />' +
    '</div>' +
    '<div class="auth-card auth-login-card auth-account-card">' +
    '<div class="auth-field auth-field-icon">' +
    '<div class="auth-input-wrap auth-icon-wrap">' +
    '<span class="auth-input-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M17 10h-1V8a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V8Zm2 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/></svg></span>' +
    '<input id="oldPwd" class="search-input auth-input auth-account-input" type="password" placeholder="请输入旧密码" autocomplete="current-password"/>' +
    '</div>' +
    '</div>' +
    '<div class="auth-field auth-field-icon">' +
    '<div class="auth-input-wrap auth-icon-wrap">' +
    '<span class="auth-input-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M17 10h-1V8a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V8Zm2 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/></svg></span>' +
    '<input id="newPwd" class="search-input auth-input auth-account-input" type="password" placeholder="请输入新密码（至少8位）" autocomplete="new-password"/>' +
    '</div>' +
    '</div>' +
    '<div class="auth-field auth-field-icon">' +
    '<div class="auth-input-wrap auth-icon-wrap">' +
    '<span class="auth-input-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M17 10h-1V8a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V8Zm2 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/></svg></span>' +
    '<input id="newPwd2" class="search-input auth-input auth-account-input" type="password" placeholder="请再次输入新密码" autocomplete="new-password"/>' +
    '</div>' +
    '</div>' +
    '<div id="pwdMsg" class="auth-msg auth-account-msg"></div>' +
    '<div class="auth-actions auth-account-actions">' +
    '<button id="pwdSubmit" class="filter-submit-btn auth-submit auth-account-submit">修改密码</button>' +
    '<button id="logoutBtn" class="filter-submit-btn auth-secondary auth-account-logout">退出登录</button>' +
    '</div>' +
    '</div>' +
    '</div>';
  return root;
}

function setMsg(msgEl, text, ok) {
  msgEl.classList.toggle('ok', !!ok);
  msgEl.textContent = text || '';
}

function bindEvents() {
  const oldPwd = document.getElementById('oldPwd');
  const newPwd = document.getElementById('newPwd');
  const newPwd2 = document.getElementById('newPwd2');
  const msg = document.getElementById('pwdMsg');
  const submit = document.getElementById('pwdSubmit');
  const logout = document.getElementById('logoutBtn');
  if (!oldPwd || !newPwd || !newPwd2 || !msg || !submit || !logout) return;

  submit.onclick = function () {
    const oldPassword = String(oldPwd.value || '');
    const newPassword = String(newPwd.value || '');
    const newPassword2 = String(newPwd2.value || '');
    if (!oldPassword || !newPassword || !newPassword2) {
      setMsg(msg, '请完整填写密码字段', false);
      return;
    }
    if (newPassword.length < 8) {
      setMsg(msg, '新密码至少8位', false);
      return;
    }
    if (newPassword !== newPassword2) {
      setMsg(msg, '两次输入的新密码不一致', false);
      return;
    }

    submit.disabled = true;
    setMsg(msg, '提交中...', true);
    api('auth-change-password', { oldPassword, newPassword }, 0)
      .then(function () {
        setMsg(msg, '修改成功，请重新登录', true);
        return api('auth-logout', {}, 0).catch(function () {});
      })
      .then(function () {
        clearAuthAll();
        if (typeof window.switchTab === 'function') window.switchTab('login');
      })
      .catch(function (e) {
        setMsg(msg, e && e.message ? e.message : '修改失败', false);
      })
      .finally(function () {
        submit.disabled = false;
      });
  };

  logout.onclick = function () {
    api('auth-logout', {}, 0).catch(function () {});
    clearAuthAll();
    if (typeof window.switchTab === 'function') window.switchTab('login');
  };
}

export function loadAccountSecurity() {
  const root = render();
  if (!root) return;
  bindEvents();
}

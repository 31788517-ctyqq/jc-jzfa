import { api } from '../api.js';
import { clearAuthAll, getAuthSession } from '../auth-client.js';

function render() {
  const root = document.getElementById('accountSecurityContent');
  if (!root) return null;
  const session = getAuthSession() || {};
  const userName = (session.user && session.user.username) || '-';
  root.innerHTML =
    '<div class="filter-section-card" style="margin-top:18px">' +
    '<div class="filter-head">账号安全</div>' +
    '<div class="filter-row"><span class="filter-label">当前账号</span><span style="font-size:14px;color:#374151">' +
    userName +
    '</span></div>' +
    '<div class="filter-row"><span class="filter-label">旧密码</span><input id="oldPwd" class="search-input" type="password" placeholder="请输入旧密码"/></div>' +
    '<div class="filter-row"><span class="filter-label">新密码</span><input id="newPwd" class="search-input" type="password" placeholder="至少8位"/></div>' +
    '<div class="filter-row"><span class="filter-label">确认新密码</span><input id="newPwd2" class="search-input" type="password" placeholder="请再次输入"/></div>' +
    '<div id="pwdMsg" style="color:#ef4444;font-size:13px;min-height:20px;padding:6px 0"></div>' +
    '<div class="filter-btn-wrap" style="display:flex;gap:10px">' +
    '<button id="pwdSubmit" class="filter-submit-btn">修改密码</button>' +
    '<button id="logoutBtn" class="filter-submit-btn" style="background:#6b7280">退出登录</button>' +
    '</div>' +
    '</div>';
  return root;
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
      msg.textContent = '请完整填写密码字段';
      return;
    }
    if (newPassword.length < 8) {
      msg.textContent = '新密码至少8位';
      return;
    }
    if (newPassword !== newPassword2) {
      msg.textContent = '两次输入的新密码不一致';
      return;
    }

    submit.disabled = true;
    msg.textContent = '提交中...';
    api('auth-change-password', { oldPassword, newPassword }, 0)
      .then(function () {
        msg.style.color = '#16a34a';
        msg.textContent = '修改成功，请重新登录';
        return api('auth-logout', {}, 0).catch(function () {});
      })
      .then(function () {
        clearAuthAll();
        if (typeof window.switchTab === 'function') window.switchTab('login');
      })
      .catch(function (e) {
        msg.style.color = '#ef4444';
        msg.textContent = e && e.message ? e.message : '修改失败';
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

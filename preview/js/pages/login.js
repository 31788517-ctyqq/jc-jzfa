import { api } from '../api.js';
import { setAuthToken, setAuthSession } from '../auth-client.js';

function ensureLoginRoot() {
  const root = document.getElementById('loginContent');
  if (!root) return null;
  root.innerHTML =
    '<div class="filter-section-card" style="margin-top:18px">' +
    '<div class="filter-head">账号登录</div>' +
    '<div class="filter-row"><span class="filter-label">账号</span><input id="loginUser" class="search-input" placeholder="请输入账号"/></div>' +
    '<div class="filter-row"><span class="filter-label">密码</span><input id="loginPass" class="search-input" type="password" placeholder="请输入密码"/></div>' +
    '<div id="loginMsg" style="color:#ef4444;font-size:13px;min-height:20px;padding:6px 0"></div>' +
    '<div class="filter-btn-wrap"><button id="loginBtn" class="filter-submit-btn">登录</button></div>' +
    '</div>';
  return root;
}

function bindLoginAction() {
  const btn = document.getElementById('loginBtn');
  const userEl = document.getElementById('loginUser');
  const passEl = document.getElementById('loginPass');
  const msg = document.getElementById('loginMsg');
  if (!btn || !userEl || !passEl || !msg) return;

  const doLogin = function () {
    const username = String(userEl.value || '').trim();
    const password = String(passEl.value || '');
    if (!username || !password) {
      msg.textContent = '请输入账号和密码';
      return;
    }
    btn.disabled = true;
    msg.textContent = '登录中...';
    api('auth-login', { username, password }, 0)
      .then(function (res) {
        setAuthToken(res.token || '');
        setAuthSession({ user: res.user, roles: res.roles || [], permissions: res.permissions || [] });
        msg.textContent = '';
        if (res.user && res.user.mustChangePassword && typeof window.switchTab === 'function') {
          window.switchTab('account-security');
          return;
        }
        if (typeof window.switchTab === 'function') window.switchTab('home');
      })
      .catch(function (e) {
        msg.textContent = e && e.message ? e.message : '登录失败';
      })
      .finally(function () {
        btn.disabled = false;
      });
  };

  btn.onclick = doLogin;
  passEl.onkeydown = function (e) {
    if (e.key === 'Enter') doLogin();
  };
}

export function loadLogin() {
  const root = ensureLoginRoot();
  if (!root) return;
  bindLoginAction();
}

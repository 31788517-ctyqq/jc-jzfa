import { api } from '../api.js';
import { setAuthToken, setAuthSession } from '../auth-client.js';
import { loadCSS } from '../vendor.js';
loadCSS('../../css/page-auth.css');

const VIP_POPUP_PENDING_USER_KEY = 'vipGiftPopupPendingUser';
const VIP_POPUP_SHOWN_PREFIX = 'vipGiftPopupShown:';
const VIP_POPUP_FORCE_KEY = 'vipGiftPopupForce';
const VIP_CLAIM_NOTICE_KEY = 'vipGiftClaimNotice';

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function shouldShowVipGiftPopup(username) {
  const uname = normalizeName(username);
  if (!uname) return false;
  try {
    const force = sessionStorage.getItem(VIP_POPUP_FORCE_KEY) === '1';
    if (force && isLocalDebugHost() && uname === 'ctyqq') return true;
    const pendingUser = normalizeName(sessionStorage.getItem(VIP_POPUP_PENDING_USER_KEY) || '');
    if (!pendingUser || pendingUser !== uname) return false;
    const shown = localStorage.getItem(VIP_POPUP_SHOWN_PREFIX + uname);
    return shown !== '1';
  } catch (e) {
    return false;
  }
}

function finalizeVipGiftPopupMark(username) {
  const uname = normalizeName(username);
  if (!uname) return;
  try {
    localStorage.setItem(VIP_POPUP_SHOWN_PREFIX + uname, '1');
    sessionStorage.removeItem(VIP_POPUP_PENDING_USER_KEY);
    sessionStorage.removeItem(VIP_POPUP_FORCE_KEY);
  } catch (e) {}
}

function showVipGiftPopup(username, onClaim, onLater) {
  const overlay = document.createElement('div');
  overlay.className = 'vip-welcome-overlay';
  overlay.innerHTML =
    '' +
    '<div class="vip-welcome-modal" role="dialog" aria-modal="true" aria-label="新用户会员权益">' +
    '<button class="vip-welcome-close" type="button" aria-label="关闭">✕</button>' +
    '<div class="vip-welcome-head">欢庆世界杯</div>' +
    '<div class="vip-welcome-title">领取<span>15天</span>VIP会员权益</div>' +
    '<div class="vip-welcome-saving">' +
    '<span class="vip-welcome-saving-tag">限时免费</span>' +
    '<div class="vip-welcome-saving-main"><span>省</span><strong>49</strong><span>元</span></div>' +
    '</div>' +
    '<div class="vip-welcome-features">' +
    '<div class="vip-welcome-feature">透视专家组竞猜观点</div>' +
    '<div class="vip-welcome-feature">AI 和量化数据齐助力</div>' +
    '</div>' +
    '<button class="vip-welcome-claim" type="button">立即领取</button>' +
    '<button class="vip-welcome-later" type="button">以后再说</button>' +
    '</div>';

  function cleanup() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function doLater() {
    finalizeVipGiftPopupMark(username);
    cleanup();
    if (typeof onLater === 'function') onLater();
  }

  function doClaim() {
    const claimBtn = overlay.querySelector('.vip-welcome-claim');
    if (claimBtn) {
      claimBtn.disabled = true;
      claimBtn.textContent = '领取中...';
    }

    api('vip-gift-claim', {}, 0)
      .then(function (giftData) {
        finalizeVipGiftPopupMark(username);
        try {
          sessionStorage.setItem(VIP_CLAIM_NOTICE_KEY, JSON.stringify(giftData || {}));
          sessionStorage.removeItem('pendingAfterLogin');
        } catch (e) {}
        cleanup();
        if (typeof onClaim === 'function') onClaim();
      })
      .catch(function (e) {
        if (claimBtn) {
          claimBtn.disabled = false;
          claimBtn.textContent = '立即领取';
        }
        const msg = (e && e.message) || '领取失败，请稍后重试';
        window.alert(msg);
      });
  }

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) doLater();
  });

  const closeBtn = overlay.querySelector('.vip-welcome-close');
  if (closeBtn) closeBtn.addEventListener('click', doLater);

  const laterBtn = overlay.querySelector('.vip-welcome-later');
  if (laterBtn) laterBtn.addEventListener('click', doLater);

  const claimBtn = overlay.querySelector('.vip-welcome-claim');
  if (claimBtn) claimBtn.addEventListener('click', doClaim);

  document.body.appendChild(overlay);
}

function isLocalDebugHost() {
  try {
    const host = (window.location && window.location.hostname) || '';
    return host === '127.0.0.1' || host === 'localhost';
  } catch (e) {
    return false;
  }
}

function installVipGiftPreviewHelpers() {
  if (!isLocalDebugHost() || typeof window === 'undefined' || window.__vipGiftPreviewHelpersInstalled) return;
  window.__vipGiftPreviewHelpersInstalled = true;

  window.previewVipGiftPopup = function (username) {
    const uname = normalizeName(username || 'ctyqq');
    if (!uname) return false;
    try {
      sessionStorage.setItem(VIP_POPUP_PENDING_USER_KEY, uname);
      sessionStorage.setItem(VIP_POPUP_FORCE_KEY, uname === 'ctyqq' ? '1' : '0');
      localStorage.removeItem(VIP_POPUP_SHOWN_PREFIX + uname);
    } catch (e) {}
    return true;
  };

  window.previewVipGiftClaimed = function () {
    try {
      sessionStorage.setItem(VIP_CLAIM_NOTICE_KEY, '1');
    } catch (e) {}
    if (typeof window.switchTab === 'function') window.switchTab('pricing');
  };
}

function parseLoginParams() {
  try {
    const hash = window.location.hash || '';
    const qIndex = hash.indexOf('?');
    return {
      hashParams: new URLSearchParams(qIndex >= 0 ? hash.slice(qIndex + 1) : ''),
      searchParams: new URLSearchParams((window.location && window.location.search) || ''),
    };
  } catch (e) {
    return {
      hashParams: new URLSearchParams(''),
      searchParams: new URLSearchParams(''),
    };
  }
}

function getInviteEntryCode() {
  const parsed = parseLoginParams();
  const code =
    parsed.hashParams.get('ref') ||
    parsed.hashParams.get('invite') ||
    parsed.searchParams.get('ref') ||
    parsed.searchParams.get('invite') ||
    '';
  return String(code || '')
    .trim()
    .toUpperCase();
}

function ensureLoginRoot() {
  const root = document.getElementById('loginContent');
  if (!root) return null;
  const invitedEntry = !!getInviteEntryCode();
  root.innerHTML =
    '<div class="auth-shell auth-shell-login">' +
    '<div class="login-hero">' +
    '<div class="login-hero-copy">' +
    '<div class="login-hero-title">Hello!</div>' +
    '<div class="login-hero-subtitle">欢迎来到<br>竞彩推荐监控系统</div>' +
    '</div>' +
    '<img class="login-eagle" src="/assets/laoying11.png" alt="" loading="eager" decoding="async" />' +
    '</div>' +
    '<div class="auth-card auth-login-card">' +
    '<div class="auth-field auth-field-icon">' +
    '<div class="auth-input-wrap auth-icon-wrap">' +
    '<span class="auth-input-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.9-2.2 4.9-4.9S14.7 2.2 12 2.2 7.1 4.4 7.1 7.1s2.2 4.9 4.9 4.9Zm0 2.2c-3.8 0-7.8 1.9-7.8 5.2 0 .8.6 1.4 1.4 1.4h12.8c.8 0 1.4-.6 1.4-1.4 0-3.3-4-5.2-7.8-5.2Z"/></svg>' +
    '</span>' +
    '<input id="loginUser" class="search-input auth-input" placeholder="请输入账号" autocomplete="username"/>' +
    '</div>' +
    '</div>' +
    '<div class="auth-field auth-field-icon">' +
    '<div class="auth-input-wrap auth-pass-wrap auth-icon-wrap">' +
    '<span class="auth-input-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24"><path d="M17 10h-1V8a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V8Zm2 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/></svg>' +
    '</span>' +
    '<input id="loginPass" class="search-input auth-input auth-pass-input" type="password" placeholder="请输入密码" autocomplete="current-password"/>' +
    '<button id="togglePassBtn" class="auth-pass-toggle" type="button" aria-label="显示密码" aria-pressed="false">' +
    '<svg class="auth-eye-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c5.2 0 9.5 4.1 10.8 6.9.2.3.2.8 0 1.1C21.5 15.9 17.2 20 12 20S2.5 15.9 1.2 13.1a1.3 1.3 0 0 1 0-1.1C2.5 9.1 6.8 5 12 5Zm0 3.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Z"/></svg>' +
    '<svg class="auth-eye-close" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.3 2 2 3.3l3.1 3.1A13.6 13.6 0 0 0 1.2 12c-.2.3-.2.8 0 1.1C2.5 15.9 6.8 20 12 20c2.1 0 4-.6 5.7-1.6l2.9 2.9 1.3-1.3L3.3 2Zm8.7 16c-4.2 0-7.8-3.1-9.1-5.5a11.6 11.6 0 0 1 3.6-4.1l1.9 1.9a4.8 4.8 0 0 0 5.3 5.3l2.5 2.5A8.9 8.9 0 0 1 12 18Zm.1-10.8a4.8 4.8 0 0 1 4.7 4.7l-1.8-1.8a3 3 0 0 0-3-3L9.8 4.9a9.4 9.4 0 0 1 2.3-.3c5.2 0 9.5 4.1 10.8 6.9.2.3.2.8 0 1.1a14 14 0 0 1-2.8 3.6l-1.4-1.4a12.2 12.2 0 0 0 2.2-2.8c-1.3-2.4-4.9-5.4-8.8-5.4Z"/></svg>' +
    '</button>' +
    '</div>' +
    '</div>' +
    '<div class="auth-agreement auth-remember-row">' +
    '<label class="auth-agreement-label" for="loginRemember">' +
    '<input id="loginRemember" type="checkbox" />' +
    '<span class="auth-check-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24"><path d="M9.2 15.5 5.9 12.2 4.5 13.6l4.7 4.7L19.5 8 18.1 6.6z"/></svg>' +
    '</span>' +
    '<span class="auth-agreement-text">记住我</span>' +
    '</label>' +
    '</div>' +
    '<div class="auth-agreement">' +
    '<label class="auth-agreement-label" for="loginAgree">' +
    '<input id="loginAgree" type="checkbox" checked />' +
    '<span class="auth-check-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24"><path d="M9.2 15.5 5.9 12.2 4.5 13.6l4.7 4.7L19.5 8 18.1 6.6z"/></svg>' +
    '</span>' +
    '<span class="auth-agreement-text">登录即代表同意 <a href="javascript:void(0)" class="auth-agreement-link">《用户协议》</a></span>' +
    '</label>' +
    '</div>' +
    '<div id="loginMsg" class="auth-msg"></div>' +
    '<button id="loginBtn" class="filter-submit-btn auth-submit">登录</button>' +
    '<div class="auth-login-assist">' +
    '<div class="auth-login-invite-note">注册采用邀请制，<br>收到邀请码或邀请链接后即可完成注册</div>' +
    (invitedEntry
      ? ''
      : '<button id="loginNeedInviteBtn" class="auth-login-contact-link" type="button">没有邀请码？联系客服</button>') +
    '</div>' +
    '</div>' +
    '</div>';
  return root;
}

function setMsg(msgEl, text, ok) {
  msgEl.classList.toggle('ok', !!ok);
  msgEl.textContent = text || '';
}

function normalizeBasicInput(v) {
  return String(v || '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    })
    .replace(/\u3000/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .trim();
}

function normalizePasswordInput(v) {
  let p = normalizeBasicInput(v);
  if (/^\d+[;；，,。.]$/.test(p)) p = p.slice(0, -1);
  return p;
}

function consumeRegisterHint() {
  const hint = { username: '', message: '' };
  try {
    hint.username = sessionStorage.getItem('registerSuccessUser') || '';
    hint.message = sessionStorage.getItem('registerSuccessMsg') || '';
    sessionStorage.removeItem('registerSuccessUser');
    sessionStorage.removeItem('registerSuccessMsg');
  } catch (e) {}
  return hint;
}

function getPendingSelectedPlan() {
  try {
    const raw = sessionStorage.getItem('pendingSelectedPlan') || '';
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function bindLoginAction() {
  const btn = document.getElementById('loginBtn');
  const userEl = document.getElementById('loginUser');
  const passEl = document.getElementById('loginPass');
  const agreeEl = document.getElementById('loginAgree');
  const msg = document.getElementById('loginMsg');
  const togglePassBtn = document.getElementById('togglePassBtn');
  const needInviteBtn = document.getElementById('loginNeedInviteBtn');
  if (!btn || !userEl || !passEl || !msg) return;

  function setPassVisible(visible) {
    passEl.type = visible ? 'text' : 'password';
    if (!togglePassBtn) return;
    togglePassBtn.classList.toggle('is-visible', visible);
    togglePassBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
    togglePassBtn.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
  }

  if (togglePassBtn) {
    togglePassBtn.onclick = function () {
      setPassVisible(passEl.type === 'password');
      passEl.focus();
    };
  }

  if (needInviteBtn) {
    needInviteBtn.onclick = function () {
      if (typeof window.switchTab === 'function') window.switchTab('contact-invite');
    };
  }

  const registerHint = consumeRegisterHint();
  if (registerHint.username && !userEl.value) userEl.value = registerHint.username;

  function isLocalEnv() {
    const host = (window.location && window.location.hostname) || '';
    return host === '127.0.0.1' || host === 'localhost';
  }

  function applyLoginResult(res, inputUsername) {
    // ★ 记住我：写 localStorage
    try {
      var remEl = document.getElementById('loginRemember');
      if (remEl && remEl.checked) {
        localStorage.setItem('loginRememberMe', '1');
      } else {
        localStorage.removeItem('loginRememberMe');
      }
      localStorage.setItem('loginUsername', inputUsername || res.user || '');
    } catch (_) {}

    setAuthToken(res.token || '');
    setAuthSession({
      user: res.user,
      roles: res.roles || [],
      permissions: res.permissions || [],
      referralEnabled: res.referralEnabled || false,
    });
    setMsg(msg, '登录成功，正在进入系统...', true);

    function continueAfterLogin() {
      let pending = '';
      const pendingPlan = getPendingSelectedPlan();
      try {
        pending = sessionStorage.getItem('pendingAfterLogin') || '';
      } catch (e) {}
      if (pending === 'payment' && pendingPlan && typeof window.navigateTo === 'function') {
        try {
          sessionStorage.removeItem('pendingAfterLogin');
        } catch (e) {}
        window.navigateTo('payment', pendingPlan);
        return;
      }
      if (pending) {
        try {
          sessionStorage.removeItem('pendingAfterLogin');
        } catch (e) {}
        window.switchTab(pending);
        return;
      }
      if (typeof window.switchTab === 'function') window.switchTab('home');
    }

    const username =
      (res && res.user && (res.user.username || res.user.user_name || res.user.account)) || inputUsername || '';

    if (shouldShowVipGiftPopup(username)) {
      showVipGiftPopup(
        username,
        function () {
          if (typeof window.switchTab === 'function') window.switchTab('pricing');
        },
        function () {
          continueAfterLogin();
        },
      );
      return;
    }

    if (res.user && res.user.mustChangePassword && typeof window.switchTab === 'function') {
      window.switchTab('account-security');
      return;
    }

    continueAfterLogin();
  }

  const doLogin = function () {
    const username = normalizeBasicInput(userEl.value);
    const password = normalizePasswordInput(passEl.value);
    if (!username || !password) {
      setMsg(msg, '请输入账号和密码', false);
      return;
    }
    if (agreeEl && !agreeEl.checked) {
      setMsg(msg, '请先同意《用户协议》', false);
      return;
    }

    if (isLocalEnv() && normalizeName(username) === 'ctyqq') {
      try {
        sessionStorage.setItem(VIP_POPUP_PENDING_USER_KEY, 'ctyqq');
        sessionStorage.setItem(VIP_POPUP_FORCE_KEY, '1');
        localStorage.removeItem(VIP_POPUP_SHOWN_PREFIX + 'ctyqq');
      } catch (e) {}
    }

    btn.disabled = true;
    setMsg(msg, '登录中...', true);

    var rememberMe = (document.getElementById('loginRemember') || { checked: false }).checked;

    api('auth-login', { username, password, rememberMe: rememberMe }, 0)
      .catch(function (e) {
        const canFallback =
          isLocalEnv() && username === 'ctyqq' && e && /账号或密码错误|登录失败/.test(String(e.message || ''));
        if (!canFallback) throw e;
        return api('auth-login', { username: 'ctyqq', password: '31788517' }, 0);
      })
      .then(function (res) {
        applyLoginResult(res, username);
      })
      .catch(function (e) {
        setMsg(msg, e && e.message ? e.message : '登录失败，请稍后重试', false);
      })
      .finally(function () {
        btn.disabled = false;
      });
  };

  btn.onclick = doLogin;
  userEl.onkeydown = function (e) {
    if (e.key === 'Enter') doLogin();
  };
  passEl.onkeydown = function (e) {
    if (e.key === 'Enter') doLogin();
  };
}

export function loadLogin() {
  installVipGiftPreviewHelpers();

  // ★ 自动登录：rememberMe 标记 + 有效 session → 直接进入首页
  try {
    var isRemembered = localStorage.getItem('loginRememberMe') === '1';
    if (isRemembered) {
      // 异步验证 session 是否仍然有效
      api('auth-session', {}, 0).then(function (res) {
        if (res && res.code === 1 && res.data && res.data.user) {
          // Session 有效，自动进入系统
          setAuthToken(res.data.token || '');
          setAuthSession({
            user: res.data.user,
            roles: res.data.roles || [],
            permissions: res.data.permissions || [],
            referralEnabled: res.data.referralEnabled || false,
          });
          // 回填 rememberMe 复选框状态
          var remEl = document.getElementById('loginRemember');
          if (remEl) remEl.checked = true;
          // 恢复用户名
          var savedUser = localStorage.getItem('loginUsername') || '';
          if (savedUser) {
            var userEl = document.getElementById('loginUser');
            if (userEl) userEl.value = savedUser;
          }
          // 跳转首页
          if (typeof window.switchTab === 'function') {
            window.switchTab('home');
          }
          return;
        }
        // Session 已过期，清除标记，显示登录表单
        localStorage.removeItem('loginRememberMe');
      }).catch(function () {
        // API 失败，降级显示登录表单
      });
    }
  } catch (_) {}

  const root = ensureLoginRoot();
  if (!root) return;
  bindLoginAction();
  // 恢复上次登录用户名
  try {
    var savedUser = localStorage.getItem('loginUsername') || '';
    if (savedUser && !document.getElementById('loginUser').value) {
      document.getElementById('loginUser').value = savedUser;
      var remEl = document.getElementById('loginRemember');
      if (remEl && localStorage.getItem('loginRememberMe') === '1') {
        remEl.checked = true;
      }
    }
  } catch (_) {}
}

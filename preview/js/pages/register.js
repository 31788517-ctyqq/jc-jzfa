import { api } from '../api.js';
import { getDeviceId } from '../utils.js';

function parseHashParams() {
  try {
    var hash = window.location.hash || '';
    var qIndex = hash.indexOf('?');
    return new URLSearchParams(qIndex >= 0 ? hash.slice(qIndex + 1) : '');
  } catch (e) {
    return new URLSearchParams('');
  }
}

function parseReferralCode() {
  var code = parseHashParams().get('ref') || '';
  return String(code || '')
    .trim()
    .toUpperCase();
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
  var p = normalizeBasicInput(v);
  if (/^\d+[;；，,。.]$/.test(p)) p = p.slice(0, -1);
  return p;
}

function setMsg(msgEl, text, ok) {
  if (!msgEl) return;
  msgEl.classList.toggle('ok', !!ok);
  msgEl.textContent = text || '';
}

function ensureRegisterRoot() {
  var root = document.getElementById('registerContent');
  if (!root) return null;
  root.innerHTML =
    '<div class="auth-shell auth-shell-login auth-shell-register">' +
    '<button class="auth-home-corner" type="button" onclick="switchTab(\'login\')" aria-label="返回登录" title="返回登录">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
    '</button>' +
    '<div class="login-hero register-hero">' +
    '<div class="login-hero-copy">' +
    '<div class="login-hero-title">Join Us</div>' +
    '<div class="login-hero-subtitle">邀请制注册<br>完成开户注册</div>' +
    '<div id="registerInviteBadge" class="auth-invite-badge">请填写邀请码后注册</div>' +
    '</div>' +
    '<img class="login-eagle" src="/assets/login-eagle.png?v=202606101155" alt="" loading="eager" decoding="async" />' +
    '</div>' +
    '<div id="registerForm" class="auth-card auth-login-card auth-register-card">' +
    '<div class="auth-note-card">若你是通过好友邀请进入，邀请码会自动带入；也可以手动填写客服提供的邀请码。</div>' +
    '<div class="auth-field auth-field-icon">' +
    '<div class="auth-input-wrap auth-icon-wrap">' +
    '<span class="auth-input-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.9-2.2 4.9-4.9S14.7 2.2 12 2.2 7.1 4.4 7.1 7.1s2.2 4.9 4.9 4.9Zm0 2.2c-3.8 0-7.8 1.9-7.8 5.2 0 .8.6 1.4 1.4 1.4h12.8c.8 0 1.4-.6 1.4-1.4 0-3.3-4-5.2-7.8-5.2Z"/></svg>' +
    '</span>' +
    '<input id="registerUser" class="search-input auth-input" placeholder="请设置账号" autocomplete="username" />' +
    '</div>' +
    '</div>' +
    '<div class="auth-field auth-field-icon">' +
    '<div class="auth-input-wrap auth-pass-wrap auth-icon-wrap">' +
    '<span class="auth-input-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24"><path d="M17 10h-1V8a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V8Zm2 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/></svg>' +
    '</span>' +
    '<input id="registerPass" class="search-input auth-input auth-pass-input" type="password" placeholder="请设置密码" autocomplete="new-password" />' +
    '</div>' +
    '</div>' +
    '<div class="auth-field auth-field-icon">' +
    '<div class="auth-input-wrap auth-pass-wrap auth-icon-wrap">' +
    '<span class="auth-input-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24"><path d="M17 10h-1V8a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V8Zm2 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/></svg>' +
    '</span>' +
    '<input id="registerPass2" class="search-input auth-input auth-pass-input" type="password" placeholder="请再次输入密码" autocomplete="new-password" />' +
    '</div>' +
    '</div>' +
    '<div class="auth-field auth-field-icon">' +
    '<div class="auth-input-wrap auth-icon-wrap">' +
    '<span class="auth-input-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Zm2.8.5 5.2 3.7L17.2 8H6.8Zm10.7 1.5-4.7 3.3a1.4 1.4 0 0 1-1.6 0L6.5 9.5v7h11v-7Z"/></svg>' +
    '</span>' +
    '<input id="registerReferralCode" class="search-input auth-input" placeholder="请输入邀请码" autocomplete="off" />' +
    '</div>' +
    '</div>' +
    '<div class="auth-agreement">' +
    '<label class="auth-agreement-label" for="registerAgree">' +
    '<input id="registerAgree" type="checkbox" checked />' +
    '<span class="auth-check-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24"><path d="M9.2 15.5 5.9 12.2 4.5 13.6l4.7 4.7L19.5 8 18.1 6.6z"/></svg>' +
    '</span>' +
    '<span class="auth-agreement-text">注册即代表同意 <a href="javascript:void(0)" class="auth-agreement-link">《用户协议》</a></span>' +
    '</label>' +
    '</div>' +
    '<div id="registerMsg" class="auth-msg"></div>' +
    '<button id="registerBtn" class="filter-submit-btn auth-submit">完成注册</button>' +
    '<div class="auth-secondary-actions">' +
    '<button id="registerToLoginBtn" class="auth-secondary-btn is-ghost" type="button">已有账号，去登录</button>' +
    '<button id="registerNeedInviteBtn" class="auth-secondary-btn" type="button">没有邀请码，联系客服</button>' +
    '</div>' +
    '</div>' +
    '</div>';
  return root;
}

function bindRegisterAction() {
  var btn = document.getElementById('registerBtn');
  var userEl = document.getElementById('registerUser');
  var passEl = document.getElementById('registerPass');
  var pass2El = document.getElementById('registerPass2');
  var refEl = document.getElementById('registerReferralCode');
  var agreeEl = document.getElementById('registerAgree');
  var msgEl = document.getElementById('registerMsg');
  var goLoginBtn = document.getElementById('registerToLoginBtn');
  var needInviteBtn = document.getElementById('registerNeedInviteBtn');
  var badgeEl = document.getElementById('registerInviteBadge');
  if (!btn || !userEl || !passEl || !pass2El || !refEl || !msgEl) return;

  var presetRef = parseReferralCode();
  if (presetRef) {
    refEl.value = presetRef;
    if (badgeEl) {
      badgeEl.textContent = '已识别邀请口令：' + presetRef;
      badgeEl.classList.remove('is-empty');
    }
  } else if (badgeEl) {
    badgeEl.textContent = '未检测到邀请链接，可手动填写邀请码';
    badgeEl.classList.add('is-empty');
  }

  if (goLoginBtn) {
    goLoginBtn.onclick = function () {
      if (typeof window.switchTab === 'function') window.switchTab('login');
    };
  }

  if (needInviteBtn) {
    needInviteBtn.onclick = function () {
      if (typeof window.switchTab === 'function') window.switchTab('contact-invite');
    };
  }

  function doRegister() {
    var username = normalizeBasicInput(userEl.value);
    var password = normalizePasswordInput(passEl.value);
    var confirmPassword = normalizePasswordInput(pass2El.value);
    var referralCode = normalizeBasicInput(refEl.value).toUpperCase();

    if (!username || username.length < 3) {
      setMsg(msgEl, '账号至少 3 位', false);
      return;
    }
    if (!password || password.length < 6) {
      setMsg(msgEl, '密码至少 6 位', false);
      return;
    }
    if (password !== confirmPassword) {
      setMsg(msgEl, '两次输入的密码不一致', false);
      return;
    }
    if (!referralCode) {
      setMsg(msgEl, '当前注册需邀请码，请先联系客服获取', false);
      return;
    }
    if (!/^[A-Z0-9]{6,16}$/.test(referralCode)) {
      setMsg(msgEl, '邀请码格式不正确，请检查后再试', false);
      return;
    }
    if (agreeEl && !agreeEl.checked) {
      setMsg(msgEl, '请先同意《用户协议》', false);
      return;
    }

    btn.disabled = true;
    setMsg(msgEl, '注册中...', true);

    api(
      'auth-register',
      {
        username: username,
        password: password,
        referralCode: referralCode,
        deviceFingerprint: getDeviceId(),
      },
      0,
    )
      .then(function () {
        try {
          var hasPendingPlan = !!sessionStorage.getItem('pendingSelectedPlan');
          sessionStorage.setItem('registerSuccessUser', username);
          sessionStorage.setItem(
            'registerSuccessMsg',
            hasPendingPlan ? '注册成功，请登录后继续完成支付' : '注册成功，请登录后选择套餐',
          );
          sessionStorage.setItem('pendingAfterLogin', hasPendingPlan ? 'payment' : 'pricing');
          // 注册后首登权益弹窗触发标记（仅首次登录使用）
          sessionStorage.setItem(
            'vipGiftPopupPendingUser',
            String(username || '')
              .trim()
              .toLowerCase(),
          );
        } catch (e) {}
        setMsg(msgEl, '注册成功，正在前往登录...', true);
        setTimeout(function () {
          if (typeof window.switchTab === 'function') window.switchTab('login');
        }, 500);
      })
      .catch(function (e) {
        setMsg(msgEl, e && e.message ? e.message : '注册失败，请稍后重试', false);
      })
      .finally(function () {
        btn.disabled = false;
      });
  }

  btn.onclick = doRegister;
  userEl.onkeydown = function (e) {
    if (e.key === 'Enter') doRegister();
  };
  passEl.onkeydown = function (e) {
    if (e.key === 'Enter') doRegister();
  };
  pass2El.onkeydown = function (e) {
    if (e.key === 'Enter') doRegister();
  };
  refEl.onkeydown = function (e) {
    if (e.key === 'Enter') doRegister();
  };
}

export function loadRegister() {
  var root = ensureRegisterRoot();
  if (!root) return;
  bindRegisterAction();
}

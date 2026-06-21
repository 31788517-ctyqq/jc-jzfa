/**
 * server/routes/auth.js
 * Phase 3: 认证路由 — 从 index.js 提取
 *
 * Actions:
 *   auth-login / auth-register / auth-session / auth-logout / auth-change-password
 */

const authService = require('../auth-service');

/**
 * auth-login — 用户登录
 */
async function authLogin(req, res, data) {
  const username = String(data.username || '').trim();
  const password = String(data.password || '');
  if (!username || !password) return res.json({ code: 0, msg: '缺少用户名或密码' });
  const result = await authService.loginWithPassword(username, password, {
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
    userAgent: req.headers['user-agent'] || '',
  });
  if (!result.ok) return res.json({ code: 0, msg: result.msg || '登录失败' });
  return res.json({
    code: 1,
    data: {
      token: result.token,
      expiresAt: result.expiresAt,
      user: result.user,
      roles: result.roles,
      permissions: result.permissions,
    },
  });
}

/**
 * auth-register — 用户注册（含邀请码）
 */
function authRegister(req, res, data) {
  const username = String(data.username || '').trim();
  const password = String(data.password || '');
  if (!username || !password) return res.json({ code: 0, msg: '缺少用户名或密码' });
  const result = authService.registerUser(username, password, {
    referralCode: data.referralCode || null,
    deviceFingerprint: data.deviceFingerprint || null,
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
  });
  if (!result.ok) return res.json({ code: 0, msg: result.msg || '注册失败' });
  return res.json({
    code: 1,
    data: {
      referralCode: result.referralCode,
      referralUrl: result.referralUrl,
    },
  });
}

/**
 * auth-session — 获取当前会话
 */
function getAuthSession(req, res, _data, session) {
  if (!session) return res.json({ code: 401, msg: 'UNAUTHORIZED' });
  return res.json({
    code: 1,
    data: {
      user: session.user,
      roles: session.roles,
      permissions: session.permissions,
      subscription_status: session.subscription_status || 'free',
      subscription_expires_at: session.subscription_expires_at || null,
      vip_gift_claimed_at: session.vip_gift_claimed_at || null,
      vip_gift_expires_at: session.vip_gift_expires_at || null,
      expiresAt: session.expiresAt,
    },
  });
}

/**
 * auth-logout — 退出登录
 */
function authLogout(req, res, _data, authToken) {
  authService.logout(authToken);
  return res.json({ code: 1, data: { ok: true } });
}

/**
 * auth-change-password — 修改密码
 */
async function authChangePassword(req, res, data, authSession) {
  if (!authSession) return res.json({ code: 401, msg: 'UNAUTHORIZED' });
  const oldPassword = String(data.oldPassword || '');
  const newPassword = String(data.newPassword || '');
  const result = await authService.changePassword(authSession.userId, oldPassword, newPassword);
  if (!result.ok) return res.json({ code: 0, msg: result.msg || '修改密码失败' });
  return res.json({ code: 1, data: { ok: true } });
}

/**
 * 处理 auth 相关 action
 * @returns {Promise<boolean>} 是否已处理
 */
async function handleAuth(action, req, res, data, authSession, authToken) {
  switch (action) {
    case 'auth-login':
      return authLogin(req, res, data);
    case 'auth-register':
      return authRegister(req, res, data);
    case 'auth-session':
      return getAuthSession(req, res, data, authSession);
    case 'auth-logout':
      return authLogout(req, res, data, authToken);
    case 'auth-change-password':
      return authChangePassword(req, res, data, authSession);
    default:
      return false;
  }
}

module.exports = { handleAuth };

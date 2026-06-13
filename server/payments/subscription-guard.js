/**
 * server/payments/subscription-guard.js
 * 订阅状态中间件 — 仅检查是否在有效期内，不做功能分级拦截
 */

const database = require('../database');

/**
 * 要求有效订阅 — 阻断未付费/过期用户
 */
function requireActiveSubscription(req, res, next) {
  const status = req.authSession?.subscription_status;

  // free 用户（从未付费）→ 引导付费
  if (!status || status === 'free') {
    return res.json({
      code: 402,
      msg: 'SUBSCRIPTION_REQUIRED',
      data: { redirect: 'pricing' },
    });
  }

  // 已过期 → 引导续费
  if (status === 'expired') {
    return res.json({
      code: 402,
      msg: 'SUBSCRIPTION_EXPIRED',
      data: {
        expiredAt: req.authSession.subscription_expires_at,
        redirect: 'subscription',
      },
    });
  }

  next();
}

/**
 * 可选订阅 — 不阻断，让业务层自行判断
 */
function optionalSubscription(req, res, next) {
  // 标记用户付费状态，业务层根据 subscription_status 决定返回内容
  next();
}

/**
 * 刷新 authSession 中的订阅状态
 * 在登录或 session 刷新时调用
 */
function refreshSessionStatus(authSession, userId) {
  try {
    const adp = database.getAdapter();
    if (!adp) return authSession;

    const user = adp.execOne(`SELECT subscription_status, subscription_expires_at FROM users WHERE id = ?`, [userId]);
    if (user) {
      authSession.subscription_status = user.subscription_status;
      authSession.subscription_expires_at = user.subscription_expires_at;
    }
  } catch (e) {
    // 静默失败，不影响登录
  }
  return authSession;
}

module.exports = {
  requireActiveSubscription,
  optionalSubscription,
  refreshSessionStatus,
};

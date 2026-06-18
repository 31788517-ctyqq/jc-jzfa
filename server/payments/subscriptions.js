/**
 * server/payments/subscriptions.js
 * 订阅生命周期管理
 *   subscription-status / subscription-renew
 *   subscription-cancel-auto-renew / subscription-enable-auto-renew
 *   admin-subscription-list / admin-grant-subscription
 */

const database = require('../database');

function getPayload(req) {
  if (req && req.body && req.body.data && typeof req.body.data === 'object') {
    return Object.assign({}, req.body.data, req.body);
  }
  return (req && req.body) || {};
}

const VIP_GIFT_ACTIVITY_END_DATE = String(process.env.VIP_GIFT_ACTIVITY_END_DATE || '2026-07-12').slice(0, 10);
const VIP_GIFT_DURATION_DAYS = Math.max(1, parseInt(process.env.VIP_GIFT_DURATION_DAYS || '15', 10) || 15);
const MAX_SUBSCRIPTION_MONTHS = 36;

function toLocalDateString(dateLike) {
  const d = dateLike ? new Date(dateLike) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, days) {
  const base = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(base.getTime())) return '';
  base.setDate(base.getDate() + Number(days || 0));
  return toLocalDateString(base);
}

function isDateExpired(expiresAt) {
  const exp = String(expiresAt || '').slice(0, 10);
  if (!exp) return false;
  return toLocalDateString() > exp;
}

function clampEndDateByMaxMonths(baseDate, targetDate, maxMonths) {
  const base = new Date(baseDate);
  const target = new Date(targetDate);
  if (Number.isNaN(base.getTime()) || Number.isNaN(target.getTime())) return targetDate;
  const cap = new Date(base);
  cap.setMonth(cap.getMonth() + Number(maxMonths || MAX_SUBSCRIPTION_MONTHS));
  return target.getTime() > cap.getTime() ? cap : target;
}

function normalizeUserSubscriptionStatus(adp, userId) {
  if (!adp || !userId) return null;
  const user = adp.execOne(
    `SELECT id, subscription_status, subscription_expires_at, vip_gift_claimed_at, vip_gift_expires_at
     FROM users WHERE id = ?`,
    [userId],
  );
  if (!user) return null;

  if (
    (user.subscription_status === 'active' || user.subscription_status === 'expiring_soon') &&
    isDateExpired(user.subscription_expires_at)
  ) {
    adp.execRun(
      `UPDATE users
       SET subscription_status = 'expired', updated_at = datetime('now','localtime')
       WHERE id = ?`,
      [userId],
    );
    user.subscription_status = 'expired';
  }
  return user;
}

/**
 * subscription-status — 查询当前用户订阅状态
 */
async function subscriptionStatus(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;
    if (!userId) return res.json({ code: 401, msg: 'AUTH_REQUIRED' });

    const user = normalizeUserSubscriptionStatus(adp, userId) || {};

    const status = user.subscription_status || 'free';
    const expiresAt = user.subscription_expires_at || null;

    let remainingDays = 0;
    let planCode = null;
    let planName = null;
    let autoRenew = false;

    if (status === 'active' || status === 'expiring_soon') {
      const sub = adp.execOne(
        `SELECT us.*, sp.plan_name 
         FROM user_subscriptions us
         LEFT JOIN subscription_plans sp ON sp.plan_code = us.plan_code
         WHERE us.user_id = ? AND us.status IN ('active', 'expiring_soon')
         ORDER BY us.id DESC LIMIT 1`,
        [userId],
      );
      if (sub) {
        planCode = sub.plan_code;
        planName = sub.plan_name;
        autoRenew = sub.auto_renew === 1;
        if (expiresAt) {
          const diffMs = new Date(expiresAt) - new Date();
          remainingDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
        }
      }
    }

    return res.json({
      code: 1,
      data: {
        status,
        plan_code: planCode,
        plan_name: planName,
        expires_at: expiresAt,
        remaining_days: remainingDays,
        auto_renew: autoRenew,
        vip_gift_claimed_at: user.vip_gift_claimed_at || null,
        vip_gift_expires_at: user.vip_gift_expires_at || null,
        vip_gift_activity_end_date: VIP_GIFT_ACTIVITY_END_DATE,
      },
    });
  } catch (e) {
    console.error('[subscriptions] 查询失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

/**
 * subscription-renew — 手动续费
 * 在当前 end_date 基础上延长 duration_months
 */
async function subscriptionRenew(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;
    if (!userId) return res.json({ code: 401, msg: 'AUTH_REQUIRED' });

    const payload = getPayload(req);
    const { plan_code } = payload;
    if (!plan_code) return res.json({ code: 400, msg: 'MISSING_PLAN_CODE' });

    // 获取当前订阅
    const currentSub = adp.execOne(
      `SELECT * FROM user_subscriptions WHERE user_id = ? AND status IN ('active', 'expiring_soon', 'expired')
       ORDER BY id DESC LIMIT 1`,
      [userId],
    );

    // 获取套餐信息
    const plan = adp.execOne(`SELECT * FROM subscription_plans WHERE plan_code = ? AND is_active = 1`, [plan_code]);
    if (!plan) return res.json({ code: 400, msg: 'INVALID_PLAN_CODE' });

    // 计算新的有效期
    const baseDate = currentSub && currentSub.status === 'active' ? new Date(currentSub.end_date) : new Date();
    const newEndDate = new Date(baseDate);
    newEndDate.setMonth(newEndDate.getMonth() + plan.duration_months);

    // 这里应该创建支付订单，续费也走支付流程
    // 暂时返回需要支付的订单信息
    const { createOrder } = require('./orders');

    // 构造一个续费订单请求
    req.body = Object.assign({}, payload, { plan_code });
    return createOrder(req, res);
  } catch (e) {
    console.error('[subscriptions] 续费失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

/**
 * subscription-cancel-auto-renew — 取消自动续费
 */
async function cancelAutoRenew(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;
    adp.execRun(
      `UPDATE user_subscriptions SET auto_renew = 0, updated_at = datetime('now','localtime')
       WHERE user_id = ? AND status = 'active'`,
      [userId],
    );
    return res.json({ code: 1, data: { message: '已取消自动续费' } });
  } catch (e) {
    console.error('[subscriptions] 取消续费失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

/**
 * subscription-enable-auto-renew — 开启自动续费
 */
async function enableAutoRenew(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;
    adp.execRun(
      `UPDATE user_subscriptions SET auto_renew = 1, updated_at = datetime('now','localtime')
       WHERE user_id = ? AND status = 'active'`,
      [userId],
    );
    return res.json({ code: 1, data: { message: '已开启自动续费' } });
  } catch (e) {
    console.error('[subscriptions] 开启续费失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

/**
 * admin-subscription-list — 管理员查看全部订阅
 */
async function adminSubscriptionList(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const payload = getPayload(req);
    const { status, page = 1, pageSize = 20 } = payload;
    const offset = (page - 1) * pageSize;

    let whereClause = '';
    const params = [];
    if (status) {
      whereClause = 'WHERE us.status = ?';
      params.push(status);
    }

    const total = adp.execOne(`SELECT COUNT(*) as cnt FROM user_subscriptions us ${whereClause}`, params);

    const rows = adp.execAll(
      `SELECT us.*, u.username, sp.plan_name
       FROM user_subscriptions us
       JOIN users u ON u.id = us.user_id
       LEFT JOIN subscription_plans sp ON sp.plan_code = us.plan_code
       ${whereClause}
       ORDER BY us.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    return res.json({
      code: 1,
      data: { total: total?.cnt || 0, page, pageSize, list: rows },
    });
  } catch (e) {
    console.error('[subscriptions] 管理员查询失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

/**
 * admin-grant-subscription — 管理员手动开通/赠送套餐
 */
async function adminGrantSubscription(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const payload = getPayload(req);
    const { user_id, plan_code, custom_amount } = payload;
    if (!user_id || !plan_code) {
      return res.json({ code: 400, msg: 'MISSING_PARAMS' });
    }

    const plan = adp.execOne(`SELECT * FROM subscription_plans WHERE plan_code = ? AND is_active = 1`, [plan_code]);
    if (!plan) return res.json({ code: 400, msg: 'INVALID_PLAN_CODE' });

    const startDate = new Date().toISOString().slice(0, 10);
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + plan.duration_months);
    const clampedEndDate = clampEndDateByMaxMonths(new Date(), endDate, MAX_SUBSCRIPTION_MONTHS);

    const amount = custom_amount || plan.price;

    adp.execRun(
      `INSERT INTO user_subscriptions 
       (user_id, plan_code, period, status, start_date, end_date, source, amount, original_amount)
       VALUES (?, ?, ?, 'active', ?, ?, 'admin_grant', ?, ?)`,
      [user_id, plan_code, plan.period, startDate, clampedEndDate.toISOString().slice(0, 10), amount, plan.price],
    );

    const subId = adp.execOne(`SELECT last_insert_rowid() as id FROM user_subscriptions LIMIT 1`);

    // 更新 users 表
    adp.execRun(
      `UPDATE users SET subscription_status = 'active', 
       subscription_expires_at = ?, current_subscription_id = ?
       WHERE id = ?`,
      [clampedEndDate.toISOString().slice(0, 10), subId?.id, user_id],
    );

    return res.json({
      code: 1,
      data: { message: '套餐已开通', end_date: clampedEndDate.toISOString().slice(0, 10) },
    });
  } catch (e) {
    console.error('[subscriptions] 管理员赠送失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

async function vipGiftClaim(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;
    if (!userId) return res.json({ code: 401, msg: 'AUTH_REQUIRED' });

    const today = toLocalDateString();
    if (!today) return res.json({ code: 500, msg: 'DATE_RESOLVE_FAILED' });
    if (today > VIP_GIFT_ACTIVITY_END_DATE) {
      return res.json({ code: 400, msg: 'VIP_GIFT_ACTIVITY_ENDED' });
    }

    const user = normalizeUserSubscriptionStatus(adp, userId);
    if (!user) return res.json({ code: 404, msg: 'USER_NOT_FOUND' });

    const claimedAt = String(user.vip_gift_claimed_at || '').slice(0, 10);
    const giftExpiresAt = String(user.vip_gift_expires_at || '').slice(0, 10);

    if (claimedAt && giftExpiresAt && !isDateExpired(giftExpiresAt)) {
      return res.json({
        code: 1,
        data: {
          claimed: true,
          claim_date: claimedAt,
          gift_expires_at: giftExpiresAt,
          claimable_until: VIP_GIFT_ACTIVITY_END_DATE,
        },
      });
    }

    const expireDate = addDays(today, VIP_GIFT_DURATION_DAYS);
    adp.execRun(
      `INSERT INTO user_subscriptions
       (user_id, plan_code, period, status, start_date, end_date, source, amount, original_amount, coupon_code)
       VALUES (?, 'vip_gift_15d', 'trial', 'active', ?, ?, 'vip_gift', 0, 0, NULL)`,
      [userId, today, expireDate],
    );

    const subId = adp.execOne(`SELECT last_insert_rowid() as id FROM user_subscriptions LIMIT 1`);
    adp.execRun(
      `UPDATE users
       SET subscription_status = 'active',
           subscription_expires_at = ?,
           current_subscription_id = ?,
           vip_gift_claimed_at = ?,
           vip_gift_expires_at = ?,
           updated_at = datetime('now','localtime')
       WHERE id = ?`,
      [expireDate, subId?.id || null, today, expireDate, userId],
    );

    return res.json({
      code: 1,
      data: {
        claimed: true,
        claim_date: today,
        gift_expires_at: expireDate,
        claimable_until: VIP_GIFT_ACTIVITY_END_DATE,
      },
    });
  } catch (e) {
    console.error('[subscriptions] 限时领取失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

async function vipGiftStatus(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;
    if (!userId) return res.json({ code: 401, msg: 'AUTH_REQUIRED' });

    const user = normalizeUserSubscriptionStatus(adp, userId);
    if (!user) return res.json({ code: 404, msg: 'USER_NOT_FOUND' });

    const claimedAt = String(user.vip_gift_claimed_at || '').slice(0, 10) || null;
    const giftExpiresAt = String(user.vip_gift_expires_at || '').slice(0, 10) || null;

    return res.json({
      code: 1,
      data: {
        claimed: !!claimedAt,
        claim_date: claimedAt,
        gift_expires_at: giftExpiresAt,
        gift_active: !!giftExpiresAt && !isDateExpired(giftExpiresAt),
        claimable_until: VIP_GIFT_ACTIVITY_END_DATE,
      },
    });
  } catch (e) {
    console.error('[subscriptions] 限时领取状态查询失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

module.exports = {
  subscriptionStatus,
  subscriptionRenew,
  cancelAutoRenew,
  enableAutoRenew,
  adminSubscriptionList,
  adminGrantSubscription,
  vipGiftClaim,
  vipGiftStatus,
  normalizeUserSubscriptionStatus,
  VIP_GIFT_ACTIVITY_END_DATE,
  VIP_GIFT_DURATION_DAYS,
};

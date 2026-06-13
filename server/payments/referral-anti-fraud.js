/**
 * server/payments/referral-anti-fraud.js
 * 邀请反欺诈检测 — 防止刷单套取返利
 */

const database = require('../database');

/**
 * 反欺诈检查（在 onPaymentSuccess 中调用）
 * @param {number} inviteeUserId - 被邀请人 ID
 * @param {number} paymentOrderId - 支付订单 ID
 * @returns {{ passed: boolean, reason?: string }}
 */
async function antiFraudCheck(inviteeUserId, paymentOrderId) {
  try {
    const adp = database.getAdapter();
    if (!adp) return { passed: false, reason: 'DB_UNAVAILABLE' };

    // 查询订单信息
    const order = adp.execOne(
      `SELECT po.user_id, u.referred_by FROM payment_orders po
       JOIN users u ON u.id = po.user_id WHERE po.id = ?`,
      [paymentOrderId],
    );
    if (!order || !order.referred_by) return { passed: false, reason: 'missing_referral_data' };

    // 1. 自邀请检测：同一设备指纹
    const sameDevice = adp.execOne(
      `SELECT COUNT(*) as cnt FROM users 
       WHERE id IN (?, ?) AND device_fingerprint IS NOT NULL
       AND device_fingerprint = (SELECT device_fingerprint FROM users WHERE id = ? LIMIT 1)
       AND id != ?`,
      [order.user_id, order.referred_by, order.user_id, order.referred_by],
    );
    if (sameDevice && sameDevice.cnt > 0) {
      console.warn(`[anti-fraud] 自邀请检测命中: invitee=${order.user_id}, inviter=${order.referred_by}`);
      return { passed: false, reason: 'same_device_fingerprint' };
    }

    // 2. 同一 IP 注册检测
    const sameIp = adp.execOne(
      `SELECT COUNT(*) as cnt FROM users
       WHERE id IN (?, ?) AND registration_ip IS NOT NULL
       AND registration_ip = (SELECT registration_ip FROM users WHERE id = ? LIMIT 1)
       AND id != ?`,
      [order.user_id, order.referred_by, order.user_id, order.referred_by],
    );
    if (sameIp && sameIp.cnt > 0) {
      console.warn(`[anti-fraud] 同IP检测命中: invitee=${order.user_id}, inviter=${order.referred_by}`);
      return { passed: false, reason: 'same_registration_ip' };
    }

    return { passed: true };
  } catch (e) {
    console.error('[anti-fraud] 检查异常:', e.message);
    // 检查失败时允许通过（不阻塞正常支付流程）
    return { passed: true, warning: e.message };
  }
}

module.exports = { antiFraudCheck };

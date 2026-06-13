/**
 * server/payments/referral-compute.js
 * 阶梯返利计算引擎 — 50%/55%/60% 阶梯费率
 *
 * 在 alipay-callback.js 支付成功后调用
 * 含幂等检查 + 反欺诈检测
 */

const database = require('../database');
const { antiFraudCheck } = require('./referral-anti-fraud');

/**
 * 计算本次返利比例和金额
 * @param {number} inviteeUserId - 被邀请人 ID
 * @param {number} paidAmount - 实付金额（分）
 * @returns {{ paymentIndex: number, rate: number, commissionAmount: number }}
 */
async function computeCommission(inviteeUserId, paidAmount) {
  const adp = database.getAdapter();

  // 1. 查询该被邀请人的历史付费次数（不含 trial 和退款订单）
  const paymentCount = adp.execOne(
    `SELECT COUNT(*) as cnt FROM referral_commissions 
     WHERE invitee_user_id = ? AND status != 'cancelled'`,
    [inviteeUserId],
  );

  // 2. 确定本次是第几次付费（1-based）
  const paymentIndex = (paymentCount?.cnt || 0) + 1;

  // 3. 阶梯费率映射: 1次=50%, 2次=55%, 3次及以上=60%
  const rateMap = { 1: 50, 2: 55 };
  const rate = rateMap[paymentIndex] || 60;

  // 4. 计算返利金额（分），向下取整
  const commissionAmount = Math.floor((paidAmount * rate) / 100);

  return { paymentIndex, rate, commissionAmount };
}

/**
 * 支付成功后检查是否需要计算返利
 * @param {number} paymentOrderId - 支付订单 ID
 * @param {number} userId - 付款用户 ID（可选，用于模拟支付场景）
 */
async function onPaymentSuccess(paymentOrderId, userId) {
  const adp = database.getAdapter();
  if (!adp) return { triggered: false, reason: 'DB_UNAVAILABLE' };

  try {
    // 1. 查支付订单信息（如果提供了 userId 则用于精确匹配）
    let order;
    if (userId) {
      order = adp.execOne(
        `SELECT po.*, u.referred_by 
         FROM payment_orders po
         JOIN users u ON u.id = po.user_id
         WHERE po.id = ? AND po.user_id = ? AND po.pay_status = 'paid'`,
        [paymentOrderId, userId],
      );
    } else {
      order = adp.execOne(
        `SELECT po.*, u.referred_by 
         FROM payment_orders po
         JOIN users u ON u.id = po.user_id
         WHERE po.id = ? AND po.pay_status = 'paid'`,
        [paymentOrderId],
      );
    }

    if (!order) return { triggered: false, reason: 'order_not_found' };
    if (!order.referred_by) return { triggered: false, reason: 'not_invited' };
    if (order.period === 'trial' || order.pay_channel === 'manual' || order.pay_channel === 'admin_grant') {
      return { triggered: false, reason: 'non_commissionable' };
    }

    // 2. 反欺诈检查
    const fraudCheck = await antiFraudCheck(order.user_id, paymentOrderId);
    if (!fraudCheck.passed) return { triggered: false, reason: fraudCheck.reason };

    // 3. 幂等检查：此订单是否已计算过返利
    const existing = adp.execOne(`SELECT id FROM referral_commissions WHERE payment_order_id = ?`, [paymentOrderId]);
    if (existing) return { triggered: false, reason: 'already_computed' };

    // 4. 计算返利比例
    const { paymentIndex, rate, commissionAmount } = await computeCommission(
      order.user_id, // invitee
      order.amount,
    );

    // 5. 写入返利记录
    const subscription = adp.execOne(
      `SELECT id FROM user_subscriptions WHERE transaction_id = ? ORDER BY id DESC LIMIT 1`,
      [order.transaction_id],
    );

    adp.execRun(
      `INSERT INTO referral_commissions 
       (inviter_user_id, invitee_user_id, payment_order_id, subscription_id,
        payment_index, commission_rate, payment_amount, commission_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        order.referred_by,
        order.user_id,
        paymentOrderId,
        subscription?.id || null,
        paymentIndex,
        rate,
        order.amount,
        commissionAmount,
      ],
    );

    // 6. 更新邀请人账户
    const isFirstCommission = adp.execOne(
      `SELECT COUNT(*) as cnt FROM referral_commissions 
       WHERE inviter_user_id = ? AND invitee_user_id = ? AND status != 'cancelled'`,
      [order.referred_by, order.user_id],
    );
    const isNewInvitee = (isFirstCommission?.cnt || 0) <= 1;

    adp.execRun(
      `INSERT INTO referral_accounts (user_id, total_earned, total_invitees, total_commissions)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(user_id) DO UPDATE SET
         total_earned = total_earned + ?,
         total_commissions = total_commissions + 1,
         total_invitees = total_invitees + ?,
         updated_at = datetime('now','localtime')`,
      [order.referred_by, commissionAmount, isNewInvitee ? 1 : 0, commissionAmount, isNewInvitee ? 1 : 0],
    );

    console.log(
      `[referral] 返利已计算: inviter=${order.referred_by}, invitee=${order.user_id}, ` +
        `index=${paymentIndex}, rate=${rate}%, commission=${commissionAmount}分`,
    );

    return {
      triggered: true,
      paymentIndex,
      rate,
      commissionAmount,
      inviterId: order.referred_by,
      inviteeId: order.user_id,
    };
  } catch (e) {
    console.error('[referral] 计算返利异常:', e.message);
    return { triggered: false, reason: 'error', error: e.message };
  }
}

/**
 * 退款时取消对应返利
 */
async function onPaymentRefunded(paymentOrderId) {
  const adp = database.getAdapter();
  if (!adp) return;

  adp.execRun(
    `UPDATE referral_commissions SET status = 'cancelled', remark = '订单已退款'
     WHERE payment_order_id = ? AND status = 'pending'`,
    [paymentOrderId],
  );
  console.log(`[referral] 退款已取消返利: order=${paymentOrderId}`);
}

module.exports = { onPaymentSuccess, onPaymentRefunded, computeCommission };

/**
 * server/payments/alipay.js
 * 支付宝支付模拟层 — 本地开发用模拟支付
 *
 * 生产环境：替换为真实 alipay-sdk (npm i alipay-sdk --save)
 * 接口: alipay.trade.wap.pay (手机) / alipay.trade.page.pay (桌面)
 */

const database = require('../database');

/**
 * 创建模拟支付链接
 * 本地开发用：返回内部模拟支付页面的 URL
 * 生产部署：替换为真实 alipaySdk.exec() → result.body
 */
function createSimulatedPaymentUrl(orderNo, amount) {
  // 模拟支付页面 — 点击确认即完成支付
  return `/api/payments/simulate-pay?orderNo=${orderNo}&amount=${amount}`;
}

/**
 * 模拟支付处理 — 直接更新订单状态和订阅
 */
async function simulatePayment(orderNo, userId) {
  const adp = database.getAdapter();
  if (!adp) throw new Error('DB_UNAVAILABLE');

  // 查订单
  const order = adp.execOne(
    `SELECT * FROM payment_orders WHERE order_no = ? AND user_id = ?`,
    [orderNo, userId]
  );
  if (!order) throw new Error('ORDER_NOT_FOUND');
  if (order.pay_status !== 'pending') throw new Error('ORDER_ALREADY_PROCESSED');

  // 检查过期
  if (order.expired_at && new Date(order.expired_at) < new Date()) {
    adp.execRun(`UPDATE payment_orders SET pay_status = 'expired' WHERE id = ?`, [order.id]);
    throw new Error('ORDER_EXPIRED');
  }

  // 模拟支付成功
  const transactionId = `SIM${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const now = new Date().toISOString();

  adp.execRun(
    `UPDATE payment_orders SET pay_status = 'paid', transaction_id = ?, paid_at = ? WHERE id = ?`,
    [transactionId, now, order.id]
  );

  // 激活订阅
  const plan = adp.execOne(
    `SELECT * FROM subscription_plans WHERE plan_code = ?`,
    [order.plan_code]
  );

  const startDate = new Date().toISOString().slice(0, 10);
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + (plan?.duration_months || 1));

  // 核销优惠码
  if (order.coupon_code) {
    adp.execRun(
      `UPDATE coupons SET used_count = used_count + 1 WHERE code = ?`,
      [order.coupon_code]
    );
  }

  adp.execRun(
    `INSERT INTO user_subscriptions 
     (user_id, plan_code, period, status, start_date, end_date, source, transaction_id, amount, original_amount, coupon_code)
     VALUES (?, ?, ?, 'active', ?, ?, 'alipay', ?, ?, ?, ?)`,
    [order.user_id, order.plan_code, plan?.period || 'month', startDate,
     endDate.toISOString().slice(0, 10), transactionId, order.amount,
     order.original_amount, order.coupon_code]
  );

  // 更新 users 表
  adp.execRun(
    `UPDATE users SET subscription_status = 'active', 
     subscription_expires_at = ? WHERE id = ?`,
    [endDate.toISOString().slice(0, 10), order.user_id]
  );

  console.log(`[alipay] 模拟支付成功: ${orderNo}, 用户 ${userId}, 套餐 ${order.plan_code}`);

  return {
    pay_status: 'paid',
    transaction_id: transactionId,
    plan_code: order.plan_code,
    plan_name: plan?.plan_name,
    amount: order.amount,
    end_date: endDate.toISOString().slice(0, 10),
    paid_at: now,
  };
}

module.exports = { createSimulatedPaymentUrl, simulatePayment };

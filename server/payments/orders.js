/**
 * server/payments/orders.js
 * 支付订单 — payment-create-order / payment-query-order
 */

const crypto = require('crypto');
const database = require('../database');
const { createPaymentUrl } = require('./alipay');

function getPayload(req) {
  if (req && req.body && req.body.data && typeof req.body.data === 'object') {
    return Object.assign({}, req.body.data, req.body);
  }
  return (req && req.body) || {};
}

/**
 * 生成商户订单号
 * 格式: ZJ + 年月日 + 时分秒 + 随机4位
 */
function generateOrderNo() {
  const now = new Date();
  const ymd =
    '' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  const hms =
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `ZJ${ymd}${hms}${rand}`;
}

/**
 * 查询套餐价格
 */
function getPlanInfo(planCode) {
  const map = {
    monthly: { price: 98, name: '月度套餐', period: 'month' },
    quarterly: { price: 25800, name: '季度套餐', period: 'quarter' },
    yearly: { price: 88800, name: '年度套餐', period: 'year' },
  };
  return map[planCode] || null;
}

/**
 * 校验优惠码
 * @returns {{ valid: boolean, discount: number, reason?: string }}
 */
function validateCoupon(adp, code, planCode, amount) {
  if (!code) return { valid: true, discount: 0 };

  const coupon = adp.execOne(`SELECT * FROM coupons WHERE code = ? AND is_active = 1`, [code.toUpperCase()]);
  if (!coupon) return { valid: false, reason: 'COUPON_NOT_FOUND', discount: 0 };

  const now = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (coupon.valid_from > now || coupon.valid_until < now) {
    return { valid: false, reason: 'COUPON_EXPIRED', discount: 0 };
  }
  if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) {
    return { valid: false, reason: 'COUPON_EXHAUSTED', discount: 0 };
  }
  if (coupon.applicable_plans !== '*' && !coupon.applicable_plans.split(',').includes(planCode)) {
    return { valid: false, reason: 'COUPON_NOT_APPLICABLE', discount: 0 };
  }
  if (coupon.min_amount > 0 && amount < coupon.min_amount) {
    return { valid: false, reason: 'MIN_AMOUNT_NOT_MET', discount: 0 };
  }

  let discount = 0;
  if (coupon.discount_type === 'fixed') {
    discount = coupon.discount_value;
  } else if (coupon.discount_type === 'percent') {
    discount = Math.floor((amount * coupon.discount_value) / 100);
  }
  return { valid: true, discount: Math.min(discount, amount), coupon };
}

/**
 * payment-create-order — 创建支付订单
 */
async function createOrder(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;
    if (!userId) return res.json({ code: 401, msg: 'AUTH_REQUIRED' });

    const payload = getPayload(req);
    const { plan_code, coupon_code, amount } = payload;
    if (!plan_code) return res.json({ code: 400, msg: 'MISSING_PLAN_CODE' });

    // ★ 安全加固：拒绝负数/零金额
    if (amount !== undefined && amount !== null && amount <= 0) {
      return res.json({ code: 400, msg: 'INVALID_AMOUNT' });
    }

    const plan = getPlanInfo(plan_code);
    if (!plan) return res.json({ code: 400, msg: 'INVALID_PLAN_CODE' });

    // 校验优惠码
    let actualAmount = plan.price;
    let couponDiscount = 0;
    let appliedCouponCode = null;

    if (coupon_code) {
      const result = validateCoupon(adp, coupon_code, plan_code, plan.price);
      if (!result.valid) {
        return res.json({ code: 400, msg: result.reason });
      }
      couponDiscount = result.discount;
      actualAmount = plan.price - couponDiscount;
      appliedCouponCode = coupon_code.toUpperCase();
    }

    // 生成订单
    const orderNo = generateOrderNo();
    const expiredAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2小时后过期

    adp.execRun(
      `INSERT INTO payment_orders 
       (order_no, user_id, plan_code, period, amount, original_amount, coupon_code, coupon_discount, pay_channel, pay_status, expired_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'alipay', 'pending', ?)`,
      [orderNo, userId, plan_code, plan.period, actualAmount, plan.price, appliedCouponCode, couponDiscount, expiredAt],
    );

    const payment = await createPaymentUrl({
      orderNo,
      amount: actualAmount,
      planCode: plan_code,
      planName: plan.name,
      userAgent: req.headers?.['user-agent'] || '',
    });
    adp.execRun(`UPDATE payment_orders SET payment_url = ? WHERE order_no = ?`, [payment.paymentUrl, orderNo]);

    return res.json({
      code: 1,
      data: {
        order_no: orderNo,
        payment_url: payment.paymentUrl,
        pay_mode: payment.mode,
        pay_method: payment.method,
        amount: actualAmount,
        original_amount: plan.price,
        coupon_discount: couponDiscount,
        plan_code,
        plan_name: plan.name,
        expired_at: expiredAt,
      },
    });
  } catch (e) {
    console.error('[orders] 创建订单失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

/**
 * payment-query-order — 查询订单状态
 */
async function queryOrder(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;
    if (!userId) return res.json({ code: 401, msg: 'AUTH_REQUIRED' });

    const payload = getPayload(req);
    const { order_no } = payload;
    if (!order_no) return res.json({ code: 400, msg: 'MISSING_ORDER_NO' });

    const order = adp.execOne(`SELECT * FROM payment_orders WHERE order_no = ? AND user_id = ?`, [order_no, userId]);
    if (!order) return res.json({ code: 404, msg: 'ORDER_NOT_FOUND' });

    return res.json({
      code: 1,
      data: {
        order_no: order.order_no,
        pay_status: order.pay_status,
        amount: order.amount,
        plan_code: order.plan_code,
        transaction_id: order.transaction_id,
        paid_at: order.paid_at,
        expired_at: order.expired_at,
      },
    });
  } catch (e) {
    console.error('[orders] 查询订单失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

module.exports = { createOrder, queryOrder, generateOrderNo, getPlanInfo, validateCoupon };

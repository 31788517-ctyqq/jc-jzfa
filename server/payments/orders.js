/**
 * server/payments/orders.js
 * 支付订单 — payment-create-order / payment-query-order
 */

const crypto = require('crypto');
const database = require('../database');
const { createPaymentUrl, queryAlipayOrder, activatePaidOrder } = require('./alipay');
const { onPaymentSuccess } = require('./referral-compute');

// 后台轮询任务注册表：orderNo → timeoutId
const _pollTimers = new Map();

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
    monthly: { price: 9800, name: '月度套餐', period: 'month' },

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
 * ★ 后台轮询支付宝订单状态（每 10s 轮询，最多 2 分钟）
 * 解决因 notify_url 域名不在白名单导致的回调丢失
 */
function _schedulePoll(orderNo) {
  // 防止重复注册
  if (_pollTimers.has(orderNo)) return;

  let attempts = 0;
  const maxAttempts = 12; // 12 * 10s = 120s（2分钟）
  const intervalMs = 10000; // 10 秒

  const tick = async () => {
    attempts++;
    if (attempts > maxAttempts) {
      _pollTimers.delete(orderNo);
      return;
    }

    try {
      const result = await queryAlipayOrder(orderNo);
      if (!result) {
        // API 调用失败，继续轮询
        if (attempts < maxAttempts) {
          _pollTimers.set(orderNo, setTimeout(tick, intervalMs));
        } else {
          _pollTimers.delete(orderNo);
        }
        return;
      }

      const tradeStatus = result.tradeStatus;
      const tradeNo = result.tradeNo;

      if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
        const adp = database.getAdapter();
        if (!adp) {
          _pollTimers.delete(orderNo);
          return;
        }

        const existing = adp.execOne(`SELECT id FROM payment_orders WHERE transaction_id = ?`, [tradeNo]);
        if (existing) {
          _pollTimers.delete(orderNo);
          return; // 已处理
        }

        const order = adp.execOne(`SELECT * FROM payment_orders WHERE order_no = ?`, [orderNo]);
        if (!order) {
          _pollTimers.delete(orderNo);
          return;
        }

        if (order.pay_status === 'paid') {
          _pollTimers.delete(orderNo);
          return; // 已支付
        }

        const now = result.gmtPayment || new Date().toISOString();
        const result_info = activatePaidOrder(adp, order, tradeNo, now);
        if (result_info && result_info.order_id) {
          console.log(`[orders] 主动轮询确认支付: ${orderNo}, 用户 ${result_info.user_id}`);
          await onPaymentSuccess(result_info.order_id, result_info.user_id || null);
        }
        _pollTimers.delete(orderNo);
        return;
      }

      if (tradeStatus === 'TRADE_CLOSED') {
        const adp = database.getAdapter();
        if (adp) {
          adp.execRun(`UPDATE payment_orders SET pay_status = 'closed' WHERE order_no = ? AND pay_status = 'pending'`, [
            orderNo,
          ]);
        }
        _pollTimers.delete(orderNo);
        return;
      }

      // WAIT_BUYER_PAY — 继续轮询
      if (attempts < maxAttempts) {
        _pollTimers.set(orderNo, setTimeout(tick, intervalMs));
      } else {
        _pollTimers.delete(orderNo);
      }
    } catch (e) {
      console.error(`[orders] 轮询异常 ${orderNo}: ${e.message}`);
      if (attempts < maxAttempts) {
        _pollTimers.set(orderNo, setTimeout(tick, intervalMs));
      } else {
        _pollTimers.delete(orderNo);
      }
    }
  };

  _pollTimers.set(orderNo, setTimeout(tick, 3000)); // 首轮 3s 后开始
}

/**
 * payment-create-order — 创建支付订单
 */
async function createOrder(req, res) {
  const oStart = Date.now();
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;
    if (!userId) return res.json({ code: 401, msg: 'AUTH_REQUIRED' });

    const payload = getPayload(req);
    const plan_code = payload.plan_code || payload.planCode;
    const coupon_code = payload.coupon_code || payload.couponCode;
    const amount = payload.amount;
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
    // ★ 不立即 flush：DB 284MB 全量写盘会阻塞事件循环导致 Nginx 504
    // sql.js 自动保存定时器（几秒内）会自然同步到磁盘

    const payStart = Date.now();
    const payment = await createPaymentUrl({
      orderNo,
      amount: actualAmount,
      planCode: plan_code,
      planName: plan.name,
      userAgent: req.headers?.['user-agent'] || '',
    });
    console.log(`[orders] createPaymentUrl took ${Date.now() - payStart}ms for ${orderNo}`);
    adp.execRun(`UPDATE payment_orders SET payment_url = ? WHERE order_no = ?`, [payment.paymentUrl, orderNo]);

    // ★ 后台轮询：新 AppID 2021006161653361 待验证 alipay.trade.query 是否可用
    // 当前暂不启用轮询，依赖支付宝异步回调（alipay-callback.js V2 已加固业务层兜底校验）
    // 验证通过后取消注释即可启用主动轮询：
    // if (payment.mode !== 'mock') {
    //   _schedulePoll(orderNo);
    // }

    console.log(`[orders] createOrder total ${Date.now() - oStart}ms ${orderNo}`);
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
    if (e && e.message === 'ALIPAY_ISV_PERMISSION_DENIED') {
      return res.json({
        code: 502,
        msg: 'ALIPAY_ISV_PERMISSION_DENIED',
        detail: e.subMsg || 'ISV权限不足，请检查应用签约是否生效',
      });
    }
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
    const order_no = payload.order_no || payload.orderNo;
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

/**
 * payment-query-alipay — 主动查询支付宝支付状态 + 自动激活
 */
async function queryAlipayStatus(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;
    if (!userId) return res.json({ code: 401, msg: 'AUTH_REQUIRED' });

    const payload = getPayload(req);
    const order_no = payload.order_no || payload.orderNo;
    if (!order_no) return res.json({ code: 400, msg: 'MISSING_ORDER_NO' });

    // 先查本地订单
    const order = adp.execOne(`SELECT * FROM payment_orders WHERE order_no = ? AND user_id = ?`, [order_no, userId]);
    if (!order) return res.json({ code: 404, msg: 'ORDER_NOT_FOUND' });

    // 如果已经支付，直接返回
    if (order.pay_status === 'paid') {
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
    }

    // 如果本地 pending，向支付宝查询
    const result = await queryAlipayOrder(order_no);
    if (result && (result.tradeStatus === 'TRADE_SUCCESS' || result.tradeStatus === 'TRADE_FINISHED')) {
      const existing = adp.execOne(`SELECT id FROM payment_orders WHERE transaction_id = ?`, [result.tradeNo]);
      if (!existing) {
        const result_info = activatePaidOrder(
          adp,
          order,
          result.tradeNo,
          result.gmtPayment || new Date().toISOString(),
        );
        if (result_info && result_info.order_id) {
          console.log(`[orders] payment-query-alipay 确认支付: ${order_no}, 用户 ${result_info.user_id}`);
          await onPaymentSuccess(result_info.order_id, result_info.user_id || null);
        }
      }
      // 重新查询本地状态
      const updated = adp.execOne(`SELECT * FROM payment_orders WHERE order_no = ?`, [order_no]);
      return res.json({
        code: 1,
        data: {
          order_no: updated.order_no,
          pay_status: updated.pay_status,
          amount: updated.amount,
          plan_code: updated.plan_code,
          transaction_id: updated.transaction_id,
          paid_at: updated.paid_at,
          expired_at: updated.expired_at,
        },
      });
    }

    if (result && result.tradeStatus === 'TRADE_CLOSED') {
      adp.execRun(`UPDATE payment_orders SET pay_status = 'closed' WHERE order_no = ? AND pay_status = 'pending'`, [
        order_no,
      ]);
      return res.json({
        code: 1,
        data: {
          order_no: order.order_no,
          pay_status: 'closed',
          amount: order.amount,
          plan_code: order.plan_code,
          expired_at: order.expired_at,
        },
      });
    }

    // 仍然 pending
    return res.json({
      code: 1,
      data: {
        order_no: order.order_no,
        pay_status: order.pay_status,
        amount: order.amount,
        plan_code: order.plan_code,
        expired_at: order.expired_at,
      },
    });
  } catch (e) {
    console.error('[orders] 查询支付宝状态失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

module.exports = { createOrder, queryOrder, queryAlipayStatus, generateOrderNo, getPlanInfo, validateCoupon };

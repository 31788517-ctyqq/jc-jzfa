/**
 * server/payments/alipay-callback.js
 * 支付回调处理 — 证书验签 + 幂等 + 激活订阅 + 触发返利计算
 */

const database = require('../database');
const { activatePaidOrder, getAlipayConfig, simulatePayment, verifyNotifySign, yuanToCents } = require('./alipay');
const { onPaymentSuccess } = require('./referral-compute');

function normalizeAlipayTime(value) {
  if (!value) return new Date().toISOString();
  const text = String(value).trim();
  const isoLike = text.includes('T') ? text : text.replace(' ', 'T') + '+08:00';
  const date = new Date(isoLike);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/**
 * 处理模拟支付请求
 * GET /api/payments/simulate-pay?orderNo=xxx&amount=xxx&returnUrl=xxx
 */
async function handleSimulatePay(req, res) {
  try {
    const query = req.query || {};
    const body = req.body || {};
    const orderNo = String(query.orderNo || body.orderNo || body.order_no || '').trim();
    const returnUrl = query.returnUrl || body.returnUrl || body.return_url;
    if (!orderNo) return res.status(400).send('MISSING_ORDER_NO');

    const userId = req.authSession?.userId || null;
    const result = await simulatePayment(orderNo, userId);

    if (result && result.order_id) {
      await onPaymentSuccess(result.order_id, result.user_id || null);
    }

    const redirectUrl = returnUrl || `/preview/index.html#payment-result?orderNo=${orderNo}`;
    res.redirect(302, redirectUrl);
  } catch (e) {
    console.error('[alipay-callback] 模拟支付失败:', e.message);
    const statusCode = e && (e.message === 'MISSING_ORDER_NO' ? 400 : e.message === 'ORDER_NOT_FOUND' ? 404 : 500);
    res.status(statusCode).send(`支付失败: ${e.message}`);
  }
}

function validateNotifyIdentity(params, config) {
  if (!config.enabled) return false;
  if (!verifyNotifySign(params)) return false;
  if (String(params.app_id || '') !== String(config.appId || '')) return false;
  if (String(params.seller_id || '') !== String(config.sellerId || '')) return false;
  return true;
}

/**
 * 处理支付宝异步回调（生产/沙箱）
 * POST /api/payments/notify
 */
async function handleAlipayNotify(req, res) {
  try {
    const params = req.body || {};
    const config = getAlipayConfig();

    if (!validateNotifyIdentity(params, config)) {
      console.warn('[alipay-callback] 通知验签或身份校验失败');
      return res.send('fail');
    }

    const tradeStatus = params.trade_status;
    const outTradeNo = String(params.out_trade_no || '').trim();
    const tradeNo = String(params.trade_no || '').trim();
    if (!outTradeNo || !tradeNo) return res.send('fail');

    const adp = database.getAdapter();
    if (!adp) return res.send('fail');

    const existing = adp.execOne(`SELECT id FROM payment_orders WHERE transaction_id = ?`, [tradeNo]);
    if (existing) return res.send('success');

    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
      if (tradeStatus === 'TRADE_CLOSED') {
        adp.execRun(`UPDATE payment_orders SET pay_status = 'closed' WHERE order_no = ? AND pay_status = 'pending'`, [
          outTradeNo,
        ]);
      }
      return res.send('success');
    }

    const order = adp.execOne(`SELECT * FROM payment_orders WHERE order_no = ?`, [outTradeNo]);
    if (!order) return res.send('fail');

    const notifyAmount = yuanToCents(params.total_amount);
    if (!Number.isFinite(notifyAmount) || notifyAmount !== Number(order.amount)) {
      console.warn(
        `[alipay-callback] 金额不一致: order=${outTradeNo}, notify=${params.total_amount}, expected=${order.amount}`,
      );
      return res.send('fail');
    }

    if (order.pay_status === 'paid') return res.send('success');
    if (order.pay_status !== 'pending') return res.send('success');

    const result = activatePaidOrder(adp, order, tradeNo, normalizeAlipayTime(params.gmt_payment || params.gmt_create));
    if (result && result.order_id) {
      await onPaymentSuccess(result.order_id, result.user_id || null);
    }

    return res.send('success');
  } catch (e) {
    console.error('[alipay-callback] 通知处理失败:', e.message);
    return res.send('fail');
  }
}

module.exports = {
  handleSimulatePay,
  handleAlipayNotify,
  normalizeAlipayTime,
  validateNotifyIdentity,
};

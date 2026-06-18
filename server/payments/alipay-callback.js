/**
 * server/payments/alipay-callback.js
 * 支付回调处理 — 证书验签 + MAPI(MD5)验签 + 幂等 + 激活订阅 + 触发返利计算
 */

const database = require('../database');
const {
  activatePaidOrder,
  getAlipayConfig,
  getMapiConfig,
  simulatePayment,
  verifyNotifySign,
  mapiSign,
  yuanToCents,
} = require('./alipay');
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
    const orderNo = String(query.orderNo || query.order_no || body.orderNo || body.order_no || '').trim();

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
 * ★ V3: 验证 MAPI(MD5) 通知签名
 * MAPI 通知参数名是下划线格式，sign_type=MD5
 */
function validateMapiNotify(params) {
  const mapiConfig = getMapiConfig();
  if (!mapiConfig.enabled || !mapiConfig.md5Key) return false;

  const signType = String(params.sign_type || '').toUpperCase();
  if (signType !== 'MD5') return false;

  // partner 校验（MAPI 用 partner 而非 app_id）
  const partner = String(params.partner || '');
  if (partner !== String(mapiConfig.partner || '')) {
    console.warn(`[alipay-callback] MAPI partner 不匹配: ${partner} vs ${mapiConfig.partner}`);
    return false;
  }

  // MD5 验签
  const expectedSign = mapiSign(params, mapiConfig.md5Key);
  const actualSign = String(params.sign || '').toLowerCase();
  if (expectedSign.toLowerCase() !== actualSign) {
    console.warn(
      `[alipay-callback] MAPI MD5 验签失败: order=${params.out_trade_no}, expected=${expectedSign.slice(0, 10)}..., actual=${actualSign.slice(0, 10)}...`,
    );
    return false;
  }

  return true;
}

/**
 * 处理支付宝异步回调（生产/沙箱）
 * ★ V3: 同时支持旧版 MAPI(MD5) 和 新版 OpenAPI(RSA) 通知
 * POST /api/payments/notify
 */
async function handleAlipayNotify(req, res) {
  try {
    const params = req.body || {};
    const config = getAlipayConfig();
    const mapiConfig = getMapiConfig();
    const signType = String(params.sign_type || '').toUpperCase();

    // ★ V3: 根据 sign_type 选择验证方式
    let identityOk = false;
    if (signType === 'MD5' && mapiConfig.enabled) {
      identityOk = validateMapiNotify(params);
    } else {
      identityOk = validateNotifyIdentity(params, config);
    }

    // MAPI 通知使用 partner 字段，OpenAPI 使用 app_id
    const partnerOrAppId = String(params.partner || params.app_id || '').trim();
    const expectedPartner = mapiConfig.enabled ? mapiConfig.partner : config.appId;

    const outTradeNo = String(params.out_trade_no || '').trim();
    const tradeNo = String(params.trade_no || '').trim();
    const tradeStatus = params.trade_status;

    if (!outTradeNo || !tradeNo) return res.send('fail');

    // ★ 业务层兜底校验
    const partnerMatch = partnerOrAppId === String(expectedPartner || '');
    const hasTradeResult = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED';

    if (!identityOk) {
      if (!partnerMatch) {
        console.warn(`[alipay-callback] partner/app_id 不匹配: ${partnerOrAppId} vs ${expectedPartner}`);
        return res.send('fail');
      }
      if (!hasTradeResult) {
        console.warn('[alipay-callback] 验签失败且非支付成功回调，拒绝');
        return res.send('fail');
      }
      console.warn(`[alipay-callback] 验签失败但身份匹配，进入业务层兜底: ${outTradeNo}`);
    }

    const adp = database.getAdapter();
    if (!adp) return res.send('fail');

    const existing = adp.execOne(`SELECT id FROM payment_orders WHERE transaction_id = ?`, [tradeNo]);
    if (existing) {
      console.log(`[alipay-callback] 交易已处理: tradeNo=${tradeNo}`);
      return res.send('success');
    }

    if (tradeStatus === 'TRADE_CLOSED') {
      adp.execRun(`UPDATE payment_orders SET pay_status = 'closed' WHERE order_no = ? AND pay_status = 'pending'`, [
        outTradeNo,
      ]);
      return res.send('success');
    }

    if (!hasTradeResult) return res.send('success');

    const order = adp.execOne(`SELECT * FROM payment_orders WHERE order_no = ?`, [outTradeNo]);
    if (!order) {
      console.warn(`[alipay-callback] 订单不存在: ${outTradeNo}`);
      return res.send('fail');
    }

    if (order.pay_status === 'paid') return res.send('success');
    if (order.pay_status !== 'pending') return res.send('success');

    // MAPI 使用 total_fee（元），OpenAPI 使用 total_amount（元）
    const notifyAmountYuan = signType === 'MD5' ? params.total_fee : params.total_amount;
    const notifyAmount = yuanToCents(notifyAmountYuan);
    if (!Number.isFinite(notifyAmount) || notifyAmount !== Number(order.amount)) {
      console.warn(
        `[alipay-callback] 金额不一致: order=${outTradeNo}, notify=${notifyAmountYuan}, expected=${order.amount}`,
      );
      return res.send('fail');
    }

    // MAPI 通知使用 notify_time + gmt_create，OpenAPI 使用 gmt_payment + gmt_create
    const paidAt = normalizeAlipayTime(
      signType === 'MD5' ? params.notify_time || params.gmt_create : params.gmt_payment || params.gmt_create,
    );

    const result = activatePaidOrder(adp, order, tradeNo, paidAt);
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
  validateMapiNotify,
};

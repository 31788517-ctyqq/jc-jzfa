/**
 * server/payments/alipay.js
 * 支付宝支付集成层 — 支持证书模式真实支付 + 本地模拟支付兜底
 */

const fs = require('fs');
const database = require('../database');

const SANDBOX_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
const PROD_GATEWAY = 'https://openapi.alipay.com/gateway.do';

let sdkCache = null;
let sdkCacheKey = '';

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function isAlipayEnabled() {
  return truthy(process.env.ALIPAY_ENABLED);
}

function centsToYuan(amount) {
  const cents = Number(amount || 0);
  if (!Number.isFinite(cents) || cents <= 0) throw new Error('INVALID_ALIPAY_AMOUNT');
  return (Math.round(cents) / 100).toFixed(2);
}

function yuanToCents(amount) {
  const yuan = Number(amount || 0);
  if (!Number.isFinite(yuan) || yuan < 0) return NaN;
  return Math.round(yuan * 100);
}

function appendOrderNo(url, orderNo) {
  const base = String(url || '').trim() || 'https://zj.100qiu.com/preview/index.html#payment-result';
  if (!orderNo || base.includes('orderNo=')) return base;
  return base + (base.includes('?') ? '&' : '?') + 'orderNo=' + encodeURIComponent(orderNo);
}

function getAlipayConfig() {
  const sandbox = truthy(process.env.ALIPAY_SANDBOX) || String(process.env.ALIPAY_GATEWAY || '').includes('sandbox');
  const gateway = process.env.ALIPAY_GATEWAY || (sandbox ? SANDBOX_GATEWAY : PROD_GATEWAY);
  const appPrivateKeyPath = process.env.ALIPAY_APP_PRIVATE_KEY_PATH || process.env.ALIPAY_PRIVATE_KEY_PATH || '';
  const appPrivateKey = process.env.ALIPAY_APP_PRIVATE_KEY || process.env.ALIPAY_PRIVATE_KEY || '';

  return {
    enabled: isAlipayEnabled(),
    mode: String(process.env.ALIPAY_MODE || 'cert').toLowerCase(),
    sandbox,
    appId: process.env.ALIPAY_APP_ID || '',
    sellerId: process.env.ALIPAY_SELLER_ID || '',
    gateway,
    signType: process.env.ALIPAY_SIGN_TYPE || 'RSA2',
    notifyUrl: process.env.ALIPAY_NOTIFY_URL || 'https://zj.100qiu.com/api/payments/notify',
    returnUrl: process.env.ALIPAY_RETURN_URL || 'https://zj.100qiu.com/preview/index.html#payment-result',
    appPrivateKeyPath,
    appPrivateKey,
    appCertPath: process.env.ALIPAY_APP_CERT_PATH || '',
    alipayPublicCertPath: process.env.ALIPAY_PUBLIC_CERT_PATH || process.env.ALIPAY_ALIPAY_PUBLIC_CERT_PATH || '',
    alipayRootCertPath: process.env.ALIPAY_ROOT_CERT_PATH || '',
  };
}

function readPrivateKey(config) {
  if (config.appPrivateKey) return config.appPrivateKey.replace(/\\n/g, '\n');
  if (!config.appPrivateKeyPath) throw new Error('ALIPAY_PRIVATE_KEY_MISSING');
  return fs.readFileSync(config.appPrivateKeyPath, 'utf8');
}

function inferKeyType(privateKey) {
  const text = String(privateKey || '').trim();
  if (text.includes('BEGIN RSA PRIVATE KEY')) return 'PKCS1';
  if (text.includes('BEGIN PRIVATE KEY')) return 'PKCS8';
  // 支付宝密钥工具常导出不带 PEM 头尾的 PKCS8 Base64 私钥
  return 'PKCS8';
}

function assertCertConfig(config) {
  const missing = [];
  if (!config.appId) missing.push('ALIPAY_APP_ID');
  if (!config.sellerId) missing.push('ALIPAY_SELLER_ID');
  if (!config.appCertPath) missing.push('ALIPAY_APP_CERT_PATH');
  if (!config.alipayPublicCertPath) missing.push('ALIPAY_PUBLIC_CERT_PATH');
  if (!config.alipayRootCertPath) missing.push('ALIPAY_ROOT_CERT_PATH');
  if (!config.appPrivateKey && !config.appPrivateKeyPath) missing.push('ALIPAY_APP_PRIVATE_KEY_PATH');
  if (missing.length) throw new Error('ALIPAY_CERT_CONFIG_MISSING: ' + missing.join(','));
}

function getAlipaySdk() {
  const config = getAlipayConfig();
  if (!config.enabled) return null;
  if (config.mode !== 'cert') throw new Error('ALIPAY_MODE_MUST_BE_CERT');
  assertCertConfig(config);

  const cacheKey = JSON.stringify({
    appId: config.appId,
    gateway: config.gateway,
    appPrivateKeyPath: config.appPrivateKeyPath,
    appCertPath: config.appCertPath,
    alipayPublicCertPath: config.alipayPublicCertPath,
    alipayRootCertPath: config.alipayRootCertPath,
  });
  if (sdkCache && sdkCacheKey === cacheKey) return sdkCache;

  const alipaySdkModule = require('alipay-sdk');
  const AlipaySdk = alipaySdkModule.AlipaySdk || alipaySdkModule.default || alipaySdkModule;
  const privateKey = readPrivateKey(config);
  sdkCache = new AlipaySdk({
    appId: config.appId,
    privateKey,
    keyType: process.env.ALIPAY_KEY_TYPE || inferKeyType(privateKey),
    signType: config.signType,
    gateway: config.gateway,
    appCertPath: config.appCertPath,
    alipayPublicCertPath: config.alipayPublicCertPath,
    alipayRootCertPath: config.alipayRootCertPath,
  });
  sdkCacheKey = cacheKey;
  return sdkCache;
}

/**
 * 创建模拟支付链接
 * 本地开发用：返回内部模拟支付页面的 URL
 */
function createSimulatedPaymentUrl(orderNo, amount, returnUrl) {
  const target = returnUrl || appendOrderNo(getAlipayConfig().returnUrl, orderNo);
  return `/api/payments/simulate-pay?orderNo=${encodeURIComponent(orderNo)}&amount=${encodeURIComponent(
    amount,
  )}&returnUrl=${encodeURIComponent(target)}`;
}

async function createPaymentUrl({ orderNo, amount, planCode, planName, userAgent }) {
  const config = getAlipayConfig();
  const returnUrl = appendOrderNo(config.returnUrl, orderNo);
  if (!config.enabled) {
    return {
      paymentUrl: createSimulatedPaymentUrl(orderNo, amount, returnUrl),
      method: 'simulate-pay',
      mode: 'mock',
    };
  }

  const sdk = getAlipaySdk();
  const isMobile = /Mobile|Android|iPhone|iPad|iPod|Windows Phone/i.test(String(userAgent || ''));
  const method = isMobile ? 'alipay.trade.wap.pay' : 'alipay.trade.page.pay';
  const productCode = isMobile ? 'QUICK_WAP_WAY' : 'FAST_INSTANT_TRADE_PAY';
  const subject = `JC-ZJFA ${planName || planCode || '会员套餐'}`;

  const pageParams = {
    notifyUrl: config.notifyUrl,
    returnUrl,
    bizContent: {
      outTradeNo: orderNo,
      productCode,
      totalAmount: centsToYuan(amount),
      subject,
      body: `${subject} | 竞彩足球专家推荐趋势监控`,
      timeoutExpress: '2h',
      quitUrl: returnUrl,
    },
  };
  const paymentUrl = sdk.pageExecute
    ? sdk.pageExecute(method, 'GET', pageParams)
    : sdk.pageExec(method, { method: 'GET', ...pageParams });

  return { paymentUrl, method, mode: config.sandbox ? 'alipay_sandbox_cert' : 'alipay_cert' };
}

function verifyNotifySign(params) {
  const sdk = getAlipaySdk();
  if (!sdk) return false;
  return sdk.checkNotifySign(params || {});
}

function activatePaidOrder(adp, order, transactionId, paidAt) {
  if (!adp) throw new Error('DB_UNAVAILABLE');
  if (!order) throw new Error('ORDER_NOT_FOUND');

  if (order.pay_status === 'paid') {
    const planExisting = adp.execOne(`SELECT * FROM subscription_plans WHERE plan_code = ?`, [order.plan_code]);
    return {
      order_id: order.id,
      user_id: order.user_id,
      pay_status: 'paid',
      transaction_id: order.transaction_id || transactionId,
      plan_code: order.plan_code,
      plan_name: planExisting?.plan_name,
      amount: order.amount,
      paid_at: order.paid_at,
      already_paid: true,
    };
  }
  if (order.pay_status !== 'pending') throw new Error('ORDER_ALREADY_PROCESSED');

  if (order.expired_at && new Date(order.expired_at) < new Date()) {
    adp.execRun(`UPDATE payment_orders SET pay_status = 'expired' WHERE id = ?`, [order.id]);
    throw new Error('ORDER_EXPIRED');
  }

  const now = paidAt || new Date().toISOString();
  adp.execRun(`UPDATE payment_orders SET pay_status = 'paid', transaction_id = ?, paid_at = ? WHERE id = ?`, [
    transactionId,
    now,
    order.id,
  ]);

  const plan = adp.execOne(`SELECT * FROM subscription_plans WHERE plan_code = ?`, [order.plan_code]);
  const startDate = new Date(now).toISOString().slice(0, 10);
  const endDate = new Date(now);
  endDate.setMonth(endDate.getMonth() + (plan?.duration_months || 1));

  if (order.coupon_code) {
    adp.execRun(`UPDATE coupons SET used_count = used_count + 1 WHERE code = ?`, [order.coupon_code]);
  }

  adp.execRun(
    `INSERT INTO user_subscriptions 
     (user_id, plan_code, period, status, start_date, end_date, source, transaction_id, amount, original_amount, coupon_code)
     VALUES (?, ?, ?, 'active', ?, ?, 'alipay', ?, ?, ?, ?)`,
    [
      order.user_id,
      order.plan_code,
      plan?.period || order.period || 'month',
      startDate,
      endDate.toISOString().slice(0, 10),
      transactionId,
      order.amount,
      order.original_amount,
      order.coupon_code,
    ],
  );
  const subRow = adp.execOne(`SELECT id FROM user_subscriptions WHERE transaction_id = ? ORDER BY id DESC LIMIT 1`, [
    transactionId,
  ]);

  adp.execRun(
    `UPDATE users SET subscription_status = 'active', 
     subscription_expires_at = ?, current_subscription_id = ? WHERE id = ?`,
    [endDate.toISOString().slice(0, 10), subRow?.id || null, order.user_id],
  );

  return {
    order_id: order.id,
    user_id: order.user_id,
    pay_status: 'paid',
    transaction_id: transactionId,
    plan_code: order.plan_code,
    plan_name: plan?.plan_name,
    amount: order.amount,
    end_date: endDate.toISOString().slice(0, 10),
    paid_at: now,
  };
}

/**
 * 模拟支付处理 — 直接更新订单状态和订阅
 */
async function simulatePayment(orderNo, userId) {
  const adp = database.getAdapter();
  if (!adp) throw new Error('DB_UNAVAILABLE');

  const order = userId
    ? adp.execOne(`SELECT * FROM payment_orders WHERE order_no = ? AND user_id = ?`, [orderNo, userId])
    : adp.execOne(`SELECT * FROM payment_orders WHERE order_no = ?`, [orderNo]);
  const transactionId = `SIM${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const result = activatePaidOrder(adp, order, transactionId, new Date().toISOString());
  console.log(`[alipay] 模拟支付成功: ${orderNo}, 用户 ${result.user_id}, 套餐 ${result.plan_code}`);
  return result;
}

function _resetAlipaySdkCache() {
  sdkCache = null;
  sdkCacheKey = '';
}

module.exports = {
  activatePaidOrder,
  appendOrderNo,
  centsToYuan,
  createPaymentUrl,
  createSimulatedPaymentUrl,
  getAlipayConfig,
  isAlipayEnabled,
  simulatePayment,
  verifyNotifySign,
  yuanToCents,
  _resetAlipaySdkCache,
};

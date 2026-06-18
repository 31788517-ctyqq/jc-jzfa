/**
 * server/payments/alipay.js
 * 支付宝支付集成层 — 支持证书模式 + 旧版 MAPI(MD5) + 本地模拟支付兜底
 */

const fs = require('fs');
const crypto = require('crypto');
const database = require('../database');

const SANDBOX_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
const PROD_GATEWAY = 'https://openapi.alipay.com/gateway.do';
const MAPI_GATEWAY = 'https://mapi.alipay.com/gateway.do'; // 旧版网关（MD5 签名）

let sdkCache = null;
let sdkCacheKey = '';

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function isAlipayEnabled() {
  return truthy(process.env.ALIPAY_ENABLED);
}

function isMapiMode() {
  return String(process.env.ALIPAY_GATEWAY_MODE || '').toLowerCase() === 'mapi';
}

function getMapiConfig() {
  return {
    enabled: isAlipayEnabled() && isMapiMode(),
    gateway: process.env.ALIPAY_MAPI_GATEWAY || MAPI_GATEWAY,
    partner: process.env.ALIPAY_APP_ID || '',
    sellerEmail: process.env.ALIPAY_SELLER_EMAIL || 'quncai888@163.com',
    md5Key: process.env.ALIPAY_MD5_KEY || '',
    signType: 'MD5',
    notifyUrl: process.env.ALIPAY_NOTIFY_URL || 'https://zj.100qiu.com/api/payments/notify',
    returnUrl: process.env.ALIPAY_RETURN_URL || 'https://zj.100qiu.com/preview/index.html#payment-result',
    inputCharset: 'utf-8',
    paymentType: '1',
  };
}

/**
 * MD5 签名（旧版 MAPI 协议）
 * 1. 所有参数按 key 字母排序
 * 2. 拼接为 key1=value1&key2=value2...
 * 3. 追加 MD5 key
 * 4. MD5 哈希
 */
function mapiSign(params, md5Key) {
  const signStr = Object.keys(params)
    .sort()
    .filter(function (k) {
      return k !== 'sign' && k !== 'sign_type';
    })
    .map(function (k) {
      return k + '=' + params[k];
    })
    .join('&');
  return crypto
    .createHash('md5')
    .update(signStr + md5Key, 'utf8')
    .digest('hex');
}

/**
 * 生成旧版 MAPI 支付 URL（群彩 WAP 支付通道）
 * 使用 alipay.wap.create.direct.pay.by.user（WAP 支付）
 * 或 create_direct_pay_by_user（PC 即时到账）
 */
function createMapiPaymentUrl({ orderNo, amount, planName, planCode, userAgent }) {
  const config = getMapiConfig();
  if (!config.enabled) return null;

  const isMobile = /Mobile|Android|iPhone|iPad|iPod|Windows Phone/i.test(String(userAgent || ''));
  const service = isMobile ? 'alipay.wap.create.direct.pay.by.user' : 'create_direct_pay_by_user';
  const subject = `JC-ZJFA ${planName || planCode || '会员套餐'}`;
  const returnUrl = appendOrderNo(config.returnUrl, orderNo);

  const params = {
    service: service,
    partner: config.partner,
    _input_charset: config.inputCharset,
    sign_type: config.signType,
    notify_url: config.notifyUrl,
    return_url: returnUrl,
    out_trade_no: orderNo,
    subject: subject,
    total_fee: centsToYuan(amount),
    seller_email: config.sellerEmail,
    payment_type: config.paymentType,
    body: subject + ' | 竞彩足球专家推荐趋势监控',
  };

  const sign = mapiSign(params, config.md5Key);
  params.sign = sign;

  const query = Object.keys(params)
    .map(function (k) {
      return k + '=' + encodeURIComponent(params[k]);
    })
    .join('&');

  return {
    paymentUrl: config.gateway + '?' + query,
    method: service,
    mode: 'alipay_mapi_md5',
  };
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

const MAX_SUBSCRIPTION_MONTHS = 36;

function appendOrderNo(url, orderNo) {
  const base = String(url || '').trim() || 'https://zj.100qiu.com/preview/index.html#payment-result';
  if (!orderNo || base.includes('orderNo=')) return base;
  return base + (base.includes('?') ? '&' : '?') + 'orderNo=' + encodeURIComponent(orderNo);
}

function clampEndDateByMaxMonths(baseDate, targetDate, maxMonths) {
  const base = new Date(baseDate);
  const target = new Date(targetDate);
  if (Number.isNaN(base.getTime()) || Number.isNaN(target.getTime())) return targetDate;
  const cap = new Date(base);
  cap.setMonth(cap.getMonth() + Number(maxMonths || MAX_SUBSCRIPTION_MONTHS));
  return target.getTime() > cap.getTime() ? cap : target;
}

function getAlipayConfig() {
  const sandbox = truthy(process.env.ALIPAY_SANDBOX) || String(process.env.ALIPAY_GATEWAY || '').includes('sandbox');
  const gateway = process.env.ALIPAY_GATEWAY || (sandbox ? SANDBOX_GATEWAY : PROD_GATEWAY);
  const appPrivateKeyPath = process.env.ALIPAY_APP_PRIVATE_KEY_PATH || process.env.ALIPAY_PRIVATE_KEY_PATH || '';
  const appPrivateKey = process.env.ALIPAY_APP_PRIVATE_KEY || process.env.ALIPAY_PRIVATE_KEY || '';
  const mode = String(process.env.ALIPAY_MODE || 'cert').toLowerCase();

  return {
    enabled: isAlipayEnabled(),
    mode,
    sandbox,
    appId: process.env.ALIPAY_APP_ID || '',
    sellerId: process.env.ALIPAY_SELLER_ID || '',
    gateway,
    signType: process.env.ALIPAY_SIGN_TYPE || 'RSA2',
    notifyUrl: process.env.ALIPAY_NOTIFY_URL || 'https://zj.100qiu.com/api/payments/notify',
    returnUrl: process.env.ALIPAY_RETURN_URL || 'https://zj.100qiu.com/preview/index.html#payment-result',
    appPrivateKeyPath,
    appPrivateKey,
    // cert 模式专用
    appCertPath: process.env.ALIPAY_APP_CERT_PATH || '',
    alipayPublicCertPath: process.env.ALIPAY_PUBLIC_CERT_PATH || process.env.ALIPAY_ALIPAY_PUBLIC_CERT_PATH || '',
    alipayRootCertPath: process.env.ALIPAY_ROOT_CERT_PATH || '',
    // key 模式专用（RSA 密钥字符串，无证书文件）
    alipayPublicKey: process.env.ALIPAY_ALIPAY_PUBLIC_KEY || '',
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

function assertKeyConfig(config) {
  const missing = [];
  if (!config.appId) missing.push('ALIPAY_APP_ID');
  if (!config.sellerId) missing.push('ALIPAY_SELLER_ID');
  if (!config.appPrivateKey && !config.appPrivateKeyPath) missing.push('ALIPAY_APP_PRIVATE_KEY_PATH');
  if (!config.alipayPublicKey) missing.push('ALIPAY_ALIPAY_PUBLIC_KEY');
  if (missing.length) throw new Error('ALIPAY_KEY_CONFIG_MISSING: ' + missing.join(','));
}

function getAlipaySdk() {
  const config = getAlipayConfig();
  if (!config.enabled) return null;

  if (config.mode === 'cert') {
    assertCertConfig(config);
  } else if (config.mode === 'key') {
    assertKeyConfig(config);
  } else {
    throw new Error('ALIPAY_MODE_MUST_BE_CERT_OR_KEY');
  }

  const cacheKey = JSON.stringify({
    mode: config.mode,
    appId: config.appId,
    gateway: config.gateway,
    appPrivateKeyPath: config.appPrivateKeyPath,
    appPrivateKey: config.appPrivateKey ? '[inline]' : undefined,
    appCertPath: config.appCertPath,
    alipayPublicCertPath: config.alipayPublicCertPath,
    alipayRootCertPath: config.alipayRootCertPath,
    alipayPublicKey: config.alipayPublicKey ? '[inline]' : undefined,
  });
  if (sdkCache && sdkCacheKey === cacheKey) return sdkCache;

  const alipaySdkModule = require('alipay-sdk');
  const AlipaySdk = alipaySdkModule.AlipaySdk || alipaySdkModule.default || alipaySdkModule;
  const privateKey = readPrivateKey(config);

  const sdkOptions = {
    appId: config.appId,
    privateKey,
    keyType: process.env.ALIPAY_KEY_TYPE || inferKeyType(privateKey),
    signType: config.signType,
    gateway: config.gateway,
  };

  if (config.mode === 'cert') {
    Object.assign(sdkOptions, {
      appCertPath: config.appCertPath,
      alipayPublicCertPath: config.alipayPublicCertPath,
      alipayRootCertPath: config.alipayRootCertPath,
    });
  } else {
    // key 模式：直接传支付宝公钥字符串
    sdkOptions.alipayPublicKey = config.alipayPublicKey.replace(/\\n/g, '\n');
  }

  sdkCache = new AlipaySdk(sdkOptions);
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
  const t0 = Date.now();
  const config = getAlipayConfig();
  const returnUrl = appendOrderNo(config.returnUrl, orderNo);

  // ★ V3: 优先尝试旧版 MAPI MD5 支付（群彩通道）
  if (isMapiMode()) {
    const mapiResult = createMapiPaymentUrl({ orderNo, amount, planName, planCode, userAgent });
    if (mapiResult) return mapiResult;
  }

  if (!config.enabled) {
    return {
      paymentUrl: createSimulatedPaymentUrl(orderNo, amount, returnUrl),
      method: 'simulate-pay',
      mode: 'mock',
    };
  }

  const t1 = Date.now();
  const sdk = getAlipaySdk();
  const t2 = Date.now();

  // H5 支付签约优先：默认走 alipay.trade.wap.pay
  // 可通过 ALIPAY_OPENAPI_METHOD 强制指定（如 alipay.trade.page.pay）
  const methodByEnv = String(process.env.ALIPAY_OPENAPI_METHOD || '').trim();
  const isMobile = /Mobile|Android|iPhone|iPad|iPod|Windows Phone/i.test(String(userAgent || ''));
  const method = methodByEnv || (isMobile ? 'alipay.trade.wap.pay' : 'alipay.trade.wap.pay');
  const subject = `JC-ZJFA ${planName || planCode || '会员套餐'}`;

  const bizContent = {
    outTradeNo: orderNo,
    totalAmount: centsToYuan(amount),
    subject,
    body: `${subject} | 竞彩足球专家推荐趋势监控`,
    productCode: method === 'alipay.trade.wap.pay' ? 'QUICK_WAP_WAY' : 'FAST_INSTANT_TRADE_PAY',
  };

  console.log(`[alipay] bizContent: ${JSON.stringify(bizContent)}`);

  const pageParams = {
    notifyUrl: config.notifyUrl,
    returnUrl,
    bizContent,
  };
  try {
    const paymentUrl = sdk.pageExecute
      ? sdk.pageExecute(method, 'GET', pageParams)
      : sdk.pageExec(method, { method: 'GET', ...pageParams });
    const t3 = Date.now();

    console.log(
      `[alipay] createPaymentUrl timing: sdk_init=${t2 - t1}ms page_sign=${t3 - t2}ms total=${t3 - t0}ms order=${orderNo}`,
    );

    return { paymentUrl, method, mode: config.sandbox ? 'alipay_sandbox_cert' : 'alipay_cert' };
  } catch (e) {
    const serverResult = e && e.serverResult ? e.serverResult : {};
    const subCode = String(serverResult.sub_code || serverResult.subCode || '').toLowerCase();
    const subMsg = String(serverResult.sub_msg || serverResult.subMsg || '');
    const rawMsg = String(e && e.message ? e.message : 'ALIPAY_CREATE_URL_FAILED');

    console.error(
      `[alipay] createPaymentUrl failed: order=${orderNo}, msg=${rawMsg}, sub_code=${subCode}, sub_msg=${subMsg}`,
    );

    if (subCode === 'insufficient-isv-permissions') {
      const err = new Error('ALIPAY_ISV_PERMISSION_DENIED');
      err.subCode = subCode;
      err.subMsg = subMsg;
      throw err;
    }

    throw e;
  }
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
  const clampedEndDate = clampEndDateByMaxMonths(now, endDate, MAX_SUBSCRIPTION_MONTHS);

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
      clampedEndDate.toISOString().slice(0, 10),

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
    [clampedEndDate.toISOString().slice(0, 10), subRow?.id || null, order.user_id],
  );

  return {
    order_id: order.id,
    user_id: order.user_id,
    pay_status: 'paid',
    transaction_id: transactionId,
    plan_code: order.plan_code,
    plan_name: plan?.plan_name,
    amount: order.amount,
    end_date: clampedEndDate.toISOString().slice(0, 10),

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

  // ★ 查不到时 reload 重试一次（不每次 reload，DB 284MB 全量加载太慢）
  if (!order && typeof adp.reload === 'function') {
    adp.reload();
    const order2 = userId
      ? adp.execOne(`SELECT * FROM payment_orders WHERE order_no = ? AND user_id = ?`, [orderNo, userId])
      : adp.execOne(`SELECT * FROM payment_orders WHERE order_no = ?`, [orderNo]);
    if (!order2) throw new Error('ORDER_NOT_FOUND');
    const transactionId = `SIM${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const result = activatePaidOrder(adp, order2, transactionId, new Date().toISOString());
    console.log(`[alipay] 模拟支付成功(reload): ${orderNo}, 用户 ${result.user_id}, 套餐 ${result.plan_code}`);
    return result;
  }

  const transactionId = `SIM${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const result = activatePaidOrder(adp, order, transactionId, new Date().toISOString());
  console.log(`[alipay] 模拟支付成功: ${orderNo}, 用户 ${result.user_id}, 套餐 ${result.plan_code}`);
  return result;
}

/**
 * 主动查询支付宝订单状态（alipay.trade.query）
 * 用于绕过回调域名限制，被动确认支付结果
 * @param {string} outTradeNo - 商户订单号
 * @returns {{ tradeStatus: string, tradeNo: string, totalAmount: string, buyerLogonId?: string }|null}
 */
async function queryAlipayOrder(outTradeNo) {
  const config = getAlipayConfig();
  if (!config.enabled) return null;

  const sdk = getAlipaySdk();
  if (!sdk) return null;

  try {
    let result;
    try {
      result = await sdk.exec('alipay.trade.query', {
        bizContent: {
          out_trade_no: outTradeNo,
        },
      });
    } catch (execErr) {
      // SDK rejected — 打印完整错误
      console.error(
        `[alipay] 查询 ${outTradeNo} SDK异常: ${execErr.message}, serverResult: ${JSON.stringify(execErr.serverResult || {}).slice(0, 500)}`,
      );
      return null;
    }

    if (!result || result.code !== '10000') {
      console.warn(
        `[alipay] 查询订单 ${outTradeNo} 失败: code=${result?.code}, sub_code=${result?.subCode || result?.sub_code}, msg=${result?.msg}, sub_msg=${result?.subMsg || result?.sub_msg}`,
      );
      return null;
    }

    return {
      tradeStatus: result.trade_status,
      tradeNo: result.trade_no || '',
      totalAmount: result.total_amount || '',
      buyerLogonId: result.buyer_logon_id || '',
      buyerUserId: result.buyer_user_id || '',
      gmtPayment: result.gmt_payment || result.send_pay_date || '',
    };
  } catch (e) {
    console.error(`[alipay] 查询订单 ${outTradeNo} 异常: ${e.message}`);
    return null;
  }
}

function _resetAlipaySdkCache() {
  sdkCache = null;
  sdkCacheKey = '';
}

module.exports = {
  activatePaidOrder,
  appendOrderNo,
  assertCertConfig,
  assertKeyConfig,
  centsToYuan,
  createMapiPaymentUrl,
  createPaymentUrl,
  createSimulatedPaymentUrl,
  getAlipayConfig,
  getMapiConfig,
  isAlipayEnabled,
  isMapiMode,
  mapiSign,
  queryAlipayOrder,
  simulatePayment,
  verifyNotifySign,
  yuanToCents,
  _resetAlipaySdkCache,
};

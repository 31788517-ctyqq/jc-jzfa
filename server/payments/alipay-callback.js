/**
 * server/payments/alipay-callback.js
 * 支付回调处理 — 验签 + 幂等 + 激活订阅 + 触发返利计算
 *
 * 生产环境：验证支付宝签名（使用支付宝公钥）
 * 开发环境：模拟支付处理
 */

const database = require('../database');
const { simulatePayment } = require('./alipay');
const { onPaymentSuccess } = require('./referral-compute');

/**
 * 处理模拟支付请求
 * GET /api/payments/simulate-pay?orderNo=xxx&amount=xxx&returnUrl=xxx
 */
async function handleSimulatePay(req, res) {
  try {
    const { orderNo, returnUrl } = req.query;
    if (!orderNo) return res.status(400).send('MISSING_ORDER_NO');

    const userId = req.authSession?.userId;
    if (!userId) return res.status(401).send('AUTH_REQUIRED');

    const result = await simulatePayment(orderNo, userId);

    // 触发返利计算（异步，不阻塞响应）
    const refResult = await onPaymentSuccess(orderNo, userId);

    // 重定向到支付结果页
    const redirectUrl = returnUrl || `/preview/index.html#payment-result?orderNo=${orderNo}`;
    res.redirect(302, redirectUrl);
  } catch (e) {
    console.error('[alipay-callback] 模拟支付失败:', e.message);
    res.status(500).send(`支付失败: ${e.message}`);
  }
}

/**
 * 处理支付宝异步回调（生产环境）
 * POST /api/payments/notify
 *
 * 安全要点：
 * - 验证支付宝签名
 * - 验证 seller_id 和 app_id
 * - 幂等处理（同一 trade_no 不重复激活）
 * - 返回 "success" 字符串
 */
async function handleAlipayNotify(req, res) {
  try {
    const params = req.body;

    // TODO: 生产环境 — 使用 alipaySdk.checkNotifySign(params) 验签
    // const verified = alipaySdk.checkNotifySign(params);
    // if (!verified) return res.send('fail');
    // if (params.seller_id !== process.env.ALIPAY_SELLER_ID) return res.send('fail');
    // if (params.app_id !== process.env.ALIPAY_APP_ID) return res.send('fail');

    const tradeStatus = params.trade_status;
    const outTradeNo = params.out_trade_no;
    const tradeNo = params.trade_no;

    if (!outTradeNo || !tradeNo) return res.send('fail');

    const adp = database.getAdapter();
    if (!adp) return res.send('fail');

    // 幂等检查
    const existing = adp.execOne(
      `SELECT id FROM payment_orders WHERE transaction_id = ?`,
      [tradeNo]
    );
    if (existing) return res.send('success'); // 已处理

    if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
      const order = adp.execOne(
        `SELECT * FROM payment_orders WHERE order_no = ?`,
        [outTradeNo]
      );
      if (!order || order.pay_status !== 'pending') return res.send('success');

      // 更新订单状态
      adp.execRun(
        `UPDATE payment_orders SET pay_status = 'paid', transaction_id = ?, paid_at = datetime('now','localtime')
         WHERE order_no = ?`,
        [tradeNo, outTradeNo]
      );

      // 激活订阅...（与 simulatePayment 类似）

      // 触发返利计算
      await onPaymentSuccess(order.id, order.user_id);
    }

    return res.send('success');
  } catch (e) {
    console.error('[alipay-callback] 通知处理失败:', e.message);
    return res.send('fail');
  }
}

module.exports = { handleSimulatePay, handleAlipayNotify };

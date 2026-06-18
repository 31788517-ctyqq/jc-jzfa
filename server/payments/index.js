/**
 * server/payments/index.js
 * 支付体系模块入口 — 挂载 action 路由
 *
 * 提供所有 Phase 4 API action：
 *   套餐: plan-catalog
 *   订单: payment-create-order, payment-query-order
 *   订阅: subscription-status, subscription-renew,
 *         subscription-cancel-auto-renew, subscription-enable-auto-renew
 *   管理员: admin-subscription-list, admin-grant-subscription
 *   返利: referral-info, referral-account, referral-commissions,
 *         referral-withdraw-submit, referral-withdraw-history
 *   管理员返利: admin-referral-commissions, admin-referral-accounts,
 *              admin-referral-withdraw-list, admin-referral-withdraw-process
 */

const database = require('../database');
const { initPaymentSchema } = require('./schema');
const { planCatalog } = require('./plans');
const { createOrder, queryOrder, queryAlipayStatus } = require('./orders');
const {
  subscriptionStatus,
  subscriptionRenew,
  cancelAutoRenew,
  enableAutoRenew,
  adminSubscriptionList,
  adminGrantSubscription,
  vipGiftClaim,
  vipGiftStatus,
} = require('./subscriptions');
const { handleSimulatePay, handleAlipayNotify } = require('./alipay-callback');
const {
  referralInfo,
  referralAccount,
  referralCommissions,
  withdrawSubmit,
  withdrawHistory,
  adminReferralCommissions,
  adminReferralAccounts,
  adminWithdrawList,
  adminWithdrawProcess,
} = require('./referral-account');

// 认证要求映射（需要订阅的动作）
const SUBSCRIPTION_REQUIRED = [];

// 管理员动作
const ADMIN_ACTIONS = [
  'admin-subscription-list',
  'admin-grant-subscription',
  'admin-referral-commissions',
  'admin-referral-accounts',
  'admin-referral-withdraw-list',
  'admin-referral-withdraw-process',
];

/**
 * 初始化支付模块
 * 在 server/index.js 启动时调用
 */
function initPayments() {
  try {
    const adp = database.getAdapter();
    if (adp) {
      initPaymentSchema(adp);
      console.log('[payments] 模块初始化完成');
    } else {
      console.warn('[payments] 数据库适配器不可用，跳过初始化');
    }

    // 预热支付宝证书配置（首次支付前验证密钥+证书可达）
    try {
      const { assertCertConfig } = require('./alipay');
      const t0 = Date.now();
      assertCertConfig();
      console.log(`[payments] 支付宝证书预热完成 (${Date.now() - t0}ms)`);
    } catch (e) {
      console.warn('[payments] 支付宝预热跳过: ' + e.message);
    }
  } catch (e) {
    console.error('[payments] 初始化失败:', e.message);
  }
}

/**
 * 处理支付相关 action
 * @param {string} action - API action 名称
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 * @returns {boolean} 是否已处理（true=已处理，false=未匹配）
 */
async function handleAction(action, req, res) {
  // 管理员权限检查（roles 为数组，如 ['super_admin', 'ops_admin']）
  if (ADMIN_ACTIONS.includes(action)) {
    const roles = req.authSession?.roles || [];
    const isAdmin = Array.isArray(roles) && (roles.includes('super_admin') || roles.includes('ops_admin'));
    if (!isAdmin) {
      return res.json({ code: 403, msg: 'ADMIN_REQUIRED' });
    }
  }

  switch (action) {
    // ===== 套餐 =====
    case 'plan-catalog':
      return planCatalog(req, res);

    // ===== 订单 =====
    case 'payment-create-order':
      return createOrder(req, res);
    case 'payment-query-order':
      return queryOrder(req, res);
    case 'payment-query-alipay':
      return queryAlipayStatus(req, res);

    // ===== 订阅 =====
    case 'subscription-status':
      return subscriptionStatus(req, res);
    case 'subscription-renew':
      return subscriptionRenew(req, res);
    case 'subscription-cancel-auto-renew':
      return cancelAutoRenew(req, res);
    case 'subscription-enable-auto-renew':
      return enableAutoRenew(req, res);
    case 'vip-gift-claim':
      return vipGiftClaim(req, res);
    case 'vip-gift-status':
      return vipGiftStatus(req, res);

    // ===== 管理员订阅 =====
    case 'admin-subscription-list':
      return adminSubscriptionList(req, res);
    case 'admin-grant-subscription':
      return adminGrantSubscription(req, res);

    // ===== 返利 =====
    case 'referral-info':
      return referralInfo(req, res);
    case 'referral-account':
      return referralAccount(req, res);
    case 'referral-commissions':
      return referralCommissions(req, res);
    case 'referral-withdraw-submit':
      return withdrawSubmit(req, res);
    case 'referral-withdraw-history':
      return withdrawHistory(req, res);

    // ===== 支付回调（模拟） =====
    case 'simulate-pay':
      return handleSimulatePay(req, res);

    // ===== 管理员返利 =====
    case 'admin-referral-commissions':
      return adminReferralCommissions(req, res);
    case 'admin-referral-accounts':
      return adminReferralAccounts(req, res);
    case 'admin-referral-withdraw-list':
      return adminWithdrawList(req, res);
    case 'admin-referral-withdraw-process':
      return adminWithdrawProcess(req, res);

    // ===== 管理员更新套餐价格 =====
    case 'admin-update-plan-price':
      return (async () => {
        try {
          const adp = database.getAdapter();
          const body = req.body?.data || req.body || {};
          const { plan_code, price, monthly_equivalent } = body;
          if (!plan_code || price == null) return res.json({ code: 400, msg: 'MISSING_PARAMS' });
          adp.execRun('UPDATE subscription_plans SET price=?, monthly_equivalent=? WHERE plan_code=?', [
            Number(price),
            monthly_equivalent != null ? Number(monthly_equivalent) : Number(price),
            plan_code,
          ]);
          const updated = adp.execOne('SELECT * FROM subscription_plans WHERE plan_code=?', [plan_code]);
          return res.json({ code: 1, data: updated });
        } catch (e) {
          return res.json({ code: 500, msg: e.message });
        }
      })();

    default:
      return false; // 未匹配
  }
}

module.exports = {
  initPayments,
  handleAction,
  handleSimulatePay,
  handleAlipayNotify,
};

import { api } from '../api.js';
import { getAuthSession, hasAuthToken } from '../auth-client.js';

const PLAN_META = {
  monthly: { plan_name: '月度套餐', duration_months: 1, feature: '适合短期体验核心能力', summary: '30 天会员访问权限' },
  quarterly: {
    plan_name: '季度套餐',
    duration_months: 3,
    feature: '适合持续跟单和阶段性复盘',
    summary: '90 天稳定使用周期',
  },
  yearly: {
    plan_name: '年度套餐',
    duration_months: 12,
    feature: '适合长期订阅与全年回测',
    summary: '365 天完整会员体验',
  },
};

const PAYMENT_TIPS = [
  '当前通过支付宝RSA密钥模式接入生产环境，支付后系统自动验签激活会员。',
  '优惠码会在创建订单时自动验证，若无效会给出明确提示。',
  '开通成功以支付宝异步通知验签结果为准，成功后可前往订阅中心查看状态。',
];

function formatMoney(value) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0,
  }).format((Number(value) || 0) / 100);
}

function readStoredPlan() {
  try {
    var raw = sessionStorage.getItem('pendingSelectedPlan') || '';
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeStoredPlan(plan) {
  try {
    sessionStorage.setItem('pendingSelectedPlan', JSON.stringify(plan || {}));
  } catch (e) {}
}

function clearStoredPlan() {
  try {
    sessionStorage.removeItem('pendingSelectedPlan');
  } catch (e) {}
}

function normalizePlan(data) {
  var incoming = data && data.plan_code ? data : readStoredPlan() || {};
  var code = incoming.plan_code || 'yearly';
  var meta = PLAN_META[code] || PLAN_META.yearly;
  return {
    plan_code: code,
    plan_name: incoming.plan_name || meta.plan_name,
    price: Number(incoming.price || 0) || { monthly: 98, quarterly: 25800, yearly: 88800 }[code] || 88800,
    duration_months: Number(incoming.duration_months || meta.duration_months || 12),
    feature: incoming.feature || meta.feature,
    summary: incoming.summary || meta.summary,
  };
}

function formatPaymentError(message) {
  var map = {
    AUTH_REQUIRED: '请先登录后再完成支付。',
    MISSING_PLAN_CODE: '未识别到套餐信息，请返回重新选择。',
    INVALID_PLAN_CODE: '套餐信息已失效，请重新选择。',
    COUPON_NOT_FOUND: '优惠码不存在，请检查后重试。',
    COUPON_EXPIRED: '优惠码已过期，请更换后重试。',
    COUPON_EXHAUSTED: '优惠码已用完，请更换后重试。',
    COUPON_NOT_APPLICABLE: '该优惠码不适用于当前套餐。',
    MIN_AMOUNT_NOT_MET: '未满足优惠码使用门槛。',
  };
  return map[message] || message || '下单失败，请稍后重试';
}

function renderGuestState(container, plan) {
  container.innerHTML =
    '' +
    '<div class="member-shell member-shell-payment">' +
    '<div class="member-page payment-container">' +
    '<div class="member-hero">' +
    '<div class="member-top-badge">支付前登录</div>' +
    '<div class="member-hero-title">请先登录或完成注册</div>' +
    '<div class="member-hero-subtitle">你选择的是 <strong>' +
    plan.plan_name +
    '</strong>，登录后将继续当前支付流程。</div>' +
    '</div>' +
    '<div class="member-section-card member-empty-card">' +
    '<div class="member-empty-title">当前套餐</div>' +
    '<div class="member-empty-text">' +
    plan.summary +
    ' · ' +
    formatMoney(plan.price) +
    '</div>' +
    '<div class="member-cta-row">' +
    '<button class="member-secondary-btn" type="button" onclick="switchTab(\'login\')">已有账号，去登录</button>' +
    '<button class="member-primary-btn" type="button" onclick="switchTab(\'register\')">邀请码注册</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>';
}

export async function loadPayment(container, data) {
  var plan = normalizePlan(data);
  writeStoredPlan(plan);

  if (!hasAuthToken() || !getAuthSession()) {
    renderGuestState(container, plan);
    return;
  }

  var html =
    '' +
    '<div class="member-shell member-shell-payment">' +
    '<div class="member-page payment-container">' +
    '<div class="member-hero">' +
    '<div class="member-top-badge">确认支付</div>' +
    '<div class="member-hero-title">即将开通 ' +
    plan.plan_name +
    '</div>' +
    '<div class="member-hero-subtitle">确认订单信息后即可跳转支付，完成后系统会自动为你激活会员权限。</div>' +
    '</div>' +
    '<div class="member-section-card payment-card">' +
    '<div class="member-section-title">订单摘要</div>' +
    '<div class="payment-plan-row"><span class="payment-plan-label">套餐</span><span class="payment-plan-value">' +
    plan.plan_name +
    '</span></div>' +
    '<div class="payment-plan-row"><span class="payment-plan-label">周期</span><span class="payment-plan-value">' +
    plan.duration_months +
    ' 个月</span></div>' +
    '<div class="payment-plan-row"><span class="payment-plan-label">能力说明</span><span class="payment-plan-value">' +
    plan.feature +
    '</span></div>' +
    '<div class="payment-plan-row"><span class="payment-plan-label">应付金额</span><span class="payment-plan-value payment-price">' +
    formatMoney(plan.price) +
    '</span></div>' +
    '<div class="payment-plan-row"><span class="payment-plan-label">支付方式</span><span class="payment-plan-value">支付宝</span></div>' +
    '</div>' +
    '<div class="member-section-card payment-coupon-card">' +
    '<div class="member-section-title">优惠码</div>' +
    '<div class="payment-coupon">' +
    '<input type="text" id="couponInput" placeholder="输入优惠码（选填）" maxlength="20" />' +
    '<button id="couponApplyBtn" type="button" onclick="applyCoupon()">应用</button>' +
    '</div>' +
    '<div id="couponMsg" class="payment-coupon-msg"></div>' +
    '</div>' +
    '<div class="member-section-card payment-tip-card">' +
    '<div class="member-section-title">支付说明</div>' +
    '<div class="member-note-list">' +
    PAYMENT_TIPS.map(function (item) {
      return '<div class="member-note-item"><span class="member-note-icon">·</span><span>' + item + '</span></div>';
    }).join('') +
    '</div>' +
    '</div>' +
    '<div class="payment-actions">' +
    '<button class="payment-submit-btn" id="payBtn" type="button" onclick="submitPayment(\'' +
    plan.plan_code +
    "'," +
    Number(plan.price || 0) +
    ')">确认支付 ' +
    formatMoney(plan.price) +
    '</button>' +
    '<button class="payment-cancel-btn" type="button" onclick="window.navigateTo(\'pricing\')">返回重选套餐</button>' +
    '</div>' +
    '<div id="paymentStatus" class="payment-status-box" style="display:none"><div class="loading-spinner"></div><p id="paymentStatusText">正在生成订单...</p></div>' +
    '</div>' +
    '</div>';

  container.innerHTML = html;
}

window.submitPayment = async function (planCode, price) {
  var couponCode =
    document.getElementById('couponInput') && document.getElementById('couponInput').value
      ? document.getElementById('couponInput').value.trim()
      : '';
  var payBtn = document.getElementById('payBtn');
  var statusEl = document.getElementById('paymentStatus');
  var statusTextEl = document.getElementById('paymentStatusText');
  var msgEl = document.getElementById('couponMsg');

  if (payBtn) payBtn.disabled = true;
  if (statusEl) statusEl.style.display = 'flex';
  if (statusTextEl) statusTextEl.textContent = '正在生成订单...';
  if (msgEl) msgEl.textContent = '';

  try {
    var body = { plan_code: planCode };
    if (couponCode) body.coupon_code = couponCode;

    var order = await api('payment-create-order', body, 0);
    if (!order || !order.order_no) {
      throw new Error('创建订单失败，请稍后重试');
    }

    clearStoredPlan();
    try {
      sessionStorage.removeItem('pendingAfterLogin');
    } catch (e) {}
    if (statusTextEl) statusTextEl.textContent = '订单已生成，正在跳转支付...';

    var fallbackUrl =
      '/api/payments/simulate-pay?orderNo=' +
      order.order_no +
      '&amount=' +
      (order.amount || price) +
      '&returnUrl=' +
      encodeURIComponent(location.origin + '/preview/index.html#payment-result?orderNo=' + order.order_no);
    window.location.href = order.payment_url || fallbackUrl;
  } catch (e) {
    if (msgEl) msgEl.textContent = formatPaymentError(e && e.message);
    if (statusEl) statusEl.style.display = 'none';
    if (payBtn) payBtn.disabled = false;
  }
};

window.applyCoupon = function () {
  var codeEl = document.getElementById('couponInput');
  var msgEl = document.getElementById('couponMsg');
  var code = codeEl && codeEl.value ? codeEl.value.trim() : '';
  if (!msgEl) return;
  msgEl.textContent = code ? '优惠码会在创建订单时自动验证并计算优惠金额。' : '';
};

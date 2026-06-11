// ==================== 支付确认页 ====================
import { api } from '../api.js';
import { getAuthSession } from '../auth-client.js';

export async function loadPayment(container, data) {
  const planCode = data?.plan_code || 'yearly';
  const planName = data?.plan_name || '年度套餐';
  const price = data?.price || 88800;
  const formatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 });

  const session = getAuthSession();
  if (!session) {
    container.innerHTML = '<div class="empty-state"><p>请先登录</p><button onclick="window.navigateTo(\'login\')">去登录</button></div>';
    return;
  }

  let html = `<div class="payment-container">`;
  html += `<div class="payment-header"><h2>确认订单</h2></div>`;

  html += `<div class="payment-card">
    <div class="payment-plan-row">
      <span class="payment-plan-label">套餐</span>
      <span class="payment-plan-value">${planName}</span>
    </div>
    <div class="payment-plan-row">
      <span class="payment-plan-label">金额</span>
      <span class="payment-plan-value payment-price">${formatter.format(price / 100)}</span>
    </div>
    <div class="payment-plan-row">
      <span class="payment-plan-label">支付方式</span>
      <span class="payment-plan-value">支付宝（模拟）</span>
    </div>
  </div>`;

  html += `<div class="payment-coupon">
    <input type="text" id="couponInput" placeholder="优惠码（选填）" maxlength="20" />
    <button id="couponApplyBtn" onclick="applyCoupon()">应用</button>
    <span id="couponMsg" class="payment-coupon-msg"></span>
  </div>`;

  html += `<div class="payment-actions">
    <button class="payment-submit-btn" id="payBtn" onclick="submitPayment('${planCode}', ${price})">
      💳 确认支付 ${formatter.format(price / 100)}
    </button>
    <button class="payment-cancel-btn" onclick="window.navigateTo('pricing')">返回</button>
  </div>`;

  html += `<div id="paymentStatus" style="display:none;text-align:center;padding:20px">
    <div class="loading-spinner"></div><p>正在处理...</p>
  </div>`;

  html += `</div>`;
  container.innerHTML = html;

  // 存储当前选中的套餐信息
  container._planCode = planCode;
  container._price = price;
}

window.submitPayment = async function (planCode, price) {
  const couponCode = document.getElementById('couponInput')?.value?.trim() || null;
  const payBtn = document.getElementById('payBtn');
  const statusEl = document.getElementById('paymentStatus');
  const msgEl = document.getElementById('couponMsg');

  if (payBtn) payBtn.disabled = true;
  if (statusEl) statusEl.style.display = 'block';

  try {
    const body = { plan_code: planCode };
    if (couponCode) body.coupon_code = couponCode;

    const res = await api('payment-create-order', body);
    if (!res) {
      if (msgEl) msgEl.textContent = '创建订单失败';
      if (payBtn) payBtn.disabled = false;
      if (statusEl) statusEl.style.display = 'none';
      return;
    }

    const order = res;
    // 跳转到模拟支付链接
    window.location.href = '/api/payments/simulate-pay?orderNo=' + order.order_no + '&amount=' + order.amount +
      '&returnUrl=' + encodeURIComponent(location.origin + '/preview/index.html#payment-result?orderNo=' + order.order_no);
  } catch (e) {
    if (statusEl) statusEl.innerHTML = '<p style="color:red">支付失败: ' + e.message + '</p>';
    if (payBtn) payBtn.disabled = false;
  }
};

window.applyCoupon = async function () {
  const code = document.getElementById('couponInput')?.value?.trim();
  const msgEl = document.getElementById('couponMsg');
  if (!code) { if (msgEl) msgEl.textContent = ''; return; }
  // 优惠码在创建订单时一起验证，这里只做前端预提示
  if (msgEl) msgEl.textContent = '将在下单时自动验证优惠码';
};

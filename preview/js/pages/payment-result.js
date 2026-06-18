import { api } from '../api.js';
import { hasReferralAccess } from '../auth-client.js';

const PLAN_NAME_MAP = {
  monthly: '月度套餐',
  quarterly: '季度套餐',
  yearly: '年度套餐',
};

function formatMoney(value) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0,
  }).format((Number(value) || 0) / 100);
}

function wait(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function pollOrder(orderNo) {
  let last = null;
  // 第一轮用 payment-query-alipay 主动查支付宝，后续用本地查
  for (let i = 0; i < 6; i++) {
    if (i > 0) await wait(i <= 2 ? 2000 : 3000);
    try {
      // 第 1、4 轮用主动查询（直接查支付宝），其余轮查本地
      const action = i === 0 || i === 3 ? 'payment-query-alipay' : 'payment-query-order';
      last = await api(action, { order_no: orderNo }, 0);
      if (!last || !last.pay_status) continue;
      if (
        last.pay_status === 'paid' ||
        last.pay_status === 'failed' ||
        last.pay_status === 'expired' ||
        last.pay_status === 'closed'
      ) {
        return last;
      }
    } catch (e) {
      if (i === 5) throw e;
    }
  }
  return last || { order_no: orderNo, pay_status: 'pending' };
}

function renderInvalid(container) {
  container.innerHTML =
    '' +
    '<div class="member-shell member-shell-result">' +
    '<div class="member-page result-container">' +
    '<div class="member-section-card member-empty-card">' +
    '<div class="member-empty-title">无效的订单号</div>' +
    '<div class="member-empty-text">当前没有可查询的支付订单，请返回套餐页重新选择。</div>' +
    '<div class="member-cta-row">' +
    '<button class="member-primary-btn" type="button" onclick="window.navigateTo(\'pricing\')">返回套餐页</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>';
}

export async function loadPaymentResult(container, data) {
  const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const orderNo = urlParams.get('orderNo') || (data && data.order_no) || '';

  if (!orderNo) {
    renderInvalid(container);
    return;
  }

  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>查询支付结果...</div>';

  try {
    const orderData = await pollOrder(orderNo);
    const payStatus = (orderData && orderData.pay_status) || 'pending';
    const planName = PLAN_NAME_MAP[orderData && orderData.plan_code] || '会员套餐';
    const paidAt = orderData && orderData.paid_at ? new Date(orderData.paid_at).toLocaleString() : '--';
    const expireAt = orderData && orderData.expired_at ? new Date(orderData.expired_at).toLocaleString() : '--';

    const heroClass =
      payStatus === 'paid' ? 'result-success' : payStatus === 'pending' ? 'result-waiting' : 'result-failed';
    const heroIcon =
      payStatus === 'paid' ? '✅' : payStatus === 'pending' ? '⏳' : payStatus === 'expired' ? '⏰' : '❌';
    const heroTitle =
      payStatus === 'paid'
        ? '支付成功，会员已开通'
        : payStatus === 'pending'
          ? '支付确认中'
          : payStatus === 'expired'
            ? '订单已过期'
            : '支付失败';
    const heroDesc =
      payStatus === 'paid'
        ? hasReferralAccess()
          ? '系统已为你激活订阅，可继续查看订阅状态或邀请好友返利。'
          : '系统已为你激活订阅，可前往订阅中心查看状态。'
        : payStatus === 'pending'
          ? '订单仍在确认中，你可以稍后返回本页或前往订阅中心查看最新状态。'
          : payStatus === 'expired'
            ? '当前订单已超过支付时限，请重新选择套餐后下单。'
            : '本次支付未成功，可重新下单继续开通。';

    const html =
      '' +
      '<div class="member-shell member-shell-result">' +
      '<div class="member-page result-container">' +
      '<div class="member-section-card ' +
      heroClass +
      '">' +
      '<div class="result-icon">' +
      heroIcon +
      '</div>' +
      '<h2>' +
      heroTitle +
      '</h2>' +
      '<p class="result-desc">' +
      heroDesc +
      '</p>' +
      '<div class="result-details">' +
      '<div class="result-row"><span>订单号</span><span>' +
      orderNo +
      '</span></div>' +
      '<div class="result-row"><span>套餐</span><span>' +
      planName +
      '</span></div>' +
      '<div class="result-row"><span>金额</span><span>' +
      formatMoney(orderData && orderData.amount) +
      '</span></div>' +
      (payStatus === 'paid'
        ? '<div class="result-row"><span>支付时间</span><span>' + paidAt + '</span></div>'
        : '<div class="result-row"><span>订单失效时间</span><span>' + expireAt + '</span></div>') +
      '</div>' +
      '<div class="result-action-group">' +
      (payStatus === 'paid'
        ? '<button class="result-btn" type="button" onclick="window.navigateTo(\'subscription\')">查看订阅</button>' +
          (hasReferralAccess()
            ? '<button class="result-btn result-btn-sub" type="button" onclick="window.navigateTo(\'referral\')">去返利中心</button>'
            : '') +
          '<button class="result-btn result-btn-sub" type="button" onclick="window.navigateTo(\'home\')">返回首页</button>'
        : payStatus === 'pending'
          ? '<button class="result-btn" type="button" onclick="window.navigateTo(\'subscription\')">查看订阅</button><button class="result-btn result-btn-sub" type="button" onclick="window.navigateTo(\'pricing\')">回套餐页</button>'
          : '<button class="result-btn" type="button" onclick="window.navigateTo(\'pricing\')">重新选购</button><button class="result-btn result-btn-sub" type="button" onclick="window.navigateTo(\'contact-invite\')">联系客服</button>') +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML =
      '' +
      '<div class="member-shell member-shell-result">' +
      '<div class="member-page result-container">' +
      '<div class="member-section-card member-empty-card">' +
      '<div class="member-empty-title">支付结果查询失败</div>' +
      '<div class="member-empty-text">' +
      (e && e.message ? e.message : '请稍后重试') +
      '</div>' +
      '<div class="member-cta-row">' +
      '<button class="member-primary-btn" type="button" onclick="window.navigateTo(\'subscription\')">查看订阅中心</button>' +
      '<button class="member-secondary-btn" type="button" onclick="window.navigateTo(\'pricing\')">返回套餐页</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
  }
}

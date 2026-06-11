// ==================== 支付结果页 ====================
import { api } from '../api.js';

export async function loadPaymentResult(container, data) {
  const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const orderNo = urlParams.get('orderNo') || data?.order_no;

  if (!orderNo) {
    container.innerHTML = '<div class="empty-state">无效的订单号</div>';
    return;
  }

  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>查询支付结果...</div>';

  // 轮询查询支付状态（最多 10 次，每次 3 秒）
  let payStatus = 'pending';
  let orderData = null;

  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const res = await api('payment-query-order', { order_no: orderNo });
    if (res) {
      payStatus = res.pay_status;
      orderData = res;
      if (payStatus === 'paid' || payStatus === 'failed' || payStatus === 'expired') break;
    }
  }

  const formatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 });

  let html = `<div class="result-container">`;

  if (payStatus === 'paid') {
    html += `
      <div class="result-success">
        <div class="result-icon">✅</div>
        <h2>支付成功</h2>
        <div class="result-details">
          <div class="result-row"><span>订单号</span><span>${orderNo}</span></div>
          <div class="result-row"><span>金额</span><span>${formatter.format((orderData?.amount || 0) / 100)}</span></div>
          <div class="result-row"><span>套餐</span><span>${orderData?.plan_code === 'monthly' ? '月度套餐' : orderData?.plan_code === 'quarterly' ? '季度套餐' : '年度套餐'}</span></div>
          <div class="result-row"><span>支付时间</span><span>${orderData?.paid_at ? new Date(orderData.paid_at).toLocaleString() : '--'}</span></div>
        </div>
        <button class="result-btn" onclick="window.navigateTo('home')">返回首页</button>
        <button class="result-btn result-btn-sub" onclick="window.navigateTo('subscription')">查看订阅</button>
      </div>`;
  } else if (payStatus === 'pending') {
    html += `
      <div class="result-waiting">
        <div class="result-icon">⏳</div>
        <h2>支付确认中</h2>
        <p>请在订阅管理中查看最新状态</p>
        <button class="result-btn" onclick="window.navigateTo('subscription')">查看订阅</button>
      </div>`;
  } else if (payStatus === 'expired') {
    html += `
      <div class="result-failed">
        <div class="result-icon">⏰</div>
        <h2>订单已过期</h2>
        <button class="result-btn" onclick="window.navigateTo('pricing')">重新选购</button>
      </div>`;
  } else {
    html += `
      <div class="result-failed">
        <div class="result-icon">❌</div>
        <h2>支付失败</h2>
        <p>${payStatus}</p>
        <button class="result-btn" onclick="window.navigateTo('pricing')">重新选购</button>
      </div>`;
  }

  html += `</div>`;
  container.innerHTML = html;
}

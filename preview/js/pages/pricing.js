// ==================== 套餐展示页 ====================
import { api } from '../api.js';

export async function loadPricing(container, data) {
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载套餐中...</div>';

  const res = await api('plan-catalog');
  if (!res?.plans) {
    container.innerHTML = '<div class="empty-state">暂无套餐数据</div>';
    return;
  }

  const plans = res.plans;
  const formatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 });
  const recPlan = 'yearly';

  let html = `<div class="pricing-container">`;
  html += `<div class="pricing-header"><h2>选择套餐</h2><p>全功能开放，仅按周期区分价格</p></div>`;
  html += `<div class="pricing-cards">`;

  plans.forEach(plan => {
    const recClass = plan.plan_code === recPlan ? ' pricing-card-rec' : '';
    html += `
      <div class="pricing-card${recClass}" onclick="selectPricingPlan('${plan.plan_code}', ${plan.price})">
        ${plan.plan_code === recPlan ? '<div class="pricing-badge">⭐ 最划算</div>' : ''}
        <div class="pricing-plan-name">${plan.plan_name}</div>
        <div class="pricing-price">${formatter.format(plan.price / 100)}</div>
        <div class="pricing-monthly">相当于 ${formatter.format(plan.monthly_equivalent / 100)}/月</div>
        <div class="pricing-discount">${plan.discount_label || ''}</div>
        <div class="pricing-period">${plan.duration_months} 个月</div>
        <button class="pricing-btn" data-plan="${plan.plan_code}" data-price="${plan.price}">立即购买</button>
      </div>`;
  });

  html += `</div>`;
  html += `<div class="pricing-features">
    <h3>所有套餐均享有</h3>
    <div class="feature-grid">
      <div class="feature-item">✓ 今日方案全部</div><div class="feature-item">✓ AI 全量预测</div>
      <div class="feature-item">✓ 功守道分析</div><div class="feature-item">✓ 回测分析</div>
      <div class="feature-item">✓ 赔率走势图</div><div class="feature-item">✓ 历史回看</div>
      <div class="feature-item">✓ 数据导出</div><div class="feature-item">✓ 无广告无水印</div>
    </div>
  </div>`;
  html += `</div>`;

  container.innerHTML = html;

  // 绑定购买按钮
  container.querySelectorAll('.pricing-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const planCode = this.dataset.plan;
      const price = parseInt(this.dataset.price);
      window.selectPricingPlan(planCode, price);
    });
  });
}

// 全局函数：选择套餐后跳转支付页
window.selectPricingPlan = function (planCode, price) {
  const state = window.__jcState || {};
  const planNameMap = { monthly: '月度套餐', quarterly: '季度套餐', yearly: '年度套餐' };
  const planName = planNameMap[planCode] || planCode;

  // 跳转到支付确认页
  if (typeof window.navigateTo === 'function') {
    window.navigateTo('payment', { plan_code: planCode, plan_name: planName, price });
  }
};

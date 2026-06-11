// ==================== 订阅管理页 ====================
import { api } from '../api.js';
import { getAuthSession } from '../auth-client.js';

export async function loadSubscription(container, data) {
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  const session = getAuthSession();
  if (!session) {
    container.innerHTML = '<div class="empty-state"><p>请先登录</p><button onclick="window.navigateTo(\'login\')">去登录</button></div>';
    return;
  }

  const res = await api('subscription-status');
  if (!res) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
    return;
  }

  const sub = res;
  const formatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 });

  let statusIcon = '';
  let statusText = '';
  let statusClass = '';

  switch (sub.status) {
    case 'active':
      statusIcon = '🟢'; statusText = '已激活'; statusClass = 'status-active';
      break;
    case 'expiring_soon':
      statusIcon = '🟡'; statusText = '即将到期'; statusClass = 'status-expiring';
      break;
    case 'expired':
      statusIcon = '🔴'; statusText = '已过期'; statusClass = 'status-expired';
      break;
    default:
      statusIcon = '⚪'; statusText = '未订阅'; statusClass = 'status-free';
  }

  let html = `<div class="sub-container">`;
  html += `<div class="sub-header"><h2>我的订阅</h2></div>`;
  html += `<div class="sub-card ${statusClass}">
    <div class="sub-status">${statusIcon} ${statusText}</div>
    <div class="sub-plan">${sub.plan_name || '免费用户'}</div>
    ${sub.expires_at ? `<div class="sub-expires">到期日: ${sub.expires_at} (剩余 ${sub.remaining_days} 天)</div>` : ''}
    ${sub.auto_renew ? '<div class="sub-auto">已开启自动续费提醒</div>' : ''}
  </div>`;

  html += `<div class="sub-actions">`;
  if (sub.status === 'free') {
    html += `<button class="sub-btn sub-btn-primary" onclick="window.navigateTo('pricing')">开通会员</button>`;
  } else if (sub.status === 'active' || sub.status === 'expiring_soon') {
    html += `<button class="sub-btn sub-btn-primary" onclick="window.navigateTo('pricing')">续费 / 升级</button>`;
    if (sub.auto_renew) {
      html += `<button class="sub-btn sub-btn-secondary" onclick="toggleAutoRenew(false)">关闭续费提醒</button>`;
    } else {
      html += `<button class="sub-btn sub-btn-secondary" onclick="toggleAutoRenew(true)">开启续费提醒</button>`;
    }
  } else if (sub.status === 'expired') {
    html += `<button class="sub-btn sub-btn-primary" onclick="window.navigateTo('pricing')">重新订阅</button>`;
  }
  html += `</div>`;

  html += `<div class="sub-features">
    <h3>会员权益</h3>
    <div class="feature-grid">
      <div class="feature-item">✓ 全部方案</div><div class="feature-item">✓ AI 预测全量</div>
      <div class="feature-item">✓ 功守道分析</div><div class="feature-item">✓ 回测分析</div>
      <div class="feature-item">✓ 赔率走势</div><div class="feature-item">✓ 历史回看</div>
      <div class="feature-item">✓ 数据导出</div><div class="feature-item">✓ 无广告</div>
    </div>
  </div>`;

  html += `</div>`;
  container.innerHTML = html;
}

window.toggleAutoRenew = async function (enable) {
  const action = enable ? 'subscription-enable-auto-renew' : 'subscription-cancel-auto-renew';
  const res = await api(action);
  if (res.code === 0) {
    location.reload();
  } else {
    alert(res.msg || '操作失败');
  }
};

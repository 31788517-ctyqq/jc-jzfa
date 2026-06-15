import { api } from '../vendor.js';
import { getAuthSession, hasAuthToken, hasReferralAccess } from '../vendor.js';

const MEMBER_RIGHTS = [
  '专家方案 / 博热方案 / 量化方案完整访问',
  'AI 全量预测、模型仪表板与回测分析',
  '功守道深度分析与赔率走势查看',
  '订阅管理、到期提醒与邀请返利能力',
];

function getMemberHomeIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4.5v-5.5h3V21H18a1 1 0 0 0 1-1V9.5"/></svg>';
}

function statusMeta(sub) {
  switch (sub.status) {
    case 'active':
      return {
        icon: '🟢',
        text: '已激活',
        className: 'status-active',
        desc: '会员能力已开放，可直接浏览方案、模型与功守道。',
      };
    case 'expiring_soon':
      return {
        icon: '🟡',
        text: '即将到期',
        className: 'status-expiring',
        desc: '建议尽快续费，避免方案与回测能力中断。',
      };
    case 'expired':
      return {
        icon: '🔴',
        text: '已过期',
        className: 'status-expired',
        desc: '当前仅保留基础访问权限，续费后即可恢复完整会员能力。',
      };
    default:
      return {
        icon: '⚪',
        text: '未开通',
        className: 'status-free',
        desc: hasReferralAccess()
          ? '开通会员后可查看完整方案、AI 预测与返利中心。'
          : '开通会员后可查看完整方案与 AI 预测。',
      };
  }
}

function renderGuestState(container) {
  container.innerHTML =
    '' +
    '<div class="member-shell member-shell-subscription">' +
    '<div class="member-page sub-container">' +
    '<div class="member-section-card member-empty-card">' +
    '<div class="member-empty-title">请先登录查看订阅中心</div>' +
    '<div class="member-empty-text">登录后即可查看当前订阅状态、到期时间与续费入口。</div>' +
    '<div class="member-cta-row">' +
    '<button class="member-secondary-btn" type="button" onclick="window.navigateTo(\'login\')">去登录</button>' +
    '<button class="member-primary-btn" type="button" onclick="window.navigateTo(\'pricing\')">先看套餐</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>';
}

export async function loadSubscription(container) {
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载订阅状态...</div>';

  if (!hasAuthToken() || !getAuthSession()) {
    renderGuestState(container);
    return;
  }

  try {
    var sub = await api('subscription-status', {}, 0);
    var meta = statusMeta(sub || {});
    var planName = (sub && sub.plan_name) || '免费用户';
    var expiresText =
      sub && sub.expires_at
        ? '到期时间：' + sub.expires_at + ' · 剩余 ' + Number(sub.remaining_days || 0) + ' 天'
        : '当前尚未开通会员，可先选择合适套餐。';

    var actions = '';
    if (sub.status === 'free') {
      actions =
        '<button class="sub-btn sub-btn-primary" type="button" onclick="window.navigateTo(\'pricing\')">立即开通会员</button>';
    } else if (sub.status === 'active' || sub.status === 'expiring_soon') {
      actions =
        '' +
        '<button class="sub-btn sub-btn-primary" type="button" onclick="window.navigateTo(\'pricing\')">续费 / 升级</button>' +
        '<button class="sub-btn sub-btn-secondary" type="button" onclick="toggleAutoRenew(' +
        !sub.auto_renew +
        ')">' +
        (sub.auto_renew ? '关闭续费提醒' : '开启续费提醒') +
        '</button>';
    } else {
      actions =
        '<button class="sub-btn sub-btn-primary" type="button" onclick="window.navigateTo(\'pricing\')">重新订阅</button>';
    }

    container.innerHTML =
      '' +
      '<div class="member-shell member-shell-subscription">' +
      '<div class="member-page sub-container">' +
      '<div class="member-hero member-hero-profilelike member-hero-subscription-plain">' +
      '<button class="member-home-corner" type="button" onclick="switchTab(\'profile\')" aria-label="返回个人中心" title="返回个人中心">' +
      getMemberHomeIcon() +
      '</button>' +
      '<div class="member-hero-copy">' +
      '<div class="member-hero-title">订阅中心</div>' +
      '<div class="member-hero-subtitle">当前账号：<strong>' +
      (((getAuthSession() || {}).user || {}).username || '会员用户') +
      '</strong></div>' +
      '</div>' +
      '<img class="member-hero-eagle" src="/laoying11.png" alt="" loading="eager" decoding="async" />' +
      '</div>' +
      '<div class="member-section-card sub-card ' +
      meta.className +
      '">' +
      '<div class="sub-status">' +
      meta.icon +
      ' ' +
      meta.text +
      '</div>' +
      '<div class="sub-plan">' +
      planName +
      '</div>' +
      '<div class="sub-expires">' +
      expiresText +
      '</div>' +
      '<div class="sub-auto">' +
      meta.desc +
      (sub.auto_renew ? ' 已开启续费提醒。' : '') +
      '</div>' +
      '</div>' +
      '<div class="sub-actions">' +
      actions +
      (hasReferralAccess()
        ? '<button class="sub-btn sub-btn-secondary" type="button" onclick="window.navigateTo(\'referral\')">查看邀请返利</button>'
        : '') +
      '</div>' +
      '<div class="member-section-card sub-feature-card">' +
      '<div class="member-section-title">会员权益</div>' +
      '<div class="member-note-list">' +
      MEMBER_RIGHTS.filter(function (item) {
        return hasReferralAccess() || item.indexOf('返利') < 0;
      })
        .map(function (item) {
          return '<div class="member-note-item"><span class="member-note-icon">✓</span><span>' + item + '</span></div>';
        })
        .join('') +
      '</div>' +
      '</div>' +
      '<div class="member-cta-row">' +
      '<button class="member-secondary-btn" type="button" onclick="window.navigateTo(\'home\')">返回首页</button>' +
      '<button class="member-primary-btn" type="button" onclick="window.navigateTo(\'pricing\')">查看套餐</button>' +
      '</div>' +
      '</div>' +
      '</div>';
  } catch (e) {
    container.innerHTML =
      '' +
      '<div class="member-shell member-shell-subscription">' +
      '<div class="member-page sub-container">' +
      '<div class="member-section-card member-empty-card">' +
      '<div class="member-empty-title">订阅状态加载失败</div>' +
      '<div class="member-empty-text">' +
      (e && e.message ? e.message : '请稍后重试') +
      '</div>' +
      '<div class="member-cta-row">' +
      '<button class="member-primary-btn" type="button" onclick="window.navigateTo(\'pricing\')">查看套餐</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
  }
}

window.toggleAutoRenew = async function (enable) {
  var action = enable ? 'subscription-enable-auto-renew' : 'subscription-cancel-auto-renew';
  try {
    await api(action, {}, 0);
    if (typeof window.switchTab === 'function') window.switchTab('subscription');
  } catch (e) {
    alert((e && e.message) || '操作失败，请稍后重试');
  }
};

import { api } from '../api.js';
import { getAuthSession, hasAuthToken } from '../auth-client.js';

const PLAN_META = {
  monthly: {
    tagline: '适合先体验 7~30 天核心能力',
    badge: '灵活体验',
    accent: 'mint',
    scene: '先体验 AI 推荐、今日方案与功守道核心能力',
  },
  quarterly: {
    tagline: '适合稳定跟单与阶段性复盘',
    badge: '进阶推荐',
    accent: 'cyan',
    scene: '更适合连续跟踪比赛、看走势与阶段回测',
  },
  yearly: {
    tagline: '适合长期订阅，性价比最高',
    badge: '年度主推',
    accent: 'gold',
    scene: '适合长期订阅、全年回测与邀请返利协同增长',
  },
};

const MEMBER_FEATURES = [
  '今日方案全量开放',
  'AI 全量预测与多模型视图',
  '功守道深度分析',
  '回测分析与历史回看',
  '赔率走势与数据导出',
  '订阅中心与邀请返利能力',
];

const MEMBER_FAQ = [
  { q: '开通后可以立即使用吗？', a: '支付成功后会自动激活订阅，可直接查看方案、模型与功守道分析。' },
  { q: '到期后会怎样？', a: '到期后不会再扣费，会员能力自动恢复为基础访问，可随时续费恢复。' },
  { q: '邀请返利怎么生效？', a: '好友通过你的邀请链接注册并完成付费后，返利会自动进入你的返利账户。' },
];

function getMemberHomeIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4.5v-5.5h3V21H18a1 1 0 0 0 1-1V9.5"/></svg>';
}

function formatMoney(value) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0,
  }).format((Number(value) || 0) / 100);
}

function getStoredPlan() {
  try {
    var raw = sessionStorage.getItem('pendingSelectedPlan') || '';
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function consumeVipClaimNotice() {
  try {
    var raw = sessionStorage.getItem('vipGiftClaimNotice') || '';
    if (!raw) return null;
    sessionStorage.removeItem('vipGiftClaimNotice');
    if (raw === '1') return { gift_expires_at: null, claim_date: null };
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function formatDateCn(dateStr) {
  var s = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return s.slice(5, 7).replace(/^0/, '') + '月' + s.slice(8, 10).replace(/^0/, '') + '日';
}

function setStoredPlan(plan) {
  try {
    sessionStorage.setItem('pendingSelectedPlan', JSON.stringify(plan || {}));
  } catch (e) {}
}

function pickRecommendedCode(plans) {
  if (!Array.isArray(plans) || !plans.length) return 'yearly';
  if (
    plans.some(function (plan) {
      return plan.plan_code === 'yearly';
    })
  )
    return 'yearly';
  return plans.slice().sort(function (a, b) {
    return Number(b.duration_months || 0) - Number(a.duration_months || 0);
  })[0].plan_code;
}

function renderPlanCard(plan, recommendedCode, authed) {
  var code = plan.plan_code || '';
  var meta = PLAN_META[code] || {};
  var isRecommended = code === recommendedCode;
  var accent = meta.accent || 'mint';
  var buttonText = authed ? '立即开通' : '注册并开通';
  var monthly = Number(plan.monthly_equivalent || 0);
  var discount = plan.discount_label || (monthly > 0 && Number(plan.price || 0) > monthly ? '长期订阅更划算' : '');
  return (
    '' +
    '<div class="pricing-card' +
    (isRecommended ? ' pricing-card-rec' : '') +
    ' pricing-card-' +
    accent +
    '" onclick="selectPricingPlan(\'' +
    code +
    "'," +
    Number(plan.price || 0) +
    ",'" +
    (plan.plan_name || '') +
    '\')">' +
    (isRecommended
      ? '<div class="pricing-badge">' + (meta.badge || '推荐') + '</div>'
      : '<div class="pricing-lite-badge">' + (meta.badge || '会员套餐') + '</div>') +
    '<div class="pricing-plan-name">' +
    (plan.plan_name || code) +
    '</div>' +
    '<div class="pricing-tagline">' +
    (meta.tagline || '覆盖核心会员权益') +
    '</div>' +
    '<div class="pricing-price">' +
    formatMoney(plan.price) +
    '</div>' +
    '<div class="pricing-monthly">低至 ' +
    formatMoney(monthly) +
    '/月</div>' +
    '<div class="pricing-discount">' +
    discount +
    '</div>' +
    '<div class="pricing-period">有效期 ' +
    Number(plan.duration_months || 0) +
    ' 个月</div>' +
    '<div class="pricing-scene">' +
    (meta.scene || '适合日常使用') +
    '</div>' +
    '<button class="pricing-btn" type="button" data-plan="' +
    code +
    '" data-price="' +
    Number(plan.price || 0) +
    '" data-name="' +
    (plan.plan_name || '') +
    '">' +
    buttonText +
    '</button>' +
    '</div>'
  );
}

function renderVipClaimCard(notice) {
  var expiresAt = (notice && notice.gift_expires_at) || '';
  var deadlineText = formatDateCn(expiresAt);
  return (
    '' +
    '<div class="pricing-card pricing-card-mint vip-claim-card" role="status">' +
    '<div class="pricing-lite-badge">领取成功</div>' +
    '<div class="vip-claim-card-title">🎉 15天VIP体验领取成功</div>' +
    '<div class="vip-claim-card-desc">体验权益已到账：可先查看套餐与会员能力，体验期内可随时升级，不影响已领取权益。</div>' +
    '<div class="vip-claim-card-deadline">限时优惠截止日期：' +
    (deadlineText || '已生效，请在会员中心查看到期时间') +
    '</div>' +
    '<button class="vip-claim-card-home" type="button" onclick="switchTab(\'home\')">回到首页</button>' +
    '</div>'
  );
}

function renderEmptyState(authed) {
  return (
    '' +
    '<div class="member-shell member-shell-pricing">' +
    '<div class="member-page pricing-container">' +
    '<div class="member-hero">' +
    '<div class="member-top-badge">会员服务</div>' +
    '<div class="member-hero-title">套餐暂未开放</div>' +
    '<div class="member-hero-subtitle">当前还没有可售套餐，请稍后再来查看。</div>' +
    '</div>' +
    '<div class="member-section-card member-empty-card">' +
    '<div class="member-empty-title">暂无套餐数据</div>' +
    '<div class="member-empty-text">你可以先返回首页继续浏览，或稍后刷新重试。</div>' +
    '<div class="member-cta-row">' +
    '<button class="member-primary-btn" type="button" onclick="switchTab(\'' +
    (authed ? 'home' : 'login') +
    '\')">' +
    (authed ? '返回首页' : '去登录') +
    '</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

export async function loadPricing(container) {
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载套餐中...</div>';

  try {
    var session = getAuthSession() || {};
    var authed = hasAuthToken();
    var userName = (session.user && session.user.username) || '';
    var res = await api('plan-catalog', {}, 0);
    var plans = Array.isArray(res && res.plans) ? res.plans : [];

    if (!plans.length) {
      container.innerHTML = renderEmptyState(authed);
      return;
    }

    var recommendedCode = pickRecommendedCode(plans);
    var pendingPlan = getStoredPlan();
    var vipClaimNotice = consumeVipClaimNotice();
    var hasVipClaimCard = !!vipClaimNotice;
    var planCardsHtml = plans.map(function (plan) {
      return renderPlanCard(plan, recommendedCode, authed);
    });

    if (vipClaimNotice) {
      var monthlyIndex = plans.findIndex(function (plan) {
        return String((plan && plan.plan_code) || '') === 'monthly';
      });
      planCardsHtml.splice(monthlyIndex >= 0 ? monthlyIndex : 0, 0, renderVipClaimCard(vipClaimNotice));
    }

    var html =
      '' +
      '<div class="member-shell member-shell-pricing">' +
      '<div class="member-page pricing-container">' +
      '<div class="member-hero pricing-hero member-hero-profilelike">' +
      '<button class="member-home-corner" type="button" onclick="switchTab(\'profile\')" aria-label="返回个人中心" title="返回个人中心">' +
      getMemberHomeIcon() +
      '</button>' +
      '<div class="member-hero-copy">' +
      '<div class="member-hero-title">会员套餐</div>' +
      '<div class="member-hero-subtitle">当前账号：' +
      (authed ? '<strong>' + userName + '</strong>' : '游客') +
      '</div>' +
      '</div>' +
      '<img class="member-hero-eagle" src="/laoying11.png" alt="" loading="eager" decoding="async" />' +
      (pendingPlan
        ? '<div class="member-inline-tip">你刚刚选择了 <strong>' +
          (pendingPlan.plan_name || '会员套餐') +
          '</strong>，登录后可继续完成支付。</div>'
        : '') +
      '</div>' +
      '<div class="pricing-cards' +
      (hasVipClaimCard ? ' has-vip-claim-card' : '') +
      '">' +
      planCardsHtml.join('') +
      '</div>' +
      '<div class="member-section-card pricing-benefit-card">' +
      '<div class="member-section-title">会员权益一览</div>' +
      '<div class="member-note-list">' +
      MEMBER_FEATURES.map(function (item) {
        return '<div class="member-note-item"><span class="member-note-icon">✓</span><span>' + item + '</span></div>';
      }).join('') +
      '</div>' +
      '</div>' +
      '<div class="member-section-card pricing-faq-card">' +
      '<div class="member-section-title">常见问题</div>' +
      '<div class="member-faq-list">' +
      MEMBER_FAQ.map(function (item) {
        return (
          '<div class="member-faq-item"><div class="member-faq-q">' +
          item.q +
          '</div><div class="member-faq-a">' +
          item.a +
          '</div></div>'
        );
      }).join('') +
      '</div>' +
      '</div>' +
      '<div class="member-cta-row">' +
      (authed
        ? '<button class="member-secondary-btn" type="button" onclick="switchTab(\'subscription\')">查看订阅中心</button>'
        : '<button class="member-secondary-btn" type="button" onclick="switchTab(\'login\')">已有账号，去登录</button>') +
      '<button class="member-primary-btn" type="button" onclick="switchTab(\'' +
      (authed ? 'referral' : 'contact-invite') +
      '\')">' +
      (authed ? '查看邀请返利' : '联系客服获邀') +
      '</button>' +
      '</div>' +
      '</div>' +
      '</div>';

    container.innerHTML = html;

    Array.prototype.forEach.call(container.querySelectorAll('.pricing-btn'), function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        window.selectPricingPlan(this.dataset.plan, Number(this.dataset.price || 0), this.dataset.name || '');
      });
    });
  } catch (e) {
    container.innerHTML =
      '' +
      '<div class="member-shell member-shell-pricing">' +
      '<div class="member-page pricing-container">' +
      '<div class="member-section-card member-empty-card">' +
      '<div class="member-empty-title">套餐加载失败</div>' +
      '<div class="member-empty-text">' +
      (e && e.message ? e.message : '请稍后重试') +
      '</div>' +
      '<div class="member-cta-row">' +
      '<button class="member-primary-btn" type="button" onclick="switchTab(\'home\')">返回首页</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
  }
}

window.selectPricingPlan = function (planCode, price, planName) {
  var planNameMap = { monthly: '月度套餐', quarterly: '季度套餐', yearly: '年度套餐' };
  var plan = {
    plan_code: planCode,
    plan_name: planName || planNameMap[planCode] || planCode,
    price: Number(price) || 0,
  };
  setStoredPlan(plan);

  if (!hasAuthToken()) {
    try {
      sessionStorage.setItem('pendingAfterLogin', 'payment');
    } catch (e) {}
    if (typeof window.switchTab === 'function') window.switchTab('register');
    return;
  }

  if (typeof window.navigateTo === 'function') {
    window.navigateTo('payment', plan);
  }
};

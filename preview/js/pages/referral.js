import { api } from '../api.js';
import { getCache, setCache } from '../utils.js';
import { getAuthSession, hasAuthToken, hasReferralAccess } from '../auth-client.js';

function formatMoney(value) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0,
  }).format((Number(value) || 0) / 100);
}

function commissionStatusText(status) {
  return status === 'pending' ? '待结算' : status === 'settled' ? '已结算' : status === 'cancelled' ? '已取消' : status;
}

function withdrawStatusText(status) {
  return status === 'submitted' || status === 'processing'
    ? '审核中'
    : status === 'approved'
      ? '已通过'
      : status === 'paid' || status === 'completed'
        ? '已打款'
        : status === 'rejected'
          ? '已驳回'
          : status;
}

function getMemberHomeIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4.5v-5.5h3V21H18a1 1 0 0 0 1-1V9.5"/></svg>';
}

function normalizeInviteLink(link, code) {
  const fallback = code ? 'https://zj.100qiu.com/#register?ref=' + code : '';
  let raw = String(link || fallback || '').trim();
  if (!raw) return '';
  // 兼容历史错误链接：/preview/#register?ref=...
  raw = raw.replace('https://zj.100qiu.com/preview/#register?', 'https://zj.100qiu.com/#register?');
  raw = raw.replace('https://zj.100qiu.com/preview/index.html#register?', 'https://zj.100qiu.com/#register?');
  return raw;
}

function renderGuestState(container) {
  container.innerHTML =
    '' +
    '<div class="member-shell member-shell-referral">' +
    '<div class="member-page ref-container">' +
    '<div class="member-section-card member-empty-card">' +
    '<div class="member-empty-title">登录后查看邀请码</div>' +
    '<div class="member-empty-text">登录后即可查看邀请码、邀请链接与邀请记录。</div>' +
    '<div class="member-cta-row">' +
    '<button class="member-secondary-btn" type="button" onclick="window.navigateTo(\'login\')">去登录</button>' +
    '<button class="member-primary-btn" type="button" onclick="window.navigateTo(\'pricing\')">先看套餐</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>';
}

/** ★ 轻量版：仅展示邀请码+分享链接+邀请流程，无返利营收模块 */
async function renderLiteReferral(container) {
  try {
    const infoCacheKey = 'referral-info:v1';
    let infoResult = getCache(infoCacheKey);
    if (!infoResult) {
      infoResult = await api('referral-info', {}, 0);
      setCache(infoCacheKey, infoResult || {});
    }

    const info = infoResult || {};
    const shareUrl = normalizeInviteLink(info.shareUrl, info.referralCode);
    const session = getAuthSession() || {};

    container.innerHTML =
      '' +
      '<div class="member-shell member-shell-referral">' +
      '<div class="member-page ref-container">' +
      '<div class="member-hero member-hero-referral member-hero-profilelike member-hero-referral-plain">' +
      '<button class="member-home-corner" type="button" onclick="switchTab(\'profile\')" aria-label="返回个人中心" title="返回个人中心">' +
      getMemberHomeIcon() +
      '</button>' +
      '<div class="member-hero-copy">' +
      '<div class="member-hero-title">邀请好友</div>' +
      '<div class="member-hero-subtitle">当前账号：<strong>' +
      ((session.user || {}).username || '会员用户') +
      '</strong></div>' +
      '</div>' +
      '<img class="member-hero-eagle" src="/laoying11.png" alt="" loading="eager" decoding="async" />' +
      '</div>' +
      '<div class="member-section-card ref-code-card">' +
      '<div class="member-section-title">我的邀请码</div>' +
      '<div class="ref-code-row"><span class="ref-code">' +
      (info.referralCode || '未生成') +
      '</span>' +
      (info.referralCode
        ? '<button class="ref-code-copy" type="button" onclick="copyReferralCode(\'' +
          info.referralCode +
          '\')">复制邀请码</button>'
        : '') +
      '</div>' +
      '<div class="ref-link">' +
      (shareUrl || '当前暂无可分享链接') +
      '</div>' +
      '<div class="member-cta-row member-cta-row-compact">' +
      '<button class="member-secondary-btn" type="button" onclick="copyReferralLink(\'' +
      shareUrl +
      '\')">复制邀请链接</button>' +
      '<button class="member-primary-btn" type="button" onclick="window.navigateTo(\'pricing\')">查看会员套餐</button>' +
      '</div>' +
      '</div>' +
      '<div class="member-section-card ref-guide-card">' +
      '<div class="member-section-title">邀请流程</div>' +
      '<div class="member-note-list">' +
      '<div class="member-note-item"><span class="member-note-icon">1</span><span>发送邀请码或邀请链接给好友</span></div>' +
      '<div class="member-note-item"><span class="member-note-icon">2</span><span>好友注册并完成会员开通</span></div>' +
      '<div class="member-note-item"><span class="member-note-icon">3</span><span>邀请记录可在本页查看</span></div>' +
      '</div>' +
      '</div>' +
      '<div class="member-cta-row">' +
      '<button class="member-secondary-btn" type="button" onclick="window.navigateTo(\'pricing\')">查看会员套餐</button>' +
      '<button class="member-primary-btn" type="button" onclick="window.navigateTo(\'profile\')">返回个人中心</button>' +
      '</div>' +
      '</div>' +
      '</div>';
  } catch (e) {
    container.innerHTML =
      '<div class="member-shell member-shell-referral">' +
      '<div class="member-page ref-container">' +
      '<div class="member-section-card member-empty-card">' +
      '<div class="member-empty-title">加载失败</div>' +
      '<div class="member-empty-text">' +
      (e && e.message ? e.message : '请稍后重试') +
      '</div>' +
      '<div class="member-cta-row">' +
      '<button class="member-primary-btn" type="button" onclick="window.navigateTo(\'home\')">返回首页</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
  }
}

function renderCommissionList(list) {
  if (!Array.isArray(list) || !list.length) {
    return '<div class="member-empty-mini">暂无返利记录，邀请好友完成付费后会自动累积到这里。</div>';
  }
  return list
    .map(function (item) {
      return (
        '' +
        '<div class="ref-item">' +
        '<div class="ref-item-row">' +
        '<span class="ref-item-label">' +
        (item.invitee || '用户') +
        ' · ' +
        (item.plan || '会员套餐') +
        '</span>' +
        '<span class="ref-item-status ref-status-' +
        (item.status || 'pending') +
        '">' +
        commissionStatusText(item.status) +
        '</span>' +
        '</div>' +
        '<div class="ref-item-meta">订单金额 ' +
        formatMoney(item.amount) +
        ' · 返利比例 ' +
        Number(item.rate || 0) +
        '% · 返利 ' +
        formatMoney(item.commission) +
        '</div>' +
        '<div class="ref-item-meta">' +
        (item.createdAt || '--') +
        '</div>' +
        '</div>'
      );
    })
    .join('');
}

function renderWithdrawHistory(list) {
  if (!Array.isArray(list) || !list.length) {
    return '<div class="member-empty-mini">暂无提现记录，提交申请后会在这里同步审核状态。</div>';
  }
  return list
    .map(function (item) {
      return (
        '' +
        '<div class="ref-item">' +
        '<div class="ref-item-row">' +
        '<span class="ref-item-label">' +
        formatMoney(item.amount) +
        '</span>' +
        '<span class="ref-item-status ref-status-' +
        (item.status || 'submitted') +
        '">' +
        withdrawStatusText(item.status) +
        '</span>' +
        '</div>' +
        '<div class="ref-item-meta">' +
        (item.payment_method || 'bank_transfer') +
        ' · ' +
        (item.created_at || '--') +
        '</div>' +
        '</div>'
      );
    })
    .join('');
}

function renderReferralMainShell(container, session) {
  container.innerHTML =
    '' +
    '<div class="member-shell member-shell-referral">' +
    '<div class="member-page ref-container">' +
    '<div class="member-hero member-hero-referral member-hero-profilelike member-hero-referral-plain">' +
    '<button class="member-home-corner" type="button" onclick="switchTab(\'profile\')" aria-label="返回个人中心" title="返回个人中心">' +
    getMemberHomeIcon() +
    '</button>' +
    '<div class="member-hero-copy">' +
    '<div class="member-hero-title">邀请返利</div>' +
    '<div class="member-hero-subtitle">当前账号：<strong>' +
    ((session.user || {}).username || '会员用户') +
    '</strong></div>' +
    '</div>' +
    '<img class="member-hero-eagle" src="/laoying11.png" alt="" loading="eager" decoding="async" />' +
    '</div>' +
    '<div class="ref-balance-card">' +
    '<div class="ref-stat-row">' +
    '<div class="ref-stat"><div class="ref-stat-val" id="refTotalEarned">--</div><div class="ref-stat-lbl">累计收益</div></div>' +
    '<div class="ref-stat"><div class="ref-stat-val" id="refBalance">--</div><div class="ref-stat-lbl">可提现</div></div>' +
    '<div class="ref-stat"><div class="ref-stat-val" id="refInvitees">--</div><div class="ref-stat-lbl">邀请人数</div></div>' +
    '</div>' +
    '<div class="ref-balance-sub" id="refBalanceSub">待结算返利 -- · 累计佣金笔数 --</div>' +
    '</div>' +
    '<div class="ref-btns">' +
    '<button class="ref-btn ref-btn-withdraw" type="button" onclick="openWithdrawModal()">申请提现</button>' +
    "<button class=\"ref-btn ref-btn-share\" type=\"button\" onclick=\"shareReferral((document.getElementById('referralCodeVal')||{}).value||'',(document.getElementById('referralLinkVal')||{}).value||'')\">邀请好友</button>" +
    '</div>' +
    '<div class="member-section-card ref-code-card">' +
    '<div class="member-section-title">我的邀请码</div>' +
    '<div class="ref-code-row"><span class="ref-code" id="refCodeText">加载中...</span><span id="refCodeCopyWrap"></span></div>' +
    '<div class="ref-link" id="refLinkText">正在生成邀请链接...</div>' +
    '<div class="member-cta-row member-cta-row-compact">' +
    '<button class="member-secondary-btn" type="button" onclick="copyReferralLink((document.getElementById(\'referralLinkVal\')||{}).value||\'\')">复制邀请链接</button>' +
    '<button class="member-primary-btn" type="button" onclick="window.navigateTo(\'pricing\')">查看会员套餐</button>' +
    '</div>' +
    '</div>' +
    '<div class="member-section-card ref-guide-card">' +
    '<div class="member-section-title">邀请流程</div>' +
    '<div class="member-note-list">' +
    '<div class="member-note-item"><span class="member-note-icon">1</span><span>发送邀请码或邀请链接给好友</span></div>' +
    '<div class="member-note-item"><span class="member-note-icon">2</span><span>好友注册并完成会员开通</span></div>' +
    '<div class="member-note-item"><span class="member-note-icon">3</span><span>返利自动进入账户，可在本页申请提现</span></div>' +
    '</div>' +
    '</div>' +
    '<div class="member-section-card ref-list-section"><div class="member-section-title">最新返利明细</div><div id="refCommissionList"><div class="member-empty-mini">加载中...</div></div></div>' +
    '<div class="member-section-card ref-list-section"><div class="member-section-title">最近提现记录</div><div id="refWithdrawList"><div class="member-empty-mini">加载中...</div></div></div>' +
    '<input type="hidden" id="referralCodeVal" value="" />' +
    '<input type="hidden" id="referralLinkVal" value="" />' +
    '<input type="hidden" id="referralBalanceCents" value="0" />' +
    '<div class="ref-overlay" id="withdrawOverlay" style="display:none" onclick="closeWithdrawModal(event)">' +
    '<div class="ref-modal" onclick="event.stopPropagation()">' +
    '<div class="ref-modal-header"><h3>申请提现</h3><button type="button" onclick="closeWithdrawModal()">✕</button></div>' +
    '<div class="ref-modal-body">' +
    '<div class="ref-modal-row"><label>可提现金额</label><span id="refModalBalanceText">--</span></div>' +
    '<div class="ref-modal-row"><label>提现金额</label><input type="number" id="withdrawAmount" placeholder="最低 ¥10" min="10" step="1" /></div>' +
    '<div class="ref-modal-row ref-modal-method-row"><label>收款方式</label><input type="hidden" id="withdrawMethod" value="bank_transfer" />' +
    '<div class="ref-pay-dd" id="withdrawMethodDD">' +
    '<button class="ref-pay-dd-trigger" type="button" onclick="toggleWithdrawMethodDD(event)"><span id="withdrawMethodText">银行转账</span><span class="ref-pay-dd-arrow"></span></button>' +
    '<div class="ref-pay-dd-menu">' +
    '<button class="ref-pay-dd-option selected" type="button" data-val="bank_transfer" onclick="selectWithdrawMethod(\'bank_transfer\',\'银行转账\')">银行转账</button>' +
    '<button class="ref-pay-dd-option" type="button" data-val="wechat" onclick="selectWithdrawMethod(\'wechat\',\'微信\')">微信</button>' +
    '<button class="ref-pay-dd-option" type="button" data-val="alipay" onclick="selectWithdrawMethod(\'alipay\',\'支付宝\')">支付宝</button>' +
    '</div></div></div>' +
    '<div class="ref-modal-row"><label>收款人</label><input type="text" id="withdrawHolder" placeholder="请输入收款人姓名" /></div>' +
    '<div class="ref-modal-row"><label>收款账号</label><input type="text" id="withdrawAccount" placeholder="请输入收款账号" /></div>' +
    '</div>' +
    '<div class="ref-modal-footer"><button class="member-secondary-btn ref-modal-cancel" type="button" onclick="closeWithdrawModal()">取消</button><button class="member-primary-btn ref-modal-confirm" type="button" onclick="submitWithdraw(Number((document.getElementById(\'referralBalanceCents\')||{}).value||0))">提交申请</button></div>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>';
}

function hydrateReferralAccount(container, acc) {
  if (!container) return;
  const shareUrl = normalizeInviteLink(acc.shareUrl, acc.referralCode);
  const code = acc.referralCode || '';

  const elEarned = container.querySelector('#refTotalEarned');
  const elBalance = container.querySelector('#refBalance');
  const elInvitees = container.querySelector('#refInvitees');
  const elSub = container.querySelector('#refBalanceSub');
  const elCode = container.querySelector('#refCodeText');
  const elCopyWrap = container.querySelector('#refCodeCopyWrap');
  const elLink = container.querySelector('#refLinkText');
  const elCodeVal = container.querySelector('#referralCodeVal');
  const elLinkVal = container.querySelector('#referralLinkVal');
  const elBalanceVal = container.querySelector('#referralBalanceCents');
  const elModalBalance = container.querySelector('#refModalBalanceText');
  const elCommission = container.querySelector('#refCommissionList');

  if (elEarned) elEarned.textContent = formatMoney(acc.totalEarned);
  if (elBalance) elBalance.textContent = formatMoney(acc.balance);
  if (elInvitees) elInvitees.textContent = String(Number(acc.totalInvitees || 0));
  if (elSub) {
    elSub.textContent =
      '待结算返利 ' +
      formatMoney(acc.pendingCommissions) +
      ' · 累计佣金笔数 ' +
      String(Number(acc.totalCommissions || 0));
  }
  if (elCode) elCode.textContent = code || '未生成';
  if (elCopyWrap) {
    elCopyWrap.innerHTML = code
      ? '<button class="ref-code-copy" type="button" onclick="copyReferralCode(\'' + code + '\')">复制邀请码</button>'
      : '';
  }
  if (elLink) elLink.textContent = shareUrl || '当前暂无可分享链接';
  if (elCodeVal) elCodeVal.value = code;
  if (elLinkVal) elLinkVal.value = shareUrl;
  if (elBalanceVal) elBalanceVal.value = String(Number(acc.balance || 0));
  if (elModalBalance) elModalBalance.textContent = formatMoney(acc.balance);
  if (elCommission) elCommission.innerHTML = renderCommissionList(acc.recentCommissions);
}

function hydrateReferralHistory(container, historyResult) {
  if (!container) return;
  const el = container.querySelector('#refWithdrawList');
  if (!el) return;
  const list = (historyResult && historyResult.list) || [];
  el.innerHTML = renderWithdrawHistory(list);
}

export async function loadReferral(container) {
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载邀请码...</div>';

  if (!hasAuthToken() || !getAuthSession()) {
    renderGuestState(container);
    return;
  }

  if (!hasReferralAccess()) {
    renderLiteReferral(container);
    return;
  }

  try {
    const session = getAuthSession() || {};
    const accCacheKey = 'referral-account:v1';
    const historyCacheKey = 'referral-withdraw-history:v1';
    const cachedAcc = getCache(accCacheKey);
    const cachedHistory = getCache(historyCacheKey);

    renderReferralMainShell(container, session);

    const accPromise = cachedAcc ? Promise.resolve(cachedAcc) : api('referral-account', {}, 0);
    const historyPromise = cachedHistory
      ? Promise.resolve(cachedHistory)
      : api('referral-withdraw-history', { page: 1, pageSize: 5 }, 0).catch(function () {
          return { list: [] };
        });

    const accResult = await accPromise;
    if (!cachedAcc) setCache(accCacheKey, accResult || {});
    hydrateReferralAccount(container, accResult || {});

    if (cachedHistory) {
      hydrateReferralHistory(container, cachedHistory || { list: [] });
      return;
    }

    const historyResult = await historyPromise;
    setCache(historyCacheKey, historyResult || { list: [] });
    hydrateReferralHistory(container, historyResult || { list: [] });
  } catch (e) {
    container.innerHTML =
      '' +
      '<div class="member-shell member-shell-referral">' +
      '<div class="member-page ref-container">' +
      '<div class="member-section-card member-empty-card">' +
      '<div class="member-empty-title">返利中心加载失败</div>' +
      '<div class="member-empty-text">' +
      (e && e.message ? e.message : '请稍后重试') +
      '</div>' +
      '<div class="member-cta-row">' +
      '<button class="member-primary-btn" type="button" onclick="window.navigateTo(\'home\')">返回首页</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
  }
}

window.copyReferralCode = function (code) {
  if (!code) {
    alert('当前暂无邀请码');
    return;
  }
  navigator.clipboard
    .writeText(code)
    .then(function () {
      alert('邀请码已复制');
    })
    .catch(function () {
      alert('复制失败，请手动记录');
    });
};

window.copyReferralLink = function (link) {
  if (!link) {
    alert('当前暂无可复制的邀请链接');
    return;
  }
  navigator.clipboard
    .writeText(link)
    .then(function () {
      alert('邀请链接已复制');
    })
    .catch(function () {
      alert('复制失败，请手动记录');
    });
};

window.shareReferral = function (code, link) {
  const finalLink = normalizeInviteLink(link, code);
  if (!finalLink) {
    alert('暂无邀请码');
    return;
  }
  if (navigator.share) {
    navigator
      .share({
        title: 'JC-ZJFA 竞彩足球专家推荐',
        text: '邀请你加入 JC-ZJFA，一起查看方案与 AI 推荐。',
        url: finalLink,
      })
      .catch(function () {});
  } else {
    window.copyReferralLink(finalLink);
  }
};

window.openWithdrawModal = function () {
  const el = document.getElementById('withdrawOverlay');
  if (el) el.style.display = 'flex';
};

window.toggleWithdrawMethodDD = function (event) {
  if (event && event.stopPropagation) event.stopPropagation();
  const dd = document.getElementById('withdrawMethodDD');
  if (dd) dd.classList.toggle('open');
};

window.selectWithdrawMethod = function (value, text) {
  const input = document.getElementById('withdrawMethod');
  const label = document.getElementById('withdrawMethodText');
  const dd = document.getElementById('withdrawMethodDD');
  if (input) input.value = value || 'bank_transfer';
  if (label) label.textContent = text || '银行转账';
  if (dd) {
    dd.querySelectorAll('.ref-pay-dd-option').forEach(function (btn) {
      btn.classList.toggle('selected', btn.getAttribute('data-val') === value);
    });
    dd.classList.remove('open');
  }
};

window.closeWithdrawModal = function (e) {
  const overlay = document.getElementById('withdrawOverlay');
  if (!overlay) return;
  if (e && e.target && e.target !== overlay) return;
  const dd = document.getElementById('withdrawMethodDD');
  if (dd) dd.classList.remove('open');
  overlay.style.display = 'none';
};

window.submitWithdraw = async function (balance) {
  const amount = Math.round(Number((document.getElementById('withdrawAmount') || {}).value || 0) * 100);
  if (!amount || amount < 1000) {
    alert('最低提现 ¥10');
    return;
  }
  if (amount > Number(balance || 0)) {
    alert('提现金额超过可提现余额');
    return;
  }

  const method = (document.getElementById('withdrawMethod') || {}).value || 'bank_transfer';
  const holder = ((document.getElementById('withdrawHolder') || {}).value || '').trim();
  const account = ((document.getElementById('withdrawAccount') || {}).value || '').trim();
  if (!holder || !account) {
    alert('请填写完整收款信息');
    return;
  }

  try {
    const res = await api(
      'referral-withdraw-submit',
      {
        amount: amount,
        paymentMethod: method,
        accountHolder: holder,
        paymentAccount: account,
      },
      0,
    );
    setCache('referral-account:v1', null);
    setCache('referral-withdraw-history:v1', null);
    alert((res && res.message) || '提现申请已提交');
    window.closeWithdrawModal();
    if (typeof window.switchTab === 'function') window.switchTab('referral');
  } catch (e) {
    const map = {
      MIN_WITHDRAWAL_NOT_MET: '未达到最低提现金额',
      INSUFFICIENT_BALANCE: '可提现余额不足',
      MISSING_PAYMENT_INFO: '请填写完整收款信息',
    };
    alert(map[e && e.message] || (e && e.message) || '提交失败');
  }
};

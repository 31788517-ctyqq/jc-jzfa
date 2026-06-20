import { loadCSS, ICONS } from '../vendor.js';
loadCSS('../../css/page-auth.css');

function getInviteContactConfig() {
  const cfg = window.__inviteContactConfig || {};
  const contacts =
    Array.isArray(cfg.contacts) && cfg.contacts.length
      ? cfg.contacts
      : [
          {
            label: '服务微信',
            value: 'ty102827',
            desc: '添加微信请备注“邀请码申请”。',
            copyable: true,
          },
          {
            label: '服务电话',
            value: '19924790073',
            desc: '电话咨询请说明注册手机号，便于快速处理。',
            copyable: true,
          },
          {
            label: '服务时间',
            value: '09:00 - 21:00',
            desc: '服务时间内优先处理邀请码与支付相关问题。',
            copyable: false,
          },
        ];

  const hasRealContact = contacts.some(function (item) {
    return item && item.value && item.value !== '待补充';
  });

  return {
    contacts: contacts,
    hasRealContact: hasRealContact,
    notice: cfg.notice || '当前注册采用邀请制，请先联系客服获取邀请码或专属邀请链接。',
    tip:
      cfg.tip ||
      (hasRealContact
        ? '联系客服后，将收到专属邀请链接或邀请码；返回注册页填写即可完成注册。'
        : '当前仓库未内置正式客服联系方式，建议上线前将微信/电话替换为真实客服信息。'),
  };
}

function renderContactItems(contacts) {
  return contacts
    .map(function (item, index) {
      const value = item && item.value ? item.value : '待补充';
      const copyBtn =
        item && item.copyable && value !== '待补充'
          ? '<button class="invite-contact-copy" type="button" onclick="copyInviteContact(' + index + ')">复制</button>'
          : '';
      const statusClass = value === '待补充' ? ' is-pending' : '';
      return (
        '<div class="invite-contact-item">' +
        '<div class="invite-contact-head">' +
        '<span class="invite-contact-label">' +
        (item.label || '联系方式') +
        '</span>' +
        '<span class="invite-contact-status' +
        statusClass +
        '">' +
        (value === '待补充' ? '待配置' : '可联系') +
        '</span>' +
        '</div>' +
        '<div class="invite-contact-value">' +
        value +
        '</div>' +
        '<div class="invite-contact-desc">' +
        (item.desc || '') +
        '</div>' +
        copyBtn +
        '</div>'
      );
    })
    .join('');
}

window.copyInviteContact = function (index) {
  const cfg = getInviteContactConfig();
  const item = cfg.contacts[index];
  if (!item || !item.value || item.value === '待补充') {
    alert('当前暂无可复制的客服信息');
    return;
  }
  navigator.clipboard
    .writeText(String(item.value))
    .then(function () {
      alert((item.label || '联系方式') + '已复制');
    })
    .catch(function () {
      alert('复制失败，请手动记录');
    });
};

export function loadContactInvite() {
  const root = document.getElementById('contactInviteContent');
  if (!root) return;

  const cfg = getInviteContactConfig();
  root.innerHTML =
    '<div class="auth-shell auth-shell-login auth-shell-contact">' +
    '<button class="auth-home-corner" type="button" onclick="switchTab(\'login\')" aria-label="返回登录" title="返回登录">' +
    ''+ICONS.arrowLeft+'' +
    '</button>' +
    '<div class="login-hero contact-invite-hero">' +
    '<div class="login-hero-copy">' +
    '<div class="login-hero-title">Need Invite?</div>' +
    '<div class="login-hero-subtitle">没有邀请码<br>先联系客服</div>' +
    '<div class="auth-invite-badge">邀请制注册入口</div>' +
    '</div>' +
    '<img class="login-eagle" src="/laoying11.png" alt="" loading="eager" decoding="async" />' +
    '</div>' +
    '<div class="auth-card auth-login-card auth-contact-card">' +
    '<div class="auth-note-card">' +
    cfg.notice +
    '</div>' +
    '<div class="contact-guide-list">' +
    '<div class="contact-guide-item"><span class="contact-guide-num">1</span><div><strong>联系客服</strong><span>获取邀请码或专属邀请链接</span></div></div>' +
    '<div class="contact-guide-item"><span class="contact-guide-num">2</span><div><strong>进入注册页</strong><span>邀请码会自动带入，也支持手动填写</span></div></div>' +
    '<div class="contact-guide-item"><span class="contact-guide-num">3</span><div><strong>完成注册并登录</strong><span>登录后将自动引导至套餐页</span></div></div>' +
    '</div>' +
    '<div class="invite-contact-stack">' +
    renderContactItems(cfg.contacts) +
    '</div>' +
    '<div class="auth-note-card auth-note-card-soft">' +
    cfg.tip +
    '</div>' +
    '<div class="auth-secondary-actions">' +
    '<button class="auth-secondary-btn" type="button" onclick="switchTab(\'register\')">我已有邀请码，去注册</button>' +
    '<button class="auth-secondary-btn is-ghost" type="button" onclick="switchTab(\'login\')">返回登录</button>' +
    '</div>' +
    '</div>' +
    '</div>';
}

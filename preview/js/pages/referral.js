// ==================== 返利中心页 ====================
import { api } from '../api.js';
import { getAuthSession } from '../auth-client.js';

export async function loadReferral(container, data) {
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  const session = getAuthSession();
  if (!session) {
    container.innerHTML = '<div class="empty-state"><p>请先登录</p><button onclick="window.navigateTo(\'login\')">去登录</button></div>';
    return;
  }

  const res = await api('referral-account');
  if (!res) {
    container.innerHTML = '<div class="empty-state">加载失败</div>';
    return;
  }

  const acc = res;
  const formatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 });

  let html = `<div class="ref-container">`;
  html += `<div class="ref-header"><h2>💰 返利中心</h2></div>`;

  // 账户余额卡片
  html += `<div class="ref-balance-card">
    <div class="ref-stat-row">
      <div class="ref-stat"><div class="ref-stat-val">${formatter.format(acc.totalEarned / 100)}</div><div class="ref-stat-lbl">累计收入</div></div>
      <div class="ref-stat"><div class="ref-stat-val">${formatter.format(acc.balance / 100)}</div><div class="ref-stat-lbl">可提现</div></div>
      <div class="ref-stat"><div class="ref-stat-val">${acc.totalInvitees}</div><div class="ref-stat-lbl">邀请人数</div></div>
    </div>
  </div>`;

  // 操作按钮
  html += `<div class="ref-btns">
    <button class="ref-btn ref-btn-withdraw" onclick="openWithdrawModal()">📋 申请提现</button>
    <button class="ref-btn ref-btn-share" onclick="shareReferral('${acc.referralCode || ''}')">📤 邀请好友</button>
  </div>`;

  // 邀请码
  html += `<div class="ref-code-card">
    <div class="ref-code-label">我的邀请码</div>
    <div class="ref-code-row">
      <span class="ref-code">${acc.referralCode || '未生成'}</span>
      ${acc.referralCode ? `<button class="ref-code-copy" onclick="copyReferralCode('${acc.referralCode}')">复制</button>` : ''}
    </div>
    ${acc.shareUrl ? `<div class="ref-link">${acc.shareUrl}</div>` : ''}
  </div>`;

  // 返利明细
  html += `<div class="ref-list-section"><h3>📋 返利明细</h3>`;
  if (!acc.recentCommissions || acc.recentCommissions.length === 0) {
    html += `<div class="empty-state" style="padding:12px">暂无返利记录<br/><small>邀请好友付费即可获得返利！</small></div>`;
  } else {
    acc.recentCommissions.forEach(c => {
      html += `<div class="ref-item">
        <div class="ref-item-row">
          <span class="ref-item-label">${c.plan || '套餐'} ${formatter.format(c.amount / 100)} → 返利 ${c.rate}% ${formatter.format(c.commission / 100)}</span>
          <span class="ref-item-status ref-status-${c.status}">${c.status === 'pending' ? '待结算' : c.status === 'settled' ? '已结算' : c.status}</span>
        </div>
        <div class="ref-item-meta">用户 ${c.invitee || '***'} · ${c.createdAt || ''}</div>
      </div>`;
    });
  }
  html += `</div>`;

  // 提现弹窗（初始隐藏）
  html += `
  <div class="ref-overlay" id="withdrawOverlay" style="display:none" onclick="closeWithdrawModal(event)">
    <div class="ref-modal" onclick="event.stopPropagation()">
      <div class="ref-modal-header"><h3>申请提现</h3><button onclick="closeWithdrawModal()">✕</button></div>
      <div class="ref-modal-body">
        <div class="ref-modal-row"><label>可提现金额</label><span>${formatter.format(acc.balance / 100)}</span></div>
        <div class="ref-modal-row"><label>提现金额</label><input type="number" id="withdrawAmount" placeholder="最低 ¥10" min="10" step="1" /></div>
        <div class="ref-modal-row"><label>收款方式</label>
          <select id="withdrawMethod">
            <option value="bank_transfer">银行转账</option>
            <option value="wechat">微信</option>
            <option value="alipay">支付宝</option>
          </select>
        </div>
        <div class="ref-modal-row"><label>收款人</label><input type="text" id="withdrawHolder" placeholder="姓名" /></div>
        <div class="ref-modal-row"><label>收款账号</label><input type="text" id="withdrawAccount" placeholder="账号" /></div>
      </div>
      <div class="ref-modal-footer">
        <button class="ref-modal-cancel" onclick="closeWithdrawModal()">取消</button>
        <button class="ref-modal-confirm" onclick="submitWithdraw(${acc.balance})">提交申请</button>
      </div>
    </div>
  </div>`;

  html += `</div>`;
  container.innerHTML = html;
}

// ========== 全局函数 ==========

window.copyReferralCode = function (code) {
  navigator.clipboard.writeText(code).then(() => alert('邀请码已复制')).catch(() => alert('复制失败'));
};

window.shareReferral = function (code) {
  if (!code) { alert('暂无邀请码'); return; }
  const link = `https://zj.100qiu.com/preview/#register?ref=${code}`;
  if (navigator.share) {
    navigator.share({ title: 'JC-ZJFA 竞彩足球专家推荐', text: '邀请你一起使用 JC-ZJFA！', url: link }).catch(() => {});
  } else {
    navigator.clipboard.writeText(link).then(() => alert('邀请链接已复制，发送给好友吧')).catch(() => alert('复制失败'));
  }
};

window.openWithdrawModal = function () {
  document.getElementById('withdrawOverlay').style.display = 'flex';
};

window.closeWithdrawModal = function (e) {
  if (e && e.target !== document.getElementById('withdrawOverlay')) return;
  document.getElementById('withdrawOverlay').style.display = 'none';
};

window.submitWithdraw = async function (balance) {
  const amount = parseInt(document.getElementById('withdrawAmount').value) * 100;
  if (!amount || amount < 1000) return alert('最低提现 ¥10');
  if (amount > balance) return alert('提现金额超过可提现余额');

  const method = document.getElementById('withdrawMethod').value;
  const holder = document.getElementById('withdrawHolder').value.trim();
  const account = document.getElementById('withdrawAccount').value.trim();
  if (!holder || !account) return alert('请填写收款信息');

  const res = await api('referral-withdraw-submit', {
    amount, paymentMethod: method, accountHolder: holder, paymentAccount: account,
  });

  if (res.code === 0) {
    alert(res.data.message || '提现申请已提交');
    window.closeWithdrawModal();
    location.reload();
  } else {
    alert(res.msg || '提交失败');
  }
};

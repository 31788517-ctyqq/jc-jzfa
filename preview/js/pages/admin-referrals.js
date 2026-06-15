// ==================== 管理员后台：返利管理 ====================
/* global loadRefList, processWithdraw */
import { api } from '../vendor.js';

const STATUS_CN = {
  pending: '待结算',
  settled: '已结算',
  cancelled: '已取消',
  submitted: '已提交',
  completed: '已完成',
  rejected: '已驳回',
  paid: '已打款',
};

const METHOD_CN = {
  bank_card: '银行卡',
  wechat: '微信',
};

export async function loadAdminReferrals(container, data) {
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  let html = `<div class="admin-container">
    <div class="admin-header"><h2>返利管理</h2></div>

    <!-- 概览卡片 -->
    <div class="admin-stats-row" id="refStats">
      <div class="admin-stat-card"><div class="admin-stat-val">-</div><div class="admin-stat-lbl">总返利笔数</div></div>
      <div class="admin-stat-card"><div class="admin-stat-val">-</div><div class="admin-stat-lbl">待提现</div></div>
    </div>

    <!-- 返利记录 -->
    <div class="admin-section">
      <h3>返利记录</h3>
      <div class="admin-filter-row">
        <select id="refStatusFilter" onchange="loadRefList()">
          <option value="">全部</option>
          <option value="pending">待结算</option>
          <option value="settled">已结算</option>
          <option value="cancelled">已取消</option>
        </select>
        <input id="refSearch" placeholder="搜索邀请人" onchange="loadRefList()" style="width:140px" />
      </div>
      <div id="refList">加载中...</div>
    </div>

    <!-- 提现审核 -->
    <div class="admin-section">
      <h3>提现审核</h3>
      <div id="withdrawList">加载中...</div>
    </div>
  </div>`;

  container.innerHTML = html;
  loadRefList();
}

window.loadRefList = async function () {
  const status = document.getElementById('refStatusFilter')?.value || '';
  const inviter = document.getElementById('refSearch')?.value || '';

  const res = await api('/api', { action: 'admin-referral-commissions', token: true, status, inviter, pageSize: 20 });
  const wRes = await api('/api', {
    action: 'admin-referral-withdraw-list',
    token: true,
    status: 'submitted',
    pageSize: 20,
  });

  // 统计
  const stats = await api('/api', { action: 'admin-referral-commissions', token: true, pageSize: 1 });
  document.querySelectorAll('#refStats .admin-stat-val')[0].textContent = stats.data?.total || 0;

  const pendings = await api('/api', {
    action: 'admin-referral-withdraw-list',
    token: true,
    status: 'submitted',
    pageSize: 1,
  });
  document.querySelectorAll('#refStats .admin-stat-val')[1].textContent = pendings.data?.total || 0;

  // 返利列表
  const list = res.data?.list || [];
  if (list.length === 0) {
    document.getElementById('refList').innerHTML = '<p style="color:#999">暂无数据</p>';
  } else {
    let rows = list
      .map(
        (r) => `<tr>
      <td>${r.inviter_name || '--'}</td><td>${r.invitee_name || '--'}</td>
      <td>¥${((r.payment_amount || 0) / 100).toFixed(2)}</td>
      <td>${r.commission_rate}%</td>
      <td>¥${((r.commission_amount || 0) / 100).toFixed(2)}</td>
      <td><span class="admin-status admin-status-${r.status}">${STATUS_CN[r.status] || r.status || '--'}</span></td>
      <td>${r.created_at || ''}</td>
    </tr>`,
      )
      .join('');
    document.getElementById('refList').innerHTML = `<table class="admin-table"><thead><tr>
        <th>邀请人</th><th>被邀请人</th><th>实付</th><th>比例</th><th>返利</th><th>状态</th><th>时间</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }

  // 提现列表
  const wList = wRes.data?.list || [];
  if (wList.length === 0) {
    document.getElementById('withdrawList').innerHTML = '<p style="color:#999">暂无待审核提现</p>';
  } else {
    let rows = wList
      .map(
        (w) => `<tr>
      <td>${w.username || '--'}(用户ID:${w.user_id})</td>
      <td>¥${((w.amount || 0) / 100).toFixed(2)}</td>
      <td>${METHOD_CN[w.payment_method] || w.payment_method || '--'}</td>
      <td>${w.account_holder || ''}</td>
      <td>${(w.payment_account || '').slice(-4)}</td>
      <td><span class="admin-status admin-status-${w.status}">${STATUS_CN[w.status] || w.status || '--'}</span></td>
      <td>
        <button onclick="processWithdraw(${w.id}, 'completed')" class="admin-btn-sm admin-btn-ok">✓ 打款</button>
        <button onclick="processWithdraw(${w.id}, 'rejected')" class="admin-btn-sm admin-btn-no">✕ 驳回</button>
      </td>
    </tr>`,
      )
      .join('');
    document.getElementById('withdrawList').innerHTML = `<table class="admin-table"><thead><tr>
        <th>用户</th><th>金额</th><th>方式</th><th>收款人</th><th>尾号</th><th>状态</th><th>操作</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }
};

window.processWithdraw = async function (id, newStatus) {
  const remark = newStatus === 'rejected' ? prompt('驳回原因:') : '已打款';
  const res = await api('/api', {
    action: 'admin-referral-withdraw-process',
    token: true,
    withdrawalId: id,
    newStatus,
    remark,
  });
  if (res.code === 0) {
    loadRefList();
  } else {
    alert(res.msg || '操作失败');
  }
};

// ==================== 管理员后台：支付与订阅 ====================
/* global loadAdminSubPage, grantSubscription */
import { api } from '../vendor.js?v=202606152148';

const STATUS_CN = {
  active: '活跃',
  expiring_soon: '即将到期',
  expired: '已过期',
  pending: '待处理',
  submitted: '已提交',
  settled: '已结算',
  rejected: '已驳回',
  paid: '已打款',
  completed: '已完成',
};

const PLAN_CN = {
  monthly: '月度套餐',
  quarterly: '季度套餐',
  yearly: '年度套餐',
};

const SOURCE_CN = {
  manual: '手动开通',
  system: '系统发放',
  wechat_pay: '微信支付',
};

export async function loadAdminPayments(container, data) {
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

  let html = `<div class="admin-container">
    <div class="admin-header"><h2>支付与订阅管理</h2></div>

    <!-- 概览卡片 -->
    <div class="admin-stats-row" id="adminPayStats">
      <div class="admin-stat-card"><div class="admin-stat-val">-</div><div class="admin-stat-lbl">总订阅</div></div>
      <div class="admin-stat-card"><div class="admin-stat-val">-</div><div class="admin-stat-lbl">有效订阅</div></div>
      <div class="admin-stat-card"><div class="admin-stat-val">-</div><div class="admin-stat-lbl">待处理订单</div></div>
    </div>

    <!-- 订阅列表 -->
    <div class="admin-section">
      <h3>订阅列表</h3>
      <div class="admin-filter-row">
        <select id="subStatusFilter" onchange="loadAdminSubPage()">
          <option value="">全部</option><option value="active">活跃</option>
          <option value="expiring_soon">即将到期</option><option value="expired">已过期</option>
        </select>
      </div>
      <div id="adminSubList">加载中...</div>
    </div>

    <!-- 手动赠送 -->
    <div class="admin-section">
      <h3>手动开通/赠送订阅</h3>
      <div class="admin-form-row">
        <input type="number" id="grantUserId" placeholder="用户ID" min="1" style="width:100px" />
        <select id="grantPlan">
          <option value="monthly">月度 ¥98</option>
          <option value="quarterly">季度 ¥258</option>
          <option value="yearly">年度 ¥888</option>
        </select>
        <button onclick="grantSubscription()">✓ 开通</button>
      </div>
      <div id="grantMsg" style="font-size:12px;color:#059669;margin-top:8px"></div>
    </div>
  </div>`;

  container.innerHTML = html;
  loadAdminSubPage();
}

window.loadAdminSubPage = async function () {
  const status = document.getElementById('subStatusFilter')?.value || '';
  const res = await api('/api', { action: 'admin-subscription-list', token: true, status, pageSize: 30 });
  if (res.code !== 0) {
    document.getElementById('adminSubList').innerHTML = '<p>加载失败</p>';
    return;
  }

  // 更新统计
  const totalCount = res.data.total;
  const activeRes = await api('/api', {
    action: 'admin-subscription-list',
    token: true,
    status: 'active',
    pageSize: 1,
  });
  document.querySelectorAll('.admin-stat-val')[0].textContent = totalCount || 0;
  document.querySelectorAll('.admin-stat-val')[1].textContent = activeRes.data?.total || 0;

  const list = res.data.list || [];
  if (list.length === 0) {
    document.getElementById('adminSubList').innerHTML = '<p style="color:#999">暂无数据</p>';
    return;
  }

  let rows = list
    .map(
      (s) => `<tr>
    <td>${s.id}</td><td>${s.username || '--'}</td><td>${s.plan_name || PLAN_CN[s.plan_code] || s.plan_code || '--'}</td>
    <td><span class="admin-status admin-status-${s.status}">${STATUS_CN[s.status] || s.status || '--'}</span></td>
    <td>${s.start_date}</td><td>${s.end_date}</td>
    <td>¥${((s.amount || 0) / 100).toFixed(2)}</td>
    <td>${SOURCE_CN[s.source] || s.source || '--'}</td>
  </tr>`,
    )
    .join('');

  document.getElementById('adminSubList').innerHTML = `<table class="admin-table"><thead><tr>
      <th>用户ID</th><th>用户</th><th>套餐</th><th>状态</th>
      <th>开始</th><th>到期</th><th>金额</th><th>来源</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
};

window.grantSubscription = async function () {
  const userId = parseInt(document.getElementById('grantUserId').value);
  const planCode = document.getElementById('grantPlan').value;
  if (!userId) return alert('请输入用户ID');
  const res = await api('/api', {
    action: 'admin-grant-subscription',
    token: true,
    user_id: userId,
    plan_code: planCode,
  });
  const el = document.getElementById('grantMsg');
  if (res.code === 0) {
    el.textContent = `已开通，到期 ${res.data.end_date}`;
    loadAdminSubPage();
  } else {
    el.textContent = res.msg || '开通失败';
    el.style.color = '#dc2626';
  }
};

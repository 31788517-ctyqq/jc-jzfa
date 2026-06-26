/**
 * 初始化角色权限: 给 super_admin 和 ops_admin 分配所有权限到 role_permissions 表
 * 这样 buildSessionInfoByUserId JOIN 查询可以返回完整 roles+permissions
 */
var d = require('../server/database');
var a = d.getAuthAdapter();
if (!a) { console.log('NO AUTH ADAPTER'); process.exit(1); }
var now = new Date().toISOString();

// 1. 获取所有权限
var allPerms = a.execAll('SELECT id, code FROM permissions');
console.log('Total permissions:', allPerms.length);

// 2. 获取 super_admin 和 ops_admin 角色
var superAdmin = a.execOne("SELECT * FROM roles WHERE code='super_admin'");
var opsAdmin = a.execOne("SELECT * FROM roles WHERE code='ops_admin'");

// 3. 清除现有 role_permissions 并重新分配
a.execRun('DELETE FROM role_permissions WHERE role_id IN (?, ?)', superAdmin.id, opsAdmin.id);

var added = { super_admin: 0, ops_admin: 0 };
var opsPerms = [
  'auth:login','auth:logout','auth:change_password',
  'user:view',
  'role:view',
  'plan:view','plan:save','plan:delete','plan:share','plan:confirm',
  'backtest:view',
  'dashboard:model_view','dashboard:data_health_view','dashboard:experiment_compare',
  'gs:view',
  'insight:batch_consensus','insight:pk_compare',
  'ops:sync_match_date','ops:sync_gov_schedule','ops:backfill','ops:auto_heal',
  'ops:refill_consensus','ops:error_log_view','ops:refresh_predictions',
];

allPerms.forEach(function(p) {
  // super_admin: 所有权限
  a.execRun('INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES (?, ?, ?)',
    superAdmin.id, p.id, now);
  added.super_admin++;

  // ops_admin: 仅分配非管理权限
  if (opsPerms.indexOf(p.code) >= 0) {
    a.execRun('INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES (?, ?, ?)',
      opsAdmin.id, p.id, now);
    added.ops_admin++;
  }
});

console.log('super_admin permissions:', added.super_admin);
console.log('ops_admin permissions:', added.ops_admin);

// 检查
var check = a.execAll("SELECT r.code AS role, rp.permission_id, p.code " +
  "FROM role_permissions rp JOIN roles r ON rp.role_id=r.id JOIN permissions p ON rp.permission_id=p.id " +
  "WHERE r.code IN ('super_admin','ops_admin') AND p.code LIKE '%dashboard%'");
console.log('\nDashboard perms after fix:');
check.forEach(function(x) { console.log(x.role, '->', x.code); });

// 清除所有 auth_sessions 强制重新登录
a.execRun('DELETE FROM auth_sessions');
console.log('\nAll sessions cleared. User must re-login.');

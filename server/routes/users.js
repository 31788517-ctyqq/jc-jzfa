/**
 * server/routes/users.js
 * Phase 3: 用户管理路由 — 从 index.js 提取
 *
 * Actions:
 *   user-list / user-create / user-update-status
 *   role-list / role-permission-update / user-role-update
 */

const authService = require('../auth-service');

function handleUsers(action, req, res, data) {
  switch (action) {
    case 'user-list':
      return res.json({ code: 1, data: authService.listUsers() });

    case 'user-create': {
      const username = String(data.username || '').trim();
      const roleCode = String(data.roleCode || '').trim() || 'viewer';
      const result = authService.createUser(username, roleCode);
      if (!result.ok) return res.json({ code: 0, msg: result.msg || '创建账号失败' });
      return res.json({ code: 1, data: result });
    }

    case 'user-update-status': {
      const userId = Number(data.userId || 0);
      if (!userId) return res.json({ code: 0, msg: '缺少 userId' });
      if (String(data.op || '').trim() === 'unlock') {
        return res.json({ code: 1, data: authService.unlockUser(userId) });
      }
      const status = String(data.status || '').trim();
      const result = authService.updateUserStatus(userId, status);
      if (!result.ok) return res.json({ code: 0, msg: result.msg || '更新失败' });
      return res.json({ code: 1, data: result });
    }

    case 'role-list':
      return res.json({ code: 1, data: authService.listRolesWithPermissions() });

    case 'role-permission-update': {
      const roleCode = String(data.roleCode || '').trim();
      const permissionCodes = Array.isArray(data.permissionCodes) ? data.permissionCodes : [];
      const result = authService.updateRolePermissions(roleCode, permissionCodes);
      if (!result.ok) return res.json({ code: 0, msg: result.msg || '更新角色权限失败' });
      return res.json({ code: 1, data: result });
    }

    case 'user-role-update': {
      const userId = Number(data.userId || 0);
      const roleCodes = Array.isArray(data.roleCodes) ? data.roleCodes : [];
      if (!userId) return res.json({ code: 0, msg: '缺少 userId' });
      const result = authService.updateUserRoles(userId, roleCodes);
      if (!result.ok) return res.json({ code: 0, msg: result.msg || '更新用户角色失败' });
      return res.json({ code: 1, data: result });
    }

    default:
      return false;
  }
}

module.exports = { handleUsers };

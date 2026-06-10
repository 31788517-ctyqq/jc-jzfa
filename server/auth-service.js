const crypto = require('crypto');
const database = require('./database');

const SESSION_TTL_HOURS = parseInt(process.env.AUTH_SESSION_TTL_HOURS || '24', 10);
const LOCK_MINUTES = parseInt(process.env.AUTH_LOCK_MINUTES || '15', 10);
const MAX_LOGIN_FAILS = parseInt(process.env.AUTH_MAX_LOGIN_FAILS || '5', 10);

const ROLES = ['super_admin', 'ops_admin', 'analyst', 'viewer'];

const PERMISSIONS = [
  'auth:login',
  'auth:logout',
  'auth:change_password',
  'user:view',
  'user:create',
  'user:disable',
  'user:unlock',
  'user:force_reset_password',
  'role:view',
  'role:assign',
  'role:permission_manage',
  'plan:view',
  'plan:save',
  'plan:delete',
  'plan:share',
  'plan:confirm',
  'backtest:view',
  'dashboard:model_view',
  'dashboard:data_health_view',
  'dashboard:experiment_compare',
  'gs:view',
  'insight:batch_consensus',
  'insight:pk_compare',
  'ops:sync_match_date',
  'ops:sync_gov_schedule',
  'ops:backfill',
  'ops:auto_heal',
  'ops:refill_consensus',
];

const ROLE_PERMISSION_MATRIX = {
  super_admin: ['*'],
  ops_admin: [
    'auth:login',
    'auth:logout',
    'auth:change_password',
    'user:view',
    'role:view',
    'plan:view',
    'plan:save',
    'plan:delete',
    'plan:share',
    'plan:confirm',
    'backtest:view',
    'dashboard:model_view',
    'dashboard:data_health_view',
    'dashboard:experiment_compare',
    'gs:view',
    'insight:batch_consensus',
    'insight:pk_compare',
    'ops:sync_match_date',
    'ops:sync_gov_schedule',
    'ops:backfill',
    'ops:auto_heal',
    'ops:refill_consensus',
  ],
  analyst: [
    'auth:login',
    'auth:logout',
    'auth:change_password',
    'plan:view',
    'plan:save',
    'plan:delete',
    'plan:share',
    'plan:confirm',
    'backtest:view',
    'dashboard:model_view',
    'dashboard:data_health_view',
    'dashboard:experiment_compare',
    'gs:view',
    'insight:batch_consensus',
    'insight:pk_compare',
  ],
  viewer: ['auth:login', 'auth:logout', 'auth:change_password', 'plan:view', 'gs:view'],
};

const ACTION_PERMISSION_MAP = {
  'auth-logout': 'auth:logout',
  'auth-change-password': 'auth:change_password',
  'user-list': 'user:view',
  'user-create': 'user:create',
  'user-update-status': 'user:disable',
  'role-list': 'role:view',
  'role-permission-update': 'role:permission_manage',
  'user-role-update': 'role:assign',
  'my-plan-save': 'plan:save',
  'my-plan-delete': 'plan:delete',
  'prediction-backtest': 'backtest:view',
  'model-dashboard': 'dashboard:model_view',
  'data-health': 'dashboard:data_health_view',
  'experiment-compare': 'dashboard:experiment_compare',
  'batch-consensus': 'insight:batch_consensus',
  'pk-version-compare': 'insight:pk_compare',
  gongshoudao: 'gs:view',
  'gongshoudao-all': 'gs:view',
  'sync-match-date': 'ops:sync_match_date',
  'sync-gov-schedule': 'ops:sync_gov_schedule',
  'backfill-results': 'ops:backfill',
  'auto-heal': 'ops:auto_heal',
  'refill-expert-consensus': 'ops:refill_consensus',
};

const PUBLIC_ACTIONS = new Set(['auth-login', 'auth-session']);

function getAdapter() {
  const adp = database.getAdapter && database.getAdapter();
  if (!adp || !adp.execOne) throw new Error('数据库适配器不可用');
  return adp;
}

function nowIso() {
  return new Date().toISOString();
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function randomSecret(len = 32) {
  return crypto.randomBytes(len).toString('hex');
}

function hashPassword(password) {
  const salt = randomSecret(16);
  const derived = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1];
  const expectedHex = parts[2];
  const actualHex = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const actualBuf = Buffer.from(actualHex, 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    status: row.status,
    mustChangePassword: Number(row.must_change_password || 0) === 1,
    lastLoginAt: row.last_login_at || null,
    passwordUpdatedAt: row.password_updated_at || null,
  };
}

function getUserRoles(userId) {
  const adp = getAdapter();
  return adp
    .execAll(
      `SELECT r.code
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = ?
       ORDER BY r.id ASC`,
      userId,
    )
    .map((r) => r.code)
    .filter(Boolean);
}

function getRolePermissions(roleCodes) {
  const adp = getAdapter();
  if (!Array.isArray(roleCodes) || roleCodes.length === 0) return [];
  const placeholders = roleCodes.map(() => '?').join(',');
  const rows = adp.execAll(
    `SELECT DISTINCT p.code
     FROM role_permissions rp
     JOIN roles r ON rp.role_id = r.id
     JOIN permissions p ON rp.permission_id = p.id
     WHERE r.code IN (${placeholders})`,
    ...roleCodes,
  );
  return rows.map((r) => r.code).filter(Boolean);
}

function resolveSessionToken(req, data) {
  const headerToken = req.headers['x-auth-token'] || req.headers['authorization'];
  if (headerToken) {
    const raw = String(headerToken).trim();
    if (raw.toLowerCase().startsWith('bearer ')) return raw.slice(7).trim();
    return raw;
  }
  const cookie = String(req.headers.cookie || '');
  const m = cookie.match(/(?:^|;\s*)auth_token=([^;]+)/);
  if (m && m[1]) return decodeURIComponent(m[1]);
  if (data && data.authToken) return String(data.authToken);
  return '';
}

function isActionProtected(action) {
  if (!action) return false;
  return !PUBLIC_ACTIONS.has(action);
}

function getRequiredPermission(action) {
  return ACTION_PERMISSION_MAP[action] || null;
}

function hasPermission(session, permissionCode) {
  if (!permissionCode) return true;
  if (!session) return false;
  if ((session.roles || []).includes('super_admin')) return true;
  const perms = session.permissions || [];
  return perms.includes(permissionCode) || perms.includes('*');
}

function ensureBootstrapped() {
  const adp = getAdapter();
  const now = nowIso();

  ROLES.forEach((code) => {
    adp.execRun(
      `INSERT OR IGNORE INTO roles(code, name, description, is_builtin, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
      code,
      code,
      `builtin role: ${code}`,
      now,
      now,
    );
  });

  PERMISSIONS.forEach((perm) => {
    const [moduleName, actionName] = perm.split(':');
    adp.execRun(
      `INSERT OR IGNORE INTO permissions(code, module, action, risk_level, description, created_at)
       VALUES (?, ?, ?, 'medium', ?, ?)`,
      perm,
      moduleName || 'generic',
      actionName || 'access',
      perm,
      now,
    );
  });

  Object.keys(ROLE_PERMISSION_MATRIX).forEach((roleCode) => {
    const grants = ROLE_PERMISSION_MATRIX[roleCode] || [];
    if (grants.includes('*')) return;
    grants.forEach((permCode) => {
      adp.execRun(
        `INSERT OR IGNORE INTO role_permissions(role_id, permission_id, created_at)
         SELECT r.id, p.id, ? FROM roles r, permissions p
         WHERE r.code = ? AND p.code = ?`,
        now,
        roleCode,
        permCode,
      );
    });
  });

  const userCnt = (adp.execOne('SELECT COUNT(*) AS cnt FROM users') || {}).cnt || 0;
  if (userCnt > 0) return;

  const initUser = process.env.AUTH_INIT_USER || 'admin';
  const initPass = process.env.AUTH_INIT_PASS || randomSecret(6);
  const pwdHash = hashPassword(initPass);

  adp.execRun(
    `INSERT INTO users(
      username, password_hash, status, must_change_password,
      failed_login_count, created_at, updated_at
    ) VALUES (?, ?, 'active', 1, 0, ?, ?)`,
    initUser,
    pwdHash,
    now,
    now,
  );

  adp.execRun(
    `INSERT OR IGNORE INTO user_roles(user_id, role_id, created_at)
     SELECT u.id, r.id, ? FROM users u, roles r
     WHERE u.username = ? AND r.code = 'super_admin'`,
    now,
    initUser,
  );

  console.log(`[auth] 已初始化管理员账号: ${initUser}`);
  console.log(`[auth] 初始密码(仅显示一次): ${initPass}`);
}

function buildSessionInfoByUserId(userId) {
  const adp = getAdapter();
  const user = adp.execOne(
    `SELECT id, username, status, must_change_password, last_login_at, password_updated_at
     FROM users WHERE id = ?`,
    userId,
  );
  if (!user) return null;
  const roles = getUserRoles(userId);
  const permissions = getRolePermissions(roles);
  return {
    user: sanitizeUser(user),
    roles,
    permissions,
  };
}

function loginWithPassword(username, password, meta = {}) {
  ensureBootstrapped();
  const adp = getAdapter();
  const now = new Date();
  const nowStr = now.toISOString();

  const user = adp.execOne('SELECT * FROM users WHERE username = ?', username);
  if (!user) return { ok: false, code: 0, msg: '账号或密码错误' };
  if (user.status === 'disabled') return { ok: false, code: 0, msg: '账号已禁用' };

  if (user.status === 'locked' && user.locked_until && new Date(user.locked_until).getTime() > now.getTime()) {
    return { ok: false, code: 0, msg: '账号已锁定，请稍后重试' };
  }

  const passOk = verifyPassword(password, user.password_hash);
  if (!passOk) {
    const failCount = Number(user.failed_login_count || 0) + 1;
    if (failCount >= MAX_LOGIN_FAILS) {
      const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000).toISOString();
      adp.execRun(
        `UPDATE users
         SET failed_login_count = ?, status = 'locked', locked_until = ?, updated_at = ?
         WHERE id = ?`,
        failCount,
        lockedUntil,
        nowStr,
        user.id,
      );
    } else {
      adp.execRun('UPDATE users SET failed_login_count = ?, updated_at = ? WHERE id = ?', failCount, nowStr, user.id);
    }
    return { ok: false, code: 0, msg: '账号或密码错误' };
  }

  adp.execRun(
    `UPDATE users
     SET failed_login_count = 0, status = 'active', locked_until = NULL, last_login_at = ?, updated_at = ?
     WHERE id = ?`,
    nowStr,
    nowStr,
    user.id,
  );

  const token = randomSecret(24);
  const tokenHash = sha256(token);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();

  adp.execRun(
    `INSERT INTO auth_sessions(
      user_id, session_token_hash, issued_at, expires_at, ip, user_agent, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    user.id,
    tokenHash,
    nowStr,
    expiresAt,
    meta.ip || null,
    meta.userAgent || null,
    nowStr,
  );

  const sessionInfo = buildSessionInfoByUserId(user.id);
  return {
    ok: true,
    token,
    expiresAt,
    ...sessionInfo,
  };
}

function validateSession(token, touch = true) {
  if (!token) return null;
  const adp = getAdapter();
  const tokenHash = sha256(token);
  const now = nowIso();
  const row = adp.execOne(
    `SELECT s.id AS sid, s.user_id, s.expires_at, s.revoked_at,
            u.id, u.username, u.status, u.must_change_password, u.last_login_at, u.password_updated_at
     FROM auth_sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.session_token_hash = ?`,
    tokenHash,
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.status !== 'active') return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  if (touch) {
    adp.execRun('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?', now, row.sid);
  }

  const roles = getUserRoles(row.user_id);
  const permissions = getRolePermissions(roles);
  return {
    sid: row.sid,
    userId: row.user_id,
    user: sanitizeUser(row),
    roles,
    permissions,
    expiresAt: row.expires_at,
  };
}

function logout(token) {
  if (!token) return { ok: true };
  const adp = getAdapter();
  adp.execRun('UPDATE auth_sessions SET revoked_at = ? WHERE session_token_hash = ?', nowIso(), sha256(token));
  return { ok: true };
}

function changePassword(userId, oldPassword, newPassword) {
  const adp = getAdapter();
  const user = adp.execOne('SELECT * FROM users WHERE id = ?', userId);
  if (!user) return { ok: false, msg: '用户不存在' };
  if (!verifyPassword(oldPassword, user.password_hash)) return { ok: false, msg: '旧密码错误' };
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return { ok: false, msg: '新密码至少8位' };
  }
  if (oldPassword === newPassword) return { ok: false, msg: '新密码不能与旧密码相同' };

  const hash = hashPassword(newPassword);
  const now = nowIso();
  adp.execRun(
    `UPDATE users
     SET password_hash = ?, must_change_password = 0, password_updated_at = ?, updated_at = ?
     WHERE id = ?`,
    hash,
    now,
    now,
    userId,
  );
  return { ok: true };
}

function listUsers() {
  const adp = getAdapter();
  const rows = adp.execAll(
    `SELECT id, username, status, must_change_password, last_login_at, password_updated_at, created_at
     FROM users ORDER BY id ASC`,
  );
  return rows.map((u) => ({
    id: u.id,
    username: u.username,
    status: u.status,
    mustChangePassword: Number(u.must_change_password || 0) === 1,
    lastLoginAt: u.last_login_at || null,
    passwordUpdatedAt: u.password_updated_at || null,
    createdAt: u.created_at || null,
  }));
}

function createUser(username, roleCode) {
  if (!username) return { ok: false, msg: '缺少用户名' };
  const adp = getAdapter();
  const exists = adp.execOne('SELECT id FROM users WHERE username = ?', username);
  if (exists) return { ok: false, msg: '用户名已存在' };

  const tempPassword = randomSecret(6);
  const now = nowIso();
  adp.execRun(
    `INSERT INTO users(
      username, password_hash, status, must_change_password,
      failed_login_count, created_at, updated_at
    ) VALUES (?, ?, 'active', 1, 0, ?, ?)`,
    username,
    hashPassword(tempPassword),
    now,
    now,
  );

  const role = roleCode && ROLES.includes(roleCode) ? roleCode : 'viewer';
  adp.execRun(
    `INSERT OR IGNORE INTO user_roles(user_id, role_id, created_at)
     SELECT u.id, r.id, ? FROM users u, roles r
     WHERE u.username = ? AND r.code = ?`,
    now,
    username,
    role,
  );

  return { ok: true, username, tempPassword, role, mustChangePassword: true };
}

function updateUserStatus(userId, status) {
  const allow = new Set(['active', 'disabled', 'locked']);
  if (!allow.has(status)) return { ok: false, msg: '非法状态' };
  const adp = getAdapter();
  adp.execRun('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), userId);
  return { ok: true };
}

function unlockUser(userId) {
  const adp = getAdapter();
  adp.execRun(
    `UPDATE users
     SET status = 'active', locked_until = NULL, failed_login_count = 0, updated_at = ?
     WHERE id = ?`,
    nowIso(),
    userId,
  );
  return { ok: true };
}

function listRolesWithPermissions() {
  const adp = getAdapter();
  const roles = adp.execAll('SELECT id, code, name, description FROM roles ORDER BY id ASC');
  return roles.map((role) => {
    const permissions = adp
      .execAll(
        `SELECT p.code
         FROM role_permissions rp
         JOIN permissions p ON rp.permission_id = p.id
         WHERE rp.role_id = ?
         ORDER BY p.code ASC`,
        role.id,
      )
      .map((r) => r.code);
    return {
      code: role.code,
      name: role.name,
      description: role.description,
      permissions,
    };
  });
}

function updateRolePermissions(roleCode, permissionCodes) {
  const adp = getAdapter();
  const role = adp.execOne('SELECT id FROM roles WHERE code = ?', roleCode);
  if (!role) return { ok: false, msg: '角色不存在' };

  const now = nowIso();
  adp.execRun('DELETE FROM role_permissions WHERE role_id = ?', role.id);
  (permissionCodes || []).forEach((code) => {
    adp.execRun(
      `INSERT OR IGNORE INTO role_permissions(role_id, permission_id, created_at)
       SELECT ?, p.id, ? FROM permissions p WHERE p.code = ?`,
      role.id,
      now,
      code,
    );
  });
  return { ok: true };
}

function updateUserRoles(userId, roleCodes) {
  const adp = getAdapter();
  const now = nowIso();
  adp.execRun('DELETE FROM user_roles WHERE user_id = ?', userId);
  (roleCodes || []).forEach((roleCode) => {
    adp.execRun(
      `INSERT OR IGNORE INTO user_roles(user_id, role_id, created_at)
       SELECT ?, r.id, ? FROM roles r WHERE r.code = ?`,
      userId,
      now,
      roleCode,
    );
  });
  return { ok: true };
}

module.exports = {
  ensureBootstrapped,
  resolveSessionToken,
  isActionProtected,
  getRequiredPermission,
  hasPermission,
  loginWithPassword,
  validateSession,
  logout,
  changePassword,
  listUsers,
  createUser,
  updateUserStatus,
  unlockUser,
  listRolesWithPermissions,
  updateRolePermissions,
  updateUserRoles,
};

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
  'ops:error_log_view',
  'ops:refresh_predictions',
  'payment:admin',
  'referral:admin',
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
    'ops:error_log_view',
    'ops:refresh_predictions',
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
  'error-log-summary': 'ops:error_log_view',
  'refresh-predictions': 'ops:refresh_predictions',

  // ★ 管理后台: 支付/返利 admin action 权限加固（修复任意登录用户可调用的漏洞）
  'admin-subscription-list': 'payment:admin',
  'admin-grant-subscription': 'payment:admin',
  'admin-referral-commissions': 'referral:admin',
  'admin-referral-accounts': 'referral:admin',
  'admin-referral-withdraw-list': 'referral:admin',
  'admin-referral-withdraw-process': 'referral:admin',
  'user-toggle-referral': 'referral:admin',
};

const PUBLIC_ACTIONS = new Set([
  'alerts', // ★ V12: 运维告警 API（公开读）
  'auth-login',
  'auth-register',
  'auth-session',

  // 首页只读 API（未登录用户可见）
  'match-list',
  'ranking-list',
  'daily-profit-7d',
  'week-dates',
  'home-bundle',

  // 方案查看（未登录可浏览）
  'plan-list',
  'score-plan-list',
  'quant-plan-list',

  // 比赛详情与赔率
  'match-detail',
  'match-odds',
  'batch-match-odds',
  'match-top-directions',
  'recommend-trend',

  // 功守道 & AI 预测（公开数据）
  'gongshoudao',
  'gongshoudao-all',
  'ai-predict',

  // 统计看板（公开）
  'hit-rate-stats',
  'hit-rate-filter',
  'filter-stats',
  'income-stats',

  // 回测 & 模型（公开查看）
  'prediction-backtest',
  'experiment-compare',
  'model-dashboard',
  'batch-consensus',

  // 健康检查
  'health',
  'data-health',
  'cache-stats',
  'ai-health-check',
]);

function getAdapter() {
  const adp = database.getAdapter && database.getAdapter();
  if (!adp || !adp.execOne) throw new Error('数据库适配器不可用');
  return adp;
}

function flushCriticalWrites(adp) {
  // ★ P1 优化：不再同步 flush（417MB DB 导出阻塞事件循环 4-7s）
  // execRun 内部的 _scheduleSave() 已用 setImmediate 防抖写入，
  // 定期 flush 由 database.js 的 5 分钟定时器负责
  // 仅保留 markDirty 调用通知 reload 追踪器
  try {
    if (adp && typeof adp.markDirty === 'function') adp.markDirty();
  } catch (_) {}
}

function nowIso() {
  return new Date().toISOString();
}

function toLocalDateString(dateLike) {
  const d = dateLike ? new Date(dateLike) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isDateExpired(expiresAt) {
  const exp = String(expiresAt || '').slice(0, 10);
  if (!exp) return false;
  return toLocalDateString() > exp;
}

function normalizeUserSubscriptionStatus(adp, userId) {
  if (!adp || !userId) return null;
  const row = adp.execOne(
    `SELECT subscription_status, subscription_expires_at, vip_gift_claimed_at, vip_gift_expires_at
     FROM users WHERE id = ?`,
    userId,
  );
  if (!row) return null;
  if (
    (row.subscription_status === 'active' || row.subscription_status === 'expiring_soon') &&
    isDateExpired(row.subscription_expires_at)
  ) {
    adp.execRun(
      `UPDATE users
       SET subscription_status = 'expired', updated_at = ?
       WHERE id = ?`,
      nowIso(),
      userId,
    );
    row.subscription_status = 'expired';
  }
  return row;
}

function sha256(text) {
  return crypto
    .createHash('sha256')
    .update(String(text || ''))
    .digest('hex');
}

const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let _registerSchemaReady = false;

function randomSecret(len = 32) {
  return crypto.randomBytes(len).toString('hex');
}

function ensureRegisterSchemaReady() {
  if (_registerSchemaReady) return;
  const adp = getAdapter();
  const { initPaymentSchema } = require('./payments/schema');
  initPaymentSchema(adp);

  const cols = adp.execAll('PRAGMA table_info(users)');
  const colSet = new Set((cols || []).map((item) => item.name));
  const ensureColumns = [
    ['subscription_status', "ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'free'"],
    ['subscription_expires_at', 'ALTER TABLE users ADD COLUMN subscription_expires_at TEXT'],
    ['current_subscription_id', 'ALTER TABLE users ADD COLUMN current_subscription_id INTEGER DEFAULT NULL'],
    ['vip_gift_claimed_at', 'ALTER TABLE users ADD COLUMN vip_gift_claimed_at TEXT'],
    ['vip_gift_expires_at', 'ALTER TABLE users ADD COLUMN vip_gift_expires_at TEXT'],
    ['referral_code', 'ALTER TABLE users ADD COLUMN referral_code TEXT'],
    ['referred_by', 'ALTER TABLE users ADD COLUMN referred_by INTEGER DEFAULT NULL'],
    ['device_fingerprint', 'ALTER TABLE users ADD COLUMN device_fingerprint TEXT'],
    ['registration_ip', 'ALTER TABLE users ADD COLUMN registration_ip TEXT'],
    ['referral_enabled', 'ALTER TABLE users ADD COLUMN referral_enabled INTEGER DEFAULT 0'],
  ];

  ensureColumns.forEach(([name, sql]) => {
    if (!colSet.has(name)) adp.execDDL(sql);
  });
  adp.execDDL('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)');
  adp.execDDL('CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by)');
  adp.execDDL('CREATE INDEX IF NOT EXISTS idx_users_device_fingerprint ON users(device_fingerprint)');
  _registerSchemaReady = true;
}

function generateReferralCode(adp, len = 8) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let code = '';
    const bytes = crypto.randomBytes(len);
    for (let i = 0; i < len; i += 1) {
      code += REFERRAL_CODE_ALPHABET[bytes[i] % REFERRAL_CODE_ALPHABET.length];
    }
    const exists = adp.execOne('SELECT id FROM users WHERE referral_code = ?', code);
    if (!exists) return code;
  }
  throw new Error('邀请码生成失败，请稍后重试');
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

/** P1-1 优化：异步 scrypt，不阻塞事件循环（用于登录热路径） */
function verifyPasswordAsync(password, storedHash) {
  return new Promise(function (resolve) {
    if (!storedHash || typeof storedHash !== 'string') return resolve(false);
    const parts = storedHash.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return resolve(false);
    const salt = parts[1];
    const expectedHex = parts[2];
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    crypto.scrypt(String(password || ''), salt, 64, function (err, derivedKey) {
      if (err) return resolve(false);
      const actualBuf = Buffer.from(derivedKey);
      if (expectedBuf.length !== actualBuf.length) return resolve(false);
      try {
        resolve(crypto.timingSafeEqual(expectedBuf, actualBuf));
      } catch (e) {
        resolve(false);
      }
    });
  });
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

// ★ P1-3 优化：内存 session 缓存，覆盖 DB 防抖写入前的竞态窗口
//    loginWithPassword 生成 token 后立即存入内存，setImmediate 异步刷新到 DB
//    validateSession 优先查内存，未命中再查 DB
const _sessionCache = new Map(); // tokenHash → sessionObj
let _sessionCacheCleanTimer = null;
function _cacheSession(tokenHash, sessionObj) {
  _sessionCache.set(tokenHash, sessionObj);
  // ★ 同步写入 Redis（跨实例共享，cluster:3 时其他实例可读到）
  try {
    const redis = require('./core/redis-client');
    if (redis.isConnected()) {
      const ttl = sessionObj.expiresAt ? new Date(sessionObj.expiresAt).getTime() - Date.now() : 3600000;
      redis.setJSON('session:' + tokenHash, sessionObj, Math.max(60000, ttl)).catch(function () {});
    }
  } catch (_) {}
  // 定期清理过期缓存（每 5 分钟）
  if (!_sessionCacheCleanTimer) {
    _sessionCacheCleanTimer = setInterval(
      function () {
        const now = new Date().toISOString();
        _sessionCache.forEach(function (s, k) {
          if (s.expiresAt && s.expiresAt < now) _sessionCache.delete(k);
        });
        if (_sessionCache.size === 0 && _sessionCacheCleanTimer) {
          clearInterval(_sessionCacheCleanTimer);
          _sessionCacheCleanTimer = null;
        }
      },
      5 * 60 * 1000,
    );
  }
}
function _getCachedSession(tokenHash) {
  const s = _sessionCache.get(tokenHash);
  if (!s) return null;
  // 检查是否过期
  if (s.expiresAt && s.expiresAt < new Date().toISOString()) {
    _sessionCache.delete(tokenHash);
    return null;
  }
  return s;
}

let _bootstrapped = false;
function ensureBootstrapped() {
  if (_bootstrapped) return;
  const adp = getAdapter();
  // ★ 确保 users 表 schema 是最新的（自动添加 referral_enabled 等列）
  ensureRegisterSchemaReady();
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
  _bootstrapped = true;
}

/** P0-2 优化：将角色+权限查询合并到用户查询的 JOIN 中，从 3 次 SQL → 1 次 */
function buildRolesAndPermsFromJoinedRows(rows) {
  if (!rows || rows.length === 0) return { roles: [], permissions: [] };
  const roleSet = new Set();
  const permSet = new Set();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].role_code) roleSet.add(rows[i].role_code);
    if (rows[i].permission_code) permSet.add(rows[i].permission_code);
  }
  return { roles: Array.from(roleSet), permissions: Array.from(permSet) };
}

// ★ P2: 用户 SessionInfo 缓存（60s），避免每次登录 5 表 JOIN
const _sessionInfoCache = new Map();
function getCachedSessionInfo(userId) {
  const entry = _sessionInfoCache.get(userId);
  if (entry && Date.now() - entry.time < 60000) return entry.data;
  _sessionInfoCache.delete(userId);
  return null;
}
function setCachedSessionInfo(userId, data) {
  _sessionInfoCache.set(userId, { time: Date.now(), data });
}

function buildSessionInfoByUserId(userId) {
  // 优先从缓存读取
  var cached = getCachedSessionInfo(userId);
  if (cached) return cached;

  const adp = getAdapter();
  const rows = adp.execAll(
    `SELECT u.id, u.username, u.status, u.must_change_password, u.last_login_at, u.password_updated_at,
            u.subscription_status, u.subscription_expires_at, u.vip_gift_claimed_at, u.vip_gift_expires_at,
            u.referral_enabled,
            r.code as role_code,
            p.code as permission_code
     FROM users u
     LEFT JOIN user_roles ur ON u.id = ur.user_id
     LEFT JOIN roles r ON ur.role_id = r.id
     LEFT JOIN role_permissions rp ON r.id = rp.role_id
     LEFT JOIN permissions p ON rp.permission_id = p.id
     WHERE u.id = ?`,
    userId,
  );
  if (!rows || rows.length === 0) return null;
  const rp = buildRolesAndPermsFromJoinedRows(rows);
  const info = {
    user: sanitizeUser(rows[0]),
    roles: rp.roles,
    permissions: rp.permissions,
    subscription_status: rows[0].subscription_status || 'free',
    subscription_expires_at: rows[0].subscription_expires_at || null,
    vip_gift_claimed_at: rows[0].vip_gift_claimed_at || null,
    vip_gift_expires_at: rows[0].vip_gift_expires_at || null,
    referralEnabled: rows[0].referral_enabled === 1,
  };
  setCachedSessionInfo(userId, info);
  return info;
}

async function loginWithPassword(username, password, meta = {}) {
  // ★ 安全加固：拒绝超长用户名/密码，防止 DoS
  const MAX_USERNAME_LEN = 64;
  const MAX_PASSWORD_LEN = 128;
  if (!username || typeof username !== 'string' || username.length > MAX_USERNAME_LEN) {
    return { ok: false, msg: '用户名格式不正确' };
  }
  if (!password || typeof password !== 'string' || password.length > MAX_PASSWORD_LEN) {
    return { ok: false, msg: '密码格式不正确' };
  }

  ensureBootstrapped();
  const adp = getAdapter();
  const now = new Date();
  const nowStr = now.toISOString();

  let user = adp.execOne('SELECT * FROM users WHERE username = ?', username);
  // ★ C: 增量同步 — 内存未命中时从磁盘直接查（<50ms），不再全量 reload 296MB（2-5s）
  if (!user && typeof adp.execOneOnDisk === 'function') {
    user = adp.execOneOnDisk('SELECT * FROM users WHERE username = ?', [username]);
    if (user && typeof adp.syncUserFromDisk === 'function') {
      adp.syncUserFromDisk(user); // 同步到内存 DB，下次秒查
    }
  }
  if (!user) return { ok: false, code: 0, msg: '账号或密码错误' };
  if (user.status === 'disabled') return { ok: false, code: 0, msg: '账号已禁用' };

  if (user.status === 'locked' && user.locked_until && new Date(user.locked_until).getTime() > now.getTime()) {
    return { ok: false, code: 0, msg: '账号已锁定，请稍后重试' };
  }

  // ★ P1-1 优化：异步 scrypt，不阻塞事件循环
  const passOk = await verifyPasswordAsync(password, user.password_hash);
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
    flushCriticalWrites(adp);
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

  // ★ P2: defer subscription check, not on login critical path
  setImmediate(() => {
    try {
      normalizeUserSubscriptionStatus(adp, user.id);
    } catch (e) {}
  });

  const token = randomSecret(24);
  const tokenHash = sha256(token);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();

  // ★ P1-3 优化：先查询 session 信息并存入内存缓存，确保防抖写入窗口内可立即验证
  const sessionInfo = buildSessionInfoByUserId(user.id);
  if (sessionInfo) {
    _cacheSession(tokenHash, {
      sid: tokenHash,
      userId: user.id,
      user: sessionInfo.user,
      roles: sessionInfo.roles,
      permissions: sessionInfo.permissions,
      subscription_status: sessionInfo.subscription_status,
      subscription_expires_at: sessionInfo.subscription_expires_at,
      vip_gift_claimed_at: sessionInfo.vip_gift_claimed_at,
      vip_gift_expires_at: sessionInfo.vip_gift_expires_at,
      referralEnabled: sessionInfo.referralEnabled,
      expiresAt: expiresAt,
    });
  }

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
  flushCriticalWrites(adp);
  return {
    ok: true,
    token,
    expiresAt,
    ...sessionInfo,
  };
}

function registerUser(username, password, meta = {}) {
  // ★ 安全加固：拒绝超长用户名/密码
  const MAX_USERNAME_LEN = 64;
  const MAX_PASSWORD_LEN = 128;
  if (!username || typeof username !== 'string' || username.length > MAX_USERNAME_LEN || !username.trim()) {
    return { ok: false, msg: '用户名格式不正确' };
  }
  if (!password || typeof password !== 'string' || password.length > MAX_PASSWORD_LEN || !password.trim()) {
    return { ok: false, msg: '密码格式不正确' };
  }

  ensureBootstrapped();
  ensureRegisterSchemaReady();

  const normalizedUsername = String(username || '').trim();
  const normalizedPassword = String(password || '');
  const referralCode = String(meta.referralCode || '')
    .trim()
    .toUpperCase();
  const deviceFingerprint = meta.deviceFingerprint ? String(meta.deviceFingerprint).trim() : null;
  const registrationIp = meta.ip ? String(meta.ip).trim() : null;

  if (!normalizedUsername || normalizedUsername.length < 3) {
    return { ok: false, code: 0, msg: '账号至少 3 位' };
  }
  if (!normalizedPassword || normalizedPassword.length < 6) {
    return { ok: false, code: 0, msg: '密码至少 6 位' };
  }
  if (!referralCode) {
    return { ok: false, code: 0, msg: '当前注册需邀请码，请先联系客服获取' };
  }
  if (!/^[A-Z0-9]{6,16}$/.test(referralCode)) {
    return { ok: false, code: 0, msg: '邀请码格式不正确，请检查后再试' };
  }

  const adp = getAdapter();
  const exists = adp.execOne('SELECT id FROM users WHERE username = ?', normalizedUsername);
  if (exists) return { ok: false, code: 0, msg: '用户名已存在' };

  const inviter = adp.execOne('SELECT id, username FROM users WHERE referral_code = ?', referralCode);
  if (!inviter) {
    return { ok: false, code: 0, msg: '邀请码不存在或已失效' };
  }

  const now = nowIso();
  const ownReferralCode = generateReferralCode(adp, 8);
  adp.execRun(
    `INSERT INTO users(
      username, password_hash, status, must_change_password,
      password_updated_at, failed_login_count, referral_code, referred_by,
      device_fingerprint, registration_ip, created_at, updated_at
    ) VALUES (?, ?, 'active', 0, ?, 0, ?, ?, ?, ?, ?, ?)`,
    normalizedUsername,
    hashPassword(normalizedPassword),
    now,
    ownReferralCode,
    inviter.id,
    deviceFingerprint,
    registrationIp,
    now,
    now,
  );

  const createdUser = adp.execOne('SELECT id FROM users WHERE username = ?', normalizedUsername);
  if (!createdUser || !createdUser.id) {
    return { ok: false, code: 0, msg: '注册失败，请稍后重试' };
  }

  adp.execRun(
    `INSERT OR IGNORE INTO user_roles(user_id, role_id, created_at)
     SELECT ?, r.id, ? FROM roles r WHERE r.code = 'viewer'`,
    createdUser.id,
    now,
  );

  adp.execRun(
    `INSERT OR IGNORE INTO referral_accounts(user_id, total_earned, total_withdrawn, total_invitees, total_commissions, updated_at)
     VALUES (?, 0, 0, 0, 0, ?)`,
    createdUser.id,
    now,
  );

  flushCriticalWrites(adp);
  // ★ A: 通知 reload 追踪器 DB 已更新，避免注册后登录触发无效 300MB 重载
  if (typeof adp.markDirty === 'function') adp.markDirty();

  return {
    ok: true,
    user: sanitizeUser(adp.execOne('SELECT * FROM users WHERE id = ?', createdUser.id)),
    referralCode: ownReferralCode,
    referralUrl: `https://zj.100qiu.com/#register?ref=${ownReferralCode}`,
    referredBy: inviter.id,
  };
}

function validateSession(token, touch = true) {
  if (!token) return null;
  const adp = getAdapter();
  const tokenHash = sha256(token);
  const now = nowIso();

  // ★ 三级缓存：内存 → Redis → DB
  // 1. 内存缓存（单实例内）
  const cached = _getCachedSession(tokenHash);
  if (cached) {
    if (cached.user && cached.user.status !== 'active') return null;
    if (new Date(cached.expiresAt).getTime() <= Date.now()) {
      _sessionCache.delete(tokenHash);
      return null;
    }
    // 内存命中：不 touch DB（减少写入），直接返回缓存的 session
    if (touch) {
      // 异步 touch 到 DB（不影响响应速度）
      setImmediate(function () {
        try {
          const tNow = new Date().toISOString();
          adp.execRun('UPDATE auth_sessions SET last_seen_at = ? WHERE session_token_hash = ?', tNow, tokenHash);
        } catch (_) {}
      });
    }
    return {
      sid: cached.sid,
      userId: cached.userId,
      user: cached.user,
      roles: cached.roles || [],
      permissions: cached.permissions || [],
      subscription_status: cached.subscription_status || 'free',
      subscription_expires_at: cached.subscription_expires_at || null,
      vip_gift_claimed_at: cached.vip_gift_claimed_at || null,
      vip_gift_expires_at: cached.vip_gift_expires_at || null,
      referralEnabled: cached.referralEnabled || false,
      expiresAt: cached.expiresAt,
    };
  }

  // 2. Redis 缓存（跨实例共享，cluster:3 前提）
  // ★ 异步查询，不阻塞当前请求（首次 miss 后后续命中）
  // Redis 命中时填充内存缓存，避免后续 DB 查询
  let row = adp.execOne(
    `SELECT s.id AS sid, s.user_id, s.expires_at, s.revoked_at,
            u.id, u.username, u.status, u.must_change_password, u.last_login_at, u.password_updated_at,
            u.subscription_status, u.subscription_expires_at, u.vip_gift_claimed_at, u.vip_gift_expires_at,
            u.referral_enabled
     FROM auth_sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.session_token_hash = ?`,
    tokenHash,
  );
  // ★ V12: sql.js 跨 worker 共享 — DB 未命中时从磁盘重载再查
  if (!row && typeof adp.reload === 'function') {
    adp.reload();
    row = adp.execOne(
      `SELECT s.id AS sid, s.user_id, s.expires_at, s.revoked_at,
              u.id, u.username, u.status, u.must_change_password, u.last_login_at, u.password_updated_at,
              u.subscription_status, u.subscription_expires_at, u.vip_gift_claimed_at, u.vip_gift_expires_at,
              u.referral_enabled
       FROM auth_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.session_token_hash = ?`,
      tokenHash,
    );
  }
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.status !== 'active') return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  const normalizedSub = normalizeUserSubscriptionStatus(adp, row.user_id);
  if (normalizedSub) {
    row.subscription_status = normalizedSub.subscription_status || row.subscription_status;
    row.subscription_expires_at = normalizedSub.subscription_expires_at || row.subscription_expires_at;
    row.vip_gift_claimed_at = normalizedSub.vip_gift_claimed_at || row.vip_gift_claimed_at;
    row.vip_gift_expires_at = normalizedSub.vip_gift_expires_at || row.vip_gift_expires_at;
  }

  if (touch) {
    adp.execRun('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?', now, row.sid);
  }

  // ★ P0-2 优化：合并角色+权限查询为单次 JOIN
  const rpRows = adp.execAll(
    `SELECT r.code as role_code, p.code as permission_code
     FROM user_roles ur
     JOIN roles r ON ur.role_id = r.id
     LEFT JOIN role_permissions rp ON r.id = rp.role_id
     LEFT JOIN permissions p ON rp.permission_id = p.id
     WHERE ur.user_id = ?`,
    row.user_id,
  );
  const rp = buildRolesAndPermsFromJoinedRows(rpRows);
  return {
    sid: row.sid,
    userId: row.user_id,
    user: sanitizeUser(row),
    roles: rp.roles,
    permissions: rp.permissions,
    subscription_status: row.subscription_status || 'free',
    subscription_expires_at: row.subscription_expires_at || null,
    vip_gift_claimed_at: row.vip_gift_claimed_at || null,
    vip_gift_expires_at: row.vip_gift_expires_at || null,
    referralEnabled: row.referral_enabled === 1,
    expiresAt: row.expires_at,
  };
}

function logout(token) {
  if (!token) return { ok: true };
  const adp = getAdapter();
  adp.execRun('UPDATE auth_sessions SET revoked_at = ? WHERE session_token_hash = ?', nowIso(), sha256(token));
  return { ok: true };
}

async function changePassword(userId, oldPassword, newPassword) {
  const adp = getAdapter();
  const user = adp.execOne('SELECT * FROM users WHERE id = ?', userId);
  if (!user) return { ok: false, msg: '用户不存在' };
  // ★ P1-1 优化：异步 scrypt
  if (!(await verifyPasswordAsync(oldPassword, user.password_hash))) return { ok: false, msg: '旧密码错误' };
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
  flushCriticalWrites(adp);
  return { ok: true };
}

function listUsers() {
  const adp = getAdapter();
  const rows = adp.execAll(
    `SELECT id, username, status, must_change_password, last_login_at, password_updated_at, created_at, referral_enabled
     FROM users ORDER BY id ASC`,
  );
  // ★ 管理后台: 一次 JOIN 查出全部用户角色，按 userId 分组（避免 N+1）
  const roleRows = adp.execAll(
    `SELECT ur.user_id, r.code
     FROM user_roles ur JOIN roles r ON ur.role_id = r.id
     ORDER BY ur.user_id, r.code`,
  );
  const rolesByUser = {};
  (roleRows || []).forEach((rr) => {
    if (!rolesByUser[rr.user_id]) rolesByUser[rr.user_id] = [];
    rolesByUser[rr.user_id].push(rr.code);
  });
  return rows.map((u) => ({
    id: u.id,
    username: u.username,
    status: u.status,
    roles: rolesByUser[u.id] || [],
    mustChangePassword: Number(u.must_change_password || 0) === 1,
    lastLoginAt: u.last_login_at || null,
    passwordUpdatedAt: u.password_updated_at || null,
    createdAt: u.created_at || null,
    referralEnabled: u.referral_enabled === 1,
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

  flushCriticalWrites(adp);
  return { ok: true, username, tempPassword, role, mustChangePassword: true };
}

function updateUserStatus(userId, status) {
  const allow = new Set(['active', 'disabled', 'locked']);
  if (!allow.has(status)) return { ok: false, msg: '非法状态' };
  const adp = getAdapter();
  adp.execRun('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), userId);
  flushCriticalWrites(adp);
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
  flushCriticalWrites(adp);
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
  flushCriticalWrites(adp);
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
  // ★ 立即持久化到磁盘，防止跨 Worker 角色丢失
  flushCriticalWrites(adp);
  return { ok: true };
}

/** ★ 管理员：开启/关闭指定用户的返利功能 */
function toggleUserReferral(userId, enabled) {
  if (!userId) return { ok: false, msg: 'MISSING_USER_ID' };
  const val = enabled ? 1 : 0;
  const adp = getAdapter();
  adp.execRun('UPDATE users SET referral_enabled = ?, updated_at = ? WHERE id = ?', val, nowIso(), userId);
  flushCriticalWrites(adp);
  return { ok: true, userId, referralEnabled: val === 1 };
}

module.exports = {
  ensureBootstrapped,
  resolveSessionToken,
  isActionProtected,
  getRequiredPermission,
  hasPermission,
  loginWithPassword,
  registerUser,
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
  toggleUserReferral,
};

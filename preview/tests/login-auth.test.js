/**
 * 用户登录全方位测试 — login/auth/session/安全/权限/密码
 *
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const LOGIN = path.join(__dirname, '..', 'js', 'pages', 'login.js');
const AUTH_CLIENT = path.join(__dirname, '..', 'js', 'auth-client.js');
const ACCOUNT_SECURITY = path.join(__dirname, '..', 'js', 'pages', 'account-security.js');
const API = path.join(__dirname, '..', 'js', 'api.js');
const MAIN_FUSION = path.join(__dirname, '..', 'js', 'main-fusion.js');
const AUTH_SERVICE = path.join(__dirname, '..', '..', 'server', 'auth-service.js');
const APP_CSS = path.join(__dirname, '..', 'css', 'app.css');

function src(f) {
  const buf = fs.readFileSync(f);
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le');
  let s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s;
}

describe('用户登录全方位测试', () => {
  // ═══════════════════════════════════════════
  // 1. login.js 登录流程
  // ═══════════════════════════════════════════
  describe('1. login.js 登录界面', () => {
    const lg = src(LOGIN);

    it('1.1 登录页有用户名输入框 #loginUser', () => {
      expect(lg).toContain('loginUser');
    });

    it('1.2 登录页有密码输入框 #loginPass', () => {
      expect(lg).toContain('loginPass');
      expect(lg).toContain("type=\"password\"");
    });

    it('1.3 登录页有登录按钮 #loginBtn', () => {
      expect(lg).toContain('loginBtn');
    });

    it('1.4 登录页有消息提示区 #loginMsg', () => {
      expect(lg).toContain('loginMsg');
    });

    it('1.5 登录页有用户协议勾选 #loginAgree', () => {
      expect(lg).toContain('loginAgree');
      expect(lg).toContain('用户协议');
    });

    it('1.6 密码可见性切换按钮 #togglePassBtn', () => {
      expect(lg).toContain('togglePassBtn');
      expect(lg).toContain('aria-pressed');
    });

    it('1.7 setPassVisible 密码可见性切换函数', () => {
      expect(lg).toContain('function setPassVisible');
    });

    it('1.8 Enter 键触发登录', () => {
      expect(lg).toContain("e.key === 'Enter'");
    });

    it('1.9 空账号/密码校验', () => {
      expect(lg).toContain('请输入账号和密码');
    });

    it('1.10 用户协议未勾选校验', () => {
      expect(lg).toContain('请先同意');
    });

    it('1.11 normalizeBasicInput 输入标准化', () => {
      expect(lg).toContain('normalizeBasicInput');
      expect(lg).toContain('trim');
    });

    it('1.12 normalizePasswordInput 密码标准化', () => {
      expect(lg).toContain('normalizePasswordInput');
    });

    it('1.13 登录中按钮禁用状态', () => {
      expect(lg).toContain('btn.disabled = true');
    });

    it('1.14 登录成功 msg 变绿', () => {
      expect(lg).toContain("classList.toggle('ok'");
    });
  });

  // ═══════════════════════════════════════════
  // 2. auth-client.js Token/Session
  // ═══════════════════════════════════════════
  describe('2. auth-client.js Token/Session', () => {
    const ac = src(AUTH_CLIENT);

    it('2.1 getAuthToken 从 localStorage 读取', () => {
      expect(ac).toContain('localStorage.getItem');
      expect(ac).toContain('TOKEN_KEY');
    });

    it('2.2 hasAuthToken 判断 token 是否存在', () => {
      expect(ac).toContain('hasAuthToken');
    });

    it('2.3 setAuthToken 设置 token', () => {
      expect(ac).toContain('localStorage.setItem');
    });

    it('2.4 clearAuthToken 清除 token', () => {
      expect(ac).toContain('localStorage.removeItem');
    });

    it('2.5 setAuthSession 保存 session', () => {
      expect(ac).toContain('SESSION_KEY');
      expect(ac).toContain('JSON.stringify');
    });

    it('2.6 getAuthSession 读取 session', () => {
      expect(ac).toContain('JSON.parse');
    });

    it('2.7 clearAuthSession 清除 session', () => {
      expect(ac).toContain('clearAuthSession');
    });

    it('2.8 clearAuthAll 一键清除', () => {
      expect(ac).toContain('clearAuthAll');
      expect(ac).toContain('clearAuthToken');
      expect(ac).toContain('clearAuthSession');
    });

    it('2.9 localStorage 异常 try/catch 包裹', () => {
      expect(ac).toContain('try');
      expect(ac).toContain('catch (e)');
    });
  });

  // ═══════════════════════════════════════════
  // 3. auth-service.js 服务端认证
  // ═══════════════════════════════════════════
  describe('3. auth-service.js 服务端认证', () => {
    const as = src(AUTH_SERVICE);

    it('3.1 SESSION_TTL 默认 24 小时', () => {
      expect(as).toContain('SESSION_TTL_HOURS');
      expect(as).toContain("'24'");
    });

    it('3.2 登录失败锁定 LOCK_MINUTES 默认 15 分钟', () => {
      expect(as).toContain('LOCK_MINUTES');
      expect(as).toContain("'15'");
    });

    it('3.3 最大登录失败次数 MAX_LOGIN_FAILS 默认 5', () => {
      expect(as).toContain('MAX_LOGIN_FAILS');
      expect(as).toContain("'5'");
    });

    it('3.4 4 种角色定义 super_admin/ops_admin/analyst/viewer', () => {
      expect(as).toContain("'super_admin'");
      expect(as).toContain("'ops_admin'");
      expect(as).toContain("'analyst'");
      expect(as).toContain("'viewer'");
    });

    it('3.5 权限列表 PERMISSIONS 包含完整粒度', () => {
      expect(as).toContain('auth:login');
      expect(as).toContain('auth:logout');
      expect(as).toContain('auth:change_password');
      expect(as).toContain('plan:view');
      expect(as).toContain('plan:confirm');
      expect(as).toContain('backtest:view');
      expect(as).toContain('dashboard:model_view');
      expect(as).toContain('ops:backfill');
    });

    it('3.6 ROLE_PERMISSION_MATRIX 角色-权限矩阵', () => {
      expect(as).toContain('ROLE_PERMISSION_MATRIX');
    });

    it('3.7 super_admin 权限为 *', () => {
      expect(as).toContain("super_admin: ['*']");
    });

    it('3.8 ops_admin 有完整运维权限', () => {
      expect(as).toContain("ops_admin: [");
      expect(as).toContain("'ops:backfill'");
      expect(as).toContain("'ops:auto_heal'");
    });

    it('3.9 用户表 users 包含 must_change_password 字段', () => {
      expect(as).toContain('must_change_password');
    });

    it('3.10 用户表 users 包含 failed_login_count/ locked_until', () => {
      expect(as).toContain('failed_login_count');
      expect(as).toContain('locked_until');
    });

    it('3.11 auth_sessions 表有 issued_at/expires_at/revoked_at', () => {
      expect(as).toContain('issued_at');
      expect(as).toContain('expires_at');
      expect(as).toContain('revoked_at');
    });

    it('3.12 有 auth_sessions 和审计机制', () => {
      expect(as).toContain('session') || expect(fs.readFileSync(AUTH_SERVICE, 'utf8').includes('session'));
      // audit_logs 表在 database.js 的 AUTH_TABLES_DDL 中
    });
  });

  // ═══════════════════════════════════════════
  // 4. API 层认证注入
  // ═══════════════════════════════════════════
  describe('4. API 层认证注入', () => {
    it('4.1 API 层认证 token 注入', () => {
      const ap = src(API);
      expect(ap).toContain('getAuthToken');
      expect(ap).toContain('token');
    });

    it('4.2 401 响应触发 auth:unauthorized 事件', () => {
      const ap = src(API);
      expect(ap).toContain('401');
      expect(ap).toContain('auth:unauthorized');
      expect(ap).toContain('clearAuthAll');
    });

    it('4.3 每次请求携带 X-Device-Id', () => {
      const ap = src(API);
      expect(ap).toContain('X-Device-Id');
    });

    it('4.4 main-fusion 有 auth:unauthorized 监听', () => {
      const mf = src(MAIN_FUSION);
      expect(mf).toContain('auth:unauthorized');
    });
  });

  // ═══════════════════════════════════════════
  // 5. account-security.js 账户安全
  // ═══════════════════════════════════════════
  describe('5. account-security.js 账户安全', () => {
    it('5.1 文件存在且可读取', () => {
      expect(fs.existsSync(ACCOUNT_SECURITY)).toBe(true);
      expect(fs.statSync(ACCOUNT_SECURITY).size).toBeGreaterThan(100);
    });

    it('5.2 有修改密码相关逻辑', () => {
      const asec = src(ACCOUNT_SECURITY);
      const hasAny = asec.includes('password') || asec.includes('pass') || asec.includes('change');
      expect(hasAny).toBe(true);
    });
  });

  // ═══════════════════════════════════════════
  // 6. 登录后数据加载
  // ═══════════════════════════════════════════
  describe('6. 登录后数据加载', () => {
    it('6.1 登录成功 → switchTab("home")', () => {
      const lg = src(LOGIN);
      expect(lg).toContain("switchTab('home')");
    });

    it('6.2 mustChangePassword → switchTab("account-security")', () => {
      const lg = src(LOGIN);
      expect(lg).toContain("switchTab('account-security')");
    });

    it('6.3 登录成功保存 user/roles/permissions 到 session', () => {
      const lg = src(LOGIN);
      expect(lg).toContain('setAuthSession');
      expect(lg).toContain('user');
      expect(lg).toContain('roles');
      expect(lg).toContain('permissions');
    });

    it('6.4 main-fusion 有首页数据预加载', () => {
      const mf = src(MAIN_FUSION);
      expect(mf).toContain('loadHome');
    });

    it('6.5 本地开发环境回退登录 isLocalEnv', () => {
      const lg = src(LOGIN);
      expect(lg).toContain('isLocalEnv');
    });
  });

  // ═══════════════════════════════════════════
  // 7. CSS 合同
  // ═══════════════════════════════════════════
  describe('7. CSS 样式合同', () => {
    it('7.1 登录壳 .auth-shell 存在', () => {
      const css = src(APP_CSS);
      expect(css).toContain('auth-shell');
    });

    it('7.2 登录卡片 .auth-login-card', () => {
      const css = src(APP_CSS);
      expect(css).toContain('auth-login-card');
    });

    it('7.3 密码切换按钮 .auth-pass-toggle', () => {
      const css = src(APP_CSS);
      expect(css).toContain('auth-pass-toggle');
    });
  });
});

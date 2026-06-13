const DEFAULT_E2E_USER = 'ctyqq';
const DEFAULT_E2E_PASS = '31788517';

let cachedAuthPromise = null;

async function loginForE2E(page) {
  const username = process.env.E2E_AUTH_USER || DEFAULT_E2E_USER;
  const password = process.env.E2E_AUTH_PASS || DEFAULT_E2E_PASS;
  const response = await page.request.post('/api', {
    data: {
      action: 'auth-login',
      data: { username, password },
    },
  });
  const body = await response.json().catch(function () {
    return null;
  });
  if (!body || body.code !== 1 || !body.data || !body.data.token) {
    throw new Error('E2E 登录失败: ' + (body && body.msg ? body.msg : response.status()));
  }
  return {
    token: body.data.token,
    session: {
      user: body.data.user || null,
      roles: body.data.roles || [],
      permissions: body.data.permissions || [],
    },
  };
}

async function ensureE2EAuth(page) {
  if (!cachedAuthPromise) cachedAuthPromise = loginForE2E(page);
  const auth = await cachedAuthPromise;
  await page.addInitScript(function (payload) {
    window.localStorage.setItem('auth_token', payload.token);
    window.localStorage.setItem('auth_session', JSON.stringify(payload.session));
  }, auth);
}

module.exports = { ensureE2EAuth };

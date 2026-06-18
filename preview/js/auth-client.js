const TOKEN_KEY = 'auth_token';
const SESSION_KEY = 'auth_session';

export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

export function hasAuthToken() {
  return !!getAuthToken();
}

export function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
  } catch (e) {}
}

export function clearAuthToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}

export function setAuthSession(sessionData) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData || {}));
  } catch (e) {}
}

export function getAuthSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function clearAuthSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}

export function clearAuthAll() {
  clearAuthToken();
  clearAuthSession();
}

/** ★ 检查当前登录用户是否开启了返利功能（白名单） */
export function hasReferralAccess() {
  try {
    const session = getAuthSession();
    return !!(session && session.referralEnabled);
  } catch (e) {
    return false;
  }
}

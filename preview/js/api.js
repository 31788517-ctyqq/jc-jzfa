import { API, getDeviceId } from './utils.js';
import { getAuthToken, clearAuthAll } from './auth-client.js';

// ★ P0: API 请求去重 — 相同 action+data 的并发请求共享一个 Promise
const _pendingRequests = {};

export function api(action, data = {}, retries = 3) {
  const reqKey = action + ':' + JSON.stringify(data || {}) + ':r' + retries;
  if (_pendingRequests[reqKey]) return _pendingRequests[reqKey];

  const timeoutMs = action === 'plan-list' || action === 'score-plan-list' ? 60000 : 30000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId() };
  if (token) headers['X-Auth-Token'] = token;

  const pending = fetch(API, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, data }),
    signal: ctrl.signal,
  })
    .then((r) => {
      clearTimeout(timer);
      return r.json();
    })
    .then((d) => {
      if (d.code === 1) return d.data;
      if (d.pending) return d;
      const err = new Error(d.msg || '服务器错误');
      err.code = d.code;
      err.nonRetryable = true;
      if (d.code === 401) {
        clearAuthAll();

        let activePageId = '';
        let inProfileContext = false;
        try {
          const activePage = document.querySelector('.page.active');
          activePageId = (activePage && activePage.id) || '';
          inProfileContext = activePageId === 'page-profile';
        } catch (_) {}

        try {
          const lastPage = sessionStorage.getItem('lastPage') || '';
          if (lastPage === 'profile') inProfileContext = true;
        } catch (_) {}

        const profileRelatedAction =
          [
            'my-plan-list',
            'plan-catalog',
            'subscription-status',
            'referral-info',
            'referral-account',
            'referral-withdraw-history',
          ].indexOf(action) >= 0;

        // 个人中心/其关联预取请求出现 401 时，不做全局跳转，交由页面自身展示登录引导
        if (!inProfileContext && !profileRelatedAction) {
          window.dispatchEvent(new CustomEvent('auth:unauthorized', { detail: { action } }));
        }
      }
      throw err;
    })
    .catch((err) => {
      clearTimeout(timer);
      if (err.name === 'AbortError') err = new Error('请求超时');
      const canRetry = retries > 0 && !err.nonRetryable;
      if (canRetry) {
        console.warn(`[API] ${action} 请求失败，重试中 (${4 - retries}/3):`, err.message);
        return new Promise((resolve) => setTimeout(resolve, 2000)).then(() => api(action, data, retries - 1));
      }
      throw err;
    });

  // ★ P0: 请求去重 — 缓存 pending promise，完成后自动清除
  _pendingRequests[reqKey] = pending;
  const cleanup = function () {
    delete _pendingRequests[reqKey];
  };
  pending.then(cleanup, cleanup);
  return pending;
}

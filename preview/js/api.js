import { API, getDeviceId } from './utils.js';
import { getAuthToken, clearAuthAll } from './auth-client.js';

// ★ P0: API 请求去重 — 相同 action+data 的并发请求共享一个 Promise
var _pendingRequests = {};

export function api(action, data = {}, retries = 2) {
  var reqKey = action + ':' + JSON.stringify(data || {}) + ':r' + retries;
  if (_pendingRequests[reqKey]) return _pendingRequests[reqKey];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId() };
  if (token) headers['X-Auth-Token'] = token;

  var pending = fetch(API, {
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
        window.dispatchEvent(new CustomEvent('auth:unauthorized', { detail: { action } }));
      }
      throw err;
    })
    .catch((err) => {
      clearTimeout(timer);
      if (err.name === 'AbortError') err = new Error('请求超时');
      const canRetry = retries > 0 && !err.nonRetryable;
      if (canRetry) {
        console.warn(`[API] ${action} 请求失败，重试中 (${3 - retries}/2):`, err.message);
        return new Promise((resolve) => setTimeout(resolve, 1000)).then(() => api(action, data, retries - 1));
      }
      throw err;
    });

  // ★ P0: 请求去重 — 缓存 pending promise，完成后自动清除
  _pendingRequests[reqKey] = pending;
  var cleanup = function () {
    delete _pendingRequests[reqKey];
  };
  pending.then(cleanup, cleanup);
  return pending;
}

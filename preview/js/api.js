import { API } from './utils.js';

export function api(action, data = {}, retries = 2) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data }),
    signal: ctrl.signal
  }).then(r => { clearTimeout(timer); return r.json(); }).then(d => {
    if (d.code === 1) return d.data;
    if (d.pending) return d;
    throw new Error(d.msg || '服务器错误');
  }).catch(err => {
    clearTimeout(timer);
    if (err.name === 'AbortError') err = new Error('请求超时');
    if (retries > 0) {
      console.warn(`[API] ${action} 请求失败，重试中 (${3 - retries}/2):`, err.message);
      return new Promise(resolve => setTimeout(resolve, 1000)).then(() => api(action, data, retries - 1));
    }
    throw err;
  });
}

// 颜色常量、工具函数
const _LOCAL_API_HOSTS = ['localhost', '127.0.0.1', '::1'];
let _isLocalPreview = false;
try {
  if (typeof window !== 'undefined' && window.location) {
    const hostname = (window.location.hostname || '').toLowerCase();
    _isLocalPreview = window.location.protocol === 'file:' || _LOCAL_API_HOSTS.indexOf(hostname) >= 0;
  }
} catch (e) {}

export const API = _isLocalPreview ? 'http://127.0.0.1:3000/api' : '/api';
export const DIR_COLORS = {
  胜: '#EF4444',
  平: '#FBBF24',
  负: '#60A5FA',
  胜平: '#34D399',
  平负: '#F472B6',
  胜负: '#A78BFA',
  让胜: '#18E0E0',
  让平: '#F59E0B',
  让负: '#94A3B8',
};
export const CAT_NAMES = ['综合排名', '胜平负', '半全场', '进球数', '双选', '让球'];
export const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const MIN_PLAN_DATE = '2026-03-19';

export function getWeekDay(dateStr) {
  return WEEK_NAMES[new Date(dateStr).getDay()];
}

export function formatDate(d) {
  const y = d.getFullYear(),
    m = (d.getMonth() + 1).toString().padStart(2, '0'),
    day = d.getDate().toString().padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function formatDateCN(d) {
  const m = (d.getMonth() + 1).toString().padStart(2, '0'),
    day = d.getDate().toString().padStart(2, '0');
  return m + '月' + day + '日 ' + WEEK_NAMES[d.getDay()];
}

// ═══ sessionStorage 缓存层 ═══
// ★ P3-4: Schema 版本号（数据结构变更时递增，自动淘汰旧缓存）
const _CACHE_SCHEMA_VERSION = 2;
const _CACHE_VERSION_KEY = '_cache:schema_version';

// 检查并清理版本不匹配的缓存
function checkSchemaVersion() {
  try {
    const stored = sessionStorage.getItem(_CACHE_VERSION_KEY);
    if (stored && parseInt(stored) === _CACHE_SCHEMA_VERSION) return;
    // 版本不匹配或首次，清除所有缓存
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.indexOf('_cache:') === 0) keysToRemove.push(k);
    }
    keysToRemove.forEach(function (k) {
      sessionStorage.removeItem(k);
    });
    sessionStorage.setItem(_CACHE_VERSION_KEY, _CACHE_SCHEMA_VERSION);
    console.log('[cache] Schema v' + _CACHE_SCHEMA_VERSION + ' 已激活, 清理 ' + keysToRemove.length + ' 条旧缓存');
  } catch (e) {}
}
// 页面加载时执行一次
checkSchemaVersion();

// TTL 映射（毫秒）：不同数据类型的缓存过期时间
const _CACHE_TTL = {
  'match-list': 120000, // 2 分钟
  'plan-list': 300000, // 5 分钟
  'score-plan-list': 300000, // 5 分钟
  'quant-plan-list': 300000, // 5 分钟
  'quant-rank': 300000, // 5 分钟
  default: 120000,
};

/**
 * 从 sessionStorage 读取缓存
 * @param {string} key - 缓存键
 * @returns {*} 缓存数据，过期或不存在返回 null
 */
export function getCache(key) {
  try {
    const raw = sessionStorage.getItem('_cache:' + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    const ttl = _CACHE_TTL[key.split(':')[0]] || _CACHE_TTL['default'];
    if (Date.now() - entry.t < ttl) {
      return entry.d;
    }
    // 过期，清理
    sessionStorage.removeItem('_cache:' + key);
  } catch (e) {}
  return null;
}

/**
 * 写入 sessionStorage 缓存
 * @param {string} key - 缓存键
 * @param {*} data - 要缓存的数据
 */
export function setCache(key, data) {
  try {
    sessionStorage.setItem('_cache:' + key, JSON.stringify({ t: Date.now(), d: data }));
  } catch (e) {}
}

// ═══ 匿名用户标识（Device ID） ═══
let _deviceId = null;
export function getDeviceId() {
  if (_deviceId) return _deviceId;
  try {
    _deviceId = localStorage.getItem('_dvid');
    if (!_deviceId) {
      // 生成 UUID v4
      _deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
      localStorage.setItem('_dvid', _deviceId);
    }
  } catch (e) {
    // localStorage 不可用时的降级
    _deviceId = 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }
  return _deviceId;
}

// ═══ SWR 缓存策略（Stale-While-Revalidate） ═══
/**
 * 立即返回过期缓存 → 后台刷新 → 静默更新 DOM
 * @param {string} cacheKey - 缓存键
 * @param {function} fetcher  - 数据获取函数 () => Promise<data>
 * @param {function} renderer - 渲染函数 (data, isStale) => void
 * @param {number}   ttl      - 缓存有效期（毫秒），默认 2 分钟
 */
export function swrFetch(cacheKey, fetcher, renderer, ttl) {
  ttl = ttl || 120000;
  // 1) 尝试从缓存立即渲染
  const cached = getCache(cacheKey);
  if (cached !== null) {
    renderer(cached, true); // isStale=true（可能过期）
  }
  // 2) 网络请求
  return fetcher()
    .then(function (fresh) {
      if (fresh !== null && fresh !== undefined) {
        setCache(cacheKey, fresh);
        renderer(fresh, false);
      }
      return fresh;
    })
    .catch(function (err) {
      console.warn('[swr] ' + cacheKey + ' 刷新失败:', err.message);
      // 如果有缓存，不抛错（用户至少看到旧数据）
      if (cached === null) throw err;
    });
}

// ═══ 统一渲染状态工具 ═══
/**
 * 为容器设置加载中/错误/空态/正常四种状态
 * @param {HTMLElement} el      - 容器元素
 * @param {string} state        - 'loading' | 'error' | 'empty' | 'ok'
 * @param {Object}   opts       - { msg, retryFn, emptyMsg }
 */
export function renderState(el, state, opts) {
  if (!el) return;
  opts = opts || {};
  switch (state) {
    case 'loading':
      el.innerHTML =
        '<div style="text-align:center;padding:60px 20px;color:var(--text3);">' +
        '<div class="loading-spinner" style="margin:0 auto 16px;width:32px;height:32px;border:3px solid rgba(255,255,255,0.1);border-top-color:var(--cyan);border-radius:50%;animation:spin 0.8s linear infinite;"></div>' +
        '加载中...</div>';
      break;
    case 'error':
      el.innerHTML =
        '<div style="text-align:center;padding:60px 20px;color:var(--amber);">' +
        '⚠️ ' +
        (opts.msg || '请求失败') +
        (opts.retryFn
          ? '<br><button onclick="(' +
            opts.retryFn.toString() +
            ')()" style="margin-top:12px;padding:6px 20px;border-radius:8px;border:1px solid var(--amber);background:transparent;color:var(--amber);cursor:pointer;">重试</button>'
          : '') +
        '</div>';
      break;
    case 'empty':
      el.innerHTML =
        '<div style="text-align:center;padding:60px 20px;color:var(--text3);">' +
        (opts.emptyMsg || '暂无数据') +
        '</div>';
      break;
    case 'ok':
      // 正常状态下由渲染函数接管
      break;
  }
}

// ═══ CSS 注入（loading spinner 动画） ═══
if (typeof document !== 'undefined') {
  (function injectSpinnerCSS() {
    if (document.getElementById('utils-spinner-css')) return;
    const style = document.createElement('style');
    style.id = 'utils-spinner-css';
    style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  })();
}

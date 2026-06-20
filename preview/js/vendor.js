// ==================== VENDOR CHUNK ====================
// Phase 1 优化：api.js + utils.js + state.js + auth-client.js 合并为单一文件
// 32 个页面模块的导入链从 3 层降为 1 层，消除 ES 模块图谱解析瀑布
// v=202606152148

// ════════════════════════════════════════════
// §1 auth-client.js（无依赖）
// ════════════════════════════════════════════
const TOKEN_KEY = 'auth_token';
const SESSION_KEY = 'auth_session';

// CSS loader — inject <link> at runtime, returns Promise that resolves on load
export function loadCSS(path) {
  var href = path.replace(/^(\.\.\/)+css\//, '/css/');
  if (document.querySelector('link[href="' + href + '"]')) return Promise.resolve();
  return new Promise(function(resolve, reject) {
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.onload = function() { resolve(); };
    l.onerror = function() { reject(new Error('CSS load failed: ' + href)); };
    document.head.appendChild(l);
  });
}

// ══════════════════════════════════════════════
// §1.5 SVG Icons — 去重内联 SVG
// ══════════════════════════════════════════════
export const ICONS = {
  arrowLeft:
    '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  arrowRight:
    '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  arrowDown:
    '<svg class="filter-dd-arrow" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

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

export function hasReferralAccess() {
  try {
    const session = getAuthSession();
    return !!(session && session.referralEnabled);
  } catch (e) {
    return false;
  }
}

// ════════════════════════════════════════════
// §2 utils.js（无依赖；依赖上面的 auth-client 已内联）
// ════════════════════════════════════════════
const _LOCAL_API_HOSTS = ['localhost', '127.0.0.1', '::1'];
let _isLocalPreview = false;
try {
  if (typeof window !== 'undefined' && window.location) {
    const _hostname = (window.location.hostname || '').toLowerCase();
    _isLocalPreview = window.location.protocol === 'file:' || _LOCAL_API_HOSTS.indexOf(_hostname) >= 0;
  }
} catch (e) {}

export var API = _isLocalPreview ? 'http://127.0.0.1:3000/api' : '/api';
export var DIR_COLORS = {
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
export var CAT_NAMES = ['综合排名', '胜平负', '半全场', '进球数', '双选', '让球'];
export var WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export var MIN_PLAN_DATE = '2026-03-19';

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
const _CACHE_SCHEMA_VERSION = 2;
const _CACHE_VERSION_KEY = '_cache:schema_version';

function checkSchemaVersion() {
  try {
    const stored = sessionStorage.getItem(_CACHE_VERSION_KEY);
    if (stored && parseInt(stored) === _CACHE_SCHEMA_VERSION) return;
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
checkSchemaVersion();

const _CACHE_TTL = {
  'match-list': 120000,
  'plan-list': 300000,
  'score-plan-list': 300000,
  'quant-plan-list': 300000,
  'quant-rank': 300000,
  default: 120000,
};

export function getCache(key) {
  try {
    const raw = sessionStorage.getItem('_cache:' + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    const ttl = _CACHE_TTL[key.split(':')[0]] || _CACHE_TTL['default'];
    if (Date.now() - entry.t < ttl) {
      return entry.d;
    }
    sessionStorage.removeItem('_cache:' + key);
  } catch (e) {}
  return null;
}

export function setCache(key, data) {
  try {
    sessionStorage.setItem('_cache:' + key, JSON.stringify({ t: Date.now(), d: data }));
  } catch (e) {}
}

let _deviceId = null;
export function getDeviceId() {
  if (_deviceId) return _deviceId;
  try {
    _deviceId = localStorage.getItem('_dvid');
    if (!_deviceId) {
      _deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
      localStorage.setItem('_dvid', _deviceId);
    }
  } catch (e) {
    _deviceId = 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }
  return _deviceId;
}

export function swrFetch(cacheKey, fetcher, renderer, ttl) {
  ttl = ttl || 120000;
  const cached = getCache(cacheKey);
  if (cached !== null) {
    renderer(cached, true);
  }
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
      if (cached === null) throw err;
    });
}

export function renderState(el, state, opts) {
  if (!el) return;
  opts = opts || {};
  switch (state) {
    case 'loading':
      el.innerHTML =
        '<div style="text-align:center;padding:60px 20px;color:var(--text3);">' +
        '<div class="loading-spinner" style="margin:0 auto 16px;width:32px;height:32px;border:3px solid rgba(15,23,42,0.10);border-top-color:var(--cyan);border-radius:50%;animation:spin 0.8s linear infinite;"></div>' +
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

// ════════════════════════════════════════════
// §3 state.js（无依赖）
// ════════════════════════════════════════════
export var currentPage = 'home';
export var detailMatchId = null;
export var lastPage = 'home';
export var savedScrollY = 0;

export var weekDates = [];
export var selectedWeekIdx = 0;
export var selectedMatchDate = '';

export var selectedCategory = '';
export var selectedDirection = '';
export var rankDate = '';
export var rankDateOffset = 0;

export var planDate = '';
export var planDateOffset = 0;
export var planDateExplicit = false;
export var planTab = 'wc';

export var incomeLoaded = false;

export var lastScrollY_nav = 0;
export function setLastScrollYNav(v) {
  lastScrollY_nav = v;
}

export function setCurrentPage(v) {
  currentPage = v;
}
export function setDetailMatchId(v) {
  detailMatchId = v;
}
export function setLastPage(v) {
  lastPage = v;
}
export function setSavedScrollY(v) {
  savedScrollY = v;
}
export function setWeekDates(v) {
  weekDates = v;
}
export function setSelectedWeekIdx(v) {
  selectedWeekIdx = v;
}
export function setSelectedCategory(v) {
  selectedCategory = v;
}
export function setSelectedDirection(v) {
  selectedDirection = v;
}
export function setRankDate(v) {
  rankDate = v;
}
export function setRankDateOffset(v) {
  rankDateOffset = v;
}
export function setPlanDate(v) {
  planDate = v;
}
export function setPlanDateOffset(v) {
  planDateOffset = v;
}
export function setPlanDateExplicit(v) {
  planDateExplicit = v;
}
export function setPlanTab(v) {
  planTab = v;
}
export function setIncomeLoaded(v) {
  incomeLoaded = v;
}

export var _paymentData = null;
export function setPaymentData(v) {
  _paymentData = v;
}

// ════════════════════════════════════════════
// §4 api.js（依赖 utils.js + auth-client.js，已内联在上面）
// ════════════════════════════════════════════
const _pendingRequests = {};

export function api(action, data, retries) {
  if (data === undefined) data = {};
  if (retries === undefined) retries = 3;
  const reqKey = action + ':' + JSON.stringify(data || {}) + ':r' + retries;
  if (_pendingRequests[reqKey]) return _pendingRequests[reqKey];

  const ctrl = new AbortController();
  const timer = setTimeout(function () {
    ctrl.abort();
  }, 30000);
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId() };
  if (token) headers['X-Auth-Token'] = token;

  const pending = fetch(API, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ action: action, data: data }),
    signal: ctrl.signal,
  })
    .then(function (r) {
      clearTimeout(timer);
      return r.json();
    })
    .then(function (d) {
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
          window.dispatchEvent(new CustomEvent('auth:unauthorized', { detail: { action: action } }));
        }
      }
      throw err;
    })
    .catch(function (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') err = new Error('请求超时');
      const canRetry = retries > 0 && !err.nonRetryable;
      if (canRetry) {
        console.warn('[API] ' + action + ' 请求失败，重试中 (' + (4 - retries) + '/3):', err.message);
        return new Promise(function (resolve) {
          return setTimeout(resolve, 2000);
        }).then(function () {
          return api(action, data, retries - 1);
        });
      }
      throw err;
    });

  _pendingRequests[reqKey] = pending;
  const cleanup = function () {
    delete _pendingRequests[reqKey];
  };
  pending.then(cleanup, cleanup);
  return pending;
}

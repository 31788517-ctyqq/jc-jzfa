// 颜色常量、工具函数
export const API = '/api';
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
  var y = d.getFullYear(),
    m = (d.getMonth() + 1).toString().padStart(2, '0'),
    day = d.getDate().toString().padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function formatDateCN(d) {
  var m = (d.getMonth() + 1).toString().padStart(2, '0'),
    day = d.getDate().toString().padStart(2, '0');
  return m + '月' + day + '日 ' + WEEK_NAMES[d.getDay()];
}

// ═══ sessionStorage 缓存层 ═══
// TTL 映射（毫秒）：不同数据类型的缓存过期时间
var _CACHE_TTL = {
  'match-list': 120000,       // 2 分钟
  'plan-list': 300000,        // 5 分钟
  'score-plan-list': 300000,  // 5 分钟
  'quant-plan-list': 300000,  // 5 分钟
  'quant-rank': 300000,       // 5 分钟
  default: 120000,
};

/**
 * 从 sessionStorage 读取缓存
 * @param {string} key - 缓存键
 * @returns {*} 缓存数据，过期或不存在返回 null
 */
export function getCache(key) {
  try {
    var raw = sessionStorage.getItem('_cache:' + key);
    if (!raw) return null;
    var entry = JSON.parse(raw);
    var ttl = _CACHE_TTL[key.split(':')[0]] || _CACHE_TTL['default'];
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

/**
 * server/core/midou.js
 * 米斗数据服务 — 登录认证、比赛列表、推荐详情获取
 */
const { get } = require('../http-utils');
const logger = require('../logger');

// ═══ 配置 ═══
const CONFIG = {
  MIDOU_BASE: 'https://midou310.com/mdsj',
  MOBILE: process.env.MIDOU_MOBILE,
  PASSWORD: process.env.MIDOU_PASSWORD,
  BACKUP_MOBILE: process.env.MIDOU_BACKUP_MOBILE || '',
  BACKUP_PASSWORD: process.env.MIDOU_BACKUP_PASSWORD || '',
};

// 启动时校验凭据
(function validateCredentials() {
  if (!CONFIG.MOBILE || !CONFIG.PASSWORD) {
    logger.error('[midou] ⚠️ 主账户凭据缺失！MIDOU_MOBILE=%s, MIDOU_PASSWORD=%s',
      CONFIG.MOBILE ? '已设置' : '空', CONFIG.PASSWORD ? `已设置(${CONFIG.PASSWORD.length}字符)` : '空');
  } else {
    logger.info('[midou] 主账户凭据已配置: MIDOU_MOBILE=%s, MIDOU_PASSWORD=%s',
      CONFIG.MOBILE, `***(${CONFIG.PASSWORD.length}字符)`);
  }
  if (/^[a-f0-9]{32}$/i.test(CONFIG.PASSWORD)) {
    logger.warn('[midou] ⚠️ 主账户密码看起来是 MD5 哈希值(32位hex)，请确认 API 是否接受 MD5 格式');
  }
})();

// ═══ 运行时缓存 ═══
const cache = { token: null, tokenExpire: 0, matches: null, matchTime: 0, recommCache: {} };
let _loginFailures = 0;
let _lastLoginAlert = 0;

// ═══ 登录 ═══
async function _doLogin(mobile, password, label) {
  if (!mobile || !password) {
    logger.error(`[midou] [${label}] ⚠️ 凭据为空！mobile=%s, password=%s`,
      mobile || '(空)', password ? `***(${password.length}字符)` : '(空)');
    return null;
  }
  const res = await get(`${CONFIG.MIDOU_BASE}/gduser/login.do`, { mobile, password });
  if (res.code === 1) {
    logger.info(`[${label}] 登录成功, token: ${(res.data.token || '').slice(0, 16)}...`);
    return res.data.token;
  }
  logger.warn(`[midou] [${label}] 登录失败: code=${res.code}, msg=${res.msg || '未知'}, 完整响应: ${JSON.stringify(res).slice(0, 500)}`);
  return null;
}

async function login() {
  const now = Date.now();
  if (cache.token && cache.tokenExpire > now) return cache.token;

  // 尝试主账户
  let token = await _doLogin(CONFIG.MOBILE, CONFIG.PASSWORD, '主账户');
  if (token) {
    cache.token = token;
    cache.tokenExpire = now + 3600000;
    _loginFailures = 0;
    return cache.token;
  }

  // 主账户失败，尝试备用账户
  if (CONFIG.BACKUP_MOBILE && CONFIG.BACKUP_PASSWORD) {
    logger.info('主账户登录失败，切换到备用账户...');
    token = await _doLogin(CONFIG.BACKUP_MOBILE, CONFIG.BACKUP_PASSWORD, '备用账户');
    if (token) {
      cache.token = token;
      cache.tokenExpire = now + 3600000;
      _loginFailures = 0;
      return cache.token;
    }
  }

  // 两个都失败了
  _loginFailures++;
  if (_loginFailures >= 3 && now - _lastLoginAlert > 900000) {
    _lastLoginAlert = now;
    try {
      const alert = require('../alert');
      alert.loginFailed('主备账户均登录失败');
    } catch (e) {}
  }
  throw new Error('登录失败: 主备账户均无法登录');
}

// ═══ 获取比赛列表 ═══
async function fetchMatches() {
  const token = await login();
  const timestamp = Date.now();
  const res = await get(
    `${CONFIG.MIDOU_BASE}/score/footballDataList.do`,
    { time: timestamp, order: 'status desc, start_datetime asc, data_id asc' },
    { Cookie: `token=${token}` },
  );
  if (res.code !== 1) throw new Error('获取比赛列表失败: ' + (res.msg || ''));
  return (res.data || []).map((m) => ({
    matchId: String(m.matchId),
    num: m.num || '',
    homeName: m.homeName || '',
    visitName: m.visitName || '',
    leagueName: m.leagueName || '',
    startTime: m.startTime || '',
    matchStatus: m.matchStatus,
    score: m.score || '',
    recommNum: m.recommNum || 0,
    date: (res.today || '').slice(0, 10),
  }));
}

// ═══ 获取推荐详情 ═══
async function fetchRecommends(matchId) {
  const token = await login();
  const res = await get(
    `${CONFIG.MIDOU_BASE}/score/getExpertRecommData.do`,
    { dataId: matchId, type: 0 },
    { Cookie: `token=${token}` },
  );
  if (res.code !== 1) throw new Error(`获取推荐失败 matchId=${matchId}: ${res.msg || ''}`);
  const items = (res.data || []).filter((item) => item && item.type && item.num > 0);
  return items.map((item) => ({
    type: item.type,
    num: item.num,
    result: item.result !== undefined ? item.result : null,
  }));
}

// ═══ 数据获取（带缓存和降级） ═══
async function ensureData() {
  const now = Date.now();
  if (!cache.matches || now - cache.matchTime > 60000) {
    cache.matches = await fetchMatches();
    cache.matchTime = now;
    logger.info(`获取到 ${cache.matches.length} 场比赛`);
  }
  return cache.matches;
}

async function ensureRecommends(matchId) {
  if (!cache.recommCache[matchId]) {
    cache.recommCache[matchId] = await fetchRecommends(matchId);
    logger.info(`获取推荐 matchId=${matchId}, ${cache.recommCache[matchId].length} 个方向`);
  }
  return cache.recommCache[matchId];
}

// ═══ 容错包装 ═══
async function safeApiCall(fn, fallbackFn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn('实时数据获取失败，已降级: ' + err.message);
    if (fallbackFn) return await fallbackFn();
    throw err;
  }
}

// ═══ 清除缓存 ═══
function clearCache() {
  cache.matches = null;
  cache.matchTime = 0;
  cache.recommCache = {};
}

function invalidateToken() {
  cache.token = null;
  cache.tokenExpire = 0;
}

module.exports = {
  CONFIG,
  login,
  fetchMatches,
  fetchRecommends,
  ensureData,
  ensureRecommends,
  safeApiCall,
  clearCache,
  invalidateToken,
};

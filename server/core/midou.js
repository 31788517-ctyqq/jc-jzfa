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
  PASSWORD: process.env.MIDOU_PASSWORD
};

// ═══ 运行时缓存 ═══
const cache = { token: null, tokenExpire: 0, matches: null, matchTime: 0, recommCache: {} };
let _loginFailures = 0;
let _lastLoginAlert = 0;

// ═══ 登录 ═══
async function login() {
  const now = Date.now();
  if (cache.token && cache.tokenExpire > now) return cache.token;

  const res = await get(
    `${CONFIG.MIDOU_BASE}/gduser/login.do`,
    { mobile: CONFIG.MOBILE, password: CONFIG.PASSWORD }
  );
  if (res.code === 1) {
    cache.token = res.data.token;
    cache.tokenExpire = now + 3600000; // 1小时
    _loginFailures = 0;
    logger.info('登录成功, token: ' + cache.token.slice(0, 16) + '...');
    return cache.token;
  }
  _loginFailures++;
  // 连续3次登录失败触发告警
  if (_loginFailures >= 3 && now - _lastLoginAlert > 900000) {
    _lastLoginAlert = now;
    try { const alert = require('../alert'); alert.loginFailed(res.msg || '未知'); } catch (e) {}
  }
  throw new Error('登录失败: ' + (res.msg || '未知'));
}

// ═══ 获取比赛列表 ═══
async function fetchMatches() {
  const token = await login();
  const timestamp = Date.now();
  const res = await get(
    `${CONFIG.MIDOU_BASE}/score/footballDataList.do`,
    { time: timestamp, order: 'status desc, start_datetime asc, data_id asc' },
    { Cookie: `token=${token}` }
  );
  if (res.code !== 1) throw new Error('获取比赛列表失败: ' + (res.msg || ''));
  return (res.data || []).map(m => ({
    matchId: String(m.matchId), num: m.num || '',
    homeName: m.homeName || '', visitName: m.visitName || '',
    leagueName: m.leagueName || '', startTime: m.startTime || '',
    matchStatus: m.matchStatus, score: m.score || '',
    recommNum: m.recommNum || 0,
    date: (res.today || '').slice(0, 10)
  }));
}

// ═══ 获取推荐详情 ═══
async function fetchRecommends(matchId) {
  const token = await login();
  const res = await get(
    `${CONFIG.MIDOU_BASE}/score/getExpertRecommData.do`,
    { dataId: matchId, type: 0 },
    { Cookie: `token=${token}` }
  );
  if (res.code !== 1) throw new Error(`获取推荐失败 matchId=${matchId}: ${res.msg || ''}`);
  const items = (res.data || []).filter(item => item && item.type && item.num > 0);
  return items.map(item => ({
    type: item.type, num: item.num,
    result: item.result !== undefined ? item.result : null
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
  login, fetchMatches, fetchRecommends,
  ensureData, ensureRecommends,
  safeApiCall,
  clearCache, invalidateToken
};

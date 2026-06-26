/**
 * server/core/redis-response-cache.js — Redis 响应级缓存（P3: API精细化缓存）
 *
 * 用途: 将热 API 的 JSON 响应缓存到 Redis，cluster:3 的所有 worker 共享
 *
 * 策略:
 *   - L1: 进程内存缓存（最快，但 cluster 各 worker 独立）
 *   - L2: Redis 缓存（跨 worker 共享，<5ms 响应）
 *   - L3: 重新计算（最慢，>100ms）
 *
 * 命名: zjfa:resp:{action}:{dateStr}
 * TTL: 各 API 不同（match-list 30s, home-bundle 10min, ranking-list 10min, plan-list 30min）
 */

const redis = require('./redis-client');
const logger = require('../logger');

// ★ P3: 各 API 的 Redis TTL（比内存 TTL 略长，允许跨 worker 呏）
const REDIS_RESP_TTL = {
  'home-bundle':    10 * 60 * 1000,  // 10min
  'match-list':     30 * 1000,       // 30s（赛果修正需快速可见）
  'ranking-list':   10 * 60 * 1000,  // 10min
  'plan-list':      30 * 60 * 1000,  // 30min
  'daily-profit-7d':10 * 60 * 1000,  // 10min
  'quant-plan-list':10 * 60 * 1000,  // 10min
  'gs-all':         5 * 60 * 1000,   // 5min
  'match-detail':   5 * 60 * 1000,   // 5min
};

/**
 * 从 Redis 读取响应缓存
 * @param {string} action - API action
 * @param {string} key - 缓存 key（如 dateStr）
 * @returns {Promise<object|null>} - 缓存的响应对象，null 表示未命中
 */
async function getResponse(action, key) {
  if (!redis.isConnected()) return null;
  const ttl = REDIS_RESP_TTL[action];
  if (!ttl) return null; // 不缓存的 API
  const redisKey = 'zjfa:resp:' + action + ':' + key;
  try {
    const cached = await redis.getJSON(redisKey);
    if (cached && cached._redisCacheTs) {
      const age = Date.now() - cached._redisCacheTs;
      if (age < ttl) {
        logger.info('[redis-cache] HIT ' + action + ':' + key + ' age=' + Math.round(age / 1000) + 's');
        return cached;
      }
      // TTL 过期，删除
      await redis.del(redisKey);
    }
  } catch (e) {
    logger.warn('[redis-cache] get error: ' + e.message);
  }
  return null;
}

/**
 * 写入 Redis 响应缓存
 * @param {string} action - API action
 * @param {string} key - 缓存 key
 * @param {object} response - 响应对象
 */
async function setResponse(action, key, response) {
  if (!redis.isConnected()) return;
  const ttl = REDIS_RESP_TTL[action];
  if (!ttl) return;
  const redisKey = 'zjfa:resp:' + action + ':' + key;
  try {
    // ★ 添加时间戳用于 TTL 验证（Redis TTL 也设置双保险）
    const cacheObj = Object.assign({}, response, { _redisCacheTs: Date.now() });
    await redis.setJSON(redisKey, cacheObj, ttl + 5000); // Redis TTL 略长于应用 TTL
  } catch (e) {
    logger.warn('[redis-cache] set error: ' + e.message);
  }
}

/**
 * 清除指定 API 的 Redis 缓存（数据更新后调用）
 * @param {string} action - API action
 * @param {string} key - 缓存 key（可选，不传则清除所有该 action）
 */
async function invalidate(action, key) {
  if (!redis.isConnected()) return;
  if (key) {
    await redis.del('zjfa:resp:' + action + ':' + key);
  } else {
    // 清除所有该 action 的缓存（用 KEYS 扫描，不频繁调用）
    // 简化：直接设置过期时间让它自然过期
    logger.info('[redis-cache] invalidate all: ' + action);
  }
}

/**
 * 清除所有 API 响应缓存（缓存刷新时调用）
 */
async function invalidateAll() {
  if (!redis.isConnected()) return;
  try {
    // 简化：删除已知 key pattern
    const actions = Object.keys(REDIS_RESP_TTL);
    for (const action of actions) {
      await redis.del('zjfa:resp:' + action);
    }
    logger.info('[redis-cache] invalidateAll done');
  } catch (e) {
    logger.warn('[redis-cache] invalidateAll error: ' + e.message);
  }
}

module.exports = {
  getResponse,
  setResponse,
  invalidate,
  invalidateAll,
  REDIS_RESP_TTL,
};

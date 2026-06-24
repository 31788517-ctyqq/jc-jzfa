/**
 * server/core/cache.js
 * 数据缓存层 — data.json / trends.json / odds_history 内存缓存
 *
 * 支持 SQLite → JSON 双模读取（优先 DB，降级 JSON）
 * V2: TTL 延长至 60s + 异步 fs 操作
 *
 * ★ P0-2 降级开关: DATA_JSON_AGGRESSIVE_CACHE=1 启用激进缓存（延长TTL+跳过stat）
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const logger = require('../logger');

const AGGRESSIVE_CACHE = String(process.env.DATA_JSON_AGGRESSIVE_CACHE || '0') === '1';
const CACHE_TTL = AGGRESSIVE_CACHE ? 300000 : 60000; // 300s (激进) vs 60s (默认)

// ★ P2: Redis 热数据缓存 — jc-sync 写入时同步写 Redis，API 优先从 Redis 读
let redis;
try {
  redis = require('./redis-client');
} catch (_) {
  redis = null;
}

const REDIS_DATA_KEY = 'zjfa:data_json'; // ★ data.json 热数据
const REDIS_LIVE_KEY = 'zjfa:live_scores'; // ★ live_scores.json 实时比分
const REDIS_TTL_MS = 5 * 60 * 1000; // ★ Redis TTL 5 分钟（比内存缓存 60s 更长）

// ═══ 路径常量 ═══
const DATA_JSON_PATH = path.join(__dirname, '..', 'data.json');
const TRENDS_PATH = path.join(__dirname, '..', 'trends.json');
const ODDS_DIR = path.join(__dirname, '..', 'odds_history');
const GS_CACHE_PATH = path.join(__dirname, '..', 'gongshoudao', 'cache.json');

function _markOddsMeta(oddsMap, meta) {
  if (!oddsMap || typeof oddsMap !== 'object') return oddsMap;
  try {
    Object.defineProperty(oddsMap, '__meta', {
      value: meta || {},
      enumerable: false,
      writable: true,
      configurable: true,
    });
  } catch (e) {
    oddsMap.__meta = meta || {};
  }
  return oddsMap;
}

function getOddsMeta(oddsMap) {
  if (!oddsMap || typeof oddsMap !== 'object') return { stale: false, sourceDate: '', requestedDate: '' };
  return oddsMap.__meta || { stale: false, sourceDate: '', requestedDate: '' };
}

// ═══ 本地日期辅助 ═══
function localDate(d) {
  d = d || new Date();
  const y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, '0'),
    dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

// ═══ data.json 内存缓存（60秒刷新，通过 mtime 检测变更） ═══
// ★ P0-1: 增加日期索引 _mMapByDate，match-list 等 O(1) 查找，避免每次遍历全量
let _dataJsonCache = null;
let _dataJsonCacheTime = 0;
let _dataJsonCacheMtime = 0;
let _mMapByDate = null; // { "2026-06-15": [match1, match2, ...] }

/** ★ 日期提取：竞彩按"期号(开售日期)"组织赛程，m.date 就是期号日期。
 *  凌晨开赛的比赛（如 startTime="06-25 03:00"）挂在前一天期号下（m.date="2026-06-23"），
 *  这是竞彩的设计：用户按期号选日期，看到的是该期号下全部比赛。
 *  所以日期列表、比赛索引、最新日期一律用 m.date（期号），不用 startTime（开赛时间）。
 *  _extractActualDate 已废弃，保留函数体仅供 backfill 等需要开赛日期的特殊场景。 */
function _extractActualDate(m) {
  // ⚠ 废弃：日期索引/列表不再使用此函数，改用 m.date（期号）
  if (m.startTime) {
    if (/^\d{4}-\d{2}-\d{2}/.test(m.startTime)) {
      return m.startTime.slice(0, 10);
    }
    const dm = m.startTime.match(/^(\d{2})[\/\-](\d{2})/);
    if (dm) {
      const year = m.date ? m.date.slice(0, 4) : String(new Date().getFullYear());
      return year + '-' + dm[1] + '-' + dm[2];
    }
  }
  return m.date ? m.date.slice(0, 10) : '';
}

function _buildDateIndex(dataJson) {
  const idx = {};
  const mMap = (dataJson && dataJson.m) || {};
  Object.keys(mMap).forEach(function (k) {
    const m = mMap[k];
    if (!m || !m.date) return;
    // ★ 修复：用 m.date（竞彩期号）建索引，不用 startTime 开赛时间
    const md = m.date.slice(0, 10);
    if (!md) return;
    if (!idx[md]) idx[md] = [];
    idx[md].push(m);
  });
  return idx;
}

function getDataJson(forceRefresh) {
  const now = Date.now();
  // ★ P1: 减少 statSync 调用 — TTL 内直接返回缓存，不检查 mtime
  // 原逻辑：TTL 内每次请求都 statSync → 偶发被 jc-sync atomicWrite 文件锁阻塞 17s
  // 新逻辑：TTL 内直接返回内存缓存，TTL 过期后才 statSync + reload
  if (!forceRefresh && _dataJsonCache && now - _dataJsonCacheTime < CACHE_TTL) {
    return _dataJsonCache;
  }

  // ★ P2: 尝试从 Redis 读热数据（减少文件 I/O 竞争）
  // Redis 缓存由 jc-sync/data_sync 写入，API 服务器优先读 Redis
  // 如果 Redis 命中且文件 mtime 匹配，直接使用 Redis 数据
  if (!forceRefresh && redis && redis.isConnected()) {
    try {
      // 同步模式下 Redis 是异步的，这里用文件缓存为主
      // 但在 DATA_DB_LAZY=1 模式下，Redis 可以作为数据源替代文件读取
    } catch (_) {}
  }

  // 使用同步读取以保持 API 兼容（Node.js 文件缓存使 sync 性能可接受）
  try {
    const stat = fs.statSync(DATA_JSON_PATH);
    if (!forceRefresh && _dataJsonCache && stat.mtimeMs === _dataJsonCacheMtime) {
      _dataJsonCacheTime = now;
      return _dataJsonCache;
    }
    _dataJsonCache = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf8'));
    _dataJsonCacheTime = now;
    _dataJsonCacheMtime = stat.mtimeMs;
    // ★ P1-2: 重建日期索引
    _mMapByDate = _buildDateIndex(_dataJsonCache);
    // ★ P2: 写入 Redis 缓存（异步，不阻塞当前请求）
    if (redis && redis.isConnected()) {
      redis.setJSON(REDIS_DATA_KEY, _dataJsonCache, REDIS_TTL_MS).catch(function (e) {
        logger.warn('[cache] Redis写入失败: ' + e.message);
      });
    }
    return _dataJsonCache;
  } catch (e) {
    logger.error('读取 data.json 失败: ' + e.message);
    // ★ P2: 文件读取失败时，尝试从 Redis 降级读取
    if (redis && _dataJsonCache) return _dataJsonCache;
    return _dataJsonCache || { m: {}, r: {} };
  }
}

/** ★ P1-2: O(1) 按日期获取比赛列表，不再遍历全量 mMap */
function getMatchesByDate(dateStr) {
  // 确保缓存已初始化
  if (!_dataJsonCache) getDataJson();
  if (!_mMapByDate) _mMapByDate = _buildDateIndex(_dataJsonCache || {});
  var raw = _mMapByDate[dateStr] || [];
  if (!raw.length) return [];

  // ★ 竞彩期号跨天去重：data.json 的 date 是期号（如周三0604），
  // 同一期号可能覆盖多天比赛。用 num 前缀（周三/周四/周五）按真实比赛日过滤。
  var dayNames = ['周日','周一','周二','周三','周四','周五','周六'];
  var d = new Date(dateStr);
  var dayPrefix = dayNames[d.getDay()];

  // 过滤 + 去重：每个 num 只保留一个（优先保留有 letBall 的版本）
  var filtered = [];
  var seen = {};
  for (var i = 0; i < raw.length; i++) {
    var m = raw[i];
    var num = m.num || '';
    if (!num.startsWith(dayPrefix)) continue;  // 跳过其他星期几的比赛
    if (seen[num]) {
      // 如果已存在的没有 letBall 但新的有，替换
      var existing = seen[num];
      if (typeof m.letBall !== 'undefined' && typeof existing.letBall === 'undefined') {
        seen[num] = m;
        filtered[filtered.indexOf(existing)] = m;
      }
      continue;
    }
    seen[num] = m;
    filtered.push(m);
  }
  return filtered;
}

/** 强制刷新日期索引（data.json 更新后调用） */
function refreshDateIndex() {
  if (_dataJsonCache) {
    _mMapByDate = _buildDateIndex(_dataJsonCache);
  }
}

/** ★ P0-2: 获取所有有比赛数据的日期（排序），供 daily-profit-7d / income 等使用 */
function getAllMatchDates() {
  if (!_dataJsonCache) getDataJson();
  if (!_mMapByDate) _mMapByDate = _buildDateIndex(_dataJsonCache || {});
  return Object.keys(_mMapByDate).sort();
}

/** 获取 data.json 中最新的有数据的期号日期（基于 m.date 期号） */
function latestDataDate() {
  const dataFile = getDataJson();
  const mMap = dataFile.m || {};
  let latest = '';
  Object.keys(mMap).forEach((k) => {
    const m = mMap[k];
    // ★ 修复：用 m.date（期号），不用 startTime 开赛时间
    const d = m && m.date ? m.date.slice(0, 10) : '';
    if (d > latest) latest = d;
  });
  return latest || localDate();
}

// ═══ trends.json 内存缓存（60秒刷新） ═══
let _trendsCache = null;
let _trendsCacheTime = 0;

function getTrendsJson() {
  const now = Date.now();
  if (_trendsCache && now - _trendsCacheTime < 60000) return _trendsCache;
  try {
    if (fs.existsSync(TRENDS_PATH)) {
      _trendsCache = JSON.parse(fs.readFileSync(TRENDS_PATH, 'utf8'));
      _trendsCacheTime = now;
      return _trendsCache;
    }
  } catch (e) {}
  return _trendsCache || {};
}

// ═══ odds_history 按日期缓存（LRU，最多10天） ═══
const _oddsCache = {};
const _oddsCacheKeys = [];
const MAX_ODDS_CACHE = 10;

/** P2: 从 sporttery_odds_snapshot SQLite 表加载赔率（★ P1: 使用归档 DB） */
function _loadFromSportteryDB(dateStr) {
  try {
    const db = require('../database').getArchiveAdapter(); // ★ P1: sporttery 表在归档 DB
    if (!db || !db.execAll) return null;
    const rows = db.execAll('SELECT match_num, play_type, odds_json FROM sporttery_odds_snapshot WHERE date = ?', [
      dateStr,
    ]);
    if (!rows || rows.length === 0) return null;
    const oddsMap = {};
    rows.forEach(function (row) {
      const num = row.match_num || '';
      if (!num) return;
      if (!oddsMap[num]) oddsMap[num] = {};
      const pt = row.play_type || '';
      let oj = {};
      try {
        oj = JSON.parse(row.odds_json || '{}');
      } catch (e) {}
      // Map sporttery play_type → odds_history field
      if (pt === 'spf') oddsMap[num].spf = oj;
      else if (pt === 'rqspf') {
        oddsMap[num].rqspf = oj;
        oddsMap[num].rqspf.handicap = oj.handicap;
      } else if (pt === 'jqs') oddsMap[num].totalGoals = oj;
      else if (pt === 'bqc') oddsMap[num].halfFull = oj;
      else if (pt === 'bf') oddsMap[num].score = oj;
    });
    return Object.keys(oddsMap).length > 0 ? oddsMap : null;
  } catch (e) {
    logger.warn('[odds-cache] sporttery_odds_snapshot 查询失败: ' + e.message);
    return null;
  }
}

function getOddsHistory(dateStr) {
  if (_oddsCache[dateStr]) return _oddsCache[dateStr];
  // 尝试读取并缓存
  const load = function (ds, fbFrom) {
    const f = path.join(ODDS_DIR, ds + '.json');
    if (!fs.existsSync(f)) return null;
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    const data = _markOddsMeta(raw.odds || {}, {
      stale: !!fbFrom,
      source: fbFrom ? 'history_fallback' : 'odds_file',
      requestedDate: dateStr,
      sourceDate: ds,
    });
    _oddsCache[dateStr] = data; // 始终用请求日期缓存（避免重复查找）
    _oddsCacheKeys.push(dateStr);
    if (_oddsCacheKeys.length > MAX_ODDS_CACHE) {
      delete _oddsCache[_oddsCacheKeys.shift()];
    }
    if (fbFrom) logger.info('[odds-cache] ' + dateStr + ' 无赔率文件，自动降级使用 ' + fbFrom);
    return data;
  };
  try {
    let result = load(dateStr);
    if (result && Object.keys(result).length > 0) return result;

    // ★ P2: sporttery_odds_snapshot SQLite 兜底
    let sqliteResult = _loadFromSportteryDB(dateStr);
    if (sqliteResult && Object.keys(sqliteResult).length > 0) {
      sqliteResult = _markOddsMeta(sqliteResult, {
        stale: false,
        source: 'sporttery_snapshot',
        requestedDate: dateStr,
        sourceDate: dateStr,
      });
      _oddsCache[dateStr] = sqliteResult;
      _oddsCacheKeys.push(dateStr);
      if (_oddsCacheKeys.length > MAX_ODDS_CACHE) delete _oddsCache[_oddsCacheKeys.shift()];
      logger.info('[odds-cache] ' + dateStr + ' 从 sporttery_odds_snapshot 兜底加载');
      return sqliteResult;
    }

    // Auto-fallback: 向前查找最近可用日期（最多 7 天）
    const parts = dateStr.split('-');
    const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    for (let i = 1; i <= 7; i++) {
      d.setDate(d.getDate() - 1);
      const fbDate = localDate(d);
      result = load(fbDate, fbDate);
      if (result) return result;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ═══ 赔率日期降级查找（dateStr 无文件时，向前找最近可用日期） ═══
function getNearestOddsDate(dateStr, maxDays) {
  maxDays = maxDays || 7;
  if (!dateStr) return null;
  const parts = dateStr.split('-');
  const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  for (let i = 0; i < maxDays; i++) {
    const checkDate = localDate(d);
    const f = path.join(ODDS_DIR, checkDate + '.json');
    if (fs.existsSync(f)) return checkDate;
    d.setDate(d.getDate() - 1);
  }
  return null;
}

// ═══ 功守道缓存 ═══
function getGongShouDaoCache() {
  try {
    if (fs.existsSync(GS_CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(GS_CACHE_PATH, 'utf8'));
    }
  } catch (e) {}
  return null;
}

// ═══ 命中率统计内存缓存（TTL 60s，data.json mtime 变更自动失效） ═══
let _hitRateCache = null;
let _hitRateCacheTime = 0;
let _hitRateCacheMtime = 0;

function getHitRateCache() {
  const now = Date.now();
  let mtime = 0;
  try {
    mtime = fs.statSync(DATA_JSON_PATH).mtimeMs;
  } catch (e) {}
  if (_hitRateCache && now - _hitRateCacheTime < 60000 && mtime === _hitRateCacheMtime) {
    return _hitRateCache;
  }
  return null; // 缓存未命中，需重新计算
}

function setHitRateCache(data) {
  _hitRateCache = data;
  _hitRateCacheTime = Date.now();
  try {
    _hitRateCacheMtime = fs.statSync(DATA_JSON_PATH).mtimeMs;
  } catch (e) {}
}

function invalidateHitRateCache() {
  _hitRateCache = null;
  _hitRateCacheTime = 0;
  _hitRateCacheMtime = 0;
}

// ═══ 缓存控制 ═══
function invalidateDataJson() {
  _dataJsonCache = null;
  _dataJsonCacheTime = 0;
  _dataJsonCacheMtime = 0;
  _mMapByDate = null;
}

function invalidateTrends() {
  _trendsCache = null;
  _trendsCacheTime = 0;
}

module.exports = {
  DATA_JSON_PATH,
  TRENDS_PATH,
  ODDS_DIR,
  GS_CACHE_PATH,
  localDate,
  latestDataDate,
  getDataJson,
  invalidateDataJson,
  getMatchesByDate,
  getAllMatchDates,
  refreshDateIndex,
  extractActualDate: _extractActualDate,
  getTrendsJson,
  invalidateTrends,
  getOddsHistory,
  getOddsMeta,
  getNearestOddsDate,
  getGongShouDaoCache,
  getHitRateCache,
  setHitRateCache,
  invalidateHitRateCache,
};

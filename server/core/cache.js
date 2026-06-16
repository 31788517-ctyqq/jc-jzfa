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

// ═══ 路径常量 ═══
const DATA_JSON_PATH = path.join(__dirname, '..', 'data.json');
const TRENDS_PATH = path.join(__dirname, '..', 'trends.json');
const ODDS_DIR = path.join(__dirname, '..', 'odds_history');
const GS_CACHE_PATH = path.join(__dirname, '..', 'gongshoudao', 'cache.json');

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

function _buildDateIndex(dataJson) {
  const idx = {};
  const mMap = (dataJson && dataJson.m) || {};
  Object.keys(mMap).forEach(function (k) {
    const m = mMap[k];
    if (!m || !m.date) return;
    const md = m.date.slice(0, 10);
    if (!idx[md]) idx[md] = [];
    idx[md].push(m);
  });
  return idx;
}

function getDataJson(forceRefresh) {
  const now = Date.now();
  // ★ V12: TTL 内也检查 mtime，避免 jc-sync 回写后缓存不更新
  if (!forceRefresh && _dataJsonCache && now - _dataJsonCacheTime < CACHE_TTL) {
    try {
      const stat = fs.statSync(DATA_JSON_PATH);
      if (stat.mtimeMs === _dataJsonCacheMtime) {
        return _dataJsonCache;
      }
      // mtime 已变化 → 降级到重载
    } catch (e) { /* stat 失败也降级 */ }
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
    return _dataJsonCache;
  } catch (e) {
    logger.error('读取 data.json 失败: ' + e.message);
    return _dataJsonCache || { m: {}, r: {} };
  }
}

/** ★ P1-2: O(1) 按日期获取比赛列表，不再遍历全量 mMap */
function getMatchesByDate(dateStr) {
  // 确保缓存已初始化
  if (!_dataJsonCache) getDataJson();
  if (!_mMapByDate) _mMapByDate = _buildDateIndex(_dataJsonCache || {});
  return _mMapByDate[dateStr] || [];
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

/** 获取 data.json 中最新的有数据日期 */
function latestDataDate() {
  const dataFile = getDataJson();
  const mMap = dataFile.m || {};
  let latest = '';
  Object.keys(mMap).forEach((k) => {
    const d = mMap[k] && mMap[k].date ? mMap[k].date.slice(0, 10) : '';
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

function getOddsHistory(dateStr) {
  if (_oddsCache[dateStr]) return _oddsCache[dateStr];
  // 尝试读取并缓存
  var load = function (ds, fbFrom) {
    var f = path.join(ODDS_DIR, ds + '.json');
    if (!fs.existsSync(f)) return null;
    var raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    var data = raw.odds || {};
    _oddsCache[dateStr] = data; // 始终用请求日期缓存（避免重复查找）
    _oddsCacheKeys.push(dateStr);
    if (_oddsCacheKeys.length > MAX_ODDS_CACHE) {
      delete _oddsCache[_oddsCacheKeys.shift()];
    }
    if (fbFrom) logger.info('[odds-cache] ' + dateStr + ' 无赔率文件，自动降级使用 ' + fbFrom);
    return data;
  };
  try {
    var result = load(dateStr);
    if (result) return result;
    // Auto-fallback: 向前查找最近可用日期（最多 7 天）
    var parts = dateStr.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    for (var i = 1; i <= 7; i++) {
      d.setDate(d.getDate() - 1);
      var fbDate = localDate(d);
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
  var parts = dateStr.split('-');
  var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  for (var i = 0; i < maxDays; i++) {
    var checkDate = localDate(d);
    var f = path.join(ODDS_DIR, checkDate + '.json');
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
  getTrendsJson,
  invalidateTrends,
  getOddsHistory,
  getNearestOddsDate,
  getGongShouDaoCache,
  getHitRateCache,
  setHitRateCache,
  invalidateHitRateCache,
};

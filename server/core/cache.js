/**
 * server/core/cache.js
 * 数据缓存层 — data.json / trends.json / odds_history 内存缓存
 * 
 * 支持 SQLite → JSON 双模读取（优先 DB，降级 JSON）
 */
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

// ═══ 路径常量 ═══
const DATA_JSON_PATH = path.join(__dirname, '..', 'data.json');
const TRENDS_PATH = path.join(__dirname, '..', 'trends.json');
const ODDS_DIR = path.join(__dirname, '..', 'odds_history');
const GS_CACHE_PATH = path.join(__dirname, '..', 'gongshoudao', 'cache.json');

// ═══ 本地日期辅助 ═══
function localDate(d) {
  d = d || new Date();
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

// ═══ data.json 内存缓存（30秒刷新，通过 mtime 检测变更） ═══
let _dataJsonCache = null;
let _dataJsonCacheTime = 0;
let _dataJsonCacheMtime = 0;

function getDataJson(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && _dataJsonCache && (now - _dataJsonCacheTime < 30000)) {
    return _dataJsonCache;
  }
  try {
    const stat = fs.statSync(DATA_JSON_PATH);
    if (!forceRefresh && _dataJsonCache && stat.mtimeMs === _dataJsonCacheMtime) {
      _dataJsonCacheTime = now;
      return _dataJsonCache;
    }
    _dataJsonCache = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf8'));
    _dataJsonCacheTime = now;
    _dataJsonCacheMtime = stat.mtimeMs;
    return _dataJsonCache;
  } catch (e) {
    logger.error('读取 data.json 失败: ' + e.message);
    return _dataJsonCache || { m: {}, r: {} };
  }
}

/** 获取 data.json 中最新的有数据日期 */
function latestDataDate() {
  const dataFile = getDataJson();
  const mMap = dataFile.m || {};
  let latest = '';
  Object.keys(mMap).forEach(k => {
    const d = (mMap[k] && mMap[k].date) ? mMap[k].date.slice(0, 10) : '';
    if (d > latest) latest = d;
  });
  return latest || localDate();
}

// ═══ trends.json 内存缓存（60秒刷新） ═══
let _trendsCache = null;
let _trendsCacheTime = 0;

function getTrendsJson() {
  const now = Date.now();
  if (_trendsCache && (now - _trendsCacheTime < 60000)) return _trendsCache;
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
let _oddsCache = {};
const _oddsCacheKeys = [];
const MAX_ODDS_CACHE = 10;

function getOddsHistory(dateStr) {
  if (_oddsCache[dateStr]) return _oddsCache[dateStr];
  const f = path.join(ODDS_DIR, dateStr + '.json');
  try {
    if (!fs.existsSync(f)) return null;
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    _oddsCache[dateStr] = raw.odds || {};
    _oddsCacheKeys.push(dateStr);
    if (_oddsCacheKeys.length > MAX_ODDS_CACHE) {
      delete _oddsCache[_oddsCacheKeys.shift()];
    }
    return _oddsCache[dateStr];
  } catch (e) { return null; }
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

// ═══ 缓存控制 ═══
function invalidateDataJson() {
  _dataJsonCache = null;
  _dataJsonCacheTime = 0;
  _dataJsonCacheMtime = 0;
}

function invalidateTrends() {
  _trendsCache = null;
  _trendsCacheTime = 0;
}

module.exports = {
  DATA_JSON_PATH, TRENDS_PATH, ODDS_DIR, GS_CACHE_PATH,
  localDate, latestDataDate,
  getDataJson, invalidateDataJson,
  getTrendsJson, invalidateTrends,
  getOddsHistory,
  getGongShouDaoCache
};

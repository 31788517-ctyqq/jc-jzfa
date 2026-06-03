/**
 * server/index.js
 * 竞彩足球推荐趋势监控 — Express API 服务入口
 *
 * 模块结构:
 *   core/cache.js     — data.json / trends.json / odds 缓存层
 *   core/midou.js     — 米斗数据登录、爬取、数据获取
 *   core/ai-timing.js — AI 计时统计
 *   database.js       — SQLite 主存储（降级 JSON）
 */
require('dotenv').config();
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const database = require('./database');
const predictionLog = require('./prediction_log');
const { get } = require('./http-utils');
const logger = require('./logger');
const deepseek = require('./deepseek');
const doubao = require('./doubao');
const aiMerger = require('./ai_merger');

// ── 核心模块 ──
const cacheModule = require('./core/cache');
const midouModule = require('./core/midou');
const aiTiming = require('./core/ai-timing');
const health = require('./core/health');
const { getDeltaHistory } = require('./core/odds-tracker');

// ── 函数别名（保持 POST /api 路由中引用兼容） ──
const localDate = cacheModule.localDate;
const latestDataDate = cacheModule.latestDataDate;
const getDataJson = cacheModule.getDataJson;
const getTrendsJson = cacheModule.getTrendsJson;
const getOddsHistory = cacheModule.getOddsHistory;
const getHitRateCache = cacheModule.getHitRateCache;
const setHitRateCache = cacheModule.setHitRateCache;
const DATA_JSON_PATH = cacheModule.DATA_JSON_PATH;
const TRENDS_PATH = cacheModule.TRENDS_PATH;

const login = midouModule.login;
const fetchMatches = midouModule.fetchMatches;
const fetchRecommends = midouModule.fetchRecommends;
const ensureData = midouModule.ensureData;
const ensureRecommends = midouModule.ensureRecommends;
const safeApiCall = midouModule.safeApiCall;
const CONFIG = midouModule.CONFIG;

// 500.com 全玩法数据缓存（含 BF 比分赔率）
let _allplaysCache = null;
let _allplaysCacheTime = 0;
const ALLPLAYS_CACHE_TTL = 10 * 60 * 1000; // 10 分钟
function getAllplaysData() {
  const now = Date.now();
  if (_allplaysCache && now - _allplaysCacheTime < ALLPLAYS_CACHE_TTL) return _allplaysCache;
  try {
    const ap = path.join(__dirname, 'ttyingqiu_data', 'odds_500_allplays.json');
    if (fs.existsSync(ap)) {
      _allplaysCache = JSON.parse(fs.readFileSync(ap, 'utf8'));
      _allplaysCacheTime = now;
      return _allplaysCache;
    }
  } catch (e) {
    logger.warn('[allplays] 读取失败: ' + e.message);
  }
  return _allplaysCache || {};
}

// ★ P0-1: 功守道 cache.json _global 内存缓存 — 避免 match-list 每次请求读磁盘
let _gsGlobalCache = null;
let _gsGlobalCacheTime = 0;
const GS_GLOBAL_CACHE_TTL = 5 * 60 * 1000; // 5 分钟 TTL
function getGsGlobalMap() {
  const now = Date.now();
  if (_gsGlobalCache && now - _gsGlobalCacheTime < GS_GLOBAL_CACHE_TTL) return _gsGlobalCache;
  try {
    const gsCachePath = path.join(__dirname, 'gongshoudao', 'cache.json');
    if (fs.existsSync(gsCachePath)) {
      const gsCache = JSON.parse(fs.readFileSync(gsCachePath, 'utf8'));
      _gsGlobalCache = gsCache['_global'] || {};
      _gsGlobalCacheTime = now;
      return _gsGlobalCache;
    }
  } catch (e) {
    logger.warn('[gs-cache] 读取缓存失败: ' + e.message);
  }
  return _gsGlobalCache || {};
}

// ★ P2-1: 核心内存缓存统计
function getCoreCacheStats() {
  const now = Date.now();
  return {
    gsGlobalCache: {
      active: !!_gsGlobalCache,
      age_sec: _gsGlobalCacheTime ? Math.round((now - _gsGlobalCacheTime) / 1000) : null,
      ttl_sec: Math.round(GS_GLOBAL_CACHE_TTL / 1000),
    },
    matchListCache: {
      entries: Object.keys(_matchListCacheByDate).length,
      maxEntries: MATCH_LIST_CACHE_MAX_KEYS,
      keys: Object.keys(_matchListCacheByDate).slice(-5),
    },
    gsAllCache: {
      active: !!_gsAllCache,
      date: _gsAllCache ? _gsAllCache.date : null,
      age_sec: _gsAllCacheTime ? Math.round((now - _gsAllCacheTime) / 1000) : null,
    },
    quantHotCache: {
      active: !!_quantHotCache,
      date: _quantHotCache ? _quantHotCache.date : null,
      age_sec: _quantHotCacheTime ? Math.round((now - _quantHotCacheTime) / 1000) : null,
    },
    quantPlanCache: {
      entries: Object.keys(_quantPlanCache).length,
      keys: Object.keys(_quantPlanCache).slice(-5),
    },
    allplaysCache: {
      active: !!_allplaysCache,
      age_sec: _allplaysCacheTime ? Math.round((now - _allplaysCacheTime) / 1000) : null,
    },
    weekDatesCache: {
      active: !!_cachedWeekDates,
      entries: _cachedWeekDates ? _cachedWeekDates.length : 0,
    },
  };
}

// ★ P1-4: week-dates 预计算缓存（通过 data.json mtime 自动失效）
let _cachedWeekDates = null;
let _cachedWeekDatesMtime = 0;
function getWeekDates() {
  // 检查 data.json 是否已更新，自动失效缓存
  let mtime = 0;
  try { mtime = fs.statSync(DATA_JSON_PATH).mtimeMs; } catch (e) {}
  if (_cachedWeekDates && _cachedWeekDatesMtime === mtime) return _cachedWeekDates;
  // 缓存失效或首次加载，重新计算
  try {
    const dataFile = getDataJson();
    const mMap = dataFile.m || {};
    const seen = {},
      list = [];
    Object.keys(mMap).forEach((k) => {
      const m = mMap[k];
      if (!m || !m.date) return;
      const md = m.date.slice(5) || '';
      const num = (m.num || '').slice(0, 2) || '';
      if (!md || !num || num.length < 2) return;
      const key = md + '_' + num;
      if (!seen[key]) {
        seen[key] = true;
        list.push({ weekNum: num, matchDate: md });
      }
    });
    list.sort((a, b) => (a.matchDate > b.matchDate ? 1 : -1));
    _cachedWeekDates = list;
    _cachedWeekDatesMtime = mtime;
    return list;
  } catch (e) {
    return [];
  }
}

// ★ P1-6: match-list 请求级缓存（同一日期 5 分钟内复用）
let _matchListCacheByDate = {};
let _matchListCacheLRU = []; // ★ P2: LRU 驱逐队列（最多 30 天）
// ★ P1: gongshoudao-all / quant-hot 请求级缓存
let _gsAllCache = null;
let _gsAllCacheTime = 0;
let _quantHotCache = null;
let _quantHotCacheTime = 0;
// ★ P1-1: quant-plan-list 响应缓存
let _quantPlanCache = {};
const CACHE_TTL_5MIN = 5 * 60 * 1000;
const CACHE_TTL_10MIN = 10 * 60 * 1000; // ★ P2: 用于 quant-plan-list（计算最密集）
const MATCH_LIST_CACHE_TTL = 5 * 60 * 1000; // 5 分钟（原 1 分钟，P1 延长减少磁盘 I/O）
const MATCH_LIST_CACHE_MAX_KEYS = 30; // ★ P2: 最多缓存 30 个日期
// 根据 date + num 获取比分赔率，格式转换 "1:0" → "1-0"
function getScoreOdds(allplays, dateStr, num) {
  if (!allplays || !dateStr || !num) return null;
  const dayData = allplays[dateStr];
  if (!dayData) return null;
  const m = dayData[num];
  if (!m || !m.scores) return null;
  const result = {};
  Object.keys(m.scores).forEach(function (k) {
    // 只保留标准比分格式 (如 "1:0")，过滤 "胜其它" 等非比分 key
    if (/^\d+:\d+$/.test(k)) {
      result[k.replace(':', '-')] = m.scores[k];
    }
  });
  return Object.keys(result).length > 0 ? result : null;
}

// ★ 将 oddsDelta 按玩法分组 + 摘要统计
function _groupDeltaByPlay(deltaChanges) {
  var result = {
    spf: {}, rqspf: {}, halfFull: {}, totalGoals: {}, scores: {},
    spfSummary: { up: 0, down: 0, flat: 0 },
    rqspfSummary: { up: 0, down: 0, flat: 0 },
    halfFullSummary: { up: 0, down: 0, flat: 0 },
    totalGoalsSummary: { up: 0, down: 0, flat: 0 },
    scoresSummary: { up: 0, down: 0, flat: 0 },
  };
  if (!deltaChanges || Object.keys(deltaChanges).length === 0) return result;

  Object.keys(deltaChanges).forEach(function (k) {
    var dir = deltaChanges[k]; // 'up' | 'down' | 'flat'
    var dotIdx = k.indexOf('.');
    if (dotIdx === -1) return;
    var prefix = k.slice(0, dotIdx);
    var field = k.slice(dotIdx + 1);

    // 按玩法前缀分组方向映射
    if (result[prefix] !== undefined) {
      result[prefix][field] = dir;
    }

    // 摘要计数
    var summaryKey = prefix + 'Summary';
    if (result[summaryKey] && dir === 'up') result[summaryKey].up++;
    else if (result[summaryKey] && dir === 'down') result[summaryKey].down++;
    else if (result[summaryKey] && dir === 'flat') result[summaryKey].flat++;
  });

  return result;
}

// ★ 构建赔率走势信号（分析最后 N 条 delta 记录的方向趋势）
function _buildDeltaTrend(deltaLogs) {
  var result = { spfTrend: '', rqspfTrend: '', scoresTrend: '', totalGoalsTrend: '', halfFullTrend: '' };
  if (!deltaLogs || deltaLogs.length === 0) return result;

  // 取最近 6 条记录的 spf.home 方向
  var maxRecords = Math.min(6, deltaLogs.length);
  var recent = deltaLogs.slice(-maxRecords);

  var trends = { spf: { home: [], draw: [], away: [] }, rqspf: { home: [], draw: [], away: [] } };

  recent.forEach(function (log) {
    if (!log.changes) return;
    Object.keys(log.changes).forEach(function (k) {
      var val = log.changes[k];
      // val 可能是 "1.50→1.55" 格式或已经是 'up'/'down'
      var dir = val;
      if (typeof val === 'string' && val.indexOf('→') > -1) {
        var parts = val.split('→');
        var oldV = parseFloat(parts[0]);
        var newV = parseFloat(parts[1]);
        if (oldV > 0 && newV > 0) dir = newV > oldV ? 'up' : newV < oldV ? 'down' : 'flat';
        else dir = 'flat';
      }
      var dotIdx = k.indexOf('.');
      if (dotIdx === -1) return;
      var prefix = k.slice(0, dotIdx);
      var field = k.slice(dotIdx + 1);
      if (trends[prefix] && trends[prefix][field]) {
        trends[prefix][field].push(dir === 'up' ? '▲' : dir === 'down' ? '▼' : '→');
      }
    });
  });

  // 合并各玩法方向序列
  function mergeTrend(pref) {
    var t = trends[pref];
    if (!t) return '';
    var all = (t.home || []).concat(t.draw || []).concat(t.away || []);
    if (all.length === 0) return '';
    // 取最后 5 个
    return all.slice(-5).join('');
  }

  result.spfTrend = mergeTrend('spf');
  result.rqspfTrend = mergeTrend('rqspf');

  // BF/JQS/BQC 趋势从 deltaChanges 的原始键聚合
  return result;
}

// ★ 获取每场比赛推荐专家数最多的方向（用于方案设计页黄色底色标记）
function getMaxRecommendDirs(dataFile, matchId) {
  try {
    var recMap = (dataFile && dataFile.r) || {};
    var recs = recMap['m_' + matchId] || recMap[matchId] || [];
    if (!recs.length) return [];
    // 找最大专家数
    var maxNum = 0;
    for (var i = 0; i < recs.length; i++) {
      if (recs[i].num > maxNum) maxNum = recs[i].num;
    }
    if (maxNum <= 0) return [];
    // 收集所有达到最大专家数的方向
    var dirs = [];
    for (var j = 0; j < recs.length; j++) {
      if (recs[j].num === maxNum) {
        dirs.push(recs[j].type);
      }
    }
    return dirs;
  } catch (e) { return []; }
}

const getEstimatedWaitTime = aiTiming.getEstimatedWaitTime;
const updateTimingStats = aiTiming.updateTimingStats;

// ── 数据库桥接 ──
async function dbMatchList() {
  const today = localDate();
  if (database.isAvailable && database.isAvailable()) {
    const m = database.getMatchesByDate(today);
    if (m && m.length > 0) return m;
    return database.getAllMatches() || [];
  }
  return [];
}
async function dbRecommends(matchId) {
  if (database.isAvailable && database.isAvailable()) {
    return database.getRecommendsByMatchId(matchId) || [];
  }
  return [];
}

// ══════════════════════════════════════════
// Express 应用初始化
// ══════════════════════════════════════════
const app = express();
const PORT = process.env.PORT || 3000;
let wsServer = null; // WebSocket 服务实例（顶层作用域，供 health 检查使用）

app.disable('x-powered-by');
if (!process.env.BEHIND_PROXY) {
  app.use(compression());
}
app.use(cors({ origin: true, credentials: true }));
// 手动 JSON 解析（绕过 body-parser 版本兼容问题）
app.use('/api', (req, res, next) => {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.indexOf('application/json') === -1) return next();
  const chunks = [];
  req.on('data', function (c) {
    chunks.push(c);
  });
  req.on('end', function () {
    if (chunks.length === 0) return next();
    try {
      req.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (e) {
      logger.warn('[json-parse] ' + e.message);
      return res.status(400).json({ code: -1, msg: 'Invalid JSON: ' + e.message });
    }
    next();
  });
});

// UTF-8 响应头
app.use('/api', (req, res, next) => {
  const origJson = res.json;
  res.json = function (body) {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return origJson.call(this, body);
  };
  next();
});

// 速率限制
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { code: -1, msg: '请求过于频繁，请稍后再试' },
  }),
);

// 静态资源
const staticOpts = { maxAge: '7d', etag: true, lastModified: true };
app.use('/assets/worldcup', express.static(path.join(__dirname, '../miniprogram/images/worldcup'), staticOpts));
app.use('/assets', express.static(path.join(__dirname, '../miniprogram/images'), staticOpts));

let homeCache = null,
  homeCacheTime = 0;
const hp = path.join(__dirname, '../preview/index.html');
function getHomeHTML(cb) {
  const now = Date.now();
  if (homeCache && now - homeCacheTime < 60000) return cb(null, homeCache);
  fs.readFile(hp, 'utf8', (err, html) => {
    if (!err) {
      homeCache = html;
      homeCacheTime = now;
    }
    cb(err, html || homeCache);
  });
}
app.get('/', (req, res) => {
  getHomeHTML((err, html) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
    res.end(html);
  });
});
app.use(
  express.static(path.join(__dirname, '../preview'), {
    maxAge: '7d',
    etag: true,
    lastModified: true,
    setHeaders: (res, fPath) => {
      // HTML 不缓存，确保用户始终获取最新页面结构
      if (fPath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else {
        // JS/CSS/图片 强缓存 7 天（文件名带版本号 ?v= 时缓存命中）
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      }
      // MIME 设置
      if (fPath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
      else if (fPath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      else if (fPath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
      else if (fPath.endsWith('.svg')) res.setHeader('Content-Type', 'image/svg+xml');
      else if (fPath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
      else res.setHeader('Content-Type', 'application/octet-stream; charset=utf-8');
    },
  }),
);

// SPA fallback: 未匹配的 .html 请求返回 index.html（支持客户端路由）
app.use((req, res, next) => {
  if (req.path.endsWith('.html') && !fs.existsSync(path.join(__dirname, '../preview', req.path))) {
    return getHomeHTML((err, html) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, must-revalidate' });
      res.end(html);
    });
  }
  next();
});

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), time: new Date().toISOString() });
});
// WebSocket 状态
app.get('/health/ws', (req, res) => {
  let wsInfo = { enabled: false, clients: 0 };
  if (wsServer) {
    wsInfo = { enabled: true, clients: wsServer.getClientCount() };
  }
  res.json(wsInfo);
});
// 调度器状态
app.get('/health/scheduler', (req, res) => {
  try {
    const state = JSON.parse(
      require('fs').readFileSync(require('path').join(__dirname, 'scheduler_state.json'), 'utf8'),
    );
    res.json(state);
  } catch (e) {
    res.json({ status: 'no_state', message: '调度器状态文件不存在' });
  }
});
// 深度健康检查（数据库 / 数据完整性 / 外部API / 系统资源）
app.get('/health/deep', async (req, res) => {
  try {
    const r = await health.deepCheck();
    res.json(r);
  } catch (e) {
    res.json({ status: 'error', message: e.message });
  }
});

// 启动校验
if (!CONFIG.MOBILE || !CONFIG.PASSWORD) {
  logger.error('启动失败：缺少 MIDOU_MOBILE / MIDOU_PASSWORD 配置');
  const alert = require('./alert');
  alert.loginFailed('缺少 MIDOU_MOBILE/MIDOU_PASSWORD').then(() => process.exit(1));
} else {
  // ==================== WebSocket 实时推送 (P3-1) ====================
  try {
    wsServer = require('./websocket');
    logger.info('[ws] WebSocket 模块已加载');
  } catch (e) {
    logger.warn('[ws] WebSocket 模块加载失败: ' + e.message);
  }

  // ==================== API 路由 ====================

  // ★ P3-2: ETag 中间件（支持 HTTP 304 条件请求，减少重复传输）
  app.post('/api', function (req, res, next) {
    // 为所有 API 响应自动添加 ETag
    const _origJson = res.json;
    res.json = function (body) {
      if (body && body.code !== undefined) {
        // 生成简单 ETag（基于 JSON 序列化的 MD5）
        const crypto = require('crypto');
        const hash = crypto.createHash('md5').update(JSON.stringify(body)).digest('hex').slice(0, 12);
        res.set('ETag', '"' + hash + '"');
        res.set('Cache-Control', 'private, max-age=60'); // 允许浏览器缓存 60 秒

        // 检查 If-None-Match
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === '"' + hash + '"') {
          return res.status(304).end();
        }
      }
      return _origJson.call(this, body);
    };
    next();
  });

  app.post('/api', async (req, res) => {
    const { action, data: wrappedData = {} } = req.body;
    // 前端传参格式兼容: {action, date, days} 和 {action, data: {date, days}} 都支持
    const data = Object.assign({}, wrappedData, req.body);
    logger.info(`API: ${action} ${JSON.stringify(data).slice(0, 100)}`);
    try {
      switch (action) {
        case 'week-dates': {
          // ★ P1-4: 使用预计算缓存，避免每次请求都遍历 data.json
          return res.json({ code: 1, data: getWeekDates() });
        }

        case 'match-list': {
          // 从 data.json 读取比赛列表（支持历史日期切换）
          // ★ P0-1 + P1-6: 使用内存缓存避免每次读磁盘 + 请求级缓存
          try {
            const dateStr = data.matchDate
              ? new Date().getFullYear() + '-' + data.matchDate
              : data.date || latestDataDate();

            // ★ hideFinished: 仅返回未开赛比赛（方案设计/投注页使用）
            const hideFinished = data.hideFinished === true || data.hideFinished === 'true';
            const cacheKey = dateStr + (hideFinished ? ':active' : '');

            // P1-6: 请求级缓存（同一日期 1 分钟内命中）
            const now = Date.now();
            const cached = _matchListCacheByDate[cacheKey];
            if (cached && now - cached.time < MATCH_LIST_CACHE_TTL) {
              return res.json(cached.response);
            }

            const dataFile = getDataJson();
            const mMap = dataFile.m || {};

            // 读取 500.com 赔率数据获取单关标识（缓存内置自动降级）
            const oddsMap = getOddsHistory(dateStr) || {};

            // ★ P0-1: 功守道 _global 内存缓存，不再每次读磁盘
            const gsCacheMap = getGsGlobalMap();

            // ⭐ 检测当前日期是否有未缓存的功守道比赛
            let gsNeedCompute = false;
            const allKeys = Object.keys(mMap);
            for (let ki = 0; ki < allKeys.length; ki++) {
              const k = allKeys[ki];
              const m = mMap[k];
              if (!m) continue;
              const md = (m.date || '').slice(0, 10);
              if (md !== dateStr) continue;
              // 兼容缓存 key 带或不带 m_ 前缀
              const cachedGS =
                gsCacheMap[k] || gsCacheMap[k.replace(/^m_/, '')] || gsCacheMap['m_' + k.replace(/^m_/, '')];
              if (!(cachedGS && cachedGS.attackPattern)) {
                gsNeedCompute = true;
                break;
              }
            }

            // 如果有未缓存比赛，后台异步触发计算（不阻塞响应）
            if (gsNeedCompute) {
              const gsEngine = require('./gongshoudao/index');
              logger.info('[gs] 检测到' + dateStr + '存在未缓存功守道数据, 后台异步计算...');
              gsEngine
                .refreshCache()
                .then(() => {
                  logger.info('[gs] 后台计算完成');
                  // 计算完成后刷新内存缓存
                  _gsGlobalCache = null;
                  _gsGlobalCacheTime = 0;
                })
                .catch((e) => {
                  logger.warn('[gs] 后台计算失败: ' + e.message);
                });
            }

            const list = [];
            Object.keys(mMap).forEach((k) => {
              const m = mMap[k];
              if (!m) return;
              const md = (m.date || '').slice(0, 10);
              if (md !== dateStr) return;
              // ★ hideFinished: 方案设计/投注页仅显示未开赛比赛
              if (hideFinished && m.matchStatus !== 0) return;
              // 补充单关标识（赔率文件优先，data.json 兜底）
              const fiveOdds = oddsMap[m.num || ''];
              const isSingleGame = (fiveOdds && fiveOdds.isSingleGame === true) || m.isSingleGame === true;
              // 检查功守道数据是否可用：兼容 m_ 前缀的 key 格式
              const cachedGS =
                gsCacheMap[k] || gsCacheMap[k.replace(/^m_/, '')] || gsCacheMap['m_' + k.replace(/^m_/, '')];
              const hasGS = !!(cachedGS && cachedGS.attackPattern);
              list.push(Object.assign({}, m, { isSingleGame: isSingleGame, hasGongshoudao: hasGS }));
            });

            // 按比赛编号排序
            list.sort((a, b) => (a.num || '').localeCompare(b.num || ''));

            // 如果没有找到数据，尝试实时抓取（仅限今天）
            if (list.length === 0) {
              const today = localDate();
              if (dateStr === today) {
                const liveMatches = await safeApiCall(
                  () => ensureData(),
                  async () => [],
                );
                const filtered = liveMatches.filter((m) => {
                  if ((m.date || '').slice(0, 10) !== today) return false;
                  if (hideFinished && m.matchStatus !== 0) return false;
                  return true;
                });
                if (filtered.length > 0) {
                  return res.json({ code: 1, data: filtered });
                }
                // ★ 兜底: 实时 API 也无数据 → 回退到 data.json 最近有数据的日期
                const fallbackDate = latestDataDate();
                if (fallbackDate && fallbackDate !== today) {
                  const fallbackList = [];
                  const fallbackOdds = getOddsHistory(fallbackDate) || {};
                  Object.keys(mMap).forEach((k) => {
                    const m = mMap[k];
                    if (!m) return;
                    if ((m.date || '').slice(0, 10) !== fallbackDate) return;
                    if (hideFinished && m.matchStatus !== 0) return;
                    const fo = fallbackOdds[m.num || ''] || {};
                    const cgs = gsCacheMap[k] || gsCacheMap[k.replace(/^m_/, '')] || gsCacheMap['m_' + k.replace(/^m_/, '')];
                    fallbackList.push(Object.assign({}, m, {
                      isSingleGame: fo && fo.isSingleGame === true,
                      hasGongshoudao: !!(cgs && cgs.attackPattern),
                    }));
                  });
                  fallbackList.sort((a, b) => (a.num || '').localeCompare(b.num || ''));
                  if (fallbackList.length > 0) {
                    return res.json({ code: 1, data: fallbackList, _fallbackDate: fallbackDate });
                  }
                }
                return res.json({ code: 1, data: filtered });
              }
            }

            const response = { code: 1, data: list };
            // ★ P1-6: 缓存结果（cacheKey 区分 hideFinished 模式）
            _matchListCacheByDate[cacheKey] = { time: now, response };
            // ★ P2-4: LRU 驱逐（最多缓存 MATCH_LIST_CACHE_MAX_KEYS 个日期）
            _matchListCacheLRU.push(cacheKey);
            while (_matchListCacheLRU.length > MATCH_LIST_CACHE_MAX_KEYS) {
              const oldest = _matchListCacheLRU.shift();
              delete _matchListCacheByDate[oldest];
            }
            return res.json(response);
          } catch (e) {
            logger.error('[match-list] 异常: ' + (e.message || e) + ' stack: ' + (e.stack || '').split('\n').slice(0, 3).join(' | '));
            return res.json({ code: 1, data: [] });
          }
        }

        case 'recommend-trend': {
          const { matchId } = data;
          if (!matchId) return res.json({ code: 0, msg: '缺少 matchId' });

          // 获取推荐：先尝试实时API，失败则回退到 data.json
          let recomms = [];
          try {
            recomms = await ensureRecommends(matchId);
          } catch (e) {
            logger.warn('实时推荐获取失败，回退到 data.json: ' + e.message);
            try {
              const fs = require('fs');
              const dataFile = getDataJson();
              const rMap = dataFile.r || {};
              const raw = rMap['m_' + matchId] || rMap[String(matchId)] || [];
              recomms = raw.map(function (x) {
                return {
                  type: x.t || x.type,
                  num: x.n || x.num,
                  result: x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null,
                };
              });
            } catch (e2) {
              logger.warn('data.json 回退也失败: ' + e2.message);
            }
          }

          // 从 trends.json 读取真实趋势快照（period_daemon 每20分钟写入，使用内存缓存）
          let timeLabels = [],
            series = [];
          try {
            const trends = getTrendsJson();
            if (trends && Object.keys(trends).length > 0) {
              const key = 'm_' + matchId;
              const snaps = trends[key] || [];
              if (snaps.length > 0) {
                timeLabels = snaps.map(function (s) {
                  return s.t;
                });
                const allTypes = {};
                snaps.forEach(function (s) {
                  Object.keys(s).forEach(function (k) {
                    if (k !== 't' && k !== 'ts') allTypes[k] = true;
                  });
                });
                Object.keys(allTypes).forEach(function (type) {
                  series.push({
                    name: type,
                    type: 'line',
                    smooth: true,
                    data: snaps.map(function (s) {
                      return s[type] || 0;
                    }),
                  });
                });
              }
            }
          } catch (e) {
            logger.warn('读取趋势快照失败: ' + e.message);
          }

          // 如果没有历史快照，用当前值生成单点趋势
          if (series.length === 0 && recomms.length > 0) {
            var now = new Date();
            const t = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
            timeLabels = [t];
            series = recomms.map(function (r) {
              return { name: r.type, type: 'line', smooth: true, data: [r.num] };
            });
          }

          return res.json({ code: 1, data: { matchId, timeLabels, series, lastResult: recomms } });
        }

        case 'ranking-list': {
          // 从 data.json 读取比赛（包含历史比赛+推荐结果，确保 isHit 正确）
          let matches = [];
          let cachedRMap = null;
          try {
            const fs = require('fs');
            const path = require('path');
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            cachedRMap = dataFile.r || {};
            matches = Object.values(mMap).filter((m) => m && m.matchId);
          } catch {}
          // 兜底：实时 API
          if (matches.length === 0) {
            matches = await ensureData();
          }

          // 日期筛选：默认最新有数据日期，支持指定日期
          const requestDate = data.date || latestDataDate();
          matches = matches.filter((m) => m.date === requestDate);

          // 获取推荐（缓存 rMap，避免每次读磁盘）
          function getRecs(matchId) {
            if (cachedRMap) {
              const raw = cachedRMap['m_' + matchId] || cachedRMap[String(matchId)] || [];
              return raw.map((x) => ({
                type: x.t || x.type,
                num: x.n || x.num,
                result: x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null,
              }));
            }
            return [];
          }
          const filterCategory = data.category || null;
          const filterDirection = data.direction || null;

          // ====== 分类函数 ======
          function classifyType(type) {
            if (type.startsWith('半全场')) return '半全场';
            if (type.startsWith('总进球')) return '进球数';
            if (type.includes('、')) return '双选';
            if (type.startsWith('让')) return '让球';
            if (['胜', '平', '负'].includes(type)) return '胜平负';
            return '其他';
          }

          // ====== 收集所有方向及专家数 ======
          const dirStats = {}; // { type: { totalNum: number, matches: [] } }
          for (const m of matches) {
            let recomms;
            try {
              recomms = getRecs(m.matchId);
            } catch {
              continue;
            }
            for (const r of recomms) {
              if (!r.type || !r.num) continue;
              if (!dirStats[r.type]) dirStats[r.type] = { totalNum: 0, matches: [] };
              dirStats[r.type].totalNum += r.num;
              // ★ P0-3: 只存前端需要的字段，减少响应体积
              dirStats[r.type].matches.push({
                matchId: m.matchId,
                homeName: m.homeName,
                visitName: m.visitName,
                leagueName: m.leagueName,
                num: m.num,
                direction: r.type,
                expertCount: r.num,
                isHit: r.result === 1,
              });
            }
          }

          // ====== 构建分类结构 ======
          const categories = {};
          for (const [type, stats] of Object.entries(dirStats)) {
            const cat = classifyType(type);
            if (!categories[cat]) categories[cat] = { directions: [] };
            categories[cat].directions.push({
              name: type,
              totalExpertCount: stats.totalNum,
            });
          }

          // 每个分类内的方向按专家数从高到低排序
          for (const cat of Object.values(categories)) {
            cat.directions.sort((a, b) => b.totalExpertCount - a.totalExpertCount);
          }

          // 分类排序：保持预期顺序
          const CAT_ORDER = ['胜平负', '半全场', '进球数', '双选', '让球'];
          const sortedCategories = {};
          for (const key of CAT_ORDER) {
            if (categories[key]) sortedCategories[key] = categories[key];
          }

          // ====== 构建排名列表 ======
          const list = [];
          if (filterDirection && dirStats[filterDirection]) {
            // 按具体方向筛选（isHit 已在上面收集阶段设置）
            for (const item of dirStats[filterDirection].matches) {
              list.push({ ...item });
            }
          } else if (filterCategory && categories[filterCategory]) {
            // 按分类筛选：取该分类下所有方向的比赛的 TOP 方向
            const catDirs = new Set(categories[filterCategory].directions.map((d) => d.name));
            for (const m of matches) {
              let recomms;
              try {
                recomms = getRecs(m.matchId);
              } catch {
                continue;
              }
              const filtered = recomms.filter((r) => catDirs.has(r.type) && r.num > 0);
              if (filtered.length > 0) {
                const maxDir = filtered.reduce((a, b) => (b.num > a.num ? b : a));
                // ★ P0-3: 只存前端需要的字段
                list.push({
                  matchId: m.matchId,
                  homeName: m.homeName,
                  visitName: m.visitName,
                  leagueName: m.leagueName,
                  num: m.num,
                  direction: maxDir.type,
                  expertCount: maxDir.num,
                  isHit: maxDir.result === 1,
                });
              }
            }
          } else {
            // 综合排名：取每场比赛推荐专家最多的方向
            for (const m of matches) {
              let recomms;
              try {
                recomms = getRecs(m.matchId);
              } catch {
                continue;
              }
              const maxDir = recomms.reduce((a, b) => ((b.num || 0) > ((a && a.num) || 0) ? b : a), null);
              if (maxDir && maxDir.num > 0)
                // ★ P0-3: 只存前端需要的字段
                list.push({
                  matchId: m.matchId,
                  homeName: m.homeName,
                  visitName: m.visitName,
                  leagueName: m.leagueName,
                  num: m.num,
                  direction: maxDir.type,
                  expertCount: maxDir.num,
                  isHit: maxDir.result === 1,
                });
            }
          }

          list.sort((a, b) => b.expertCount - a.expertCount);
          const ranking = list.map((item, i) => ({ rank: i + 1, ...item }));
          const topExpertCount = ranking.length > 0 ? ranking[0].expertCount : 0;

          // ★Phase1: 获取 data.json 文件修改时间
          let dataTime = null;
          try {
            const fs = require('fs');
            const path = require('path');
            const dataJsonPath = path.join(__dirname, 'data.json');
            if (fs.existsSync(dataJsonPath)) {
              dataTime = fs.statSync(dataJsonPath).mtime.toISOString();
            }
          } catch (e) {}

          return res.json({
            code: 1,
            data: {
              date: requestDate,
              dataTime: dataTime,
              filterCategory,
              filterDirection,
              totalMatches: ranking.length,
              topExpertCount,
              ranking,
              categories: sortedCategories,
            },
          });
        }

        case 'match-detail': {
          const { matchId } = data;
          // 从 data.json 读取比赛+推荐（支持历史比赛）
          let match = null;
          let recommends = [];
          try {
            const fs = require('fs');
            const path = require('path');
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};
            const key = 'm_' + matchId;
            match = mMap[key] || mMap[matchId] || null;
            // 读取推荐并兼容新旧 schema
            const raw = rMap[key] || rMap[String(matchId)] || [];
            recommends = raw.map(function (x) {
              return {
                type: x.t || x.type,
                num: x.n || x.num,
                result: x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null,
              };
            });
          } catch {}
          // 兜底：尝试实时数据（仅 match，无历史推荐）
          if (!match) {
            try {
              const matches = await ensureData();
              match = matches.find((m) => m.matchId === matchId) || null;
            } catch {}
          }
          return res.json({ code: 1, data: { match: match || {}, recommends: recommends } });
        }

        case 'hit-rate-stats': {
          const days = parseInt(data.days) || 30;
          try {
            // 尝试走内存缓存（TTL 60s，data.json 变更自动失效）
            const cached = getHitRateCache();
            if (cached && cached.days === days) {
              return res.json({ code: 1, data: cached.data });
            }

            // Load from data.json
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};

            function normalizeRecs(recs) {
              return (recs || []).map(function (x) {
                const raw = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
                const r = raw === 0 || raw === 1 ? raw : null;
                return { type: x.t || x.type, num: x.n || x.num, result: r };
              });
            }

            // 单次遍历：同时收集 dirMap、dateDirMap、matchDayTop
            var cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            var cutoffStr = cutoff.toISOString().slice(0, 10);

            const dirMap = {};
            const dateDirMap = {};
            const matchDayTop = {}; // mid -> { date, expertCount, isHit }
            let allRecsCount = 0;

            Object.keys(rMap).forEach(function (k) {
              const mid = k.replace(/^m_/, '');
              const match = mMap['m_' + mid] || mMap[mid];
              const matchDate = match ? (match.date || '').slice(0, 10) : '';
              if (!matchDate) return;
              const recs = normalizeRecs(rMap[k] || []);
              if (recs.length === 0) return;

              // 取该场比赛综合排名第一的方向(max num)
              var maxNum = -Infinity;
              var topRec = null;
              for (var ri = 0; ri < recs.length; ri++) {
                var r = recs[ri];
                if (r.num > maxNum) { maxNum = r.num; topRec = r; }
              }
              if (topRec && topRec.result !== null && topRec.result !== undefined) {
                matchDayTop[mid] = {
                  date: matchDate,
                  expertCount: topRec.num || 0,
                  isHit: topRec.result === 1,
                };
              }

              if (!matchDate || matchDate < cutoffStr) return;
              for (var j = 0; j < recs.length; j++) {
                var rr = recs[j];
                if (!rr.type || rr.result === null || rr.result === undefined) continue;
                allRecsCount++;
                // 按方向聚合
                if (!dirMap[rr.type]) dirMap[rr.type] = { total: 0, hits: 0, misses: 0 };
                dirMap[rr.type].total++;
                if (rr.result === 1) dirMap[rr.type].hits++;
                else dirMap[rr.type].misses++;
                // 按日期-方向聚合
                if (!dateDirMap[matchDate]) dateDirMap[matchDate] = {};
                if (!dateDirMap[matchDate][rr.type]) dateDirMap[matchDate][rr.type] = { total: 0, hits: 0 };
                dateDirMap[matchDate][rr.type].total++;
                if (rr.result === 1) dateDirMap[matchDate][rr.type].hits++;
              }
            });

            if (allRecsCount === 0) {
              return res.json({
                code: 0,
                msg: '命中率统计需要历史数据积累。请先运行爬虫抓取历史数据：node scraper.js',
              });
            }

            const directionStats = Object.keys(dirMap)
              .map(function (d) {
                const s = dirMap[d];
                return {
                  direction: d,
                  totalRecommends: s.total,
                  hitCount: s.hits,
                  missCount: s.misses,
                  hitRate: s.total > 0 ? Math.round((s.hits / s.total) * 1000) / 10 : 0,
                };
              })
              .sort(function (a, b) { return b.hitCount - a.hitCount; });

            // 按日期分组：每天取 top5 比赛
            const dayTop5 = {};
            Object.keys(matchDayTop).forEach(function (mid) {
              const item = matchDayTop[mid];
              if (!dayTop5[item.date]) dayTop5[item.date] = [];
              dayTop5[item.date].push({ matchId: mid, expertCount: item.expertCount, isHit: item.isHit });
            });
            Object.keys(dayTop5).forEach(function (d) {
              dayTop5[d].sort(function (a, b) { return b.expertCount - a.expertCount; });
              dayTop5[d] = dayTop5[d].slice(0, 5);
            });

            // 取近 N 个有效比赛日
            const validDates = Object.keys(dayTop5)
              .filter(function (d) { return d <= localDate() && dayTop5[d].length >= 1; })
              .sort().reverse();
            const targetDays = days || 60;
            let qualifiedDays = 0, participatingDays = 0;
            for (let di = 0; di < validDates.length && participatingDays < targetDays; di++) {
              const dd = validDates[di];
              const top5 = dayTop5[dd];
              if (top5.length < 3) continue;
              participatingDays++;
              const dayHits = top5.filter(function (x) { return x.isHit; }).length;
              if (dayHits >= 3) qualifiedDays++;
            }
            const top3HitRate = participatingDays > 0 ? Math.round((qualifiedDays / participatingDays) * 1000) / 10 : 0;

            // dailyTrend 裁剪到最近30天（减少响应体积）
            const sortedDates = Object.keys(dateDirMap).sort();
            const recentDates = sortedDates.slice(-30);
            const dailyTrend = recentDates.map(function (d) {
              const dirs = [];
              Object.keys(dateDirMap[d]).forEach(function (dir) {
                const s = dateDirMap[d][dir];
                dirs.push({
                  direction: dir,
                  hitRate: s.total > 0 ? Math.round((s.hits / s.total) * 1000) / 10 : 0,
                });
              });
              return { date: d, directions: dirs };
            });

            const resultPayload = {
              totalDays: days,
              directionStats: directionStats,
              dailyTrend: dailyTrend,
              top3HitRate: top3HitRate,
            };

            // 写入内存缓存
            setHitRateCache({ days: days, data: resultPayload });

            return res.json({
              code: 1,
              data: resultPayload,
            });
          } catch (dbErr) {
            return res.json({ code: 0, msg: '命中率统计失败: ' + dbErr.message });
          }
        }

        case 'crawl-history': {
          const crawler = require('./scraper');
          // 不等待完成，后台执行
          res.json({ code: 1, data: { message: '历史数据抓取已启动，请查看控制台日志' } });
          crawler.main().catch((err) => console.error('[crawl-history] 错误:', err));
          return;
        }

        case 'crawl-status': {
          const crawled = database.getCrawledDates();
          const allMatches = database.getAllMatches();
          const stats = {
            totalCrawledDates: crawled.length,
            crawledDates: crawled,
            totalMatches: allMatches.length,
            lastUpdate: allMatches.length > 0 ? allMatches[0].updatedAt : null,
          };
          return res.json({ code: 1, data: stats });
        }

        case 'hit-rate-filter': {
          const { league, timeRange, directionType, direction, rankType, rankTop } = data;
          try {
            const fs = require('fs');
            const path = require('path');

            // 读取 data.json
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};
            function norm(recs) {
              return recs.map(function (x) {
                return {
                  type: x.t || x.type,
                  num: x.n || x.num,
                  result: x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null,
                };
              });
            }

            // 方向分类
            function classifyDir(type) {
              if (!type) return '其他';
              if (['胜', '平', '负'].indexOf(type) >= 0) return '胜平负';
              if (type.indexOf('让') === 0 && type.length <= 3) return '让球';
              if (type.indexOf('总进球') === 0) return '进球数';
              if (['胜胜', '负负'].indexOf(type) >= 0 || type.indexOf('半全场') === 0) return '半全场';
              if (type.indexOf('、') >= 0 || type.indexOf(',') >= 0) return '双选';
              return '其他';
            }

            // Build match+rec list from data.json
            let allItems = [];
            Object.keys(mMap).forEach(function (k) {
              const m = mMap[k];
              if (!m || !m.matchId || !m.date) return;
              const date = m.date.slice(0, 10);
              const raw = rMap['m_' + m.matchId] || rMap[String(m.matchId)] || [];
              const recs = norm(raw);
              recs.forEach(function (r) {
                if (r.type && r.num > 0 && r.result !== null && r.result !== undefined) {
                  allItems.push({
                    matchId: m.matchId,
                    date: date,
                    leagueName: m.leagueName || '',
                    homeName: m.homeName || '',
                    visitName: m.visitName || '',
                    num: m.num || '',
                    direction: r.type,
                    expertCount: r.num,
                    result: r.result,
                    dirType: classifyDir(r.type),
                  });
                }
              });
            });

            // Filter: timeRange
            var now = new Date();
            if (timeRange && timeRange !== 'all') {
              var cutoff = new Date(now);
              cutoff.setDate(cutoff.getDate() - parseInt(timeRange, 10));
              var cutoffStr = cutoff.toISOString().slice(0, 10);
              allItems = allItems.filter(function (x) {
                return x.date >= cutoffStr;
              });
            }

            // Filter: league
            if (league) {
              allItems = allItems.filter(function (x) {
                return x.leagueName === league;
              });
            }

            // Filter: directionType
            // "综合排名" means: for each match, take the top expertCount direction regardless of type
            if (directionType === '综合排名') {
              // sort by matchId+expertCount desc, pick top per match
              const matchTop = {};
              allItems.forEach(function (x) {
                if (!matchTop[x.matchId] || matchTop[x.matchId].expertCount < x.expertCount) {
                  matchTop[x.matchId] = x;
                }
              });
              allItems = Object.values(matchTop);
            } else if (directionType) {
              allItems = allItems.filter(function (x) {
                return x.dirType === directionType;
              });
            }

            // Filter: direction
            if (direction) {
              allItems = allItems.filter(function (x) {
                return x.direction === direction;
              });
            }

            // Filter: rankTop (per match)
            const isPerMatch = rankType === '每场' && rankTop > 0;
            const isDaily = rankType === '每天' && rankTop > 0;
            if (isPerMatch) {
              // For each match, only keep top N directions by expertCount
              var matchGroups = {};
              allItems.forEach(function (x) {
                if (!matchGroups[x.matchId]) matchGroups[x.matchId] = [];
                matchGroups[x.matchId].push(x);
              });
              allItems = [];
              Object.keys(matchGroups).forEach(function (mid) {
                const items = matchGroups[mid];
                items.sort(function (a, b) {
                  return b.expertCount - a.expertCount;
                });
                // Get the max expertCount to find "tied for first"
                const maxCount = items[0].expertCount;
                const kept = items
                  .filter(function (x) {
                    return x.expertCount === maxCount;
                  })
                  .slice(0, rankTop);
                allItems = allItems.concat(kept);
              });
            } else if (isDaily) {
              // For each day, find the global max expertCount, then filter per match
              const dayMax = {};
              allItems.forEach(function (x) {
                if (!dayMax[x.date] || dayMax[x.date] < x.expertCount) dayMax[x.date] = x.expertCount;
              });
              allItems = allItems.filter(function (x) {
                return x.expertCount === dayMax[x.date];
              });
              // Then pick top N per match
              var matchGroups = {};
              allItems.forEach(function (x) {
                if (!matchGroups[x.matchId]) matchGroups[x.matchId] = [];
                matchGroups[x.matchId].push(x);
              });
              allItems = [];
              Object.keys(matchGroups).forEach(function (mid) {
                const items = matchGroups[mid];
                items.sort(function (a, b) {
                  return b.expertCount - a.expertCount;
                });
                allItems = allItems.concat(items.slice(0, rankTop));
              });
            }

            // Calculate stats
            let hitCount = 0,
              totalCount = allItems.length;
            allItems.forEach(function (x) {
              if (x.result === 1) hitCount++;
            });
            const hitRate = totalCount > 0 ? Math.round((hitCount / totalCount) * 1000) / 10 : 0;

            // Daily results
            const dailyMap = {};
            allItems.forEach(function (x) {
              if (!dailyMap[x.date]) dailyMap[x.date] = { totalMatch: 0, hitMatch: 0, matchSet: {}, hitSet: {} };
              if (!dailyMap[x.date].matchSet[x.matchId]) {
                dailyMap[x.date].matchSet[x.matchId] = true;
                dailyMap[x.date].totalMatch++;
              }
              if (x.result === 1 && !dailyMap[x.date].hitSet[x.matchId]) {
                dailyMap[x.date].hitSet[x.matchId] = true;
                dailyMap[x.date].hitMatch++;
              }
            });
            const dailyResults = Object.keys(dailyMap)
              .sort()
              .reverse()
              .slice(0, 15)
              .map(function (d) {
                const dm = dailyMap[d];
                return {
                  date: d.replace(/-/g, '/'),
                  totalMatch: dm.totalMatch,
                  hitMatch: dm.hitMatch,
                  hitRate: dm.totalMatch > 0 ? Math.round((dm.hitMatch / dm.totalMatch) * 1000) / 10 : 0,
                };
              });

            // Condition summary
            const condParts = [];
            if (league) condParts.push(league);
            if (timeRange === '30') condParts.push('近30天');
            else if (timeRange === '60') condParts.push('近60天');
            else if (timeRange === '90') condParts.push('近90天');
            if (direction) condParts.push(direction);
            else if (directionType && directionType !== '综合排名') condParts.push(directionType);
            else if (directionType === '综合排名') condParts.push('综合排名');
            if (isPerMatch) condParts.push('每场前' + rankTop);
            if (isDaily) condParts.push('每天前' + rankTop);
            const conditionSummary = condParts.length > 0 ? condParts.join(' | ') : '全部条件';

            return res.json({
              code: 1,
              data: {
                hitCount: hitCount,
                totalCount: totalCount,
                hitRate: hitRate,
                conditionSummary: conditionSummary,
                detailList: allItems,
                dailyResults: dailyResults,
              },
            });
            // ★ P1-1: 缓存量化方案结果
            _quantPlanCache[dateStr] = { time: qpNow, response: qpResponse };
            // ★ P2: LRU 清理（最多缓存 10 个日期）
            const qpKeys = Object.keys(_quantPlanCache);
            if (qpKeys.length > 10) {
              qpKeys.sort(function (a, b) { return _quantPlanCache[a].time - _quantPlanCache[b].time; });
              delete _quantPlanCache[qpKeys[0]];
            }
            return res.json(qpResponse);
          } catch (e) {
            return res.json({ code: 0, msg: '查询失败: ' + e.message });
          }
        }

        case 'filter-leagues': {
          try {
            const fs = require('fs');
            const path = require('path');
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const leagueSet = {};
            Object.values(mMap).forEach(function (m) {
              if (m && m.leagueName) leagueSet[m.leagueName] = true;
            });
            return res.json({ code: 1, data: Object.keys(leagueSet).sort() });
          } catch (e) {
            return res.json({ code: 0, msg: '获取联赛列表失败: ' + e.message });
          }
        }

        case 'backfill-results': {
          // 兜底回填：补查完赛但缺失结果的推荐数据
          const backfill = require('./backfill_results');
          database.initDatabase();
          backfill
            .main()
            .then((r) => {
              console.log('[api] backfill done:', JSON.stringify(r));
            })
            .catch((err) => console.error('[api] backfill error:', err));
          return res.json({
            code: 1,
            data: {
              message: '结果回填已启动，正在后台执行。几分钟后完赛推荐命中数据将更新。',
              hint: '可稍后重新查询筛选结果。也可运行: node backfill_results.js',
            },
          });
        }

        case 'backfill-status': {
          const stale = database.getStaleRecommendations();
          const matchCount = new Set(stale.map((r) => r.matchId)).size;
          return res.json({
            code: 1,
            data: { staleCount: stale.length, staleMatches: matchCount, needBackfill: stale.length > 0 },
          });
        }

        case 'sync-match-date': {
          // 手动触发指定日期的赛程同步（用于补同步缺失日期）
          try {
            const ds = require('./data_sync');
            const syncDate = data.date || '';
            if (!syncDate) return res.json({ code: 0, msg: '缺少 date 参数' });
            logger.info('[api] 手动触发 ' + syncDate + ' 赛程同步...');
            ds.syncMatchList(syncDate)
              .then(function () {
                logger.info('[api] ' + syncDate + ' 赛程同步完成, 开始同步赔率...');
                return ds.sync500Odds ? ds.sync500Odds(syncDate) : Promise.resolve();
              })
              .then(function () {
                logger.info('[api] ' + syncDate + ' 赔率同步完成, 开始同步推荐...');
                return ds.syncRecommends(syncDate);
              })
              .then(function () {
                logger.info('[api] ' + syncDate + ' 推荐同步完成');
                return ds.backfillResults(syncDate).catch(function () {});
              })
              .catch(function (e) {
                logger.error('[api] ' + syncDate + ' 同步失败: ' + e.message);
              });
            return res.json({ code: 1, data: { hint: '已启动后台同步 ' + syncDate + ', 请稍候查看' } });
          } catch (e) {
            return res.json({ code: 0, msg: '同步触发失败: ' + e.message });
          }
        }

        // ========== AI 预测 ==========
        case 'ai-predict': {
          const mid = data.matchId;
          if (!mid) return res.json({ code: 0, msg: '缺少 matchId' });
          try {
            const fs = require('fs');
            const path = require('path');

            const cacheFile = path.join(__dirname, 'ai_cache.json');
            var cache = {};
            if (fs.existsSync(cacheFile)) {
              try {
                cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
              } catch (e) {}
            }
            let cachedEntry = cache[mid];
            const hasDS =
              cachedEntry &&
              cachedEntry.sources &&
              cachedEntry.sources.deepseek &&
              cachedEntry.sources.deepseek.content;
            const hasDB =
              cachedEntry && cachedEntry.sources && cachedEntry.sources.doubao && cachedEntry.sources.doubao.content;

            // 获取比赛信息
            let matchInfo = {};
            try {
              const df = getDataJson();
              var m = (df.m || {})['m_' + mid] || (df.m || {})[mid];
              if (m)
                matchInfo = {
                  matchId: mid,
                  homeName: m.homeName,
                  visitName: m.visitName,
                  leagueName: m.leagueName,
                  date: m.date,
                  num: m.num,
                };
            } catch (e) {}

            // ★ 检查 500.com 数据是否存在
            let shujuMissing = true;
            try {
              if (matchInfo.date) {
                const dateStr = matchInfo.date.slice(0, 10);
                const shujuFile = path.join(__dirname, 'shuju_data', 'shuju_merged_' + dateStr + '.json');
                if (fs.existsSync(shujuFile) && fs.statSync(shujuFile).size > 100) {
                  const shujuJson = JSON.parse(fs.readFileSync(shujuFile, 'utf8'));
                  shujuMissing = !(shujuJson.matches || {})[matchInfo.num];
                }
              }
            } catch (e) {}
            if (shujuMissing) {
              console.log('[ai] 500.com 数据缺失: ' + mid + ' ' + matchInfo.num + ', 后台触发抓取...');
              // 后台异步触发抓取
              const ds = require('./data_sync');
              ds.triggerShujuFetch && ds.triggerShujuFetch(matchInfo.date ? matchInfo.date.slice(0, 10) : '');
            }

            // 缓存写入（后台合并）
            function saveCache(source, content, conf) {
              try {
                let cur = {};
                try {
                  cur = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                } catch (e) {}
                const entry = cur[mid] || { sources: {} };
                if (!entry.sources) entry.sources = {};
                entry.sources[source] = { content, confidence: conf, generatedAt: new Date().toISOString() };
                if (entry.sources.deepseek && entry.sources.doubao) {
                  const merged = aiMerger.mergeAnalyses(
                    { content: entry.sources.deepseek.content, confidence: entry.sources.deepseek.confidence || 70 },
                    { content: entry.sources.doubao.content, confidence: entry.sources.doubao.confidence || 70 },
                    matchInfo,
                  );
                  entry.content = merged.content;
                  entry.confidence = merged.confidence;
                  entry.merged = true;
                  console.log('[ai] 双模型合并完成: ' + mid);
                } else {
                  entry.content = content;
                  entry.confidence = conf;
                  entry.merged = false;
                  console.log('[ai] ' + source + ' 缓存: ' + mid + ' conf=' + conf);
                }
                entry.updatedAt = new Date().toISOString();
                cur[mid] = entry;
                fs.writeFileSync(cacheFile, JSON.stringify(cur));

                // ★ 回测钩子: AI 预测持久化
                try {
                  const preds = entry.content && entry.content['预测建议'] ? entry.content['预测建议'] : [];
                  const aiFields = { confidence: entry.confidence || 0, content: JSON.stringify(entry.content) };
                  if (matchInfo.date) aiFields.date = matchInfo.date.slice(0, 10);
                  if (matchInfo.homeName) aiFields.homeName = matchInfo.homeName;
                  if (matchInfo.visitName) aiFields.visitName = matchInfo.visitName;
                  if (matchInfo.leagueName) aiFields.leagueName = matchInfo.leagueName;
                  if (matchInfo.num) aiFields.matchNum = matchInfo.num;
                  if (matchInfo.handicap !== undefined) aiFields.handicap = matchInfo.handicap;
                  else if (matchInfo.rq !== undefined) aiFields.handicap = matchInfo.rq;
                  preds.forEach(function (p) {
                    if (p['玩法'] === '胜平负') aiFields.spf = p['建议方向'];
                    if (p['玩法'] === '大小球') aiFields.overunder = p['建议方向'];
                    if (p['玩法'] === '比分预测') aiFields.score = p['建议方向'];
                  });
                  predictionLog.upsertAI(mid, aiFields);
                } catch (e) {}

                return entry;
              } catch (e) {
                console.error('[ai] cache err:', e.message);
                return null;
              }
            }

            // 已有双模型合并 → 直接返回
            if (cachedEntry && cachedEntry.content && hasDS && hasDB) {
              return res.json({
                code: 1,
                data: {
                  matchId: mid,
                  content: cachedEntry.content,
                  confidence: cachedEntry.confidence || 0,
                  fromCache: true,
                  dualModel: true,
                  merged: true,
                  shujuMissing: shujuMissing,
                },
              });
            }
            // 旧格式
            if (cachedEntry && cachedEntry.content && !cachedEntry.sources) {
              return res.json({
                code: 1,
                data: {
                  matchId: mid,
                  content: cachedEntry.content,
                  confidence: cachedEntry.confidence || 0,
                  fromCache: true,
                  legacy: true,
                  shujuMissing: shujuMissing,
                },
              });
            }
            // 已有单模型缓存（另一个还在跑）→ 先返回，让前端轮询
            if (cachedEntry && cachedEntry.content && cachedEntry.sources && (hasDS || hasDB) && !(hasDS && hasDB)) {
              return res.json({
                code: 1,
                data: {
                  matchId: mid,
                  content: cachedEntry.content,
                  confidence: cachedEntry.confidence || 0,
                  fromCache: true,
                  singleModel: true,
                  pendingMerge: true,
                  readySource: hasDS ? 'deepseek' : 'doubao',
                  failedSource: null,
                  shujuMissing: shujuMissing,
                },
              });
            }

            // ★ 无缓存 → 不再触发 AI API（由定时 daemon 统一生成），返回未就绪
            return res.json({
              code: 1,
              data: {
                matchId: mid,
                notReady: true,
                msg: 'AI 分析尚未生成，每日 11:30 / 16:30 定时批量生成，届时刷新即可查看',
              },
            });
            // ★ P1-1: 缓存量化方案结果
            _quantPlanCache[dateStr] = { time: qpNow, response: qpResponse };
            // ★ P2: LRU 清理（最多缓存 10 个日期）
            const qpKeys = Object.keys(_quantPlanCache);
            if (qpKeys.length > 10) {
              qpKeys.sort(function (a, b) { return _quantPlanCache[a].time - _quantPlanCache[b].time; });
              delete _quantPlanCache[qpKeys[0]];
            }
            return res.json(qpResponse);
          } catch (e) {
            logger.error('[ai-predict] ' + e.message);
            return res.json({ code: 0, msg: 'AI 分析异常，请稍后重试' });
          }
        }
        case 'ai-predict-status': {
          try {
            const fs = require('fs');
            const path = require('path');
            const today = localDate();
            let totalMatches = 0,
              finishedMatches = 0;
            try {
              const dataFile = getDataJson();
              const mMap = dataFile.m || {};
              Object.values(mMap).forEach(function (m) {
                if (!m || !m.date) return;
                if ((m.date || '').slice(0, 10) === today) {
                  totalMatches++;
                  if (m.matchStatus >= 2) finishedMatches++;
                }
              });
            } catch (e) {}
            return res.json({
              code: 1,
              data: {
                todayDate: today,
                totalMatches: totalMatches,
                finishedMatches: finishedMatches,
                unfinishedMatches: totalMatches - finishedMatches,
                canShowCards: totalMatches - finishedMatches > 0,
              },
            });
            // ★ P1-1: 缓存量化方案结果
            _quantPlanCache[dateStr] = { time: qpNow, response: qpResponse };
            // ★ P2: LRU 清理（最多缓存 10 个日期）
            const qpKeys = Object.keys(_quantPlanCache);
            if (qpKeys.length > 10) {
              qpKeys.sort(function (a, b) { return _quantPlanCache[a].time - _quantPlanCache[b].time; });
              delete _quantPlanCache[qpKeys[0]];
            }
            return res.json(qpResponse);
          } catch (e) {
            return res.json({ code: 0, msg: e.message });
          }
        }
        // ========== 攻守道量化 ==========
        case 'gongshoudao': {
          const mid = data.matchId;
          if (!mid) return res.json({ code: 0, msg: '缺少 matchId' });
          try {
            // 优先从功守道引擎缓存读取（★ 10秒超时保护，防止外部API挂死）
            let gsResult = null;
            try {
              const gsEngine = require('./gongshoudao/index');
              gsResult = await Promise.race([
                gsEngine.getMatchResult(mid),
                new Promise(function (_, reject) {
                  setTimeout(function () {
                    reject(new Error('GS timeout'));
                  }, 10000);
                }),
              ]);
            } catch (gsErr) {
              logger.warn('[gongshoudao] 引擎异常/超时: ' + gsErr.message);
            }

            if (gsResult) {
              // ★ 追加比分赔率（BF scoreOdds）
              try {
                const dataFile2 = getDataJson();
                const mMap2 = dataFile2.m || {};
                const m2 = mMap2['m_' + mid] || mMap2[mid];
                if (m2) {
                  const dateStr2 = (m2.date || '').slice(0, 10);
                  const num2 = m2.num || '';
                  const allplays = getAllplaysData();
                  const so = getScoreOdds(allplays, dateStr2, num2);
                  if (so) gsResult.scoreOdds = so;
                }
              } catch (e) {
                /* ignore */
              }
              return res.json({ code: 1, data: gsResult });
            }

            // 降级：使用 AI 缓存 + data.json 返回基础数据
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const m = mMap['m_' + mid] || mMap[mid];
            if (!m) return res.json({ code: 0, msg: '比赛不存在' });

            const num = m.num || '';
            const histOdds = getOddsHistory(latestDataDate()) || {};
            const od = histOdds[num] || {};

            const gs = {
              matchId: mid,
              homeName: m.homeName || '',
              visitName: m.visitName || '',
              leagueName: m.leagueName || '',
              num: m.num || '',
              attackAdvantage: '+0%',
              attackAdvantageValue: 50,
              defenseAdvantage: '+0%',
              defenseAdvantageValue: 50,
              attackPattern: '攻守平衡',
              attackWeightHome: '50%',
              attackWeightAway: '50%',
              defenseWeightHome: '50%',
              defenseWeightAway: '50%',
              totalAdvantage: '+0%',
              totalAdvantageValue: 50,
              homeWeight: '50%',
              awayWeight: '50%',
              goalDiffHome: '--',
              goalDiffAway: '--',
              totalGoalsExpect: '--',
              totalGoalsValue: 50,
              homeWinExpect: '+0.00',
              homeWinValue: 50,
              totalAdvantage2: '+0.00',
              totalAdvantage2Value: 50,
              goalCount: '±0',
              goalCountValue: 50,
              verifyResult: '暂无数据',
              verifyValue: 50,
              resonance: { verdict: '数据不足，无法完成量化分析，请使用"AI深度解析"获取更全面的比赛分析' },
              scores: [],
              suggestion: '统计数据暂未就绪。请使用AI深度解析功能获取实时分析。',
            };
            return res.json({ code: 1, data: gs, fallback: true });
          } catch (e) {
            return res.json({ code: 0, msg: '查询失败: ' + e.message });
          }
        }
        // ========== 量化热度数据 ==========
        case 'gongshoudao-all': {
          // 批量获取所有比赛的功守道数据（一次请求替代 N 次单场 gongshoudao 调用）
          const requestDate = data.date || latestDataDate();

          // ★ P1: 5 分钟内存缓存
          const now = Date.now();
          if (_gsAllCache && _gsAllCache.date === requestDate && now - _gsAllCacheTime < CACHE_TTL_5MIN) {
            return res.json(_gsAllCache.response);
          }

          try {
            // ★ P1-2: 复用统一的 _gsGlobalCache，不再独立读磁盘
            const gsAll = getGsGlobalMap();

            // 读取 data.json 筛选当天比赛，按 matchId 返回缓存数据
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};

            const result = {};
            Object.keys(mMap).forEach(function (k) {
              const m = mMap[k];
              if (!m || !m.date || m.date.slice(0, 10) !== requestDate) return;
              const mid = m.matchId || k.replace(/^m_/, '');
              // 兼容多种缓存 key 格式（含/不含 m_ 前缀）
              result[mid] = gsAll[k] || gsAll['m_' + mid] || gsAll[mid] || null;
            });

            // ★ P1-2: 使用内存缓存时间戳替代磁盘 stat
            const gsCacheTime = _gsGlobalCacheTime ? new Date(_gsGlobalCacheTime).toISOString() : null;

            const response = { code: 1, data: { date: requestDate, gsData: result, gsCacheTime: gsCacheTime } };
            // ★ P1: 缓存结果（5 分钟）
            _gsAllCache = { date: requestDate, response };
            _gsAllCacheTime = now;
            return res.json(response);
          } catch (e) {
            return res.json({ code: 0, msg: '功守道批量获取失败: ' + e.message });
          }
        }

        // ========== 预测回测 ==========
        case 'prediction-backtest': {
          try {
            await predictionLog.asyncEnsure();
            const result = predictionLog.queryBacktest({
              type: data.type || 'all',
              dateRange: data.dateRange || 'all',
              league: data.league || 'all',
              direction: data.direction || 'all',
              aiConf: data.aiConf || 'all',
              pkConf: data.pkConf || 'all',
              consensus: data.consensus || 'all',
              page: parseInt(data.page) || 1,
              pageSize: parseInt(data.pageSize) || 20,
            });

            // ★ P1-4: 空数据时输出诊断信息
            if (!result.items || result.items.length === 0) {
              const totalAll = predictionLog.getTotalCount();
              logger.warn('[bt] 回测查询返回空 | DB就绪=' + predictionLog.isReady() +
                ' | 有赛果总数=' + totalAll +
                ' | 筛选条件=' + JSON.stringify({ type: data.type, dateRange: data.dateRange, direction: data.direction }));
              if (!predictionLog.isReady()) {
                logger.warn('[bt] ⚠ 数据库未就绪，请检查 midou_data.db 初始化状态');
              }
              if (totalAll === 0) {
                logger.warn('[bt] ⚠ prediction_logs 表中无赛果记录，请运行: node server/backfill_prediction_logs.js');
              }
            }

            // Add league list and total count
            result.leagues = predictionLog.getLeagues();
            return res.json({ code: 1, data: result });
          } catch (e) {
            return res.json({ code: 0, msg: '回测查询失败: ' + e.message });
          }
        }

        // ========== 预测回测联赛列表 ==========
        case 'backtest-leagues': {
          try {
            await predictionLog.asyncEnsure();
            const leagues = predictionLog.getLeagues();
            const total = predictionLog.getTotalCount();
            return res.json({ code: 1, data: { leagues: leagues, total: total } });
          } catch (e) {
            return res.json({ code: 0, msg: e.message });
          }
        }

        // ========== 量化热度数据 ==========
        case 'quant-hot': {
          const requestDate = data.date || latestDataDate();

          // ★ P1: 5 分钟内存缓存
          const now2 = Date.now();
          if (_quantHotCache && _quantHotCache.date === requestDate && now2 - _quantHotCacheTime < CACHE_TTL_5MIN) {
            return res.json(_quantHotCache.response);
          }

          try {
            // ★ P1-2: 复用统一的 _gsGlobalCache，不再独立读磁盘
            const gsCacheMap = getGsGlobalMap();

            // 2) 读取 data.json → 筛选当天比赛
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};

            const matchList = [];
            Object.keys(mMap).forEach(function (k) {
              const m = mMap[k];
              if (!m || !m.date) return;
              if (m.date.slice(0, 10) !== requestDate) return;
              const mid = m.matchId || k.replace(/^m_/, '');
              const gs = gsCacheMap[k] || gsCacheMap['m_' + mid] || gsCacheMap[mid] || {};
              matchList.push({
                matchId: mid,
                num: m.num || '',
                rq: gs.crossRq !== undefined ? gs.crossRq : null,
                homePower: gs.homePower,
                guestPower: gs.guestPower,
              });
            });

            // 3) 调用热度计算
            const jczqChange = require('./jczq_change');
            const result = await jczqChange.computeHotData(requestDate, matchList);

            // ★Phase1: 从结果中取最晚的 _ts 作为热度数据更新时间
            let hotCacheTime = null;
            try {
              Object.keys(result).forEach(function (k) {
                const ts = result[k] && result[k]._ts;
                if (ts && (!hotCacheTime || ts > hotCacheTime)) hotCacheTime = ts;
              });
            } catch (e) {}
            // 如果 entry 中没有 _ts，回退到全量缓存文件的 mtime
            if (!hotCacheTime) {
              try {
                const changeCachePath = path.join(__dirname, 'jczq_change_cache.json');
                if (fs.existsSync(changeCachePath)) {
                  hotCacheTime = fs.statSync(changeCachePath).mtime.toISOString();
                }
              } catch (e) {}
            }

            const response = { code: 1, data: { date: requestDate, hotData: result, hotCacheTime: hotCacheTime } };
            // ★ P1: 缓存结果（5 分钟）
            _quantHotCache = { date: requestDate, response };
            _quantHotCacheTime = now2;
            return res.json(response);
          } catch (e) {
            return res.json({ code: 0, msg: '热度数据获取失败: ' + e.message });
          }
        }

        case 'ai-batch-generate': {
          const daemon = require('./ai_daemon');
          daemon.dailyBatch();
          return res.json({ code: 1, data: { message: 'AI批量生成已启动' } });
        }

        // ========== 今日方案列表 ==========
        case 'plan-list': {
          try {
            const dateStr = data.date || latestDataDate();
            const fs = require('fs');
            const path = require('path');

            // ★ 当日方案仅在下午 4 点后展示
            const today = localDate();
            if (dateStr === today) {
              const now = new Date();
              const hour = now.getHours();
              if (hour < 16) {
                return res.json({
                  code: 1,
                  data: { date: dateStr, plans: [], notice: '今日方案预计 16:00 后陆续更新', waitUntil: '16:00' },
                });
              }
            }

            // 1) 从 data.json 加载比赛和推荐
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};
            const mList = [];
            Object.keys(mMap).forEach((k) => {
              const m = mMap[k];
              if (m && (m.date || '').slice(0, 10) === dateStr) mList.push(m);
            });

            // 2) 工具函数
            function normalizeRecs(recs) {
              return (recs || []).map(function (x) {
                const raw = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
                const r = raw === 0 || raw === 1 ? raw : null;
                return { type: x.t || x.type, num: x.n || x.num, result: r };
              });
            }
            function loadOddsFromFile(date, num) {
              const odds = getOddsHistory(date);
              return odds ? odds[num] || null : null;
            }

            // 预计算：一次获取所有比赛的 recs 和 odds，消除 N 次重复查找
            const matchDataMap = {};
            for (const m of mList) {
              const num = m.num || '';
              const key = m.matchId;
              const raw = rMap['m_' + key] || rMap[String(key)] || [];
              matchDataMap[key] = {
                match: m,
                recs: normalizeRecs(raw),
                odds: loadOddsFromFile(dateStr, num),
              };
            }

            function findRecommends(matchId) {
              const md = matchDataMap[matchId];
              return md ? md.recs : [];
            }

            function getMatchOdds(match, direction) {
              const md = matchDataMap[match.matchId];
              const od = md && md.odds;
              if (od) {
                return {
                  spf: od.spf ? { home: od.spf.home, draw: od.spf.draw, away: od.spf.away } : null,
                  rqspf: od.rqspf
                    ? { home: od.rqspf.home, draw: od.rqspf.draw, away: od.rqspf.away, handicap: od.rqspf.handicap }
                    : null,
                  totalGoals: od.totalGoals || null,
                  halfFull: od.halfFull || null,
                };
              }
              return null;
            }

            function extractSubOdds(oddsObj, direction) {
              const vals = [];
              if (direction.indexOf('总进球-') === 0) {
                const tg = oddsObj.totalGoals;
                if (!tg) return vals;
                const nums = direction.replace('总进球-', '').split(/[、,]/);
                nums.forEach((n) => {
                  const v = n.replace(/球/g, '').trim();
                  if (tg[v] !== undefined) vals.push(tg[v]);
                });
                return vals;
              }
              if (direction.indexOf('、') >= 0 || direction.indexOf(',') >= 0) {
                const parts = direction.split(/[、,]/);
                parts.forEach((pd) => {
                  pd = pd.trim();
                  if (pd === '平' && oddsObj.spf) vals.push(oddsObj.spf.draw);
                  else if (pd === '胜' && oddsObj.spf) vals.push(oddsObj.spf.home);
                  else if (pd === '负' && oddsObj.spf) vals.push(oddsObj.spf.away);
                  else if (pd === '让平' && oddsObj.rqspf) vals.push(oddsObj.rqspf.draw);
                  else if (pd === '让负' && oddsObj.rqspf) vals.push(oddsObj.rqspf.away);
                  else if (pd === '让胜' && oddsObj.rqspf) vals.push(oddsObj.rqspf.home);
                });
                return vals;
              }
              if (direction === '胜平' && oddsObj.spf) {
                vals.push(oddsObj.spf.home);
                vals.push(oddsObj.spf.draw);
                return vals;
              }
              if (direction === '平负' && oddsObj.spf) {
                vals.push(oddsObj.spf.draw);
                vals.push(oddsObj.spf.away);
                return vals;
              }
              if (direction === '让负' && oddsObj.rqspf) vals.push(oddsObj.rqspf.away);
              else if (direction === '让胜' && oddsObj.rqspf) vals.push(oddsObj.rqspf.home);
              else if (direction === '胜' && oddsObj.spf) vals.push(oddsObj.spf.home);
              else if (direction === '负' && oddsObj.spf) vals.push(oddsObj.spf.away);
              return vals;
            }

            function findBestMatchForDirection(directions, excludeIds) {
              let bestMatch = null,
                bestCount = 0;
              for (const m of mList) {
                if (excludeIds && excludeIds.indexOf(m.matchId) >= 0) continue;
                // 使用预计算缓存，消除重复磁盘 I/O
                const md = matchDataMap[m.matchId];
                if (!md || !md.odds) continue;
                const recs = md.recs;
                let total = 0;
                for (const r of recs) {
                  if (directions.indexOf(r.type) >= 0) total += r.num || 0;
                }
                if (total > bestCount) {
                  bestCount = total;
                  bestMatch = m;
                }
              }
              return bestMatch;
            }

            function buildMatchObj(m, direction) {
              const recs = findRecommends(m.matchId);
              let expertCount = 0,
                isMatchWon = null,
                isMatchLose = null;
              // 单关双选：展开胜平/平负为子方向，以便前端分开展示赔率和命中颜色
              let effectiveDir = direction;
              if (direction === '胜平') effectiveDir = '胜、平';
              else if (direction === '平负') effectiveDir = '平、负';
              const subDirs = effectiveDir.split(/[、,]/);
              const matchedRecsSet = new Set();
              const subResults = [];

              // 辅助：推荐类型是否包含指定子方向
              function recContains(recType, sd) {
                if (recType === sd) return true;
                const parts = recType.split(/[、,]/);
                return parts.some((p) => p.trim() === sd);
              }

              subDirs.forEach((subDir) => {
                const sd = subDir.trim();
                let found = null;
                // 1) 精确匹配
                for (const r of recs) {
                  if (r.type === sd) {
                    found = r;
                    break;
                  }
                }
                // 2) 组合类型中包含子方向（如"让胜、让平"包含"让平"）
                if (!found) {
                  for (const r of recs) {
                    if (recContains(r.type, sd)) {
                      found = r;
                      break;
                    }
                  }
                }
                // 3) 总进球回退（如"3球"→"总进球-3"）
                if (!found && sd.indexOf('球') >= 0) {
                  const num = sd.replace(/球/g, '');
                  for (const r of recs) {
                    if (r.type === '总进球-' + num) {
                      found = r;
                      break;
                    }
                  }
                }
                if (found) {
                  matchedRecsSet.add(found);
                }
                subResults.push({ direction: sd, result: found ? found.result : null });
              });

              // 全部没匹配到时，用全方向模糊匹配兜底
              if (matchedRecsSet.size === 0) {
                for (const r of recs) {
                  const rt = r.type || '';
                  if (rt.indexOf(direction) >= 0 || direction.indexOf(rt) >= 0) {
                    matchedRecsSet.add(r);
                  }
                }
                if (matchedRecsSet.size === 0 && subResults.length === 0) {
                  subResults.push({ direction: direction, result: null });
                }
              }

              // 总进球双选（如"总进球-2、3球"）：用实际比分拆分子方向命中
              if (direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0 && subResults.length >= 2) {
                const combinedRes = subResults[0].result; // 所有子方向共用一个推荐结果
                if (combinedRes === 0) {
                  // 组合未命中，所有子方向均未中
                  subResults.forEach((sr) => {
                    sr.result = 0;
                  });
                } else if (combinedRes === 1 && m.score) {
                  // 组合命中，根据实际总进球数确定哪个子方向命中
                  const scoreParts = String(m.score).split(':');
                  const totalGoals = parseInt(scoreParts[0]) + parseInt(scoreParts[1]);
                  if (!isNaN(totalGoals)) {
                    subResults.forEach((sr) => {
                      const goalMatch = sr.direction.match(/(\d+)/);
                      if (goalMatch && parseInt(goalMatch[1]) === totalGoals) {
                        sr.result = 1;
                      } else {
                        sr.result = 0;
                      }
                    });
                  }
                }
              }

              const matchedRecs = Array.from(matchedRecsSet);
              expertCount = matchedRecs.reduce((s, r) => s + (r.num || 0), 0);

              let anyWon = false,
                anyLose = false,
                anyUnknown = false;
              // 总进球双选：用子方向结果判断（避免matchedRecs含错误匹配）
              if (direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0 && subResults.length >= 2) {
                let hasKnown = false;
                for (const sr of subResults) {
                  if (sr.result === 1) {
                    anyWon = true;
                    hasKnown = true;
                  } else if (sr.result === 0) {
                    anyLose = true;
                    hasKnown = true;
                  } else anyUnknown = true;
                }
                if (!hasKnown) anyWon = false;
              } else {
                matchedRecs.forEach((r) => {
                  if (r.result === 1) anyWon = true;
                  else if (r.result === 0) anyLose = true;
                  else anyUnknown = true;
                });
              }
              if (!anyUnknown && matchedRecs.length > 0) {
                isMatchWon = anyWon;
                isMatchLose = !anyWon && anyLose;
              }

              // ★ fallback: 推荐数据无 result 时，用比分+赔率直判方向对错
              if (isMatchWon === null && isMatchLose === null) {
                if (m && m.matchStatus >= 1 && m.score) {
                  const mData = matchDataMap[m.matchId];
                  const mOdds = mData ? mData.odds : null;
                  const hcp = mOdds && mOdds.rqspf ? mOdds.rqspf.handicap : null;
                  // 内联比分判定（与 judgeByScore 逻辑一致）
                  function judgeScoreExp(d, s, h) {
                    // ★ 复合方向（含、号，如"平、让平"）：分开判定，任一命中即可
                    if (d.indexOf('、') >= 0) {
                      var parts = d.split(/[、,]/);
                      for (var pi = 0; pi < parts.length; pi++) {
                        if (judgeScoreExp(parts[pi].trim(), s, h)) return true;
                      }
                      return false;
                    }
                    var p = String(s).replace(/[-:]/g, ':').split(':');
                    var hh = parseInt(p[0]);
                    var aa = parseInt(p[1]);
                    if (isNaN(hh) || isNaN(aa)) return null;
                    if (d === '胜') return hh > aa;
                    if (d === '平') return hh === aa;
                    if (d === '负') return hh < aa;
                    if (d === '胜平') return hh > aa || hh === aa;
                    if (d === '平负') return hh === aa || hh < aa;
                    if (d === '让胜' || d === '让平' || d === '让负') {
                      var ec = hh + (h != null ? parseFloat(h) || 0 : 0);
                      if (d === '让胜') return ec > aa;
                      if (d === '让平') return ec === aa;
                      if (d === '让负') return ec < aa;
                    }
                    var gm = d.match(/总进球-(\d+)/);
                    if (gm) return (hh + aa) === parseInt(gm[1]);
                    return null;
                  }
                  var scoreResult = judgeScoreExp(direction, m.score, hcp);
                  if (scoreResult !== null) {
                    isMatchWon = scoreResult;
                    isMatchLose = !scoreResult;
                    // 同步更新 subResults — 直接用 isMatchWon 兜底
                    for (var sri2 = 0; sri2 < subResults.length; sri2++) {
                      var sd2 = subResults[sri2].direction;
                      var sr2 = judgeScoreExp(sd2, m.score, hcp);
                      if (sr2 !== null) {
                        subResults[sri2].result = sr2 ? 1 : 0;
                      } else if (sd2 === direction || sd2.indexOf(direction) >= 0 || direction.indexOf(sd2) >= 0) {
                        subResults[sri2].result = isMatchWon ? 1 : 0;
                      }
                    }
                  }
                }
              }

              // ★ 最终兜底：isMatchWon 已确定但 subResults 仍有 null 时同步
              if (isMatchWon !== null && isMatchLose !== null) {
                // 方案六三方向进球：若缺少比分无法拆分具体命中进球数，不强制全部标红
                var isPlan6Multi = direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0;
                for (var sri3 = 0; sri3 < subResults.length; sri3++) {
                  if (subResults[sri3].result === null || subResults[sri3].result === undefined) {
                    if (isPlan6Multi && isMatchWon && (!m.score || m.score === '')) {
                      // 缺少比分数据，无法确定具体哪个进球命中，保留 null（前端显示白色/待定）
                      subResults[sri3].result = null;
                    } else {
                      subResults[sri3].result = isMatchWon ? 1 : 0;
                    }
                  }
                }
              }

              return {
                matchId: m.matchId,
                homeName: m.homeName,
                visitName: m.visitName,
                leagueName: m.leagueName,
                matchNum: m.num || '',
                startTime: m.startTime || '',
                matchStatus: m.matchStatus || 0,
                direction: direction,
                expertCount: expertCount,
                isMatchWon: isMatchWon,
                isMatchLose: isMatchLose,
                subResults: subResults,
                odds: getMatchOdds(m, direction),
              };
            }

            function calcEffectiveOdds(direction, match) {
              const oddsObj = match.odds || {};
              const subOdds = extractSubOdds(oddsObj, direction);
              if (subOdds.length === 0) {
                // ★ 赔率缺失兜底：总进球多选方向用子方向数估算荷兰式有效赔率
                if (direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0) {
                  const nSelections = direction.split(/[、,]/).length || 2;
                  return 3.5 / nSelections; // 典型总进球赔率≈3.5, 荷兰式 = 3.5/N
                }
                return null;
              }
              const N = subOdds.length;
              if (N === 1) return subOdds[0];
              // ★ 荷兰式公式：1 / Σ(1/o) 替代错误的 sum/(2N)
              const invSum = subOdds.reduce((a, b) => a + 1 / b, 0);
              return invSum > 0 ? 1 / invSum : null;
            }

            // 3) 生成策略方案
            const plans = [];
            const matchCount = mList.length;

            const m1a = findBestMatchForDirection(['平', '让平']);
            const m1b = findBestMatchForDirection(['让负'], m1a ? [m1a.matchId] : null);
            const m2a = findBestMatchForDirection(['总进球-2、3球']);
            const m2b = findBestMatchForDirection(['让负']);
            const m3a = findBestMatchForDirection(['胜']);
            const m3b = findBestMatchForDirection(['胜'], m3a ? [m3a.matchId] : null);

            function push2MatchPlan(planName, planSuffix, mA, dirA, mB, dirB, betCount, ticketCount, multiplier) {
              if (!mA || !mB) return;
              const aObj = buildMatchObj(mA, dirA);
              const bObj = buildMatchObj(mB, dirB);
              const e1 = calcEffectiveOdds(dirA, aObj);
              const e2 = calcEffectiveOdds(dirB, bObj);
              const maxPrize = (e1 && e2) ? Math.round(1000 * e1 * e2) : 0;

              plans.push({
                planId: 'plan_' + dateStr + '_' + planSuffix,
                planName: planName,
                matches: [aObj, bObj],
                amount: 1000,
                playType: '混合投注',
                matchCount: 2,
                passType: '2串1',
                betCount: betCount,
                ticketCount: ticketCount,
                multiplier: multiplier || 25,
                maxPrize: maxPrize,
                winningPrize: maxPrize,
              });
            }

            push2MatchPlan('方案一', '1', m1a, '平、让平', m1b, '让负', 250, 10);
            push2MatchPlan('方案二', '2', m2a, '总进球-2、3球', m2b, '让负', 250, 10);
            push2MatchPlan('方案三', '3', m3a, '胜', m3b, '胜', 500, 10, 50);

            // 方案六：当天专家推"总进球-2、3球"数最多的一场，单关荷兰式投注（二选）
            if (matchCount >= 4) {
              const targetDir6 = '总进球-2、3球';
              let bestM6 = null, bestCount6 = 0;
              for (const m of mList) {
                const recs = findRecommends(m.matchId);
                for (const r of recs) {
                  if (r.type === targetDir6 && (r.num || 0) > bestCount6) {
                    bestCount6 = r.num;
                    bestM6 = m;
                  }
                }
              }
              if (bestM6 && bestCount6 > 0) {
                const m6Obj = buildMatchObj(bestM6, targetDir6);
                // 方案六：标准荷兰式投注（二选），奖金 = 总本金 / Σ(1/赔率)
                const subOdds6 = extractSubOdds(m6Obj.odds, targetDir6);
                let maxPrize6;
                if (subOdds6.length === 2) {
                  const invSum6 = subOdds6.reduce((s, o) => s + 1 / o, 0);
                  maxPrize6 = invSum6 > 0 ? Math.round(1000 / invSum6) : 0;
                } else {
                  // ★ 赔率缺失兜底：二选总进球用 3.5/2 荷兰式倍率
                  maxPrize6 = Math.round(1000 * 3.5 / 2);
                }
                plans.push({
                  planId: 'plan_' + dateStr + '_6',
                  planName: '方案六',
                  matches: [m6Obj],
                  amount: 1000,
                  playType: '单关',
                  matchCount: 1,
                  passType: '单关',
                  betCount: 250,
                  ticketCount: 10,
                  multiplier: 25,
                  maxPrize: maxPrize6,
                  winningPrize: maxPrize6,
                });
              }
            }

            // 方案四～五：仅在 ≥15 场时生成
            if (matchCount >= 15) {
              const m4a = findBestMatchForDirection(['平', '让平']);
              const m4b = findBestMatchForDirection(['胜'], m4a ? [m4a.matchId] : null);
              push2MatchPlan('方案四', '4', m4a, '平、让平', m4b, '胜', 250, 10);

              const m5a = findBestMatchForDirection(['平', '让平']);
              const m5b = findBestMatchForDirection(['总进球-2、3球'], m5a ? [m5a.matchId] : null);
              push2MatchPlan('方案五', '5', m5a, '平、让平', m5b, '总进球-2、3球', 125, 5);
            }

            // ========== 方案七：单关双选（胜平/平负） ==========
            const singleMatches = mList.filter((m) => {
              const md = matchDataMap[m.matchId];
              return md && md.odds && md.odds.isSingleGame === true;
            });
            if (singleMatches.length > 0) {
              let bestM7 = null,
                bestM7Dir = '',
                bestM7Count = 0;
              for (const sm of singleMatches) {
                const recs = matchDataMap[sm.matchId].recs;
                for (const r of recs) {
                  if ((r.type === '胜平' || r.type === '平负') && r.num > bestM7Count) {
                    bestM7Count = r.num;
                    bestM7 = sm;
                    bestM7Dir = r.type;
                  }
                }
              }
              if (bestM7 && bestM7Dir) {
                const m7Obj = buildMatchObj(bestM7, bestM7Dir);
                // ★ P1-方案七：标准荷兰式奖金 = 总本金 / Σ(1/赔率)
                const subOdds7 = extractSubOdds(m7Obj.odds, bestM7Dir);
                const invSum7 = subOdds7.reduce((s, o) => s + 1 / o, 0);
                const maxPrize7 = invSum7 > 0 ? Math.round(1000 / invSum7) : 0;
                plans.push({
                  planId: 'plan_' + dateStr + '_7',
                  planName: '方案七',
                  matches: [m7Obj],
                  amount: 1000,
                  playType: '单关',
                  matchCount: 1,
                  passType: '单关',
                  betCount: 250,
                  ticketCount: 10,
                  multiplier: 25,
                  maxPrize: maxPrize7,
                  winningPrize: maxPrize7,
                });
              }
            }

            // 比赛低于5场时最多只保留前2个方案
            if (matchCount < 5 && plans.length > 2) {
              plans.splice(2);
            }

            return res.json({ code: 1, data: { date: dateStr, plans } });
          } catch (e) {
            return res.json({ code: 0, msg: '获取方案列表失败: ' + e.message });
          }
        }

        // ========== 比分方案列表 ==========
        case 'score-plan-list': {
          try {
            const dateStr = data.date || latestDataDate();
            const today = localDate();

            // ★ 当天方案在 12:00 前不展示
            if (dateStr === today) {
              const now = new Date();
              const hour = now.getHours();
              if (hour < 12) {
                return res.json({
                  code: 1,
                  data: { date: dateStr, plans: [], notice: '单关比分方案预计 12:00 后自动生成', waitUntil: '12:00' },
                });
              }
            }

            const fs = require('fs');
            const path = require('path');

            // 1) 加载功守道缓存
            let gsCacheMap = {};
            const gsCachePath = path.join(__dirname, 'gongshoudao', 'cache.json');
            try {
              if (fs.existsSync(gsCachePath)) {
                gsCacheMap = JSON.parse(fs.readFileSync(gsCachePath, 'utf8'))['_global'] || {};
              }
            } catch (e) {
              logger.warn('[score-plan] 功守道缓存读取失败: ' + e.message);
            }

            // 2) 加载 data.json
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const mList = [];
            Object.keys(mMap).forEach((k) => {
              const m = mMap[k];
              if (m && (m.date || '').slice(0, 10) === dateStr) {
                // 兼容缓存 key 格式
                const mid = m.matchId || k.replace(/^m_/, '');
                const cached = gsCacheMap[k] || gsCacheMap['m_' + mid] || gsCacheMap[mid] || null;
                mList.push({ match: m, gs: cached, matchId: mid });
              }
            });

            if (mList.length === 0) {
              return res.json({ code: 1, data: { date: dateStr, plans: [], notice: '今日暂无比赛数据' } });
            }

            // 3) 加载 BF 赔率
            const allplays = getAllplaysData();

            // 4) 荷兰式均分辅助函数（P2-方案七/八 + P0-方案二/三 + P1-方案六）
            function dutchCombinations(oddsMap, totalCapital, strongIsHome, useBfOdds, qual) {
              const scorePercentMap = (qual && qual.scorePercentMap) || null;
              const goalUpper = (qual && qual.goalUpper) || 0;
              const xgHome = (qual && qual.xgHome) || 0;
              const xgAway = (qual && qual.xgAway) || 0;
              const xgDiff = Math.abs(xgHome - xgAway);
              const totalStrength = (qual && qual.totalStrength) || 0;
              const absStrength = Math.abs(totalStrength);
              const strongXg = strongIsHome ? xgHome : xgAway;
              const weakXg = strongIsHome ? xgAway : xgHome;

              // ★ P2-方案七：强弱队进球模式分类
              let matchType = 'normal';
              if (absStrength > 0.25 && xgDiff > 1.2) {
                matchType = 'crush'; // 碾压型：弱队基本不进球
              } else if (absStrength > 0.2 && weakXg > 0.8) {
                matchType = 'attack-crush'; // 对攻碾压：弱队能还手1球
              } else if (absStrength <= 0.2 || xgDiff <= 1.0) {
                matchType = 'narrow'; // 险胜型：窄比分为主
              }

              // 筛选候选比分
              const preferred = [];
              const drawCandidates = []; // ★ P1-方案六：高比分平局
              const allCandidates = [];
              Object.keys(oddsMap).forEach(function (score) {
                const parts = score.split('-');
                if (parts.length !== 2) return;
                const h = parseInt(parts[0]),
                  a = parseInt(parts[1]);
                if (isNaN(h) || isNaN(a)) return;
                allCandidates.push(score);

                const strongWin = strongIsHome ? h - a >= 1 : a - h >= 1;
                if (strongWin) {
                  // ★ P2-方案七：根据进球模式筛选
                  if (matchType === 'crush') {
                    // 碾压型：弱队必须 0 球 (如 2-0/3-0/4-0)
                    if ((strongIsHome ? a : h) === 0) preferred.push(score);
                  } else if (matchType === 'narrow') {
                    // 险胜型：只取净胜 ≤2 的比分 (如 1-0/2-1/2-0)
                    if (Math.abs(h - a) <= 2) preferred.push(score);
                  } else {
                    // 对攻碾压/正常型：弱队最多进 1 球
                    if ((strongIsHome ? a : h) <= 1) preferred.push(score);
                  }
                }

                // ★ P1-方案六：高比分平局纳入（大球场景下 2-2/3-3 等）
                if (goalUpper >= 4 && h === a && h >= 2) {
                  drawCandidates.push(score);
                }
              });

              // 先用分类后的比分，不足2个则用全部比分
              const candidates = preferred.length >= 2 ? preferred.slice() : allCandidates.slice();
              // ★ P1-方案六：大球平局补充
              if (goalUpper >= 4 && drawCandidates.length > 0) {
                drawCandidates.forEach(function (ds) {
                  if (candidates.indexOf(ds) < 0) candidates.push(ds);
                });
              }
              if (candidates.length < 2) return [];

              // 按赔率从低到高排序
              candidates.sort(function (a, b) {
                return (oddsMap[a] || 100) - (oddsMap[b] || 100);
              });

              // 尝试 2~4 个比分的组合
              const results = [];
              function tryCombos(r, start, chosen) {
                if (chosen.length >= 2 && chosen.length <= 4) {
                  let invSum = 0;
                  let coverageSum = 0;
                  let hasDraw = false;
                  for (var i = 0; i < chosen.length; i++) {
                    const odd = oddsMap[chosen[i]];
                    if (!odd || odd <= 0) return;
                    invSum += 1 / odd;
                    // ★ P0-方案二：覆盖率计算
                    if (useBfOdds) {
                      coverageSum += 1 / odd; // 真实赔率的隐含概率
                    } else if (scorePercentMap && typeof scorePercentMap[chosen[i]] !== 'undefined') {
                      coverageSum += parseFloat(scorePercentMap[chosen[i]]) || 0;
                    }
                    const parts2 = chosen[i].split('-');
                    if (parts2[0] === parts2[1]) hasDraw = true;
                  }
                  if (invSum > 0) {
                    // ★ P3: 使用衰减后权重分配的回报为 adjInvSum 对应值，此处为基准预期回报
                    const baseExpectedReturn = totalCapital / invSum;

                    // ★ P0-方案三：虚拟赔率分级下限（按覆盖比分数量）
                    let minR;
                    if (useBfOdds) {
                      minR = 1.8;
                    } else {
                      if (chosen.length === 2) minR = 2.0;
                      else if (chosen.length === 3) minR = 1.6;
                      else minR = 1.4; // 4 个比分
                    }

                    // ★ P0-方案二：覆盖率检查
                    const minCoverage = useBfOdds ? 0.3 : 25;
                    if (coverageSum < minCoverage) return;

                    // ★ P1-方案六：平局衰减→回报率要求提高10%
                    const effectiveMinR = hasDraw ? minR * 1.1 : minR;

                    if (baseExpectedReturn >= totalCapital * effectiveMinR && baseExpectedReturn <= totalCapital * 2.5) {
                      const combo = chosen.slice();
                      // 计算带衰减的资金分配权重
                      const weights = [];
                      for (let j = 0; j < combo.length; j++) {
                        const o2 = oddsMap[combo[j]];
                        let w = 1 / o2;
                        // ★ P1-方案六：平局比分资金分配衰减到80%
                        const parts3 = combo[j].split('-');
                        if (parts3[0] === parts3[1] && goalUpper >= 4) {
                          w *= 0.8;
                        }
                        weights.push(w);
                      }
                      const adjInvSum = weights.reduce(function (a, b) {
                        return a + b;
                      }, 0);
                      const allocations = [];
                      for (let k = 0; k < combo.length; k++) {
                        allocations.push(Math.round((totalCapital * weights[k]) / adjInvSum));
                      }
                      // 微调使总和等于 totalCapital
                      const allocSum = allocations.reduce(function (a, b) {
                        return a + b;
                      }, 0);
                      if (allocSum !== totalCapital) {
                        allocations[allocations.length - 1] += totalCapital - allocSum;
                      }

                      // ★ P2-方案八：综合评分 = 覆盖率×0.5 + 回报率×0.5
                      const coverageNorm = useBfOdds ? Math.min(1, coverageSum / 0.5) : Math.min(1, coverageSum / 40);
                      const returnNorm = Math.min(
                        1,
                        (baseExpectedReturn / totalCapital - effectiveMinR) / (2.5 - effectiveMinR),
                      );
                      const compositeScore = coverageNorm * 0.5 + returnNorm * 0.5;

                      results.push({
                        scores: combo.map(function (s, si) {
                          return { score: s, odds: oddsMap[s], allocation: allocations[si] };
                        }),
                        // ★ P3: 更名为 baseExpectedReturn 以区分衰减后实际回报
                        baseExpectedReturn: Math.round(baseExpectedReturn),
                        comboLength: combo.length,
                        coverage: coverageSum,
                        compositeScore: compositeScore,
                        matchType: matchType,
                      });
                    }
                  }
                }
                if (r <= 0 || chosen.length >= 4) return;
                for (var i = start; i < candidates.length; i++) {
                  chosen.push(candidates[i]);
                  tryCombos(r - 1, i + 1, chosen);
                  chosen.pop();
                }
              }
              tryCombos(candidates.length, 0, []);

              // ★ P2-方案八：综合评分排序（覆盖率×回报率），替代固定长度优先级
              results.sort(function (a, b) {
                if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
                // 评分相同：3比分 > 2比分 > 4比分
                const orderA = a.comboLength === 3 ? 0 : a.comboLength === 2 ? 1 : 2;
                const orderB = b.comboLength === 3 ? 0 : b.comboLength === 2 ? 1 : 2;
                return orderA - orderB;
              });
              return results;
            }

            // ★ P0: 共识类型解析（优先 fusionConsensusType，降级中文标签映射）
            function resolveConsensusType(gs) {
              const ct = gs.fusionConsensusType;
              if (ct === 'strong' || ct === 'weak' || ct === 'meltdown') return ct;
              const cn = gs.fusionConsensus || '';
              if (cn.startsWith('熔断')) return 'meltdown';
              if (cn.startsWith('弱一致')) return 'weak';
              if (cn.startsWith('强一致')) return 'strong';
              return '';
            }

            // 5) 筛选规则（★ P0-方案一：共识状态门禁）
            function qualifyMatch(item) {
              const gs = item.gs;
              if (!gs) return false;

              // ★ P0-方案一：共识状态门禁（resolveConsensusType 兼容中英文）
              const consensus = resolveConsensusType(gs);
              if (consensus === 'meltdown') return false; // 四重熔断，比分预测完全不可信
              const weakThreshold = consensus === 'weak';
              const stabilityOverall = parseFloat(gs.stabilityOverall) || 0;

              // 规则1: 大球方向
              const bigBallRatio = parseFloat(gs.bigBallRatio) || 0;
              const overRate = gs.goalRange && gs.goalRange.overRate ? parseFloat(gs.goalRange.overRate) : 0;
              const totalExpect = parseFloat(gs.totalGoalsExpect) || 0;
              const isOver = bigBallRatio > 30 || overRate > 35 || totalExpect >= 2.0;
              if (!isOver) return false;

              // 规则2: 攻防同向极化（进攻强的一方防守强，进攻弱的一方防守差）
              const attRaw = parseFloat(gs.attackAdvantageRaw) || 0;
              const defRaw = parseFloat(gs.defenseAdvantageRaw) || 0;
              if (attRaw * defRaw <= 0) return false; // 攻防方向必须一致

              const attAbs = Math.abs(attRaw),
                defAbs = Math.abs(defRaw);
              if (attAbs <= 0.03 || defAbs <= 0.005) return false; // 极化强度不足

              const strongIsHome = attRaw > 0;

              // 规则3: 进球差异 ≥0.6球
              const xgHome = parseFloat(gs.xgHome) || 0;
              const xgAway = parseFloat(gs.xgAway) || 0;
              const xgDiff = Math.abs(xgHome - xgAway);
              if (xgDiff < 0.6) return false;

              // ★ P0-方案一：弱一致提门槛 → 稳定性≥55 且 xgDiff≥1.0
              if (weakThreshold && (stabilityOverall < 55 || xgDiff < 1.0)) return false;

              // 规则4: 弱队进球能力 ≤1.5
              const weakXg = strongIsHome ? xgAway : xgHome;
              if (weakXg > 1.5) return false;

              return {
                strongIsHome: strongIsHome,
                bigBallRatio: bigBallRatio,
                xgHome: xgHome,
                xgAway: xgAway,
                consensus: consensus,
                stabilityOverall: stabilityOverall,
                attRaw: attRaw,
                defRaw: defRaw,
                totalExpect: totalExpect,
              };
            }

            // 6) 遍历比赛，收集候选方案（★ P1-方案四：多维质量分 + ★ P0-方案三：分级下限）
            // ★ P1-方案四：提前构建概率映射备用
            function buildScorePercentMap(gs) {
              if (!gs || !gs.scores || gs.scores.length === 0) return null;
              const map = {};
              gs.scores.forEach(function (s) {
                if (s && s.score && typeof s.percent !== 'undefined') {
                  map[s.score] = parseFloat(s.percent) || 0;
                }
              });
              return Object.keys(map).length > 0 ? map : null;
            }

            const allCandidates = [];
            for (let mi = 0; mi < mList.length; mi++) {
              var item = mList[mi];
              const qual = qualifyMatch(item);
              if (!qual) continue;

              // 获取比分赔率
              const matchDate = (item.match.date || '').slice(0, 10);
              const matchNum = item.match.num || '';
              var bfOdds = getScoreOdds(allplays, matchDate, matchNum);
              const useBfOdds = !!bfOdds;

              // 如果BF赔率不可用，用概率反推
              if (!bfOdds && item.gs && item.gs.scores && item.gs.scores.length > 0) {
                bfOdds = {};
                item.gs.scores.forEach(function (s) {
                  if (!s || !s.score || !s.percent) return;
                  const pct = parseFloat(s.percent) || 0;
                  if (pct > 0) bfOdds[s.score] = Math.round((100 / pct) * 100) / 100;
                });
                // 比分不足4个时，根据已有比分扩展邻近比分
                var existingKeys = Object.keys(bfOdds);
                if (existingKeys.length < 4) {
                  var expandScores = [];
                  existingKeys.forEach(function (sc) {
                    const p = sc.split('-');
                    const h = parseInt(p[0]),
                      a = parseInt(p[1]);
                    if (isNaN(h) || isNaN(a)) return;
                    const variants = [
                      // ±1 变体
                      h + 1 + '-' + a,
                      h + '-' + (a + 1),
                      h + 1 + '-' + (a > 0 ? a - 1 : 0),
                      (h > 0 ? h - 1 : 0) + '-' + (a + 1),
                      (h > 0 ? h - 1 : 0) + '-' + a,
                      h + '-' + (a > 0 ? a - 1 : 0),
                      // ±2 变体（P2 扩展，提升赔率覆盖）
                      h + 2 + '-' + a,
                      h + '-' + (a + 2),
                      h + 2 + '-' + (a + 1),
                      h + 1 + '-' + (a + 2),
                    ];
                    variants.forEach(function (v) {
                      if (expandScores.indexOf(v) < 0 && existingKeys.indexOf(v) < 0) {
                        expandScores.push(v);
                      }
                    });
                  });
                  expandScores.forEach(function (es) {
                    if (!bfOdds[es]) {
                      let minPct = 100;
                      item.gs.scores.forEach(function (s) {
                        const p = parseFloat(s.percent) || 100;
                        if (p < minPct) minPct = p;
                      });
                      const estPct = Math.max(1, minPct * 0.3);
                      bfOdds[es] = Math.round((100 / estPct) * 100) / 100;
                    }
                  });
                }
              }
              if (!bfOdds || Object.keys(bfOdds).length === 0) continue;

              // ★ 构建 qual 对象传给 dutchCombinations
              const scorePercentMap = buildScorePercentMap(item.gs);
              let goalUpper = 0;
              if (item.gs.goalRange && item.gs.goalRange.upper) {
                goalUpper = parseInt(item.gs.goalRange.upper) || 0;
              } else if (item.gs.goalRange && item.gs.goalRange.range) {
                // 兼容 "2-4球" 格式
                const grParts = String(item.gs.goalRange.range).split('-');
                if (grParts.length >= 2) goalUpper = parseInt(grParts[1]) || 0;
              }
              const dutchQual = {
                scorePercentMap: scorePercentMap,
                goalUpper: goalUpper,
                xgHome: qual.xgHome,
                xgAway: qual.xgAway,
                totalStrength: parseFloat(item.gs.totalStrength) || 0,
              };

              const combos = dutchCombinations(bfOdds, 1000, qual.strongIsHome, useBfOdds, dutchQual);
              if (combos.length === 0) continue;

              // ★ P1-方案四：多维比分质量分（在push前计算，用于最终排序）
              const qs = computeScoreQuality(item.gs, qual);
              allCandidates.push({
                match: item.match,
                gs: item.gs,
                matchId: item.matchId,
                strongIsHome: qual.strongIsHome,
                bigBallRatio: qual.bigBallRatio,
                xgHome: qual.xgHome,
                xgAway: qual.xgAway,
                consensus: qual.consensus,
                stabilityOverall: qual.stabilityOverall,
                qualityScore: qs,
                bestCombo: combos[0], // ★ P2-方案八：combos已按综合评分排序
              });
            }

            // ★ P1-方案四 + P1-方案五：多维质量分排序 + 动态方案数量
            function computeScoreQuality(gs, qual) {
              let score = 0;

              // 大球信号 (25分)
              const bigBallRatio = parseFloat(gs.bigBallRatio) || 0;
              score += Math.min(25, bigBallRatio / 4);

              // xG差距 (25分)
              const xgDiff = Math.abs(qual.xgHome - qual.xgAway);
              score += Math.min(25, (xgDiff / 2.0) * 25);

              // 进球稳定性 (20分)
              const stability = parseFloat(gs.stabilityOverall) || 0;
              score += Math.min(20, stability / 5);

              // 共识强度 (20分) — resolveConsensusType 兼容中英文
              const consensus = resolveConsensusType(gs);
              if (consensus === 'strong') score += 20;
              else if (consensus === 'weak') score += 10;
              else if (consensus === 'none' || !consensus) score += 5;

              // 联赛校准 (10分)
              const leagueGoals = parseFloat(gs.leagueAvgGoals) || 0;
              if (leagueGoals > 2.85) score += 10;
              else if (leagueGoals > 2.5) score += 5;

              return Math.min(100, Math.round(score));
            }

            // 按质量分降序排序
            allCandidates.sort(function (a, b) {
              return b.qualityScore - a.qualityScore;
            });

            // ★ P1-方案五：动态方案数量（质量分阈值决定 0~3 个）
            let topCount = 0;
            if (allCandidates.length > 0 && allCandidates[0].qualityScore >= 45) topCount = 1;
            if (allCandidates.length >= 2 && allCandidates[1].qualityScore >= 50) topCount = 2;
            if (
              allCandidates.length >= 3 &&
              allCandidates[2].qualityScore >= 45 &&
              allCandidates[2].bestCombo &&
              (allCandidates[2].bestCombo.coverage || 0) >= 0.25
            )
              topCount = 3;
            // 无高质量候选则不输出
            if (topCount === 0 && allCandidates.length >= 1 && allCandidates[0].qualityScore < 45) topCount = 0;
            const topCandidates = allCandidates.slice(0, Math.max(0, topCount));

            // 7) 构建方案输出（★ 新增 qualityScore、consensus、matchType 字段）
            const plans = topCandidates.map(function (c, idx) {
              const match = c.match;
              const strongSide = c.strongIsHome ? 'home' : 'away';
              const combo = c.bestCombo;

              // 进攻优势格式化
              const attRaw = parseFloat(c.gs.attackAdvantageRaw) || 0;
              const attDisplay = attRaw > 0 ? '+' + Math.round(attRaw * 100) + '%' : Math.round(attRaw * 100) + '%';

              // 赔率组合显示
              const oddsDisplay = combo.scores
                .map(function (s) {
                  return s.odds.toFixed(2);
                })
                .join('/');

              // 进球区间
              const goalRange = c.gs.goalRange && c.gs.goalRange.range ? c.gs.goalRange.range : '2-4球';

              // 共识中文标签
              const consensus = c.consensus || '';
              const consensusLabel = consensus === 'strong' ? '强一致' : consensus === 'weak' ? '弱一致' : '未融合';

              // ★ 中奖判定：对比实际比分
              const rawScore = (match.score || '').replace(/:/g, '-');
              let isScoreWon = false,
                isScoreLose = false,
                winAlloc = 0,
                winOdds = 0;
              if (rawScore) {
                for (let si2 = 0; si2 < combo.scores.length; si2++) {
                  if (combo.scores[si2].score === rawScore) {
                    isScoreWon = true;
                    winAlloc = combo.scores[si2].allocation || 0;
                    winOdds = combo.scores[si2].odds || 0;
                    break;
                  }
                }
                isScoreLose = !isScoreWon;
              }
              const winningPrize = isScoreWon ? Math.round(winAlloc * winOdds) : 0;

              return {
                planId: 'score_plan_' + dateStr + '_' + (idx + 1),
                planName: '单关比分方案 ' + (idx + 1),
                matchId: c.matchId,
                matchNum: match.num || '',
                homeName: match.homeName || '',
                visitName: match.visitName || '',
                leagueName: match.leagueName || '',
                startTime: match.startTime || '',
                strongSide: strongSide,
                selectedScores: combo.scores,
                totalCapital: 1000,
                expectedReturn: combo.baseExpectedReturn,
                bigBallRatio: c.bigBallRatio.toFixed(1),
                attackAdvantage: attDisplay,
                goalRange: goalRange,
                playType: '单场比分',
                passType: '比分单关',
                betCount: 250,
                ticketCount: 10,
                multiplier: 1,
                oddsDisplay: oddsDisplay,
                amount: 1000,
                matchCount: 1,
                maxPrize: combo.baseExpectedReturn,
                // ★ 中奖判定字段
                isScoreWon: isScoreWon,
                isScoreLose: isScoreLose,
                winningPrize: winningPrize,
                // ★ 新增字段
                qualityScore: c.qualityScore,
                consensusLabel: consensusLabel,
                matchType: combo.matchType || 'normal',
                coverage: combo.coverage || 0,
                compositeScore: combo.compositeScore || 0,
                stabilityOverall: c.stabilityOverall ? c.stabilityOverall.toFixed(0) : '',
              };
            });

            var notice = '';
            if (plans.length === 0) {
              if (allCandidates.length === 0) {
                notice = '今日暂无符合条件的单关比分方案';
              } else {
                notice = '候选场次质量分不足（最高: ' + allCandidates[0].qualityScore + '/100），已自动跳过';
              }
            }

            return res.json({ code: 1, data: { date: dateStr, plans: plans, notice: notice } });
          } catch (e) {
            logger.error('[score-plan-list] ' + e.message);
            return res.json({ code: 0, msg: '获取比分方案失败: ' + e.message });
          }
        }

        // ========== 量化方案列表（搏冷 2串1） ==========
        case 'quant-plan-list': {
          try {
            const dateStr = data.date || latestDataDate();
            const today = localDate();

            // ★ P1-1: 10 分钟响应缓存（计算最密集的端点）
            const qpNow = Date.now();
            const qpCached = _quantPlanCache[dateStr];
            if (qpCached && qpNow - qpCached.time < CACHE_TTL_10MIN) {
              return res.json(qpCached.response);
            }

            // ★ 当天方案在 18:00 前不展示
            if (dateStr === today) {
              const now = new Date();
              const hour = now.getHours();
              if (hour < 18) {
                return res.json({
                  code: 1,
                  data: { date: dateStr, plans: [], notice: '量化博冷方案预计 18:00 后自动生成' },
                });
              }
            }

            // 1) 加载 data.json 比赛列表
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};
            const mList = [];
            Object.keys(mMap).forEach((k) => {
              const m = mMap[k];
              if (m && (m.date || '').slice(0, 10) === dateStr) mList.push(m);
            });

            if (mList.length === 0) {
              return res.json({ code: 1, data: { date: dateStr, plans: [], notice: '今日暂无比赛数据' } });
            }

            // 2) 加载 jczq_change 缓存（获取 heatIndex）
            let changeCache = {};
            const changeCachePath = path.join(__dirname, 'jczq_change_cache.json');
            try {
              if (fs.existsSync(changeCachePath)) {
                changeCache = JSON.parse(fs.readFileSync(changeCachePath, 'utf8')) || {};
              }
            } catch (e) {
              logger.warn('[quant-plan] jczq_change 缓存读取失败: ' + e.message);
            }
            const changeDate = changeCache[dateStr] || {};

            // 3) 加载功守道缓存（获取 fusionConsensus、totalStrength）
            // ★ P1-2: 复用统一的 _gsGlobalCache，不再独立读磁盘
            const gsCacheMap = getGsGlobalMap();

            // 4) 加载 SPF 赔率
            const od = getOddsHistory(dateStr) || {};
            const allplays = getAllplaysData();

            // 辅助：获取比赛赔率
            function getMatchOdds(m) {
              const num = m.num || '';
              if (od[num]) return od[num];
              const ap = allplays || {};
              const k = 'num_' + num;
              if (ap[k]) return ap[k];
              if (m.matchId && ap[m.matchId]) return ap[m.matchId];
              return null;
            }

            // ★ 辅助：计算比赛命中/未命中结果（复用专家方案逻辑）
            function normalizeRecs(recs) {
              return (recs || []).map(function (x) {
                const raw = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
                const r = raw === 0 || raw === 1 ? raw : null;
                return { type: x.t || x.type, num: x.n || x.num, result: r };
              });
            }
            function computeMatchResult(matchId, direction) {
              const key = matchId;
              const raw = rMap['m_' + key] || rMap[String(key)] || [];
              const recs = normalizeRecs(raw);

              let isMatchWon = null,
                isMatchLose = null;
              const subResults = [];
              const matchedRecsSet = new Set();

              // 子方向拆分（处理"胜平"等双选）
              let effectiveDir = direction;
              if (direction === '胜平') effectiveDir = '胜、平';
              else if (direction === '平负') effectiveDir = '平、负';
              const subDirs = effectiveDir.split(/[、,]/);

              function recContains(recType, sd) {
                if (recType === sd) return true;
                const parts = recType.split(/[、,]/);
                return parts.some(function (p) {
                  return p.trim() === sd;
                });
              }

              for (let si = 0; si < subDirs.length; si++) {
                const sd = subDirs[si].trim();
                let found = null;
                // 精确匹配
                for (let ri = 0; ri < recs.length; ri++) {
                  if (recs[ri].type === sd) {
                    found = recs[ri];
                    break;
                  }
                }
                // 组合类型包含子方向
                if (!found) {
                  for (let rj = 0; rj < recs.length; rj++) {
                    if (recContains(recs[rj].type, sd)) {
                      found = recs[rj];
                      break;
                    }
                  }
                }
                if (found) matchedRecsSet.add(found);
                subResults.push({ direction: sd, result: found ? found.result : null });
              }

              // 全方向模糊匹配兜底
              if (matchedRecsSet.size === 0) {
                for (let rk = 0; rk < recs.length; rk++) {
                  const rt = recs[rk].type || '';
                  if (rt.indexOf(direction) >= 0 || direction.indexOf(rt) >= 0) {
                    matchedRecsSet.add(recs[rk]);
                  }
                }
                if (matchedRecsSet.size === 0 && subResults.length === 0) {
                  subResults.push({ direction: direction, result: null });
                }
              }

              const matchedArray = Array.from(matchedRecsSet);
              let anyWon = false,
                anyLose = false,
                anyUnknown = false;
              for (let mi = 0; mi < matchedArray.length; mi++) {
                if (matchedArray[mi].result === 1) anyWon = true;
                else if (matchedArray[mi].result === 0) anyLose = true;
                else anyUnknown = true;
              }
              if (!anyUnknown && matchedArray.length > 0) {
                isMatchWon = anyWon;
                isMatchLose = !anyWon && anyLose;
              }

              // ★ fallback: 推荐数据无 result 时，用比分+赔率直判方向对错
              if (isMatchWon === null && isMatchLose === null) {
                const matchKey2 = 'm_' + String(key);
                const mForScore = mMap[matchKey2] || mMap[String(key)] || null;
                if (mForScore && mForScore.matchStatus >= 1 && mForScore.score) {
                  const scoreParts = String(mForScore.score).replace(/[-:]/g, ':').split(':');
                  const hg = parseInt(scoreParts[0]);
                  const ag = parseInt(scoreParts[1]);
                  if (!isNaN(hg) && !isNaN(ag)) {
                    const moddsForFallback = getMatchOdds(mForScore);
                    const hcp = moddsForFallback && moddsForFallback.rqspf ? moddsForFallback.rqspf.handicap : null;
                    // 内联比分判定
                    function judgeScore(d, s, h) {
                      // ★ 复合方向（含、号，如"平、让平"）：分开判定，任一命中即可
                      if (d.indexOf('、') >= 0) {
                        var parts = d.split(/[、,]/);
                        for (var pi = 0; pi < parts.length; pi++) {
                          if (judgeScore(parts[pi].trim(), s, h)) return true;
                        }
                        return false;
                      }
                      var p = String(s).replace(/[-:]/g, ':').split(':');
                      var hh = parseInt(p[0]);
                      var aa = parseInt(p[1]);
                      if (isNaN(hh) || isNaN(aa)) return null;
                      if (d === '胜') return hh > aa;
                      if (d === '平') return hh === aa;
                      if (d === '负') return hh < aa;
                      if (d === '胜平') return hh > aa || hh === aa;
                      if (d === '平负') return hh === aa || hh < aa;
                      if (d === '让胜' || d === '让平' || d === '让负') {
                        var ec = hh + (h != null ? parseFloat(h) || 0 : 0);
                        if (d === '让胜') return ec > aa;
                        if (d === '让平') return ec === aa;
                        if (d === '让负') return ec < aa;
                      }
                      var gm = d.match(/总进球-(\d+)/);
                      if (gm) return (hh + aa) === parseInt(gm[1]);
                      return null;
                    }
                    var scoreResult = judgeScore(direction, mForScore.score, hcp);
                    if (scoreResult !== null) {
                      isMatchWon = scoreResult;
                      isMatchLose = !scoreResult;
                      // 同步更新 subResults — 直接用 isMatchWon 确保一致
                      for (var sri = 0; sri < subResults.length; sri++) {
                        var sd = subResults[sri].direction;
                        var sr = judgeScore(sd, mForScore.score, hcp);
                        if (sr !== null) {
                          subResults[sri].result = sr ? 1 : 0;
                        } else if (sd === direction || sd.indexOf(direction) >= 0 || direction.indexOf(sd) >= 0) {
                          // judgeScore 返回 null 时用主方向结果兜底
                          subResults[sri].result = isMatchWon ? 1 : 0;
                        }
                      }
                    }
                  }
                }
              }

              // ★ 最终兜底：isMatchWon 已确定但 subResults 仍有 null 时同步
              if (isMatchWon !== null && isMatchLose !== null) {
                for (var sri2 = 0; sri2 < subResults.length; sri2++) {
                  if (subResults[sri2].result === null || subResults[sri2].result === undefined) {
                    subResults[sri2].result = isMatchWon ? 1 : 0;
                  }
                }
              }

              // ★ 最终兜底：isMatchWon 已确定但 subResults 仍有 null 时同步
              if (isMatchWon !== null && isMatchLose !== null) {
                // 方案六三方向进球：若缺少比分无法拆分具体命中进球数，不强制全部标红
                var isPlan6Multi = direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0;
                for (var sri3 = 0; sri3 < subResults.length; sri3++) {
                  if (subResults[sri3].result === null || subResults[sri3].result === undefined) {
                    if (isPlan6Multi && isMatchWon && (!m.score || m.score === '')) {
                      // 缺少比分数据，无法确定具体哪个进球命中，保留 null（前端显示白色/待定）
                      subResults[sri3].result = null;
                    } else {
                      subResults[sri3].result = isMatchWon ? 1 : 0;
                    }
                  }
                }
              }

              return { isMatchWon: isMatchWon, isMatchLose: isMatchLose, subResults: subResults };
            }

            // ==================== P0-方案一：冷门方向验证 ====================
            // 不再纯赔率驱动，结合模型信号（实力/共识）做交叉验证
            function getColdDirectionWithValidation(modds, gs) {
              const directions = [
                { dir: '胜', odds: parseFloat(modds.spf.home), signal: 0 },
                { dir: '平', odds: parseFloat(modds.spf.draw), signal: 0 },
                { dir: '负', odds: parseFloat(modds.spf.away), signal: 0 },
              ];

              const totalStrength = gs && gs.totalStrength != null ? parseFloat(gs.totalStrength) : 0;
              const consensus = gs ? gs.fusionConsensus || '' : '';

              // 信号1: 实力均衡 → 利好平局方向（|totalStrength| < 0.15）
              if (Math.abs(totalStrength) < 0.15) {
                directions.forEach(function (d) {
                  if (d.dir === '平') d.signal += 2.5;
                });
              }

              // 信号2: 弱一致 → 模型不确定 → 利好任何冷门方向
              if (consensus.indexOf('weak') >= 0 || consensus.indexOf('弱') >= 0) {
                directions.forEach(function (d) {
                  d.signal += 1.5;
                });
              }
              // 熔断加分保守（模型打架但不一定利好特定方向）
              if (consensus.indexOf('meltdown') >= 0 || consensus.indexOf('熔断') >= 0) {
                directions.forEach(function (d) {
                  d.signal += 0.5;
                });
              }

              // 信号3: 赔率最高方的隐含概率低但实力差距不大 → 市场过度低估
              // 此时赔率最高方向获得额外加成
              directions.sort(function (a, b) {
                return b.odds - a.odds;
              });
              const highestDir = directions[0];
              const impliedProb = 1 / highestDir.odds;
              const strengthGap = Math.abs(totalStrength);
              if (strengthGap < 0.2 && impliedProb < 0.15) {
                highestDir.signal += 2.0;
              }
              if (strengthGap < 0.1 && highestDir.dir !== '平') {
                highestDir.signal += 1.0; // 实力极接近但赔率没反映，定价偏差
              }

              // 综合评分: 0.6 × 赔率排名分 + 0.4 × 模型信号分
              // 赔率排名分: 赔率最高=3, 第二=2, 最低=1
              directions.sort(function (a, b) {
                return b.odds - a.odds;
              });
              const oddsRankScore = [3, 2, 1];
              directions.forEach(function (d, i) {
                d.finalScore = oddsRankScore[i] * 0.6 + d.signal * 0.4;
              });

              directions.sort(function (a, b) {
                return b.finalScore - a.finalScore;
              });
              return directions[0];
            }

            // ==================== P0-方案二：多维冷门评分 ====================
            function computeColdScore(hi, gs, modds, coldDir) {
              let score = 0;
              const totalStrength = gs && gs.totalStrength != null ? parseFloat(gs.totalStrength) : 0;
              const consensus = gs ? gs.fusionConsensus || '' : '';

              // 因子1: 热度反转（weight 30%）— 越冷分越高
              if (hi !== null && hi !== undefined) {
                const heatFactor = Math.max(0, (0.85 - hi) / 0.85) * 30;
                score += heatFactor;
              } else {
                score += 15; // 无热度数据给中等分
              }

              // 因子2: 实力均衡度（weight 25%）— 越均衡越容易出冷
              const tsAbs = Math.abs(totalStrength);
              const balanceFactor = Math.max(0, (0.3 - tsAbs) / 0.3) * 25;
              score += balanceFactor;

              // 因子3: 模型不确定性（weight 20%）— 模型打架/不确定是冷门信号
              if (consensus.indexOf('weak') >= 0 || consensus.indexOf('弱') >= 0) score += 15;
              if (consensus.indexOf('meltdown') >= 0 || consensus.indexOf('熔断') >= 0) score += 5;
              if (!consensus) score += 8; // 未融合说明数据不充分

              // 因子4: 赔率价值（weight 15%）— 冷门方向隐含概率 10~25% 为甜区
              const coldImplied = 1 / coldDir.odds;
              if (coldImplied >= 0.1 && coldImplied <= 0.25) {
                score += 12;
              } else if (coldImplied > 0.25 && coldImplied <= 0.35) {
                score += 7;
              } else if (coldImplied > 0.08 && coldImplied < 0.1) {
                score += 5;
              } else {
                score += 2; // 太离谱或太可能都不加分
              }

              // 因子5: 大市场共识（weight 10%）— 非强一致有不确定性空间
              if (consensus.indexOf('strong') >= 0 || consensus.indexOf('强') >= 0) {
                score += 0;
              } else {
                score += 5;
              }

              return Math.min(100, Math.round(score));
            }

            // ==================== P2-方案四：组合相关性检测 ====================
            function checkCorrelation(a, b) {
              const warnings = [];
              // 同一联赛
              const leagueA = (a.match.leagueName || '').trim();
              const leagueB = (b.match.leagueName || '').trim();
              if (leagueA && leagueB && leagueA === leagueB) {
                warnings.push('同联赛');
              }

              // 开球时间接近（< 1.5小时）
              const timeA = parseKickoffTime(a.match.startTime);
              const timeB = parseKickoffTime(b.match.startTime);
              if (timeA && timeB && Math.abs(timeA - timeB) < 5400000) {
                warnings.push('开球时间接近');
              }

              // 同一球队（主-主、客-客、主-客 匹配）
              const homeA = (a.match.homeName || '').trim();
              const awayA = (a.match.visitName || '').trim();
              const homeB = (b.match.homeName || '').trim();
              const awayB = (b.match.visitName || '').trim();
              if (homeA && homeB && (homeA === homeB || homeA === awayB || awayA === homeB || awayA === awayB)) {
                warnings.push('同一球队');
              }

              const riskLevel = warnings.length >= 2 ? 'high' : warnings.length === 1 ? 'medium' : 'low';
              return { riskLevel: riskLevel, warnings: warnings };
            }

            function parseKickoffTime(startTime) {
              if (!startTime) return null;
              try {
                const ts = new Date(startTime.replace('T', ' ')).getTime();
                return isNaN(ts) ? null : ts;
              } catch (e) {
                return null;
              }
            }

            // ==================== 主流程：筛选冷门场次 ====================
            const hasChangeData = Object.keys(changeDate).length > 0;
            const MIN_COLD_SCORE = hasChangeData ? 40 : 35; // P1-方案三：单场最低冷门分（无热度降级放宽）
            const MIN_PLAN_AVG_SCORE = hasChangeData ? 45 : 40; // P1-方案三：方案最低平均冷门分（无热度降级放宽）

            const coldCandidates = [];

            for (let i = 0; i < mList.length; i++) {
              var m = mList[i];
              const mid = m.matchId;

              // 获取功守道数据
              let gs = gsCacheMap['m_' + mid] || gsCacheMap[mid] || null;
              const consensus = gs ? gs.fusionConsensus || '' : '';

              // 获取赔率
              const modds = getMatchOdds(m);
              const spf = modds && modds.spf ? modds.spf : null;
              if (!spf || spf.home == null || spf.draw == null || spf.away == null) continue;

              // ===== P0-方案一：冷门方向验证 =====
              const coldDirResult = getColdDirectionWithValidation(modds, gs);
              const coldDir = coldDirResult;
              // 保留原始赔率排名供展示
              const rawDirections = [
                { dir: '胜', odds: parseFloat(spf.home) },
                { dir: '平', odds: parseFloat(spf.draw) },
                { dir: '负', odds: parseFloat(spf.away) },
              ].sort(function (a, b) {
                return b.odds - a.odds;
              });

              const changeEntry = changeDate[mid];
              let hi =
                changeEntry && changeEntry.heatIndex !== null && changeEntry.heatIndex !== undefined
                  ? changeEntry.heatIndex
                  : null;

              // 熔断场始终排除（无论有无热度数据）
              if (consensus.indexOf('熔断') >= 0 || consensus === 'meltdown') continue;

              if (hasChangeData) {
                // 有热度数据：用热度做初筛（保留硬阈值但只做粗筛，精筛靠多维评分）
                if (hi === null) continue;
                if (hi >= 1.4) continue;
                if (hi >= 0.85) continue;
              } else {
                // ===== P1-方案五：无热度数据降级增强 =====
                // 用赔率推导冷门可能性 + 共识状态过滤，替代原全纳入策略
                var impliedHome = 1 / parseFloat(spf.home);
                var impliedDraw = 1 / parseFloat(spf.draw);
                var impliedAway = 1 / parseFloat(spf.away);
                var totalImplied = impliedHome + impliedDraw + impliedAway;
                const fairHome = impliedHome / totalImplied;
                const fairAway = impliedAway / totalImplied;
                const fairDraw = impliedDraw / totalImplied;

                // 冷门方向（高赔率方）的公平概率
                var coldFair = fairDraw;
                if (coldDir.dir === '胜') coldFair = fairHome;
                if (coldDir.dir === '负') coldFair = fairAway;

                // 过滤：冷门方向公平概率 < 12% 太不可能
                if (coldFair < 0.12) continue;

                // 强一致但有高赔率冷门方向 → 市场与模型分歧 → 可能是套利机会
                if (consensus.indexOf('strong') >= 0 || consensus.indexOf('强') >= 0) {
                  // 冷门方向赔率高(≥3.5)且公平概率≥15% → 市场低估，保留
                  if (coldFair >= 0.15 && coldDir.odds >= 3.5) {
                    // 保留（市场和模型认知分歧）
                  } else {
                    continue; // 正常强一致跳过
                  }
                }

                // 没有功守道数据，虚拟中性数据
                if (!gs || gs.totalStrength === null || gs.totalStrength === undefined) {
                  gs = Object.assign({}, gs || {}, { totalStrength: 0 });
                }

                // 自适应降级默认值：根据共识状态动态调整
                if (consensus.indexOf('weak') >= 0 || consensus.indexOf('弱') >= 0) {
                  hi = 0.55; // 弱一致 → 模型不确定 → 更可能出冷
                } else if (!gs || !consensus) {
                  hi = 0.70; // 无 GS 数据 → 偏保守
                } else {
                  hi = 0.65; // 默认保守估计
                }
              }

              // ===== P0-方案二：多维冷门评分 =====
              const coldScore = computeColdScore(hi, gs, modds, coldDir);

              // ===== P1-方案三：质量门禁（单场最低分）=====
              if (coldScore < MIN_COLD_SCORE) continue;

              // 共识状态中文
              let consensusLabel = '';
              if (consensus.indexOf('强一致') >= 0 || consensus === 'strong') consensusLabel = '✅强一致';
              else if (consensus.indexOf('弱一致') >= 0 || consensus === 'weak') consensusLabel = '🟡弱一致';
              else if (consensus.indexOf('熔断') >= 0 || consensus === 'meltdown') consensusLabel = '⚠️熔断';
              else consensusLabel = '⚪未融合';

              coldCandidates.push({
                match: m,
                heatIndex: hi,
                heatLevel: (changeEntry && changeEntry.heatLevel) || 'cold',
                heatLabel: (changeEntry && changeEntry.heatLabel) || hi.toFixed(2) + ' 🧊',
                coldDir: coldDir.dir,
                coldOdds: coldDir.odds,
                coldDirScore: coldDir.finalScore != null ? parseFloat(coldDir.finalScore.toFixed(2)) : 0,
                consensus: consensus,
                consensusLabel: consensusLabel,
                compositeScore: coldScore,
                coldScore: coldScore,
                totalStrength: gs && gs.totalStrength != null ? parseFloat(gs.totalStrength) : 0,
                odds: modds,
                rankedDirections: rawDirections,
              });
            }

            // 6) 排序：按多维冷门评分降序
            coldCandidates.sort(function (a, b) {
              return b.coldScore - a.coldScore;
            });

            // ===== P1-方案三：动态方案数量 =====
            let planCount = 0;
            if (
              coldCandidates.length >= 4 &&
              (coldCandidates[0].coldScore + coldCandidates[1].coldScore) / 2 >= MIN_PLAN_AVG_SCORE
            ) {
              planCount = 2;
            } else if (coldCandidates.length >= 4) {
              planCount = 1;
            } else if (
              coldCandidates.length >= 2 &&
              (coldCandidates[0].coldScore + coldCandidates[1].coldScore) / 2 >= MIN_PLAN_AVG_SCORE
            ) {
              planCount = 1;
            }

            // 7) 生成方案（加入 P2 相关性过滤）
            const plans = [];
            const usedMatchIds = [];

            for (let p = 0; p < planCount; p++) {
              // 扫描候选列表，为当前方案找最佳配对
              let picked = [];
              for (let ci = 0; ci < coldCandidates.length && picked.length < 2; ci++) {
                if (usedMatchIds.indexOf(coldCandidates[ci].match.matchId) >= 0) continue;
                if (picked.length === 0) {
                  picked.push(coldCandidates[ci]);
                } else {
                  // ===== P2-方案四：组合相关性检测 =====
                  const corr = checkCorrelation(picked[0], coldCandidates[ci]);
                  if (corr.riskLevel === 'high') continue; // 高风险跳过
                  picked.push(coldCandidates[ci]);
                }
              }

              // 如果相关性过滤导致配对不足，回退到宽松模式重试
              if (picked.length < 2) {
                picked = [];
                for (let ci2 = 0; ci2 < coldCandidates.length && picked.length < 2; ci2++) {
                  if (usedMatchIds.indexOf(coldCandidates[ci2].match.matchId) >= 0) continue;
                  picked.push(coldCandidates[ci2]);
                }
              }

              if (picked.length < 2) break;

              const ca = picked[0];
              const cb = picked[1];
              usedMatchIds.push(ca.match.matchId, cb.match.matchId);

              // 方案平均分门禁
              const planAvg = Math.round((ca.coldScore + cb.coldScore) / 2);
              if (planAvg < MIN_PLAN_AVG_SCORE) continue;

              // P2：方案相关性标记
              const corrResult = checkCorrelation(ca, cb);

              // ★ 计算比赛命中/未命中结果
              const resultA = computeMatchResult(ca.match.matchId, ca.coldDir);
              const resultB = computeMatchResult(cb.match.matchId, cb.coldDir);

              // ★ 方案级中奖判定（2串1：两场都中才算中奖）
              let isPlanWon = null,
                isPlanLose = null;
              if (resultA.isMatchWon === true && resultB.isMatchWon === true) {
                isPlanWon = true;
                isPlanLose = false;
              } else if (resultA.isMatchLose === true || resultB.isMatchLose === true) {
                isPlanWon = false;
                isPlanLose = true;
              }

              const matchA = {
                matchId: ca.match.matchId,
                homeName: ca.match.homeName || '',
                visitName: ca.match.visitName || '',
                leagueName: ca.match.leagueName || '',
                matchNum: ca.match.num || '',
                startTime: ca.match.startTime || '',
                direction: ca.coldDir,
                odds: ca.odds,
                isMatchWon: resultA.isMatchWon,
                isMatchLose: resultA.isMatchLose,
                subResults: resultA.subResults,
                heatIndex: ca.heatIndex,
                heatLabel: ca.heatLabel,
                consensus: ca.consensusLabel,
                compositeScore: ca.compositeScore,
                coldScore: ca.coldScore,
                coldDirScore: ca.coldDirScore,
              };

              const matchB = {
                matchId: cb.match.matchId,
                homeName: cb.match.homeName || '',
                visitName: cb.match.visitName || '',
                leagueName: cb.match.leagueName || '',
                matchNum: cb.match.num || '',
                startTime: cb.match.startTime || '',
                direction: cb.coldDir,
                odds: cb.odds,
                isMatchWon: resultB.isMatchWon,
                isMatchLose: resultB.isMatchLose,
                subResults: resultB.subResults,
                heatIndex: cb.heatIndex,
                heatLabel: cb.heatLabel,
                consensus: cb.consensusLabel,
                compositeScore: cb.compositeScore,
                coldScore: cb.coldScore,
                coldDirScore: cb.coldDirScore,
              };

              const oddsCombo =
                ca.coldOdds.toFixed(2) +
                ' × ' +
                cb.coldOdds.toFixed(2) +
                ' = ' +
                (ca.coldOdds * cb.coldOdds).toFixed(2);
              // ★ 赔率缺失（coldOdds 为 0/NaN）不计算奖金
              const hasValidOdds = ca.coldOdds > 0 && cb.coldOdds > 0 && !isNaN(ca.coldOdds * cb.coldOdds);
              const maxPrize = hasValidOdds ? Math.round(1000 * ca.coldOdds * cb.coldOdds) : 0;
              const winningPrize = isPlanWon === true ? maxPrize : isPlanLose === true ? 0 : null;
              const avgCPI = ((ca.heatIndex + cb.heatIndex) / 2).toFixed(2);
              const avgComp = Math.round((ca.coldScore + cb.coldScore) / 2);
              const consensusParts = [ca.consensusLabel, cb.consensusLabel];
              const combinedConsensus = consensusParts.join(' | ');

              plans.push({
                planId: 'quant_' + dateStr + '_' + (p + 1),
                planName: '量化博冷方案 ' + (p + 1),
                matches: [matchA, matchB],
                amount: 1000,
                playType: '混合投注（搏冷）',
                matchCount: 2,
                passType: '2串1',
                betCount: 250,
                ticketCount: 10,
                multiplier: 25,
                maxPrize: maxPrize,
                winningPrize: winningPrize,
                isPlanWon: isPlanWon,
                isPlanLose: isPlanLose,
                oddsDisplay: oddsCombo,
                coldIndex: avgCPI,
                compositeScore: avgComp,
                coldScore: avgComp,
                consensus: combinedConsensus,
                correlationRisk: corrResult.riskLevel,
                correlationWarnings: corrResult.warnings,
              });
            }

            // ===== P1-方案六：单场博冷兜底 =====
            // 当 2串1 方案数为 0 但存在高分候选时，生成单场方案
            if (plans.length === 0 && coldCandidates.length >= 1 && coldCandidates[0].coldScore >= 50) {
              const sc = coldCandidates[0];
              const sResult = computeMatchResult(sc.match.matchId, sc.coldDir);

              const sMatch = {
                matchId: sc.match.matchId,
                homeName: sc.match.homeName || '',
                visitName: sc.match.visitName || '',
                leagueName: sc.match.leagueName || '',
                matchNum: sc.match.num || '',
                startTime: sc.match.startTime || '',
                direction: sc.coldDir,
                odds: sc.odds,
                isMatchWon: sResult.isMatchWon,
                isMatchLose: sResult.isMatchLose,
                subResults: sResult.subResults,
                heatIndex: sc.heatIndex,
                heatLabel: sc.heatLabel,
                consensus: sc.consensusLabel,
                compositeScore: sc.compositeScore,
                coldScore: sc.coldScore,
                coldDirScore: sc.coldDirScore,
              };

              const sHasOdds = sc.coldOdds > 0 && !isNaN(sc.coldOdds);
              const sMaxPrize = sHasOdds ? Math.round(1000 * sc.coldOdds) : 0;

              plans.push({
                planId: 'quant_' + dateStr + '_single',
                planName: '量化博冷方案（单场）',
                matches: [sMatch],
                amount: 1000,
                playType: '单场博冷',
                matchCount: 1,
                passType: '单场',
                betCount: 200,
                ticketCount: 5,
                multiplier: 40,
                maxPrize: sMaxPrize,
                winningPrize: sResult.isMatchWon === true ? sMaxPrize : sResult.isMatchLose === true ? 0 : null,
                isPlanWon: sResult.isMatchWon,
                isPlanLose: sResult.isMatchLose,
                oddsDisplay: sc.coldOdds.toFixed(2),
                coldIndex: sc.heatIndex.toFixed(2),
                compositeScore: sc.coldScore,
                coldScore: sc.coldScore,
                consensus: sc.consensusLabel,
                correlationRisk: 'none',
                correlationWarnings: [],
              });
            }

            var notice = '';
            if (plans.length === 0) {
              if (coldCandidates.length === 0) {
                notice = '今日暂无符合条件的冷门场次';
              } else {
                notice = '今日冷门场次未达方案质量阈值（候选' + coldCandidates.length + '场）';
              }
            }

            const qpResponse = {
              code: 1,
              data: {
                date: dateStr,
                plans: plans,
                notice: notice,
                meta: {
                  candidates: coldCandidates.length,
                  qualified: coldCandidates.length,
                  hasChangeData: hasChangeData,
                  minColdScore: MIN_COLD_SCORE,
                  minPlanAvgScore: MIN_PLAN_AVG_SCORE,
                },
              },
            };
            // ★ P1-1: 缓存量化方案结果
            _quantPlanCache[dateStr] = { time: qpNow, response: qpResponse };
            // ★ P2: LRU 清理（最多缓存 10 个日期）
            const qpKeys = Object.keys(_quantPlanCache);
            if (qpKeys.length > 10) {
              qpKeys.sort(function (a, b) { return _quantPlanCache[a].time - _quantPlanCache[b].time; });
              delete _quantPlanCache[qpKeys[0]];
            }
            return res.json(qpResponse);
          } catch (e) {
            logger.error('[quant-plan-list] ' + e.message);
            return res.json({ code: 0, msg: '获取量化方案失败: ' + e.message });
          }
        }

        case 'income-stats': {
          try {
            const planFilter = data.plan || 'all';
            const directionFilter = data.direction || 'all';
            const daysFilter = parseInt(data.days) || 0;
            const AMOUNT = 1000;
            const fs = require('fs');
            const path = require('path');

            function fmtDate2(dd) {
              return (
                dd.getFullYear() +
                '-' +
                String(dd.getMonth() + 1).padStart(2, '0') +
                '-' +
                String(dd.getDate()).padStart(2, '0')
              );
            }

            const minDate = '2026-03-19';
            const endDate = new Date();
            let startDate = new Date(minDate);
            if (daysFilter > 0) {
              startDate = new Date(endDate.getTime() - (daysFilter - 1) * 86400000);
              if (fmtDate2(startDate) < minDate) startDate = new Date(minDate);
            }

            // Load data from data.json
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};

            function normalizeRecs(recs) {
              return (recs || []).map(function (x) {
                const raw = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
                const r = raw === 0 || raw === 1 ? raw : null;
                return { type: x.t || x.type, num: x.n || x.num, result: r };
              });
            }

            function findRecommends(matchId) {
              const raw = rMap['m_' + matchId] || rMap[String(matchId)] || [];
              return normalizeRecs(raw);
            }

            function extractOddsVal(oddsObj, direction) {
              if (!oddsObj) return null;
              if (direction === '平') return oddsObj.spf ? oddsObj.spf.draw : null;
              if (direction === '让平') return oddsObj.rqspf ? oddsObj.rqspf.draw : null;
              if (direction === '让负') return oddsObj.rqspf ? oddsObj.rqspf.away : null;
              if (direction === '让胜') return oddsObj.rqspf ? oddsObj.rqspf.home : null;
              if (direction === '胜') return oddsObj.spf ? oddsObj.spf.home : null;
              if (direction === '负') return oddsObj.spf ? oddsObj.spf.away : null;
              if (direction === '胜平') return oddsObj.spf ? oddsObj.spf.home : null;
              if (direction === '平负') return oddsObj.spf ? oddsObj.spf.away : null;
              return null;
            }

            function extractIndividualOdds(oddsObj, direction) {
              if (!oddsObj) return [];
              if (direction.indexOf('总进球-') === 0) {
                const tg = oddsObj.totalGoals;
                if (!tg) return [];
                const nums = direction.replace('总进球-', '').split(/[、,]/);
                const vals = [];
                for (const n of nums) {
                  const v = n.replace(/球/g, '').trim();
                  if (tg[v] !== undefined) vals.push(tg[v]);
                }
                return vals;
              }
              if (direction.indexOf('、') >= 0 || direction.indexOf(',') >= 0) {
                const parts = direction.split(/[、,]/);
                const vals = [];
                for (const p of parts) {
                  const sv = extractOddsVal(oddsObj, p.trim());
                  if (sv !== null) vals.push(sv);
                }
                return vals;
              }
              if (direction === '胜平' && oddsObj.spf) return [oddsObj.spf.home, oddsObj.spf.draw];
              if (direction === '平负' && oddsObj.spf) return [oddsObj.spf.draw, oddsObj.spf.away];
              const sv = extractOddsVal(oddsObj, direction);
              return sv !== null ? [sv] : [];
            }

            // ===== 收益率辅助：所有方案每单投入金额 =====
            const AMOUNT_SCORE_OR_QUANT = 1000;

            // 导入共享方案生成模块
            const PG = require('./core/plan-generator');

            const results = [];
            let totalPlans = 0,
              totalWon = 0,
              totalIncome = 0;

            // 预加载共享缓存（避免每天循环内重复读取）
            let _globalGsMap = {};
            try {
              const _gsPathPre = path.join(__dirname, 'gongshoudao', 'cache.json');
              if (fs.existsSync(_gsPathPre))
                _globalGsMap = JSON.parse(fs.readFileSync(_gsPathPre, 'utf8'))['_global'] || {};
            } catch (e) {}
            const _globalAllplays = getAllplaysData();
            let _globalChgMap = {};
            try {
              const _chgPathPre = path.join(__dirname, 'jczq_change_cache.json');
              if (fs.existsSync(_chgPathPre)) _globalChgMap = JSON.parse(fs.readFileSync(_chgPathPre, 'utf8')) || {};
            } catch (e) {}

            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
              const ds = fmtDate2(d);
              const mList = [];
              Object.keys(mMap).forEach((k) => {
                const m = mMap[k];
                if (m && (m.date || '').slice(0, 10) === ds) mList.push(m);
              });
              if (mList.length === 0) continue;

              const histOdds = getOddsHistory(ds);

              // 预计算：一次获取所有比赛的 recs 和 odds
              const matchDataMap = {};
              for (const mm of mList) {
                const num = mm.num || '';
                let oddsObj = null;
                if (histOdds && histOdds[num]) {
                  const od = histOdds[num];
                  oddsObj = {
                    spf: od.spf || null,
                    rqspf: od.rqspf || null,
                    totalGoals: od.totalGoals || null,
                    isSingleGame: od.isSingleGame || false,
                  };
                }
                matchDataMap[mm.matchId] = {
                  match: mm,
                  recs: findRecommends(mm.matchId),
                  odds: oddsObj,
                };
              }

              function findBest(directions, excludeIds) {
                let best = null,
                  bestCount = 0,
                  bestHasOdds = false;
                for (const mm of mList) {
                  if (excludeIds && excludeIds.indexOf(mm.matchId) >= 0) continue;
                  const md = matchDataMap[mm.matchId];
                  const hasOdds = md && !!md.odds;
                  if (histOdds && !hasOdds) continue;
                  const recs = md ? md.recs : [];
                  let total = 0;
                  for (const r of recs) {
                    if (directions.indexOf(r.type) >= 0) total += r.num || 0;
                  }
                  if (total > bestCount || (total === bestCount && total > 0 && hasOdds && !bestHasOdds)) {
                    bestCount = total;
                    best = mm;
                    bestHasOdds = hasOdds;
                  }
                }
                return best;
              }

              function getOddsObj(match) {
                const md = matchDataMap[match.matchId];
                return md ? md.odds : null;
              }

              function buildMatch(match, direction) {
                const md = matchDataMap[match.matchId];
                const recs = md ? md.recs : [];
                const subResults = [];
                const matchedRecs = [];

                function recContains(recType, sd) {
                  if (recType === sd) return true;
                  const parts = recType.split(/[、,]/);
                  return parts.some((p) => p.trim() === sd);
                }

                let fullMatch = null;
                for (const r of recs) {
                  if (r.type === direction) fullMatch = r;
                }
                if (fullMatch) {
                  matchedRecs.push(fullMatch);
                  subResults.push({
                    direction: direction,
                    result: fullMatch.result !== undefined ? fullMatch.result : null,
                  });
                } else {
                  const subDirs = direction.split(/[、,]/);
                  subDirs.forEach((sd) => {
                    const s = sd.trim();
                    let found = null;
                    for (const r of recs) {
                      if (r.type === s) found = r;
                    }
                    if (!found) {
                      for (const r of recs) {
                        if (recContains(r.type, s)) {
                          found = r;
                          break;
                        }
                      }
                    }
                    if (!found && s.indexOf('球') >= 0) {
                      const num = s.replace(/球/g, '');
                      for (const r of recs) {
                        if (r.type === '总进球-' + num) found = r;
                      }
                    }
                    if (found) matchedRecs.push(found);
                    subResults.push({ direction: s, result: found ? found.result : null });
                  });
                }
                // 总进球双选（如"总进球-2、3球"）：用实际比分拆分子方向命中
                if (direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0 && subResults.length >= 2) {
                  const combinedRes = subResults[0].result;
                  if (combinedRes === 0) {
                    subResults.forEach((sr) => {
                      sr.result = 0;
                    });
                  } else if (combinedRes === 1 && match.score) {
                    const scoreParts = String(match.score).split(':');
                    const totalGoals = parseInt(scoreParts[0]) + parseInt(scoreParts[1]);
                    if (!isNaN(totalGoals)) {
                      subResults.forEach((sr) => {
                        const goalMatch = sr.direction.match(/(\d+)/);
                        if (goalMatch && parseInt(goalMatch[1]) === totalGoals) sr.result = 1;
                        else sr.result = 0;
                      });
                    }
                  }
                }

                let isWon = null,
                  isLose = null;
                // 总进球双选：用子方向结果判断
                if (direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0 && subResults.length >= 2) {
                  let hasKnown = false;
                  for (const sr of subResults) {
                    if (sr.result === 1) {
                      isWon = true;
                      hasKnown = true;
                    } else if (sr.result === 0 && !isWon) {
                      isLose = true;
                      hasKnown = true;
                    }
                  }
                  if (!hasKnown) {
                    isWon = null;
                    isLose = null;
                  }
                  if (isWon) isLose = false;
                } else if (matchedRecs.length > 0) {
                  let anyWon2 = false,
                    anyLose2 = false,
                    anyUnknown2 = false;
                  matchedRecs.forEach((r) => {
                    if (r.result === 1) anyWon2 = true;
                    else if (r.result === 0) anyLose2 = true;
                    else anyUnknown2 = true;
                  });
                  if (!anyUnknown2) {
                    isWon = anyWon2;
                    isLose = !anyWon2 && anyLose2;
                  }
                }
                return {
                  matchId: match.matchId,
                  homeName: match.homeName,
                  visitName: match.visitName,
                  matchNum: match.num || '',
                  direction: direction,
                  oddsObj: getOddsObj(match),
                  subResults: subResults,
                  isWon: isWon,
                  isLose: isLose,
                };
              }

              const m1a = findBest(['平', '让平']),
                m1b = findBest(['让负'], m1a ? [m1a.matchId] : null);
              const m2a = findBest(['总进球-2、3球']),
                m2b = findBest(['让负'], m2a ? [m2a.matchId] : null);
              const m3a = findBest(['胜']),
                m3b = findBest(['胜'], m3a ? [m3a.matchId] : null);

              const dayPlans = [];
              if (m1a && m1b)
                dayPlans.push({
                  name: 'plan_1',
                  planName: '方案一',
                  matches: [buildMatch(m1a, '平、让平'), buildMatch(m1b, '让负')],
                });
              if (m2a && m2b)
                dayPlans.push({
                  name: 'plan_2',
                  planName: '方案二',
                  matches: [buildMatch(m2a, '总进球-2、3球'), buildMatch(m2b, '让负')],
                });
              if (m3a && m3b)
                dayPlans.push({
                  name: 'plan_3',
                  planName: '方案三',
                  matches: [buildMatch(m3a, '胜'), buildMatch(m3b, '胜')],
                });

              const dayMatchCount = mList.length;

              // 方案六：专家推"总进球-2、3球"数最多的一场，单关荷兰式投注（二选）
              if (dayMatchCount >= 4) {
                const targetDir6 = '总进球-2、3球';
                let bestM6 = null, bestCount6 = 0;
                for (const k of Object.keys(matchDataMap)) {
                  const mdData = matchDataMap[k];
                  const recs6 = mdData.recs;
                  for (const r of recs6) {
                    if (r.type === targetDir6 && (r.num || 0) > bestCount6) {
                      bestCount6 = r.num;
                      bestM6 = mdData.match;
                    }
                  }
                }
                if (bestM6 && bestCount6 > 0) {
                  dayPlans.push({
                    name: 'plan_6',
                    planName: '方案六',
                    matches: [buildMatch(bestM6, targetDir6)],
                  });
                }
              }

              if (dayMatchCount >= 15) {
                const m4a = findBest(['平', '让平']);
                const m4b = findBest(['胜'], m4a ? [m4a.matchId] : null);
                if (m4a && m4b)
                  dayPlans.push({
                    name: 'plan_4',
                    planName: '方案四',
                    matches: [buildMatch(m4a, '平、让平'), buildMatch(m4b, '胜')],
                  });
                const m5a = findBest(['平', '让平']);
                const m5b = findBest(['总进球-2、3球'], m5a ? [m5a.matchId] : null);
                if (m5a && m5b)
                  dayPlans.push({
                    name: 'plan_5',
                    planName: '方案五',
                    matches: [buildMatch(m5a, '平、让平'), buildMatch(m5b, '总进球-2、3球')],
                  });
              }
              // ========== 方案七：单关双选（胜平/平负） ==========
              const singleMatches7 = mList.filter((m) => {
                const md = matchDataMap[m.matchId];
                return md && md.odds && md.odds.isSingleGame === true;
              });
              if (singleMatches7.length > 0) {
                let bestM7 = null,
                  bestM7Dir = '',
                  bestM7Count = 0;
                for (const sm of singleMatches7) {
                  const recs7 = matchDataMap[sm.matchId] ? matchDataMap[sm.matchId].recs : [];
                  for (const r of recs7) {
                    if ((r.type === '胜平' || r.type === '平负') && r.num > bestM7Count) {
                      bestM7Count = r.num;
                      bestM7 = sm;
                      bestM7Dir = r.type;
                    }
                  }
                }
                if (bestM7 && bestM7Dir) {
                  dayPlans.push({ name: 'plan_7', planName: '方案七', matches: [buildMatch(bestM7, bestM7Dir)] });
                }
              }
              if (dayMatchCount < 5 && dayPlans.length > 2) {
                dayPlans.splice(2);
              }

              // ===== 专家博热方案 =====
              if (directionFilter === 'all' || directionFilter === 'expert') {
                dayPlans.forEach((pp) => {
                  if (planFilter !== 'all' && pp.name !== planFilter) return;

                  let isWon = false,
                    isLose = false;
                  let allWon = true,
                    anyLose = false,
                    anyUnknown = false;
                  for (const mm of pp.matches) {
                    if (!mm.isWon) allWon = false;
                    if (mm.isLose) anyLose = true;
                    if (!mm.isWon && !mm.isLose) anyUnknown = true;
                  }
                  if (anyUnknown) return;
                  isWon = allWon;
                  isLose = anyLose && !isWon;

                  let prize = 0,
                    dayIncome = 0,
                    statusE = 'unknown';
                  if (isWon) {
                    // 方案六：标准荷兰式投注，奖金 = 总本金 / Σ(1/赔率)
                    if (pp.name && pp.name.endsWith('_6')) {
                      const mm6 = pp.matches[0];
                      const subOdds6 = extractIndividualOdds(mm6.oddsObj, mm6.direction);
                      if (subOdds6.length === 2) {
                        const invSum6 = subOdds6.reduce((s, o) => s + 1 / o, 0);
                        // ★ 有赔率：标准荷兰式
                        prize = invSum6 > 0 ? Math.round(AMOUNT / invSum6) : 0;
                      } else {
                        // ★ 赔率缺失：用 3.5/N 估算荷兰式倍率（与 plan-list calcEffectiveOdds 一致）
                        const nSel = mm6.direction.split(/[、,]/).length || 2;
                        prize = Math.round(AMOUNT * 3.5 / nSel);
                      }
                    } else if (pp.name && pp.name.endsWith('_7')) {
                      // ★ P1-方案七：标准荷兰式投注，奖金 = 总本金 / Σ(1/赔率)
                      const mm7 = pp.matches[0];
                      const subOdds7 = extractIndividualOdds(mm7.oddsObj, mm7.direction);
                      if (subOdds7.length > 0) {
                        const invSum7 = subOdds7.reduce((s, o) => s + 1 / o, 0);
                        prize = invSum7 > 0 ? Math.round(AMOUNT / invSum7) : Math.round(AMOUNT * 3);
                      } else {
                        prize = Math.round(AMOUNT * 3);
                      }
                    } else {
                      // ★ 方案一~五：2串1/单关产品奖品
                      const effectiveOdds = [];
                      for (const mm of pp.matches) {
                        const subOdds = extractIndividualOdds(mm.oddsObj, mm.direction);
                        if (subOdds.length === 0) {
                          // ★ 单场赔率缺失时按方向估算荷兰式有效赔率
                          const nSub = mm.direction.split(/[、,]/).length || 1;
                          if (nSub === 1) {
                            effectiveOdds.push(2.5); // 单选项用 2.5x 典型赔率
                          } else {
                            // 多选项：totalGoals 用 3.5/N，其他用 3.0/N
                            const baseOdds = mm.direction.indexOf('总进球-') === 0 ? 3.5 : 3.0;
                            effectiveOdds.push(baseOdds / nSub);
                          }
                          continue;
                        }
                        const NN = subOdds.length;
                        if (NN === 1) {
                          effectiveOdds.push(subOdds[0]);
                        } else {
                          // ★ 荷兰式公式：1 / Σ(1/o) 替代错误的 sum/(2N)
                          const invSum = subOdds.reduce((s, o) => s + 1 / o, 0);
                          effectiveOdds.push(invSum > 0 ? 1 / invSum : 0);
                        }
                      }
                      if (effectiveOdds.length >= 2) {
                        prize = Math.round(AMOUNT * effectiveOdds[0] * effectiveOdds[1]);
                      } else if (effectiveOdds.length === 1) {
                        prize = Math.round(AMOUNT * effectiveOdds[0]);
                      } else {
                        prize = 0;
                      }
                    }
                    dayIncome = prize - AMOUNT;
                    statusE = 'won';
                    totalWon++;
                  } else if (isLose) {
                    dayIncome = -AMOUNT;
                    statusE = 'lose';
                  }
                  totalPlans++;
                  totalIncome += dayIncome;
                  results.push({
                    date: ds,
                    plan: pp.planName,
                    status: statusE,
                    matches: pp.matches.map((mm) => ({
                      matchNum: mm.matchNum,
                      home: mm.homeName,
                      visit: mm.visitName,
                      direction: mm.direction,
                      isWon: mm.isWon,
                      isLose: mm.isLose,
                    })),
                    prize: prize,
                    income: dayIncome,
                  });
                });
              }

              // ===== 单场比分方案 =====
              if (directionFilter === 'all' || directionFilter === 'score') {
                const _scoreCandidates = [];
                for (let _si = 0; _si < mList.length; _si++) {
                  const _m = mList[_si];
                  const _mid = _m.matchId || '';
                  const _gs = _globalGsMap['m_' + _mid] || _globalGsMap[_mid] || null;
                  if (!_gs) continue;
                  const _qual = PG.qualifyMatch({ gs: _gs });
                  if (!_qual) continue;

                  const _matchDate = (_m.date || '').slice(0, 10);
                  const _matchNum = _m.num || '';
                  var _bfOdds = getScoreOdds(_globalAllplays, _matchDate, _matchNum);
                  const _useBfOdds = !!_bfOdds;
                  if (!_bfOdds && _gs && _gs.scores && _gs.scores.length > 0) {
                    _bfOdds = {};
                    _gs.scores.forEach(function (s) {
                      if (!s || !s.score || !s.percent) return;
                      const pct = parseFloat(s.percent) || 0;
                      if (pct > 0) _bfOdds[s.score] = Math.round((100 / pct) * 100) / 100;
                    });
                  }
                  if (!_bfOdds || Object.keys(_bfOdds).length === 0) continue;

                  const _spm = PG.buildScorePercentMap(_gs);
                  let _goalUpper = 0;
                  if (_gs.goalRange && _gs.goalRange.upper) _goalUpper = parseInt(_gs.goalRange.upper) || 0;
                  else if (_gs.goalRange && _gs.goalRange.range) {
                    const _grParts = String(_gs.goalRange.range).split('-');
                    if (_grParts.length >= 2) _goalUpper = parseInt(_grParts[1]) || 0;
                  }
                  const _dQual = {
                    scorePercentMap: _spm,
                    goalUpper: _goalUpper,
                    xgHome: _qual.xgHome,
                    xgAway: _qual.xgAway,
                    totalStrength: parseFloat(_gs.totalStrength) || 0,
                  };
                  const _combos = PG.dutchCombinations(_bfOdds, 1000, _qual.strongIsHome, _useBfOdds, _dQual);
                  if (_combos.length === 0) continue;

                  const _qs = PG.computeScoreQuality(_gs, _qual);
                  _scoreCandidates.push({
                    match: _m,
                    gs: _gs,
                    matchId: _mid,
                    strongIsHome: _qual.strongIsHome,
                    qualityScore: _qs,
                    bestCombo: _combos[0],
                  });
                }

                _scoreCandidates.sort(function (a, b) {
                  return b.qualityScore - a.qualityScore;
                });
                let _topCount = 0;
                if (_scoreCandidates.length > 0 && _scoreCandidates[0].qualityScore >= 45) _topCount = 1;
                if (_scoreCandidates.length >= 2 && _scoreCandidates[1].qualityScore >= 50) _topCount = 2;
                if (
                  _scoreCandidates.length >= 3 &&
                  _scoreCandidates[2].qualityScore >= 45 &&
                  _scoreCandidates[2].bestCombo &&
                  (_scoreCandidates[2].bestCombo.coverage || 0) >= 0.25
                )
                  _topCount = 3;
                if (_topCount === 0 && _scoreCandidates.length >= 1 && _scoreCandidates[0].qualityScore < 45)
                  _topCount = 0;
                const _topCands = _scoreCandidates.slice(0, Math.max(0, _topCount));

                _topCands.forEach(function (c, idx) {
                  const combo = c.bestCombo;
                  const rawScore = (c.match.score || '').replace(/:/g, '-');
                  let sWon = false,
                    sLose = false,
                    prize = 0,
                    winAlloc = 0,
                    winOdds = 0;
                  if (rawScore) {
                    for (let _si2 = 0; _si2 < combo.scores.length; _si2++) {
                      if (combo.scores[_si2].score === rawScore) {
                        sWon = true;
                        winAlloc = combo.scores[_si2].allocation || 0;
                        winOdds = combo.scores[_si2].odds || 0;
                        break;
                      }
                    }
                    sLose = !sWon;
                  }
                  if (!sWon && !sLose) return;
                  prize = sWon ? Math.round(winAlloc * winOdds) : 0;

                  totalPlans++;
                  if (sWon) {
                    totalWon++;
                    totalIncome += prize - AMOUNT_SCORE_OR_QUANT;
                  } else if (sLose) {
                    totalIncome -= AMOUNT_SCORE_OR_QUANT;
                  }

                  results.push({
                    date: ds,
                    plan: '单关比分方案 ' + (idx + 1),
                    status: sWon ? 'won' : sLose ? 'lose' : 'unknown',
                    matches: [
                      {
                        matchNum: c.match.num || '',
                        home: c.match.homeName || '',
                        visit: c.match.visitName || '',
                        direction: '比分',
                        isWon: sWon,
                        isLose: sLose,
                      },
                    ],
                    prize: prize,
                    income: sWon ? prize - AMOUNT_SCORE_OR_QUANT : sLose ? -AMOUNT_SCORE_OR_QUANT : 0,
                  });
                });
              }

              // ===== 量化博冷方案 =====
              if (directionFilter === 'all' || directionFilter === 'quant') {
                const _chgDay = _globalChgMap[ds] || {};
                const _hasChg = Object.keys(_chgDay).length > 0;

                const _od = getOddsHistory(ds) || {};
                const MIN_COLD_SCORE = 40,
                  MIN_PLAN_AVG = 45;

                const _coldCands = [];
                for (let _qi = 0; _qi < mList.length; _qi++) {
                  const _qm = mList[_qi];
                  const _qmid = _qm.matchId;
                  let _qgs = _globalGsMap['m_' + _qmid] || _globalGsMap[_qmid] || null;
                  const _consensus = _qgs ? _qgs.fusionConsensus || '' : '';
                  if (_consensus.indexOf('熔断') >= 0 || _consensus === 'meltdown') continue;

                  const _modds = PG.getMatchOdds(_qm, _od, _globalAllplays);
                  const _spf = _modds && _modds.spf ? _modds.spf : null;
                  if (!_spf || _spf.home == null || _spf.draw == null || _spf.away == null) continue;

                  const _coldDir = PG.getColdDirection({ spf: _spf }, _qgs);
                  const _chgEntry = _chgDay[_qmid];
                  let _hi =
                    _chgEntry && _chgEntry.heatIndex !== null && _chgEntry.heatIndex !== undefined
                      ? _chgEntry.heatIndex
                      : null;

                  if (_hasChg) {
                    if (_hi === null) continue;
                    if (_hi >= 1.4 || _hi >= 0.85) continue;
                  } else {
                    var impliedHome = 1 / parseFloat(_spf.home),
                      impliedDraw = 1 / parseFloat(_spf.draw),
                      impliedAway = 1 / parseFloat(_spf.away);
                    var totalImplied = impliedHome + impliedDraw + impliedAway;
                    var coldFair = impliedDraw;
                    if (_coldDir.dir === '胜') coldFair = impliedHome;
                    if (_coldDir.dir === '负') coldFair = impliedAway;
                    if (coldFair < 0.12) continue;
                    if (_consensus.indexOf('strong') >= 0 || _consensus.indexOf('强') >= 0) continue;
                    if (!_qgs || _qgs.totalStrength === null || _qgs.totalStrength === undefined)
                      _qgs = Object.assign({}, _qgs || {}, { totalStrength: 0 });
                    _hi = 0.65;
                  }

                  const _coldScore = PG.computeColdScore(_hi, _qgs, { spf: _spf }, _coldDir);
                  if (_coldScore < MIN_COLD_SCORE) continue;

                  _coldCands.push({
                    match: _qm,
                    gs: _qgs,
                    heatIndex: _hi,
                    coldDir: _coldDir.dir,
                    coldOdds: _coldDir.odds,
                    coldScore: _coldScore,
                    odds: _modds,
                  });
                }

                _coldCands.sort(function (a, b) {
                  return b.coldScore - a.coldScore;
                });
                let _qPlanCount = 0;
                if (_coldCands.length >= 4 && (_coldCands[0].coldScore + _coldCands[1].coldScore) / 2 >= MIN_PLAN_AVG)
                  _qPlanCount = 2;
                else if (_coldCands.length >= 4) _qPlanCount = 1;
                else if (
                  _coldCands.length >= 2 &&
                  (_coldCands[0].coldScore + _coldCands[1].coldScore) / 2 >= MIN_PLAN_AVG
                )
                  _qPlanCount = 1;

                const _usedIds = [];
                for (let _qp = 0; _qp < _qPlanCount; _qp++) {
                  const _picked = [];
                  for (let _qci = 0; _qci < _coldCands.length && _picked.length < 2; _qci++) {
                    if (_usedIds.indexOf(_coldCands[_qci].match.matchId) >= 0) continue;
                    if (_picked.length === 0) {
                      _picked.push(_coldCands[_qci]);
                    } else {
                      const _corr = PG.checkCorrelation(_picked[0].match, _coldCands[_qci].match);
                      if (_corr.riskLevel === 'high') continue;
                      _picked.push(_coldCands[_qci]);
                    }
                  }
                  if (_picked.length < 2) break;
                  _usedIds.push(_picked[0].match.matchId, _picked[1].match.matchId);

                  const _ca = _picked[0],
                    _cb = _picked[1];
                  const _pAvg = Math.round((_ca.coldScore + _cb.coldScore) / 2);
                  if (_pAvg < MIN_PLAN_AVG) continue;

                  // 判定两场命中结果
                  const _rA = PG.checkMatchResult(_ca.match.matchId, _ca.coldDir, rMap, normalizeRecs, mMap);
                  const _rB = PG.checkMatchResult(_cb.match.matchId, _cb.coldDir, rMap, normalizeRecs, mMap);

                  let _qWon = false,
                    _qLose = false;
                  if (_rA.isWon === true && _rB.isWon === true) _qWon = true;
                  else if (_rA.isLose === true || _rB.isLose === true) _qLose = true;
                  if (!_qWon && !_qLose) continue;

                  totalPlans++;
                  if (_qWon) {
                    totalWon++;
                    // ★ 赔率缺失时跳过中奖记录，不计算奖金
                    const _hasValidColdOdds =
                      _ca.coldOdds > 0 && _cb.coldOdds > 0 && !isNaN(_ca.coldOdds * _cb.coldOdds);
                    if (!_hasValidColdOdds) continue;
                    const _qpPrize = Math.round(1000 * _ca.coldOdds * _cb.coldOdds);
                    totalIncome += _qpPrize - AMOUNT_SCORE_OR_QUANT;
                    results.push({
                      date: ds,
                      plan: '量化博冷方案 ' + (_qp + 1),
                      status: 'won',
                      matches: [
                        {
                          matchNum: _ca.match.num || '',
                          home: _ca.match.homeName || '',
                          visit: _ca.match.visitName || '',
                          direction: _ca.coldDir,
                          isWon: true,
                          isLose: false,
                        },
                        {
                          matchNum: _cb.match.num || '',
                          home: _cb.match.homeName || '',
                          visit: _cb.match.visitName || '',
                          direction: _cb.coldDir,
                          isWon: true,
                          isLose: false,
                        },
                      ],
                      prize: _qpPrize,
                      income: _qpPrize - AMOUNT_SCORE_OR_QUANT,
                    });
                  } else if (_qLose) {
                    totalIncome -= AMOUNT_SCORE_OR_QUANT;
                    results.push({
                      date: ds,
                      plan: '量化博冷方案 ' + (_qp + 1),
                      status: 'lose',
                      matches: [
                        {
                          matchNum: _ca.match.num || '',
                          home: _ca.match.homeName || '',
                          visit: _ca.match.visitName || '',
                          direction: _ca.coldDir,
                          isWon: _rA.isWon || false,
                          isLose: _rA.isLose || false,
                        },
                        {
                          matchNum: _cb.match.num || '',
                          home: _cb.match.homeName || '',
                          visit: _cb.match.visitName || '',
                          direction: _cb.coldDir,
                          isWon: _rB.isWon || false,
                          isLose: _rB.isLose || false,
                        },
                      ],
                      prize: 0,
                      income: -AMOUNT_SCORE_OR_QUANT,
                    });
                  }
                }
              }
            }

            // === 我的方案 ===
            if (directionFilter === 'my') {
              const deviceId = (req.headers['x-device-id'] || '').trim();
              if (deviceId) {
                const userPlans = readUserPlans(deviceId) || [];
                let myWon = 0, myIncome = 0;
                userPlans.forEach(function (p) {
                  // 只统计已结算的方案（isWon 为 true 或 false）
                  if (p.isWon !== true && p.isWon !== false) return;
                  if (planFilter !== 'all') {
                    // 用户方案没有 plan_1~7 分类，按方案名模糊匹配
                    const pName = p.note || p.planName || '';
                    if (pName.indexOf(planFilter) < 0) return;
                  }
                  // 日期过滤
                  const pDate = (p.date || p.createdAt || '').slice(0, 10);
                  if (daysFilter > 0) {
                    if (!pDate || pDate < fmtDate2(startDate) || pDate > fmtDate2(endDate)) return;
                  }
                  // 金额转换：amount 是元，转换为分（与 expert/score/quant 统一）
                  const amountFen = Math.round((Number(p.amount) || 0) * 100);
                  if (p.isWon) {
                    myWon++;
                    let prize = 0;
                    if (p.resultIncome != null && p.resultIncome !== undefined) {
                      prize = Number(p.resultIncome);
                    } else if (p.totalOdds && amountFen > 0) {
                      prize = Math.round(Number(p.totalOdds) * amountFen);
                    } else {
                      prize = amountFen;
                    }
                    const dayInc = prize - amountFen;
                    myIncome += dayInc;
                    results.push({
                      date: pDate || '未知',
                      plan: p.note || '我的方案',
                      status: 'won',
                      prize: prize,
                      income: dayInc,
                    });
                  } else {
                    myIncome -= amountFen;
                    results.push({
                      date: pDate || '未知',
                      plan: p.note || '我的方案',
                      status: 'lose',
                      prize: 0,
                      income: -amountFen,
                    });
                  }
                });
                totalPlans += results.length;
                totalWon += myWon;
                totalIncome += myIncome;
              }
            }

            // Aggregate by date
            const dateMap = {};
            results.forEach((r) => {
              if (!dateMap[r.date]) dateMap[r.date] = { won: 0, total: 0, income: 0 };
              dateMap[r.date].total++;
              dateMap[r.date].income += r.income;
              if (r.status === 'won') dateMap[r.date].won++;
            });
            const dayRecords = [];
            Object.keys(dateMap)
              .sort()
              .reverse()
              .forEach((ds) => {
                const dr = dateMap[ds];
                dayRecords.push({
                  date: ds,
                  hitCount: dr.won,
                  totalPlans: dr.total,
                  hitRate: dr.total > 0 ? Math.round((dr.won / dr.total) * 100) : 0,
                  income: dr.income,
                });
              });

            const winRate = totalPlans > 0 ? Math.round((totalWon / totalPlans) * 100) : 0;
            return res.json({
              code: 1,
              data: {
                summary: { totalPlans: totalPlans, totalWon: totalWon, totalIncome: totalIncome, winRate: winRate },
                records: dayRecords,
              },
            });
          } catch (e) {
            return res.json({ code: 0, msg: '获取收入统计失败: ' + e.message });
          }
        }

        case 'filter-stats': {
          try {
            const fs = require('fs');
            const path = require('path');
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};

            let matchCount = 0,
              totalMatches = 0,
              leagueSet = {},
              dirSet = {},
              staleCount = 0,
              partialStaleCount = 0;
            Object.keys(mMap).forEach(function (k) {
              const m = mMap[k];
              if (!m) return;
              totalMatches++;
              const raw = rMap['m_' + m.matchId] || rMap[String(m.matchId)] || [];
              if (raw.length === 0) return; // 跳过无推荐的比赛
              const hasResult = raw.some(function (x) {
                return (
                  (x.rs !== undefined ? x.rs : x.result) !== null &&
                  (x.rs !== undefined ? x.rs : x.result) !== undefined
                );
              });
              if (hasResult) {
                matchCount++;
                if (m.leagueName) leagueSet[m.leagueName] = true;
                raw.forEach(function (x) {
                  const t = x.t || x.type;
                  if (t) dirSet[t] = true;
                });
              }
              // 统计待回填：全部推荐结果都是 null/undefined → 真正需要回填
              const allStale = raw.length > 0 && raw.every(function (x) {
                const r = x.rs !== undefined ? x.rs : x.result;
                return r === null || r === undefined;
              });
              if (allStale) staleCount++;
              else if (!hasResult) {
                // 部分有结果部分没有（不会发生，因为hasResult检查过了所有都无结果的情况）
              }
              // 部分缺失：至少有一条有结果，也至少有一条没结果
              const someStale = raw.some(function (x) {
                const r = x.rs !== undefined ? x.rs : x.result;
                return r === null || r === undefined;
              });
              if (hasResult && someStale) partialStaleCount++;
            });

            return res.json({
              code: 1,
              data: {
                matchCount: matchCount,
                totalMatches: totalMatches,
                leagueCount: Object.keys(leagueSet).length,
                directionCount: Object.keys(dirSet).length,
                leagues: Object.keys(leagueSet).sort(),
                staleCount: staleCount,
                partialStaleCount: partialStaleCount,
              },
            });
          } catch (e) {
            return res.json({ code: 0, msg: '获取统计失败: ' + e.message });
          }
        }

        // ★ 投注弹窗：获取比赛赔率数据 (SPF/RQSPF/BF/JQS/BQC)
        case 'match-odds': {
          try {
            const matchId = data.matchId;
            if (!matchId) return res.json({ code: 0, msg: '缺少 matchId' });

            // 1) 从 data.json 获取比赛信息
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            let match = mMap['m_' + matchId] || mMap[matchId];
            if (!match) {
              // 尝试遍历查找
              Object.keys(mMap).forEach(function (k) {
                const m = mMap[k];
                if (m && String(m.matchId) === String(matchId)) match = m;
              });
            }
            // ★ 兜底: data.json 无当天数据时，从实时 API 获取（与 batch-match-odds 对齐）
            if (!match) {
              try {
                const liveMatches = await ensureData();
                if (liveMatches) {
                  for (let li = 0; li < liveMatches.length; li++) {
                    if (String(liveMatches[li].matchId) === String(matchId)) {
                      match = liveMatches[li]; break;
                    }
                  }
                }
              } catch (e2) { /* 实时数据获取失败，继续走原有逻辑 */ }
            }
            if (!match) return res.json({ code: 0, msg: '未找到比赛' });

            const dateStr = (match.date || '').slice(0, 10);
            const matchNum = match.num || '';

            // 2) 从 allplays.json 获取全玩法赔率，缺失时回退到 odds_history
            const allplays = getAllplaysData();
            let dayData = {};
            let isAllplays = true;
            if (dateStr) {
              dayData = allplays[dateStr] || {};
              if (Object.keys(dayData).length === 0) {
                // ★ 回退: allplays.json 缺失当日数据 → 从 odds_history 加载
                isAllplays = false;
                try {
                  const oddsFile = path.join(__dirname, 'odds_history', dateStr + '.json');
                  if (fs.existsSync(oddsFile)) {
                    const raw = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
                    const oddsMap = raw.odds || {};
                    // 将 odds_history 格式转为类 allplays 格式（补充 key 映射）
                    dayData = {};
                    Object.keys(oddsMap).forEach(function (n) {
                      const o = oddsMap[n];
                      const entry = Object.assign({ num: n }, o);
                      // totalGoals 映射为 jqs（总进球）
                      if (o.totalGoals && !o.jqs) {
                        entry.jqs = o.totalGoals;
                      }
                      // halfFull 映射为 bqc（半全场）
                      if (o.halfFull && !o.bqc) {
                        entry.bqc = o.halfFull;
                      }
                      dayData['num_' + n] = entry;
                    });
                  }
                } catch (e) { /* 回退失败不影响 */ }
              }
            }

            // 按 num_XXX 匹配，再按原始 key 匹配，最后遍历查找
            let oddsEntry = dayData['num_' + matchNum] || dayData[matchNum];
            if (!oddsEntry && dateStr) {
              // 遍历当天所有 key 尝试匹配
              Object.keys(dayData).forEach(function (k) {
                const e = dayData[k];
                if (e && ((e.num && String(e.num) === String(matchNum)) || k === matchNum)) {
                  oddsEntry = e;
                }
              });
            }

            // 3) 构造返回数据
            const result = {
              matchId: matchId,
              date: dateStr,
              num: matchNum,
              // SPF (胜平负)
              spf: oddsEntry && oddsEntry.spf
                ? { home: oddsEntry.spf.home || null, draw: oddsEntry.spf.draw || null, away: oddsEntry.spf.away || null }
                : {},
              // RQSPF (让球胜平负) — 多行让球数
              rqspfList: [],
              // BF (比分)
              bf: [],
              // JQS (总进球)
              jqs: [],
              // BQC (半全场)
              bqc: [],
            };

            if (oddsEntry) {
              // 让球胜平负 (多让球数)
              if (oddsEntry.rqspf) {
                const rq = oddsEntry.rqspf;
                // 单个让球对象
                if (typeof rq.home !== 'undefined') {
                  result.rqspfList.push({
                    handicap: rq.handicap != null ? rq.handicap : 0,
                    home: rq.home || null,
                    draw: rq.draw || null,
                    away: rq.away || null,
                  });
                }
              }
              // 多让球数 (rqspfList)
              if (oddsEntry.rqspfList) {
                oddsEntry.rqspfList.forEach(function (rq) {
                  result.rqspfList.push({
                    handicap: rq.handicap != null ? rq.handicap : 0,
                    home: rq.home || null,
                    draw: rq.draw || null,
                    away: rq.away || null,
                  });
                });
              }
              // 如果都没有，至少给一个让球0的默认值
              if (result.rqspfList.length === 0 && oddsEntry.rqspf_0) {
                const r0 = oddsEntry.rqspf_0;
                result.rqspfList.push({
                  handicap: 0,
                  home: r0.home || null,
                  draw: r0.draw || null,
                  away: r0.away || null,
                });
              }

              // 比分 (+胜其他/平其他/负其他)
              const scoreOrder = [
                '1:0','2:0','2:1','3:0','3:1','3:2','4:0','4:1','4:2','5:0','5:1','5:2','胜其他',
                '0:0','1:1','2:2','3:3','平其他',
                '0:1','0:2','1:2','0:3','1:3','2:3','0:4','1:4','2:4','0:5','1:5','2:5','负其他',
              ];
              // ★ 比分 — 兼容 bf(数组[{score,odds}]) 和 scores(对象{scores["1:0"]=7.75})
              const bfSource = oddsEntry.bf || oddsEntry.scores;
              if (bfSource) {
                const bfMap = {};
                if (Array.isArray(bfSource)) {
                  bfSource.forEach(function (s) { bfMap[s.score] = s.odds; });
                } else if (typeof bfSource === 'object') {
                  Object.keys(bfSource).forEach(function (k) { bfMap[k] = bfSource[k]; });
                }
                scoreOrder.forEach(function (sc) {
                  if (bfMap[sc] != null) {
                    result.bf.push({ score: sc, odds: bfMap[sc] });
                  }
                });
                // 也包含不在标准顺序中的比分
                Object.keys(bfMap).forEach(function (sc) {
                  if (scoreOrder.indexOf(sc) < 0) {
                    result.bf.push({ score: sc, odds: bfMap[sc] });
                  }
                });
              }

              // ★ 总进球 — 兼容 jqs 和 totalGoals 两种 key
              const jqsSource = oddsEntry.jqs || oddsEntry.totalGoals;
              if (jqsSource && typeof jqsSource === 'object' && !Array.isArray(jqsSource)) {
                  for (let g = 0; g <= 7; g++) {
                    const key = String(g);
                    if (jqsSource[key] != null) {
                      result.jqs.push({ goals: key, odds: jqsSource[key] });
                    }
                  }
                  if (jqsSource['7+'] != null || jqsSource['7'] != null) {
                    result.jqs.push({ goals: '7+', odds: jqsSource['7+'] || jqsSource['7'] });
                  }
              }

              // ★ 半全场 — 兼容 bqc(数组[{combo,odds}]) 和 halfFull(对象{hh/hd/ha/...})
              const bqcOrder = ['胜胜','胜平','胜负','平胜','平平','平负','负胜','负平','负负'];
              const hfToLabel = { hh:'胜胜', hd:'胜平', ha:'胜负', dh:'平胜', dd:'平平', da:'平负', ah:'负胜', ad:'负平', aa:'负负' };
              const bqcSource = oddsEntry.bqc || oddsEntry.halfFull;
              if (bqcSource) {
                const bqcMap = {};
                if (Array.isArray(bqcSource)) {
                  bqcSource.forEach(function (b) {
                    bqcMap[b.combo || b.label || b.key] = b.odds;
                  });
                } else if (typeof bqcSource === 'object') {
                  // halfFull 格式: { hh: 2.45, hd: 14.50, ... }
                  Object.keys(bqcSource).forEach(function (k) {
                    const label = hfToLabel[k] || k;
                    bqcMap[label] = bqcSource[k];
                  });
                }
                bqcOrder.forEach(function (c) {
                  if (bqcMap[c] != null) {
                    result.bqc.push({ combo: c, odds: bqcMap[c] });
                  }
                });
              }
            }

            return res.json({ code: 1, data: result });
          } catch (e) {
            logger.error('[match-odds] ' + e.message);
            return res.json({ code: 0, msg: '获取赔率失败: ' + e.message });
          }
        }

        // ★ P2-1: 缓存统计端点（运维可观测）
        case 'cache-stats': {
          try {
            // 1) 核心内存缓存统计
            const coreStats = getCoreCacheStats();
            
            // 2) 功守道缓存管理器统计
            let gsManagerStats = {};
            try {
              const cm = require('./gongshoudao/cache_manager');
              gsManagerStats = cm.getCacheStats ? cm.getCacheStats() : {};
            } catch (e) {
              gsManagerStats = { error: e.message };
            }

            // 3) 文件缓存大小
            const frc = tryRequire;
            const cacheFiles = [
              { name: 'cache.json', path: path.join(__dirname, 'gongshoudao', 'cache.json') },
              { name: 'stats_bank.json', path: path.join(__dirname, 'stats_bank.json') },
              { name: 'jczq_change_cache.json', path: path.join(__dirname, 'jczq_change_cache.json') },
              { name: 'ai_cache.json', path: path.join(__dirname, 'ai_cache.json') },
              { name: 'batch_index.json', path: path.join(__dirname, 'batch_index.json') },
            ];
            const fileSizes = {};
            cacheFiles.forEach(function (cf) {
              try {
                if (fs.existsSync(cf.path)) {
                  const stat = fs.statSync(cf.path);
                  fileSizes[cf.name] = {
                    sizeKB: Math.round(stat.size / 1024),
                    mtime: stat.mtime.toISOString(),
                  };
                } else {
                  fileSizes[cf.name] = null;
                }
              } catch (e) {
                fileSizes[cf.name] = { error: e.message };
              }
            });

            // 4) WebSocket 客户端统计
            let wsStats = { clients: 0 };
            try {
              const ws = require('./websocket');
              wsStats = { clients: ws.getClientCount ? ws.getClientCount() : 'N/A' };
            } catch (e) {}

            return res.json({
              code: 1,
              data: {
                time: new Date().toISOString(),
                memory: coreStats,
                gongshoudao: gsManagerStats,
                files: fileSizes,
                websocket: wsStats,
              },
            });
          } catch (e) {
            return res.json({ code: 0, msg: '获取缓存统计失败: ' + e.message });
          }
        }

        // ═══════════════════════════════════════════
        //  用户自定义方案 API（匿名 deviceId 体系）
        // ═══════════════════════════════════════════

        case 'my-plan-save': {
          try {
            const deviceId = req.headers['x-device-id'] || data.deviceId;
            if (!deviceId) return res.json({ code: 0, msg: '缺少用户标识' });
            const plan = data.plan || {};
            if (!plan.matches || plan.matches.length === 0) return res.json({ code: 0, msg: '方案不能为空' });
            const plans = readUserPlans(deviceId);
            const now = new Date().toISOString();
            if (plan.id) {
              // 更新已有方案
              const idx = plans.findIndex(function (p) { return p.id === plan.id; });
              if (idx >= 0) {
                plan.updatedAt = now;
                plans[idx] = Object.assign({}, plans[idx], plan, { createdAt: plans[idx].createdAt || now });
              } else {
                plan.id = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
                plan.createdAt = now;
                plan.updatedAt = now;
                plans.push(plan);
              }
            } else {
              plan.id = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
              plan.createdAt = now;
              plan.updatedAt = now;
              plans.push(plan);
            }
            writeUserPlans(deviceId, plans);
            return res.json({ code: 1, data: { id: plan.id, total: plans.length } });
          } catch (e) {
            logger.error('[my-plan-save] ' + e.message);
            return res.json({ code: 0, msg: '保存失败: ' + e.message });
          }
        }

        case 'my-plan-list': {
          try {
            const deviceId = req.headers['x-device-id'] || data.deviceId;
            if (!deviceId) return res.json({ code: 1, data: { plans: [], stats: { count: 0, income: 0, hitRate: 0 } } });
            var plans = readUserPlans(deviceId);
            // 按更新时间倒序
            plans.sort(function (a, b) {
              return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
            });
            // ★ 重新计算方案开奖状态（基于最新比赛结果）
            var dirty = false;
            plans = plans.map(function (p) {
              var r = recalcPlanResult(p);
              if (r !== p) dirty = true;
              return r;
            });
            // 如果方案状态有更新，回写到文件
            if (dirty) {
              writeUserPlans(deviceId, plans);
            }
            // 计算统计
            var stats = computeUserPlanStats(plans);
            return res.json({ code: 1, data: { plans: plans, stats: stats } });
          } catch (e) {
            logger.error('[my-plan-list] ' + e.message);
            return res.json({ code: 0, msg: '获取失败: ' + e.message });
          }
        }

        case 'my-plan-delete': {
          try {
            const deviceId = req.headers['x-device-id'] || data.deviceId;
            const planId = data.planId;
            if (!deviceId || !planId) return res.json({ code: 0, msg: '缺少参数' });
            var plans = readUserPlans(deviceId);
            var before = plans.length;
            plans = plans.filter(function (p) { return p.id !== planId; });
            if (plans.length === before) return res.json({ code: 0, msg: '方案不存在' });
            writeUserPlans(deviceId, plans);
            return res.json({ code: 1, data: { deleted: true, total: plans.length } });
          } catch (e) {
            logger.error('[my-plan-delete] ' + e.message);
            return res.json({ code: 0, msg: '删除失败: ' + e.message });
          }
        }

        case 'my-plan-stats': {
          try {
            const deviceId = req.headers['x-device-id'] || data.deviceId;
            if (!deviceId) return res.json({ code: 1, data: { count: 0, income: 0, hitRate: 0 } });
            var plans = readUserPlans(deviceId);
            // ★ 重新计算方案开奖状态
            plans = plans.map(function (p) { return recalcPlanResult(p); });
            var stats = computeUserPlanStats(plans);
            return res.json({ code: 1, data: stats });
          } catch (e) {
            logger.error('[my-plan-stats] ' + e.message);
            return res.json({ code: 0, msg: '获取统计失败: ' + e.message });
          }
        }

        case 'batch-match-odds': {
          try {
            var matchIds = data.matchIds || [];
            if (!matchIds.length) return res.json({ code: 1, data: {} });
            var result = {};
            var dateStr = data.date || latestDataDate();
            var oddsMap = getOddsHistory(dateStr) || {};
            var dataFile = getDataJson();
            var mMap = (dataFile && dataFile.m) || {};
            // 实时数据兜底（data.json 无当天数据时用 match-list 已缓存的 ensureData）
            var liveMap = null;
            for (var i2 = 0; i2 < matchIds.length; i2++) {
              var mid = matchIds[i2];
              // ★ 兼容 m_ 前缀和无前缀两种 key 格式
              var m = mMap[mid] || mMap['m_' + mid] || mMap[mid.replace(/^m_/, '')];
              if (!m) {
                // 遍历查找匹配（data.json key 可能是 "数字_数字" 格式）
                var midStr = String(mid).replace(/^m_/, '');
                var mKeys = Object.keys(mMap);
                for (var ki = 0; ki < mKeys.length; ki++) {
                  var rawKey = mKeys[ki].replace(/^m_/, '');
                  if (rawKey === midStr) { m = mMap[mKeys[ki]]; break; }
                }
              }
              if (!m) {
                // ★ 兜底：data.json 无当天数据时，match-list 已缓存 ensureData 到内存
                if (!liveMap) {
                  try { liveMap = await ensureData(); } catch (e2) { liveMap = null; }
                }
                if (liveMap) {
                  var midStr2 = String(mid).replace(/^m_/, '');
                  for (var li = 0; li < liveMap.length; li++) {
                    var lm = liveMap[li];
                    if (String(lm.matchId) === midStr2 || 'm_' + lm.matchId === mid) {
                      m = lm; break;
                    }
                  }
                }
              }
              if (!m) { result[mid] = null; continue; }
              var dateKey = (m.date || '').slice(0, 10);
              // ★ oddsMap 的 key 是竞彩编号（如 "周二201"），需用 m.num 匹配
              var matchNum = m.num || m.matchNum || '';
              // ★ 赔率查找：直接匹配 → 去星期前缀匹配（跨日期降级兜底）→ dateKey 赔率
              var oddsEntry = oddsMap[matchNum] || null;
              if (!oddsEntry) {
                var numOnly = matchNum.replace(/^[周一二三四五六日]+/, '');
                var matchKeys = Object.keys(oddsMap);
                for (var ki2 = 0; ki2 < matchKeys.length; ki2++) {
                  if (matchKeys[ki2].replace(/^[周一二三四五六日]+/, '') === numOnly) {
                    oddsEntry = oddsMap[matchKeys[ki2]]; break;
                  }
                }
              }
              if (!oddsEntry && dateKey) {
                var dateOddsMap = getOddsHistory(dateKey);
                if (dateOddsMap) oddsEntry = dateOddsMap[matchNum] || null;
              }
              oddsEntry = oddsEntry || {};
              // ★ 赔率变动方向（Delta）
              var isSingleGame = false;
              try {
                var deltaLogs = getDeltaHistory(path.join(__dirname, 'odds_history'), dateKey, matchNum);
                if (deltaLogs && deltaLogs.length > 0) {
                  var last = deltaLogs[deltaLogs.length - 1];
                  if (last.changes) {
                    Object.keys(last.changes).forEach(function (k) {
                      var changeStr = last.changes[k];
                      var parts = changeStr.split('→');
                      if (parts.length === 2) {
                        var oldV = parseFloat(parts[0]);
                        var newV = parseFloat(parts[1]);
                        if (oldV > 0 && newV > 0) {
                          last.changes[k] = newV > oldV ? 'up' : newV < oldV ? 'down' : 'flat';
                        }
                      }
                    });
                  }
                }
                // 读取单关标识（赔率文件优先，data.json 兜底）
                var oddsEntryFull = oddsMap[matchNum] || {};
                isSingleGame = oddsEntryFull.isSingleGame === true || m.isSingleGame === true;
              } catch (e) { /* delta 读取失败不影响主流程 */ }

              // ★ 构建按玩法分组的 Delta 摘要 + 方向映射
              var deltaChanges = (deltaLogs && deltaLogs.length > 0 && deltaLogs[deltaLogs.length - 1].changes) || {};
              var groupedDelta = _groupDeltaByPlay(deltaChanges);

              // ★ 构建赔率走势信号（最后 N 次变化的方向趋势）
              var deltaTrend = _buildDeltaTrend(deltaLogs || []);

              var r = {
                matchId: mid,
                homeName: m.homeName || '',
                visitName: m.visitName || '',
                league: m.leagueName || '',
                matchDate: dateKey,
                matchNum: matchNum,
                halfScore: m.half || '',
                spf: oddsEntry.spf || null,
                rqspf: oddsEntry.rqspf || null,
                // ★ key 映射兼容: odds_history 存 totalGoals/halfFull/scores，allplays.json 额外存 jqs/bqc/bf
                jqs: oddsEntry.jqs || oddsEntry.totalGoals || null,
                bqc: oddsEntry.bqc || oddsEntry.halfFull || null,
                bf: oddsEntry.bf || oddsEntry.scores || null,
                handicap: oddsEntry.handicap != null ? oddsEntry.handicap : (m.concede || 0),
                isSingleGame: isSingleGame,
                oddsDelta: deltaChanges,
                // ★ 赔率走势信号（最近变化趋势，用于前端迷你趋势可视化）
                deltaTrend: deltaTrend,
                // ★ 按玩法分组的 Delta（前端用来渲染各区域的箭头和摘要）
                spfDelta: groupedDelta.spf || {},
                rqspfDelta: groupedDelta.rqspf || {},
                bfDelta: groupedDelta.scores || {},
                jqsDelta: groupedDelta.totalGoals || {},
                bqcDelta: groupedDelta.halfFull || {},
                // ★ 各玩法 Delta 摘要（前端显示 ↑N ↓M →K 趋势）
                spfDeltaSummary: groupedDelta.spfSummary || { up: 0, down: 0, flat: 0 },
                rqspfDeltaSummary: groupedDelta.rqspfSummary || { up: 0, down: 0, flat: 0 },
                bfDeltaSummary: groupedDelta.scoresSummary || { up: 0, down: 0, flat: 0 },
                jqsDeltaSummary: groupedDelta.totalGoalsSummary || { up: 0, down: 0, flat: 0 },
                bqcDeltaSummary: groupedDelta.halfFullSummary || { up: 0, down: 0, flat: 0 },
                concede: m.concede || 0,
                // ★ 推荐方向（用于方案设计页黄色底色标记）
                maxRecommendDirs: getMaxRecommendDirs(dataFile, mid),
              };
              result[mid] = r;
            }
            return res.json({ code: 1, data: result });
          } catch (e) {
            logger.error('[batch-match-odds] ' + e.message);
            return res.json({ code: 0, msg: '获取赔率失败: ' + e.message });
          }
        }

        default:
          return res.json({ code: 0, msg: `未知 action: ${action}` });
      }
    } catch (err) {
      logger.error('API错误: ' + err.message);
      // 尝试清除缓存并重试
      if (err.message.includes('登录') || err.message.includes('token')) {
        cache.token = null;
      }
      return res.json({ code: 0, msg: err.message });
    }
  });

  // ═══ 用户方案存储辅助函数 ═══
  var USER_PLANS_DIR = path.join(__dirname, 'user_plans');
  function getUserPlansPath(deviceId) {
    // 消毒 deviceId，防止路径穿越
    var safe = String(deviceId).replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!safe) safe = 'unknown';
    return path.join(USER_PLANS_DIR, safe + '.json');
  }
  function readUserPlans(deviceId) {
    try {
      var fp = getUserPlansPath(deviceId);
      if (fs.existsSync(fp)) {
        return JSON.parse(fs.readFileSync(fp, 'utf8'));
      }
    } catch (e) { /* ignore */ }
    return [];
  }
  function writeUserPlans(deviceId, plans) {
    try {
      if (!fs.existsSync(USER_PLANS_DIR)) fs.mkdirSync(USER_PLANS_DIR, { recursive: true });
      var fp = getUserPlansPath(deviceId);
      fs.writeFileSync(fp, JSON.stringify(plans, null, 2), 'utf8');
    } catch (e) {
      logger.error('[user_plans] 写入失败: ' + e.message);
    }
  }
  function computeUserPlanStats(plans) {
    var count = (plans || []).length;
    var income = 0, won = 0;
    (plans || []).forEach(function (p) {
      if (p.resultIncome != null) income += Number(p.resultIncome) || 0;
      if (p.isWon) won++;
    });
    // 只统计有结果的方案（已开奖）
    var settled = (plans || []).filter(function (p) { return p.isWon === true || p.isWon === false; });
    var hitRate = settled.length > 0 ? Math.round((won / settled.length) * 100) : 0;
    return { count: count, income: Math.round(income), hitRate: hitRate };
  }

  // ★ 重新计算单个方案的 isWon / resultIncome（基于最新比赛结果）
  var _recalcLiveScoresCache = null;
  var _recalcLiveScoresCacheTime = 0;

  function recalcPlanResult(plan) {
    var matches = plan.matches || [];
    if (matches.length === 0) return plan;

    // 如果方案已经有明确的 isWon 结果，不再重算
    if (plan.isWon === true || plan.isWon === false) return plan;

    var dataFile = getDataJson();
    var mMap = dataFile.m || {};

    // 构建 matchNum → mMap entry 索引
    var mByNum = {};
    Object.keys(mMap).forEach(function (k) {
      var entry = mMap[k];
      if (entry && entry.num) {
        mByNum[entry.num] = entry;
      }
    });

    // 加载 live_scores.json（1 分钟缓存）
    var now = Date.now();
    if (!_recalcLiveScoresCache || now - _recalcLiveScoresCacheTime > 60000) {
      _recalcLiveScoresCache = {};
      try {
        var lsPath = path.join(__dirname, 'live_scores.json');
        if (fs.existsSync(lsPath)) {
          var lsData = JSON.parse(fs.readFileSync(lsPath, 'utf8'));
          (lsData.matches || []).forEach(function (ls) {
            if (ls.matchId) _recalcLiveScoresCache[String(ls.matchId)] = ls;
            if (ls.num) _recalcLiveScoresCache[ls.num] = ls;
          });
        }
      } catch (e) { /* ignore */ }
      _recalcLiveScoresCacheTime = now;
    }
    var liveScores = _recalcLiveScoresCache;

    // 逐场判定
    var allSettled = true;
    var allWon = true;
    var anyLose = false;

    for (var i = 0; i < matches.length; i++) {
      var mm = matches[i];
      var matchNum = mm.matchNum || '';
      var playType = mm.playType || '';
      var direction = mm.direction || '';

      // 查找比赛数据
      var matchData = mByNum[matchNum] || null;

      // 兜底：live_scores.json
      if (!matchData || !matchData.score) {
        var ls = liveScores[matchNum] || liveScores[String(mm.matchId)];
        if (ls && ls.score && ls.matchStatus >= 1) {
          matchData = { score: ls.score, date: ls.date };
        }
      }

      // 如果找不到比赛数据或没有比分，标记未开奖
      if (!matchData || !matchData.score) {
        allSettled = false;
        continue;
      }

      // 获取让球数（RQSPF 需要）
      var handicap = null;
      if (playType === 'rqspf') {
        var matchDate = (matchData.date || '').slice(0, 10);
        if (!matchDate) {
          // 尝试从 matchNum 推断日期（如 "周二201" → 最近周二）
          var recentFiles = [];
          try {
            var ohDir = path.join(__dirname, 'odds_history');
            if (fs.existsSync(ohDir)) {
              recentFiles = fs.readdirSync(ohDir).filter(function (f) {
                return f.match(/^\d{4}-\d{2}-\d{2}\.json$/);
              }).sort().reverse();
            }
          } catch (e2) { /* ignore */ }
          for (var fi = 0; fi < recentFiles.length; fi++) {
            var odMap = getOddsHistory(recentFiles[fi].replace('.json', ''));
            if (odMap && odMap[matchNum] && odMap[matchNum].rqspf) {
              handicap = odMap[matchNum].rqspf.handicap;
              break;
            }
          }
        } else {
          var oddsMap = getOddsHistory(matchDate);
          if (oddsMap && oddsMap[matchNum] && oddsMap[matchNum].rqspf) {
            handicap = oddsMap[matchNum].rqspf.handicap;
          }
        }
      }

      // 如果 matchData.score 是对象（如 {home:1, away:0}），转为字符串
      var scoreStr = matchData.score;
      if (typeof scoreStr === 'object' && scoreStr !== null) {
        scoreStr = (scoreStr.home || scoreStr.h || '') + ':' + (scoreStr.away || scoreStr.a || '');
      } else {
        scoreStr = String(scoreStr || '');
      }

      // ★ RQSPF 方向映射：方案存的 "胜/平/负" 在让球玩法中表示 "让胜/让平/让负"
      var effectiveDirection = direction;
      if (playType === 'rqspf') {
        if (direction === '胜') effectiveDirection = '让胜';
        else if (direction === '平') effectiveDirection = '让平';
        else if (direction === '负') effectiveDirection = '让负';
      }

      // 使用比分直判
      var result = _judgeByScore(effectiveDirection, scoreStr, handicap);

      if (result === null) {
        allSettled = false;
      } else if (result === true) {
        // 命中，继续检查下一场
      } else {
        allWon = false;
        anyLose = true;
      }
    }

    // ★ 串关逻辑：未全部开奖时，若任一场已确定失败 → 整单判负
    if (!allSettled) {
      if (anyLose) {
        var updated = Object.assign({}, plan);
        updated.isWon = false;
        updated.resultIncome = -(plan.amount || 0);
        return updated;
      }
      return plan;
    }

    // 全部已开奖 → 判定中奖结果
    var updated = Object.assign({}, plan);
    if (allWon && !anyLose) {
      updated.isWon = true;
      updated.resultIncome = Math.round((plan.amount || 0) * (plan.totalOdds || 1));
    } else {
      updated.isWon = false;
      updated.resultIncome = -(plan.amount || 0);
    }
    return updated;
  }

  /**
   * 比分直判 — 根据比分判定投注方向是否正确
   * @param {string} direction - 方向（胜/平/负/让胜/让平/让负/胜平/平负/总进球-N）
   * @param {string} scoreStr  - 比分字符串（如 "2:1"）
   * @param {number|null} handicap - 让球数
   * @returns {boolean|null} true=命中, false=未中, null=无法判定
   */
  function _judgeByScore(direction, scoreStr, handicap) {
    if (!scoreStr || !direction) return null;

    // 复合方向（含、号）：分开判定，任一命中即可
    if (direction.indexOf('、') >= 0) {
      var subParts = direction.split(/[、,]/);
      for (var pi = 0; pi < subParts.length; pi++) {
        var subR = _judgeByScore(subParts[pi].trim(), scoreStr, handicap);
        if (subR === true) return true;
      }
      return false;
    }

    var parts = String(scoreStr).replace(/[-:]/g, ':').split(':');
    var hg = parseInt(parts[0]);
    var ag = parseInt(parts[1]);
    if (isNaN(hg) || isNaN(ag)) return null;

    // SPF 基础方向
    if (direction === '胜') return hg > ag;
    if (direction === '平') return hg === ag;
    if (direction === '负') return hg < ag;

    // 双选
    if (direction === '胜平') return hg > ag || hg === ag;
    if (direction === '平负') return hg === ag || hg < ag;

    // RQSPF（需要让球数）
    if (direction === '让胜' || direction === '让平' || direction === '让负') {
      var hcp = handicap != null ? parseFloat(handicap) || 0 : 0;
      var effective = hg + hcp;
      if (direction === '让胜') return effective > ag;
      if (direction === '让平') return effective === ag;
      if (direction === '让负') return effective < ag;
    }

    // 总进球（如 "总进球-2", "总进球-3"）
    var goalMatch = direction.match(/总进球-(\d+)/);
    if (goalMatch) {
      return (hg + ag) === parseInt(goalMatch[1]);
    }

    return null;
  }

  // ==================== 前一天推荐命中信息回填 ====================
  let lastBackfillDate = '';

  async function backfillPreviousDayResults() {
    try {
      const today = new Date();
      const todayStr =
        today.getFullYear() +
        '-' +
        String(today.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(today.getDate()).padStart(2, '0');

      if (lastBackfillDate === todayStr) return;

      // 按日期检查近7天（不依赖matchStatus）
      database.initDatabase();
      const db = database.getDatabase();
      if (!db || !db.prepare) return; // 数据库不可用时跳过
      const sevenAgo = new Date(today);
      sevenAgo.setDate(sevenAgo.getDate() - 7);
      const minDate =
        sevenAgo.getFullYear() +
        '-' +
        String(sevenAgo.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(sevenAgo.getDate()).padStart(2, '0');

      const row = db
        .prepare(
          `SELECT COUNT(DISTINCT r.matchId) as cnt FROM recommends r JOIN matches m ON r.matchId=m.matchId WHERE m.date >= ? AND m.date < ? AND r.result IS NULL`,
        )
        .get(minDate, todayStr);
      if (!row || row.cnt === 0) return;

      logger.info('[backfill] 近7天有' + row.cnt + '场比赛结果不全, 开始回填...');

      const stale = db
        .prepare(
          `
      SELECT DISTINCT r.matchId, m.homeName, m.visitName
      FROM recommends r JOIN matches m ON r.matchId=m.matchId
      WHERE m.date >= ? AND m.date < ? AND r.result IS NULL
      LIMIT 50
    `,
        )
        .all(minDate, todayStr);

      if (!stale || stale.length === 0) return;

      // 登录 API
      const { get } = require('./http-utils');
      const CONFIG = {
        MIDOU_BASE: 'https://midou310.com/mdsj',
        MOBILE: process.env.MIDOU_MOBILE,
        PASSWORD: process.env.MIDOU_PASSWORD,
      };
      const loginRes = await get(CONFIG.MIDOU_BASE + '/gduser/login.do', {
        mobile: CONFIG.MIDOU_MOBILE,
        password: CONFIG.MIDOU_PASSWORD,
      });
      if (loginRes.code !== 1) {
        logger.warn('[backfill] 登录失败');
        return;
      }
      const token = loginRes.data.token;

      let updated = 0;
      for (const s of stale) {
        try {
          const recRes = await get(
            CONFIG.MIDOU_BASE + '/score/getExpertRecommData.do',
            { dataId: s.matchId, type: 0 },
            { Cookie: 'token=' + token },
          );
          if (recRes.code === 1 && recRes.data) {
            const fetchDate = yDate;
            const recomms = recRes.data
              .filter((x) => x && x.type && x.num > 0)
              .map((x) => ({
                type: x.type,
                num: x.num,
                result: x.result !== undefined ? x.result : null,
              }));
            database.batchUpsertRecommends(s.matchId, recomms, fetchDate);
            const nulls = recomms.filter((r) => r.result === null).length;
            if (nulls === 0) updated++;
            logger.info('[backfill] ' + s.matchId + ' ' + s.homeName + ' vs ' + s.visitName + ' OK');
          }
        } catch (e) {
          logger.warn('[backfill] ' + s.matchId + ' 失败: ' + e.message);
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      lastBackfillDate = todayStr;
      logger.info('[backfill] 近7天回填完成, 更新' + updated + '场');
    } catch (e) {
      logger.error('[backfill] 回填异常: ' + e.message);
    }
  }

  // ==================== 启动 ====================
  // 初始化数据库
  try {
    database.initDatabase();
  } catch (err) {
    logger.error('数据库初始化失败: ' + err.message);
  }

  // ★ P3-1: 使用显式 http.createServer 以便 WebSocket 共用端口
  const http = require('http');
  const server = http.createServer(app);

  // 挂载 WebSocket
  if (wsServer) {
    try {
      wsServer.attachToServer(server);
    } catch (e) {
      logger.warn('[ws] WebSocket 挂载失败: ' + e.message);
    }
  }

  // ★ P2-2: 缓存预热（异步，不阻塞服务启动）
  try {
    const warmer = require('./core/cache-warmer');
    setTimeout(function () {
      warmer.warmUp({
        log: function (msg) { logger.info('[cache-warmer] ' + msg); },
      });
    }, 500); // 延迟 500ms，让服务器先启动完成
  } catch (e) {
    logger.warn('[cache-warmer] 加载失败: ' + e.message);
  }

  server.listen(PORT, () => {
    const banner = [
      '============================================',
      '  竞彩推荐监控系统 v2',
      `  环境: ${process.env.NODE_ENV || 'development'}`,
      `  API:  http://localhost:${PORT}/api`,
      `  WS:   ws://localhost:${PORT}/ws`,
      `  预览: http://localhost:${PORT}/`,
      `  数据源: 米斗数据`,
      `  定时爬取: ${process.env.NODE_ENV === 'production' ? '已启用(5分钟)' : '开发模式未启用'}`,
      `  前一天回填: 已启用(10分钟检查)`,
      '============================================',
    ];
    banner.forEach((line) => logger.info(line));

    // 前一天推荐命中信息定时回填（每10分钟检查一次）
    setInterval(
      () => {
        backfillPreviousDayResults().catch((e) => {});
      },
      10 * 60 * 1000,
    );
    // 启动时立即执行一次
    setTimeout(() => {
      backfillPreviousDayResults().catch((e) => {});
    }, 30000);
  });

  // 导出供 scheduler 使用（必须在 scheduler require 之前）
  module.exports = { fetchMatches, fetchRecommends, login };

  // 生产环境启动定时爬取
  if (process.env.NODE_ENV === 'production') {
    const scheduler = require('./scheduler');
    scheduler.start();
  }
}

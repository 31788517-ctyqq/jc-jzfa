require('dotenv').config();
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const database = require('./database');
const { get } = require('./http-utils');
const logger = require('./logger');
const deepseek = require('./deepseek');  // 预加载避免 ai-predict 同步异常阻断响应
const doubao = require('./doubao');    // 豆包 API 客户端
const aiMerger = require('./ai_merger'); // 双模型交叉合并引擎

// AI 计时统计（用于预估等待时间）
function getEstimatedWaitTime() {
  try {
    var timingPath = path.join(__dirname, 'ai_timing.json');
    if (fs.existsSync(timingPath)) {
      var timing = JSON.parse(fs.readFileSync(timingPath, 'utf8'));
      if (timing.total_estimated_sec && timing.sample_count > 0) {
        return timing.total_estimated_sec;
      }
    }
  } catch (e) {}
  return 45; // 默认 45 秒保守估计
}

function updateTimingStats(deepseekMs, doubaoMs, mergeMs) {
  try {
    var timingPath = path.join(__dirname, 'ai_timing.json');
    var timing = { deepseek_avg_ms: 0, doubao_avg_ms: 0, merge_avg_ms: 0, total_estimated_sec: 45, sample_count: 0, last_updated: '' };
    if (fs.existsSync(timingPath)) {
      try { timing = JSON.parse(fs.readFileSync(timingPath, 'utf8')); } catch (e) {}
    }
    var n = timing.sample_count || 0;
    // 移动平均
    var decay = n > 5 ? 0.9 : (n > 0 ? 0.7 : 0); // 新样本权重递减
    timing.deepseek_avg_ms = decay > 0 ? Math.round(timing.deepseek_avg_ms * decay + deepseekMs * (1 - decay)) : deepseekMs;
    timing.doubao_avg_ms = decay > 0 ? Math.round(timing.doubao_avg_ms * decay + doubaoMs * (1 - decay)) : doubaoMs;
    timing.merge_avg_ms = mergeMs;
    timing.sample_count = n + 1;
    // 总预估 = max(两模型) + merge，加 3 秒 buffer
    timing.total_estimated_sec = Math.ceil((Math.max(timing.deepseek_avg_ms, timing.doubao_avg_ms) + timing.merge_avg_ms) / 1000) + 3;
    timing.last_updated = new Date().toISOString();
    fs.writeFileSync(timingPath, JSON.stringify(timing));
  } catch (e) {}
}
const app = express();
const PORT = process.env.PORT || 3000;

// 本地日期辅助（避免 UTC 时区偏移）
function localDate(d) {
  d = d || new Date();
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

// 获取 data.json 中最新的有数据日期
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

// 生产优化
app.disable('x-powered-by');
// 生产环境由 nginx 处理 gzip，避免双重压缩
if (!process.env.BEHIND_PROXY) {
  app.use(compression());
}
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// 强制 API 响应为 UTF-8，防止中文乱码 → "??"
app.use('/api', (req, res, next) => {
  var origJson = res.json;
  res.json = function (body) {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return origJson.call(this, body);
  };
  next();
});

// 速率限制
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { code: -1, msg: '请求过于频繁，请稍后再试' }
});
app.use('/api', apiLimiter);

// 静态资源缓存
const staticOpts = { maxAge: '7d', etag: true, lastModified: true };
app.use('/assets/worldcup', express.static(path.join(__dirname, '../miniprogram/images/worldcup'), staticOpts));
app.use('/assets', express.static(path.join(__dirname, '../miniprogram/images'), staticOpts));
// 首页内存缓存
let homeCache = null, homeCacheTime = 0;
const hp = path.join(__dirname, '../preview/index.html');
function getHomeHTML(cb) {
  const now = Date.now();
  if (homeCache && (now - homeCacheTime < 60000)) return cb(null, homeCache);
  fs.readFile(hp, 'utf8', (err, html) => {
    if (!err) { homeCache = html; homeCacheTime = now; }
    cb(err, html || homeCache);
  });
}
app.get('/', (req, res) => {
  getHomeHTML((err, html) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' }); res.end(html); });
});
app.use(express.static(path.join(__dirname, '../preview'), { maxAge: '1h', setHeaders: (res, fPath) => { res.setHeader('Content-Type', fPath.endsWith('.html') ? 'text/html; charset=utf-8' : fPath.endsWith('.js') ? 'application/javascript; charset=utf-8' : fPath.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream; charset=utf-8'); } }));

// favicon 请求直接返回 204，避免 404 日志干扰
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ==================== 健康检查 ====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), time: new Date().toISOString() });
});

// ==================== 配置 ====================
const CONFIG = {
  MIDOU_BASE: 'https://midou310.com/mdsj',
  MOBILE: process.env.MIDOU_MOBILE,
  PASSWORD: process.env.MIDOU_PASSWORD
};

// 启动校验
if (!CONFIG.MOBILE || !CONFIG.PASSWORD) {
  logger.error('启动失败：缺少 MIDOU_MOBILE / MIDOU_PASSWORD 配置');
  process.exit(1);
}

// ==================== 缓存 ====================
const cache = { token: null, tokenExpire: 0, matches: null, matchTime: 0, recommCache: {} };

// ==================== data.json 内存缓存（避免每次 API 都 792KB 磁盘 I/O） ====================
let _dataJsonCache = null;
let _dataJsonCacheTime = 0;
let _dataJsonCacheMtime = 0;
const DATA_JSON_PATH = path.join(__dirname, 'data.json');
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

// trends.json 内存缓存（每 60 秒刷新）
let _trendsCache = null;
let _trendsCacheTime = 0;
const TRENDS_PATH = path.join(__dirname, 'trends.json');
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

// odds_history 按日期缓存（最多缓存 10 个日期文件，LRU 淘汰）
let _oddsCache = {};
const _oddsCacheKeys = [];
const MAX_ODDS_CACHE = 10;
function getOddsHistory(dateStr) {
  if (_oddsCache[dateStr]) return _oddsCache[dateStr];
  const f = path.join(__dirname, 'odds_history', dateStr + '.json');
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

// ==================== 登录 ====================
async function login() {
  const now = Date.now();
  if (cache.token && cache.tokenExpire > now) return cache.token;
  const res = await get(`${CONFIG.MIDOU_BASE}/gduser/login.do`, { mobile: CONFIG.MOBILE, password: CONFIG.PASSWORD });
  if (res.code === 1) {
    cache.token = res.data.token;
    cache.tokenExpire = now + 3600000;
    logger.info('登录成功, token: ' + cache.token.slice(0, 16) + '...');
    return cache.token;
  }
  throw new Error('登录失败: ' + (res.msg || '未知'));
}

// ==================== 获取比赛列表 ====================
async function fetchMatches() {
  const token = await login();
  const timestamp = Date.now();
  const res = await get(`${CONFIG.MIDOU_BASE}/score/footballDataList.do`,
    { time: timestamp, order: 'status desc, start_datetime asc, data_id asc' },
    { Cookie: `token=${token}` }
  );
  if (res.code !== 1) throw new Error('获取比赛列表失败: ' + (res.msg || ''));
  return (res.data || []).map(m => ({
    matchId: String(m.matchId), num: m.num || '', homeName: m.homeName || '',
    visitName: m.visitName || '', leagueName: m.leagueName || '',
    startTime: m.startTime || '', matchStatus: m.matchStatus,
    score: m.score || '', recommNum: m.recommNum || 0,
    date: (res.today || '').slice(0, 10)
  }));
}

// ==================== 获取推荐详情 ====================
async function fetchRecommends(matchId) {
  const token = await login();
  const res = await get(`${CONFIG.MIDOU_BASE}/score/getExpertRecommData.do`,
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

// ==================== 数据库降级 ====================
async function dbMatchList() {
  const today = localDate();
  const matches = database.getMatchesByDate(today);
  if (matches && matches.length > 0) return matches;
  return database.getAllMatches() || [];
}

async function dbRecommends(matchId) {
  const result = database.getRecommendsByMatchId(matchId);
  return result || [];
}

// ==================== 确保比赛和推荐数据 ====================
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

// ==================== API 容错包装 ====================
async function safeApiCall(fn, fallbackFn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn('实时数据获取失败，已降级: ' + err.message);
    if (fallbackFn) return await fallbackFn();
    throw err;
  }
}

// ==================== API 路由 ====================
app.post('/api', async (req, res) => {
  const { action, data: wrappedData = {} } = req.body;
  // 前端传参格式兼容: {action, date, days} 和 {action, data: {date, days}} 都支持
  const data = Object.assign({}, wrappedData, req.body);
  logger.info(`API: ${action} ${JSON.stringify(data).slice(0, 100)}`);
  try {
    switch (action) {
      case 'week-dates': {
        // 返回可用的竞彩周日期列表（从data.json读取全量历史日期）
        try {
          const fs = require('fs');
          const path = require('path');
          const dataFile = getDataJson();
          const mMap = dataFile.m || {};
          const seen = {}, list = [];
          Object.keys(mMap).forEach(k => {
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
          list.sort((a, b) => a.matchDate > b.matchDate ? 1 : -1);
          return res.json({ code: 1, data: list });
        } catch (e) {
          return res.json({ code: 1, data: [] });
        }
      }

      case 'match-list': {
        // 从 data.json 读取比赛列表（支持历史日期切换）
        try {
          const fs = require('fs');
          const path = require('path');
          const dateStr = data.matchDate
            ? (new Date().getFullYear() + '-' + data.matchDate)
            : (data.date || latestDataDate());

          const dataFile = getDataJson();
          const mMap = dataFile.m || {};

          // 读取 500.com 赔率数据获取单关标识（使用缓存）
          const oddsMap = getOddsHistory(dateStr) || {};

          // 读取功守道缓存，判断哪些比赛有统计数据
          let gsCacheMap = {};
          try {
            const gsCachePath = path.join(__dirname, 'gongshoudao', 'cache.json');
            if (fs.existsSync(gsCachePath)) {
              const gsCache = JSON.parse(fs.readFileSync(gsCachePath, 'utf8'));
              gsCacheMap = gsCache['_global'] || {};
            }
          } catch (e) {
            // 功守道缓存不可用，所有比赛都不显示标签
          }

          const list = [];
          Object.keys(mMap).forEach(k => {
            const m = mMap[k];
            if (!m) return;
            const md = (m.date || '').slice(0, 10);
            if (md !== dateStr) return;
            // 补充单关标识
            const fiveOdds = oddsMap[m.num || ''];
            const isSingleGame = fiveOdds && fiveOdds.isSingleGame === true;
            // 检查功守道数据是否可用
            const hasGS = !!(gsCacheMap[k] && gsCacheMap[k].attackPattern);
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
                async () => []
              );
              const filtered = liveMatches.filter(m => (m.date || '').slice(0, 10) === today);
              return res.json({ code: 1, data: filtered });
            }
          }

          return res.json({ code: 1, data: list });
        } catch (e) {
          return res.json({ code: 1, data: [] });
        }
      }

      case 'recommend-trend': {
        const { matchId } = data;
        if (!matchId) return res.json({ code: 0, msg: '缺少 matchId' });

        // 获取推荐：先尝试实时API，失败则回退到 data.json
        var recomms = [];
        try {
          recomms = await ensureRecommends(matchId);
        } catch (e) {
          logger.warn('实时推荐获取失败，回退到 data.json: ' + e.message);
          try {
            const fs = require('fs');
            const dataFile = getDataJson();
            const rMap = dataFile.r || {};
            const raw = rMap['m_' + matchId] || rMap[String(matchId)] || [];
            recomms = raw.map(function(x) {
              return {
                type: x.t || x.type,
                num: x.n || x.num,
                result: x.rs !== undefined ? x.rs : (x.result !== undefined ? x.result : null)
              };
            });
          } catch (e2) {
            logger.warn('data.json 回退也失败: ' + e2.message);
          }
        }

        // 从 trends.json 读取真实趋势快照（period_daemon 每20分钟写入，使用内存缓存）
        var timeLabels = [], series = [];
        try {
          var trends = getTrendsJson();
          if (trends && Object.keys(trends).length > 0) {
            var key = 'm_' + matchId;
            var snaps = (trends[key] || []);
            if (snaps.length > 0) {
              timeLabels = snaps.map(function(s) { return s.t; });
              var allTypes = {};
              snaps.forEach(function(s) { Object.keys(s).forEach(function(k) { if (k !== 't' && k !== 'ts') allTypes[k] = true; }); });
              Object.keys(allTypes).forEach(function(type) {
                series.push({
                  name: type, type: 'line', smooth: true,
                  data: snaps.map(function(s) { return s[type] || 0; })
                });
              });
            }
          }
        } catch(e) { logger.warn('读取趋势快照失败: ' + e.message); }

        // 如果没有历史快照，用当前值生成单点趋势
        if (series.length === 0 && recomms.length > 0) {
          var now = new Date();
          var t = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
          timeLabels = [t];
          series = recomms.map(function(r) {
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
          matches = Object.values(mMap).filter(m => m && m.matchId);
        } catch {}
        // 兜底：实时 API
        if (matches.length === 0) {
          matches = await ensureData();
        }

        // 日期筛选：默认最新有数据日期，支持指定日期
        const requestDate = data.date || latestDataDate();
        matches = matches.filter(m => m.date === requestDate);

        // 获取推荐（缓存 rMap，避免每次读磁盘）
        function getRecs(matchId) {
          if (cachedRMap) {
            const raw = cachedRMap['m_' + matchId] || cachedRMap[String(matchId)] || [];
            return raw.map(x => ({
              type: x.t || x.type,
              num: x.n || x.num,
              result: x.rs !== undefined ? x.rs : (x.result !== undefined ? x.result : null)
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
          if (['胜','平','负'].includes(type)) return '胜平负';
          return '其他';
        }

        // ====== 收集所有方向及专家数 ======
        const dirStats = {}; // { type: { totalNum: number, matches: [] } }
        for (const m of matches) {
          let recomms;
          try { recomms = getRecs(m.matchId); } catch { continue; }
          for (const r of recomms) {
            if (!r.type || !r.num) continue;
            if (!dirStats[r.type]) dirStats[r.type] = { totalNum: 0, matches: [] };
            dirStats[r.type].totalNum += r.num;
            dirStats[r.type].matches.push({ matchId: m.matchId, homeName: m.homeName, visitName: m.visitName, leagueName: m.leagueName, num: m.num, date: m.date, direction: r.type, expertCount: r.num, matchStatus: m.matchStatus, isHit: r.result === 1 });
          }
        }

        // ====== 构建分类结构 ======
        const categories = {};
        for (const [type, stats] of Object.entries(dirStats)) {
          const cat = classifyType(type);
          if (!categories[cat]) categories[cat] = { directions: [] };
          categories[cat].directions.push({
            name: type,
            totalExpertCount: stats.totalNum
          });
        }

        // 每个分类内的方向按专家数从高到低排序
        for (const cat of Object.values(categories)) {
          cat.directions.sort((a, b) => b.totalExpertCount - a.totalExpertCount);
        }

        // 分类排序：保持预期顺序
        const CAT_ORDER = ['胜平负','半全场','进球数','双选','让球'];
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
          const catDirs = new Set(categories[filterCategory].directions.map(d => d.name));
          for (const m of matches) {
            let recomms;
            try { recomms = getRecs(m.matchId); } catch { continue; }
            const filtered = recomms.filter(r => catDirs.has(r.type) && r.num > 0);
            if (filtered.length > 0) {
              const maxDir = filtered.reduce((a, b) => b.num > a.num ? b : a);
              list.push({ matchId: m.matchId, homeName: m.homeName, visitName: m.visitName, leagueName: m.leagueName, num: m.num, date: m.date, direction: maxDir.type, expertCount: maxDir.num, matchStatus: m.matchStatus, isHit: maxDir.result === 1 });
            }
          }
        } else {
          // 综合排名：取每场比赛推荐专家最多的方向
          for (const m of matches) {
            let recomms;
            try { recomms = getRecs(m.matchId); } catch { continue; }
            const maxDir = recomms.reduce((a, b) => (b.num || 0) > ((a && a.num) || 0) ? b : a, null);
            if (maxDir && maxDir.num > 0) list.push({ matchId: m.matchId, homeName: m.homeName, visitName: m.visitName, leagueName: m.leagueName, num: m.num, date: m.date, direction: maxDir.type, expertCount: maxDir.num, matchStatus: m.matchStatus, isHit: maxDir.result === 1 });
          }
        }

        list.sort((a, b) => b.expertCount - a.expertCount);
        const ranking = list.map((item, i) => ({ rank: i + 1, ...item }));
        const topExpertCount = ranking.length > 0 ? ranking[0].expertCount : 0;

        return res.json({
          code: 1,
          data: {
            date: requestDate,
            filterCategory,
            filterDirection,
            totalMatches: ranking.length,
            topExpertCount,
            ranking,
            categories: sortedCategories
          }
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
          recommends = raw.map(function(x) {
            return {
              type: x.t || x.type,
              num: x.n || x.num,
              result: x.rs !== undefined ? x.rs : (x.result !== undefined ? x.result : null)
            };
          });
        } catch {}
        // 兜底：尝试实时数据（仅 match，无历史推荐）
        if (!match) {
          try {
            const matches = await ensureData();
            match = matches.find(m => m.matchId === matchId) || null;
          } catch {}
        }
        return res.json({ code: 1, data: { match: match || {}, recommends: recommends } });
      }

      case 'hit-rate-stats': {
        const days = parseInt(data.days) || 30;
        try {
          const fs = require('fs');
          const path = require('path');

          // Load from data.json
          const dataFile = getDataJson();
          const mMap = dataFile.m || {};
          const rMap = dataFile.r || {};

          function normalizeRecs(recs) {
            return (recs || []).map(function(x) {
              var raw = x.rs !== undefined ? x.rs : (x.result !== undefined ? x.result : null);
              var r = (raw === 0 || raw === 1) ? raw : null;
              return { type: x.t || x.type, num: x.n || x.num, result: r };
            });
          }

          // 单次遍历：同时收集 allRecs、按方向聚合、按日期-方向聚合
          var cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - days);
          var cutoffStr = cutoff.toISOString().slice(0, 10);

          var dirMap = {};
          var dateDirMap = {};
          var allRecsCount = 0;

          Object.keys(rMap).forEach(function(k) {
            var mid = k.replace(/^m_/, '');
            var match = mMap['m_' + mid] || mMap[mid];
            var matchDate = match ? (match.date || '').slice(0, 10) : '';
            if (!matchDate || matchDate < cutoffStr) return;
            var recs = normalizeRecs(rMap[k] || []);
            recs.forEach(function(r) {
              if (!r.type || r.result === null || r.result === undefined) return;
              allRecsCount++;
              // 按方向聚合
              if (!dirMap[r.type]) dirMap[r.type] = { total: 0, hits: 0, misses: 0 };
              dirMap[r.type].total++;
              if (r.result === 1) dirMap[r.type].hits++;
              else dirMap[r.type].misses++;
              // 按日期-方向聚合
              if (!dateDirMap[matchDate]) dateDirMap[matchDate] = {};
              if (!dateDirMap[matchDate][r.type]) dateDirMap[matchDate][r.type] = { total: 0, hits: 0 };
              dateDirMap[matchDate][r.type].total++;
              if (r.result === 1) dateDirMap[matchDate][r.type].hits++;
            });
          });

          if (allRecsCount === 0) {
            return res.json({ code: 0, msg: '命中率统计需要历史数据积累。请先运行爬虫抓取历史数据：node scraper.js' });
          }

          var directionStats = Object.keys(dirMap).map(function(d) {
            var s = dirMap[d];
            return {
              direction: d,
              totalRecommends: s.total,
              hitCount: s.hits,
              missCount: s.misses,
              hitRate: s.total > 0 ? Math.round(s.hits / s.total * 1000) / 10 : 0
            };
          }).sort(function(a, b) { return b.hitCount - a.hitCount; });

          // 综合排名命中率：
          //  每天综合排名前5场比赛，≥3场命中则当天"合格"
          //  统计近60个有效比赛日(≥5场比赛)的合格率
          //  当天不足5场则往前推，凑满60天
          var matchDayTop = {}; // matchId -> { date, expertCount, isHit }
          Object.keys(rMap).forEach(function(k) {
            var mid = k.replace(/^m_/, '');
            var match = mMap['m_' + mid] || mMap[mid];
            var matchDate = match ? (match.date || '').slice(0, 10) : '';
            if (!matchDate) return;
            var recs = normalizeRecs(rMap[k] || []);
            if (recs.length === 0) return;
            // 取该场比赛综合排名第一的方向(max expertCount)
            recs.sort(function(a, b) { return (b.num || 0) - (a.num || 0); });
            var top = recs[0];
            var hasResult = top.result !== null && top.result !== undefined;
            if (!hasResult) return;
            matchDayTop[mid] = {
              date: matchDate,
              expertCount: top.num || 0,
              isHit: top.result === 1
            };
          });

          // 按日期分组：每天取 top5 比赛
          var dayTop5 = {}; // date -> [{ matchId, expertCount, isHit }]
          Object.keys(matchDayTop).forEach(function(mid) {
            var item = matchDayTop[mid];
            if (!dayTop5[item.date]) dayTop5[item.date] = [];
            dayTop5[item.date].push({ matchId: mid, expertCount: item.expertCount, isHit: item.isHit });
          });
          Object.keys(dayTop5).forEach(function(d) {
            dayTop5[d].sort(function(a, b) { return b.expertCount - a.expertCount; });
            dayTop5[d] = dayTop5[d].slice(0, 5);
          });

          // 取近 60 个有效比赛日(≥5场)，不足则往前推
          var validDates = Object.keys(dayTop5).filter(function(d) {
            return d <= localDate() && dayTop5[d].length >= 1;
          }).sort().reverse();
          var targetDays = days || 60;
          var qualifiedDays = 0, participatingDays = 0;
          for (var di = 0; di < validDates.length && participatingDays < targetDays; di++) {
            var dd = validDates[di];
            var top5 = dayTop5[dd];
            if (top5.length < 3) continue; // 不足3场无法达标，跳过
            participatingDays++;
            var dayHits = top5.filter(function(x) { return x.isHit; }).length;
            if (dayHits >= 3) qualifiedDays++;
          }
          var top3HitRate = participatingDays > 0
            ? Math.round(qualifiedDays / participatingDays * 1000) / 10
            : 0;

          var dailyTrend = Object.keys(dateDirMap).sort().map(function(d) {
            var dirs = [];
            Object.keys(dateDirMap[d]).forEach(function(dir) {
              var s = dateDirMap[d][dir];
              dirs.push({
                direction: dir,
                hitRate: s.total > 0 ? Math.round(s.hits / s.total * 1000) / 10 : 0
              });
            });
            return { date: d, directions: dirs };
          });

          return res.json({
            code: 1,
            data: {
              totalDays: days,
              directionStats: directionStats,
              dailyTrend: dailyTrend,
              top3HitRate: top3HitRate
            }
          });
        } catch (dbErr) {
          return res.json({ code: 0, msg: '命中率统计失败: ' + dbErr.message });
        }
      }

      case 'crawl-history': {
        const crawler = require('./scraper');
        // 不等待完成，后台执行
        res.json({ code: 1, data: { message: '历史数据抓取已启动，请查看控制台日志' } });
        crawler.main().catch(err => console.error('[crawl-history] 错误:', err));
        return;
      }

      case 'crawl-status': {
        const crawled = database.getCrawledDates();
        const allMatches = database.getAllMatches();
        const stats = {
          totalCrawledDates: crawled.length,
          crawledDates: crawled,
          totalMatches: allMatches.length,
          lastUpdate: allMatches.length > 0 ? allMatches[0].updatedAt : null
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
            return recs.map(function(x) {
              return {
                type: x.t || x.type,
                num: x.n || x.num,
                result: x.rs !== undefined ? x.rs : (x.result !== undefined ? x.result : null)
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
          var allItems = [];
          Object.keys(mMap).forEach(function(k) {
            var m = mMap[k];
            if (!m || !m.matchId || !m.date) return;
            var date = m.date.slice(0, 10);
            var raw = rMap['m_' + m.matchId] || rMap[String(m.matchId)] || [];
            var recs = norm(raw);
            recs.forEach(function(r) {
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
                  dirType: classifyDir(r.type)
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
            allItems = allItems.filter(function(x) { return x.date >= cutoffStr; });
          }

          // Filter: league
          if (league) {
            allItems = allItems.filter(function(x) { return x.leagueName === league; });
          }

          // Filter: directionType
          // "综合排名" means: for each match, take the top expertCount direction regardless of type
          if (directionType === '综合排名') {
            // sort by matchId+expertCount desc, pick top per match
            var matchTop = {};
            allItems.forEach(function(x) {
              if (!matchTop[x.matchId] || matchTop[x.matchId].expertCount < x.expertCount) {
                matchTop[x.matchId] = x;
              }
            });
            allItems = Object.values(matchTop);
          } else if (directionType) {
            allItems = allItems.filter(function(x) { return x.dirType === directionType; });
          }

          // Filter: direction
          if (direction) {
            allItems = allItems.filter(function(x) { return x.direction === direction; });
          }

          // Filter: rankTop (per match)
          var isPerMatch = (rankType === '每场' && rankTop > 0);
          var isDaily = (rankType === '每天' && rankTop > 0);
          if (isPerMatch) {
            // For each match, only keep top N directions by expertCount
            var matchGroups = {};
            allItems.forEach(function(x) {
              if (!matchGroups[x.matchId]) matchGroups[x.matchId] = [];
              matchGroups[x.matchId].push(x);
            });
            allItems = [];
            Object.keys(matchGroups).forEach(function(mid) {
              var items = matchGroups[mid];
              items.sort(function(a, b) { return b.expertCount - a.expertCount; });
              // Get the max expertCount to find "tied for first"
              var maxCount = items[0].expertCount;
              var kept = items.filter(function(x) { return x.expertCount === maxCount; }).slice(0, rankTop);
              allItems = allItems.concat(kept);
            });
          } else if (isDaily) {
            // For each day, find the global max expertCount, then filter per match
            var dayMax = {};
            allItems.forEach(function(x) {
              if (!dayMax[x.date] || dayMax[x.date] < x.expertCount) dayMax[x.date] = x.expertCount;
            });
            allItems = allItems.filter(function(x) {
              return x.expertCount === dayMax[x.date];
            });
            // Then pick top N per match
            var matchGroups = {};
            allItems.forEach(function(x) {
              if (!matchGroups[x.matchId]) matchGroups[x.matchId] = [];
              matchGroups[x.matchId].push(x);
            });
            allItems = [];
            Object.keys(matchGroups).forEach(function(mid) {
              var items = matchGroups[mid];
              items.sort(function(a, b) { return b.expertCount - a.expertCount; });
              allItems = allItems.concat(items.slice(0, rankTop));
            });
          }

          // Calculate stats
          var hitCount = 0, totalCount = allItems.length;
          allItems.forEach(function(x) { if (x.result === 1) hitCount++; });
          var hitRate = totalCount > 0 ? Math.round(hitCount / totalCount * 1000) / 10 : 0;

          // Daily results
          var dailyMap = {};
          allItems.forEach(function(x) {
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
          var dailyResults = Object.keys(dailyMap).sort().reverse().slice(0, 15).map(function(d) {
            var dm = dailyMap[d];
            return {
              date: d.replace(/-/g, '/'),
              totalMatch: dm.totalMatch,
              hitMatch: dm.hitMatch,
              hitRate: dm.totalMatch > 0 ? Math.round(dm.hitMatch / dm.totalMatch * 1000) / 10 : 0
            };
          });

          // Condition summary
          var condParts = [];
          if (league) condParts.push(league);
          if (timeRange === '30') condParts.push('近30天');
          else if (timeRange === '60') condParts.push('近60天');
          else if (timeRange === '90') condParts.push('近90天');
          if (direction) condParts.push(direction);
          else if (directionType && directionType !== '综合排名') condParts.push(directionType);
          else if (directionType === '综合排名') condParts.push('综合排名');
          if (isPerMatch) condParts.push('每场前' + rankTop);
          if (isDaily) condParts.push('每天前' + rankTop);
          var conditionSummary = condParts.length > 0 ? condParts.join(' | ') : '全部条件';

          return res.json({
            code: 1,
            data: {
              hitCount: hitCount,
              totalCount: totalCount,
              hitRate: hitRate,
              conditionSummary: conditionSummary,
              detailList: allItems,
              dailyResults: dailyResults
            }
          });
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
          Object.values(mMap).forEach(function(m) {
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
        backfill.main()
          .then(r => { console.log('[api] backfill done:', JSON.stringify(r)); })
          .catch(err => console.error('[api] backfill error:', err));
        return res.json({
          code: 1,
          data: {
            message: '结果回填已启动，正在后台执行。几分钟后完赛推荐命中数据将更新。',
            hint: '可稍后重新查询筛选结果。也可运行: node backfill_results.js'
          }
        });
      }

      case 'backfill-status': {
        const stale = database.getStaleRecommendations();
        const matchCount = new Set(stale.map(r => r.matchId)).size;
        return res.json({
          code: 1,
          data: { staleCount: stale.length, staleMatches: matchCount, needBackfill: stale.length > 0 }
        });
      }

      // ========== AI 预测 ==========
      case 'ai-predict': {
        const mid = data.matchId;
        if (!mid) return res.json({ code: 0, msg: '缺少 matchId' });
        try {
          const fs = require('fs');
          const path = require('path');

          // 1) 从 ai_cache.json 文件读取缓存
          var cacheFile = path.join(__dirname, 'ai_cache.json');
          var cache = {};
          if (fs.existsSync(cacheFile)) {
            try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) {}
          }

          var cachedEntry = cache[mid];

          // 2) 检查双模型缓存是否齐全
          var hasDS = cachedEntry && cachedEntry.sources && cachedEntry.sources.deepseek && cachedEntry.sources.deepseek.content;
          var hasDB = cachedEntry && cachedEntry.sources && cachedEntry.sources.doubao && cachedEntry.sources.doubao.content;

          if (cachedEntry && cachedEntry.content && hasDS && hasDB) {
            // 双模型齐全，直接返回合并结果
            return res.json({ code: 1, data: {
              matchId: mid,
              content: cachedEntry.content,
              confidence: cachedEntry.confidence || 0,
              fromCache: true,
              dualModel: true,
              merged: cachedEntry.merged || false
            }});
          }

          // 3) 兼容旧缓存（无 sources 的旧格式，仅有 content）
          if (cachedEntry && cachedEntry.content && !cachedEntry.sources) {
            return res.json({ code: 1, data: {
              matchId: mid,
              content: cachedEntry.content,
              confidence: cachedEntry.confidence || 0,
              fromCache: true,
              legacy: true
            }});
          }

          // 4) 如果已有 single-source 缓存（上一个模型先完成了），直接返回部分结果
          if (cachedEntry && cachedEntry.content && cachedEntry.sources && (hasDS || hasDB) && !(hasDS && hasDB)) {
            return res.json({ code: 1, data: {
              matchId: mid,
              content: cachedEntry.content,
              confidence: cachedEntry.confidence || 0,
              fromCache: true,
              partial: true,
              pendingMerge: true,
              readySource: hasDS ? 'deepseek' : 'doubao'
            }});
          }

          // 5) 从 data.json 获取比赛信息
          var matchInfo = {};
          try {
            var dataFile = getDataJson();
            var mMap = dataFile.m || {};
            var m = mMap['m_' + mid] || mMap[mid];
            if (m) {
              matchInfo = { matchId: mid, homeName: m.homeName || '', visitName: m.visitName || '', leagueName: m.leagueName || '', date: m.date || '', num: m.num || '' };
            }
          } catch (e) {}

          // 6) 启动模型调用（在 res.json 之前，确保不因 return 丢失）
          deepseek.generateAnalysis(matchInfo).then(function (dsR) {
            var dsC = dsR && dsR.content ? (dsR.content || dsR) : null;
            if (!dsC) { console.log('[ai] DeepSeek 无内容'); return; }
            var conf = dsC.confidence || 70;
            try {
              var cur = {};
              try { cur = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) {}
              var entry = cur[mid] || { sources: {} };
              if (!entry.sources) entry.sources = {};
              entry.sources.deepseek = { content: dsC, confidence: conf, generatedAt: new Date().toISOString() };
              if (entry.sources.doubao) {
                var merged = aiMerger.mergeAnalyses(
                  { content: entry.sources.deepseek.content, confidence: entry.sources.deepseek.confidence || 70 },
                  { content: entry.sources.doubao.content, confidence: entry.sources.doubao.confidence || 70 },
                  matchInfo
                );
                entry.content = merged.content; entry.confidence = merged.confidence; entry.merged = true;
                console.log('[ai] 双模型合并: ' + mid);
              } else {
                entry.content = dsC; entry.confidence = conf;
                console.log('[ai] DS缓存: ' + mid + ' conf=' + conf);
              }
              entry.updatedAt = new Date().toISOString();
              cur[mid] = entry;
              fs.writeFileSync(cacheFile, JSON.stringify(cur));
            } catch (e) { console.error('[ai] cache err:', e.message); }
          }).catch(function (e) { console.error('[ai] DS err:', e.message); });

          doubao.generateAnalysis(matchInfo).then(function (dbR) {
            var dbC = dbR && dbR.content ? (dbR.content || dbR) : null;
            if (!dbC) { console.log('[ai] 豆包 无内容'); return; }
            var conf = dbC.confidence || 70;
            try {
              var cur = {};
              try { cur = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) {}
              var entry = cur[mid] || { sources: {} };
              if (!entry.sources) entry.sources = {};
              entry.sources.doubao = { content: dbC, confidence: conf, generatedAt: new Date().toISOString() };
              if (entry.sources.deepseek) {
                var merged = aiMerger.mergeAnalyses(
                  { content: entry.sources.deepseek.content, confidence: entry.sources.deepseek.confidence || 70 },
                  { content: entry.sources.doubao.content, confidence: entry.sources.doubao.confidence || 70 },
                  matchInfo
                );
                entry.content = merged.content; entry.confidence = merged.confidence; entry.merged = true;
                console.log('[ai] 双模型合并: ' + mid);
              } else {
                entry.content = dbC; entry.confidence = conf;
                console.log('[ai] DB缓存: ' + mid + ' conf=' + conf);
              }
              entry.updatedAt = new Date().toISOString();
              cur[mid] = entry;
              fs.writeFileSync(cacheFile, JSON.stringify(cur));
            } catch (e) { console.error('[ai] cache err:', e.message); }
          }).catch(function (e) { console.error('[ai] DB err:', e.message); });

          // 7) 返回 pending
          var estimatedWait = getEstimatedWaitTime();
          res.json({
            code: 0,
            msg: '分析生成中，DeepSeek + 豆包 双模型交叉验证...',
            pending: true,
            estimatedWait: estimatedWait,
            dualModel: true
          });

          return;
        } catch (e) { return res.json({ code: 0, msg: '查询失败: ' + e.message }); }
      }
      case 'ai-predict-status': {
        try {
          const fs = require('fs');
          const path = require('path');
          const today = localDate();
          var totalMatches = 0, finishedMatches = 0;
          try {
            var dataFile = getDataJson();
            var mMap = dataFile.m || {};
            Object.values(mMap).forEach(function(m) {
              if (!m || !m.date) return;
              if ((m.date || '').slice(0, 10) === today) {
                totalMatches++;
                if (m.matchStatus >= 2) finishedMatches++;
              }
            });
          } catch (e) {}
          return res.json({ code: 1, data: {
            todayDate: today,
            totalMatches: totalMatches,
            finishedMatches: finishedMatches,
            unfinishedMatches: totalMatches - finishedMatches,
            canShowCards: (totalMatches - finishedMatches) > 0
          }});
        } catch (e) { return res.json({ code: 0, msg: e.message }); }
      }
      // ========== 攻守道量化 ==========
      case 'gongshoudao': {
        const mid = data.matchId;
        if (!mid) return res.json({ code: 0, msg: '缺少 matchId' });
        try {
          // 优先从功守道引擎缓存读取
          let gsResult = null;
          try {
            const gsEngine = require('./gongshoudao/index');
            gsResult = await gsEngine.getMatchResult(mid);
          } catch (gsErr) {
            logger.warn('[gongshoudao] 引擎异常: ' + gsErr.message);
          }

          if (gsResult) {
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
            suggestion: '统计数据暂未就绪。请使用AI深度解析功能获取实时分析。'
          };
          return res.json({ code: 1, data: gs, fallback: true });
        } catch (e) { return res.json({ code: 0, msg: '查询失败: ' + e.message }); }
      }
      case 'ai-batch-generate': {
        const daemon = require('./ai_daemon'); daemon.dailyBatch();
        return res.json({ code: 1, data: { message: 'AI批量生成已启动' } });
      }

      // ========== 赔率查询 ==========
      case 'match-odds': {
        const { matchId } = data;
        if (!matchId) return res.json({ code: 0, msg: '缺少 matchId' });
        // 从500.com缓存获取赔率，无数据时返回null
        const m = dataModule.getMatchById ? dataModule.getMatchById(matchId) : null;
        const num = m ? m.num : '';
        const odds500Cache = global.odds500Cache || {};
        const fiveOdds = odds500Cache[num];
        const odds = fiveOdds ? {
          spf: fiveOdds.spf || null,
          rqspf: fiveOdds.rqspf || null,
          totalGoals: fiveOdds.totalGoals || null,
        } : null;
        return res.json({ code: 1, data: { matchId, odds } });
      }

      // ========== 今日方案列表 ==========
      case 'plan-list': {
        try {
          const dateStr = data.date || latestDataDate();
          const fs = require('fs');
          const path = require('path');

          // 1) 从 data.json 加载比赛和推荐
          const dataFile = getDataJson();
          const mMap = dataFile.m || {};
          const rMap = dataFile.r || {};
          const mList = [];
          Object.keys(mMap).forEach(k => {
            const m = mMap[k];
            if (m && (m.date || '').slice(0, 10) === dateStr) mList.push(m);
          });

          // 2) 工具函数
          function normalizeRecs(recs) {
            return (recs || []).map(function(x) {
              var raw = x.rs !== undefined ? x.rs : (x.result !== undefined ? x.result : null);
              var r = (raw === 0 || raw === 1) ? raw : null;
              return { type: x.t || x.type, num: x.n || x.num, result: r };
            });
          }
          function loadOddsFromFile(date, num) {
            const odds = getOddsHistory(date);
            return odds ? (odds[num] || null) : null;
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
              odds: loadOddsFromFile(dateStr, num)
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
                rqspf: od.rqspf ? { home: od.rqspf.home, draw: od.rqspf.draw, away: od.rqspf.away, handicap: od.rqspf.handicap } : null,
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
              nums.forEach(n => {
                const v = n.replace(/球/g, '').trim();
                if (tg[v] !== undefined) vals.push(tg[v]);
              });
              return vals;
            }
            if (direction.indexOf('、') >= 0 || direction.indexOf(',') >= 0) {
              const parts = direction.split(/[、,]/);
              parts.forEach(pd => {
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
            if (direction === '胜平' && oddsObj.spf) { vals.push(oddsObj.spf.home); vals.push(oddsObj.spf.draw); return vals; }
            if (direction === '平负' && oddsObj.spf) { vals.push(oddsObj.spf.draw); vals.push(oddsObj.spf.away); return vals; }
            if (direction === '让负' && oddsObj.rqspf) vals.push(oddsObj.rqspf.away);
            else if (direction === '让胜' && oddsObj.rqspf) vals.push(oddsObj.rqspf.home);
            else if (direction === '胜' && oddsObj.spf) vals.push(oddsObj.spf.home);
            else if (direction === '负' && oddsObj.spf) vals.push(oddsObj.spf.away);
            return vals;
          }

          function findBestMatchForDirection(directions, excludeIds) {
            let bestMatch = null, bestCount = 0;
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
              if (total > bestCount) { bestCount = total; bestMatch = m; }
            }
            return bestMatch;
          }

          function buildMatchObj(m, direction) {
            const recs = findRecommends(m.matchId);
            let expertCount = 0, isMatchWon = null, isMatchLose = null;
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
              return parts.some(p => p.trim() === sd);
            }

            subDirs.forEach(subDir => {
              const sd = subDir.trim();
              let found = null;
              // 1) 精确匹配
              for (const r of recs) { if (r.type === sd) { found = r; break; } }
              // 2) 组合类型中包含子方向（如"让胜、让平"包含"让平"）
              if (!found) {
                for (const r of recs) { if (recContains(r.type, sd)) { found = r; break; } }
              }
              // 3) 总进球回退（如"3球"→"总进球-3"）
              if (!found && sd.indexOf('球') >= 0) {
                const num = sd.replace(/球/g, '');
                for (const r of recs) { if (r.type === ('总进球-' + num)) { found = r; break; } }
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
                subResults.forEach(sr => { sr.result = 0; });
              } else if (combinedRes === 1 && m.score) {
                // 组合命中，根据实际总进球数确定哪个子方向命中
                const scoreParts = String(m.score).split(':');
                const totalGoals = parseInt(scoreParts[0]) + parseInt(scoreParts[1]);
                if (!isNaN(totalGoals)) {
                  subResults.forEach(sr => {
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

            let anyWon = false, anyLose = false, anyUnknown = false;
            // 总进球双选：用子方向结果判断（避免matchedRecs含错误匹配）
            if (direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0 && subResults.length >= 2) {
              let hasKnown = false;
              for (const sr of subResults) {
                if (sr.result === 1) { anyWon = true; hasKnown = true; }
                else if (sr.result === 0) { anyLose = true; hasKnown = true; }
                else anyUnknown = true;
              }
              if (!hasKnown) anyWon = false;
            } else {
              matchedRecs.forEach(r => {
                if (r.result === 1) anyWon = true;
                else if (r.result === 0) anyLose = true;
                else anyUnknown = true;
              });
            }
            if (!anyUnknown) {
              isMatchWon = anyWon;
              isMatchLose = !anyWon && anyLose;
            }

            return {
              matchId: m.matchId, homeName: m.homeName, visitName: m.visitName,
              leagueName: m.leagueName, matchNum: m.num || '', startTime: m.startTime || '',
              matchStatus: m.matchStatus || 0,
              direction: direction, expertCount: expertCount,
              isMatchWon: isMatchWon, isMatchLose: isMatchLose,
              subResults: subResults,
              odds: getMatchOdds(m, direction)
            };
          }

          function calcEffectiveOdds(direction, match) {
            const oddsObj = match.odds || {};
            const subOdds = extractSubOdds(oddsObj, direction);
            if (subOdds.length === 0) return null;
            const N = subOdds.length;
            if (N === 1) return subOdds[0];
            return subOdds.reduce((a, b) => a + b, 0) / (2 * N);
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
            plans.push({
              planId: 'plan_' + dateStr + '_' + planSuffix, planName: planName,
              matches: [aObj, bObj],
              amount: 1000, playType: '混合投注', matchCount: 2, passType: '2串1',
              betCount: betCount, ticketCount: ticketCount, multiplier: multiplier || 25,
              maxPrize: e1 && e2 ? Math.round(1000 * e1 * e2) : Math.round(1000 * 2.5)
            });
          }

          push2MatchPlan('方案一', '1', m1a, '平、让平', m1b, '让负', 250, 10);
          push2MatchPlan('方案二', '2', m2a, '总进球-2、3球', m2b, '让负', 250, 10);
          push2MatchPlan('方案三', '3', m3a, '胜', m3b, '胜', 500, 10, 50);

          // 方案四～六：仅在 ≥15 场时生成
          if (matchCount >= 15) {
            const m4a = findBestMatchForDirection(['平', '让平']);
            const m4b = findBestMatchForDirection(['胜'], m4a ? [m4a.matchId] : null);
            push2MatchPlan('方案四', '4', m4a, '平、让平', m4b, '胜', 250, 10);

            const m5a = findBestMatchForDirection(['平', '让平']);
            const m5b = findBestMatchForDirection(['总进球-2、3球'], m5a ? [m5a.matchId] : null);
            push2MatchPlan('方案五', '5', m5a, '平、让平', m5b, '总进球-2、3球', 125, 5);

            // 方案六：综合排名前5场，2串1+3串1混合过关
            try {
              const top5 = [];
              for (const m of mList) {
                const recs = findRecommends(m.matchId);
                if (recs.length === 0) continue;
                const maxDir = recs.reduce((a, b) => (b.num || 0) > ((a && a.num) || 0) ? b : a, null);
                if (maxDir && maxDir.num > 0) {
                  top5.push({ match: m, direction: maxDir.type, expertCount: maxDir.num });
                }
              }
              top5.sort((a, b) => b.expertCount - a.expertCount);
              const top5Matches = top5.slice(0, 5);
              if (top5Matches.length >= 3) {
                const m6Objs = top5Matches.map(t => buildMatchObj(t.match, t.direction));
                // 按文档规则计算最高奖金：2串1(10注) + 3串1(10注) × 25倍
                const oddsArr = [];
                m6Objs.forEach(mo => {
                  const eo = calcEffectiveOdds(mo.direction, mo);
                  oddsArr.push(eo || 0);
                });
                let total2in1 = 0, total3in1 = 0;
                for (let i = 0; i < oddsArr.length; i++) {
                  for (let j = i + 1; j < oddsArr.length; j++) {
                    if (oddsArr[i] > 0 && oddsArr[j] > 0) {
                      total2in1 += 2 * oddsArr[i] * oddsArr[j];
                    }
                  }
                }
                for (let i = 0; i < oddsArr.length; i++) {
                  for (let j = i + 1; j < oddsArr.length; j++) {
                    for (let k = j + 1; k < oddsArr.length; k++) {
                      if (oddsArr[i] > 0 && oddsArr[j] > 0 && oddsArr[k] > 0) {
                        total3in1 += 2 * oddsArr[i] * oddsArr[j] * oddsArr[k];
                      }
                    }
                  }
                }
                const maxPrize = Math.round((total2in1 + total3in1) * 25);
                // 存储各场有效赔率，供前端计算实际奖金
                m6Objs.forEach((mo, idx) => { mo.effectiveOdds = oddsArr[idx]; });
                plans.push({
                  planId: 'plan_' + dateStr + '_6', planName: '方案六',
                  matches: m6Objs,
                  amount: 1000, playType: '混合投注', matchCount: top5Matches.length, passType: '混合过关',
                  betCount: 20, ticketCount: 1, multiplier: 25,
                  maxPrize: maxPrize > 0 ? maxPrize : Math.round(1000 * 2.5)
                });
              }
            } catch (e6) {}
          }

          // ========== 方案七：单关双选（胜平/平负） ==========
          const singleMatches = mList.filter(m => {
            const md = matchDataMap[m.matchId];
            return md && md.odds && md.odds.isSingleGame === true;
          });
          if (singleMatches.length > 0) {
            let bestM7 = null, bestM7Dir = '', bestM7Count = 0;
            for (const sm of singleMatches) {
              const recs = matchDataMap[sm.matchId].recs;
              for (const r of recs) {
                if ((r.type === '胜平' || r.type === '平负') && r.num > bestM7Count) {
                  bestM7Count = r.num; bestM7 = sm; bestM7Dir = r.type;
                }
              }
            }
            if (bestM7 && bestM7Dir) {
              const m7Obj = buildMatchObj(bestM7, bestM7Dir);
              const eo = calcEffectiveOdds(bestM7Dir, m7Obj);
              plans.push({
                planId: 'plan_' + dateStr + '_7', planName: '方案七',
                matches: [m7Obj], amount: 1000, playType: '单关',
                matchCount: 1, passType: '单关',
                betCount: 250, ticketCount: 10, multiplier: 25,
                maxPrize: eo ? Math.round(1000 * eo) : Math.round(1000 * 2.0)
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

      case 'income-stats': {
        try {
          const planFilter = data.plan || 'all';
          const daysFilter = parseInt(data.days) || 0;
          const AMOUNT = 1000;
          const fs = require('fs');
          const path = require('path');

          function fmtDate2(dd) { return dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0'); }

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
            return (recs || []).map(function(x) {
              var raw = x.rs !== undefined ? x.rs : (x.result !== undefined ? x.result : null);
              var r = (raw === 0 || raw === 1) ? raw : null;
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

          const results = [];
          let totalPlans = 0, totalWon = 0, totalIncome = 0;

          for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const ds = fmtDate2(d);
            const mList = [];
            Object.keys(mMap).forEach(k => {
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
                oddsObj = { spf: od.spf || null, rqspf: od.rqspf || null, totalGoals: od.totalGoals || null, isSingleGame: od.isSingleGame || false };
              }
              matchDataMap[mm.matchId] = {
                match: mm,
                recs: findRecommends(mm.matchId),
                odds: oddsObj
              };
            }

            function findBest(directions, excludeIds) {
              let best = null, bestCount = 0, bestHasOdds = false;
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
                  bestCount = total; best = mm; bestHasOdds = hasOdds;
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
                return parts.some(p => p.trim() === sd);
              }

              let fullMatch = null;
              for (const r of recs) { if (r.type === direction) fullMatch = r; }
              if (fullMatch) {
                matchedRecs.push(fullMatch);
                subResults.push({ direction: direction, result: fullMatch.result !== undefined ? fullMatch.result : null });
              } else {
                const subDirs = direction.split(/[、,]/);
                subDirs.forEach(sd => {
                  const s = sd.trim();
                  let found = null;
                  for (const r of recs) { if (r.type === s) found = r; }
                  if (!found) {
                    for (const r of recs) { if (recContains(r.type, s)) { found = r; break; } }
                  }
                  if (!found && s.indexOf('球') >= 0) {
                    const num = s.replace(/球/g, '');
                    for (const r of recs) { if (r.type === ('总进球-' + num)) found = r; }
                  }
                  if (found) matchedRecs.push(found);
                  subResults.push({ direction: s, result: found ? found.result : null });
                });
              }
              // 总进球双选（如"总进球-2、3球"）：用实际比分拆分子方向命中
              if (direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0 && subResults.length >= 2) {
                const combinedRes = subResults[0].result;
                if (combinedRes === 0) {
                  subResults.forEach(sr => { sr.result = 0; });
                } else if (combinedRes === 1 && match.score) {
                  const scoreParts = String(match.score).split(':');
                  const totalGoals = parseInt(scoreParts[0]) + parseInt(scoreParts[1]);
                  if (!isNaN(totalGoals)) {
                    subResults.forEach(sr => {
                      const goalMatch = sr.direction.match(/(\d+)/);
                      if (goalMatch && parseInt(goalMatch[1]) === totalGoals) sr.result = 1;
                      else sr.result = 0;
                    });
                  }
                }
              }

              let isWon = null, isLose = null;
              // 总进球双选：用子方向结果判断
              if (direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0 && subResults.length >= 2) {
                let hasKnown = false;
                for (const sr of subResults) {
                  if (sr.result === 1) { isWon = true; hasKnown = true; }
                  else if (sr.result === 0 && !isWon) { isLose = true; hasKnown = true; }
                }
                if (!hasKnown) { isWon = null; isLose = null; }
                if (isWon) isLose = false;
              } else if (matchedRecs.length > 0) {
                let anyWon2 = false, anyLose2 = false, anyUnknown2 = false;
                matchedRecs.forEach(r => {
                  if (r.result === 1) anyWon2 = true;
                  else if (r.result === 0) anyLose2 = true;
                  else anyUnknown2 = true;
                });
                if (!anyUnknown2) { isWon = anyWon2; isLose = !anyWon2 && anyLose2; }
              }
              return {
                matchId: match.matchId, homeName: match.homeName, visitName: match.visitName,
                matchNum: match.num || '', direction: direction,
                oddsObj: getOddsObj(match),
                subResults: subResults,
                isWon: isWon, isLose: isLose
              };
            }

            // 方案六综合排名也用预计算数据
            const top5 = [];
            for (const k of Object.keys(matchDataMap)) {
              const mdData = matchDataMap[k];
              const recs6 = mdData.recs;
              if (recs6.length === 0) continue;
              const maxDir = recs6.reduce((a, b) => (b.num || 0) > ((a && a.num) || 0) ? b : a, null);
              if (maxDir && maxDir.num > 0) {
                const mm = mdData.match;
                top5.push({ match: mm, direction: maxDir.type, expertCount: maxDir.num });
              }
            }
            top5.sort((a, b) => b.expertCount - a.expertCount);
            const top5SelTop = top5.slice(0, 5);

            const m1a = findBest(['平', '让平']), m1b = findBest(['让负'], m1a ? [m1a.matchId] : null);
            const m2a = findBest(['总进球-2、3球']), m2b = findBest(['让负'], m2a ? [m2a.matchId] : null);
            const m3a = findBest(['胜']), m3b = findBest(['胜'], m3a ? [m3a.matchId] : null);

            const dayPlans = [];
            if (m1a && m1b) dayPlans.push({ name: 'plan_1', planName: '方案一', matches: [buildMatch(m1a, '平、让平'), buildMatch(m1b, '让负')] });
            if (m2a && m2b) dayPlans.push({ name: 'plan_2', planName: '方案二', matches: [buildMatch(m2a, '总进球-2、3球'), buildMatch(m2b, '让负')] });
            if (m3a && m3b) dayPlans.push({ name: 'plan_3', planName: '方案三', matches: [buildMatch(m3a, '胜'), buildMatch(m3b, '胜')] });

            const dayMatchCount = mList.length;
            if (dayMatchCount >= 15) {
              const m4a = findBest(['平', '让平']);
              const m4b = findBest(['胜'], m4a ? [m4a.matchId] : null);
              if (m4a && m4b) dayPlans.push({ name: 'plan_4', planName: '方案四', matches: [buildMatch(m4a, '平、让平'), buildMatch(m4b, '胜')] });
              const m5a = findBest(['平', '让平']);
              const m5b = findBest(['总进球-2、3球'], m5a ? [m5a.matchId] : null);
              if (m5a && m5b) dayPlans.push({ name: 'plan_5', planName: '方案五', matches: [buildMatch(m5a, '平、让平'), buildMatch(m5b, '总进球-2、3球')] });
              if (top5SelTop.length >= 3) {
                dayPlans.push({ name: 'plan_6', planName: '方案六', matches: top5SelTop.map(t => buildMatch(t.match, t.direction)) });
              }
            }
            // ========== 方案七：单关双选（胜平/平负） ==========
            const singleMatches7 = mList.filter(m => {
              const md = matchDataMap[m.matchId];
              return md && md.odds && md.odds.isSingleGame === true;
            });
            if (singleMatches7.length > 0) {
              let bestM7 = null, bestM7Dir = '', bestM7Count = 0;
              for (const sm of singleMatches7) {
                const recs7 = matchDataMap[sm.matchId] ? matchDataMap[sm.matchId].recs : [];
                for (const r of recs7) {
                  if ((r.type === '胜平' || r.type === '平负') && r.num > bestM7Count) {
                    bestM7Count = r.num; bestM7 = sm; bestM7Dir = r.type;
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

            dayPlans.forEach(pp => {
              if (planFilter !== 'all' && pp.name !== planFilter) return;

              // 方案六特殊处理：≥2场命中即中奖
              const isPlan6 = pp.name === 'plan_6';
              let isWon = false, isLose = false;
              let hitCount6 = 0;
              if (isPlan6) {
                let undetermined6 = false;
                for (const mm of pp.matches) {
                  if (mm.isWon) hitCount6++;
                  else if (!mm.isLose) undetermined6 = true;
                }
                if (undetermined6) return;
                isWon = hitCount6 >= 2;
                isLose = !isWon;
              } else {
                let allWon = true, anyLose = false, anyUnknown = false;
                for (const mm of pp.matches) {
                  if (!mm.isWon) allWon = false;
                  if (mm.isLose) anyLose = true;
                  if (!mm.isWon && !mm.isLose) anyUnknown = true;
                }
                if (anyUnknown) return;
                isWon = allWon;
                isLose = anyLose && !isWon;
              }

              let prize = 0, dayIncome = 0, status = 'unknown';
              if (isWon) {
                if (isPlan6) {
                  // 方案六：计算所有中奖组合
                  const hitOdds = [];
                  for (const mm of pp.matches) {
                    if (mm.isWon) {
                      const subOdds = extractIndividualOdds(mm.oddsObj, mm.direction);
                      if (subOdds.length === 1) hitOdds.push(subOdds[0]);
                      else if (subOdds.length > 1) hitOdds.push(subOdds.reduce((a, b) => a + b, 0) / (2 * subOdds.length));
                      else hitOdds.push(1.5);
                    }
                  }
                  let total2 = 0, total3 = 0;
                  for (let a = 0; a < hitOdds.length; a++) {
                    for (let b = a + 1; b < hitOdds.length; b++) {
                      total2 += 2 * hitOdds[a] * hitOdds[b];
                    }
                  }
                  for (let a = 0; a < hitOdds.length; a++) {
                    for (let b = a + 1; b < hitOdds.length; b++) {
                      for (let c = b + 1; c < hitOdds.length; c++) {
                        total3 += 2 * hitOdds[a] * hitOdds[b] * hitOdds[c];
                      }
                    }
                  }
                  prize = Math.round((total2 + total3) * 25);
                } else {
                  const effectiveOdds = [];
                  let hasAllOdds = true;
                  for (const mm of pp.matches) {
                    const subOdds = extractIndividualOdds(mm.oddsObj, mm.direction);
                    if (subOdds.length === 0) { hasAllOdds = false; continue; }
                    const N = subOdds.length;
                    if (N === 1) effectiveOdds.push(subOdds[0]);
                    else effectiveOdds.push(subOdds.reduce((a, b) => a + b, 0) / (2 * N));
                  }
                  if (hasAllOdds && effectiveOdds.length >= 2) {
                    prize = Math.round(AMOUNT * effectiveOdds[0] * effectiveOdds[1]);
                  } else if (hasAllOdds && effectiveOdds.length === 1) {
                    prize = Math.round(AMOUNT * effectiveOdds[0]);
                  } else {
                    prize = Math.round(AMOUNT * 3);
                  }
                }
                dayIncome = prize - AMOUNT;
                status = 'won'; totalWon++;
              } else if (isLose) {
                dayIncome = -AMOUNT;
                status = 'lose';
              }
              totalPlans++;
              totalIncome += dayIncome;

              results.push({
                date: ds, plan: pp.planName, status: status,
                matches: pp.matches.map(mm => ({
                  matchNum: mm.matchNum, home: mm.homeName, visit: mm.visitName, direction: mm.direction, isWon: mm.isWon, isLose: mm.isLose
                })),
                prize: prize, income: dayIncome
              });
            });
          }

          // Aggregate by date
          const dateMap = {};
          results.forEach(r => {
            if (!dateMap[r.date]) dateMap[r.date] = { won: 0, total: 0, income: 0 };
            dateMap[r.date].total++;
            dateMap[r.date].income += r.income;
            if (r.status === 'won') dateMap[r.date].won++;
          });
          const dayRecords = [];
          Object.keys(dateMap).sort().reverse().forEach(ds => {
            const dr = dateMap[ds];
            dayRecords.push({
              date: ds,
              hitCount: dr.won,
              totalPlans: dr.total,
              hitRate: dr.total > 0 ? Math.round(dr.won / dr.total * 100) : 0,
              income: dr.income
            });
          });

          const winRate = totalPlans > 0 ? Math.round(totalWon / totalPlans * 100) : 0;
          return res.json({ code: 1, data: {
            summary: { totalPlans: totalPlans, totalWon: totalWon, totalIncome: totalIncome, winRate: winRate },
            records: dayRecords
          }});
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

          var matchCount = 0, leagueSet = {}, dirSet = {}, staleCount = 0;
          Object.keys(mMap).forEach(function(k) {
            var m = mMap[k];
            if (!m) return;
            // Count matches with recs that have results
            var raw = rMap['m_' + m.matchId] || rMap[String(m.matchId)] || [];
            var hasResult = raw.some(function(x) { return (x.rs !== undefined ? x.rs : x.result) !== null && (x.rs !== undefined ? x.rs : x.result) !== undefined; });
            if (hasResult) {
              matchCount++;
              if (m.leagueName) leagueSet[m.leagueName] = true;
              raw.forEach(function(x) {
                var t = x.t || x.type;
                if (t) dirSet[t] = true;
              });
            }
            // Count stale (no result)
            var hasStale = raw.some(function(x) { var r = x.rs !== undefined ? x.rs : x.result; return r === null || r === undefined; });
            if (hasStale) staleCount++;
          });

          return res.json({
            code: 1,
            data: {
              matchCount: matchCount,
              leagueCount: Object.keys(leagueSet).length,
              directionCount: Object.keys(dirSet).length,
              leagues: Object.keys(leagueSet).sort(),
              staleCount: staleCount
            }
          });
        } catch (e) {
          return res.json({ code: 0, msg: '获取统计失败: ' + e.message });
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

// ==================== 前一天推荐命中信息回填 ====================
let lastBackfillDate = '';

async function backfillPreviousDayResults() {
  try {
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    
    if (lastBackfillDate === todayStr) return;
    
    // 按日期检查近7天（不依赖matchStatus）
    database.initDatabase();
    const db = database.getDatabase();
    if (!db || !db.prepare) return; // 数据库不可用时跳过
    const sevenAgo = new Date(today);
    sevenAgo.setDate(sevenAgo.getDate() - 7);
    const minDate = sevenAgo.getFullYear() + '-' + String(sevenAgo.getMonth() + 1).padStart(2, '0') + '-' + String(sevenAgo.getDate()).padStart(2, '0');
    
    const row = db.prepare(`SELECT COUNT(DISTINCT r.matchId) as cnt FROM recommends r JOIN matches m ON r.matchId=m.matchId WHERE m.date >= ? AND m.date < ? AND r.result IS NULL`).get(minDate, todayStr);
    if (!row || row.cnt === 0) return;
    
    logger.info('[backfill] 近7天有' + row.cnt + '场比赛结果不全, 开始回填...');
    
    const stale = db.prepare(`
      SELECT DISTINCT r.matchId, m.homeName, m.visitName
      FROM recommends r JOIN matches m ON r.matchId=m.matchId
      WHERE m.date >= ? AND m.date < ? AND r.result IS NULL
      LIMIT 50
    `).all(minDate, todayStr);
    
    if (!stale || stale.length === 0) return;
    
    // 登录 API
    const { get } = require('./http-utils');
    const CONFIG = {
      MIDOU_BASE: 'https://midou310.com/mdsj',
      MOBILE: process.env.MIDOU_MOBILE,
      PASSWORD: process.env.MIDOU_PASSWORD
    };
    const loginRes = await get(CONFIG.MIDOU_BASE + '/gduser/login.do', { mobile: CONFIG.MIDOU_MOBILE, password: CONFIG.MIDOU_PASSWORD });
    if (loginRes.code !== 1) { logger.warn('[backfill] 登录失败'); return; }
    const token = loginRes.data.token;
    
    let updated = 0;
    for (const s of stale) {
      try {
        const recRes = await get(CONFIG.MIDOU_BASE + '/score/getExpertRecommData.do', { dataId: s.matchId, type: 0 }, { Cookie: 'token=' + token });
        if (recRes.code === 1 && recRes.data) {
          const fetchDate = yDate;
          const recomms = recRes.data.filter(x => x && x.type && x.num > 0).map(x => ({
            type: x.type, num: x.num, result: x.result !== undefined ? x.result : null
          }));
          database.batchUpsertRecommends(s.matchId, recomms, fetchDate);
          const nulls = recomms.filter(r => r.result === null).length;
          if (nulls === 0) updated++;
          logger.info('[backfill] ' + s.matchId + ' ' + s.homeName + ' vs ' + s.visitName + ' OK');
        }
      } catch(e) { logger.warn('[backfill] ' + s.matchId + ' 失败: ' + e.message); }
      await new Promise(r => setTimeout(r, 200));
    }
    
    lastBackfillDate = todayStr;
    logger.info('[backfill] 近7天回填完成, 更新' + updated + '场');
  } catch(e) { logger.error('[backfill] 回填异常: ' + e.message); }
}

// ==================== 启动 ====================
// 初始化数据库
try {
  database.initDatabase();
} catch (err) {
  logger.error('数据库初始化失败: ' + err.message);
}

app.listen(PORT, () => {
  const banner = [
    '============================================',
    '  竞彩推荐监控系统 v2',
    `  环境: ${process.env.NODE_ENV || 'development'}`,
    `  API:  http://localhost:${PORT}/api`,
    `  预览: http://localhost:${PORT}/`,
    `  数据源: 米斗数据`,
    `  定时爬取: ${process.env.NODE_ENV === 'production' ? '已启用(5分钟)' : '开发模式未启用'}`,
    `  前一天回填: 已启用(10分钟检查)`,
    '============================================'
  ];
  banner.forEach(line => logger.info(line));
  
  // 前一天推荐命中信息定时回填（每10分钟检查一次）
  setInterval(() => { backfillPreviousDayResults().catch(e => {}); }, 10 * 60 * 1000);
  // 启动时立即执行一次
  setTimeout(() => { backfillPreviousDayResults().catch(e => {}); }, 30000);
});

// 导出供 scheduler 使用（必须在 scheduler require 之前）
module.exports = { fetchMatches, fetchRecommends, login };

// 生产环境启动定时爬取
if (process.env.NODE_ENV === 'production') {
  const scheduler = require('./scheduler');
  scheduler.start();
}

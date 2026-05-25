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
const app = express();
const PORT = process.env.PORT || 3000;

// 生产优化
app.disable('x-powered-by');
app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

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
app.use(express.static(path.join(__dirname, '../preview'), { maxAge: '1h', setHeaders: (res, fPath) => { if (fPath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8'); } }));

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
  const today = new Date().toISOString().slice(0, 10);
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
  const { action, data = {} } = req.body;
  logger.info(`API: ${action} ${JSON.stringify(data).slice(0, 100)}`);
  try {
    switch (action) {
      case 'week-dates': {
        // 返回可用的竞彩周日期列表（用于前端日期选择器）
        const matches = await safeApiCall(() => ensureData(), async () => dbMatchList());
        const seen = {}, list = [];
        matches.forEach(m => {
          const md = (m.date || '').slice(5) || '';
          const num = (m.num || '').slice(0, 2) || '';
          const key = md + '_' + num;
          if (!seen[key]) {
            seen[key] = true;
            list.push({ weekNum: num, matchDate: md });
          }
        });
        list.sort((a, b) => a.matchDate > b.matchDate ? 1 : -1);
        return res.json({ code: 1, data: list });
      }

      case 'match-list': {
        const matches = await safeApiCall(
          () => ensureData(),
          async () => dbMatchList()
        );
        // 同时存入数据库
        try {
          const fetchDate = matches.length > 0 ? matches[0].date : new Date().toISOString().slice(0, 10);
          database.batchUpsertMatches(matches, fetchDate);
        } catch (dbErr) {
          logger.error('存储比赛数据失败: ' + dbErr.message);
        }
        return res.json({ code: 1, data: matches });
      }

      case 'recommend-trend': {
        const { matchId } = data;
        if (!matchId) return res.json({ code: 0, msg: '缺少 matchId' });
        const recomms = await ensureRecommends(matchId);
        // 同时存入数据库
        try {
          const fetchDate = new Date().toISOString().slice(0, 10);
          database.batchUpsertRecommends(matchId, recomms, fetchDate);
        } catch (dbErr) {
          logger.error('存储推荐数据失败: ' + dbErr.message);
        }
        // 从 trends.json 读取真实趋势快照（period_daemon 每20分钟写入）
        var timeLabels = [], series = [];
        try {
          var trendFile = path.join(__dirname, 'trends.json');
          if (require('fs').existsSync(trendFile)) {
            var trends = JSON.parse(require('fs').readFileSync(trendFile, 'utf8'));
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
        if (series.length === 0) {
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
        const matches = await ensureData();
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
          try { recomms = await ensureRecommends(m.matchId); } catch { continue; }
          for (const r of recomms) {
            if (!r.type || !r.num) continue;
            if (!dirStats[r.type]) dirStats[r.type] = { totalNum: 0, matches: [] };
            dirStats[r.type].totalNum += r.num;
            dirStats[r.type].matches.push({ matchId: m.matchId, homeName: m.homeName, visitName: m.visitName, leagueName: m.leagueName, num: m.num, date: m.date, direction: r.type, expertCount: r.num, matchStatus: m.matchStatus });
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
          // 按具体方向筛选
          for (const item of dirStats[filterDirection].matches) {
            list.push({ ...item });
          }
        } else if (filterCategory && categories[filterCategory]) {
          // 按分类筛选：取该分类下所有方向的比赛的 TOP 方向
          const catDirs = new Set(categories[filterCategory].directions.map(d => d.name));
          for (const m of matches) {
            let recomms;
            try { recomms = await ensureRecommends(m.matchId); } catch { continue; }
            const filtered = recomms.filter(r => catDirs.has(r.type) && r.num > 0);
            if (filtered.length > 0) {
              const maxDir = filtered.reduce((a, b) => b.num > a.num ? b : a);
              list.push({ matchId: m.matchId, homeName: m.homeName, visitName: m.visitName, leagueName: m.leagueName, num: m.num, date: m.date, direction: maxDir.type, expertCount: maxDir.num, matchStatus: m.matchStatus });
            }
          }
        } else {
          // 综合排名：取每场比赛推荐专家最多的方向
          for (const m of matches) {
            let recomms;
            try { recomms = await ensureRecommends(m.matchId); } catch { continue; }
            const maxDir = recomms.reduce((a, b) => (b.num || 0) > ((a && a.num) || 0) ? b : a, null);
            if (maxDir && maxDir.num > 0) list.push({ matchId: m.matchId, homeName: m.homeName, visitName: m.visitName, leagueName: m.leagueName, num: m.num, date: m.date, direction: maxDir.type, expertCount: maxDir.num, matchStatus: m.matchStatus });
          }
        }

        list.sort((a, b) => b.expertCount - a.expertCount);
        const ranking = list.map((item, i) => ({ rank: i + 1, ...item }));
        const topExpertCount = ranking.length > 0 ? ranking[0].expertCount : 0;

        return res.json({
          code: 1,
          data: {
            date: new Date().toISOString().slice(0, 10),
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
        // 优先从数据库读取
        let match = null;
        try {
          const dbMatches = database.getAllMatches();
          match = dbMatches.find(m => m.matchId === matchId);
        } catch {}
        if (!match) {
          const matches = await ensureData();
          match = matches.find(m => m.matchId === matchId);
        }
        return res.json({ code: 1, data: match || null });
      }

      case 'hit-rate-stats': {
        const days = data.days || 30;
        try {
          const directionStats = database.getHitRateStats(days);
          const dailyTrend = database.getDailyTrend(days);
          if (!directionStats || directionStats.length === 0) {
            return res.json({ code: 0, msg: '命中率统计需要历史数据积累。请先运行爬虫抓取历史数据：node scraper.js' });
          }
          return res.json({
            code: 1,
            data: {
              totalDays: days,
              directionStats,
              dailyTrend
            }
          });
        } catch (dbErr) {
          return res.json({ code: 0, msg: '数据库未初始化: ' + dbErr.message });
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
          const result = database.getFilterRate({
            league: league || '',
            timeRange: timeRange || 'all',
            directionType: directionType || '',
            direction: direction || '',
            rankType: rankType || '全部',
            rankTop: rankTop || 0
          });
          return res.json({ code: 1, data: result });
        } catch (dbErr) {
          return res.json({ code: 0, msg: '查询失败: ' + dbErr.message });
        }
      }

      case 'filter-leagues': {
        try {
          const leagues = database.getAllLeagues();
          return res.json({ code: 1, data: leagues });
        } catch (dbErr) {
          return res.json({ code: 0, msg: '获取联赛列表失败: ' + dbErr.message });
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
          const cached = database.getAIPrediction(mid);
          if (cached && cached.content) return res.json({ code: 1, data: { matchId: mid, content: cached.content, confidence: cached.confidence || 0, fromCache: true } });
          // 无缓存，异步生成
          const m = database.getRecommendsByMatchId(mid);
          const matchInfo = { matchId: mid, homeName: (m && m.homeName) || '', visitName: (m && m.visitName) || '', leagueName: (m && m.leagueName) || '', date: (m && m.date) || '', num: (m && m.num) || '' };
          res.json({ code: 0, msg: '分析未就绪，正在后台生成中，请稍后刷新', pending: true });
          const ds = require('./deepseek');
          ds.generateAnalysis(matchInfo).then(r => {
            if (r.content) {
              database.upsertAIPrediction(mid, { ...matchInfo, content: r.content, confidence: (r.content && r.content.confidence) || 0, rawResponse: r.rawResponse || '', tokenUsage: r.tokenUsage || 0 });
            }
          }).catch(e => console.error('[ai] index.js 生成失败', mid, e.message));
          return;
        } catch (e) { return res.json({ code: 0, msg: '查询失败: ' + e.message }); }
      }
      case 'ai-predict-status': {
        try {
          const summary = database.getTodayMatchSummary();
          return res.json({ code: 1, data: summary });
        } catch (e) { return res.json({ code: 0, msg: e.message }); }
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
          const dateStr = data.date || new Date().toISOString().slice(0, 10);
          const fs = require('fs');
          const path = require('path');

          // 1) 从 data.json 加载比赛和推荐
          const dataFile = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
          const mMap = dataFile.m || {};
          const rMap = dataFile.r || {};
          const mList = [];
          Object.keys(mMap).forEach(k => {
            const m = mMap[k];
            if (m && (m.date || '').slice(0, 10) === dateStr) mList.push(m);
          });

          // 2) 工具函数
          function loadOddsFromFile(date, num) {
            try {
              const f = path.join(__dirname, 'odds_history', date + '.json');
              if (!fs.existsSync(f)) return null;
              const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
              return (raw.odds || {})[num] || null;
            } catch (e) { return null; }
          }

          function findRecommends(matchId) {
            const key = 'm_' + matchId;
            const recs = rMap[key] || [];
            return recs.filter(r => r && r.type && typeof r.num === 'number' && r.num > 0);
          }

          function getMatchOdds(match, direction) {
            const num = match.num || '';
            const od = loadOddsFromFile(dateStr, num);
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
                else if (pd === '让平' && oddsObj.rqspf) vals.push(oddsObj.rqspf.draw);
                else if (pd === '让负' && oddsObj.rqspf) vals.push(oddsObj.rqspf.away);
                else if (pd === '让胜' && oddsObj.rqspf) vals.push(oddsObj.rqspf.home);
              });
              return vals;
            }
            if (direction === '让负' && oddsObj.rqspf) vals.push(oddsObj.rqspf.away);
            else if (direction === '让胜' && oddsObj.rqspf) vals.push(oddsObj.rqspf.home);
            return vals;
          }

          function findBestMatchForDirection(directions, excludeIds) {
            let bestMatch = null, bestCount = 0;
            for (const m of mList) {
              if (excludeIds && excludeIds.indexOf(m.matchId) >= 0) continue;
              const num = m.num || '';
              if (!loadOddsFromFile(dateStr, num)) continue;
              const recs = findRecommends(m.matchId);
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
            const subDirs = direction.split(/[、,]/);
            const matchedRecs = [];
            const subResults = [];

            subDirs.forEach(subDir => {
              const sd = subDir.trim();
              let found = null;
              for (const r of recs) { if (r.type === sd) { found = r; break; } }
              if (!found && sd.indexOf('球') >= 0) {
                const num = sd.replace(/球/g, '');
                for (const r of recs) { if (r.type === ('总进球-' + num)) { found = r; break; } }
              }
              if (found) matchedRecs.push(found);
              subResults.push({ direction: sd, result: found ? found.result : null });
            });

            if (matchedRecs.length === 0) {
              for (const r of recs) {
                const rt = r.type || '';
                if (rt.indexOf(direction) >= 0 || direction.indexOf(rt) >= 0) matchedRecs.push(r);
              }
              if (matchedRecs.length === 0) subResults.push({ direction: direction, result: null });
            }

            expertCount = matchedRecs.reduce((s, r) => s + (r.num || 0), 0);

            let anyWon = false, anyLose = false, anyUnknown = false;
            matchedRecs.forEach(r => {
              if (r.result === 1) anyWon = true;
              else if (r.result === 0) anyLose = true;
              else anyUnknown = true;
            });
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

          // 3) 生成3个策略方案
          const plans = [];

          const m1a = findBestMatchForDirection(['平', '让平']);
          const m1b = findBestMatchForDirection(['让负'], m1a ? [m1a.matchId] : null);
          const m2a = findBestMatchForDirection(['总进球-2、3球']);
          const m2b = findBestMatchForDirection(['让负']);
          const m3a = findBestMatchForDirection(['总进球-2、3球']);
          const m3b = findBestMatchForDirection(['让胜']);

          if (m1a && m1b) {
            const m1aObj = buildMatchObj(m1a, '平、让平');
            const m1bObj = buildMatchObj(m1b, '让负');
            const e1 = calcEffectiveOdds('平、让平', m1aObj);
            const e2 = calcEffectiveOdds('让负', m1bObj);
            plans.push({
              planId: 'plan_' + dateStr + '_1', planName: '方案一',
              matches: [m1aObj, m1bObj],
              amount: 1000, playType: '混合投注', matchCount: 2, passType: '2串1',
              betCount: 250, ticketCount: 10, multiplier: 25,
              maxPrize: e1 && e2 ? Math.round(1000 * e1 * e2) : Math.round(1000 * 2.5)
            });
          }
          if (m2a && m2b) {
            const m2aObj = buildMatchObj(m2a, '总进球-2、3球');
            const m2bObj = buildMatchObj(m2b, '让负');
            const e1 = calcEffectiveOdds('总进球-2、3球', m2aObj);
            const e2 = calcEffectiveOdds('让负', m2bObj);
            plans.push({
              planId: 'plan_' + dateStr + '_2', planName: '方案二',
              matches: [m2aObj, m2bObj],
              amount: 1000, playType: '混合投注', matchCount: 2, passType: '2串1',
              betCount: 250, ticketCount: 10, multiplier: 25,
              maxPrize: e1 && e2 ? Math.round(1000 * e1 * e2) : Math.round(1000 * 2.5)
            });
          }
          if (m3a && m3b) {
            const m3aObj = buildMatchObj(m3a, '总进球-2、3球');
            const m3bObj = buildMatchObj(m3b, '让胜');
            const e1 = calcEffectiveOdds('总进球-2、3球', m3aObj);
            const e2 = calcEffectiveOdds('让胜', m3bObj);
            plans.push({
              planId: 'plan_' + dateStr + '_3', planName: '方案三',
              matches: [m3aObj, m3bObj],
              amount: 1000, playType: '混合投注', matchCount: 2, passType: '2串1',
              betCount: 250, ticketCount: 10, multiplier: 25,
              maxPrize: e1 && e2 ? Math.round(1000 * e1 * e2) : Math.round(1000 * 2.5)
            });
          }

          return res.json({ code: 1, data: { date: dateStr, plans } });
        } catch (e) {
          return res.json({ code: 0, msg: '获取方案列表失败: ' + e.message });
        }
      }

      case 'filter-stats': {
        try {
          const stats = database.getFilterStats();
          const leagues = database.getAllLeagues();
          const stale = database.getStaleRecommendations();
          stats.leagues = leagues;
          stats.staleCount = stale ? stale.length : 0;
          return res.json({ code: 1, data: stats });
        } catch (dbErr) {
          return res.json({ code: 0, msg: '获取统计失败: ' + dbErr.message });
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
    const db = database.initDatabase();
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

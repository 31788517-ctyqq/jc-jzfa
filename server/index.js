require('dotenv').config();
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
app.use(express.static(path.join(__dirname, '../preview'), { maxAge: '1h' }));

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
        // 模拟趋势数据（7 个时间点，最终值取真实值）
        const times = [];
        const now = new Date();
        const hour = now.getHours();
        for (let i = 6; i >= 0; i--) {
          const t = new Date(now);
          t.setHours(Math.max(11, hour - i * 0.5), i % 2 === 0 ? 0 : 30, 0);
          if (t.getHours() >= 11) times.push(String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0'));
        }
        const series = recomms.map(r => {
          const data = times.map((_, idx) => {
            if (idx === times.length - 1) return r.num;
            return Math.max(0, r.num - Math.floor(Math.random() * 3));
          });
          return { name: r.type, type: 'line', smooth: true, data };
        });
        return res.json({ code: 1, data: { matchId, timeLabels: times, series, lastResult: recomms } });
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

        return res.json({
          code: 1,
          data: {
            date: new Date().toISOString().slice(0, 10),
            filterCategory,
            filterDirection,
            totalMatches: ranking.length,
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
    '============================================'
  ];
  banner.forEach(line => logger.info(line));
});

// 生产环境启动定时爬取
if (process.env.NODE_ENV === 'production') {
  const scheduler = require('./scheduler');
  scheduler.start();
}

// 导出供 scheduler 使用
module.exports = { fetchMatches, fetchRecommends, login };
  console.log('============================================');
});

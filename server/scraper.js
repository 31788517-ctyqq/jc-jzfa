/**
 * 历史数据抓取脚本
 * 按日期范围抓取 footballDataList.do 的比赛数据及推荐详情
 * 存入本地 SQLite 数据库
 */
const database = require('./database');
const { get } = require('./http-utils');

// 配置
const CONFIG = {
  MIDOU_BASE: 'https://midou310.com/mdsj',
  MOBILE: process.env.MIDOU_MOBILE,
  PASSWORD: process.env.MIDOU_PASSWORD
};

if (!CONFIG.MOBILE || !CONFIG.PASSWORD) {
  console.error('[scraper] 缺少 MIDOU_MOBILE / MIDOU_PASSWORD 环境变量');
  process.exit(1);
}

let token = null;

/**
 * 登录
 */
async function login() {
  if (token) return token;
  const res = await get(`${CONFIG.MIDOU_BASE}/gduser/login.do`, { 
    mobile: CONFIG.MOBILE, 
    password: CONFIG.PASSWORD 
  });
  if (res.code === 1) {
    token = res.data.token;
    return token;
  }
  throw new Error('登录失败: ' + (res.msg || '未知'));
}

/**
 * 获取指定日期的比赛列表
 * @param {string} dateStr - 格式: '2026-04-01'
 */
async function fetchMatchesByDate(dateStr) {
  const tk = await login();
  const date = new Date(dateStr + 'T00:00:00+08:00');
  const timestamp = date.getTime();

  const res = await get(
    `${CONFIG.MIDOU_BASE}/score/footballDataList.do`,
    { time: timestamp, order: 'status desc, start_datetime asc, data_id asc' },
    { Cookie: `token=${tk}` }
  );

  if (res.code !== 1) {
    throw new Error(`获取比赛列表失败(${dateStr}): ${res.msg || ''}`);
  }

  return (res.data || []).map(m => ({
    matchId: String(m.matchId),
    num: m.num || '',
    homeName: m.homeName || '',
    visitName: m.visitName || '',
    leagueName: m.leagueName || '',
    startTime: m.startTime || '',
    matchStatus: m.matchStatus !== undefined ? m.matchStatus : 0,
    score: m.score || '',
    recommNum: m.recommNum || 0
  }));
}

/**
 * 获取某场比赛的推荐数据
 */
async function fetchRecommends(matchId) {
  const tk = await login();
  const res = await get(
    `${CONFIG.MIDOU_BASE}/score/getExpertRecommData.do`,
    { dataId: matchId, type: 0 },
    { Cookie: `token=${tk}` }
  );
  if (res.code !== 1) {
    throw new Error(`获取推荐失败 matchId=${matchId}: ${res.msg || ''}`);
  }
  return (res.data || []).filter(item => item && item.type && item.num > 0).map(item => ({
    type: item.type,
    num: item.num,
    result: item.result !== undefined ? item.result : null
  }));
}

/**
 * 抓取单日数据
 */
async function crawlDate(dateStr) {
  console.log(`[crawl] 正在抓取 ${dateStr}...`);

  // 1. 获取比赛列表
  let matches;
  try {
    matches = await fetchMatchesByDate(dateStr);
  } catch (err) {
    console.error(`[crawl] ${dateStr} 获取比赛列表失败:`, err.message);
    database.logCrawl(dateStr, 0, 0, 'failed', err.message);
    return { matchCount: 0, recommCount: 0, status: 'failed' };
  }

  if (!matches || matches.length === 0) {
    console.log(`[crawl] ${dateStr} 没有比赛数据`);
    database.logCrawl(dateStr, 0, 0, 'empty', '无比赛数据');
    return { matchCount: 0, recommCount: 0, status: 'empty' };
  }

  // 2. 存储比赛数据
  database.batchUpsertMatches(matches, dateStr);
  console.log(`[crawl] ${dateStr} 已保存 ${matches.length} 场比赛`);

  // 3. 逐场获取推荐数据
  let totalRecomm = 0;
  for (const m of matches) {
    try {
      const recomms = await fetchRecommends(m.matchId);
      if (recomms.length > 0) {
        database.batchUpsertRecommends(m.matchId, recomms, dateStr);
        totalRecomm += recomms.length;
      }
      // 延迟避免请求过快
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`[crawl] ${dateStr} matchId=${m.matchId} 获取推荐失败:`, err.message);
    }
  }

  // 4. 记录日志
  database.logCrawl(dateStr, matches.length, totalRecomm, 'success', '');
  console.log(`[crawl] ${dateStr} 完成: ${matches.length}场, ${totalRecomm}条推荐`);

  return { matchCount: matches.length, recommCount: totalRecomm, status: 'success' };
}

/**
 * 生成日期列表
 */
function generateDateRange(startDate, endDate) {
  const dates = [];
  const current = new Date(startDate);
  const end = new Date(endDate);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/**
 * 主函数 - 抓取4月和5月数据
 */
async function main() {
  console.log('========================================');
  console.log('  竞彩推荐监控 - 历史数据抓取工具');
  console.log('========================================');
  console.log(`  登录账号: ${CONFIG.MOBILE}`);
  console.log(`  数据源: 米斗数据`);
  console.log('========================================\n');

  // 初始化数据库
  database.initDatabase();

  // 生成日期范围: 2026-04-01 ~ 2026-05-18
  const dates = generateDateRange('2026-04-01', '2026-05-18');
  console.log(`计划抓取 ${dates.length} 天数据 (${dates[0]} ~ ${dates[dates.length-1]})`);

  let successCount = 0;
  let emptyCount = 0;
  let failedCount = 0;
  let totalMatches = 0;
  let totalRecommends = 0;

  for (let i = 0; i < dates.length; i++) {
    const dateStr = dates[i];

    // 检查是否已抓取过
    const crawledDates = database.getCrawledDates();
    if (crawledDates.includes(dateStr)) {
      console.log(`[skip] ${dateStr} 已抓取，跳过`);
      continue;
    }

    const result = await crawlDate(dateStr);

    if (result.status === 'success') {
      successCount++;
      totalMatches += result.matchCount;
      totalRecommends += result.recommCount;
    } else if (result.status === 'empty') {
      emptyCount++;
    } else {
      failedCount++;
    }

    // 进度提示
    const progress = Math.round((i + 1) / dates.length * 100);
    console.log(`[进度] ${i+1}/${dates.length} (${progress}%)`);

    // 每次请求后延迟，避免触发风控
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('========================================');
  console.log('  抓取完成！');
  console.log('========================================');
  console.log(`  总天数: ${dates.length}`);
  console.log(`  成功: ${successCount}天`);
  console.log(`  无数据: ${emptyCount}天`);
  console.log(`  失败: ${failedCount}天`);
  console.log(`  比赛总数: ${totalMatches}`);
  console.log(`  推荐总数: ${totalRecommends}`);
  console.log('========================================');

  database.closeDatabase();
}

// 当直接运行时执行 main
if (require.main === module) {
  main().catch(err => {
    console.error('[scraper] 错误:', err);
    database.closeDatabase();
    process.exit(1);
  });
}

module.exports = { main, crawlDate, fetchMatchesByDate, fetchRecommends, generateDateRange };

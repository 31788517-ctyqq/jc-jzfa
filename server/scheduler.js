/**
 * 定时爬取调度器
 * 每5分钟自动抓取最新比赛和推荐数据
 */
const logger = require('./logger');
const { fetchMatches, fetchRecommends, login } = require('./index');

let schedulerTimer = null;
let isRunning = false;

async function crawlLatest() {
  if (isRunning) return;
  isRunning = true;
  const startTime = Date.now();
  logger.info('[定时任务] 开始爬取');

  try {
    const matches = await fetchMatches();
    logger.info(`[定时任务] 获取 ${matches.length} 场比赛`);

    const activeMatches = matches.filter(m => m.matchStatus !== 3);
    for (const m of activeMatches.slice(0, 5)) {
      try {
        await fetchRecommends(m.matchId);
        logger.info(`[定时任务] 推荐已缓存 matchId=${m.matchId}`);
      } catch (e) {
        logger.warn(`[定时任务] 推荐失败 matchId=${m.matchId}: ${e.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (e) {
    logger.error('[定时任务] 爬取失败: ' + e.message);
  }

  isRunning = false;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info(`[定时任务] 完成，耗时 ${elapsed}s`);
}

function start(intervalMs = 300000) {
  if (schedulerTimer) return;
  logger.info(`[定时任务] 启动，间隔 ${intervalMs / 1000}s`);
  setTimeout(() => {
    crawlLatest();
    schedulerTimer = setInterval(crawlLatest, intervalMs);
  }, 30000);
}

function stop() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    logger.info('[定时任务] 已停止');
  }
}

module.exports = { start, stop };

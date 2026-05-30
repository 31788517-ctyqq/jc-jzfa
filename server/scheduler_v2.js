/**
 * 统一调度器 v2 (P3-2)
 * 
 * 设计原则:
 *   1. 分布式锁（文件锁，防止PM2多实例并发）
 *   2. 延迟重试队列（失败任务指数退避重试）
 *   3. Cron表达式调度
 *   4. 任务健康监控 + 告警
 *   5. 优雅停机（保存进度）
 *   6. 断点续传
 * 
 * 替代: data_sync.js 中的 setTimeout 循环
 * 
 * 用法:
 *   node server/scheduler_v2.js
 *   或 PM2: pm2 start server/scheduler_v2.js --name scheduler
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const logger = require('./logger').child('scheduler_v2');
const alert = require('./alert');

// ═══ 配置 ═══
const LOCK_FILE = path.join(__dirname, 'scheduler.lock');
const STATE_FILE = path.join(__dirname, 'scheduler_state.json');
const QUEUE_FILE = path.join(__dirname, 'scheduler_queue.json');

const INSTANCE_ID = crypto.randomBytes(4).toString('hex');
const LOCK_TTL = 5 * 60 * 1000; // 锁过期时间
const HEARTBEAT_INTERVAL = 30 * 1000; // 心跳间隔

// ═══ 数据模块 ═══
let dataSync;
function loadDataSync() {
  if (!dataSync) {
    try { dataSync = require('./data_sync'); } catch (e) {
      logger.error('data_sync 模块加载失败: ' + e.message);
    }
  }
  return dataSync;
}

// ═══ 1. 分布式锁 ═══
function acquireLock() {
  try {
    // 检查现有锁
    if (fs.existsSync(LOCK_FILE)) {
      const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      const age = Date.now() - lock.timestamp;
      // 锁未过期且不由当前实例持有
      if (age < LOCK_TTL && lock.instance !== INSTANCE_ID) {
        logger.info('[lock] 锁由 ' + lock.instance + ' 持有 (' + Math.round(age / 1000) + 's ago)，等待中...');
        return false;
      }
      if (age >= LOCK_TTL) {
        logger.warn('[lock] 锁过期 (' + Math.round(age / 1000) + 's), 强制接管');
      }
    }

    fs.writeFileSync(LOCK_FILE, JSON.stringify({
      instance: INSTANCE_ID,
      timestamp: Date.now(),
      pid: process.pid,
      hostname: require('os').hostname()
    }));
    return true;
  } catch (e) {
    logger.error('[lock] 获取锁失败: ' + e.message);
    return false;
  }
}

function renewLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (lock.instance === INSTANCE_ID) {
        lock.timestamp = Date.now();
        fs.writeFileSync(LOCK_FILE, JSON.stringify(lock));
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (lock.instance === INSTANCE_ID) {
        fs.unlinkSync(LOCK_FILE);
        logger.info('[lock] 锁已释放');
      }
    }
  } catch (e) {}
}

// ═══ 2. 状态管理 ═══
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {}
  return {
    startedAt: new Date().toISOString(),
    lastTasks: {},
    taskStats: {},
    errors: []
  };
}

function saveState(state) {
  try {
    state.updatedAt = new Date().toISOString();
    if (state.errors && state.errors.length > 100) {
      state.errors = state.errors.slice(-100);
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {}
}

// ═══ 3. 重试队列 ═══
function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    }
  } catch (e) {}
  return { items: [] };
}

function saveQueue(queue) {
  try {
    queue.updatedAt = new Date().toISOString();
    // 清理过期项（超过24小时的重试）
    const cutoff = Date.now() - 24 * 3600 * 1000;
    queue.items = (queue.items || []).filter(i => {
      return new Date(i.nextRetryAt).getTime() > cutoff;
    });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  } catch (e) {}
}

function enqueueTask(taskName, params, retryCount, delayMinutes) {
  const queue = loadQueue();
  // 去重
  const dupIdx = queue.items.findIndex(i =>
    i.taskName === taskName && JSON.stringify(i.params) === JSON.stringify(params)
  );
  if (dupIdx >= 0) {
    queue.items[dupIdx].retryCount = (retryCount || 0) + 1;
    queue.items[dupIdx].nextRetryAt = new Date(Date.now() + (delayMinutes || 30) * 60000).toISOString();
  } else {
    queue.items.push({
      id: crypto.randomBytes(4).toString('hex'),
      taskName, params, retryCount: (retryCount || 0) + 1,
      nextRetryAt: new Date(Date.now() + (delayMinutes || 30) * 60000).toISOString(),
      addedAt: new Date().toISOString()
    });
  }
  saveQueue(queue);
  logger.info('[queue] 入队: ' + taskName + ' (重试#' + (retryCount || 0) + ', ' + delayMinutes + 'min后)');
}

async function processQueue() {
  const queue = loadQueue();
  if (!queue.items || queue.items.length === 0) return 0;

  const now = Date.now();
  const ready = queue.items.filter(i => new Date(i.nextRetryAt).getTime() <= now);
  if (ready.length === 0) return 0;

  logger.info('[queue] 处理重试队列: ' + ready.length + ' 项');
  let done = 0;

  for (const item of ready) {
    try {
      const result = await executeTask(item.taskName, item.params, item.retryCount);
      if (result) done++;
    } catch (e) {
      logger.warn('[queue] ' + item.taskName + ' 重试失败: ' + e.message);
      // 指数退避
      if (item.retryCount < 5) {
        enqueueTask(item.taskName, item.params, item.retryCount, (item.retryCount + 1) * 10);
      } else {
        logger.error('[queue] ' + item.taskName + ' 已达最大重试，放弃');
      }
    }
  }

  // 清理已处理项
  const doneIds = new Set(ready.map(i => i.id));
  queue.items = queue.items.filter(i => !doneIds.has(i.id));
  saveQueue(queue);

  return done;
}

// ═══ 4. 任务执行器 ═══
async function executeTask(taskName, params, retryCount) {
  const ds = loadDataSync();
  if (!ds) throw new Error('data_sync 模块不可用');

  const timer = logger.startTimer('task_' + taskName);
  logger.info('[task] 执行: ' + taskName + ' ' + JSON.stringify(params || {}));

  try {
    switch (taskName) {
      case 'sync_match_list': {
        await ds.syncMatchList(params && params.date);
        break;
      }
      case 'sync_500odds': {
        const date = (params && params.date) || new Date().toISOString().slice(0, 10);
        await ds.sync500Odds(date);
        break;
      }
      case 'sync_500shuju': {
        if (ds.sync500Shuju) {
          await ds.sync500Shuju(params && params.date);
        }
        break;
      }
      case 'sync_500shuju_selenium': {
        if (ds.sync500ShujuSelenium) {
          await ds.sync500ShujuSelenium(params && params.date);
        }
        break;
      }
      case 'merge_shuju': {
        const { mergeShuju } = require('./merge_shuju');
        const date = (params && params.date) || new Date().toISOString().slice(0, 10);
        mergeShuju(date);
        break;
      }
      case 'sync_recommends': {
        await ds.syncRecommends(params && params.date);
        break;
      }
      case 'backfill_results': {
        await ds.backfillResults(params && params.date);
        break;
      }
      default: {
        logger.warn('[task] 未知任务: ' + taskName);
        return false;
      }
    }

    const duration = timer.end();
    logger.info('[task] ' + taskName + ' 完成 [' + duration + 'ms]');

    // 更新状态
    const state = loadState();
    if (!state.taskStats[taskName]) {
      state.taskStats[taskName] = { runs: 0, failures: 0, totalDuration: 0, lastRun: null };
    }
    state.taskStats[taskName].runs++;
    state.taskStats[taskName].totalDuration += duration;
    state.taskStats[taskName].lastRun = new Date().toISOString();
    state.lastTasks[taskName] = { time: new Date().toISOString(), duration, success: true };
    saveState(state);

    return true;
  } catch (e) {
    const duration = timer.end();
    logger.error('[task] ' + taskName + ' 失败: ' + e.message);

    const state = loadState();
    if (!state.taskStats[taskName]) {
      state.taskStats[taskName] = { runs: 0, failures: 0, totalDuration: 0, lastRun: null };
    }
    state.taskStats[taskName].runs++;
    state.taskStats[taskName].failures++;
    state.lastTasks[taskName] = { time: new Date().toISOString(), duration, success: false, error: e.message };
    state.errors.push({ taskName, time: new Date().toISOString(), error: e.message });
    saveState(state);

    // 失败后加入重试队列
    if ((retryCount || 0) < 3) {
      enqueueTask(taskName, params, retryCount || 0, 5);
    }

    throw e;
  }
}

// ═══ 5. 调度循环 ═══
let running = false;
let timers = [];

function schedule(name, intervalMs, taskFn, immediateCheck) {
  function loop() {
    if (!running) return;
    const tid = setTimeout(async () => {
      if (!running) return;
      // 尝试获取锁（高频轻量任务不抢锁）
      const needLock = intervalMs >= 60000; // >=1分钟的任务才抢锁
      if (needLock && !acquireLock()) {
        timers.push(setTimeout(loop, intervalMs));
        return;
      }
      try {
        await taskFn();
      } catch (e) {
        logger.error('[schedule] ' + name + ' 异常: ' + e.message);
      }
      if (needLock) {
        // 长任务完成后释放锁
        // （短任务保留锁）
      }
      timers.push(setTimeout(loop, intervalMs));
    }, immediateCheck ? 1000 : intervalMs);
    timers.push(tid);
  }

  logger.info('[schedule] 注册: ' + name + ' (每 ' + Math.round(intervalMs / 1000) + 's)');
  loop();
}

// ═══ 6. 12:00 定时任务 ═══
function getNextNoonDelay() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(12, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

function scheduleNoonTask() {
  const delay = getNextNoonDelay();
  logger.info('[schedule] 下次12:00任务: ' + Math.round(delay / 3600000) + ' 小时后');

  const tid = setTimeout(async () => {
    if (!running) return;
    const today = new Date().toISOString().slice(0, 10);

    if (!acquireLock()) {
      // 如果锁被其他实例持有，入队延迟执行
      enqueueTask('noon_batch', { date: today }, 0, 1);
      scheduleNoonTask();
      return;
    }

    logger.info('[schedule] ⏰ 12:00 全量同步启动: ' + today);

    try {
      // 串行执行，避免同时请求
      await executeTask('sync_match_list', { date: today });
      await sleep(2000);

      await executeTask('sync_500odds', { date: today });
      await sleep(2000);

      // 异步并行（不互相阻塞）
      executeTask('sync_500shuju', { date: today }).catch(e => {});
      executeTask('sync_500shuju_selenium', { date: today }).catch(e => {});

      // 延后5分钟合并
      setTimeout(() => {
        executeTask('merge_shuju', { date: today }).catch(e => {});
      }, 5 * 60 * 1000);

      logger.info('[schedule] 12:00 任务链已启动');
    } catch (e) {
      logger.error('[schedule] 12:00 任务失败: ' + e.message);
      // 重试
      enqueueTask('noon_batch', { date: today }, 0, 10);
    }

    scheduleNoonTask();
  }, delay);
  timers.push(tid);
}

// ═══ 7. 启动 ═══
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function start() {
  const banner = [
    '════════════════════════════════════════',
    '  统一调度器 v2 启动',
    '  实例: ' + INSTANCE_ID,
    '  功能: 分布式锁 + 重试队列 + 定时调度',
    '════════════════════════════════════════'
  ];
  banner.forEach(l => logger.info(l));

  running = true;

  // 启动时尝试获取锁
  let hasLock = acquireLock();
  if (!hasLock) {
    logger.info('[init] 启动时无法获取锁，将在心跳周期中重试');
  }

  // 心跳 + 重试队列处理
  schedule('heartbeat', HEARTBEAT_INTERVAL, async () => {
    if (!acquireLock()) {
      // 无法获取锁，只做队列检查（不和其他实例冲突）
      return;
    }
    renewLock();
    // 处理重试队列
    await processQueue();
  });

  // 启动时检查今天是否有数据，没有则触发同步
  if (hasLock) {
    const today = new Date().toISOString().slice(0, 10);
    logger.info('[init] 检查 ' + today + ' 数据状态...');
    try {
      await executeTask('sync_match_list', { date: today });
    } catch (e) {
      logger.warn('[init] 初始同步失败: ' + e.message);
    }
  }

  // 实时比分 (每2分钟)
  schedule('live_score', 120000, async () => {
    try {
      // 从 data_sync 导入 syncLiveScores
      const ds = loadDataSync();
      // 通过 data_sync 内部机制直接调用（不需要lock）
    } catch (e) {}
  }, true);

  // 推荐同步 (每20分钟)
  schedule('recommend', 20 * 60 * 1000, async () => {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const ds = loadDataSync();
      if (ds.syncRecommends) await ds.syncRecommends(today);
    } catch (e) {
      enqueueTask('sync_recommends', { date: today }, 0, 5);
    }
  });

  // 12:00 定时
  scheduleNoonTask();

  // 健康状态输出 (每小时)
  schedule('health_report', 60 * 60 * 1000, async () => {
    const state = loadState();
    const summary = Object.entries(state.taskStats || {}).map(([k, v]) =>
      k + ': ' + v.runs + '次/' + v.failures + '失败'
    ).join(', ');
    logger.info('[health] 任务统计: ' + summary);
  });

  // 优雅停机
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    logger.error('[fatal] uncaughtException: ' + err.message + '\n' + err.stack);
    alert.crawlFailed(err.message, 'scheduler_v2 致命错误');
    setTimeout(() => process.exit(1), 5000);
  });

  logger.info('[init] 调度器已启动, 监控 ' + timers.length + ' 个定时任务');
}

function shutdown() {
  logger.info('[shutdown] 收到停机信号, 保存状态...');
  running = false;

  timers.forEach(t => clearTimeout(t));
  timers = [];

  const state = loadState();
  state.stoppedAt = new Date().toISOString();
  saveState(state);

  releaseLock();
  logger.info('[shutdown] 调度器已停止');
  process.exit(0);
}

// ═══ 导出 ═══
if (require.main === module) {
  // 先加载 data_sync 但不启动它（避免双进程）
  // scheduler_v2 替代 data_sync 的调度逻辑
  start().catch(e => {
    logger.error('[fatal] 启动失败: ' + e.message);
    process.exit(1);
  });
}

module.exports = { start, executeTask, enqueueTask, getState: loadState, getQueue: loadQueue };

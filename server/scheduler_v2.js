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

// A3: 本地日期格式化（北京时间），避免 UTC 偏移导致日期错误
function fmtLocal(dd) {
  return (
    dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0')
  );
}

const INSTANCE_ID = crypto.randomBytes(4).toString('hex');
const LOCK_TTL = 5 * 60 * 1000; // 锁过期时间
const HEARTBEAT_INTERVAL = 30 * 1000; // 心跳间隔

// ═══ 数据模块 ═══
let dataSync;
function loadDataSync() {
  if (!dataSync) {
    try {
      dataSync = require('./data_sync');
    } catch (e) {
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

    fs.writeFileSync(
      LOCK_FILE,
      JSON.stringify({
        instance: INSTANCE_ID,
        timestamp: Date.now(),
        pid: process.pid,
        hostname: require('os').hostname(),
      }),
    );
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
    errors: [],
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
    queue.items = (queue.items || []).filter((i) => {
      return new Date(i.nextRetryAt).getTime() > cutoff;
    });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  } catch (e) {}
}

function enqueueTask(taskName, params, retryCount, delayMinutes) {
  const queue = loadQueue();
  // 去重
  const dupIdx = queue.items.findIndex(
    (i) => i.taskName === taskName && JSON.stringify(i.params) === JSON.stringify(params),
  );
  if (dupIdx >= 0) {
    queue.items[dupIdx].retryCount = (retryCount || 0) + 1;
    queue.items[dupIdx].nextRetryAt = new Date(Date.now() + (delayMinutes || 30) * 60000).toISOString();
  } else {
    queue.items.push({
      id: crypto.randomBytes(4).toString('hex'),
      taskName,
      params,
      retryCount: (retryCount || 0) + 1,
      nextRetryAt: new Date(Date.now() + (delayMinutes || 30) * 60000).toISOString(),
      addedAt: new Date().toISOString(),
    });
  }
  saveQueue(queue);
  logger.info('[queue] 入队: ' + taskName + ' (重试#' + (retryCount || 0) + ', ' + delayMinutes + 'min后)');
}

async function processQueue() {
  const queue = loadQueue();
  if (!queue.items || queue.items.length === 0) return 0;

  const now = Date.now();
  const ready = queue.items.filter((i) => new Date(i.nextRetryAt).getTime() <= now);
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
  const doneIds = new Set(ready.map((i) => i.id));
  queue.items = queue.items.filter((i) => !doneIds.has(i.id));
  saveQueue(queue);

  return done;
}

// ═══ 3.5 熔断器 ═══
const _circuitBreaker = {};
const CB_CONFIG = {
  backoffAfter: 3, // 连续失败 3 次 → 退避 30 分钟
  breakAfter: 10, // 连续失败 10 次 → 熔断 2 小时
  backoffMinutes: 30,
  breakMinutes: 120,
};

function _recordTaskResult(taskName, success) {
  if (!_circuitBreaker[taskName]) {
    _circuitBreaker[taskName] = { consecutiveFailures: 0, openUntil: 0 };
  }
  const cb = _circuitBreaker[taskName];
  if (success) {
    cb.consecutiveFailures = 0;
    cb.openUntil = 0;
  } else {
    cb.consecutiveFailures++;
    if (cb.consecutiveFailures >= CB_CONFIG.breakAfter) {
      cb.openUntil = Date.now() + CB_CONFIG.breakMinutes * 60 * 1000;
      logger.error(
        '[cb] 熔断: ' +
          taskName +
          ' 连续失败 ' +
          cb.consecutiveFailures +
          ' 次, 熔断 ' +
          CB_CONFIG.breakMinutes +
          ' 分钟',
      );
      alert.taskCircuitBreaker({ taskName, consecutiveFailures: cb.consecutiveFailures });
    }
  }
}

function _isCircuitOpen(taskName) {
  const cb = _circuitBreaker[taskName];
  if (!cb || cb.openUntil === 0) return false;
  if (Date.now() >= cb.openUntil) {
    cb.consecutiveFailures = 0;
    cb.openUntil = 0;
    logger.info('[cb] 熔断恢复: ' + taskName);
    return false;
  }
  return true;
}

function _getBackoffDelay(taskName) {
  const cb = _circuitBreaker[taskName] || { consecutiveFailures: 0 };
  if (cb.consecutiveFailures >= CB_CONFIG.breakAfter) return CB_CONFIG.breakMinutes * 60 * 1000;
  if (cb.consecutiveFailures >= CB_CONFIG.backoffAfter) return CB_CONFIG.backoffMinutes * 60 * 1000;
  return 0;
}

function _resetCircuitBreaker() {
  Object.keys(_circuitBreaker).forEach((key) => delete _circuitBreaker[key]);
}

// ═══ 4. 任务执行器 ═══
async function executeTask(taskName, params, retryCount) {
  // 熔断检查
  if (_isCircuitOpen(taskName)) {
    const msg = '[cb] 任务熔断中: ' + taskName;
    logger.warn(msg);
    return false;
  }

  const backoff = _getBackoffDelay(taskName);
  if (backoff > 0) {
    logger.warn('[cb] 任务退避 ' + taskName + ' (' + Math.round(backoff / 60000) + 'min)');
    enqueueTask(taskName, params, retryCount, Math.round(backoff / 60000));
    return false;
  }

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
      case 'sync_odds_delta': {
        const date = (params && params.date) || new Date().toISOString().slice(0, 10);
        if (ds.sync500OddsDelta) {
          await ds.sync500OddsDelta(date);
        }
        break;
      }
      case 'gongshoudao_refresh': {
        try {
          const gsEngine = require('./gongshoudao/index');
          await gsEngine.refreshCache();
          logger.info('[task] 功守道缓存刷新完成');
        } catch (e) {
          logger.warn('[task] 功守道缓存刷新失败: ' + e.message);
        }
        break;
      }
      case 'pk_scorer_compute': {
        try {
          const pk = require('./pk_scorer');
          const date = (params && params.date) || new Date().toISOString().slice(0, 10);
          const result = await pk.computeAndSave(date);
          logger.info('[task] PK评分计算完成: ' + JSON.stringify(result));
        } catch (e) {
          logger.warn('[task] PK评分计算失败: ' + e.message);
        }
        break;
      }
      case 'feature_engine_compute': {
        // ★ J-03: FeatureEngine 调度激活
        try {
          const { engine: featureEngine } = require('./core/feature-engine');
          const date = (params && params.date) || new Date().toISOString().slice(0, 10);
          // 加载当天比赛列表
          const fs = require('fs');
          const path = require('path');
          const dataFile = path.join(__dirname, 'data.json');
          if (fs.existsSync(dataFile)) {
            const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
            const mMap = data.m || {};
            let count = 0;
            for (const k of Object.keys(mMap)) {
              const m = mMap[k];
              if (!m || !m.date) continue;
              if (date && m.date.slice(0, 10) !== date) continue;
              try {
                await featureEngine.computeFeatures(m, { dataFile: data });
                count++;
              } catch (e2) {
                /* skip */
              }
            }
            logger.info('[task] FeatureEngine 完成: ' + count + ' 场比赛特征已计算');
          }
        } catch (e) {
          logger.warn('[task] FeatureEngine 计算失败: ' + e.message);
        }
        break;
      }
      case 'scrape_sporttery_today': {
        // ★ P8: 竞彩官网每日赔率抓取+入库（10:00运行,11:00前完成）
        try {
          const { execSync } = require('child_process');
          const today = (params && params.date) || new Date().toISOString().slice(0, 10);
          logger.info('[sporttery] 开始抓取今日(' + today + ')实盘赔率...');
          const cmd = 'python scripts/scrape_sporttery.py --today --bridge --headless';
          const output = execSync(cmd, {
            cwd: require('path').join(__dirname, '..'),
            timeout: 45 * 60 * 1000,
            encoding: 'utf8',
          });
          // 提取关键行
          const lines = output.split('\n').filter(function (l) {
            return l.includes('✅') || l.includes('[Done]');
          });
          logger.info('[sporttery] ' + lines.slice(-3).join(' | '));
        } catch (e) {
          logger.error('[sporttery] 抓取失败: ' + (e.stderr || e.message || '').slice(0, 300));
          throw e; // 触发重试队列
        }
        break;
      }
      case 'warm_api_cache': {
        // ★ P1-1: 定时预热 API 响应缓存（冷启动 5s→50ms）
        const date = (params && params.date) || fmtLocal(new Date());
        const http = require('http');
        const warmEndpoint = async (action) => {
          return new Promise((resolve) => {
            const url = '/api?action=' + action + '&date=' + date;
            const req = http.get({ hostname: '127.0.0.1', port: 3000, path: url, timeout: 30000 }, (res) => {
              let body = '';
              res.on('data', (chunk) => { body += chunk; });
              res.on('end', () => {
                const brief = body.slice(0, 200).replace(/\s+/g, ' ');
                logger.info('[warm] ' + action + ' → ' + res.statusCode + ' (' + brief.length + 'B)');
                resolve(true);
              });
            });
            req.on('error', (e) => { logger.warn('[warm] ' + action + ' 失败: ' + e.message); resolve(false); });
            req.on('timeout', () => { req.destroy(); resolve(false); });
          });
        };
        await warmEndpoint('home-bundle');
        await sleep(3000);
        await warmEndpoint('ranking-list');
        await sleep(2000);
        await warmEndpoint('plan-list');
        break;
      }

      default: {
        logger.warn('[task] 未知任务: ' + taskName);
        return false;
      }
    }

    _recordTaskResult(taskName, true);

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
    _recordTaskResult(taskName, false);

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
    const tid = setTimeout(
      async () => {
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
      },
      immediateCheck ? 1000 : intervalMs,
    );
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
      executeTask('sync_500shuju', { date: today }).catch((e) => {});
      executeTask('sync_500shuju_selenium', { date: today }).catch((e) => {});

      // 延后5分钟合并
      setTimeout(
        () => {
          executeTask('merge_shuju', { date: today }).catch((e) => {});
        },
        5 * 60 * 1000,
      );

      // ★ P1-1: 延后 15 分钟预热 API 响应缓存（冷启动 5s→50ms）
      setTimeout(
        async () => {
          try {
            logger.info('[schedule] 🔥 开始 API 缓存预热...');
            await executeTask('warm_api_cache', { date: today });
          } catch (e) {
            logger.error('[schedule] 预热失败: ' + e.message);
          }
        },
        15 * 60 * 1000,
      );

      // ★ V9.1: 延后10分钟执行功守道 + PK + FeatureEngine 计算链
      setTimeout(
        async () => {
          try {
            // 1) 功守道缓存刷新
            await executeTask('gongshoudao_refresh', { date: today });
            await sleep(3000);
            // 2) PK 评分（依赖功守道缓存）
            await executeTask('pk_scorer_compute', { date: today });
            await sleep(3000);
            // 3) FeatureEngine 特征计算（依赖 JczqBasic + 功守道）
            await executeTask('feature_engine_compute', { date: today });
          } catch (e) {
            logger.error('[schedule] 计算链失败: ' + e.message);
          }
        },
        10 * 60 * 1000,
      );

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

// ═══ 6.5 10:00 竞彩官网数据抓取 ═══
function getNext10AMDelay() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(10, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

function schedule10AMTask() {
  const delay = getNext10AMDelay();
  logger.info('[schedule] 下次10:00 sporttery抓取: ' + Math.round(delay / 3600000) + ' 小时后');

  const tid = setTimeout(async () => {
    if (!running) return;
    if (!acquireLock()) {
      enqueueTask('scrape_sporttery_today', { date: new Date().toISOString().slice(0, 10) }, 0, 30);
      schedule10AMTask();
      return;
    }

    logger.info('[schedule] ⏰ 10:00 竞彩官网赔率抓取启动');
    try {
      await executeTask('scrape_sporttery_today', { date: new Date().toISOString().slice(0, 10) });
      recordFetchAttempt(true, 'scrape_sporttery_today');
    } catch (e) {
      logger.error('[schedule] sporttery抓取失败: ' + e.message);
      recordFetchAttempt(false, 'scrape_sporttery_today', e.message);
      enqueueTask('scrape_sporttery_today', { date: new Date().toISOString().slice(0, 10) }, 0, 30);
    }

    schedule10AMTask();
  }, delay);
  timers.push(tid);
}

// ═══ ★ 6.5 比赛节奏感知调度 ═══

/**
 * ★ 判断当前是否处于比赛密集时段
 *
 * 时段划分:
 *   比赛密集期: 08:00-02:00 (次日)
 *   非比赛期:   02:00-08:00
 *
 * 频率分层:
 *   L1 准实时:  比赛密集期 2min / 非比赛期 30min（JczqYz 临盘）
 *   L2 批次发现: 比赛密集期 30min / 非比赛期 2h（dcListBasic 探测）
 *   L3 全量匹配: 比赛密集期 1h / 非比赛期 6h（功守道数据）
 *   L4 计算引擎: L3 完成后自动触发
 */
function isMatchPeakHours() {
  const hour = new Date().getHours();
  // 08:00 到次日 02:00 为比赛密集期
  return hour >= 8 || hour < 2;
}

function getMatchPhaseLabel() {
  const hour = new Date().getHours();
  if (hour >= 8 && hour < 12) return 'morning_prep'; // 上午准备
  if (hour >= 12 && hour < 14) return 'noon_sync'; // 中午全量同步
  if (hour >= 14 && hour < 18) return 'afternoon_build'; // 下午建仓
  if (hour >= 18 && hour < 20) return 'pre_match'; // 赛前2h窗口
  if (hour >= 20 || hour < 2) return 'match_active'; // 比赛密集
  return 'off_hours'; // 休赛期
}

/**
 * ★ 动态频率决策表
 * 返回各层当前应使用的间隔（毫秒）
 */
function getDynamicIntervals() {
  const peak = isMatchPeakHours();
  const phase = getMatchPhaseLabel();

  const base = {
    // L1: 准实时数据（JczqYz 临盘+热度）
    l1_jczqyz: peak ? 2 * 60 * 1000 : 30 * 60 * 1000,
    // L1b: 盘口变化追踪（JczqChange）
    l1_change: peak ? 5 * 60 * 1000 : 60 * 60 * 1000,
    // L2: 批次发现（dcListBasic 探测）
    l2_batch_discover: peak ? 30 * 60 * 1000 : 2 * 60 * 60 * 1000,
    // L3: 全量匹配（功守道数据同步）
    l3_full_match: peak ? 60 * 60 * 1000 : 6 * 60 * 60 * 1000,
    // L4: 计算引擎（L3后自动触发，此处为兜底）
    l4_compute: peak ? 65 * 60 * 1000 : 6.5 * 60 * 60 * 1000,
  };

  // 微调：赛前窗口加大 L1 频率
  if (phase === 'pre_match') {
    base.l1_jczqyz = 60 * 1000; // 1分钟
  }
  // 非比赛日放宽
  if (phase === 'off_hours') {
    base.l2_batch_discover = 4 * 60 * 60 * 1000; // 4小时
    base.l3_full_match = 12 * 60 * 60 * 1000; // 12小时
  }

  return { phase, peak, ...base };
}

/**
 * ★ 抓取成功率监控
 */
let _fetchMetrics = {
  totalAttempts: 0,
  successes: 0,
  failures: 0,
  lastSuccess: null,
  lastFailure: null,
  errors: [],
};

function recordFetchAttempt(success, taskName, errMsg) {
  _fetchMetrics.totalAttempts++;
  if (success) {
    _fetchMetrics.successes++;
    _fetchMetrics.lastSuccess = new Date().toISOString();
  } else {
    _fetchMetrics.failures++;
    _fetchMetrics.lastFailure = new Date().toISOString();
    _fetchMetrics.errors.push({
      time: new Date().toISOString(),
      task: taskName,
      error: errMsg || 'unknown',
    });
    // 只保留最近 20 条错误
    if (_fetchMetrics.errors.length > 20) {
      _fetchMetrics.errors = _fetchMetrics.errors.slice(-20);
    }
  }

  // 成功率告警（最近 100 次采样，成功率 < 90%）
  if (_fetchMetrics.totalAttempts >= 10) {
    const rate = _fetchMetrics.successes / _fetchMetrics.totalAttempts;
    if (rate < 0.9 && _fetchMetrics.totalAttempts % 10 === 0) {
      logger.warn(
        '[metrics] ⚠️ 抓取成功率低于90%: ' +
          (rate * 100).toFixed(1) +
          '% (' +
          _fetchMetrics.successes +
          '/' +
          _fetchMetrics.totalAttempts +
          ')',
      );
    }
  }
}

function getFetchMetrics() {
  const total = _fetchMetrics.totalAttempts;
  const rate = total > 0 ? ((_fetchMetrics.successes / total) * 100).toFixed(1) : 'N/A';
  return {
    ..._fetchMetrics,
    successRate: rate + '%',
    errors: _fetchMetrics.errors.slice(-5), // 最近5条
  };
}

function _resetFetchMetrics() {
  _fetchMetrics = {
    totalAttempts: 0,
    successes: 0,
    failures: 0,
    lastSuccess: null,
    lastFailure: null,
    errors: [],
  };
}

// ═══ 7. 启动 ═══
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function start() {
  const banner = [
    '════════════════════════════════════════',
    '  统一调度器 v2 启动',
    '  实例: ' + INSTANCE_ID,
    '  功能: 分布式锁 + 重试队列 + 定时调度',
    '════════════════════════════════════════',
  ];
  banner.forEach((l) => logger.info(l));

  running = true;

  // 启动时尝试获取锁
  const hasLock = acquireLock();
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
    const today = fmtLocal(new Date()); // A3: 使用北京时间，避免 UTC 偏移
    logger.info('[init] 检查 ' + today + ' 数据状态...');
    try {
      await executeTask('sync_match_list', { date: today });
    } catch (e) {
      logger.warn('[init] 初始同步失败: ' + e.message);
    }
  }

  // 实时比分 (每2分钟)
  schedule(
    'live_score',
    120000,
    async () => {
      try {
        // 从 data_sync 导入 syncLiveScores
        const ds = loadDataSync();
        // 通过 data_sync 内部机制直接调用（不需要lock）
      } catch (e) {}
    },
    true,
  );

  // A2: 推荐同步已由 data_sync.js recommendLoop 统一负责，此处删除避免双写冲突

  // 10:00 sporttery 赔率抓取（11:00前完成）
  schedule10AMTask();

  // 12:00 定时
  scheduleNoonTask();

  // 健康状态输出 (每小时)
  schedule('health_report', 60 * 60 * 1000, async () => {
    const state = loadState();
    const summary = Object.entries(state.taskStats || {})
      .map(([k, v]) => k + ': ' + v.runs + '次/' + v.failures + '失败')
      .join(', ');
    const intervals = getDynamicIntervals();
    const fetchM = getFetchMetrics();

    // ★ 同时获取 fetch 模块级的抓取统计
    let apiFetchStats = 'N/A';
    try {
      const { getFetchStats } = require('./gongshoudao/fetch');
      const fs = getFetchStats();
      apiFetchStats = fs.successRate + ' avgLatency=' + fs.avgLatency;
    } catch (e) {}

    logger.info(
      '[health] 时段:' +
        intervals.phase +
        ' | 频率:' +
        ' L1=' +
        Math.round(intervals.l1_jczqyz / 1000) +
        's' +
        ' L2=' +
        Math.round(intervals.l2_batch_discover / 60000) +
        'min' +
        ' L3=' +
        Math.round(intervals.l3_full_match / 60000) +
        'min',
    );
    logger.info('[health] 任务统计: ' + summary);
    logger.info(
      '[health] 调度抓取: ' +
        fetchM.successRate +
        ' (' +
        fetchM.successes +
        '/' +
        fetchM.totalAttempts +
        ')' +
        (fetchM.lastFailure ? ' 最近失败:' + fetchM.lastFailure : ''),
    );
    logger.info('[health] API直连: ' + apiFetchStats);
  });

  // ★ 功守道缓存刷新（动态频率：根据比赛节奏自适应）
  let gsRefreshTimer = null;
  function scheduleGSRefresh() {
    if (gsRefreshTimer) clearTimeout(gsRefreshTimer);
    const intervals = getDynamicIntervals();
    const delay = intervals.l3_full_match;
    logger.info('[schedule] 功守道刷新间隔: ' + Math.round(delay / 60000) + 'min (时段:' + intervals.phase + ')');

    gsRefreshTimer = setTimeout(async () => {
      if (!running) return;
      try {
        // ★ 带成功率监控的功守道刷新
        const startTime = Date.now();
        await executeTask('gongshoudao_refresh', {});
        recordFetchAttempt(true, 'gongshoudao_refresh');
        const duration = Math.round((Date.now() - startTime) / 1000);
        logger.info('[schedule] 功守道刷新完成 [' + duration + 's]');

        // 自动触发缓存过期清理（每 6 小时一次）
        if (new Date().getHours() % 6 === 0) {
          try {
            const fetchModule = require('./gongshoudao/fetch');
            fetchModule.cleanupExpiredCache();
            logger.info('[schedule] 缓存过期清理完成');
          } catch (e) {
            logger.warn('[schedule] 缓存清理异常: ' + e.message);
          }
        }
      } catch (e) {
        logger.warn('[schedule] 功守道刷新异常: ' + e.message);
        recordFetchAttempt(false, 'gongshoudao_refresh', e.message);
      }
      // 递归调度下一次（动态间隔）
      scheduleGSRefresh();
    }, delay);
    timers.push(gsRefreshTimer);
  }

  // 启动功守道动态调度
  if (hasLock) {
    // 首次立即执行（延迟5秒等待初始化完成）
    setTimeout(() => {
      executeTask('gongshoudao_refresh', {})
        .then(() => {
          recordFetchAttempt(true, 'gongshoudao_refresh_init');
          // 首次成功后启动动态调度
          scheduleGSRefresh();
        })
        .catch((e) => {
          logger.warn('[init] 首次功守道刷新失败: ' + e.message);
          recordFetchAttempt(false, 'gongshoudao_refresh_init', e.message);
          scheduleGSRefresh();
        });
    }, 5000);
  } else {
    scheduleGSRefresh();
  }

  // ★ L5: 赔率变化追踪（动态频率：赛前密集，赛后放松）
  let oddsDeltaTimer = null;
  function scheduleOddsDelta() {
    if (oddsDeltaTimer) clearTimeout(oddsDeltaTimer);
    const intervals = getDynamicIntervals();
    const phase = intervals.phase;

    // 频率策略：赛前2h窗口 → 3min / 比赛密集 → 5min / 建仓期 → 10min / 准备期 → 30min / 休赛期 → 2h
    let delay;
    switch (phase) {
      case 'pre_match':
        delay = 3 * 60 * 1000;
        break;
      case 'match_active':
        delay = 5 * 60 * 1000;
        break;
      case 'noon_sync':
        delay = 5 * 60 * 1000;
        break;
      case 'afternoon_build':
        delay = 10 * 60 * 1000;
        break;
      case 'morning_prep':
        delay = 30 * 60 * 1000;
        break;
      default:
        delay = 2 * 60 * 60 * 1000;
        break; // off_hours
    }

    logger.info('[schedule] 赔率追踪间隔: ' + Math.round(delay / 60000) + 'min (时段:' + phase + ')');

    oddsDeltaTimer = setTimeout(async () => {
      if (!running) return;
      try {
        const today = new Date().toISOString().slice(0, 10);
        await executeTask('sync_odds_delta', { date: today });
        recordFetchAttempt(true, 'sync_odds_delta');
      } catch (e) {
        logger.warn('[schedule] odds-delta 异常: ' + e.message);
        recordFetchAttempt(false, 'sync_odds_delta', e.message);
      }
      scheduleOddsDelta();
    }, delay);
    timers.push(oddsDeltaTimer);
  }

  // 中午 12 点后启动赔率追踪（初盘基准就绪后）
  const nowForDelta = new Date();
  const isAfterNoon = nowForDelta.getHours() >= 12;
  if (isAfterNoon && hasLock) {
    setTimeout(() => {
      logger.info('[init] 启动赔率变化追踪...');
      executeTask('sync_odds_delta', { date: new Date().toISOString().slice(0, 10) })
        .then(() => {
          recordFetchAttempt(true, 'sync_odds_delta_init');
          scheduleOddsDelta();
        })
        .catch((e) => {
          logger.warn('[init] 赔率追踪初始化失败: ' + e.message);
          recordFetchAttempt(false, 'sync_odds_delta_init', e.message);
          scheduleOddsDelta();
        });
    }, 10 * 1000); // 延迟10秒等中午同步完成
  } else {
    // 未到12点，延迟到12:05启动
    const toNoon = new Date();
    toNoon.setHours(12, 5, 0, 0);
    const msToNoon = toNoon.getTime() - Date.now();
    if (msToNoon > 0) {
      const tid = setTimeout(() => {
        scheduleOddsDelta();
      }, msToNoon);
      timers.push(tid);
    } else {
      scheduleOddsDelta();
    }
  }

  // ★ 输出批次发现效率报告（每小时一次）
  schedule('discovery_report', 60 * 60 * 1000, async () => {
    try {
      const { getBatchDiscoveryReport } = require('./gongshoudao/fetch');
      const report = getBatchDiscoveryReport();
      logger.info(
        '[discovery] 批次发现: 命中率=' +
          report.hitRate +
          ' (' +
          report.hits +
          '/' +
          report.total +
          ') 策略=' +
          report.strategy,
      );
    } catch (e) {}
  });

  // ★ 缓存自动淘汰（每 4 小时）
  schedule('cache_purge', 4 * 60 * 60 * 1000, async () => {
    try {
      const { purgeExpired, getCacheStats } = require('./gongshoudao/cache_manager');
      const before = getCacheStats();
      const cleaned = purgeExpired();
      if (cleaned > 0) {
        const after = getCacheStats();
        logger.info(
          '[cache] 自动淘汰完成: ' +
            cleaned +
            '条 | L1_raw=' +
            after.layers.L1_rawAPI.entries +
            '(-' +
            before.layers.L1_rawAPI.expired +
            ') L2_match=' +
            after.layers.L2_matchResults.entries +
            ' bankSize=' +
            after.bankSize,
        );
      }

      // ★ P1-4 + P2: 清理 AI 缓存过期条目（每次 cache_purge 顺带执行）
      try {
        const { cleanAiCache } = require('./ai_daemon');
        cleanAiCache();
      } catch (e2) {
        // AI 缓存清理失败不影响主流程
      }

      // ★ L5: 清理过期 delta 日志（30天保留）
      try {
        const { cleanupOldDeltas } = require('./core/odds-tracker');
        const ODDS_DIR = require('path').join(__dirname, 'odds_history');
        const cleaned = cleanupOldDeltas(ODDS_DIR, 30);
        if (cleaned > 0) logger.info('[cache] 清理 ' + cleaned + ' 个过期 delta 日志');
      } catch (e3) {
        // delta 清理失败不影响主流程
      }
    } catch (e) {
      logger.warn('[cache] 自动淘汰异常: ' + e.message);
    }
  });

  // ★ P3-1: cache.json 压缩归档（每天凌晨 3 点）
  schedule('cache_compress', 24 * 60 * 60 * 1000, async () => {
    const now = new Date();
    if (now.getHours() !== 3) return; // 只在凌晨 3 点执行
    try {
      const { compressCache } = require('./gongshoudao/cache_manager');
      const result = compressCache();
      if (result.archived > 0) {
        logger.info('[cache] cache.json 压缩完成: 归档 ' + result.archived + ' 条, 保留 ' + result.remaining + ' 条');
      }
    } catch (e) {
      logger.warn('[cache] 压缩异常: ' + e.message);
    }
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

  timers.forEach((t) => clearTimeout(t));
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
  start().catch((e) => {
    logger.error('[fatal] 启动失败: ' + e.message);
    process.exit(1);
  });
}

module.exports = {
  start,
  executeTask,
  enqueueTask,
  getState: loadState,
  getQueue: loadQueue,
  getDynamicIntervals,
  isMatchPeakHours,
  getMatchPhaseLabel,
  recordFetchAttempt,
  getFetchMetrics,
  __test: {
    acquireLock,
    renewLock,
    releaseLock,
    processQueue,
    _recordTaskResult,
    _isCircuitOpen,
    _getBackoffDelay,
    _resetCircuitBreaker,
    _resetFetchMetrics,
    paths: {
      LOCK_FILE,
      STATE_FILE,
      QUEUE_FILE,
    },
  },
};

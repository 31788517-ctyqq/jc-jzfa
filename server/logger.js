/**
 * 统一日志模块 v2（winston）
 * 
 * 增强 (P2-1):
 *   - JSON 格式输出（可选，便于 ELK/Loki 分析）
 *   - 性能计时器（startTimer / endTimer）
 *   - 每日数据统计日志（stats.json）
 *   - 向上兼容原有接口
 *
 * 用法：
 *   const logger = require('./logger');              // 通用日志
 *   const logger = require('./logger').child('data_sync'); // 带标签的进程日志
 *   const timer = logger.startTimer('sync_odds');     // 性能计时
 *   // ... 执行操作 ...
 *   timer.end({ count: 20 });                        // 记录耗时
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logDir = path.join(__dirname, '..', 'logs');
const statsDir = path.join(__dirname, '..', 'logs', 'stats');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
if (!fs.existsSync(statsDir)) fs.mkdirSync(statsDir, { recursive: true });

// ── JSON 格式（结构化日志） ──
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// ── 文本格式（兼容原有） ──
const textFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, label, duration, ...meta }) => {
    const prefix = label ? `[${label}] ` : '';
    let dur = '';
    if (duration !== undefined) dur = ` [${duration}ms]`;
    let extra = '';
    const metaKeys = Object.keys(meta).filter(k => k !== 'Symbol(level)' && k !== 'Symbol(message)' && k !== 'Symbol(splat)');
    if (metaKeys.length > 0) {
      const pairs = metaKeys.map(k => `${k}=${meta[k]}`).join(' ');
      extra = ` {${pairs}}`;
    }
    return `${timestamp} [${level.toUpperCase()}] ${prefix}${stack || message}${dur}${extra}`;
  })
);

// ── 判断是否启用 JSON 格式 ──
const useJson = process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production';

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message, label, duration, ...meta }) => {
        const prefix = label ? `[${label}] ` : '';
        let dur = duration ? ` [${duration}ms]` : '';
        let extra = '';
        const cleanMeta = {};
        Object.keys(meta).forEach(k => {
          if (k !== 'Symbol(level)' && k !== 'Symbol(message)' && k !== 'Symbol(splat)' && k !== 'timestamp') {
            cleanMeta[k] = meta[k];
          }
        });
        if (Object.keys(cleanMeta).length > 0) extra = ' ' + JSON.stringify(cleanMeta);
        return `[${level}] ${prefix}${message}${dur}${extra}`;
      })
    )
  }),
  new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    maxsize: 5 * 1024 * 1024,
    maxFiles: 10,
    format: useJson ? jsonFormat : textFormat
  }),
  new winston.transports.File({
    filename: path.join(logDir, 'combined.log'),
    maxsize: 10 * 1024 * 1024,
    maxFiles: 15,
    format: useJson ? jsonFormat : textFormat
  })
];

// 如果启用JSON格式，额外输出一个 JSON 日志文件
if (useJson) {
  transports.push(new winston.transports.File({
    filename: path.join(logDir, 'json.log'),
    maxsize: 20 * 1024 * 1024,
    maxFiles: 5,
    format: jsonFormat
  }));
}

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transports
});

// ═══ 向前兼容的 child() 方法 ═══
function child(label) {
  const meta = { label: label };
  const wrap = {};
  ['info', 'warn', 'error', 'debug', 'verbose'].forEach(lvl => {
    wrap[lvl] = function (msg, extra) {
      const logMeta = Object.assign({}, meta, extra || {});
      logger.log(lvl, msg, logMeta);
    };
  });
  wrap.log = function (lvl, msg, extra) {
    logger.log(lvl, msg, Object.assign({}, meta, extra || {}));
  };
  // ★ 性能计时器 ★
  wrap.startTimer = function (action) {
    const start = Date.now();
    const l = label;
    return {
      end: function (extra) {
        const duration = Date.now() - start;
        const logMeta = Object.assign({ label: l, duration }, extra || {}, { action });
        logger.info(`[perf] ${action} completed`, logMeta);
        return duration;
      },
      getDuration: function () { return Date.now() - start; }
    };
  };
  return wrap;
}

// ═══ 根级别的计时器 ═══
logger.startTimer = function (action) {
  const start = Date.now();
  return {
    end: function (extra) {
      const duration = Date.now() - start;
      const meta = Object.assign({ duration }, extra || {}, { action });
      logger.info(`[perf] ${action} completed`, meta);
      return duration;
    },
    getDuration: function () { return Date.now() - start; }
  };
};

// ═══ 每日统计 ═══
const STATS_FILE = path.join(statsDir, 'daily.json');

function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    }
  } catch (e) {}
  return { days: {} };
}

/**
 * 记录每日统计快照（在 data_sync 的健康检查中调用）
 * @param {Object} snapshot { date, matchesTotal, recsTotal, oddsTotal, apiErrors, apiLatency, statusSummary }
 */
function recordDailyStats(snapshot) {
  try {
    const stats = loadStats();
    const date = snapshot.date || new Date().toISOString().slice(0, 10);
    stats.days[date] = Object.assign(stats.days[date] || {}, snapshot, {
      lastUpdated: new Date().toISOString()
    });
    // 只保留最近90天
    const keys = Object.keys(stats.days).sort();
    if (keys.length > 90) {
      keys.slice(0, keys.length - 90).forEach(k => delete stats.days[k]);
    }
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (e) {
    // 统计写入失败不影响主流程
  }
}

function getDailyStats(date) {
  try {
    const stats = loadStats();
    return date ? (stats.days[date] || null) : stats;
  } catch (e) {
    return null;
  }
}

// ═══ 导出 ═══
module.exports = logger;
module.exports.child = child;
module.exports.recordDailyStats = recordDailyStats;
module.exports.getDailyStats = getDailyStats;

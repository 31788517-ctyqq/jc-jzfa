/**
 * 统一日志模块 v3（winston + winston-daily-rotate-file）
 *
 * V3 增强:
 *   - DailyRotateFile: 按天切割 + 30天自动清理（替代单一大文件）
 *   - getLogger(name): 一行创建带标签的子 Logger
 *   - JSON 格式输出（可选，便于 ELK/Loki 分析）
 *   - 性能计时器（startTimer / endTimer）
 *   - 每日数据统计日志（stats.json）
 *   - 向后兼容所有 v2 API
 *
 * 用法：
 *   const logger = require('./logger');                    // 通用日志
 *   const log = require('./logger').getLogger('data_sync'); // 带标签的子 Logger（推荐）
 *   const log = require('./logger').child('data_sync');     // 同上（兼容旧 API）
 *   const timer = logger.startTimer('sync_odds');           // 性能计时
 *   timer.end({ count: 20 });                               // 记录耗时
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
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
  winston.format.json(),
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
    const metaKeys = Object.keys(meta).filter(
      (k) => k !== 'Symbol(level)' && k !== 'Symbol(message)' && k !== 'Symbol(splat)',
    );
    if (metaKeys.length > 0) {
      const pairs = metaKeys.map((k) => `${k}=${meta[k]}`).join(' ');
      extra = ` {${pairs}}`;
    }
    return `${timestamp} [${level.toUpperCase()}] ${prefix}${stack || message}${dur}${extra}`;
  }),
);

// ── 判断是否启用 JSON 格式 ──
const useJson = process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production';

const transports = [
  // ── Console（开发环境彩色输出） ──
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message, label, duration, ...meta }) => {
        const prefix = label ? `[${label}] ` : '';
        const dur = duration ? ` [${duration}ms]` : '';
        let extra = '';
        const cleanMeta = {};
        Object.keys(meta).forEach((k) => {
          if (k !== 'Symbol(level)' && k !== 'Symbol(message)' && k !== 'Symbol(splat)' && k !== 'timestamp') {
            cleanMeta[k] = meta[k];
          }
        });
        if (Object.keys(cleanMeta).length > 0) extra = ' ' + JSON.stringify(cleanMeta);
        return `[${level}] ${prefix}${message}${dur}${extra}`;
      }),
    ),
  }),
  // ── 错误日志：按日切割 + 保留30天 ──
  new DailyRotateFile({
    filename: path.join(logDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: '20m',
    maxFiles: '30d',
    zippedArchive: false,
    format: useJson ? jsonFormat : textFormat,
  }),
  // ── 综合日志：按日切割 + 保留30天 ──
  new DailyRotateFile({
    filename: path.join(logDir, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '30m',
    maxFiles: '30d',
    zippedArchive: false,
    format: useJson ? jsonFormat : textFormat,
  }),
];

// ── JSON 结构化日志（按日切割） ──
if (useJson) {
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'json-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '30m',
      maxFiles: '14d',
      zippedArchive: false,
      format: jsonFormat,
    }),
  );
}

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transports,
});

logger.on('error', (err) => {
  // 日志写入失败不崩溃进程
  console.error('[logger] transport error:', err.message);
});

// ═══ getLogger(name) = child(name) — 推荐的简写 ═══
function getLogger(label) {
  return child(label);
}

// ═══ 向前兼容的 child() 方法 ═══
function child(label) {
  const meta = { label: label };
  const wrap = {};
  ['info', 'warn', 'error', 'debug', 'verbose'].forEach((lvl) => {
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
      getDuration: function () {
        return Date.now() - start;
      },
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
    getDuration: function () {
      return Date.now() - start;
    },
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
      lastUpdated: new Date().toISOString(),
    });
    // 只保留最近90天
    const keys = Object.keys(stats.days).sort();
    if (keys.length > 90) {
      keys.slice(0, keys.length - 90).forEach((k) => delete stats.days[k]);
    }
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (e) {
    // 统计写入失败不影响主流程
  }
}

function getDailyStats(date) {
  try {
    const stats = loadStats();
    return date ? stats.days[date] || null : stats;
  } catch (e) {
    return null;
  }
}

// ═══ 导出 ═══
module.exports = logger;
module.exports.getLogger = getLogger;   // ★ V3 推荐: getLogger('name')
module.exports.child = child;           // 向后兼容
module.exports.recordDailyStats = recordDailyStats;
module.exports.getDailyStats = getDailyStats;

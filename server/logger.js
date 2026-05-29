/**
 * 统一日志模块（winston）
 * 输出：控制台 + 按大小切割文件（combined.log / error.log）
 *
 * 用法：
 *   const logger = require('./logger');           // 通用日志
 *   const logger = require('./logger').child('data_sync'); // 带标签的进程日志
 */
const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true })
);

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    baseFormat,
    winston.format.printf(({ timestamp, level, message, stack, label }) => {
      const prefix = label ? `[${label}] ` : '';
      return `${timestamp} [${level.toUpperCase()}] ${prefix}${stack || message}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, label }) => {
          const prefix = label ? `[${label}] ` : '';
          return `[${level}] ${prefix}${message}`;
        })
      )
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 10
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 15
    })
  ]
});

/** 创建带标签的子日志器（用于区分不同守护进程） */
function child(label) {
  // 避免 winston child() 递归问题：直接返回带 label 包装的简单对象
  var meta = { label: label };
  var wrap = {};
  ['info','warn','error','debug','verbose'].forEach(function(lvl) {
    wrap[lvl] = function(msg) {
      logger.log(lvl, msg, meta);
    };
  });
  wrap.log = function(lvl, msg) { logger.log(lvl, msg, meta); };
  return wrap;
}

module.exports = logger;
module.exports.child = child;


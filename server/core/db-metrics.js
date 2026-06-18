/**
 * server/core/db-metrics.js
 * SQLite 写入成功率监控 — 轻量级进程内计数器
 *
 * 用法:
 *   const metrics = require('./core/db-metrics');
 *   metrics.recordWrite();    // 写入成功时调用
 *   metrics.recordError();    // 写入失败时调用
 *   const snap = metrics.snapshot(); // 获取统计快照
 *
 * 重置: 每 5 分钟自动重置一次（通过 setInterval）
 */

const counters = {
  writeSuccess: 0,
  writeError: 0,
  writeTotal: 0,
  lastError: null,
  lastErrorTime: null,
  consecutiveErrors: 0,
  startedAt: new Date().toISOString(),
};

const MAX_CONSECUTIVE_ERRORS = 10; // 连续错误超过此阈值触发警报

function recordWrite() {
  counters.writeSuccess++;
  counters.writeTotal++;
  counters.consecutiveErrors = 0;
}

function recordError(errMsg) {
  counters.writeError++;
  counters.writeTotal++;
  counters.consecutiveErrors++;
  counters.lastError = String(errMsg || 'unknown').slice(0, 200);
  counters.lastErrorTime = new Date().toISOString();

  // ★ 自动告警：连续错误超过阈值
  if (counters.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    console.error(
      '[db-metrics] ⚠️ 连续写入失败 ' +
        counters.consecutiveErrors +
        ' 次！最后错误: ' +
        counters.lastError
    );
  }
}

function getConsecutiveErrors() {
  return counters.consecutiveErrors;
}

function getWriteRate() {
  if (counters.writeTotal === 0) return { rate: 1, total: 0, success: 0, error: 0 };
  return {
    rate: counters.writeTotal > 0 ? counters.writeSuccess / counters.writeTotal : 1,
    total: counters.writeTotal,
    success: counters.writeSuccess,
    error: counters.writeError,
    consecutiveErrors: counters.consecutiveErrors,
  };
}

function snapshot() {
  const rate = getWriteRate();
  return {
    status: rate.rate >= 0.95 ? 'ok' : rate.rate >= 0.8 ? 'warn' : 'error',
    writeSuccessRate: Math.round(rate.rate * 10000) / 100 + '%',
    totalWrites: rate.total,
    successWrites: rate.success,
    errorWrites: rate.error,
    consecutiveErrors: rate.consecutiveErrors,
    lastError: counters.lastError,
    lastErrorTime: counters.lastErrorTime,
    startedAt: counters.startedAt,
    uptimeMinutes: Math.floor((Date.now() - new Date(counters.startedAt).getTime()) / 60000),
  };
}

function reset() {
  counters.writeSuccess = 0;
  counters.writeError = 0;
  counters.writeTotal = 0;
  counters.lastError = null;
  counters.lastErrorTime = null;
  counters.consecutiveErrors = 0;
  counters.startedAt = new Date().toISOString();
}

// 每 5 分钟自动重置，确保统计时效性
setInterval(reset, 5 * 60 * 1000);

module.exports = { recordWrite, recordError, snapshot, getWriteRate, getConsecutiveErrors, reset };

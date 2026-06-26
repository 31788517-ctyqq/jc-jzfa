/**
 * server/core/resource-monitor.js — 资源使用率监控
 *
 * 用途: 数据驱动决定何时分离抓取服务到独立服务器
 * 端点: /api?action=system-resources (GET)
 *
 * 指标:
 *   1. CPU 使用率 (1分钟采样)
 *   2. 内存分布 (rss/heapUsed/heapTotal/external/arrayBuffers)
 *   3. DB 适配器状态 + 内存占比估算
 *   4. 进程信息 (uptime/pid/PM2进程名)
 *   5. 事件循环延迟
 *   6. GC 统计 (如果可用)
 *   7. 网络请求活跃数
 */

const os = require('os');

// ═══ CPU 采样 ═══
let _lastCpuUsage = process.cpuUsage();
let _lastCpuTime = Date.now();
let _cpuSamples = [];
const CPU_SAMPLE_INTERVAL = 5000; // 5秒采样
const CPU_MAX_SAMPLES = 12; // 保留最近12个采样（1分钟）

function _sampleCpu() {
  const now = Date.now();
  const elapsedMs = (now - _lastCpuTime) / 1000;
  const usage = process.cpuUsage(_lastCpuUsage);
  const userPercent = (usage.user / 1000) / elapsedMs;
  const sysPercent = (usage.system / 1000) / elapsedMs;
  _lastCpuUsage = process.cpuUsage();
  _lastCpuTime = now;
  _cpuSamples.push({
    time: now,
    userPercent: Math.round(userPercent * 100) / 100,
    sysPercent: Math.round(sysPercent * 100) / 100,
    totalPercent: Math.round((userPercent + sysPercent) * 100) / 100,
  });
  if (_cpuSamples.length > CPU_MAX_SAMPLES) _cpuSamples.shift();
}

// 启动 CPU 采样定时器
let _cpuTimer = setInterval(_sampleCpu, CPU_SAMPLE_INTERVAL);
_cpuTimer.unref(); // 不阻止进程退出

// ═══ 事件循环延迟监控 ═══
let _eventLoopDelays = [];
const EL_SAMPLE_INTERVAL = 10000; // 10秒采样
const EL_MAX_SAMPLES = 6; // 保留最近6个（1分钟）

function _sampleEventLoop() {
  const start = Date.now();
  setTimeout(() => {
    const delay = Date.now() - start - EL_SAMPLE_INTERVAL;
    _eventLoopDelays.push({
      time: start,
      delayMs: Math.max(0, delay),
    });
    if (_eventLoopDelays.length > EL_MAX_SAMPLES) _eventLoopDelays.shift();
  }, EL_SAMPLE_INTERVAL);
}

let _elTimer = setInterval(_sampleEventLoop, EL_SAMPLE_INTERVAL);
_elTimer.unref();

// ═══ 活跃请求计数 ═══
let _activeRequests = 0;
let _totalRequests = 0;
let _requestTimes = []; // 最近请求耗时样本

function trackRequestStart() {
  _activeRequests++;
  _totalRequests++;
}

function trackRequestEnd(durationMs) {
  _activeRequests--;
  _requestTimes.push({ time: Date.now(), duration: durationMs });
  if (_requestTimes.length > 100) _requestTimes.shift();
}

// ═══ 公开 API ═══
function getResourceSnapshot() {
  const mem = process.memoryUsage();
  const uptime = process.uptime();

  // CPU 统计
  const avgCpu = _cpuSamples.length > 0
    ? _cpuSamples.reduce((s, c) => s + c.totalPercent, 0) / _cpuSamples.length
    : 0;
  const maxCpu = _cpuSamples.length > 0
    ? Math.max(..._cpuSamples.map(c => c.totalPercent))
    : 0;
  const sysCpu = os.loadavg(); // [1min, 5min, 15min]

  // 事件循环延迟
  const avgElDelay = _eventLoopDelays.length > 0
    ? _eventLoopDelays.reduce((s, d) => s + d.delayMs, 0) / _eventLoopDelays.length
    : 0;
  const maxElDelay = _eventLoopDelays.length > 0
    ? Math.max(..._eventLoopDelays.map(d => d.delayMs))
    : 0;

  // 请求统计
  const recentRequests = _requestTimes.filter(r => Date.now() - r.time < 60000);
  const avgResponseTime = recentRequests.length > 0
    ? recentRequests.reduce((s, r) => s + r.duration, 0) / recentRequests.length
    : 0;

  // DB 状态
  let dbStatus = 'not_loaded';
  let dbSizeMB = 0;
  try {
    const database = require('../database');
    if (database.isAvailable && database.isAvailable()) {
      dbStatus = 'loaded';
      const fs = require('fs');
      const path = require('path');
      const dbPath = path.join(__dirname, '..', 'midou_data.db');
      if (fs.existsSync(dbPath)) {
        dbSizeMB = Math.round(fs.statSync(dbPath).size / 1048576);
      }
    } else {
      dbStatus = 'unavailable';
    }
  } catch (e) {
    dbStatus = 'error: ' + e.message;
  }

  // Redis 状态
  let redisStatus = 'not_connected';
  try {
    const redis = require('./redis-client');
    if (redis.isConnected()) redisStatus = 'connected';
    else if (redis.isDegraded()) redisStatus = 'degraded_memory';
  } catch (e) {
    redisStatus = 'not_available';
  }

  return {
    timestamp: new Date().toISOString(),
    process: {
      pid: process.pid,
      uptimeSeconds: Math.round(uptime),
      uptimeHours: Math.round(uptime / 3600 * 10) / 10,
      pm2ProcessName: process.env.pm2_process_name || process.name || 'unknown',
      nodeVersion: process.version,
    },
    cpu: {
      processAvg1min: Math.round(avgCpu * 100) / 100,
      processMax1min: Math.round(maxCpu * 100) / 100,
      systemLoad1min: Math.round(sysCpu[0] * 100) / 100,
      systemLoad5min: Math.round(sysCpu[1] * 100) / 100,
      systemLoad15min: Math.round(sysCpu[2] * 100) / 100,
      cpuCount: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || 'unknown',
      samples: _cpuSamples.length,
    },
    memory: {
      rssMB: Math.round(mem.rss / 1048576),
      heapUsedMB: Math.round(mem.heapUsed / 1048576),
      heapTotalMB: Math.round(mem.heapTotal / 1048576),
      externalMB: Math.round(mem.external / 1048576),
      arrayBuffersMB: Math.round((mem.arrayBuffers || 0) / 1048576),
      systemTotalMB: Math.round(os.totalmem() / 1048576),
      systemFreeMB: Math.round(os.freemem() / 1048576),
      systemUsedPercent: Math.round((1 - os.freemem() / os.totalmem()) * 100),
      rssVsSystemPercent: Math.round(mem.rss / os.totalmem() * 100 * 10) / 10,
      dbSizeMB: dbSizeMB,
      dbVsRssPercent: dbSizeMB > 0 ? Math.round(dbSizeMB / (mem.rss / 1048576) * 100) : 0,
    },
    eventLoop: {
      avgDelayMs: Math.round(avgElDelay),
      maxDelayMs: Math.round(maxElDelay),
      samples: _eventLoopDelays.length,
    },
    requests: {
      active: _activeRequests,
      total: _totalRequests,
      avgResponseTimeMs: Math.round(avgResponseTime),
      recentCount1min: recentRequests.length,
      perSecondEstimate: Math.round(recentRequests.length / 60 * 10) / 10,
    },
    db: { status: dbStatus, sizeMB: dbSizeMB },
    redis: { status: redisStatus },
  };
}

module.exports = {
  getResourceSnapshot,
  trackRequestStart,
  trackRequestEnd,
};

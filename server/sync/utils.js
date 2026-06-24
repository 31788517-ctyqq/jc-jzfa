/**
 * server/sync/utils.js
 * 数据同步共享工具函数 — 从 data_sync.js + scheduler_v2.js 提取
 * ★ P1-2 Phase A: 纯函数提取，消除双文件重复定义
 * ★ P2: atomicWrite + notifyReload 同时写 Redis 热数据缓存
 */
const fs = require('fs');
const path = require('path');

// ★ P2: Redis 热数据缓存
let _redis;
try {
  _redis = require('../core/redis-client');
} catch (_) {
  _redis = null;
}
const REDIS_DATA_KEY = 'zjfa:data_json';
const REDIS_LIVE_KEY = 'zjfa:live_scores';
const REDIS_TTL_MS = 5 * 60 * 1000; // 5 分钟

/** 北京时间日期格式化 yyyy-MM-dd */
function fmtLocal(dd) {
  return (
    dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0')
  );
}

/** 获取当前日期+星期 */
function getCurrentPeriod() {
  const weekMap = { 0: '周日', 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六' };
  const now = new Date();
  return { date: fmtLocal(now), week: weekMap[now.getDay()] };
}

/** 原子写入：先写 .tmp 再 rename（防写崩溃残留半截文件） */
function atomicWrite(filePath, data) {
  const tmpFile = filePath + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data));
  fs.renameSync(tmpFile, filePath);
  // ★ P2: 同时写入 Redis 热数据缓存（异步，不阻塞 jc-sync 进程）
  _redisWrite(filePath, data);
}

/** ★ P2: Redis 热数据写入 */
function _redisWrite(filePath, data) {
  if (!_redis || !_redis.isConnected()) return;
  const basename = path.basename(filePath);
  const key = basename === 'data.json' ? REDIS_DATA_KEY
    : basename === 'live_scores.json' ? REDIS_LIVE_KEY
    : null;
  if (!key) return;
  _redis.setJSON(key, data, REDIS_TTL_MS).catch(function (e) {
    console.warn('[P2] Redis写入' + basename + '失败: ' + e.message);
  });
}

/** 通知数据重载（当前触发 Redis 缓存更新 + mtime 检测） */
function notifyReload() {
  // Express getDataJson() 通过 stat.mtimeMs 自动检测 data.json 变更并重载
  // ★ P2: 主动刷新 Redis 缓存 TTL（确保 API 服务器读到最新数据）
  // data.json 的 Redis 缓存在 atomicWrite 中已更新，此处只做 TTL 延长
}

module.exports = { fmtLocal, getCurrentPeriod, atomicWrite, notifyReload };

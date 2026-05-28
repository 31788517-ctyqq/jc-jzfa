/**
 * server/core/health.js
 * 深度健康检查 — 数据库 / 数据完整性 / 外部 API / 系统资源
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

async function deepCheck() {
  const result = {
    status: 'ok',
    time: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    checks: {}
  };

  // ── 1. 内存 ──
  const mem = process.memoryUsage();
  const memMB = Math.round(mem.heapUsed / 1024 / 1024);
  result.checks.memory = {
    status: memMB > 200 ? 'warn' : 'ok',
    heapUsedMB: memMB,
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    rssMB: Math.round(mem.rss / 1024 / 1024),
    message: memMB > 200 ? '堆内存偏高 (' + memMB + ' MB)' : '正常 (' + memMB + ' MB)'
  };

  // ── 2. data.json 完整性 ──
  try {
    const dp = path.join(__dirname, '..', 'data.json');
    const stat = fs.statSync(dp);
    const data = JSON.parse(fs.readFileSync(dp, 'utf8'));
    const matchCount = Object.keys(data.m || {}).length;
    const recCount = Object.keys(data.r || {}).length;
    const ageMinutes = Math.floor((Date.now() - stat.mtimeMs) / 60000);
    result.checks.dataJson = {
      status: matchCount > 0 && ageMinutes < 120 ? 'ok' : ageMinutes > 120 ? 'warn' : 'error',
      fileSizeKB: Math.round(stat.size / 1024),
      matchCount,
      recCount,
      lastModified: new Date(stat.mtimeMs).toISOString(),
      ageMinutes,
      message: matchCount + ' 场比赛, ' + recCount + ' 条推荐, ' + ageMinutes + ' 分钟前更新'
    };
  } catch (e) {
    result.checks.dataJson = { status: 'error', message: '读取失败: ' + e.message };
  }

  // ── 3. SQLite 数据库 ──
  try {
    const database = require('../database');
    if (database.isAvailable && database.isAvailable()) {
      const db = database.getDatabase();
      const count = db.prepare('SELECT COUNT(*) as cnt FROM matches').get().cnt || 0;
      result.checks.database = {
        status: count > 0 ? 'ok' : 'warn',
        matchCount: count,
        type: 'SQLite',
        message: count + ' 条比赛记录'
      };
    } else {
      result.checks.database = { status: 'info', type: 'JSON fallback', message: 'SQLite 不可用，使用 JSON 模式' };
    }
  } catch (e) {
    result.checks.database = { status: 'error', message: e.message };
  }

  // ── 4. 外部 API 可达性 (米斗数据) ──
  try {
    const start = Date.now();
    await new Promise((resolve, reject) => {
      const http = require('http');
      const req = http.get('http://midou310.com', { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => resolve(data.length));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.abort(); reject(new Error('timeout')); });
    });
    result.checks.externalApi = {
      status: 'ok',
      latencyMs: Date.now() - start,
      message: '米斗数据可达 (' + (Date.now() - start) + 'ms)'
    };
  } catch (e) {
    result.checks.externalApi = {
      status: 'error',
      message: '米斗数据不可达: ' + e.message
    };
  }

  // ── 5. 磁盘空间 ──
  try {
    const p = path.join(__dirname, '..');
    const free = require('child_process').execSync(
      process.platform === 'win32' ? 'wmic logicaldisk get freespace' : 'df -k "' + p + '" | tail -1'
    ).toString().trim();
    result.checks.disk = { status: 'ok', freeSpace: free, message: '磁盘可用' };
  } catch (e) {
    result.checks.disk = { status: 'info', message: '无法检查磁盘' };
  }

  // ── 综合状态 ──
  const critical = ['dataJson'];
  if (critical.some(k => result.checks[k] && result.checks[k].status === 'error')) {
    result.status = 'degraded';
  }

  return result;
}

module.exports = { deepCheck };

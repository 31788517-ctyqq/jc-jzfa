/**
 * server/core/file-tracker.js
 * 文件追踪系统 — 关键文件健康监控
 *
 * 能力:
 *   文件存在性 / 文件大小 / 修改时间 / 数据新鲜度 / 快速指纹校验
 *   不计算完整文件哈希（够用不重），仅校验首尾字节 + 文件大小
 *
 * 用法:
 *   const tracker = require('./core/file-tracker');
 *   const snapshot = tracker.snapshot();        // 一次性全量快照
 *   const status  = tracker.check('data.json'); // 单文件检查
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SERVER_DIR = path.join(__dirname, '..');

// ═══ 追踪文件清单 ═══
const FILES_LIST = [
  // ── 核心数据文件 ──
  { key: 'midou_data.db', path: 'midou_data.db', tag: 'db', staleMin: 120, label: 'SQLite 主数据库' },
  { key: 'data.json', path: 'data.json', tag: 'data', staleMin: 120, label: '比赛+推荐数据' },
  { key: 'trends.json', path: 'trends.json', tag: 'data', staleMin: 360, label: '趋势统计' },
  { key: 'ai_cache.json', path: 'ai_cache.json', tag: 'data', staleMin: 360, label: 'AI 分析缓存' },

  // ── 功守道缓存 ──
  { key: 'gs_cache', path: 'gongshoudao/cache.json', tag: 'gs', staleMin: 120, label: '功守道融合缓存' },
  { key: 'stats_bank', path: 'stats_bank.json', tag: 'gs', staleMin: 360, label: '功守道统计银行' },

  // ── 赔率数据 ──
  { key: 'odds_dir', path: 'odds_history', tag: 'odds', staleMin: 60, label: '赔率历史目录' },

  // ── 运行状态 ──
  { key: 'crawl_logs', path: 'midou_data.db', tag: 'meta', staleMin: 1440, label: '爬取日志 (DB)' },
  { key: 'scheduler_json', path: 'scheduler_state.json', tag: 'meta', staleMin: 120, label: '调度器状态' },

  // ── 配置文件 ──
  { key: 'ecosystem_json', path: '../ecosystem.config.json', tag: 'cfg', staleMin: 99999, label: 'PM2 配置' },
];

// ═══ 快速指纹（首尾 512 字节 + 文件大小） ═══
function _quickFingerprint(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return 'empty';
    const fd = fs.openSync(filePath, 'r');
    const headLen = Math.min(512, stat.size);
    const head = Buffer.alloc(headLen);
    fs.readSync(fd, head, 0, headLen, 0);
    // 尾部 512 字节
    let tail = Buffer.alloc(0);
    if (stat.size > 1024) {
      const tailLen = Math.min(512, stat.size - headLen);
      tail = Buffer.alloc(tailLen);
      fs.readSync(fd, tail, 0, tailLen, stat.size - tailLen);
    }
    fs.closeSync(fd);
    const hash = crypto.createHash('md5').update(head).update(tail).update(String(stat.size)).digest('hex');
    return { hash, size: stat.size };
  } catch (e) {
    return null;
  }
}

// ═══ 单文件检查 ═══
function check(filePath, staleMin) {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(SERVER_DIR, filePath);
  const now = Date.now();
  const staleMs = (staleMin || 120) * 60 * 1000;

  // 目录类型：计算文件数 + 最新文件时间
  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(fullPath).filter((f) => f.endsWith('.json'));
      if (files.length === 0) {
        return { status: 'error', category: 'dir', fileCount: 0, message: '目录为空（无 JSON 文件）' };
      }
      let newestMtime = 0;
      files.forEach((f) => {
        const mtime = fs.statSync(path.join(fullPath, f)).mtimeMs;
        if (mtime > newestMtime) newestMtime = mtime;
      });
      const ageMin = Math.floor((now - newestMtime) / 60000);
      return {
        status: ageMin > staleMin ? 'stale' : 'ok',
        category: 'dir',
        fileCount: files.length,
        lastModified: new Date(newestMtime).toISOString(),
        ageMinutes: ageMin,
        message: files.length + ' 个 JSON 文件，最近 ' + ageMin + ' 分钟前更新',
      };
    }
  } catch (e) {
    return { status: 'error', category: 'unknown', message: '路径访问失败: ' + e.message };
  }

  // 文件类型：检查存在性 + 大小 + 时间 + 指纹
  if (!fs.existsSync(fullPath)) {
    return { status: 'missing', category: 'file', message: '文件不存在' };
  }

  try {
    const stat = fs.statSync(fullPath);
    const ageMin = Math.floor((now - stat.mtimeMs) / 60000);
    const fp = _quickFingerprint(fullPath);

    let fileStatus = 'ok';
    const reasons = [];

    if (stat.size === 0) {
      fileStatus = 'corrupt';
      reasons.push('文件大小为 0');
    }
    if (ageMin > staleMin) {
      fileStatus = fileStatus === 'ok' ? 'stale' : fileStatus;
      reasons.push('超过 ' + staleMin + ' 分钟未更新');
    }

    return {
      status: fileStatus,
      category: 'file',
      sizeKB: Math.round((stat.size / 1024) * 10) / 10,
      ageMinutes: ageMin,
      lastModified: new Date(stat.mtimeMs).toISOString(),
      fingerprint: fp ? fp.hash.slice(0, 8) : null,
      message: reasons.length > 0 ? reasons.join('; ') : '正常',
    };
  } catch (e) {
    return { status: 'error', category: 'file', message: '读取失败: ' + e.message };
  }
}

// ═══ 全量快照 ═══
function snapshot() {
  const result = {
    time: new Date().toISOString(),
    summary: { total: 0, ok: 0, stale: 0, missing: 0, corrupt: 0, error: 0 },
    files: {},
  };

  FILES_LIST.forEach((f) => {
    const s = check(f.path, f.staleMin);
    result.summary.total++;
    result.summary[s.status]++;
    result.files[f.key] = {
      ...s,
      label: f.label,
      tag: f.tag,
      path: f.path,
    };
  });

  // 综合状态
  if (result.summary.corrupt > 0 || result.summary.error > 0) {
    result.summary.overall = 'degraded';
  } else if (result.summary.missing > 0) {
    result.summary.overall = 'warning';
  } else if (result.summary.stale > 0) {
    result.summary.overall = result.summary.stale >= 3 ? 'warning' : 'stale';
  } else {
    result.summary.overall = 'healthy';
  }

  return result;
}

// ═══ DB 完整性（复用 database.js 已内置的 integirty_check） ═══
function checkDbIntegrity() {
  try {
    const database = require('../database');
    if (!database.isAvailable || !database.isAvailable()) {
      return { status: 'info', message: 'SQLite 不可用' };
    }
    const db = database.getDatabase();
    if (!db) return { status: 'info', message: 'DB 实例为空' };

    const result = db.prepare('PRAGMA integrity_check').get();
    const ok = result && result['integrity_check'] === 'ok';
    return {
      status: ok ? 'ok' : 'error',
      integrity: result ? result['integrity_check'] : 'unknown',
      message: ok ? '数据库完整性正常' : '数据库完整性异常: ' + JSON.stringify(result),
    };
  } catch (e) {
    return { status: 'error', message: '完整性检查异常: ' + e.message };
  }
}

// ═══ 获取追踪文件清单（供 API 使用） ═══
function getFileList() {
  return FILES_LIST.map((f) => ({ key: f.key, label: f.label, tag: f.tag, staleMin: f.staleMin }));
}

module.exports = { snapshot, check, checkDbIntegrity, getFileList, FILES_LIST };

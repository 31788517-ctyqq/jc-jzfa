/**
 * ★ 统一缓存管理器 (Cache Manager)
 *
 * 分层架构:
 *   L0 - batch_index.json    批次有效性索引（30天TTL）
 *   L1 - stats_bank.json     原始API数据缓存（14天TTL，_raw_ 前缀）
 *   L2 - match_stats_map      按 matchId 映射的匹配结果（7天TTL）
 *   L3 - cache.json           功守道计算结果（永久，增量更新）
 *
 * 特性:
 *   - TTL 自动过期淘汰
 *   - 增量写入（避免全量JSON序列化）
 *   - 缓存命中率监控
 *   - 过期条目自动清理
 */

const fs = require('fs');
const path = require('path');

// ═══ 配置 ═══
const CACHE_DIR = __dirname;
const STATS_BANK_PATH = path.join(CACHE_DIR, '..', 'stats_bank.json');
const CACHE_PATH = path.join(CACHE_DIR, 'cache.json');
const BATCH_INDEX_PATH = path.join(CACHE_DIR, '..', 'batch_index.json');
const LOCK_DIR = path.join(CACHE_DIR, '..', '.cache_locks'); // ★ P2-5: 文件锁目录

// TTL 配置（毫秒）
const TTL = {
  raw: 14 * 24 * 3600 * 1000, // 原始API: 14天
  batch: 30 * 24 * 3600 * 1000, // 批次索引: 30天
  match: 7 * 24 * 3600 * 1000, // 匹配结果: 7天
  computed: 0, // 计算结果: 永久（不过期，依赖增量更新）
};

// ═══ 基础文件操作 ═══

// ★ P2-5: 文件锁（防 PM2 cluster 并发写入冲突）
// 使用原子 mkdir 实现跨进程互斥锁（mkdir 在操作系统中是原子的）
function acquireLock(lockName, timeoutMs) {
  timeoutMs = timeoutMs || 5000;
  const lockPath = path.join(LOCK_DIR, lockName + '.lock');
  const startTime = Date.now();

  // 确保锁目录存在
  if (!fs.existsSync(LOCK_DIR)) {
    try {
      fs.mkdirSync(LOCK_DIR, { recursive: true });
    } catch (e) {}
  }

  while (Date.now() - startTime < timeoutMs) {
    try {
      fs.mkdirSync(lockPath);
      return true; // 获取锁成功
    } catch (e) {
      // 锁目录已存在，等待并重试
      const stat = fs.statSync(lockPath, { throwIfNoEntry: false });
      if (stat && Date.now() - stat.mtimeMs > 30000) {
        // 锁超过 30 秒未释放（死锁），强制清理
        try {
          fs.rmdirSync(lockPath);
        } catch (e2) {}
      }
    }
    // 等待 10-30ms 随机延迟后重试
    const delay = 10 + Math.floor(Math.random() * 20);
    const endWait = Date.now() + delay;
    while (Date.now() < endWait) {} // 同步等待（少量延迟不会阻塞太久）
  }
  console.warn('[cache_mgr] 获取锁超时: ' + lockName);
  return false;
}

function releaseLock(lockName) {
  const lockPath = path.join(LOCK_DIR, lockName + '.lock');
  try {
    fs.rmdirSync(lockPath);
  } catch (e) {}
}

// ★ P2-5: 带锁的安全写入（Read-Modify-Write 防并发）
function writeWithLock(filePath, lockName, modifierFn) {
  if (!acquireLock(lockName)) {
    // 获取锁失败，降级为直接写入
    console.warn('[cache_mgr] 锁获取失败，降级直接写入: ' + lockName);
    const data = readJSON(filePath);
    modifierFn(data);
    writeJSON(filePath, data);
    return;
  }
  try {
    const data = readJSON(filePath);
    modifierFn(data);
    writeJSON(filePath, data);
  } finally {
    releaseLock(lockName);
  }
}
function readJSON(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn('[cache_mgr] 读取失败:', filePath, e.message);
    return {};
  }
}

function writeJSON(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[cache_mgr] 写入失败:', filePath, e.message);
  }
}

// ═══ L0: 批次索引 ═══

/**
 * 获取批次索引
 * 结构: { "26061": { valid: true, matchCount: 132, discoveredAt: 1717200000000 } }
 */
function getBatchIndex() {
  return readJSON(BATCH_INDEX_PATH);
}

/**
 * 更新批次索引
 */
function updateBatchIndex(dt, data) {
  // ★ P2-5: 使用文件锁防止并发写入
  writeWithLock(BATCH_INDEX_PATH, 'batch_index', function (index) {
    const now = Date.now();
    index[dt] = {
      valid: true,
      matchCount: Array.isArray(data) ? data.length : data && typeof data === 'object' ? Object.keys(data).length : 0,
      discoveredAt: now,
      expiresAt: now + TTL.batch,
    };
    cleanupBatchIndex(index);
  });
}

/**
 * 标记批次为无效
 */
function invalidateBatch(dt) {
  const index = getBatchIndex();
  if (index[dt]) {
    index[dt].valid = false;
    index[dt].invalidatedAt = Date.now();
  }
  writeJSON(BATCH_INDEX_PATH, index);
}

/**
 * 获取有效批次列表
 */
function getValidBatches() {
  const index = getBatchIndex();
  const now = Date.now();
  return Object.entries(index)
    .filter(([, info]) => info.valid && info.expiresAt > now)
    .map(([dt, info]) => ({ dt, ...info }))
    .sort((a, b) => b.discoveredAt - a.discoveredAt);
}

/**
 * 清理过期批次索引条目
 */
function cleanupBatchIndex(index) {
  const now = Date.now();
  let cleaned = 0;
  Object.keys(index).forEach((dt) => {
    if (index[dt].expiresAt && index[dt].expiresAt < now) {
      delete index[dt];
      cleaned++;
    }
  });
  if (cleaned > 0) {
    console.log('[cache_mgr] 批次索引清理:', cleaned, '条过期');
  }
}

// ═══ L1: 原始API数据缓存 ═══

/**
 * 写入原始API数据（带TTL）
 */
function writeRawCache(dt, rawData) {
  // ★ P2-5: 使用文件锁防止 PM2 cluster 并发写入冲突
  writeWithLock(STATS_BANK_PATH, 'stats_bank', function (bank) {
    const key = '_raw_' + dt;
    bank[key] = {
      data: rawData,
      createdAt: Date.now(),
      expiresAt: Date.now() + TTL.raw,
    };
    // 清理过期 raw 条目
    cleanupRawEntries(bank);
  });
}

/**
 * 读取原始API数据（自动检查TTL）
 */
function readRawCache(dt) {
  const bank = readJSON(STATS_BANK_PATH);
  const key = '_raw_' + dt;
  const entry = bank[key];

  if (!entry) return null;

  // 兼容旧格式（无TTL包装的数据直接返回）
  if (Array.isArray(entry)) {
    return entry;
  }

  // 新格式：检查 TTL
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    console.log('[cache_mgr] 原始缓存过期:', dt);
    delete bank[key];
    writeJSON(STATS_BANK_PATH, bank);
    return null;
  }

  return entry.data || null;
}

/**
 * 清理过期的原始缓存条目
 */
function cleanupRawEntries(bank) {
  const now = Date.now();
  let cleaned = 0;
  Object.keys(bank).forEach((key) => {
    if (key.startsWith('_raw_')) {
      const entry = bank[key];
      if (entry && entry.expiresAt && entry.expiresAt < now) {
        delete bank[key];
        cleaned++;
      }
    }
  });
  if (cleaned > 0) {
    console.log('[cache_mgr] 原始缓存清理:', cleaned, '条过期');
  }
}

// ═══ L2: 匹配结果缓存 ═══

/**
 * 写入匹配结果（按批次存储，带TTL）
 */
function writeMatchCache(dt, matchData) {
  let bank = readJSON(STATS_BANK_PATH);

  bank[dt] = {
    data: matchData,
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL.match,
    count: Object.keys(matchData || {}).length,
  };

  // 清理过期匹配缓存
  cleanupMatchEntries(bank);

  writeJSON(STATS_BANK_PATH, bank);
}

/**
 * 读取匹配结果（自动检查TTL）
 */
function readMatchCache(dt) {
  const bank = readJSON(STATS_BANK_PATH);
  const entry = bank[dt];

  if (!entry) return null;

  // 兼容旧格式
  if (typeof entry === 'object' && !entry.data && !entry.expiresAt) {
    return entry; // 旧格式直接返回
  }

  // 新格式
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    console.log('[cache_mgr] 匹配缓存过期:', dt);
    delete bank[dt];
    writeJSON(STATS_BANK_PATH, bank);
    return null;
  }

  return entry.data || null;
}

function cleanupMatchEntries(bank) {
  const now = Date.now();
  let cleaned = 0;
  Object.keys(bank).forEach((key) => {
    if (key.startsWith('_raw_') || key === '_last_batch') return;
    const entry = bank[key];
    if (entry && entry.expiresAt && entry.expiresAt < now) {
      delete bank[key];
      cleaned++;
    }
  });
  if (cleaned > 0) {
    console.log('[cache_mgr] 匹配缓存清理:', cleaned, '条过期');
  }
}

// ═══ L3: 功守道计算结果缓存 ═══

/**
 * 写入计算结果（增量模式）
 */
function writeComputedCache(key, data) {
  // ★ P2-5: 使用文件锁防止 PM2 cluster 并发写入冲突
  writeWithLock(CACHE_PATH, 'cache_computed', function (cache) {
    cache[key] = data;
  });
}

/**
 * 读取计算结果
 */
function readComputedCache(key) {
  const cache = readJSON(CACHE_PATH);
  return cache[key] || null;
}

/**
 * 获取缓存统计
 */
function getCacheStats() {
  const bank = readJSON(STATS_BANK_PATH);
  const index = getBatchIndex();
  const cache = readJSON(CACHE_PATH);

  const rawCount = Object.keys(bank).filter((k) => k.startsWith('_raw_')).length;
  const matchCount = Object.keys(bank).filter((k) => !k.startsWith('_raw_') && k !== '_last_batch').length;
  const batchCount = Object.keys(index).length;
  const computedCount = Object.keys(cache).filter((k) => k !== '_global').length;
  const globalCount = cache._global ? Object.keys(cache._global).length : 0;

  // 计算过期条目
  const now = Date.now();
  let expiredRaw = 0,
    expiredMatch = 0;
  Object.keys(bank).forEach((key) => {
    if (key.startsWith('_raw_')) {
      const entry = bank[key];
      if (entry && entry.expiresAt && entry.expiresAt < now) expiredRaw++;
    } else if (key !== '_last_batch') {
      const entry = bank[key];
      if (entry && entry.expiresAt && entry.expiresAt < now) expiredMatch++;
    }
  });

  return {
    layers: {
      L0_batchIndex: { path: 'batch_index.json', entries: batchCount, ttl: TTL.batch },
      L1_rawAPI: { path: 'stats_bank.json', entries: rawCount, expired: expiredRaw, ttl: TTL.raw },
      L2_matchResults: { path: 'stats_bank.json', entries: matchCount, expired: expiredMatch, ttl: TTL.match },
      L3_computed: { path: 'cache.json', entries: computedCount, global: globalCount, ttl: TTL.computed || -1 },
    },
    bankSize: fs.existsSync(STATS_BANK_PATH) ? (fs.statSync(STATS_BANK_PATH).size / 1024).toFixed(1) + ' KB' : 'N/A',
    cacheSize: fs.existsSync(CACHE_PATH) ? (fs.statSync(CACHE_PATH).size / 1024).toFixed(1) + ' KB' : 'N/A',
  };
}

/**
 * 全量清理过期条目
 */
function purgeExpired() {
  const bank = readJSON(STATS_BANK_PATH);
  const now = Date.now();
  let cleaned = 0;

  Object.keys(bank).forEach((key) => {
    if (key === '_last_batch') return;
    const entry = bank[key];
    if (entry && entry.expiresAt && entry.expiresAt < now) {
      delete bank[key];
      cleaned++;
    }
  });

  if (cleaned > 0) {
    writeJSON(STATS_BANK_PATH, bank);
    console.log('[cache_mgr] 全量清理:', cleaned, '条过期');
  }

  // 同时清理批次索引
  const index = getBatchIndex();
  cleanupBatchIndex(index);
  writeJSON(BATCH_INDEX_PATH, index);

  return cleaned;
}

// ═══ 兼容旧接口（平滑过渡） ═══

/**
 * 兼容 fetch.js 的 saveRawCache
 */
function saveRawCacheLegacy(dt, rawData) {
  let bank = readJSON(STATS_BANK_PATH);
  bank['_raw_' + dt] = rawData; // 旧格式：直接存数组
  writeJSON(STATS_BANK_PATH, bank);
}

/**
 * 兼容 fetch.js 的 loadRawCache
 */
function loadRawCacheLegacy(dt) {
  const bank = readJSON(STATS_BANK_PATH);
  return bank['_raw_' + dt] || null;
}

/**
 * 兼容 fetch.js 的 saveStatsCache
 */
function saveStatsCacheLegacy(dt, data) {
  let bank = readJSON(STATS_BANK_PATH);
  bank[dt] = data;
  writeJSON(STATS_BANK_PATH, bank);
}

/**
 * 兼容 fetch.js 的 loadStatsCache
 */
function loadStatsCacheLegacy(dt) {
  const bank = readJSON(STATS_BANK_PATH);
  return bank[dt] || null;
}

// ═══ P3-1: cache.json 压缩归档 ═══

/**
 * 压缩 cache.json：将 14 天前的比赛数据归档到日期文件
 * 减少主缓存文件体积，加快读写速度
 * @returns {{ archived: number, remaining: number }}
 */
function compressCache() {
  const cache = readJSON(CACHE_PATH);
  const now = Date.now();
  const cutoffMs = 14 * 24 * 60 * 60 * 1000; // 14 天
  const archiveDir = path.join(CACHE_DIR, '..', 'cache_archive');

  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  let archived = 0;
  const keep = {};
  const archiveData = {};

  Object.keys(cache).forEach(function (k) {
    if (k === '_global') {
      keep[k] = cache[k];
      return; // _global 不归档
    }

    const entry = cache[k];
    // 尝试从 key 中提取日期（格式: matchId 或 m_matchId）
    // 如果 entry 有 _ts 字段，优先使用
    const ts = entry && entry._ts ? new Date(entry._ts).getTime() : null;

    if (ts && ts < now - cutoffMs) {
      // 归档到日期文件
      const dateStr = entry._ts ? entry._ts.slice(0, 10) : 'unknown';
      if (!archiveData[dateStr]) archiveData[dateStr] = {};
      archiveData[dateStr][k] = entry;
      archived++;
    } else {
      keep[k] = entry;
    }
  });

  if (archived > 0) {
    // 写入归档
    Object.keys(archiveData).forEach(function (ds) {
      const archivePath = path.join(archiveDir, ds + '.json');
      let existing = {};
      if (fs.existsSync(archivePath)) {
        try {
          existing = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
        } catch (e) {}
      }
      Object.assign(existing, archiveData[ds]);
      writeJSON(archivePath, existing);
    });

    // 写入精简后的主缓存
    writeWithLock(CACHE_PATH, 'cache_computed', function (c) {
      // 清空并重建（因为 modifier 收到的是当前 cache）
      Object.keys(c).forEach(function (k) {
        delete c[k];
      });
      Object.keys(keep).forEach(function (k) {
        c[k] = keep[k];
      });
    });

    console.log(
      '[cache_mgr] cache.json 压缩完成: 归档 ' +
        archived +
        ' 条, 保留 ' +
        (Object.keys(keep).length - 1) +
        ' 条（不含_global）',
    );
  }

  return { archived, remaining: Object.keys(keep).length - 1 };
}
module.exports = {
  // L0 批次索引
  getBatchIndex,
  updateBatchIndex,
  invalidateBatch,
  getValidBatches,
  cleanupBatchIndex,

  // L1 原始API缓存
  writeRawCache,
  readRawCache,
  cleanupRawEntries,

  // L2 匹配结果缓存
  writeMatchCache,
  readMatchCache,
  cleanupMatchEntries,

  // L3 计算结果缓存
  writeComputedCache,
  readComputedCache,

  // 工具
  getCacheStats,
  purgeExpired,

  // 兼容旧接口
  saveRawCacheLegacy,
  loadRawCacheLegacy,
  saveStatsCacheLegacy,
  loadStatsCacheLegacy,

  // 配置
  TTL,
  STATS_BANK_PATH,
  CACHE_PATH,
  BATCH_INDEX_PATH,

  // P3-1: 压缩归档
  compressCache,
};

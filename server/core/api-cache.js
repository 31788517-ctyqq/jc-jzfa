/**
 * API 响应持久化缓存 (P0 - 文件缓存方案)
 *
 * 双层: 内存(L1) + 磁盘 JSON(L2)
 * 流程:
 *   get(key) → L1命中 → 返回
 *            → L2命中 → 回填L1 → 返回
 *            → miss  → null
 *   set(key, data) → 写入L1 + L2
 *
 * 缓存键: {endpoint}_{date}_{extra}.json → _server_data/cache/
 * 自动清理: >7 天旧文件
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', '_server_data', 'cache');
const MAX_CACHE_AGE = 7 * 24 * 60 * 60 * 1000; // 7 天

// L1: 内存缓存
const _mem = {};

// 确保目录存在
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// ── 工具: 缓存文件路径 ──
function _filePath(key) {
  // key 格式: "home-bundle_2026-06-21" 或 "plan-list_2026-06-21_expert"
  return path.join(CACHE_DIR, key + '.json');
}

// ── L2: 读磁盘 ──
function _readDisk(key) {
  try {
    const fp = _filePath(key);
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, 'utf8');
    const entry = JSON.parse(raw);
    // 检查是否过期
    if (entry.expires && Date.now() > entry.expires) {
      // 过期但保留文件（作为冷备），从内存移除即可
      return null;
    }
    return entry.data;
  } catch (e) {
    return null;
  }
}

// ── L2: 写磁盘 ──
function _writeDisk(key, data, ttl) {
  try {
    const entry = {
      key: key,
      data: data,
      cachedAt: Date.now(),
      expires: ttl ? Date.now() + ttl : 0,
    };
    const fp = _filePath(key);
    fs.writeFileSync(fp, JSON.stringify(entry), 'utf8');
  } catch (e) {
    // 写磁盘失败降级 → 仅内存可用
  }
}

// ── 自动清理过期文件（异步，不阻塞） ──
function _cleanStale() {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const now = Date.now();
    let deleted = 0;
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const fp = path.join(CACHE_DIR, f);
      try {
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > MAX_CACHE_AGE) {
          fs.unlinkSync(fp);
          deleted++;
        }
      } catch (_) {}
    }
    if (deleted > 0) {
      console.log('[api-cache] 清理 ' + deleted + ' 个过期缓存文件');
    }
  } catch (_) {}
}

// 启动时清理一次
setTimeout(_cleanStale, 10000).unref();
// 每天清理一次
setInterval(_cleanStale, 24 * 60 * 60 * 1000).unref();

// ═══ 公开 API ═══

/**
 * 读取缓存（L1→L2 自动回退）
 * @param {string} key - 缓存键, 格式 "endpoint_date_extra"
 * @param {number} [maxAge] - 内存最大有效期 ms, 默认不限制
 * @returns {*} 缓存数据或 null
 */
function get(key, maxAge) {
  // L1: 内存
  const mem = _mem[key];
  if (mem) {
    if (!maxAge || Date.now() - mem.time < maxAge) {
      return mem.data;
    }
  }

  // L2: 磁盘
  const disk = _readDisk(key);
  if (disk) {
    // 回填 L1
    _mem[key] = { data: disk, time: Date.now() };
    return disk;
  }

  return null;
}

/**
 * 写入缓存（L1 + L2 双写）
 * @param {string} key
 * @param {*} data
 * @param {number} [ttl] - 磁盘 TTL ms, 默认永不过期（只靠文件 mtime 清理）
 */
function set(key, data, ttl) {
  // L1
  _mem[key] = { data: data, time: Date.now() };
  // L2 (异步写盘，避免阻塞响应)
  setImmediate(() => _writeDisk(key, data, ttl));
}

/**
 * 清除单个缓存
 */
function del(key) {
  delete _mem[key];
  try {
    const fp = _filePath(key);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (_) {}
}

/**
 * 预热: 从磁盘批量加载到内存
 * @param {string} prefix - 缓存键前缀
 * @returns {number} 加载数量
 */
function warmFromDisk(prefix) {
  let loaded = 0;
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const now = Date.now();
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      if (prefix && !f.startsWith(prefix)) continue;
      try {
        const raw = fs.readFileSync(path.join(CACHE_DIR, f), 'utf8');
        const entry = JSON.parse(raw);
        if (entry.expires && now > entry.expires) continue;
        _mem[entry.key] = { data: entry.data, time: entry.cachedAt || now };
        loaded++;
      } catch (_) {}
    }
  } catch (_) {}
  if (loaded > 0) console.log('[api-cache] 预热 ' + loaded + ' 个缓存到内存');
  return loaded;
}

/**
 * 统计信息
 */
function stats() {
  const memKeys = Object.keys(_mem);
  let diskCount = 0;
  try {
    diskCount = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json')).length;
  } catch (_) {}
  return {
    memory: memKeys.length,
    disk: diskCount,
    memoryKeys: memKeys.slice(-10),
    dir: CACHE_DIR,
  };
}

module.exports = { get, set, del, warmFromDisk, stats };

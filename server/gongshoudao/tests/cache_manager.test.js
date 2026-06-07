/**
 * P2: cache_manager.test.js — 统一缓存管理器 单元测试
 * 覆盖: read/write 各层缓存、TTL检查、过期清理、压缩归档
 *
 * ★ 使用 fs mock (__mocks__/fs.js)
 */
jest.mock('fs');
const fs = require('fs');
const path = require('path');

// 需要在 mock fs 生效后 require
const {
  getBatchIndex, updateBatchIndex, invalidateBatch, getValidBatches,
  writeRawCache, readRawCache,
  writeMatchCache, readMatchCache,
  writeComputedCache, readComputedCache,
  getCacheStats, purgeExpired,
  TTL, compressCache,
} = require('../cache_manager');

// ═══ 测试辅助 ═══
function resetAll() {
  if (fs.resetMockFs) fs.resetMockFs();
}

// ═══ 批次索引 ═══

describe('cache_manager — 批次索引 (L0)', () => {
  beforeEach(resetAll);

  it('getBatchIndex: 空文件 → 返回空对象', () => {
    const index = getBatchIndex();
    expect(index).toEqual({});
  });

  it('updateBatchIndex: 写入批次', () => {
    updateBatchIndex('26061', [{ id: 1 }, { id: 2 }]);
    const index = getBatchIndex();
    expect(index['26061']).toBeDefined();
    expect(index['26061'].valid).toBe(true);
    expect(index['26061'].matchCount).toBe(2);
    expect(index['26061'].expiresAt).toBeDefined();
  });

  it('invalidateBatch: 标记无效', () => {
    updateBatchIndex('26062', [{}]);
    invalidateBatch('26062');
    const index = getBatchIndex();
    expect(index['26062'].valid).toBe(false);
  });

  it('getValidBatches: 仅返回有效批次', () => {
    updateBatchIndex('26061', [{}, {}]);
    const valid = getValidBatches();
    expect(valid.length).toBeGreaterThanOrEqual(0);
    valid.forEach(function (b) { expect(b.valid).toBe(true); });
  });
});

// ═══ 原始API缓存 (L1) ═══

describe('cache_manager — 原始API缓存 (L1)', () => {
  beforeEach(resetAll);

  it('writeRawCache → readRawCache 往返', () => {
    writeRawCache('26061', [{ name: 'test' }]);
    const data = readRawCache('26061');
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].name).toBe('test');
  });

  it('readRawCache: 不存在的批次 → null', () => {
    expect(readRawCache('99999')).toBe(null);
  });
});

// ═══ 匹配结果缓存 (L2) ═══

describe('cache_manager — 匹配结果缓存 (L2)', () => {
  beforeEach(resetAll);

  it('writeMatchCache → readMatchCache 往返', () => {
    writeMatchCache('26061', { m001: { home: 'A', away: 'B' } });
    const data = readMatchCache('26061');
    expect(data).not.toBe(null);
    expect(data.m001.home).toBe('A');
  });

  it('readMatchCache: 不存在 → null', () => {
    expect(readMatchCache('88888')).toBe(null);
  });
});

// ═══ 计算结果缓存 (L3) ═══

describe('cache_manager — 计算结果缓存 (L3)', () => {
  beforeEach(resetAll);

  it('writeComputedCache → readComputedCache 往返', () => {
    writeComputedCache('match_001', { fusion: 'strong', score: 85 });
    const data = readComputedCache('match_001');
    expect(data.fusion).toBe('strong');
    expect(data.score).toBe(85);
  });

  it('readComputedCache: 不存在 → null', () => {
    expect(readComputedCache('no-such-key')).toBe(null);
  });
});

// ═══ 缓存统计 ═══

describe('cache_manager — getCacheStats 统计', () => {
  beforeEach(resetAll);

  it('空缓存 → 返回零条目统计', () => {
    const stats = getCacheStats();
    expect(stats).toHaveProperty('layers');
    expect(stats.layers.L0_batchIndex).toBeDefined();
    expect(stats.layers.L1_rawAPI).toBeDefined();
    expect(stats.layers.L2_matchResults).toBeDefined();
    expect(stats.layers.L3_computed).toBeDefined();
    expect(stats).toHaveProperty('bankSize');
    expect(stats).toHaveProperty('cacheSize');
  });
});

// ═══ 全量清理 ═══

describe('cache_manager — purgeExpired 全量清理', () => {
  beforeEach(resetAll);

  it('空缓存 → purgeExpired 返回 0', () => {
    expect(purgeExpired()).toBe(0);
  });
});

// ═══ compressCache 压缩归档 ═══

describe('cache_manager — compressCache 压缩归档', () => {
  beforeEach(resetAll);

  it('空缓存 → archived=0', () => {
    const result = compressCache();
    expect(result.archived).toBe(0);
  });
});

// ═══ TTL 配置 ═══

describe('cache_manager — TTL 配置', () => {
  it('raw TTL = 14天', () => {
    expect(TTL.raw).toBe(14 * 24 * 3600 * 1000);
  });

  it('batch TTL = 30天', () => {
    expect(TTL.batch).toBe(30 * 24 * 3600 * 1000);
  });

  it('match TTL = 7天', () => {
    expect(TTL.match).toBe(7 * 24 * 3600 * 1000);
  });
});

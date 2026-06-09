/**
 * P1: midou.test.js — 米斗数据服务 单元测试
 * 覆盖: 配置常量、clearCache、invalidateToken、safeApiCall
 * 注意: login/fetchMatches/fetchRecommends 依赖外部API，
 *       在此仅测试纯逻辑/缓存管理部分
 */
const midou = require('../core/midou');

describe('midou — CONFIG 配置', () => {
  it('MIDOU_BASE 指向米斗', () => {
    expect(midou.CONFIG.MIDOU_BASE).toContain('midou310.com');
    expect(midou.CONFIG.MIDOU_BASE).toContain('mdsj');
  });

  it('MOBILE 和 PASSWORD 从环境变量读取', () => {
    // 环境变量可能未设置，但字段应存在
    expect(midou.CONFIG).toHaveProperty('MOBILE');
    expect(midou.CONFIG).toHaveProperty('PASSWORD');
  });

  it('BACKUP_MOBILE 和 BACKUP_PASSWORD 备选存在', () => {
    expect(midou.CONFIG).toHaveProperty('BACKUP_MOBILE');
    expect(midou.CONFIG).toHaveProperty('BACKUP_PASSWORD');
  });
});

describe('midou — 缓存管理', () => {
  it('clearCache 不抛异常', () => {
    expect(() => midou.clearCache()).not.toThrow();
  });

  it('invalidateToken 不抛异常', () => {
    expect(() => midou.invalidateToken()).not.toThrow();
  });
});

describe('midou — safeApiCall', () => {
  it('正常函数 → 返回结果', async () => {
    const result = await midou.safeApiCall(() => Promise.resolve('success'));
    expect(result).toBe('success');
  });

  it('函数失败 → 降级到 fallback', async () => {
    const result = await midou.safeApiCall(
      () => Promise.reject(new Error('fail')),
      () => Promise.resolve('fallback'),
    );
    expect(result).toBe('fallback');
  });

  it('函数失败 + 无fallback → 抛出异常', async () => {
    await expect(midou.safeApiCall(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
  });

  it('同步函数也支持', async () => {
    const result = await midou.safeApiCall(() => 42);
    expect(result).toBe(42);
  });
});

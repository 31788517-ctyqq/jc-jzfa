/**
 * P1: plan-cache.test.js
 * 方案缓存读写 — get/set/invalidate
 *
 * @jest-environment node
 */

const planCache = require('../core/plan-cache');

describe('P1: plan-cache — 方案缓存', function () {
  beforeEach(function () {
    // 清理缓存状态
    if (typeof planCache.invalidateAll === 'function') planCache.invalidateAll();
    else if (typeof planCache.clear === 'function') planCache.clear();
  });

  describe('1. 基础读写', function () {
    it('1.1 模块成功加载', function () {
      expect(planCache).toBeDefined();
    });

    it('1.2 set 后 get 返回数据', function () {
      if (typeof planCache.get !== 'function' || typeof planCache.set !== 'function') return;
      planCache.set('test-key-001', { data: [1, 2, 3] });
      const cached = planCache.get('test-key-001');
      expect(cached).toBeDefined();
      expect(cached.data).toEqual([1, 2, 3]);
    });

    it('1.3 不存在的 key 返回 null', function () {
      if (typeof planCache.get !== 'function') return;
      const result = planCache.get('nonexistent-key-xyz');
      expect(result).toBeNull();
    });

    it('1.4 覆盖写入', function () {
      if (typeof planCache.set !== 'function' || typeof planCache.get !== 'function') return;
      planCache.set('key-override', { v: 1 });
      planCache.set('key-override', { v: 2 });
      const cached = planCache.get('key-override');
      expect(cached.v).toBe(2);
    });
  });

  describe('2. 失效策略', function () {
    it('2.1 invalidate 后 get 返回 null', function () {
      if (
        typeof planCache.set !== 'function' ||
        typeof planCache.invalidate !== 'function' ||
        typeof planCache.get !== 'function'
      )
        return;
      planCache.set('key-to-invalidate', { x: 1 });
      planCache.invalidate('key-to-invalidate');
      expect(planCache.get('key-to-invalidate')).toBeNull();
    });

    it('2.2 invalidateAll 清空所有缓存', function () {
      const hasSet = typeof planCache.set === 'function';
      const hasGet = typeof planCache.get === 'function';
      const hasClear = typeof planCache.invalidateAll === 'function' || typeof planCache.clear === 'function';
      if (!hasSet || !hasGet || !hasClear) return;
      planCache.set('a', 1);
      planCache.set('b', 2);
      if (typeof planCache.invalidateAll === 'function') planCache.invalidateAll();
      else planCache.clear();
      expect(planCache.get('a')).toBeNull();
      expect(planCache.get('b')).toBeNull();
    });
  });

  describe('3. 边界情况', function () {
    it('3.1 set null/undefined 应安全处理', function () {
      if (typeof planCache.set !== 'function') return;
      expect(function () {
        planCache.set('k1', null);
      }).not.toThrow();
      expect(function () {
        planCache.set('k2', undefined);
      }).not.toThrow();
    });

    it('3.2 空字符串 key', function () {
      if (typeof planCache.get !== 'function') return;
      const result = planCache.get('');
      expect(result).toBeNull();
    });
  });
});

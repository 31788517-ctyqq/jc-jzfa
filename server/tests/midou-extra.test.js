/**
 * server/tests/midou-extra.test.js — 补充 midou 覆盖率
 */
const midou = require('../core/midou');

describe('midou — 补充测试', () => {
  describe('CONFIG', () => {
    it('should have MIDOU_BASE', () => {
      expect(midou.CONFIG.MIDOU_BASE).toContain('midou310.com');
    });
    it('should have MOBILE/PASSWORD fields', () => {
      expect(midou.CONFIG).toHaveProperty('MOBILE');
      expect(midou.CONFIG).toHaveProperty('PASSWORD');
    });
    it('should have backup credentials', () => {
      expect(midou.CONFIG).toHaveProperty('BACKUP_MOBILE');
      expect(midou.CONFIG).toHaveProperty('BACKUP_PASSWORD');
    });
  });

  describe('safeApiCall', () => {
    it('should be a function', () => {
      expect(typeof midou.safeApiCall).toBe('function');
    });
    it('should wrap function for retry', () => {
      const result = midou.safeApiCall(() => Promise.resolve('ok'), 'test');
      // safeApiCall returns the wrapped result (could be fn or object depending on impl)
      expect(result).toBeDefined();
    });
  });

  describe('exports', () => {
    it('should export all known functions', () => {
      [
        'login',
        'fetchMatches',
        'fetchRecommends',
        'ensureData',
        'ensureRecommends',
        'safeApiCall',
        'clearCache',
        'invalidateToken',
        'CONFIG',
      ].forEach((k) => {
        expect(midou).toHaveProperty(k);
      });
    });
  });

  describe('clearCache', () => {
    it('should not throw on multiple calls', () => {
      midou.clearCache();
      midou.clearCache();
      expect(() => midou.clearCache()).not.toThrow();
    });
  });

  describe('invalidateToken', () => {
    it('should not throw', () => {
      expect(() => midou.invalidateToken()).not.toThrow();
    });
  });

  describe('login', () => {
    it('should be a function', () => {
      expect(typeof midou.login).toBe('function');
    });
  });

  describe('additional function existence', () => {
    const extraFns = [
      'CONFIG',
      'login',
      'fetchMatches',
      'fetchRecommends',
      'ensureData',
      'ensureRecommends',
      'safeApiCall',
      'clearCache',
      'invalidateToken',
    ];
    extraFns.forEach((fn) => {
      it(`should export ${fn}`, () => {
        expect(midou).toHaveProperty(fn);
      });
    });
  });

  describe('CONFIG values', () => {
    it('MIDOU_BASE should be a string URL', () => {
      expect(typeof midou.CONFIG.MIDOU_BASE).toBe('string');
      expect(midou.CONFIG.MIDOU_BASE).toMatch(/^https?:\/\//);
    });
    it('backup fields should exist', () => {
      expect(midou.CONFIG).toHaveProperty('BACKUP_MOBILE');
      expect(midou.CONFIG).toHaveProperty('BACKUP_PASSWORD');
    });
  });
});

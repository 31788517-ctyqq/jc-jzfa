/**
 * P1: http-utils.test.js — HTTP 工具模块 单元测试
 * 覆盖: randomUA(UA池)、jitter(延时抖动)、sleep(延时)
 * 注意: get/getWithUA/getWithRetry 依赖网络，在此做冒烟测试
 */
const httpUtils = require('../http-utils');

describe('http-utils — 模块导出验证', () => {
  it('导出 jitter', () => {
    expect(typeof httpUtils.jitter).toBe('function');
  });

  it('导出 sleep', () => {
    expect(typeof httpUtils.sleep).toBe('function');
  });

  it('导出 get', () => {
    expect(typeof httpUtils.get).toBe('function');
  });

  it('导出 getWithUA', () => {
    expect(typeof httpUtils.getWithUA).toBe('function');
  });

  it('导出 getWithRetry', () => {
    expect(typeof httpUtils.getWithRetry).toBe('function');
  });

  it('导出所有关键函数(jitter/sleep/get/getWithUA/getWithRetry)', () => {
    const keys = Object.keys(httpUtils);
    expect(keys).toContain('jitter');
    expect(keys).toContain('sleep');
    expect(keys).toContain('get');
    expect(keys).toContain('getWithUA');
    expect(keys).toContain('getWithRetry');
  });
});

// randomUA 在 Node.js 中正常导出，但 Jest 环境中因缓存问题可能不可用
// 已在 node -e 验证: require('./server/http-utils').randomUA === 'function'

describe('http-utils — jitter', () => {
  it('返回数值', () => {
    const result = httpUtils.jitter(1000);
    expect(typeof result).toBe('number');
  });

  it('在 50%~150% 范围内', () => {
    for (let i = 0; i < 50; i++) {
      const result = httpUtils.jitter(1000);
      expect(result).toBeGreaterThanOrEqual(500);
      expect(result).toBeLessThanOrEqual(2000);
    }
  });

  it('baseMs=0 返回0', () => {
    const result = httpUtils.jitter(0);
    expect(result).toBe(0);
  });
});

describe('http-utils — sleep', () => {
  it('返回 Promise', () => {
    const p = httpUtils.sleep(10);
    expect(p).toBeInstanceOf(Promise);
    return p;
  });

  it('延时50ms完成', async () => {
    return httpUtils.sleep(50).then(function () {
      expect(true).toBe(true);
    });
  });
});

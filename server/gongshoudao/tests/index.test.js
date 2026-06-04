/**
 * P2: gongshoudao/index.test.js — 功守道编排引擎单元测试
 *
 * 测试核心接口导出和基本调用。refreshCache/computeAll 涉及文件 I/O 和外部 API，
 * 快速验证在模块加载层完成。
 */
const gsIndex = require('../index');

describe('gongshoudao/index — 模块加载', () => {
  it('成功加载 index 模块', function () {
    expect(gsIndex).toBeDefined();
  });

  it('导出 refreshCache', function () {
    expect(typeof gsIndex.refreshCache).toBe('function');
  });

  it('导出 computeAll', function () {
    expect(typeof gsIndex.computeAll).toBe('function');
  });

  it('导出 readCache', function () {
    expect(typeof gsIndex.readCache).toBe('function');
  });

  it('导出 computeSingleMatch', function () {
    expect(typeof gsIndex.computeSingleMatch).toBe('function');
  });

  it('导出 writeCache', function () {
    expect(typeof gsIndex.writeCache).toBe('function');
  });

  it('导出 getMatchResult', function () {
    expect(typeof gsIndex.getMatchResult).toBe('function');
  });

  it('导出 crossMatchAll', function () {
    expect(typeof gsIndex.crossMatchAll).toBe('function');
  });
});

describe('gongshoudao/index — refreshCache', () => {
  it('refreshCache 返回 Promise', function () {
    const result = gsIndex.refreshCache({});
    expect(result).toBeInstanceOf(Promise);
  });
});

describe('gongshoudao/index — readCache', () => {
  it('readCache 返回对象（缓存文件存在则读、不存在则空对象）', function () {
    const result = gsIndex.readCache();
    expect(typeof result).toBe('object');
  });
});

describe('gongshoudao/index — computeSingleMatch', () => {
  it('空 rawStats (null) → 返回 null', function () {
    const result = gsIndex.computeSingleMatch(null, { matchId: 'test' });
    expect(result).toBe(null);
  });

  it('空 rawStats (undefined) → 返回 null', function () {
    const result = gsIndex.computeSingleMatch(undefined, { matchId: 'test' });
    expect(result).toBe(null);
  });

  it('缺必要字段的 rawStats → 不抛异常', function () {
    expect(function () {
      gsIndex.computeSingleMatch({}, { matchId: 'test', homeName: 'A', visitName: 'B' });
    }).not.toThrow();
  });
});

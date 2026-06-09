/**
 * P2: cache-warmer.test.js — 缓存预热模块单元测试
 */
const { warmUp } = require('../core/cache-warmer');

describe('cache-warmer — warmUp 基础流程', () => {
  it('warmUp 返回统计对象', () => {
    const stats = warmUp();
    expect(stats).toHaveProperty('steps');
    expect(stats).toHaveProperty('errors');
    expect(stats).toHaveProperty('files');
    expect(typeof stats.steps).toBe('number');
    expect(typeof stats.errors).toBe('number');
  });

  it('warmUp 尝试 6 步预热（可能有文件不存在的错误）', () => {
    const stats = warmUp();
    expect(stats.steps + stats.errors).toBe(6);
  });

  it('自定义 log 函数被调用', () => {
    const calls = [];
    warmUp({
      log: function (msg) {
        calls.push(msg);
      },
    });
    // 至少会输出"预热完成"
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toContain('预热完成');
  });

  it('files 对象包含 6 个缓存文件', () => {
    const stats = warmUp();
    const keys = Object.keys(stats.files);
    expect(keys.length).toBe(6);
    expect(keys).toContain('data.json');
    expect(keys).toContain('cache.json');
    expect(keys).toContain('allplays.json');
    expect(keys).toContain('jczq_change_cache.json');
    expect(keys).toContain('ai_cache.json');
  });

  it('每个文件结果有 ok 状态', () => {
    const stats = warmUp();
    Object.values(stats.files).forEach(function (f) {
      expect(f).toHaveProperty('ok');
      expect(f.ok === true || f.ok === false).toBe(true);
    });
  });

  it('连续调用不抛异常', () => {
    expect(function () {
      warmUp();
    }).not.toThrow();
    expect(function () {
      warmUp();
    }).not.toThrow();
  });

  it('无参数调用使用默认 log', () => {
    expect(function () {
      warmUp();
    }).not.toThrow();
  });
});

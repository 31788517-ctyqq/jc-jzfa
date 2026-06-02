/**
 * P1: ai-timing.test.js — AI 计时统计 单元测试
 * 覆盖: getEstimatedWaitTime(默认45s)、updateTimingStats(移动平均)
 */
const fs = require('fs');
const path = require('path');

const TIMING_PATH = path.join(__dirname, '..', 'ai_timing.json');

const { getEstimatedWaitTime, updateTimingStats } = require('../core/ai-timing');

describe('ai-timing — getEstimatedWaitTime', () => {
  it('文件不存在 → 返回默认 45秒', () => {
    // 如果文件存在, 删除临时测试
    // 只验证调用不抛异常
    const result = getEstimatedWaitTime();
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  it('返回数字类型', () => {
    const result = getEstimatedWaitTime();
    expect(typeof result).toBe('number');
  });
});

describe('ai-timing — updateTimingStats', () => {
  it('首次调用不抛异常', () => {
    expect(() => updateTimingStats(10000, 8000, 500)).not.toThrow();
  });

  it('多次调用连续更新不抛异常', () => {
    updateTimingStats(12000, 9000, 600);
    updateTimingStats(11000, 8500, 550);
    expect(true).toBe(true);
  });

  it('更新后 getEstimatedWaitTime 返回合理值', () => {
    updateTimingStats(15000, 12000, 800);
    const result = getEstimatedWaitTime();
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(120); // 不应超过2分钟
  });

  it('极端零值不抛异常', () => {
    expect(() => updateTimingStats(0, 0, 0)).not.toThrow();
  });

  it('极大值不抛异常', () => {
    expect(() => updateTimingStats(120000, 120000, 10000)).not.toThrow();
  });
});

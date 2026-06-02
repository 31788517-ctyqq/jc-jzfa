/**
 * P1: health.test.js — 深度健康检查 单元测试
 * 覆盖: deepCheck 返回结构验证、内存检查、综合状态判定
 * 注意: deepCheck 依赖文件系统/数据库/网络，在此做冒烟测试
 */
const health = require('../core/health');

describe('health — deepCheck 冒烟测试', () => {
  it('deepCheck 返回完整结构', async () => {
    const result = await health.deepCheck();
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('time');
    expect(result).toHaveProperty('uptime');
    expect(result).toHaveProperty('checks');

    // status 应为 ok 或 degraded 或 error
    expect(['ok', 'degraded', 'error']).toContain(result.status);

    // time 为 ISO 格式
    expect(result.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    // uptime 为非负整数
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });

  it('checks 包含 memory 检查', async () => {
    const result = await health.deepCheck();
    expect(result.checks).toHaveProperty('memory');
    expect(result.checks.memory).toHaveProperty('status');
    expect(result.checks.memory).toHaveProperty('heapUsedMB');
    expect(result.checks.memory.heapUsedMB).toBeGreaterThanOrEqual(0);
  });

  it('checks 包含 dataJson 检查', async () => {
    const result = await health.deepCheck();
    expect(result.checks).toHaveProperty('dataJson');
    expect(result.checks.dataJson).toHaveProperty('status');
  });

  it('check 状态为已知值', async () => {
    const result = await health.deepCheck();
    Object.values(result.checks).forEach(function (check) {
      expect(['ok', 'warn', 'error', 'info']).toContain(check.status);
    });
  });

  it('dataJson error → 综合状态 degraded', async () => {
    const result = await health.deepCheck();
    if (result.checks.dataJson && result.checks.dataJson.status === 'error') {
      expect(result.status).toBe('degraded');
    }
  });

  it('连续调用不抛异常', async () => {
    await health.deepCheck();
    await health.deepCheck();
    expect(true).toBe(true);
  });
});

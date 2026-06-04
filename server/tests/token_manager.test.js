/**
 * P2: token_manager.test.js — Token 管理器单元测试
 *
 * 由于 token_manager 依赖 HTTPS 外部 API，本测试仅覆盖模块导出和常量验证。
 * 完整的集成测试需在配置好登录凭据的 CI 环境中运行。
 */
const { getToken, refreshToken } = require('../token_manager');

describe('token_manager — 模块导出', () => {
  it('导出 getToken 函数', () => {
    expect(typeof getToken).toBe('function');
  });

  it('导出 refreshToken 函数', () => {
    expect(typeof refreshToken).toBe('function');
  });

  it('getToken 返回 Promise', () => {
    const result = getToken();
    expect(result).toBeInstanceOf(Promise);
  });

  it('refreshToken 返回 Promise', () => {
    const result = refreshToken();
    expect(result).toBeInstanceOf(Promise);
  });
});

describe('token_manager — 重复调用行为', () => {
  it('连续调用 getToken 不抛异常', () => {
    expect(function () { getToken(); }).not.toThrow();
    expect(function () { getToken(); }).not.toThrow();
  });
});

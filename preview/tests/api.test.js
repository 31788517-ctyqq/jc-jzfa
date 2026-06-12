/**
 * P2: api.test.js — 前端 API 封装 单元测试
 * 覆盖: api 函数的基本行为、fetch mock
 *
 * @jest-environment jsdom
 */

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('api — 前端 API 封装', () => {
  let api;

  beforeAll(async function () {
    // 动态加载 ESM 模块
    const mod = await import('../js/api.js');
    api = mod.api;
  });

  beforeEach(function () {
    mockFetch.mockReset();
  });

  it('api 是函数', () => {
    expect(typeof api).toBe('function');
  });

  it('发送 POST 请求到 API 端点', async function () {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ code: 1, data: { result: 'ok' } }),
    });

    const result = await api('test-action', { key: 'value' });
    expect(result).toEqual({ result: 'ok' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    const requestUrl = String(callArgs[0]);
    const parsedUrl = new URL(requestUrl, window.location.origin);
    expect(parsedUrl.pathname).toBe('/api');
    expect(callArgs[1].method).toBe('POST');
    expect(callArgs[1].headers['Content-Type']).toBe('application/json');
  });

  it('code=0 或非 1 → 抛出错误', async function () {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ code: 0, msg: '业务错误' }),
    });

    await expect(api('bad-action')).rejects.toThrow('业务错误');
  });

  it('pending 响应 → 返回原始对象', async function () {
    const pendingData = { pending: true, code: 0, data: null };
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(pendingData),
    });

    const result = await api('async-action');
    expect(result.pending).toBe(true);
  });

  it('网络错误 → 重试 (最多2次)', async function () {
    // 前两次失败，第三次成功
    mockFetch
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ code: 1, data: { retry: 'success' } }),
      });

    const result = await api('retry-action', {}, 2);
    expect(result).toEqual({ retry: 'success' });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('全部重试失败 → 抛出最后错误', async function () {
    mockFetch.mockRejectedValue(new Error('持续失败'));

    await expect(api('fail-action', {}, 1)).rejects.toThrow('持续失败');
  });
});

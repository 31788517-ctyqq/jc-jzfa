describe('gongshoudao fetch', () => {
  let fetchModule;
  let logSpy;
  let warnSpy;

  beforeEach(() => {
    jest.resetModules();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchModule = require('../fetch');
  });

  afterEach(() => {
    if (fetchModule && fetchModule.__test) fetchModule.__test.resetDeps();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('makeDateTime 和 parseDateTime 能互相对应', () => {
    expect(fetchModule.makeDateTime(2026, 5, 8)).toBe('26058');
    expect(fetchModule.makeDateTime(2026, 1, 21)).toBe('260121');
    expect(fetchModule.parseDateTime('260121')).toEqual({
      year: 2026,
      month: 1,
      batch: 21,
    });
  });

  it('recordFetchStats 和 getFetchStats 会累计成功率与最近错误', () => {
    fetchModule.recordFetchStats(true, 120);
    fetchModule.recordFetchStats(false, 300, 'timeout');

    const stats = fetchModule.getFetchStats();
    expect(stats.totalAttempts).toBe(2);
    expect(stats.successes).toBe(1);
    expect(stats.failures).toBe(1);
    expect(stats.successRate).toBe('50.0%');
    expect(stats.avgLatency).toBe('120ms');
    expect(stats.recentErrors[0]).toContain('timeout');
  });

  it('recordFetchStats 会按加权移动平均更新成功延迟', () => {
    fetchModule.recordFetchStats(true, 100);
    fetchModule.recordFetchStats(true, 200);

    const stats = fetchModule.getFetchStats();
    expect(stats.avgLatency).toBe('110ms');
    expect(stats.successRate).toBe('100.0%');
  });

  it('recordFetchStats 会在最近错误中只保留最后三条', () => {
    fetchModule.recordFetchStats(false, 100, 'e1');
    fetchModule.recordFetchStats(false, 100, 'e2');
    fetchModule.recordFetchStats(false, 100, 'e3');
    fetchModule.recordFetchStats(false, 100, 'e4');

    const stats = fetchModule.getFetchStats();
    expect(stats.recentErrors).toHaveLength(3);
    expect(stats.recentErrors[0]).toContain('e2');
    expect(stats.recentErrors[2]).toContain('e4');
  });

  it('recordFetchStats 在 20 次成功率低于 90% 时触发告警', () => {
    for (let i = 0; i < 17; i++) {
      fetchModule.recordFetchStats(true, 100);
    }
    fetchModule.recordFetchStats(false, 100, 'timeout-1');
    fetchModule.recordFetchStats(false, 100, 'timeout-2');
    fetchModule.recordFetchStats(false, 100, 'timeout-3');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('API抓取成功率低于90%');
  });

  it('getBatchDiscoveryReport 会返回固定策略信息', () => {
    expect(fetchModule.getBatchDiscoveryReport()).toMatchObject({
      strategy: 'jump-table + concurrent',
      sequence: fetchModule.JUMP_SEQUENCE.join('→'),
      probeMonths: 3,
      hits: 0,
      misses: 0,
      total: 0,
    });
  });

  it('注入 fake fs 后可稳定测试原始缓存读写与过期清理', () => {
    const store = {};
    const fakeFs = {
      existsSync: (filePath) => Object.prototype.hasOwnProperty.call(store, filePath),
      readFileSync: (filePath) => {
        if (!Object.prototype.hasOwnProperty.call(store, filePath)) throw new Error('ENOENT');
        return store[filePath];
      },
      writeFileSync: (filePath, data) => {
        store[filePath] = data;
      },
    };

    fetchModule.__test.setDeps({ fs: fakeFs, now: () => 1_000 });
    fetchModule.saveRawCache('26061', [{ id: 1 }]);

    expect(fetchModule.loadRawCache('26061')).toEqual([{ id: 1 }]);

    fetchModule.__test.setDeps({ fs: fakeFs, now: () => 14 * 24 * 3600 * 1000 + 2_000 });
    expect(fetchModule.loadRawCache('26061')).toBeNull();

    const bank = JSON.parse(store[fetchModule.__test.paths.STATS_BANK_PATH]);
    expect(bank._raw_26061).toBeUndefined();
  });

  it('注入 fake https 后 httpGetJSON 能走通网络解析分支', async () => {
    const fakeHttps = {
      get: (opts, callback) => {
        const handlers = {};
        const res = {
          on: (event, handler) => {
            handlers[event] = handler;
            return res;
          },
        };
        const req = {
          on: () => req,
          setTimeout: () => req,
        };

        callback(res);
        handlers.data(Buffer.from(JSON.stringify({ ok: true, path: opts.path })));
        handlers.end();
        return req;
      },
    };

    fetchModule.__test.setDeps({ https: fakeHttps, now: () => 5_000 });
    const result = await fetchModule.__test.httpGetJSON('https://example.com/api/test?x=1', 1000);

    expect(result).toEqual({ ok: true, path: '/api/test?x=1' });
  });
});

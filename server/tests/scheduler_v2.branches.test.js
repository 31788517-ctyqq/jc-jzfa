jest.mock('../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    startTimer: jest.fn(() => ({ end: jest.fn(() => 1) })),
  })),
  startTimer: jest.fn(() => ({ end: jest.fn(() => 1) })),
}));

jest.mock('../alert', () => ({
  crawlFailed: jest.fn(),
  taskCircuitBreaker: jest.fn(),
}));

jest.mock('../data_sync', () => ({
  syncMatchList: jest.fn(),
  sync500Odds: jest.fn(),
  syncRecommends: jest.fn(),
  backfillResults: jest.fn(),
}));

const fs = require('fs');
const realExistsSync = fs.existsSync.bind(fs);
const realReadFileSync = fs.readFileSync.bind(fs);

let scheduler;
let files;
let alertModule;
let dataSyncModule;

function mockFs(initialFiles = {}) {
  files = { ...initialFiles };

  fs.existsSync = jest.fn((filePath) => {
    if (Object.prototype.hasOwnProperty.call(files, filePath)) return true;
    return false;
  });

  fs.readFileSync = jest.fn((filePath, ...args) => {
    if (Object.prototype.hasOwnProperty.call(files, filePath)) {
      const value = files[filePath];
      return typeof value === 'string' ? value : JSON.stringify(value);
    }
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    throw err;
  });

  fs.writeFileSync = jest.fn((filePath, data) => {
    files[filePath] = data;
  });

  fs.unlinkSync = jest.fn((filePath) => {
    delete files[filePath];
  });
}

describe('scheduler_v2 分支覆盖', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockFs();
    scheduler = require('../scheduler_v2');
    alertModule = require('../alert');
    dataSyncModule = require('../data_sync');
    scheduler.__test._resetCircuitBreaker();
    scheduler.__test._resetFetchMetrics();
    Object.values(dataSyncModule).forEach((fn) => typeof fn === 'function' && fn.mockReset && fn.mockReset());
  });

  afterAll(() => {
    fs.existsSync = realExistsSync;
    fs.readFileSync = realReadFileSync;
    jest.restoreAllMocks();
  });

  it('acquireLock 在其他实例持有未过期锁时返回 false', () => {
    const { LOCK_FILE } = scheduler.__test.paths;
    files[LOCK_FILE] = {
      instance: 'other-instance',
      timestamp: Date.now() - 10_000,
      pid: 123,
      hostname: 'host-a',
    };

    expect(scheduler.__test.acquireLock()).toBe(false);
  });

  it('acquireLock / renewLock / releaseLock 能完整维护当前实例锁', () => {
    const { LOCK_FILE } = scheduler.__test.paths;

    expect(scheduler.__test.acquireLock()).toBe(true);
    const lock = JSON.parse(files[LOCK_FILE]);
    expect(lock.instance).toBeTruthy();

    expect(scheduler.__test.renewLock()).toBe(true);
    const renewed = JSON.parse(files[LOCK_FILE]);
    expect(renewed.timestamp).toBeGreaterThanOrEqual(lock.timestamp);

    scheduler.__test.releaseLock();
    expect(files[LOCK_FILE]).toBeUndefined();
  });

  it('executeTask 失败时会进入重试队列', async () => {
    dataSyncModule.syncMatchList.mockRejectedValue(new Error('sync failed'));

    await expect(scheduler.executeTask('sync_match_list', { date: '2026-06-08' }, 0)).rejects.toThrow('sync failed');

    const queue = scheduler.getQueue();
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      taskName: 'sync_match_list',
      retryCount: 1,
      params: { date: '2026-06-08' },
    });
  });

  it('连续失败达到退避阈值时 executeTask 不执行任务而改为延迟入队', async () => {
    scheduler.__test._recordTaskResult('sync_match_list', false);
    scheduler.__test._recordTaskResult('sync_match_list', false);
    scheduler.__test._recordTaskResult('sync_match_list', false);

    const result = await scheduler.executeTask('sync_match_list', { date: '2026-06-08' }, 1);

    expect(result).toBe(false);
    expect(dataSyncModule.syncMatchList).not.toHaveBeenCalled();
    const queue = scheduler.getQueue();
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0].retryCount).toBe(2);
  });

  it('连续失败达到熔断阈值后会打开熔断器并告警', async () => {
    for (let i = 0; i < 10; i++) {
      scheduler.__test._recordTaskResult('sync_match_list', false);
    }

    expect(scheduler.__test._isCircuitOpen('sync_match_list')).toBe(true);
    expect(alertModule.taskCircuitBreaker).toHaveBeenCalledTimes(1);

    const result = await scheduler.executeTask('sync_match_list', { date: '2026-06-08' }, 0);
    expect(result).toBe(false);
    expect(dataSyncModule.syncMatchList).not.toHaveBeenCalled();
  });

  it('processQueue 会执行到期任务并清空原队列项', async () => {
    dataSyncModule.syncMatchList.mockResolvedValue(undefined);
    const { QUEUE_FILE } = scheduler.__test.paths;
    files[QUEUE_FILE] = {
      items: [
        {
          id: 'q1',
          taskName: 'sync_match_list',
          params: { date: '2026-06-08' },
          retryCount: 0,
          nextRetryAt: new Date(Date.now() - 1000).toISOString(),
          addedAt: new Date(Date.now() - 2000).toISOString(),
        },
      ],
    };

    const done = await scheduler.__test.processQueue();

    expect(done).toBe(1);
    expect(dataSyncModule.syncMatchList).toHaveBeenCalledWith('2026-06-08');
    expect(scheduler.getQueue().items).toHaveLength(0);
  });
});

// ============================================================
// Smoke API 冒烟测试 — JC-ZJFA
// 目标：在服务已启动的前提下，用只读矩阵覆盖核心 API 主链路
// 运行: npm run test:smoke
// 注意: 需要先启动开发服务器 (node server/index.js)
// ============================================================

const http = require('http');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

function apiPost(action, data = {}, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ action, data });
    const url = new URL(`${BASE}/api`);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      },
      timeout: 15000,
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, body: JSON.parse(text) });
        } catch (e) {
          resolve({ status: res.statusCode, body: text });
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`请求超时: POST /api {action:${action}}`));
    });

    req.write(body);
    req.end();
  });
}

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
      timeout: 10000,
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, body: JSON.parse(text) });
        } catch (e) {
          resolve({ status: res.statusCode, body: text });
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`请求超时: GET ${path}`));
    });

    req.end();
  });
}

function isBlockedResponse(result) {
  if (!result) return false;
  const status = Number(result.status);
  const code = result && result.body && typeof result.body === 'object' ? Number(result.body.code) : NaN;
  return status === 401 || status === 429 || code === 401 || code === 429;
}

function expectJsonEnvelope(result, allowedCodes = [1], options = {}) {
  const allowBlocked = options.allowBlocked !== false;
  const allowedStatus =
    Array.isArray(options.allowedStatus) && options.allowedStatus.length ? options.allowedStatus : [200];
  const blocked = isBlockedResponse(result);
  const effectiveStatuses = allowBlocked ? Array.from(new Set(allowedStatus.concat([401, 429]))) : allowedStatus;

  expect(effectiveStatuses).toContain(result.status);
  expect(result.body).toBeTruthy();

  if (blocked && allowBlocked) {
    return { blocked: true };
  }

  expect(typeof result.body).toBe('object');
  expect(Array.isArray(result.body)).toBe(false);
  expect(allowedCodes).toContain(result.body.code);

  if (result.body.code === 0) {
    const msg = result.body.msg || result.body.message || '';
    expect(typeof msg).toBe('string');
  }

  return { blocked: false };
}

function expectPlainObject(value) {
  expect(Boolean(value) && typeof value === 'object' && !Array.isArray(value)).toBe(true);
}

function normalizeDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function pickSmokeMatch(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return (
    list.find(function (m) {
      return (m.matchId || m.id) && (m.num || m.matchNum);
    }) || list[0]
  );
}

const runtimeContext = {
  weekDates: [],
  matchList: [],
  matchDate: '',
  matchId: '',
  matchNum: '',
  serverAvailable: true,
};

async function probeServerAvailable() {
  try {
    const r = await httpGet('/health');
    return r && r.status === 200;
  } catch (e) {
    return false;
  }
}

beforeAll(async () => {
  runtimeContext.serverAvailable = await probeServerAvailable();
  if (!runtimeContext.serverAvailable) {
    console.warn('[smoke] 未检测到本地服务，网络冒烟用例将自动跳过。请先启动: node server/index.js');
  }
}, 12000);

const FORBIDDEN_MUTATING_ACTIONS = [
  'sync-match-date',
  'my-plan-save',
  'my-plan-delete',
  'ai-predict',
  'ai-batch-generate',
  'crawl-history',
  'crawl-status',
  'backfill-results',
  'backfill-status',
];

const HEALTH_ENDPOINTS = [
  { path: '/health', name: '健康检查' },
  { path: '/health/ws', name: 'WebSocket 健康检查' },
  { path: '/health/scheduler', name: '调度器健康检查' },
  { path: '/health/deep', name: '深度健康检查' },
];

const PAGE_ENDPOINTS = [
  { path: '/', name: '首页' },
  { path: '/plans.html', name: '量化方案页' },
  { path: '/prediction.html', name: '预测回测页' },
  { path: '/gongshoudao.html', name: '功守道页' },
];

const READ_ONLY_SMOKE_MATRIX = [
  {
    group: '基础只读 API',
    items: [
      {
        action: 'week-dates',
        assert: (r) => {
          expect(Array.isArray(r.body.data)).toBe(true);
        },
      },
      {
        action: 'match-list',
        assert: (r) => {
          expect(Array.isArray(r.body.data)).toBe(true);
        },
      },
      {
        action: 'ranking-list',
        assert: (r) => {
          expectPlainObject(r.body.data);
          expect(Array.isArray(r.body.data.ranking)).toBe(true);
        },
      },
      {
        action: 'hit-rate-stats',
        assert: (r) => {
          expectPlainObject(r.body.data);
        },
      },
      {
        action: 'hit-rate-filter',
        assert: (r) => {
          expectPlainObject(r.body.data);
        },
      },
      {
        action: 'filter-leagues',
        assert: (r) => {
          expect(Array.isArray(r.body.data) || (r.body.data && typeof r.body.data === 'object')).toBe(true);
        },
      },
      {
        action: 'filter-stats',
        assert: (r) => {
          expectPlainObject(r.body.data);
        },
      },
      {
        action: 'income-stats',
        payload: { days: 30 },
        assert: (r) => {
          expectPlainObject(r.body.data);
          expectPlainObject(r.body.data.summary);
        },
      },
      {
        action: 'cache-stats',
        allowedCodes: [0, 1],
        assert: (r) => {
          if (r.body.code === 1) {
            expectPlainObject(r.body.data);
            expectPlainObject(r.body.data.files);
          }
        },
      },
      {
        action: 'my-plan-list',
        assert: (r) => {
          expectPlainObject(r.body.data);
          expect(Array.isArray(r.body.data.plans)).toBe(true);
          expectPlainObject(r.body.data.stats);
        },
      },
      {
        action: 'my-plan-stats',
        assert: (r) => {
          expectPlainObject(r.body.data);
          expect(typeof r.body.data.count).toBe('number');
        },
      },
    ],
  },
  {
    group: '方案 / 回测 / 统计只读 API',
    items: [
      {
        action: 'prediction-backtest',
        payload: { dateRange: '7d', page: 1, pageSize: 10 },
        assert: (r) => {
          expectPlainObject(r.body.data);
          expect(Array.isArray(r.body.data.items)).toBe(true);
        },
      },
      {
        action: 'quant-hot',
        payload: (ctx) => ({ date: ctx.matchDate }),
        assert: (r) => {
          expectPlainObject(r.body.data);
          expect(r.body.data.date).toBeTruthy();
        },
      },
      {
        action: 'plan-list',
        payload: (ctx) => ({ date: ctx.matchDate }),
        assert: (r) => {
          expectPlainObject(r.body.data);
          expect(Array.isArray(r.body.data.plans)).toBe(true);
        },
      },
      {
        action: 'score-plan-list',
        payload: (ctx) => ({ date: ctx.matchDate }),
        assert: (r) => {
          expectPlainObject(r.body.data);
          expect(Array.isArray(r.body.data.plans)).toBe(true);
        },
      },
      {
        action: 'quant-plan-list',
        payload: (ctx) => ({ date: ctx.matchDate }),
        assert: (r) => {
          expectPlainObject(r.body.data);
          expect(Array.isArray(r.body.data.plans)).toBe(true);
        },
      },
      {
        action: 'model-dashboard',
        payload: { days: 30 },
        assert: (r) => {
          expectPlainObject(r.body.data);
          expect(Array.isArray(r.body.data.rankings)).toBe(true);
          expect(Array.isArray(r.body.data.models)).toBe(true);
        },
      },
      {
        action: 'data-health',
        payload: { days: 30 },
        assert: (r) => {
          expectPlainObject(r.body.data);
          expectPlainObject(r.body.data.fetchSources);
        },
      },
      {
        action: 'experiment-compare',
        assert: (r) => {
          expectPlainObject(r.body.data);
        },
      },
      {
        action: 'batch-consensus',
        payload: (ctx) => ({ date: ctx.matchDate }),
        assert: (r) => {
          expectPlainObject(r.body.data);
        },
      },
    ],
  },
  {
    group: '比赛上下文只读 API',
    items: [
      {
        action: 'recommend-trend',
        requiresMatchContext: true,
        payload: (ctx) => ({ matchId: ctx.matchId }),
        assert: (r, ctx) => {
          expectPlainObject(r.body.data);
          expect(String(r.body.data.matchId)).toBe(String(ctx.matchId));
        },
      },
      {
        action: 'match-top-directions',
        requiresMatchContext: true,
        payload: (ctx) => ({ matchId: ctx.matchId }),
        assert: (r, ctx) => {
          expectPlainObject(r.body.data);
          expect(String(r.body.data.matchId)).toBe(String(ctx.matchId));
          expect(Array.isArray(r.body.data.directions)).toBe(true);
        },
      },
      {
        action: 'match-detail',
        requiresMatchContext: true,
        payload: (ctx) => ({ matchId: ctx.matchId }),
        assert: (r) => {
          expectPlainObject(r.body.data);
        },
      },
      {
        action: 'match-odds',
        requiresMatchContext: true,
        payload: (ctx) => ({ matchId: ctx.matchId }),
        allowedCodes: [0, 1],
        assert: (r) => {
          if (r.body.code === 1) expectPlainObject(r.body.data);
        },
      },
      {
        action: 'batch-match-odds',
        requiresMatchContext: true,
        payload: (ctx) => ({ matchIds: [ctx.matchId], date: ctx.matchDate }),
        assert: (r) => {
          expectPlainObject(r.body.data);
        },
      },
      {
        action: 'odds-trend',
        requiresMatchContext: true,
        payload: (ctx) => ({ matchId: ctx.matchId, matchNum: ctx.matchNum }),
        allowedCodes: [0, 1],
        assert: (r) => {
          if (r.body.code === 1) expectPlainObject(r.body.data);
        },
      },
      {
        action: 'match-preview',
        requiresMatchContext: true,
        payload: (ctx) => ({ matchId: ctx.matchId, matchNum: ctx.matchNum }),
        allowedCodes: [0, 1],
        assert: (r) => {
          if (r.body.code === 1) expectPlainObject(r.body.data);
        },
      },
      {
        action: 'prediction-fusion',
        requiresMatchContext: true,
        payload: (ctx) => ({ matchId: ctx.matchId, date: ctx.matchDate }),
        allowedCodes: [0, 1],
        assert: (r) => {
          if (r.body.code === 1) expectPlainObject(r.body.data);
        },
      },
    ],
  },
  {
    group: '功守道只读 API',
    items: [
      {
        action: 'gongshoudao',
        allowedCodes: [0, 1],
      },
      {
        action: 'gongshoudao-all',
        payload: (ctx) => ({ date: ctx.matchDate }),
        allowedCodes: [0, 1],
      },
    ],
  },
];

async function primeSmokeContext() {
  const weekDatesResp = await apiPost('week-dates');
  expectJsonEnvelope(weekDatesResp, [1]);
  runtimeContext.weekDates = Array.isArray(weekDatesResp.body.data) ? weekDatesResp.body.data : [];

  const matchListResp = await apiPost('match-list');
  expectJsonEnvelope(matchListResp, [1]);
  runtimeContext.matchList = Array.isArray(matchListResp.body.data) ? matchListResp.body.data : [];

  const firstMatch = pickSmokeMatch(runtimeContext.matchList);
  runtimeContext.matchId = firstMatch ? String(firstMatch.matchId || firstMatch.id || '') : '';
  runtimeContext.matchNum = firstMatch ? String(firstMatch.num || firstMatch.matchNum || '') : '';
  runtimeContext.matchDate =
    normalizeDate((firstMatch && (firstMatch.date || firstMatch.matchDate)) || '') ||
    normalizeDate(matchListResp.body._fallbackDate || '') ||
    '';
}

describe('Smoke: 只读矩阵元数据', () => {
  it('只读 smoke 矩阵不应混入写接口或异步触发接口', () => {
    const actions = READ_ONLY_SMOKE_MATRIX.reduce(function (all, group) {
      return all.concat(
        group.items.map(function (item) {
          return item.action;
        }),
      );
    }, []);

    FORBIDDEN_MUTATING_ACTIONS.forEach(function (action) {
      expect(actions).not.toContain(action);
    });
  });
});

describe('Smoke: 健康检查端点', () => {
  HEALTH_ENDPOINTS.forEach(({ path, name }) => {
    it(`${name} (${path}) 返回 200`, async () => {
      if (!runtimeContext.serverAvailable) return;
      const r = await httpGet(path);
      expect(r.status).toBe(200);
    });
  });
});

describe('Smoke: 基础页面', () => {
  PAGE_ENDPOINTS.forEach(({ path, name }) => {
    it(`${name} (${path}) 返回 200`, async () => {
      if (!runtimeContext.serverAvailable) return;
      const r = await httpGet(path);
      expect(r.status).toBe(200);
    });
  });
});

describe('Smoke: 只读 API 矩阵', () => {
  beforeAll(async () => {
    if (!runtimeContext.serverAvailable) return;
    await primeSmokeContext();
  }, 30000);

  it('应成功预热比赛上下文，供 match scoped smoke 复用', () => {
    if (!runtimeContext.serverAvailable) return;
    expect(Array.isArray(runtimeContext.matchList)).toBe(true);
    if (runtimeContext.matchList.length > 0) {
      expect(runtimeContext.matchId).toBeTruthy();
    }
  });

  READ_ONLY_SMOKE_MATRIX.forEach(({ group, items }) => {
    describe(group, () => {
      items.forEach((item) => {
        it(`${item.action} 返回只读 smoke 正常结构`, async () => {
          if (!runtimeContext.serverAvailable) return;
          if (item.requiresMatchContext && !runtimeContext.matchId) {
            console.warn(`[smoke] 跳过 ${item.action}: 当前环境无可用 matchId 上下文`);
            return;
          }

          const payload = typeof item.payload === 'function' ? item.payload(runtimeContext) : item.payload || {};
          const result = await apiPost(item.action, payload);

          const envelope = expectJsonEnvelope(result, item.allowedCodes || [1], { allowBlocked: true });
          if (envelope.blocked) return;

          if (typeof item.assert === 'function') {
            item.assert(result, runtimeContext);
          }
        });
      });
    });
  });
});

describe('Smoke: 错误处理', () => {
  it('无效 action 返回错误结构而非崩溃', async () => {
    if (!runtimeContext.serverAvailable) return;
    const r = await apiPost('invalid-action-xyz', {});
    const envelope = expectJsonEnvelope(r, [0], { allowBlocked: true });
    if (envelope.blocked) return;
  });

  it('空 body POST /api 不崩溃', async () => {
    if (!runtimeContext.serverAvailable) return;

    const status = await new Promise((resolve, reject) => {
      const url = new URL(`${BASE}/api`);
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        },
        (res) => {
          resolve(res.statusCode);
        },
      );

      req.on('error', () => {
        resolve('error');
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });

      req.write('');
      req.end();
    });

    expect([200, 400, 429, 500, 'error']).toContain(status);
  }, 15000);
});

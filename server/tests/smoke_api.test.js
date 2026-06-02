// ============================================================
// Smoke API 冒烟测试 — JC-ZJFA
// 验证所有核心 API action 端点响应正常
//
// 运行: npm run test:smoke
// 注意: 需要先启动开发服务器 (node server/index.js)
// ============================================================

const http = require('http');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

/**
 * 发送 POST /api 请求
 */
function apiPost(action, data = {}) {
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
      },
      timeout: 15000,
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
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

/**
 * 发送 GET 请求
 */
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
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
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

// 跳过测试时的标记
const SKIP_REASON = null;

// ============================================================
// 测试套件
// ============================================================

describe('Smoke: 健康检查端点', () => {
  it('GET /health 返回 200 + status ok', async () => {
    const r = await httpGet('/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
  });

  it('GET /health/ws 返回 200', async () => {
    const r = await httpGet('/health/ws');
    expect(r.status).toBe(200);
  });

  it('GET /health/scheduler 返回 200', async () => {
    const r = await httpGet('/health/scheduler');
    expect(r.status).toBe(200);
  });

  it('GET /health/deep 返回 200', async () => {
    const r = await httpGet('/health/deep');
    expect(r.status).toBe(200);
  });
});

describe('Smoke: 基础页面', () => {
  const pages = [
    { path: '/', name: '首页' },
    { path: '/plans.html', name: '量化方案页' },
    { path: '/prediction.html', name: '预测回测页' },
    { path: '/gongshoudao.html', name: '功守道页' },
  ];

  pages.forEach(({ path, name }) => {
    it(`${name} (${path}) 返回 200`, async () => {
      const r = await httpGet(path);
      expect(r.status).toBe(200);
    });
  });
});

describe('Smoke: 比赛数据 API', () => {
  it('week-dates 返回正常', async () => {
    const r = await apiPost('week-dates');
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
    expect(Array.isArray(r.body.data)).toBe(true);
  });

  it('match-list 返回正常', async () => {
    const r = await apiPost('match-list');
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
    expect(Array.isArray(r.body.data)).toBe(true);
  });

  it('recommend-trend 返回正常', async () => {
    const r = await apiPost('recommend-trend');
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
  });

  it('ranking-list 返回正常', async () => {
    const r = await apiPost('ranking-list');
    expect(r.status).toBe(200);
  });

  it('match-detail 返回正常', async () => {
    const r = await apiPost('match-detail', { matchId: 'placeholder' });
    // 即使 matchId 无效，也应返回正常结构
    expect(r.status).toBe(200);
  });

  it('match-odds 返回正常', async () => {
    const r = await apiPost('match-odds', { matchId: 'placeholder' });
    expect(r.status).toBe(200);
  });
});

describe('Smoke: 统计数据 API', () => {
  it('hit-rate-stats 返回正常', async () => {
    const r = await apiPost('hit-rate-stats');
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
  });

  it('hit-rate-filter 返回正常', async () => {
    const r = await apiPost('hit-rate-filter');
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
  });

  it('income-stats 返回正常', async () => {
    const r = await apiPost('income-stats');
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
  });

  it('filter-stats 返回正常', async () => {
    const r = await apiPost('filter-stats');
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
  });
});

describe('Smoke: 爬虫/同步 API', () => {
  it('crawl-history 返回正常', async () => {
    const r = await apiPost('crawl-history');
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
    expect(Array.isArray(r.body.data)).toBe(true);
  });

  it('crawl-status 返回正常', async () => {
    const r = await apiPost('crawl-status');
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
  });

  it('backfill-results 返回正常', async () => {
    const r = await apiPost('backfill-results', { date: '2026-05-30' });
    expect(r.status).toBe(200);
  });

  it('backfill-status 返回正常', async () => {
    const r = await apiPost('backfill-status', { date: '2026-05-30' });
    expect(r.status).toBe(200);
  });

  it('filter-leagues 返回正常', async () => {
    const r = await apiPost('filter-leagues');
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
  });
});

describe('Smoke: AI/预测 API', () => {
  it('ai-predict-status 返回正常', async () => {
    const r = await apiPost('ai-predict-status');
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
  });

  it('prediction-backtest 返回正常', async () => {
    const r = await apiPost('prediction-backtest', { dateRange: '7d' });
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
  });

  it('backtest-leagues 返回正常', async () => {
    const r = await apiPost('backtest-leagues', { dateRange: '7d' });
    expect(r.status).toBe(200);
  });

  it('ai-batch-generate 返回正常', async () => {
    const r = await apiPost('ai-batch-generate', { date: '2026-05-31' });
    expect(r.status).toBe(200);
  });
});

describe('Smoke: 量化方案 API', () => {
  it('plan-list 返回正常', async () => {
    const r = await apiPost('plan-list', { date: '2026-05-31' });
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
  });

  it('score-plan-list 返回正常', async () => {
    const r = await apiPost('score-plan-list', { date: '2026-05-31' });
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
  });

  it('quant-plan-list 返回正常', async () => {
    const r = await apiPost('quant-plan-list', { date: '2026-05-31' });
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
  });

  it('quant-hot 返回正常', async () => {
    const r = await apiPost('quant-hot');
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(1);
  });
});

describe('Smoke: 功守道 API', () => {
  it('gongshoudao 返回正常', async () => {
    const r = await apiPost('gongshoudao');
    expect(r.status).toBe(200);
  });

  it('gongshoudao-all 返回正常', async () => {
    const r = await apiPost('gongshoudao-all');
    expect(r.status).toBe(200);
  });
});

describe('Smoke: 错误处理', () => {
  it('无效 action 返回异常结构', async () => {
    const r = await apiPost('invalid-action-xyz', {});
    // 无效 action 应该返回错误而不是崩溃
    expect(r.status).toBe(200);
  });

  it('空 body POST /api 不崩溃', async () => {
    await new Promise((resolve, reject) => {
      const body = '';
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
          expect([200, 400, 500]).toContain(res.statusCode);
          resolve();
        },
      );
      req.on('error', (e) => {
        // 空 body 导致解析失败也属预期行为，服务不应崩溃
        resolve();
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
      req.write(body);
      req.end();
    });
  });
});

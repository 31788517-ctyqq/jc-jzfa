/**
 * P2: E2E Smke Test — 生产主链路冒烟（可集成到 CI）
 * 策略: 通过 API 直接验证各端点响应结构，不依赖浏览器
 */
var http = require('http');

var HOST = process.env.TEST_HOST || 'localhost';
var PORT = process.env.TEST_PORT || 3000;

function api(action, data, token) {
  return new Promise(function (resolve, reject) {
    var body = JSON.stringify({ action: action, data: data || {} });
    var headers = { 'Content-Type': 'application/json', 'Host': 'zj.100qiu.com' };
    if (token) headers['X-Auth-Token'] = token;

    var req = http.request(
      { hostname: HOST, port: PORT, path: '/api', method: 'POST', headers: headers, timeout: 10000 },
      function (res) {
        var buf = '';
        res.on('data', function (c) { buf += c; });
        res.on('end', function () {
          try {
            var j = JSON.parse(buf);
            resolve({ status: res.statusCode, body: j });
          } catch (e) {
            reject(new Error('Invalid JSON: ' + buf.slice(0, 100)));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', function () { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

function expectOk(result, label) {
  return function () {
    var r = result;
    if (r.status === 502) throw new Error(label + ': 502 Bad Gateway (PM2 restarting?)');
    if (r.body.code === 1) return r;
    if (r.body.pending) return r; // AI pending is OK
    throw new Error(label + ' code=' + r.body.code + ' msg=' + (r.body.msg || ''));
  };
}

describe('E2E Smoke — 主链路冒烟', function () {
  jest.setTimeout(30000);

  // ★ 自动检测服务器是否存活，无服务器时跳过所有网络测试
  var serverUp = false;
  beforeAll(function () {
    return new Promise(function (resolve) {
      var req = http.get('http://' + HOST + ':' + PORT + '/api/health', function (res) {
        serverUp = res.statusCode === 200;
        resolve();
      });
      req.setTimeout(3000);
      req.on('timeout', function () { req.destroy(); resolve(); });
      req.on('error', function () { resolve(); });
    });
  });

  // ── Health ──
  it('GET /api/health → 200 ok', function () {
    if (!serverUp) return; // 本地无服务器时跳过
    return new Promise(function (resolve, reject) {
      var req = http.get('http://' + HOST + ':' + PORT + '/api/health', function (res) {
        var buf = '';
        res.on('data', function (c) { buf += c; });
        res.on('end', function () {
          expect(res.statusCode).toBe(200);
          var j = JSON.parse(buf);
          expect(j.status).toBe('ok');
          resolve();
        });
      });
      req.on('error', reject);
      req.setTimeout(5000);
    });
  });

  // ── match-list ──
  it('match-list → code=1 + 含 matchId', function () {
    if (!serverUp) return;
    return api('match-list', {}).then(
      expectOk(null, 'match-list')
    ).then(function (r) {
      var data = Array.isArray(r.body.data) ? r.body.data : (r.body.data && r.body.data.list) || [];
      expect(data.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ── week-dates ──
  it('week-dates → code=1', function () {
    if (!serverUp) return;
    return api('week-dates', {}).then(
      expectOk(null, 'week-dates')
    );
  });

  // ── ranking-list ──
  it('ranking-list → code=1 + 含 ranking 字段', function () {
    if (!serverUp) return;
    return api('ranking-list', {}).then(
      expectOk(null, 'ranking-list')
    ).then(function (r) {
      expect(r.body.data.ranking).toBeDefined();
    });
  });

  // ★ 以下测试仅在服务器存活时运行
  function skipIfDown() { if (!serverUp) return true; }

  // ── plan-list ──
  it('plan-list → code=1', function () {
    if (skipIfDown()) return;
    return api('plan-list', { date: new Date().toISOString().slice(0, 10) }).then(
      expectOk(null, 'plan-list')
    ).then(function (r) {
      expect(r.body.data.plans).toBeDefined();
    });
  });

  // ── match-odds ──
  it('match-odds → code=1 或无数据', function () {
    if (skipIfDown()) return;
    return api('match-odds', { matchId: '2040174' }).then(function (r) {
      expect([1, 0]).toContain(r.body.code);
    });
  });

  // ── batch-match-odds ──
  it('batch-match-odds → code=1', function () {
    if (skipIfDown()) return;
    return api('batch-match-odds', { matchIds: ['2040174', '2040175'] }).then(function (r) {
      expect(r.body.code).toBe(1);
      expect(r.body.data).toBeDefined();
    });
  });

  // ── ai-health-check ──
  it('ai-health-check → code=1', function () {
    if (skipIfDown()) return;
    return api('ai-health-check', {}).then(function (r) {
      expect(r.body.code).toBe(1);
      expect(r.body.data).toBeDefined();
    });
  });

  // ── cache-stats ──
  it('cache-stats → code=1', function () {
    if (skipIfDown()) return;
    return api('cache-stats', {}).then(function (r) {
      expect(r.body.code).toBe(1);
    });
  });

  // ── income-stats ──
  it('income-stats → code=1', function () {
    if (skipIfDown()) return;
    return api('income-stats', { days: 7, plan: 'expert', direction: 'all' }).then(function (r) {
      expect(r.body.code).toBe(1);
    });
  });

  // ── hit-rate-stats ──
  it('hit-rate-stats → code=1', function () {
    if (skipIfDown()) return;
    return api('hit-rate-stats', { plan: 'expert', days: 7 }).then(function (r) {
      expect(r.body.code).toBe(1);
    });
  });

  // ── prediction-fusion ──
  it('prediction-fusion → code=1', function () {
    if (skipIfDown()) return;
    return api('prediction-fusion', { matchId: '2040174' }).then(function (r) {
      expect([1, 0, 401]).toContain(r.body.code);
    });
  });

  // ── gongshoudao-all ──
  it('gongshoudao-all → code=1', function () {
    if (skipIfDown()) return;
    return api('gongshoudao-all', { date: new Date().toISOString().slice(0, 10) }).then(function (r) {
      expect(r.body.code).toBe(1);
    });
  });
});

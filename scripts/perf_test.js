/**
 * Phase 3 — P2: perf_test.js
 * 性能/负载测试脚本
 *
 * 用法: node scripts/perf_test.js [--url=http://localhost:3000]
 *
 * 测试项目:
 *   1. API 并发请求压力测试
 *   2. 大量历史数据查询性能
 *   3. 功守道全量计算耗时
 *   4. 内存使用监测
 */

const http = require('http');
const { performance } = require('perf_hooks');

// ── 配置 ──
const BASE_URL = process.argv.find((a) => a.startsWith('--url='))
  ? process.argv.find((a) => a.startsWith('--url=')).split('=')[1]
  : 'http://localhost:3000';

const CONCURRENCY = 10;
const ITERATIONS = 5;

// ── 工具 ──
function request(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const isPost = !!body;
    const data = body ? JSON.stringify(body) : undefined;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: isPost ? 'POST' : 'GET',
      headers: isPost
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          }
        : {},
      timeout: 10000,
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });

    if (data) req.write(data);
    req.end();
  });
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function p95(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)];
}
function formatMs(ms) {
  return ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(2) + 's';
}

// ── 测试 1: 健康检查 ──
async function testHealthCheck() {
  console.log('═══════════════════════════════════');
  console.log('测试 1: 健康检查');
  console.log('═══════════════════════════════════');

  const start = performance.now();
  try {
    const resp = await request('/health');
    const elapsed = performance.now() - start;
    console.log(`  状态: ${resp.status}, 数据: ${JSON.stringify(resp.data).slice(0, 100)}`);
    console.log(`  耗时: ${formatMs(elapsed)}`);
    return { ok: resp.status === 200, elapsed };
  } catch (e) {
    console.log(`  失败: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ── 测试 2: API 并发压力 ──
async function testConcurrency() {
  console.log('\n═══════════════════════════════════');
  console.log(`测试 2: API 并发压力 (${CONCURRENCY} 并发 × ${ITERATIONS} 轮)`);
  console.log('═══════════════════════════════════');

  const endpoints = [
    { name: 'match-list', path: '/api', body: { action: 'match-list', date: new Date().toISOString().slice(0, 10) } },
    { name: 'filter-stats', path: '/api', body: { action: 'filter-stats' } },
    { name: 'filter-leagues', path: '/api', body: { action: 'filter-leagues' } },
    { name: 'hit-rate', path: '/api', body: { action: 'hit-rate', days: 30 } },
    { name: 'income-stats', path: '/api', body: { action: 'income-stats', days: 30 } },
  ];

  let totalSuccess = 0,
    totalFail = 0;
  const allTimes = [];

  for (let round = 0; round < ITERATIONS; round++) {
    const promises = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const ep = endpoints[i % endpoints.length];
      const start = performance.now();
      promises.push(
        request(ep.path, ep.body)
          .then(() => ({ ok: true, time: performance.now() - start }))
          .catch(() => ({ ok: false, time: performance.now() - start })),
      );
    }

    const results = await Promise.all(promises);
    results.forEach((r) => {
      if (r.ok) totalSuccess++;
      else totalFail++;
      allTimes.push(r.time);
    });

    console.log(`  轮次 ${round + 1}/${ITERATIONS}: ${results.filter((r) => r.ok).length}/${CONCURRENCY} 成功`);
  }

  console.log('\n  汇总:');
  console.log(`    总请求: ${totalSuccess + totalFail}`);
  console.log(`    成功:   ${totalSuccess} (${((totalSuccess / (totalSuccess + totalFail)) * 100).toFixed(1)}%)`);
  console.log(`    失败:   ${totalFail}`);
  console.log(`    平均:   ${formatMs(mean(allTimes))}`);
  console.log(`    中位:   ${formatMs(median(allTimes))}`);
  console.log(`    P95:    ${formatMs(p95(allTimes))}`);
  console.log(`    最慢:   ${formatMs(Math.max(...allTimes))}`);

  return { totalSuccess, totalFail, avgTime: mean(allTimes) };
}

// ── 测试 3: 回测查询性能 ──
async function testBacktestPerformance() {
  console.log('\n═══════════════════════════════════');
  console.log('测试 3: 回测查询性能');
  console.log('═══════════════════════════════════');

  const queries = [
    { name: '全部(无筛选)', body: { action: 'prediction-backtest', dateRange: 'all', page: 1, pageSize: 20 } },
    { name: '30天', body: { action: 'prediction-backtest', dateRange: '30d', page: 1, pageSize: 20 } },
    {
      name: '7天+SPF筛选',
      body: { action: 'prediction-backtest', dateRange: '7d', type: 'spf', page: 1, pageSize: 20 },
    },
    {
      name: '高置信度AI',
      body: { action: 'prediction-backtest', dateRange: '30d', aiConf: 'high', page: 1, pageSize: 20 },
    },
    { name: '大数据集(100条)', body: { action: 'prediction-backtest', dateRange: 'all', page: 1, pageSize: 100 } },
  ];

  for (const q of queries) {
    const start = performance.now();
    try {
      const resp = await request('/api', q.body);
      const elapsed = performance.now() - start;
      const itemCount = resp.data && resp.data.data ? resp.data.data.items.length : '?';
      console.log(`  ${q.name}: ${formatMs(elapsed)} (${itemCount} 条)`);
    } catch (e) {
      console.log(`  ${q.name}: 失败 (${e.message})`);
    }
  }
}

// ── 测试 4: 功守道全量计算 ──
async function testGongshoudaoPerformance() {
  console.log('\n═══════════════════════════════════');
  console.log('测试 4: 功守道全量计算性能');
  console.log('═══════════════════════════════════');

  const today = new Date().toISOString().slice(0, 10);

  // 单场计算
  console.log('  4a) 单场计算 (gongshoudao-compute):');
  try {
    const start = performance.now();
    const resp = await request('/api', {
      action: 'gongshoudao-compute',
      date: today,
    });
    const elapsed = performance.now() - start;
    const count = (resp.data && resp.data.data && resp.data.data.length) || 0;
    console.log(`    耗时: ${formatMs(elapsed)}, 比赛数: ${count}`);
  } catch (e) {
    console.log(`    失败: ${e.message}`);
  }

  // 全量刷新
  console.log('  4b) 全量缓存刷新 (gongshoudao-all):');
  try {
    const start = performance.now();
    const resp = await request('/api', {
      action: 'gongshoudao-all',
      date: today,
    });
    const elapsed = performance.now() - start;
    console.log(`    耗时: ${formatMs(elapsed)}`);
  } catch (e) {
    console.log(`    失败: ${e.message}`);
  }
}

// ── 测试 5: 量化方案生成性能 ──
async function testQuantPlanPerformance() {
  console.log('\n═══════════════════════════════════');
  console.log('测试 5: 量化方案生成性能');
  console.log('═══════════════════════════════════');

  const dates = [];
  const today = new Date();
  for (let i = 0; i < 5; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  for (const date of dates) {
    const start = performance.now();
    try {
      const resp = await request('/api', {
        action: 'quant-plan-list',
        date: date,
      });
      const elapsed = performance.now() - start;
      const planCount = resp.data && resp.data.data && resp.data.data.plans ? resp.data.data.plans.length : '?';
      console.log(`  ${date}: ${formatMs(elapsed)} (${planCount} 个方案)`);
    } catch (e) {
      console.log(`  ${date}: 失败 (${e.message})`);
    }
  }
}

// ── 测试 6: 内存使用快照 ──
function testMemory() {
  console.log('\n═══════════════════════════════════');
  console.log('测试 6: 内存使用快照');
  console.log('═══════════════════════════════════');

  const mem = process.memoryUsage();
  console.log(`  堆总量:    ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  堆使用:    ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  RSS:       ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  外部内存:  ${(mem.external / 1024 / 1024).toFixed(1)} MB`);

  return mem;
}

// ── 主函数 ──
async function main() {
  console.log('╔═══════════════════════════════════╗');
  console.log('║   JC-ZJFA 性能/负载测试            ║');
  console.log(`║   目标: ${BASE_URL}                 ║`);
  console.log('╚═══════════════════════════════════╝');

  const overallStart = performance.now();

  const results = {};

  // 先测试连通性
  const health = await testHealthCheck();
  results.health = health;

  if (!health.ok) {
    console.log('\n[跳过] 服务器不可达，跳过后续测试');
    console.log('提示: 请先在服务器上运行 npm start 或确保服务已启动');
    return;
  }

  // 串行执行避免服务器雪崩
  results.concurrency = await testConcurrency();
  await testBacktestPerformance();
  await testGongshoudaoPerformance();
  await testQuantPlanPerformance();
  results.memory = testMemory();

  const overallElapsed = performance.now() - overallStart;
  console.log(`\n═══════════════════════════════════`);
  console.log(`✅ 全部测试完成 — 总耗时: ${formatMs(overallElapsed)}`);
  console.log(`═══════════════════════════════════`);

  // 性能报告摘要
  console.log('\n性能报告:');
  console.log(
    `  并发成功率: ${((results.concurrency.totalSuccess / (results.concurrency.totalSuccess + results.concurrency.totalFail)) * 100).toFixed(1)}%`,
  );
  console.log(`  并发平均响应: ${formatMs(results.concurrency.avgTime)}`);
  console.log(`  本地堆使用: ${(results.memory.heapUsed / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((e) => {
  console.error('测试异常:', e.message);
  process.exit(1);
});

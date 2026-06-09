// ============================================================
// 性能基准测试门 — JC-ZJFA
// 分层测量功守道热路径、后台刷新与冷启动刷新
// 运行:
//   node scripts/benchmark_gongshoudao.js --mode=gate
//   node scripts/benchmark_gongshoudao.js --mode=refresh
//   node scripts/benchmark_gongshoudao.js --mode=cold --network
// ============================================================

const { performance } = require('perf_hooks');

const DEFAULT_ITERATIONS = {
  gateCache: 50,
  gateSingle: 120,
  refresh: 3,
  cold: 1,
};

const BUDGETS = {
  gateCache: { p50: 120, p95: 300, p99: 600 },
  gateSingle: { p50: 60, p95: 150, p99: 300 },
  refresh: { p50: 35000, p95: 35000, p99: 35000 },

  cold: { p50: 60000, p95: 60000, p99: 60000 },
};

let gs;
try {
  gs = require('../server/gongshoudao/index.js');
  if (typeof gs.computeAll !== 'function') throw new Error('computeAll 不是函数');
  if (typeof gs.computeSingleMatch !== 'function') throw new Error('computeSingleMatch 不是函数');
  if (typeof gs.getMatchResult !== 'function') throw new Error('getMatchResult 不是函数');
} catch (e) {
  console.error('[benchmark] 无法加载功守道模块:', e.message);
  console.error('请确保在项目根目录运行: node scripts/benchmark_gongshoudao.js');
  process.exit(1);
}

function getArg(name, fallback) {
  const prefix = '--' + name + '=';
  const hit = process.argv.find((arg) => arg.indexOf(prefix) === 0);
  return hit ? hit.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.indexOf('--' + name) >= 0;
}

function normalizeMode(value) {
  const mode = String(value || 'gate').toLowerCase();
  if (mode === 'hot') return 'gate';
  if (mode === 'full') return 'refresh';
  return mode;
}

function percentile(sorted, p) {
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function summarize(times) {
  const sorted = times.slice().sort((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    count: sorted.length,
    avg,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

function passBudget(stats, budget) {
  return stats.p50 < budget.p50 && stats.p95 < budget.p95 && stats.p99 < budget.p99;
}

function formatMs(value) {
  return value.toFixed(1) + 'ms';
}

async function withTimeout(task, ms, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise(function (_, reject) {
        timer = setTimeout(function () {
          reject(new Error(label + ' timeout after ' + ms + 'ms'));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function measureCase(name, iterations, budget, fn, options) {
  const opts = options || {};
  const warmup = opts.warmup || 0;
  const hardTimeoutMs = opts.hardTimeoutMs || 0;
  const times = [];
  let failures = 0;

  for (let i = 0; i < warmup; i++) {
    await Promise.resolve(fn());
  }

  for (let i = 1; i <= iterations; i++) {
    const start = performance.now();
    try {
      if (hardTimeoutMs > 0) {
        await withTimeout(fn, hardTimeoutMs, name);
      } else {
        await Promise.resolve(fn());
      }
      times.push(performance.now() - start);
    } catch (e) {
      failures++;
      console.log('\n  [WARN] ' + name + ' 第 ' + i + '/' + iterations + ' 次失败: ' + e.message);
    }
    if (opts.progress !== false) {
      const latest = times.length ? times[times.length - 1] : 0;
      process.stdout.write('\r  [' + String(i).padStart(3) + '/' + iterations + '] ' + name + ' ' + formatMs(latest));
    }
  }

  if (opts.progress !== false) console.log('');
  if (times.length === 0) {
    return { name, failures, passed: false, error: '所有执行均失败' };
  }

  const stats = summarize(times);
  return { name, failures, stats, budget, passed: passBudget(stats, budget) };
}

function printHeader(title) {
  console.log('');
  console.log('============================================================');
  console.log(title);
  console.log('============================================================');
}

function printResult(result) {
  if (result.error) {
    console.log('[FAIL] ' + result.name + ': ' + result.error);
    return;
  }
  const s = result.stats;
  const b = result.budget;
  console.log('------------------------------------------------------------');
  console.log(result.name + (result.passed ? ' [PASS]' : ' [FAIL]'));
  console.log('  count=' + s.count + ', failures=' + result.failures);
  console.log('  avg=' + formatMs(s.avg) + ', min=' + formatMs(s.min) + ', max=' + formatMs(s.max));
  console.log('  p50=' + formatMs(s.p50) + ' < ' + b.p50 + 'ms');
  console.log('  p95=' + formatMs(s.p95) + ' < ' + b.p95 + 'ms');
  console.log('  p99=' + formatMs(s.p99) + ' < ' + b.p99 + 'ms');
}

function createSampleRawStats() {
  return {
    homeTeam: '测试主队',
    guestTeam: '测试客队',
    homeSpf: '近10场 4胜3平3负',
    guestSpf: '近10场 3胜3平4负',
    homeWinGap_1: 3,
    homeWinGap_2: 1,
    homeLoseGap_1: 2,
    homeLoseGap_2: 1,
    awayWinGap_1: 2,
    awayWinGap_2: 1,
    awayLoseGap_1: 2,
    awayLoseGap_2: 1,
    homeWinQiu_0: 2,
    homeWinQiu_1: 4,
    homeWinQiu_2: 3,
    homeLoseQiu_0: 2,
    homeLoseQiu_1: 3,
    homeLoseQiu_2: 2,
    awayWinQiu_0: 2,
    awayWinQiu_1: 3,
    awayWinQiu_2: 2,
    awayLoseQiu_0: 3,
    awayLoseQiu_1: 3,
    awayLoseQiu_2: 1,
    homeDxqSame10Desc: '同主客:进球1.6 失球1.1',
    homeDxqDesc: '近期:进球1.7 失球1.0',
    awayDxqSame10Desc: '同主客:进球1.2 失球1.3',
    guestDxqDesc: '近期:进球1.3 失球1.4',
    homeEnterEfficiency: '进攻:0.18',
    homePreventEfficiency: '防守:0.10',
    guestEnterEfficiency: '进攻:0.12',
    guestPreventEfficiency: '防守:-0.08',
    homeFieldGoal: '1.6',
    homeFieldLose: '1.1',
    homeDxqPercentStr: '55%',
    guestDxqPercentStr: '48%',
    homePower: 55,
    guestPower: 50,
    homeWinPan: 0.53,
    guestWinPan: 0.47,
    homeWinAward: 1.95,
    drawAward: 3.35,
    guestWinAward: 3.65,
    rq: 0,
    jiaoFenDesc: '近6次交战 2胜2平2负 进7球失6球 大球2次',
    jiaoFenMatch1: '测试主队 2:1 测试客队',
    jiaoFenMatch2: '测试主队 1:1 测试客队',
  };
}

function createSampleMatchInfo() {
  return {
    matchId: 'benchmark-gs-001',
    date: '2026-06-08',
    num: '001',
    homeName: '测试主队',
    visitName: '测试客队',
    leagueName: '性能基准联赛',
    handicap: 0,
  };
}

function pickCachedMatchId() {
  try {
    const cache = gs.readCache();
    const globalCache = (cache && cache._global) || {};
    const hit = Object.entries(globalCache).find(function (entry) {
      const item = entry[1];
      return item && item.attackPattern;
    });
    return hit ? String(hit[0]).replace(/^m_/, '') : '';
  } catch (e) {
    return '';
  }
}

async function runGate() {
  printHeader('功守道 gate benchmark：用户热路径');
  const results = [];
  const cachedMatchId = pickCachedMatchId();

  if (cachedMatchId) {
    const cacheIterations = parseInt(getArg('cache-iterations', DEFAULT_ITERATIONS.gateCache), 10);
    results.push(
      await measureCase(
        'getMatchResult(cache-hit)',
        cacheIterations,
        BUDGETS.gateCache,
        async function () {
          const result = await gs.getMatchResult(cachedMatchId);
          if (!result || !result.attackPattern) throw new Error('缓存命中结果为空');
        },
        { warmup: 3 },
      ),
    );
  } else {
    console.log('[benchmark] 未找到 cache.json _global 样本，跳过 getMatchResult(cache-hit)');
  }

  const sampleRaw = createSampleRawStats();
  const sampleMatch = createSampleMatchInfo();
  const singleIterations = parseInt(getArg('single-iterations', DEFAULT_ITERATIONS.gateSingle), 10);
  results.push(
    await measureCase(
      'computeSingleMatch(cpu-only)',
      singleIterations,
      BUDGETS.gateSingle,
      function () {
        const result = gs.computeSingleMatch(sampleRaw, sampleMatch);
        if (!result || !result.attackPattern) throw new Error('单场计算结果为空');
      },
      { warmup: 5 },
    ),
  );

  results.forEach(printResult);
  return results.every((r) => r.passed);
}

async function runRefresh() {
  printHeader('功守道 refresh benchmark：后台增量刷新任务');
  const iterations = parseInt(getArg('iterations', DEFAULT_ITERATIONS.refresh), 10);
  const result = await measureCase(
    'computeAll(refresh)',
    iterations,
    BUDGETS.refresh,
    function () {
      return gs.computeAll({ forceRefresh: true });
    },
    { hardTimeoutMs: 40000 },
  );
  printResult(result);
  return result.passed;
}

async function runCold() {
  printHeader('功守道 cold benchmark：外部网络/冷启动刷新');
  if (!hasFlag('network')) {
    console.log('[benchmark] cold 模式需要显式增加 --network，避免 CI 误触发外部请求。');
    return true;
  }
  const result = await measureCase(
    'computeAll(cold-network)',
    DEFAULT_ITERATIONS.cold,
    BUDGETS.cold,
    function () {
      return gs.computeAll({ forceRefresh: true, cacheTtlMs: 0 });
    },
    { hardTimeoutMs: 70000 },
  );
  printResult(result);
  return result.passed;
}

async function main() {
  const mode = normalizeMode(getArg('mode', 'gate'));
  let passed;
  if (mode === 'gate') passed = await runGate();
  else if (mode === 'refresh') passed = await runRefresh();
  else if (mode === 'cold') passed = await runCold();
  else throw new Error('未知 benchmark mode: ' + mode);

  console.log('');
  if (passed) {
    console.log('[benchmark] 性能预算门通过');
    process.exit(0);
  }
  console.log('[benchmark] 性能预算门未通过');
  process.exit(1);
}

main().catch((e) => {
  console.error('[benchmark] Fatal:', e);
  process.exit(1);
});

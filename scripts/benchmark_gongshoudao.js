// ============================================================
// 性能基准测试门 — JC-ZJFA
// 测量功守道 computeAll 全量分析的耗时分布
// 运行: node scripts/benchmark_gongshoudao.js
// ============================================================

const { performance } = require('perf_hooks');
const path = require('path');
const fs = require('fs');

// ── 配置 ──
const ITERATIONS = 50; // 重复运行次数
const BUDGET = {
  p50: 200, // P50 < 200ms
  p95: 500, // P95 < 500ms
  p99: 1000, // P99 < 1000ms
};

// ── 导入被测模块 ──
let computeAll;
try {
  const gs = require('../server/gongshoudao/index.js');
  computeAll = gs.computeAll;
  if (typeof computeAll !== 'function') throw new Error('computeAll 不是函数');
} catch (e) {
  console.error('❌ 无法加载功守道 computeAll 模块:', e.message);
  console.error('   请确保在项目根目录运行: node scripts/benchmark_gongshoudao.js');
  process.exit(1);
}

// ════════════════════════════════════════════════════════════
console.log('');
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║      功守道 computeAll 性能基准测试                      ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log('');

const times = [];

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[idx];
}

async function run() {
  for (let i = 1; i <= ITERATIONS; i++) {
    const start = performance.now();
    try {
      await computeAll();
    } catch (e) {
      console.log(`  ⚠️ [${i}/${ITERATIONS}] computeAll 异常: ${e.message}`);
      times.push(null); // 标记失败
      continue;
    }
    const elapsed = performance.now() - start;
    times.push(elapsed);
    process.stdout.write(`\r  [${String(i).padStart(3)}/${ITERATIONS}] ${elapsed.toFixed(1)}ms`);
  }

  console.log('\n');

  const validTimes = times.filter((t) => t !== null);

  if (validTimes.length === 0) {
    console.log('❌ 所有执行都失败了，无法计算指标。');
    process.exit(1);
  }

  const sorted = [...validTimes].sort((a, b) => a - b);

  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  console.log('═══════════════════════════════════════════════════════');
  console.log(`  测试次数: ${ITERATIONS} (成功 ${validTimes.length})`);
  console.log(`  平均值:   ${avg.toFixed(1)}ms`);
  console.log(`  最小值:   ${min.toFixed(1)}ms`);
  console.log(`  最大值:   ${max.toFixed(1)}ms`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`   P50:     ${p50.toFixed(1)}ms  (预算: <${BUDGET.p50}ms) ${p50 < BUDGET.p50 ? '✅' : '❌'}`);
  console.log(`   P95:     ${p95.toFixed(1)}ms  (预算: <${BUDGET.p95}ms) ${p95 < BUDGET.p95 ? '✅' : '❌'}`);
  console.log(`   P99:     ${p99.toFixed(1)}ms  (预算: <${BUDGET.p99}ms) ${p99 < BUDGET.p99 ? '✅' : '❌'}`);
  console.log('═══════════════════════════════════════════════════════');

  // ── 判定结果 ──
  const p50Pass = p50 < BUDGET.p50;
  const p95Pass = p95 < BUDGET.p95;
  const p99Pass = p99 < BUDGET.p99;

  if (p50Pass && p95Pass && p99Pass) {
    console.log('\n✅ 所有性能指标通过预算门\n');
    process.exit(0);
  } else {
    const failures = [];
    if (!p50Pass) failures.push(`P50=${p50.toFixed(1)}ms >= ${BUDGET.p50}ms`);
    if (!p95Pass) failures.push(`P95=${p95.toFixed(1)}ms >= ${BUDGET.p95}ms`);
    if (!p99Pass) failures.push(`P99=${p99.toFixed(1)}ms >= ${BUDGET.p99}ms`);
    console.log(`\n❌ 性能预算门未通过: ${failures.join(', ')}\n`);
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});

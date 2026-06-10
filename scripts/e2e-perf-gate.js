/* eslint-disable no-console */
const fs = require('fs');

const reportPath = process.argv[2] || 'E:/JC-ZJFA/.codebuddy/e2e_perf_report.json';
const p95Budget = Number(process.argv[3] || 3000);

if (!fs.existsSync(reportPath)) {
  console.error(`[perf-gate] 报告不存在: ${reportPath}`);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const rows = [];

function walkSuite(suite) {
  (suite.specs || []).forEach((sp) => {
    const result = sp.tests?.[0]?.results?.[0];
    if (!result) return;
    rows.push({
      file: sp.file,
      title: sp.title,
      ok: !!sp.ok,
      status: result.status,
      duration: typeof result.duration === 'number' ? result.duration : null,
    });
  });
  (suite.suites || []).forEach(walkSuite);
}

(report.suites || []).forEach(walkSuite);

const measured = rows.filter((r) => typeof r.duration === 'number');
if (!measured.length) {
  console.error('[perf-gate] 未找到可用的 duration 数据');
  process.exit(1);
}

const durations = measured.map((r) => r.duration).sort((a, b) => a - b);
const avgMs = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
const p95Ms = durations[Math.floor((durations.length - 1) * 0.95)];
const failed = measured.filter((r) => !r.ok || r.status !== 'passed');

console.log('[perf-gate] measured:', measured.length);
console.log('[perf-gate] avgMs:', avgMs);
console.log('[perf-gate] p95Ms:', p95Ms);
if (failed.length) {
  console.log('[perf-gate] failed cases:');
  failed.forEach((f) => console.log(`  - ${f.file} :: ${f.title} (${f.duration}ms)`));
}

if (failed.length) {
  console.error('[perf-gate] 存在失败用例，性能门禁未通过');
  process.exit(1);
}

if (p95Ms > p95Budget) {
  console.error(`[perf-gate] P95 超预算: ${p95Ms}ms > ${p95Budget}ms`);
  process.exit(1);
}

console.log('[perf-gate] PASS');

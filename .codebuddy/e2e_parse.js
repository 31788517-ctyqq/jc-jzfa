const fs = require('fs');
const p = 'E:/JC-ZJFA/.codebuddy/e2e_full_speed.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const rows = [];

function walkSuite(suite) {
  (suite.specs || []).forEach((sp) => {
    const test = (sp.tests && sp.tests[0]) || null;
    const result = test && test.results && test.results[0] ? test.results[0] : null;
    rows.push({
      file: sp.file,
      title: sp.title,
      ok: !!sp.ok,
      duration: result ? result.duration : null,
      status: result ? result.status : 'unknown',
    });
  });
  (suite.suites || []).forEach(walkSuite);
}

(j.suites || []).forEach(walkSuite);

const withDuration = rows.filter((r) => typeof r.duration === 'number');
const durations = withDuration.map((r) => r.duration).sort((a, b) => a - b);
const avgMs = withDuration.length
  ? Math.round(withDuration.reduce((a, b) => a + b.duration, 0) / withDuration.length)
  : 0;
const p95Ms = durations.length ? durations[Math.floor((durations.length - 1) * 0.95)] : 0;
const p75Ms = durations.length ? durations[Math.floor((durations.length - 1) * 0.75)] : 0;

const topSlow = [...withDuration].sort((a, b) => b.duration - a.duration).slice(0, 15);
const failed = rows.filter((r) => !r.ok);

const output = {
  total: rows.length,
  pass: rows.filter((r) => r.ok).length,
  fail: failed.length,
  avgMs,
  p75Ms,
  p95Ms,
  topSlow,
  failed,
};

console.log(JSON.stringify(output, null, 2));

const fs = require('fs');
const path = require('path');

const coveragePath = path.join(__dirname, '..', 'coverage', 'coverage-final.json');
const limitArg = parseInt(process.argv[2], 10);
const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : 15;

if (!fs.existsSync(coveragePath)) {
  console.error('未找到 coverage/coverage-final.json，请先运行 npm run test:coverage');
  process.exit(1);
}

function percentage(counterMap) {
  const values = Object.values(counterMap || {});
  if (values.length === 0) return 100;

  const covered = values.filter((value) => {
    if (Array.isArray(value)) return value.some((count) => count > 0);
    return value > 0;
  }).length;

  return Math.round((covered / values.length) * 1000) / 10;
}

const raw = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
const rows = Object.values(raw)
  .map((entry) => {
    const statements = percentage(entry.s);
    const branches = percentage(entry.b);
    const functions = percentage(entry.f);
    return {
      path: path.relative(path.join(__dirname, '..'), entry.path),
      statements,
      branches,
      functions,
      score: Math.min(statements, branches, functions),
    };
  })
  .sort((a, b) => a.score - b.score);

console.log('statements\tbranches\tfunctions\tfile');
rows.slice(0, limit).forEach((row) => {
  console.log([row.statements, row.branches, row.functions, row.path].join('\t'));
});

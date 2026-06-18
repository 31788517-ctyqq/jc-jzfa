const fs = require('fs');
const path = require('path');

const root = 'e:/JC-ZJFA/server/odds_history';
const probes = [
  { num: '周一001', spf: { home: 1.65, draw: 3.75, away: 3.9 } },
  { num: '周一005', spf: { home: 2.59, draw: 3.3, away: 2.27 } },
  { num: '周一007', spf: { home: 1.99, draw: 3.25, away: 3.13 } },
];

const files = fs.readdirSync(root).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
for (const p of probes) {
  let found = [];
  for (const f of files) {
    const json = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
    const odds = (json && json.odds) ? json.odds : json;
    const e = odds && odds[p.num];
    if (!e || !e.spf) continue;
    const s = e.spf;
    if (Math.abs(Number(s.home) - p.spf.home) < 1e-6 &&
        Math.abs(Number(s.draw) - p.spf.draw) < 1e-6 &&
        Math.abs(Number(s.away) - p.spf.away) < 1e-6) {
      found.push(f.replace('.json', ''));
    }
  }
  console.log(p.num + ' => ' + (found.length ? found.join(',') : 'NOT_FOUND'));
}

const fs = require('fs');
const p = 'E:/JC-ZJFA/.codebuddy/e2e_speed_passset.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const rows = [];
function walk(s) {
  (s.specs || []).forEach((sp) => {
    const r = sp.tests?.[0]?.results?.[0];
    rows.push({ file: sp.file, title: sp.title, ok: !!sp.ok, duration: r?.duration ?? null, status: r?.status ?? 'unknown' });
  });
  (s.suites || []).forEach(walk);
}
(j.suites || []).forEach(walk);
const pass = rows.filter((r) => r.ok && typeof r.duration === 'number');
const d = pass.map((r) => r.duration).sort((a,b)=>a-b);
const avg = d.length ? Math.round(d.reduce((a,b)=>a+b,0)/d.length) : 0;
const p50 = d.length ? d[Math.floor((d.length-1)*0.5)] : 0;
const p75 = d.length ? d[Math.floor((d.length-1)*0.75)] : 0;
const p95 = d.length ? d[Math.floor((d.length-1)*0.95)] : 0;
const top = [...pass].sort((a,b)=>b.duration-a.duration).slice(0,10);
console.log(JSON.stringify({total:rows.length, pass:pass.length, avgMs:avg, p50Ms:p50, p75Ms:p75, p95Ms:p95, topSlow:top}, null, 2));

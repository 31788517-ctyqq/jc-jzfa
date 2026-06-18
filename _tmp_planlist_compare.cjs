const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;
const API_URL = 'https://zj.100qiu.com/api';

function post(action, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(Object.assign({ action }, data || {}));
    const req = https.request(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': 'zj.100qiu.com',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 25000,
      rejectUnauthorized: false,
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(raw || '{}');
          if (json && json.code === 1) return resolve(json.data || {});
          return resolve({ __apiError: true, __raw: json });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

function planSig(p) {
  const name = p.planName || p.name || '';
  const ms = (p.matches || []).map(m => String(m.matchNum || m.num || '')).sort().join(',');
  return name + '|' + ms;
}

async function main() {
  const dir = path.join(ROOT, '_audit_ground_truth');
  const dates = fs.readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => f.replace('.json', ''))
    .sort();

  const summary = { dates: 0, apiErrors: 0, countMismatchDates: 0, signatureMismatchDates: 0 };
  const details = { countMismatch: [], signatureMismatch: [], apiErrors: [] };

  for (const d of dates) {
    summary.dates++;
    const gt = JSON.parse(fs.readFileSync(path.join(dir, d + '.json'), 'utf8'));
    const gtPlans = Array.isArray(gt.plans) ? gt.plans : [];
    let prod;
    try {
      prod = await post('plan-list', { date: d, qualityMode: 'all', includeReasons: 0 });
    } catch (e) {
      summary.apiErrors++;
      details.apiErrors.push({ date: d, err: e.message });
      continue;
    }
    if (prod && prod.__apiError) {
      summary.apiErrors++;
      details.apiErrors.push({ date: d, err: JSON.stringify(prod.__raw || {}).slice(0, 180) });
      continue;
    }
    const prodPlans = Array.isArray(prod.plans) ? prod.plans : [];

    if (prodPlans.length !== gtPlans.length) {
      summary.countMismatchDates++;
      if (details.countMismatch.length < 120) {
        details.countMismatch.push({ date: d, prodCount: prodPlans.length, gtCount: gtPlans.length });
      }
    }

    const gtSet = new Set(gtPlans.map(planSig));
    const prodSet = new Set(prodPlans.map(planSig));
    let missing = [];
    let extra = [];

    for (const s of gtSet) if (!prodSet.has(s)) missing.push(s);
    for (const s of prodSet) if (!gtSet.has(s)) extra.push(s);

    if (missing.length || extra.length) {
      summary.signatureMismatchDates++;
      if (details.signatureMismatch.length < 120) {
        details.signatureMismatch.push({ date: d, missing: missing.slice(0, 20), extra: extra.slice(0, 20) });
      }
    }
  }

  const out = { generatedAt: new Date().toISOString(), summary, details };
  const outPath = path.join(ROOT, '_prod_planlist_compare.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

  console.log('PLAN_COMPARE_DONE');
  console.log('dates=' + summary.dates + ', apiErrors=' + summary.apiErrors + ', countMismatchDates=' + summary.countMismatchDates + ', signatureMismatchDates=' + summary.signatureMismatchDates);
  console.log('RESULT=' + outPath);
}

main().catch(e => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});

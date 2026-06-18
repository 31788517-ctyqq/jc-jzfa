const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;
const API_URL = 'https://zj.100qiu.com/api';
const TIMEOUT = 25000;

function normalizeScore(v) {
  if (v == null) return '';
  return String(v).trim().replace(/：/g, '-').replace(/:/g, '-').replace(/\s+/g, '');
}

function numEq(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return false;
  return Math.abs(na - nb) < 1e-6;
}

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
      timeout: TIMEOUT,
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
          return reject(new Error('JSON parse failed: ' + e.message + ' raw=' + String(raw).slice(0, 180)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.write(body);
    req.end();
  });
}

function loadLocalData() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'data.json'), 'utf8'));
  const mMap = data.m || {};
  const byDateNum = new Map();
  for (const k of Object.keys(mMap)) {
    const m = mMap[k];
    if (!m || !m.date) continue;
    const d = String(m.date).slice(0, 10);
    const num = String(m.num || m.matchNum || '').trim();
    if (!num) continue;
    byDateNum.set(d + '|' + num, m);
  }
  return byDateNum;
}

function loadOdds(dateStr) {
  try {
    const p = path.join(ROOT, 'server', 'odds_history', dateStr + '.json');
    if (!fs.existsSync(p)) return null;
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    return (json && json.odds) ? json.odds : json;
  } catch {
    return null;
  }
}

function pickDatesFromAudit() {
  const dir = path.join(ROOT, '_audit_ground_truth');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => f.replace('.json', ''))
    .sort();
}

async function main() {
  const dates = pickDatesFromAudit();
  if (!dates.length) {
    console.log('NO_AUDIT_DATES');
    process.exit(2);
  }

  const localMap = loadLocalData();
  const summary = {
    scannedDates: 0,
    scannedMatches: 0,
    apiErrors: 0,
    missingLocalMatch: 0,
    scoreMismatch: 0,
    halfAsFullSuspected: 0,
    halfMismatch: 0,
    oddsCheckedMatches: 0,
    oddsMismatchSpf: 0,
    oddsMismatchRqspf: 0,
    handicapMismatch: 0,
  };

  const details = {
    scoreMismatch: [],
    halfAsFullSuspected: [],
    halfMismatch: [],
    oddsMismatchSpf: [],
    oddsMismatchRqspf: [],
    handicapMismatch: [],
    apiErrors: [],
  };

  for (const dateStr of dates) {
    summary.scannedDates++;
    let matchList;
    try {
      matchList = await post('match-list', { date: dateStr });
    } catch (e) {
      summary.apiErrors++;
      details.apiErrors.push({ date: dateStr, action: 'match-list', err: e.message });
      continue;
    }
    if (matchList && matchList.__apiError) {
      summary.apiErrors++;
      details.apiErrors.push({ date: dateStr, action: 'match-list', err: JSON.stringify(matchList.__raw || {}).slice(0, 180) });
      continue;
    }

    const matches = Array.isArray(matchList) ? matchList : (matchList.data || []);
    const ids = [];
    const oddsLocal = loadOdds(dateStr) || {};

    for (const pm of matches) {
      const num = String(pm.num || pm.matchNum || '').trim();
      const key = dateStr + '|' + num;
      const lm = localMap.get(key);
      summary.scannedMatches++;
      if (pm.id || pm.matchId) ids.push(String(pm.id || pm.matchId));

      if (!lm) {
        summary.missingLocalMatch++;
        continue;
      }

      const pScore = normalizeScore(pm.score);
      const pHalf = normalizeScore(pm.halfScore);
      const lScore = normalizeScore(lm.score);
      const lHalf = normalizeScore(lm.halfScore);

      if (lScore && pScore && pScore !== lScore) {
        summary.scoreMismatch++;
        if (details.scoreMismatch.length < 200) {
          details.scoreMismatch.push({ date: dateStr, num, matchId: pm.id || pm.matchId || '', prodScore: pScore, localScore: lScore, localHalf: lHalf });
        }
      }

      if (lScore && lHalf && pScore && pScore === lHalf && lScore !== lHalf) {
        summary.halfAsFullSuspected++;
        if (details.halfAsFullSuspected.length < 200) {
          details.halfAsFullSuspected.push({ date: dateStr, num, matchId: pm.id || pm.matchId || '', prodScore: pScore, localFull: lScore, localHalf: lHalf });
        }
      }

      if (lHalf && pHalf && pHalf !== lHalf) {
        summary.halfMismatch++;
        if (details.halfMismatch.length < 200) {
          details.halfMismatch.push({ date: dateStr, num, matchId: pm.id || pm.matchId || '', prodHalf: pHalf, localHalf: lHalf, localFull: lScore });
        }
      }
    }

    if (ids.length) {
      let oddsResp;
      try {
        oddsResp = await post('batch-match-odds', { matchIds: ids, date: dateStr });
      } catch (e) {
        summary.apiErrors++;
        details.apiErrors.push({ date: dateStr, action: 'batch-match-odds', err: e.message });
        continue;
      }
      if (oddsResp && oddsResp.__apiError) {
        summary.apiErrors++;
        details.apiErrors.push({ date: dateStr, action: 'batch-match-odds', err: JSON.stringify(oddsResp.__raw || {}).slice(0, 180) });
        continue;
      }

      const oddsData = oddsResp || {};
      for (const mid of Object.keys(oddsData)) {
        const po = oddsData[mid] || {};
        const num = String(po.matchNum || '').trim();
        if (!num) continue;
        const lo = oddsLocal[num] || null;
        if (!lo) continue;
        summary.oddsCheckedMatches++;

        const pSpf = po.spf || {};
        const lSpf = lo.spf || {};
        if ((pSpf.home != null && lSpf.home != null && !numEq(pSpf.home, lSpf.home)) ||
            (pSpf.draw != null && lSpf.draw != null && !numEq(pSpf.draw, lSpf.draw)) ||
            (pSpf.away != null && lSpf.away != null && !numEq(pSpf.away, lSpf.away))) {
          summary.oddsMismatchSpf++;
          if (details.oddsMismatchSpf.length < 200) details.oddsMismatchSpf.push({ date: dateStr, num, matchId: mid, prod: pSpf, local: lSpf });
        }

        const pRq = po.rqspf || {};
        const lRq = lo.rqspf || {};
        if ((pRq.home != null && lRq.home != null && !numEq(pRq.home, lRq.home)) ||
            (pRq.draw != null && lRq.draw != null && !numEq(pRq.draw, lRq.draw)) ||
            (pRq.away != null && lRq.away != null && !numEq(pRq.away, lRq.away))) {
          summary.oddsMismatchRqspf++;
          if (details.oddsMismatchRqspf.length < 200) details.oddsMismatchRqspf.push({ date: dateStr, num, matchId: mid, prod: pRq, local: lRq });
        }

        const pHcp = pRq.handicap != null ? Number(pRq.handicap) : (po.handicap != null ? Number(po.handicap) : null);
        const lHcp = lRq.handicap != null ? Number(lRq.handicap) : (lo.handicap != null ? Number(lo.handicap) : null);
        if (pHcp != null && lHcp != null && !Number.isNaN(pHcp) && !Number.isNaN(lHcp) && Math.abs(pHcp - lHcp) > 1e-6) {
          summary.handicapMismatch++;
          if (details.handicapMismatch.length < 200) details.handicapMismatch.push({ date: dateStr, num, matchId: mid, prodHandicap: pHcp, localHandicap: lHcp });
        }
      }
    }
  }

  const out = { generatedAt: new Date().toISOString(), sourceDates: dates.length, summary, details };
  const outPath = path.join(ROOT, '_prod_history_audit_result.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

  console.log('AUDIT_DONE');
  console.log('dates=' + summary.scannedDates + ', matches=' + summary.scannedMatches + ', oddsChecked=' + summary.oddsCheckedMatches);
  console.log('halfAsFullSuspected=' + summary.halfAsFullSuspected + ', scoreMismatch=' + summary.scoreMismatch + ', halfMismatch=' + summary.halfMismatch);
  console.log('oddsMismatchSpf=' + summary.oddsMismatchSpf + ', oddsMismatchRqspf=' + summary.oddsMismatchRqspf + ', handicapMismatch=' + summary.handicapMismatch);
  console.log('apiErrors=' + summary.apiErrors + ', missingLocalMatch=' + summary.missingLocalMatch);
  console.log('RESULT=' + outPath);
}

main().catch((e) => {
  console.error('FATAL', e && e.stack ? e.stack : e);
  process.exit(1);
});

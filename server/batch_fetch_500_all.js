/**
 * 从500.com抓取所有可用日期的完整赔率
 * 范围: 2026-04-28 ~ 今天 (含SPF/RQSPF/半全场/总进球数)
 */
const fs = require('fs');
const path = require('path');
const { fetchOdds } = require('./fetch_500odds');

const OUTPUT_DIR = path.join(__dirname, 'ttyingqiu_data');

function generateDates(start, end) {
  const dates = [];
  const cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // 从500.com最早有数据的日期开始
  const dates = generateDates('2026-04-28', '2026-05-25');
  console.log(`Dates: ${dates.length} days (2026-04-28 ~ 2026-05-25)\n`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const allData = {};
  let total = 0;

  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    try {
      const odds = await fetchOdds(d);
      const keys = Object.keys(odds);
      if (keys.length > 0) {
        const dayMatches = keys.sort().map(k => {
          const m = odds[k];
          return {
            matchNum: k,
            homeName: m.homeName || '',
            visitName: m.visitName || '',
            handicap: m.handicap || 0,
            spf: m.spf || {},
            rqspf: m.rqspf || {},
            halfFull: m.halfFull || null,
            totalGoals: m.totalGoals || null,
          };
        });
        allData[d] = dayMatches;
        total += dayMatches.length;
        console.log(`[${String(i+1).padStart(3)}] ${d}: ${dayMatches.length} matches`);
      }
    } catch(e) {
      console.log(`[${String(i+1).padStart(3)}] ${d}: ERROR - ${e.message}`);
    }
    if (i < dates.length - 1) await sleep(200);
  }

  // Save JSON
  const jsonPath = path.join(OUTPUT_DIR, 'odds_500_full.json');
  fs.writeFileSync(jsonPath, JSON.stringify(allData, null, 2), 'utf-8');
  console.log(`\nJSON: ${jsonPath}`);

  // CSV
  const csvPath = path.join(OUTPUT_DIR, 'odds_500_full.csv');
  const header = 'date,matchNum,home,away,hcp,' +
    'SPF_w,SPF_d,SPF_l,RQSPF_w,RQSPF_d,RQSPF_l,' +
    'BQC_hh,BQC_hd,BQC_ha,BQC_dh,BQC_dd,BQC_da,BQC_ah,BQC_ad,BQC_aa,' +
    'JQS_0,JQS_1,JQS_2,JQS_3,JQS_4,JQS_5,JQS_6,JQS_7p';
  const lines = [header];

  Object.keys(allData).sort().forEach(d => {
    allData[d].forEach(m => {
      const s = m.spf || {}, rq = m.rqspf || {}, hf = m.halfFull || {}, tg = m.totalGoals || {};
      lines.push([
        d, m.matchNum, m.homeName, m.visitName, m.handicap,
        s.home||'', s.draw||'', s.away||'',
        rq.home||'', rq.draw||'', rq.away||'',
        hf.hh||'', hf.hd||'', hf.ha||'',
        hf.dh||'', hf.dd||'', hf.da||'',
        hf.ah||'', hf.ad||'', hf.aa||'',
        tg['0']||'', tg['1']||'', tg['2']||'', tg['3']||'',
        tg['4']||'', tg['5']||'', tg['6']||'', tg['7+']||'',
      ].join(','));
    });
  });

  fs.writeFileSync(csvPath, lines.join('\n'), 'utf-8');
  console.log(`CSV: ${csvPath}`);
  console.log(`\nDONE: ${Object.keys(allData).length} days, ${total} matches`);
}

main().catch(e => { console.error(e); process.exit(1); });

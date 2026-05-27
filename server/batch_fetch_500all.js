/** 批量从500.com抓取全部赔率: SPF/RQSPF/BQC/BF/JQS */
const fs = require('fs');
const path = require('path');
const { fetchAllOdds } = require('./fetch_500all');

const OUT = path.join(__dirname, 'ttyingqiu_data');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

function genDates(s, e) {
  const d = [], cur = new Date(s), end = new Date(e);
  while (cur <= end) { d.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1); }
  return d;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const dates = genDates('2026-04-28', '2026-05-25');
  console.log(`Dates: ${dates.length} days\n`);

  const all = {};
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    try {
      const odds = await fetchAllOdds(d);
      const keys = Object.keys(odds).sort();
      if (keys.length > 0) {
        all[d] = {};
        keys.forEach(k => { all[d][k] = odds[k]; });
        console.log(`[${String(i+1).padStart(3)}] ${d}: ${keys.length} matches`);
      } else {
        console.log(`[${String(i+1).padStart(3)}] ${d}: 0 matches`);
      }
    } catch(e) {
      console.log(`[${String(i+1).padStart(3)}] ${d}: ERR ${e.message}`);
    }
    if (i < dates.length - 1) await sleep(200);
  }

  // JSON
  fs.writeFileSync(path.join(OUT, 'odds_500_allplays.json'), JSON.stringify(all, null, 2), 'utf-8');
  console.log(`\nJSON: odds_500_allplays.json`);

  // CSV - all play types
  const lines = ['date,matchNum,home,away,hcp,' +
    'SPF_w,SPF_d,SPF_l,RQSPF_w,RQSPF_d,RQSPF_l,' +
    'BQC_ss,BQC_sp,BQC_sf,BQC_ps,BQC_pp,BQC_pf,BQC_fs,BQC_fp,BQC_ff,' +
    'JQS_0,JQS_1,JQS_2,JQS_3,JQS_4,JQS_5,JQS_6,JQS_7p,' +
    'BF_scores'];

  Object.keys(all).sort().forEach(d => {
    Object.keys(all[d]).sort().forEach(k => {
      const m = all[d][k] || {};
      const s = m.spf || {}, rq = m.rqspf || {}, hf = m.halfFull || {}, tg = m.totalGoals || {}, bf = m.scores || {};
      const bfStr = JSON.stringify(bf).replace(/,/g, ';');
      lines.push([
        d, k, m.homeName||'', m.visitName||'', m.handicap||0,
        s.home||'', s.draw||'', s.away||'',
        rq.home||'', rq.draw||'', rq.away||'',
        hf.hh||'', hf.hd||'', hf.ha||'',
        hf.dh||'', hf.dd||'', hf.da||'',
        hf.ah||'', hf.ad||'', hf.aa||'',
        tg['0']||'', tg['1']||'', tg['2']||'', tg['3']||'',
        tg['4']||'', tg['5']||'', tg['6']||'', tg['7+']||'',
        bfStr,
      ].join(','));
    });
  });

  fs.writeFileSync(path.join(OUT, 'odds_500_allplays.csv'), lines.join('\n'), 'utf-8');
  console.log(`CSV: odds_500_allplays.csv`);
  console.log(`\nDONE`);
}

main().catch(e => { console.error(e); process.exit(1); });

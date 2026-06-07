const https = require('https');
const fs = require('fs');

const EID = 7428, HOST = 'dstd.500.com', SINCE = new Date('2026-01-01T00:00:00+08:00');
const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

function post(pn) {
  return new Promise((resolve, reject) => {
    const body = 'commresource=' + encodeURIComponent(JSON.stringify({ channel: 'mesport', platform: 'pc' })) +
      '&eid=' + EID + '&pn=' + pn + '&rn=20&articletype=';
    const req = https.request({
      method: 'POST', hostname: HOST, path: '/transpondsanyol/api/meweb/expert/expert_history_articles', agent,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://' + HOST + '/zhuanjia/' + EID, Origin: 'https://' + HOST },
      timeout: 15000,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve((j.status === '100' && j.data && j.data.articles) ? j.data.articles : []);
        } catch (e) { resolve([]); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArticle(raw) {
  let rc = null;
  try { if (raw.resultcontent) rc = typeof raw.resultcontent === 'string' ? JSON.parse(raw.resultcontent) : raw.resultcontent; } catch (e) { }
  const pro = (rc && rc.proinfo) || [];
  const gd = raw.gamedetail || [];
  const recs = [];
  if (pro.length > 0) {
    for (const m of pro) {
      const g = gd.find(x => x.gameid === m.gameid || x.matchnum === m.matchnum);
      const dm = { '3': '主胜', '1': '平局', '0': '客胜' };
      let dir = dm[m.choice] || m.choice;
      if (m.rangqiu && m.rangqiu !== '') dir += '(让球' + m.rangqiu + ')';
      if (m.tinfo) dir += ' [' + m.tinfo + ']';
      recs.push({
        matchnum: m.matchnum || '', home: m.home || (g ? g.home : ''), away: m.away || (g ? g.away : ''),
        league: m.ls || (g ? g.ls : ''), stime: m.stime || (g ? g.stime : ''),
        direction: dir, choice: m.choice || '', odds: m.pei || '', handicap: m.rangqiu || '',
        score: m.score || '', hit: m.result === 1 ? 'V' : (m.result === 0 ? 'X' : ''),
      });
    }
  }
  let ov = '待揭晓';
  if (pro.length > 0) {
    const h = pro.filter(m => m.result === 1).length;
    if (raw.result === '2') ov = 'V 命中(' + h + '/' + pro.length + ')';
    else if (raw.result === '0') ov = 'X 错误(' + h + '/' + pro.length + ')';
  }
  return {
    aid: raw.aid, nickname: raw.nickname || '', publishtime: raw.publishtime,
    ggtype: raw.ggtype || '', ggtypename: raw.ggtypename || '', title: raw.title || '',
    game: raw.game || '', paymoney: raw.paymoney || '', hits: raw.hits || 0,
    result: ov, recommendation_count: recs.length, recommendations: recs,
  };
}

async function main() {
  const st = Date.now();
  console.log('抓取 数据梁(eid=' + EID + ') 2026年推荐数据...\n');
  const all = [];
  const seen = new Set();
  let pn = 1, ec = 0;
  while (pn <= 60) {
    await sleep(800 + Math.random() * 1500);
    const arts = await post(pn);
    if (arts.length === 0) { ec++; console.log('第' + pn + '页: 空 (' + ec + '连空)'); if (ec >= 3) break; pn++; continue; }
    ec = 0;
    let nc = 0, early = '';
    for (const a of arts) {
      if (a.aid && !seen.has(a.aid)) { seen.add(a.aid); all.push(parseArticle(a)); nc++; }
      if (!early || a.publishtime < early) early = a.publishtime;
    }
    console.log('第' + pn + '页: ' + arts.length + '条 (增' + nc + '), 最早 ' + early);
    const last = arts[arts.length - 1];
    if (last && last.publishtime && new Date(last.publishtime.replace(' ', 'T') + '+08:00') < SINCE) {
      console.log('已过 2026-01-01，停止');
      break;
    }
    pn++;
  }

  const flt = all.filter(a => !a.publishtime || new Date(a.publishtime.replace(' ', 'T') + '+08:00') >= SINCE);
  flt.sort((a, b) => (b.publishtime || '').localeCompare(a.publishtime || ''));

  const tR = flt.reduce((s, a) => s + a.recommendation_count, 0);
  const hit = flt.filter(a => a.result.startsWith('V'));
  const mis = flt.filter(a => a.result.startsWith('X'));
  const pnd = flt.filter(a => a.result === '待揭晓');
  const rate = (hit.length + mis.length) > 0 ? (hit.length / (hit.length + mis.length) * 100).toFixed(1) : 'N/A';

  console.log('\n══ 统计 ══');
  console.log('  方案:' + flt.length + '  场次:' + tR + '  命中:' + hit.length + '  错误:' + mis.length + '  待揭晓:' + pnd.length + '  命中率:' + rate + '%');
  if (flt.length) console.log('  时间:' + flt[flt.length - 1].publishtime + ' ~ ' + flt[0].publishtime);

  const out = {
    expert: { eid: EID, nickname: '数据梁' },
    generated_at: new Date().toISOString(), since: '2026-01-01',
    summary: {
      total_articles: flt.length, total_recommendations: tR,
      hit_count: hit.length, miss_count: mis.length, pending_count: pnd.length,
      hit_rate: rate,
      date_range: flt.length ? flt[flt.length - 1].publishtime + ' ~ ' + flt[0].publishtime : 'N/A',
      elapsed_seconds: ((Date.now() - st) / 1000).toFixed(1),
    },
    articles: flt,
  };
  const fpath = 'server/expert_7428_recommendations.json';
  fs.writeFileSync(fpath, JSON.stringify(out, null, 2));
  console.log('\n已保存: ' + fpath + ' (' + (fs.statSync(fpath).size / 1024).toFixed(1) + 'KB, 耗时' + out.summary.elapsed_seconds + 's)');

  // 命中方案展示
  console.log('\n══ 命中方案 ══');
  hit.forEach(a => {
    console.log(a.publishtime + ' | ' + a.result + ' | ' + a.title);
    a.recommendations.forEach(r => {
      console.log('  ' + r.matchnum + ' ' + r.home + ' VS ' + r.away + ' | ' + r.direction + ' | ' + r.score + ' ' + r.hit);
    });
  });
}

main().catch(e => { console.error('失败:', e); process.exit(1); });

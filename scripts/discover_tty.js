/**
 * tt赢球 快速专家发现 — 高并发探测 + 定期保存
 * 用法: node scripts/discover_tty.js [startId] [endId] [step]
 * 默认: 200000 300000 5
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const HOST = 'www.ttyingqiu.com';
const OUT = path.join(__dirname, '..', 'server', 'ttyingqiu_experts.json');

const CONCURRENT = 15;
const AGENT = new https.Agent({ keepAlive: true, maxSockets: CONCURRENT, rejectUnauthorized: false });
let COOKIES = '';

async function initSession() {
  return new Promise((resolve) => {
    https
      .get(
        {
          hostname: HOST,
          path: '/',
          agent: AGENT,
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 10000,
        },
        (res) => {
          const sc = res.headers['set-cookie'];
          if (sc) COOKIES = (Array.isArray(sc) ? sc : [sc]).map((c) => c.split(';')[0]).join('; ');
          res.resume();
          resolve();
        },
      )
      .on('error', () => resolve());
  });
}

function probe(id) {
  return new Promise((resolve) => {
    const body = `exportId=${id}&searchIndex=100&raceTypeId=1`;
    const req = https.request(
      {
        method: 'POST',
        hostname: HOST,
        path: '/expert/home/interpretation2/1',
        agent: AGENT,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0',
          Cookie: COOKIES,
          Referer: 'https://' + HOST + '/',
        },
        timeout: 8000,
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            const list = j?.page?.dataList;
            if (list && list.length > 0) {
              const name = list[0]?.jcobMember?.nickName || '';
              const pages = j.page.totalPages || 0;
              resolve({ id: String(id), name, totalPages: pages });
            } else {
              resolve(null);
            }
          } catch (e) {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Initializing session...');
  await initSession();
  console.log('Cookie: ' + (COOKIES ? 'OK' : 'FAIL') + '\n');

  const start = parseInt(process.argv[2]) || 200000;
  const end = parseInt(process.argv[3]) || 300000;
  const step = parseInt(process.argv[4]) || 5;
  const target = 300;

  const ids = [];
  for (let i = start; i <= end; i += step) ids.push(i);

  const experts = [];
  let probed = 0;
  console.log(
    `Range: ${start}-${end}, Step: ${step}, IDs: ${ids.length}, Concurrent: ${CONCURRENT}, Target: ${target}\n`,
  );

  for (let i = 0; i < ids.length; i += CONCURRENT) {
    const batch = ids.slice(i, i + CONCURRENT);
    const results = await Promise.allSettled(batch.map(probe));
    probed += results.length;

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        experts.push(r.value);
        console.log(`  #${experts.length} ID ${r.value.id}: ${r.value.name} (${r.value.totalPages}p)`);
      }
    }

    // 每 2000 次保存一次
    if (probed % 2000 === 0 || experts.length >= target) {
      fs.writeFileSync(OUT, JSON.stringify({ total: experts.length, experts }, null, 2));
    }

    process.stdout.write(`\r  ${probed}/${ids.length} (${experts.length} experts)`);

    if (experts.length >= target) {
      console.log(`\n✅ Reached ${target} experts!`);
      break;
    }
  }

  // 最终保存
  fs.writeFileSync(OUT, JSON.stringify({ total: experts.length, experts }, null, 2));
  console.log(`\n\nDone: ${experts.length} experts saved to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

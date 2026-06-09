const https = require('https');
const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

function post(path, body, referer) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: 'dstd.500.com',
        path,
        agent,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0',
          Referer: referer || 'https://dstd.500.com/',
          Origin: 'https://dstd.500.com',
        },
        timeout: 15000,
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve(d));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function test() {
  const testExperts = [
    { eid: '7428', nickname: '数据梁' },
    { eid: '7425', nickname: '冷析先生' },
    { eid: '6632', nickname: '大毛看彩' }, // 人气榜#1
    { eid: '5548', nickname: '七哥侃彩' }, // 人气榜#3
    { eid: '7258', nickname: '林勇' }, // 人气榜#22
  ];

  for (const exp of testExperts) {
    await sleep(1000);
    console.log('测试: ' + exp.nickname + ' (eid=' + exp.eid + ')');
    const body =
      'commresource=' +
      encodeURIComponent(JSON.stringify({ channel: 'mesport', platform: 'pc' })) +
      '&eid=' +
      exp.eid +
      '&pn=1&rn=10&articletype=';
    const text = await post(
      '/transpondsanyol/api/meweb/expert/expert_history_articles',
      body,
      'https://dstd.500.com/zhuanjia/' + exp.eid,
    );
    try {
      const j = JSON.parse(text);
      const arts = j.status === '100' && j.data && j.data.articles ? j.data.articles : [];
      if (arts.length === 0) {
        console.log('  → 无数据 ' + text.substring(0, 100));
        continue;
      }
      const times = arts.map((a) => a.publishtime);
      const results = [...new Set(arts.map((a) => a.result))];
      let proCount = 0;
      if (arts[0].resultcontent) {
        try {
          const rc = JSON.parse(arts[0].resultcontent);
          proCount = rc.proinfo ? rc.proinfo.length : 0;
        } catch (e) {}
      }
      console.log(
        '  → ' +
          arts.length +
          '条, ' +
          times[times.length - 1] +
          ' ~ ' +
          times[0] +
          ', result:' +
          JSON.stringify(results) +
          ', pro:' +
          proCount +
          '场',
      );
    } catch (e) {
      console.log('  → 解析失败: ' + text.substring(0, 200));
    }
  }
}

test().catch((e) => console.error('ERR:', e.message));

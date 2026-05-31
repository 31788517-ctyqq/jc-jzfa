const https = require('https'),
  fs = require('fs'),
  path = require('path');
function get(url, params, headers) {
  return new Promise(function (r, e) {
    const q = params
      ? '?' +
        Object.keys(params)
          .map(function (k) {
            return k + '=' + encodeURIComponent(params[k]);
          })
          .join('&')
      : '';
    const u = require('url').parse(url + q);
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + (u.search || ''),
        headers: Object.assign({ Accept: '*/*', 'User-Agent': 'Mozilla/5.0' }, headers || {}),
        rejectUnauthorized: false,
      },
      function (res) {
        const c = [];
        res.on('data', function (d) {
          c.push(d);
        });
        res.on('end', function () {
          let b = Buffer.concat(c),
            t = b.toString();
          try {
            JSON.parse(t);
          } catch (ee) {
            try {
              t = require('iconv-lite').decode(b, 'gbk');
            } catch (x) {}
          }
          try {
            r(JSON.parse(t));
          } catch (ee) {
            e(new Error(t.slice(0, 200)));
          }
        });
      },
    );
    req.on('error', e);
    req.setTimeout(10000, function () {
      req.abort();
      e(new Error('timeout'));
    });
    req.end();
  });
}
const env = {};
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
    .split('\n')
    .forEach(function (l) {
      const p = l.trim().split('=');
      if (p.length === 2) env[p[0]] = p[1];
    });
} catch (x) {}
async function main() {
  const r = await get('https://midou310.com/mdsj/gduser/login.do', {
    mobile: env.MIDOU_MOBILE,
    password: env.MIDOU_PASSWORD,
  });
  const mr = await get(
    'https://midou310.com/mdsj/score/footballDataList.do',
    { time: Date.now() },
    { Cookie: 'token=' + r.data.token },
  );
  if (mr.data && mr.data.length) {
    const m = mr.data[0];
    console.log('First match keys:', Object.keys(m).sort().join(', '));
    mr.data.forEach(function (m) {
      const info = [
        m.matchId,
        m.homeName,
        'vs',
        m.visitName,
        'st:',
        m.matchStatus,
        m.score || '-',
        'half:' + (m.halfScore || '-'),
        'dur:' + (m.duration || '-'),
        'yellow:' + (m.yellow || '-'),
        'red:' + (m.red || '-'),
      ];
      console.log(info.join(' '));
    });
  }
}
main().catch(function (e) {
  console.error(e.message);
  process.exit(1);
});

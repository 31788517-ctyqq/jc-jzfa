/** Comprehensive site check: all pages, APIs, and data */
const { Client } = require('ssh2');
const http = require('http');

const HOST = '119.23.51.159';
const USER = 'root';
const PASS = 'znm19811225@';
const REMOTE = '/var/www/zj.100qiu.com';

const conn = new Client();

function run(cmd) {
  return new Promise((resolve) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return resolve('ERROR: ' + err.message);
      let out = '';
      stream.on('data', d => { out += d.toString('utf8'); });
      stream.stderr.on('data', d => { out += d.toString('utf8'); });
      stream.on('close', () => resolve(out));
    });
  });
}

function apiTest(label, action, params) {
  var body = JSON.stringify(Object.assign({ action: action }, params || {}));
  var escaped = body.replace(/"/g, '\\"');
  return run('curl -s -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -d "' + escaped + '"');
}

async function checkAll() {
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 15000 });
  });

  console.log('═══════════════════════════════════════');
  console.log('  zj.100qiu.com 全站检查');
  console.log('═══════════════════════════════════════\n');

  // ─── 1. Static Pages ───
  console.log('=== [1] 静态页面 ===');
  var r;

  r = await run('curl -s -o /dev/null -w "%{http_code} %{size_download}" http://127.0.0.1:3000/');
  console.log('  GET /           : ' + r.trim());

  r = await run('curl -s -o /dev/null -w "%{http_code} %{size_download}" http://127.0.0.1:3000/health');
  console.log('  GET /health     : ' + r.trim());

  r = await run('ls -la ' + REMOTE + '/preview/index.html ' + REMOTE + '/preview/app.js 2>/dev/null | awk "{print $5, $NF}"');
  console.log('  Static files:   : ' + r.replace(/\n/g, ', '));

  // ─── 2. API: plan-list (multiple dates) ───
  console.log('\n=== [2] 今日方案 plan-list ===');
  r = await apiTest('plan-list(5/25)', 'plan-list', { date: '2026-05-25' });
  var m = r.match(/"plans":\[/); var cnt = (r.match(/"planId"/g) || []).length;
  console.log('  5/25: ' + cnt + ' plans, hasOdds=' + (r.indexOf('"spf"') > -1));

  console.log('\n=== [3] 历史方案 plan-list ===');
  var testDates = ['2026-05-24', '2026-05-20', '2026-05-17', '2026-05-10', '2026-05-01', '2026-04-25', '2026-04-20'];
  for (var d of testDates) {
    r = await apiTest('plan-list(' + d + ')', 'plan-list', { date: d });
    cnt = (r.match(/"planId"/g) || []).length;
    var hasOdds = r.indexOf('"spf"') > -1;
    console.log('  ' + d + ': ' + cnt + ' plans, hasOdds=' + hasOdds + (cnt === 0 ? ' ← 无方案!' : ''));
  }

  // ─── 4. 方案收入 ───
  console.log('\n=== [4] 方案收入 income-stats ===');
  for (var days of [7, 30, 60]) {
    r = await apiTest('income-stats(' + days + 'd)', 'income-stats', { days: days });
    var hasData = r.indexOf('"dailyResults"') > -1 || r.indexOf('"items"') > -1;
    var len = r.length;
    console.log('  ' + days + 'd: len=' + len + ', hasData=' + hasData);
  }

  // ─── 5. 比赛列表 ───
  console.log('\n=== [5] 比赛列表 match-list ===');
  r = await apiTest('match-list(5/25)', 'match-list', { date: '2026-05-25' });
  cnt = (r.match(/"matchId"/g) || []).length;
  console.log('  5/25: ' + cnt + ' matches');
  r = await apiTest('match-list(5/24)', 'match-list', { date: '2026-05-24' });
  cnt = (r.match(/"matchId"/g) || []).length;
  console.log('  5/24: ' + cnt + ' matches');
  r = await apiTest('match-list(5/20)', 'match-list', { date: '2026-05-20' });
  cnt = (r.match(/"matchId"/g) || []).length;
  console.log('  5/20: ' + cnt + ' matches');

  // ─── 6. 命中率统计 ───
  console.log('\n=== [6] 命中率统计 hit-rate-stats ===');
  r = await apiTest('hit-rate(30d)', 'hit-rate-stats', { days: 30 });
  var totalHits = (r.match(/"hitCount"/g) || []).length;
  console.log('  30d: ' + r.substring(0, 200));

  // ─── 7. 周日期 ───
  console.log('\n=== [7] 周日期 week-dates ===');
  r = await run("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"week-dates\"}'");
  console.log('  ' + r.substring(0, 300));

  // ─── 8. 推荐趋势 ───
  console.log('\n=== [8] 推荐趋势 recommend-trend ===');
  r = await run("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"match-list\",\"date\":\"2026-05-25\"}' | python -c \"import sys,json;d=json.load(sys.stdin);ms=d.get('data',{}).get('matches',[]);print(ms[0]['matchId'] if ms else 'none')\" 2>&1");
  var firstMatchId = r.trim();
  if (firstMatchId && firstMatchId !== 'none') {
    r = await apiTest('trend(' + firstMatchId + ')', 'recommend-trend', { matchId: firstMatchId });
    console.log('  trend(' + firstMatchId + '): ' + r.substring(0, 200));
  } else {
    console.log('  No matchId found for trend test');
  }

  // ─── 9. 数据完整性 ───
  console.log('\n=== [9] 数据文件完整性 ===');
  r = await run('cd ' + REMOTE + '/server && node -e "var d=JSON.parse(require(\"fs\").readFileSync(\"data.json\",\"utf8\"));var dates={};Object.keys(d.m||{}).forEach(function(k){var dt=(d.m[k].date||\"\").slice(0,10);if(dt)dates[dt]=(dates[dt]||0)+1});var k=Object.keys(dates).sort();console.log(\"data.json: \"+Object.keys(d.m||{}).length+\" matches, \"+Object.keys(d.r||{}).length+\" recGroups, dates:\",k[0],\"~\",k[k.length-1])"');
  console.log('  ' + r.trim());

  r = await run('ls ' + REMOTE + '/server/odds_history/*.json 2>/dev/null | wc -l && ls ' + REMOTE + '/server/odds_history/*.json 2>/dev/null | head -3 && echo "..." && ls ' + REMOTE + '/server/odds_history/*.json 2>/dev/null | tail -3');
  var lines = r.trim().split('\n');
  console.log('  odds_history: ' + lines[0] + ' files, first/last:');
  console.log('    ' + lines[1]);
  console.log('    ' + lines[lines.length - 1]);

  r = await run('wc -c ' + REMOTE + '/server/trends.json ' + REMOTE + '/server/live_scores.json 2>/dev/null');
  console.log('  trends.json: ' + r.trim().split('\n')[0] + ' bytes');
  console.log('  live_scores.json: ' + (r.trim().split('\n')[1] || ''));

  // ─── 10. PM2 status ───
  console.log('\n=== [10] 服务状态 ===');
  r = await run('pm2 status 2>&1');
  console.log(r);

  // ─── 11. Nginx config check ───
  console.log('=== [11] Nginx 配置 ===');
  r = await run('nginx -t 2>&1');
  console.log('  ' + r.trim());
  r = await run('cat /etc/nginx/conf.d/zj.100qiu.com.conf 2>/dev/null | head -40 || cat /etc/nginx/conf.d/zj.conf 2>/dev/null | head -40 || echo "no nginx conf found"');
  console.log(r.substring(0, 800));

  console.log('\n═══════════════════════════════════════');
  console.log('  检查完成');
  console.log('═══════════════════════════════════════');

  conn.end();
}

checkAll().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

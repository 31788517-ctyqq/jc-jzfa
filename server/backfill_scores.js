/**
 * 回填历史比赛比分、红黄牌数据
 * 用法: node server/backfill_scores.js
 */
var https = require('https'), fs = require('fs'), path = require('path');

var DATA_FILE = path.join(__dirname, 'data.json');
var CONFIG = {};
try{fs.readFileSync(path.join(__dirname,'.env'),'utf8').split('\n').forEach(function(l){var p=l.trim().split('=');if(p.length===2)CONFIG[p[0]]=p[1]})}catch(e){}

function get(url,p,h){return new Promise(function(r,e){var q=p?'?'+Object.keys(p).map(function(k){return k+'='+encodeURIComponent(p[k])}).join('&'):'';var u=require('url').parse(url+q);var req=https.request({hostname:u.hostname,port:443,path:u.pathname+(u.search||''),headers:Object.assign({Accept:'*/*','User-Agent':'Mozilla/5.0'},h||{}),rejectUnauthorized:false},function(res){var c=[];res.on('data',function(d){c.push(d)});res.on('end',function(){var t=Buffer.concat(c).toString();try{r(JSON.parse(t))}catch(ee){r({code:0,msg:t.slice(0,200)})}})});req.on('error',e);req.setTimeout(20000,function(){req.abort()});req.end()})}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}

async function main(){
  console.log('=== 回填历史比赛比分数据 ===');

  // 1. Login
  var loginRes = await get('https://midou310.com/mdsj/gduser/login.do', {
    mobile: CONFIG.MIDOU_MOBILE, password: CONFIG.MIDOU_PASSWORD
  });
  if(loginRes.code !== 1){ console.log('Login FAIL'); return; }
  var token = loginRes.data.token;
  console.log('Login OK');

  // 2. Load data.json
  var data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  console.log('Loaded matches:', Object.keys(data.m).length, 'recs:', Object.keys(data.r).length);

  // 3. Find matches needing backfill (5/22 with missing score)
  var needFill = [];
  Object.keys(data.m).forEach(function(k){
    var m = data.m[k];
    if(!m) return;
    if(m.score && m.score.length > 0) return; // already has score
    // Check if any date that might need filling
    var dd = (m.date || '').slice(0, 10);
    if (!dd) return;
    // Only backfill matches that have recommendations with results (finished matches)
    var rawRecs = data.r['m_' + m.matchId] || data.r[m.matchId] || [];
    if (rawRecs.length === 0) return;
    var hasResult = rawRecs.some(function(r){ var rs = r.rs !== undefined ? r.rs : r.result; return rs === 1 || rs === 0; });
    if (!hasResult) return;
    needFill.push({ key: k, match: m, date: dd });
  });

  console.log('Need backfill:', needFill.length, 'matches');
  if (needFill.length === 0) { console.log('Nothing to do'); return; }

  // 4. Batch fetch dates that need backfill
  var dates = {};
  needFill.forEach(function(x){ dates[x.date] = true });
  console.log('Dates:', Object.keys(dates));

  // 5. For each date, fetch the match list from API
  var updated = 0;
  for (var dateKey in dates) {
    console.log('Fetching date:', dateKey);
    var timestamp = new Date(dateKey + 'T00:00:00+08:00').getTime();
    try {
      var matchRes = await get('https://midou310.com/mdsj/score/footballDataList.do', {
        time: timestamp,
        order: 'status desc, start_datetime asc, data_id asc'
      }, { Cookie: 'token=' + token });

      if (matchRes.code === 1 && matchRes.data) {
        // Build lookup by matchId
        var apiMap = {};
        matchRes.data.forEach(function(m2){
          var id = String(m2.matchId || m2.dataId || '');
          apiMap[id] = m2;
        });

        // Update our matches
        needFill.forEach(function(item){
          if (item.date !== dateKey) return;
          var apiMatch = apiMap[item.match.matchId];
          if (!apiMatch) { console.log('  Not found in API:', item.match.num); return; }

          var old = data.m[item.key];
          var score = apiMatch.score || old.score || '';
          var half = apiMatch.halfScore || old.halfScore || '';
          if (score || half) {
            data.m[item.key] = {
              matchId: old.matchId,
              num: old.num || '',
              homeName: old.homeName || '',
              visitName: old.visitName || '',
              leagueName: old.leagueName || '',
              startTime: old.startTime || '',
              matchStatus: apiMatch.matchStatus || old.matchStatus || 2,
              score: score,
              halfScore: half,
              duration: apiMatch.duration || old.duration || '完',
              yellow: apiMatch.yellow || old.yellow || '',
              red: apiMatch.red || old.red || '',
              recommNum: apiMatch.recommNum || old.recommNum || 0,
              date: old.date
            };
            updated++;
            console.log('  Updated', old.num, old.homeName, 'vs', old.visitName, 'score:', score, 'yellow:', apiMatch.yellow || '-');
          }
        });
      }
    } catch(e) {
      console.log('  API error for', dateKey, ':', e.message);
    }
    await sleep(500);
  }

  // 6. Save
  if (updated > 0) {
    var tmpFile = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data));
    fs.renameSync(tmpFile, DATA_FILE);
    console.log('Saved, updated', updated, 'matches');

    var exec = require('child_process').exec;
    exec('pm2 restart jc-zjfa', { timeout: 5000 }, function() {});
    console.log('PM2 restart triggered');
  } else {
    console.log('No matches updated');
  }
}

main().catch(function(e){ console.error('FATAL:', e.message); process.exit(1); });

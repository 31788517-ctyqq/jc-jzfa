const { Client } = require('ssh2');
const https = require('https');

(async () => {
  // 1. 本地拉取 26057 数据
  const d57 = await new Promise((resolve, reject) => {
    let d = ''; https.get('https://m.100qiu.com/api/dcListBasic?dateTime=26057', { rejectUnauthorized: false }, res => {
      res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d).data || []); } catch(e) { reject(e); } });
    }).on('error', reject).setTimeout(15000);
  });
  console.log('26057:', d57.length, '场');
  
  // 2. 等待避免限流，然后拉取 26058
  await new Promise(r => setTimeout(r, 3000));
  const d58 = await new Promise((resolve, reject) => {
    let d = ''; https.get('https://m.100qiu.com/api/dcListBasic?dateTime=26058', { rejectUnauthorized: false }, res => {
      res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d).data || []); } catch(e) { reject(e); } });
    }).on('error', reject).setTimeout(15000);
  });
  console.log('26058:', d58.length, '场');

  // 3. 连接服务器
  const conn = new Client();
  await new Promise((r, j) => {
    conn.on('ready', r); conn.on('error', j);
    conn.connect({ host: '119.23.51.159', port: 22, username: 'root', password: 'znm19811225@', readyTimeout: 10000 });
  });

  // 4. 上传合并后的 stats_bank
  const sftp = await new Promise((r, j) => conn.sftp((e, s) => e ? j(e) : r(s)));
  const bankData = JSON.stringify({
    '_last_batch': '26058',
    '_raw_26057': d57,
    '_raw_26058': d58
  }, null, 2);
  await new Promise((r, j) => {
    sftp.writeFile('/tmp/gs_bank_all.json', bankData, 'utf8', (e) => e ? j(e) : r());
  });
  sftp.end();
  console.log('Bank uploaded');

  // 5. 服务器：合并 bank + 用双批次重建缓存
  await new Promise((resolve) => {
    conn.exec(`cd /var/www/zj.100qiu.com && node -e "
var fs=require('fs');
var bank=JSON.parse(fs.readFileSync('/tmp/gs_bank_all.json','utf8'));
fs.writeFileSync('server/stats_bank.json',JSON.stringify(bank,null,2),'utf8');
console.log('stats_bank updated');

// 双批次匹配
var fetch=require('/var/www/zj.100qiu.com/server/gongshoudao/fetch');
var gs=require('/var/www/zj.100qiu.com/server/gongshoudao/index');
var parser=require('/var/www/zj.100qiu.com/server/gongshoudao/parser');

var dataJson=JSON.parse(fs.readFileSync('server/data.json','utf8'));
var mMap=dataJson.m||{};

// 两个批次的 data 合并
var allApiData=(bank._raw_26057||[]).concat(bank._raw_26058||[]);
console.log('total api:',allApiData.length);

// 按队名去重匹配
function fuzzyMatch(n1,n2){
  if(!n1||!n2)return false;
  n1=n1.replace(/\\(.*\\)/g,'').trim();
  n2=n2.replace(/\\(.*\\)/g,'').trim();
  if(n1===n2)return true;
  if(n1.length>=2&&n2.length>=2&&(n1.includes(n2)||n2.includes(n1)))return true;
  return false;
}

var results={};
var mList=Object.keys(mMap);
for(var i=0;i<mList.length;i++){
  var mid=mList[i];
  var m=mMap[mid];
  if(!m||!m.homeName)continue;
  var hn=m.homeName.replace(/\\(.*\\)/g,'').trim();
  var vn=m.visitName.replace(/\\(.*\\)/g,'').trim();
  for(var j=0;j<allApiData.length;j++){
    var item=allApiData[j];
    if(results[mid])break;
    if(fuzzyMatch(hn,item.homeTeam)&&fuzzyMatch(vn,item.guestTeam)){
      try{
        results[mid]=gs.computeSingleMatch(item,m);
      }catch(e){}
      break;
    }
  }
}

var validN=Object.keys(results).filter(function(k){return results[k]}).length;
console.log('matched/calc:',validN);

// 写入缓存
var cache=gs.readCache();
cache._global=results;
gs.writeCache(cache);

// stats
var latestDate=Object.keys(mMap).map(function(k){return (mMap[k].date||'').slice(0,10)}).sort().pop();
console.log('latest date:',latestDate);
var todayCount=0;
Object.keys(results).forEach(function(k){
  if((mMap[k].date||'').slice(0,10)===latestDate){
    todayCount++;
    console.log('  today:',mMap[k].homeName,'vs',mMap[k].visitName,'|',results[k]?results[k].ladderLabel:'NO_DATA');
  }
});
console.log('today hasGS:',todayCount);
process.exit(0);
" 2>&1`, { timeout: 120000 }, (err, stream) => {
      if (err) { console.log('EXEC ERR:', err); return resolve(); }
      let o = '';
      stream.on('data', d => { o += d; process.stdout.write(d.toString()); });
      stream.stderr.on('data', d => { o += d; process.stderr.write(d.toString()); });
      stream.on('close', () => resolve());
    });
  });

  console.log('\n[Done]');
  conn.end();
})().catch(e => { console.error(e.message); process.exit(1); });

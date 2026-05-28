/**
 * 全量推荐数据重新获取脚本
 * 从2026-03-19开始，逐场重新获取推荐方向及专家数
 */
var env={};
try{require('fs').readFileSync(require('path').join(__dirname,'.env'),'utf8').split('\n').forEach(function(l){var p=l.trim().split('=');if(p.length===2)env[p[0]]=p[1]})}catch(e){}
var https=require('https'),fs=require('fs'),path=require('path');
var logger = require('./logger').child('refetch_rec');

function get(url,p,h){return new Promise(function(r,e){var q=p?'?'+Object.keys(p).map(function(k){return k+'='+encodeURIComponent(p[k])}).join('&'):'';var u=require('url').parse(url+q);var req=https.request({hostname:u.hostname,port:443,path:u.pathname+(u.search||''),headers:Object.assign({Accept:'*/*','User-Agent':'Mozilla/5.0'},h||{}),rejectUnauthorized:false},function(res){var c=[];res.on('data',function(d){c.push(d)});res.on('end',function(){var t=Buffer.concat(c).toString();try{r(JSON.parse(t))}catch(ee){r({code:0,msg:t.slice(0,200)})}})});req.on('error',e);req.setTimeout(20000,function(){req.abort()});req.end()})}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}

function fmtDate(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function fmtTime(){return new Date().toISOString()}

function log(msg){ logger.info(msg); }

async function main(){
  var dataFile=path.join(__dirname,'data.json');
  var d=JSON.parse(fs.readFileSync(dataFile,'utf8'));
  var allMatches=[];
  Object.keys(d.m).forEach(function(k){
    var m=d.m[k];
    if(!m||!m.matchId)return;
    allMatches.push({key:k,matchId:m.matchId,num:m.num,homeName:m.homeName,visitName:m.visitName,date:m.date,recommNum:m.recommNum||0});
  });

  // 按日期排序，只处理 03-19 之后的
  allMatches.sort(function(a,b){return a.date>b.date?1:a.date<b.date?-1:0});
  var startDate='2026-03-18';
  allMatches=allMatches.filter(function(m){return m.date>startDate});
  log('Matches since 03-19: '+allMatches.length);

  // 登录
  log('Logging in...');
  var login=await get('https://midou310.com/mdsj/gduser/login.do',{mobile:env.MIDOU_MOBILE,password:env.MIDOU_PASSWORD});
  if(login.code!==1){log('Login FAIL: '+JSON.stringify(login));process.exit(1)}
  var token=login.data.token;
  log('Login OK');

  var updated=0,skipped=0,failures=0;
  var startTime=Date.now();

  for(var i=0;i<allMatches.length;i++){
    var m=allMatches[i];
    var pct=Math.round(i/allMatches.length*100);
    if(i%50===0)log('Progress: '+i+'/'+allMatches.length+' ('+pct+'%) updated='+updated+' skipped='+skipped+' fails='+failures);

    try{
      var rr=await get('https://midou310.com/mdsj/score/getExpertRecommData.do',{dataId:m.matchId,type:0},{Cookie:'token='+token});
      if(rr.code!==1){log('API fail '+m.matchId+' code='+rr.code);failures++;await sleep(300);continue}
      if(!rr.data||!Array.isArray(rr.data)){skipped++;await sleep(150);continue}

      var recs=rr.data.filter(function(x){return x&&x.type&&x.num>0}).map(function(x){return{type:x.type,num:x.num,result:x.result!==undefined?x.result:null}});

      var rk='m_'+m.matchId;
      var old=d.r[rk]||[];
      var oldCount=Array.isArray(old)?old.length:0;
      if(recs.length>0||oldCount===0){
        d.r[rk]=recs;
        if(recs.length>0)updated++;
        else if(oldCount>0)updated++; // clear stale
        else skipped++;
      }else{
        skipped++;
      }

    }catch(e){
      log('Error '+m.matchId+': '+e.message);
      failures++;
      if(e.message.indexOf('token')>=0||e.message.indexOf('login')>=0){
        try{
          login=await get('https://midou310.com/mdsj/gduser/login.do',{mobile:env.MIDOU_MOBILE,password:env.MIDOU_PASSWORD});
          token=login.data.token;
          log('Re-login OK');
        }catch(e2){log('Re-login fail');}
      }
    }

    // 速率控制: 100-200ms 间隔
    await sleep(100+Math.random()*100);

    // 每500个写入一次，每200个重新登录
    if(i>0&&i%200===0){
      try{
        fs.writeFileSync(dataFile+'.tmp',JSON.stringify(d));
        fs.renameSync(dataFile+'.tmp',dataFile);
        log('Checkpoint saved at '+i);
      }catch(e){log('Checkpoint save FAIL: '+e.message)}
      // 重新登录保持session
      try{
        login=await get('https://midou310.com/mdsj/gduser/login.do',{mobile:env.MIDOU_MOBILE,password:env.MIDOU_PASSWORD});
        token=login.data.token;
        log('Refresh login OK');
      }catch(e2){log('Refresh login fail, continue with existing token')}
    }
  }

  // 最终保存
  fs.writeFileSync(dataFile+'.tmp',JSON.stringify(d));
  fs.renameSync(dataFile+'.tmp',dataFile);

  var elapsed=Math.round((Date.now()-startTime)/1000);
  log('');
  log('=== DONE ===');
  log('Total matches: '+allMatches.length);
  log('Updated: '+updated);
  log('Skipped: '+skipped);
  log('Failures: '+failures);
  log('Time: '+elapsed+'s');
  log('Output: '+dataFile+' ('+(fs.statSync(dataFile).size/1024/1024).toFixed(1)+'MB)');
}

main().catch(function(e){log('FATAL: '+e.message+' '+e.stack);process.exit(1)});

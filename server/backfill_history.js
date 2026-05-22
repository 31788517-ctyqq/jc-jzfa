/**
 * 历史数据补爬：2026-01-01 ~ 2026-03-18
 * 输出：合并到现有 data.json
 */
var https=require('https'),fs=require('fs'),path=require('path');
var env={};
try{fs.readFileSync(path.join(__dirname,'.env'),'utf8').split('\n').forEach(function(l){var p=l.trim().split('=');if(p.length===2)env[p[0]]=p[1]})}catch(e){}

function get(url,p,h){return new Promise(function(r,e){var q=p?'?'+Object.keys(p).map(function(k){return k+'='+encodeURIComponent(p[k])}).join('&'):'';var u=require('url').parse(url+q);var req=https.request({hostname:u.hostname,port:443,path:u.pathname+(u.search||''),headers:Object.assign({Accept:'*/*','User-Agent':'Mozilla/5.0'},h||{}),rejectUnauthorized:false},function(res){var c=[];res.on('data',function(d){c.push(d)});res.on('end',function(){var t=Buffer.concat(c).toString();try{r(JSON.parse(t))}catch(ee){r({code:0,msg:t.slice(0,200)})}})});req.on('error',e);req.setTimeout(20000,function(){req.abort();e(new Error('timeout'))});req.end()})}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}

var LOG=path.join(__dirname,'..','logs','backfill.log');
function log(msg){var line='['+new Date().toISOString()+'] '+msg;console.log(line);try{fs.appendFileSync(LOG,line+'\n')}catch(e){}}

var weekMap={一:1,二:2,三:3,四:4,五:5,六:6,日:0};
function fmtDate(dd){return dd.getFullYear()+'-'+String(dd.getMonth()+1).padStart(2,'0')+'-'+String(dd.getDate()).padStart(2,'0')}
function getDayOfWeek(ds){return new Date(ds.slice(0,10).replace(/-/g,'/')+' 00:00:00').getDay()}

async function main(){
  log('=== 历史数据补爬 2026-01-01 ~ 2026-03-18 ===');
  var login=await get('https://midou310.com/mdsj/gduser/login.do',{mobile:env.MIDOU_MOBILE,password:env.MIDOU_PASSWORD});
  if(login.code!==1){log('Login FAIL');process.exit(1)}
  var token=login.data.token;
  log('Login OK');

  var dataFile=path.join(__dirname,'data.json');
  var data={};
  try{data=JSON.parse(fs.readFileSync(dataFile,'utf8'))}catch(e){data={m:{},r:{}}}
  if(!data.m)data.m={};
  if(!data.r)data.r={};

  var start=new Date('2026-01-01T00:00:00+08:00');
  var end=new Date('2026-03-18T23:59:59+08:00');
  var totalD=0,totalM=0,totalR=0,skipD=0;
  var checkpoint=0;

  for(var d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
    var dateStr=fmtDate(d);
    totalD++;
    log('['+dateStr+'] fetching...');

    try{
      var mr=await get('https://midou310.com/mdsj/score/footballDataList.do',{time:d.getTime(),order:'status desc, start_datetime asc, data_id asc'},{Cookie:'token='+token});
      if(mr.code!==1||!mr.data||mr.data.length===0){skipD++;log('  No data');continue}
      var matches=mr.data||[];
      log('  '+matches.length+' matches');

      for(var i=0;i<matches.length;i++){
        var m=matches[i];
        var mid=String(m.matchId||m.dataId||'');
        if(!mid)continue;

        // 日期
        var md='';
        if(m.bDate&&typeof m.bDate==='string'&&m.bDate.length>=10)md=m.bDate.slice(0,10);
        if(!md||md.length!==10)md=dateStr;

        // 存储比赛
        var mkey='m_'+mid;
        if(!data.m[mkey]){
          data.m[mkey]={
            matchId:mid,num:m.num||'',homeName:m.homeName||'',
            visitName:m.visitName||'',leagueName:m.leagueName||'',
            startTime:m.startTime||'',matchStatus:m.matchStatus||0,
            score:m.score||'',halfScore:m.halfScore||'',
            duration:m.duration||'',yellow:m.yellow||'',red:m.red||'',
            recommNum:m.recommNum||0,date:md
          };
          totalM++;
        }

        // 推荐（有结果的才抓）
        var rkey='m_'+mid;
        if(!data.r[rkey]&&m.matchStatus>=1){
          await sleep(100);
          try{
            var rr=await get('https://midou310.com/mdsj/score/getExpertRecommData.do',{dataId:mid,type:0},{Cookie:'token='+token});
            if(rr.code===1&&rr.data&&rr.data.length){
              var recs=rr.data.filter(function(x){return x&&x.type&&x.num>0}).map(function(x){return{type:x.type,num:x.num,result:x.result!==undefined?x.result:null}});
              if(recs.length){data.r[rkey]=recs;totalR++}
            }
          }catch(e){/* skip */}
        }
      }
    }catch(e){log('  ERROR: '+e.message)}
    await sleep(200);

    // 每10天保存一次
    checkpoint++;
    if(checkpoint%10===0){
      fs.writeFileSync(dataFile+'.tmp',JSON.stringify(data));
      fs.renameSync(dataFile+'.tmp',dataFile);
      log('Checkpoint saved: M'+Object.keys(data.m).length+' R'+Object.keys(data.r).length);
    }
  }

  // 最终保存
  fs.writeFileSync(dataFile+'.tmp',JSON.stringify(data));
  fs.renameSync(dataFile+'.tmp',dataFile);
  log('');
  log('=== DONE ===');
  log('Days: '+totalD+' (with data:'+(totalD-skipD)+' skipped:'+skipD+')');
  log('New matches: '+totalM+' New recs: '+totalR);
  log('Total: M'+Object.keys(data.m).length+' R'+Object.keys(data.r).length);
}

main().catch(function(e){log('FATAL: '+e.message);process.exit(1)});

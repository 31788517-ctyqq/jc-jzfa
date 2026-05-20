/**
 * 竞彩期号定时同步脚本
 * - 每20分钟：抓取当期所有比赛的推荐方向+专家数
 * - 当期最后一场结束后：一次性抓取完整比赛数据
 * 写入 data.json，simple.js 自动重载
 */
var https=require('https'),fs=require('fs'),path=require('path');

var CONFIG={};
try{fs.readFileSync(path.join(__dirname,'.env'),'utf8').split('\n').forEach(function(l){var p=l.trim().split('=');if(p.length===2)CONFIG[p[0]]=p[1]})}catch(e){}

var DATA_FILE=path.join(__dirname,'data.json');
var LOG_FILE=path.join(__dirname,'..','logs','period_daemon.log');

function log(msg){
  var line='['+new Date().toISOString()+'] '+msg;
  console.log(line);
  try{fs.appendFileSync(LOG_FILE,line+'\n')}catch(e){}
}

function get(url,p,h){return new Promise(function(r,e){var q=p?'?'+Object.keys(p).map(function(k){return k+'='+encodeURIComponent(p[k])}).join('&'):'';var u=require('url').parse(url+q);var req=https.request({hostname:u.hostname,port:443,path:u.pathname+(u.search||''),headers:Object.assign({Accept:'*/*','User-Agent':'Mozilla/5.0'},h||{}),rejectUnauthorized:false},function(res){var c=[];res.on('data',function(d){c.push(d)});res.on('end',function(){var t=Buffer.concat(c).toString();try{r(JSON.parse(t))}catch(ee){r({code:0,msg:t.slice(0,200)})}})});req.on('error',e);req.setTimeout(20000,function(){req.abort()});req.end()})}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}

var WEEK_NAMES={周一:1,周二:2,周三:3,周四:4,周五:5,周六:6,周日:0};
function fmtLocal(dd){return dd.getFullYear()+'-'+String(dd.getMonth()+1).padStart(2,'0')+'-'+String(dd.getDate()).padStart(2,'0')}

// 确定当前竞彩期号：从data.json最新日期推断
function getCurrentPeriod(){
  try{
    var d=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
    var dates={};
    Object.keys(d.m||{}).forEach(function(k){
      var m=d.m[k];
      if(!m||!m.date||!m.num)return;
      if(!dates[m.date])dates[m.date]=m.num.slice(0,2);
    });
    // 找最近日期
    var now=fmtLocal(new Date());
    var keys=Object.keys(dates).sort().reverse();
    // 优先今天，其次最近的未来日期
    var periodDate='',periodWeek='';
    for(var i=0;i<keys.length;i++){
      if(keys[i]<=now||i===0){
        periodDate=keys[i];
        periodWeek=dates[keys[i]];
        break;
      }
    }
    if(!periodDate){periodDate=now;periodWeek='';}
    return {date:periodDate,week:periodWeek};
  }catch(e){return {date:'',week:''}}
}

async function syncPeriod(){
  var period=getCurrentPeriod();
  if(!period.date){log('ERROR: cannot determine period');return}
  log('=== Period sync: '+period.date+' '+period.week+' ===');

  // 登录
  var loginRes=await get('https://midou310.com/mdsj/gduser/login.do',{mobile:CONFIG.MIDOU_MOBILE,password:CONFIG.MIDOU_PASSWORD});
  if(loginRes.code!==1){log('Login FAIL');return}
  var token=loginRes.data.token;

  // 获取今日比赛列表
  var timestamp=new Date(period.date+'T00:00:00+08:00').getTime();
  var matchRes=await get('https://midou310.com/mdsj/score/footballDataList.do',{time:timestamp,order:'status desc, start_datetime asc, data_id asc'},{Cookie:'token='+token});
  if(matchRes.code!==1||!matchRes.data){log('Match list FAIL');return}

  var periodMatches=(matchRes.data||[]).filter(function(m){
    // 按竞彩期号前缀 + 日期双重过滤
    if(!m.num||m.num.indexOf(period.week)!==0)return false;
    var bd=(m.bDate||'').slice(0,10);
    if(bd===period.date)return true;
    // fallback：从startTime推断竞彩售卖日（9点前属于前一天）
    if(!bd&&m.startTime&&m.startTime.length>=11){
      var st=m.startTime.replace(/\//g,'-');
      var y=new Date().getFullYear();
      var dt=new Date(y+'-'+st.slice(0,2)+'-'+st.slice(3,5)+'T'+st.slice(6,11)+':00+08:00');
      if(!isNaN(dt.getTime())){
        if(dt.getHours()<9)dt.setDate(dt.getDate()-1);
        return fmtLocal(dt)===period.date;
      }
    }
    return false;
  });

  if(periodMatches.length===0){
    // 可能是今天还没比赛，尝试用自然日
    periodMatches=matchRes.data||[];
    if(periodMatches.length===0){log('No matches for period');return}
  }

  log('Period matches: '+periodMatches.length);

  // 检查是否全部结束
  var allDone=periodMatches.every(function(m){return m.matchStatus>=2});
  var statusSummary=periodMatches.map(function(m){return (m.num||'')+':'+(m.matchStatus===0?'未':m.matchStatus===1?'赛中':m.matchStatus===2?'完':'取消')}).join(',');
  log('Period matches: '+periodMatches.length+' ['+statusSummary+']'+(allDone?' ALL_DONE':''));

  // 加载 data.json
  var data={};
  try{data=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'))}catch(e){data={m:{},r:{}}}
  if(!data.m)data.m={};
  if(!data.r)data.r={};

  var newRecs=0,updatedMatches=0;

  // 处理每场比赛：赛前/赛中始终全量更新比赛场次+推荐；结束后只补抓推荐最终态
  for(var i=0;i<periodMatches.length;i++){
    var m=periodMatches[i];
    var mid=String(m.matchId||m.dataId||'');
    var mkey='m_'+mid;

    // 确定日期
    var md=(m.bDate&&typeof m.bDate==='string'&&m.bDate.length>=10)?m.bDate.slice(0,10):period.date;

    // 比赛数据：始终全量更新（每20分钟同步场地、比分、状态等）
    var oldMatch=data.m[mkey];
    data.m[mkey]={
      matchId:mid,num:m.num||'',homeName:m.homeName||'',
      visitName:m.visitName||'',leagueName:m.leagueName||'',
      startTime:m.startTime||'',matchStatus:m.matchStatus||0,
      score:m.score||'',halfScore:m.halfScore||'',
      duration:m.duration||'',yellow:m.yellow||'',red:m.red||'',
      recommNum:m.recommNum||0,date:md
    };
    if(!oldMatch||oldMatch.matchStatus!==m.matchStatus||oldMatch.score!==(m.score||''))updatedMatches++;

    // 推荐数据：每20分钟更新
    try{
      var recRes=await get('https://midou310.com/mdsj/score/getExpertRecommData.do',{dataId:mid,type:0},{Cookie:'token='+token});
      if(recRes.code===1&&recRes.data&&recRes.data.length){
        var recs=recRes.data.filter(function(x){return x&&x.type&&x.num>0}).map(function(x){return{type:x.type,num:x.num,result:x.result!==undefined?x.result:null}});
        var rk='m_'+mid;
        var oldLen=(data.r[rk]||[]).length;
        data.r[rk]=recs;
        if(recs.length!==oldLen){newRecs++}
      }
    }catch(e){
      log('  Rec fetch error '+mid+': '+e.message);
    }
    await sleep(150);
  }

  // 保存
  var tmpFile=DATA_FILE+'.tmp';
  fs.writeFileSync(tmpFile,JSON.stringify(data));
  fs.renameSync(tmpFile,DATA_FILE);

  log('Saved. Matches:'+Object.keys(data.m).length+' Updated:'+updatedMatches+' Recs:'+Object.keys(data.r).length+' NewRecs:'+newRecs+(allDone?' [FINAL]':''));

  // 通知 simple.js 重载数据
  var exec=require('child_process').exec;
  exec('pm2 restart jc-zjfa',{timeout:5000},function(err){
    if(err)log('Reload notice: jc-zjfa may need manual restart');
  });

  // 全部结束后再补爬一次推荐（最终态）
  if(allDone){
    log('Final recommend fetch...');
    await sleep(2000);
    for(var j=0;j<periodMatches.length;j++){
      var m2=periodMatches[j];
      var mid2=String(m2.matchId||m2.dataId||'');
      try{
        var recRes2=await get('https://midou310.com/mdsj/score/getExpertRecommData.do',{dataId:mid2,type:0},{Cookie:'token='+token});
        if(recRes2.code===1&&recRes2.data&&recRes2.data.length){
          var recs2=recRes2.data.filter(function(x){return x&&x.type&&x.num>0}).map(function(x){return{type:x.type,num:x.num,result:x.result!==undefined?x.result:null}});
          data.r['m_'+mid2]=recs2;
        }
      }catch(e){}
      await sleep(100);
    }
    fs.writeFileSync(tmpFile,JSON.stringify(data));
    fs.renameSync(tmpFile,DATA_FILE);
    log('Final recommend fetch done');
  }
}

async function main(){
  log('=== Period Daemon started ===');
  log('Config: MIDOU_MOBILE='+(CONFIG.MIDOU_MOBILE||'NOT SET'));

  var INTERVAL_MS=20*60*1000; // 20分钟

  while(true){
    try{
      await syncPeriod();
    }catch(e){
      log('Sync error: '+e.message);
    }
    log('Next sync in '+INTERVAL_MS/60000+'min');
    await sleep(INTERVAL_MS);
  }
}

main().catch(function(e){log('FATAL: '+e.message);process.exit(1)});

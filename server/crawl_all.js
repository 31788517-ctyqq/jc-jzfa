/**
 * 全量历史数据爬虫 - 从2026-03-19开始，爬取所有比赛+推荐
 * 输出: data_all.json
 * 用法: node crawl_all.js
 * 注意：每场比赛间延迟300ms，避免风控
 */
var https=require('https'),fs=require('fs'),path=require('path');

var env={};
try{fs.readFileSync(path.join(__dirname,'.env'),'utf8').split('\n').forEach(function(l){var p=l.trim().split('=');if(p.length===2)env[p[0]]=p[1]})}catch(e){}

var MIDOU='https://midou310.com/mdsj';
var OUT=path.join(__dirname,'data_all.json');
var token=null,lastLogin=0;

function httpGet(url,params,headers){
  return new Promise(function(r,e){
    var q=params?'?'+Object.keys(params).map(function(k){return k+'='+encodeURIComponent(params[k])}).join('&'):'';
    var u=require('url').parse(url+q);
    var req=https.request({hostname:u.hostname,port:443,path:u.pathname+(u.search||''),headers:Object.assign({'Accept':'*/*','User-Agent':'Mozilla/5.0'},headers||{}),rejectUnauthorized:false},function(res){var c=[];res.on('data',function(d){c.push(d)});res.on('end',function(){var b=Buffer.concat(c),t=b.toString();try{JSON.parse(t)}catch(ee){try{t=require('iconv-lite').decode(b,'gbk')}catch(x){}}try{r(JSON.parse(t))}catch(ee){e(new Error(t.slice(0,200)))}})});
    req.on('error',e);req.setTimeout(15000,function(){req.abort();e(new Error('timeout'))});req.end();
  });
}

async function login(){
  if(token&&Date.now()-lastLogin<3000000)return token;
  var res=await httpGet(MIDOU+'/gduser/login.do',{mobile:env.MIDOU_MOBILE,password:env.MIDOU_PASSWORD});
  if(res.code===1){token=res.data.token;lastLogin=Date.now();return token}
  throw new Error('Login fail: '+res.msg);
}

function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}

async function crawlAll(){
  console.log('=== 全量数据爬虫 2026-03-19 ~ 今天 ===');
  if(!env.MIDOU_MOBILE||!env.MIDOU_PASSWORD){console.error('缺少.env配置');process.exit(1)}

  await login();
  console.log('已登录');

  var start=new Date('2026-03-19T00:00:00+08:00');
  var end=new Date();
  var allM={},allR={};
  var totalM=0,totalR=0,days=0;

  for(var d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
    var dateStr=d.toISOString().slice(0,10);
    days++;

    try{
      var timestamp=d.getTime();
      var mr=await httpGet(MIDOU+'/score/footballDataList.do',{time:timestamp,order:'status desc, start_datetime asc, data_id asc'},{Cookie:'token='+token});
      if(mr.code!==1||!mr.data||mr.data.length===0){
        console.log('  '+dateStr+' - 无数据');
        continue;
      }
      var matches=mr.data||[];
      totalM+=matches.length;
      console.log('  '+dateStr+' - '+matches.length+'场');

      // 存比赛
      matches.forEach(function(m){
        var mid=String(m.matchId||m.dataId||'');
        allM['m_'+mid]={matchId:mid,num:m.num||'',homeName:m.homeName||'',visitName:m.visitName||'',leagueName:m.leagueName||'',startTime:m.startTime||'',matchStatus:m.matchStatus||0,score:m.score||'',halfScore:m.halfScore||'',duration:m.duration||'',yellow:m.yellow||'',red:m.red||'',date:dateStr};
      });

      // 逐场获取推荐（已完成/未开始跳过推荐爬取以加速）
      var activeMatches=matches.filter(function(m){return m.matchStatus!==0});
      for(var i=0;i<activeMatches.length;i++){
        var m=activeMatches[i];
        var mid=String(m.matchId||m.dataId||'');
        try{
          var rr=await httpGet(MIDOU+'/score/getExpertRecommData.do',{dataId:m.matchId,type:0},{Cookie:'token='+token});
          if(rr.code===1&&rr.data&&rr.data.length){
            var recs=(rr.data||[]).filter(function(x){return x&&x.type&&x.num>0}).map(function(x){return{type:x.type,num:x.num,result:x.result!==undefined?x.result:null}});
            if(recs.length){allR['m_'+mid]=recs;totalR+=recs.length}
          }
        }catch(e2){/* skip single match fail */}
        await sleep(200);
      }
      await sleep(300);
    }catch(e){
      console.log('  '+dateStr+' - ERROR: '+e.message);
      // 重新登录
      token=null;
      await sleep(2000);
    }
  }

  // 输出
  var output={m:allM,r:allR};
  fs.writeFileSync(OUT,JSON.stringify(output));
  console.log('\n=== 完成 ===');
  console.log('天数:',days,'  比赛:',totalM,'  推荐组:',Object.keys(allR).length,'  推荐条:',totalR);
  console.log('输出:',OUT,'  (',(fs.statSync(OUT).size/1024/1024).toFixed(1),'MB)');
}

crawlAll().catch(function(e){console.error('爬虫失败:',e.message);process.exit(1)});

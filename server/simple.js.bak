var express=require('express'),cors=require('cors'),compression=require('compression'),path=require('path'),fs=require('fs');
var app=express(),PORT=process.env.PORT||3000;
app.use(compression());app.use(cors());app.use(express.json());
var staticOpts={maxAge:'30d',etag:true,immutable:true,setHeaders:function(res){res.removeHeader('Accept-Ranges')}};
app.use('/assets/worldcup',express.static(path.join(__dirname,'../miniprogram/images/worldcup'),staticOpts));
var previewOpts={maxAge:'1h',etag:true,setHeaders:function(res){res.removeHeader('Accept-Ranges')}};
app.use(express.static(path.join(__dirname,'../preview'),previewOpts));

var data={m:{},r:{}};
try{
  var raw=JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));
  data.m=raw.m||raw.matches||{};
  data.r=raw.r||raw.recommends||{};
  console.log('Loaded',Object.keys(data.m).length,'matches',Object.keys(data.r).length,'recGroups');
  // 启动时自动修复日期不匹配
  var fixResult=fixMatchDates(data.m);
  if(fixResult.fixed>0){
    try{fs.writeFileSync(path.join(__dirname,'data.json'),JSON.stringify({m:data.m,r:data.r}))}catch(e){}
    console.log('Auto-fixed:',fixResult.fixed,'matches with wrong dates');
  }
}catch(e){console.log('No data.json:',e.message)}

// 实时比分合并
var liveScores={};
var liveDate='';
try{
  var live=JSON.parse(fs.readFileSync(path.join(__dirname,'live_scores.json'),'utf8'));
  liveDate=live.date||'';
  (live.matches||[]).forEach(function(m){
    liveScores[m.matchId]={matchStatus:m.matchStatus,score:m.score,halfScore:m.halfScore||'',duration:m.duration||'',yellow:m.yellow||'',red:m.red||'',homeScore:m.homeScore,visitScore:m.visitScore,recommNum:m.recommNum,homeName:m.homeName,visitName:m.visitName,leagueName:m.leagueName,num:m.num,startTime:m.startTime,date:m.date};
  });
  console.log('Live scores loaded:',Object.keys(liveScores).length,'matches date:',liveDate);
}catch(e){console.log('No live_scores.json')}

function mergeLiveScore(m){
  var s=liveScores[m.matchId];
  if(!s)return m;
  var merged=Object.assign({},m,s);
  merged.dateLive=liveDate||s.date||'';
  return merged;
}

app.get('/health',function(req,res){res.json({status:'ok',matches:Object.keys(data.m).length})});

// 缓存
var cache={rank:{data:null,time:0,cat:''}};

// 修复比赛日期：num前缀（周一~周日）必须与date的星期匹配
var WEEK_NAMES={周一:1,周二:2,周三:3,周四:4,周五:5,周六:6,周日:0};
function getDayOfWeek(dateStr){
  if(!dateStr||dateStr.length<10)return -1;
  return new Date(dateStr.slice(0,10).replace(/-/g,'/')+' 00:00:00').getDay();
}
function fixMatchDates(allM){
  var fixed=0,skipped=0;
  function fmtDate(dd){return dd.getFullYear()+'-'+String(dd.getMonth()+1).padStart(2,'0')+'-'+String(dd.getDate()).padStart(2,'0')}
  Object.keys(allM).forEach(function(k){
    var m=allM[k];
    if(!m||!m.num||!m.date)return;
    var wp=m.num.slice(0,2);
    var eDay=WEEK_NAMES[wp];
    if(eDay===undefined)return;
    var aDay=getDayOfWeek(m.date);
    if(aDay===eDay)return; // already correct
    if(aDay<0)return;
    // 寻找最近匹配的日期（正负方向都试）
    var d=new Date(m.date.slice(0,10)+'T00:00:00+08:00');
    var best=null,bestD=99;
    for(var o=-6;o<=6;o++){
      var dd=new Date(d);dd.setDate(dd.getDate()+o);
      if(dd.getDay()===eDay){
        var dist=o<0?-o:o;
        if(dist<bestD){bestD=dist;best=fmtDate(dd)}
      }
    }
    if(best&&best!==m.date){m.date=best;fixed++}
  });
  return {fixed:fixed,skipped:skipped};
}

// match-detail: try both 'm_ID' and 'ID' as key
function findMatch(matchId){
  var k='m_'+matchId;
  if(data.m[k]) return data.m[k];
  return data.m[matchId]||null;
}
function normalizeRecs(recs){
  return recs.map(function(x){
    var r=x.rs!==undefined?x.rs:(x.result!==undefined?x.result:null);
    if(r===2) r=null;
    return {type:x.t||x.type,num:x.n||x.num,result:r};
  });
}
function findRecommends(matchId){
  var k='m_'+matchId,raw=data.r[k]||data.r[matchId]||[];
  return normalizeRecs(raw);
}

// 竞彩期号日期列表（按num前两字+date字段分组，date=期号售卖日）
function getWeekDates(){
  var list=[],seen={};
  Object.values(data.m).forEach(function(m){
    var w=m.num?m.num.slice(0,2):'';
    if(!w||w.length<2)return;
    var matchDate=(m.date||'').slice(5)||'';
    if(!matchDate)return;
    var key=w+'|'+matchDate;
    if(!seen[key]){seen[key]=true;list.push({weekNum:w,matchDate:matchDate,label:matchDate.replace('-','/')+' '+w})}
  });
  list.sort(function(a,b){return a.matchDate>b.matchDate?1:-1});
  return list;
}

app.post('/api',function(req,res){
  var a=req.body.action,d=req.body.data||{};
  if(a==='week-dates'){
    return res.json({code:1,data:getWeekDates()});
  }
  if(a==='match-list'){
    var date=d.date||'',weekNum=d.weekNum||'',matchDate=d.matchDate||'',now=new Date().toISOString().slice(0,10);
    if(!date&&!weekNum) date=now;
    var all=[];
    var seen={};
    // 竞彩期号筛选 or 日期筛选
    if(weekNum){
      Object.values(data.m).forEach(function(m){
        var w=m.num?m.num.slice(0,2):'';
        var md=(m.date||'').slice(5)||'';
        if(w===weekNum&&md===matchDate){all.push(m);seen[m.matchId]=true}
      });
    }else{
      Object.values(data.m).forEach(function(m){
        if(m.date===date){all.push(m);seen[m.matchId]=true}
      });
    }
    // 加入 live_scores（仅当请求日期匹配 live_date 或未指定日期）
    if((date===liveDate||(!d.date&&!d.weekNum&&date===now))){
      Object.keys(liveScores).forEach(function(k){
        var ls=liveScores[k];
        // 指定了日期时，只加入日期匹配的 live 条目
        if(d.date&&ls.date!==d.date)return;
        if(!seen[k]) all.push({matchId:k,homeName:'',visitName:'',leagueName:'',num:'',startTime:'',date:ls.date||liveDate||''});
      });
    }
    // 合并实时比分
    all=all.map(function(m){return mergeLiveScore(m)});
    // 补充推荐数
    all=all.map(function(m){
      var recs=findRecommends(m.matchId);
      return Object.assign({},m,{recommNum:m.recommNum||recs.reduce(function(s,x){return s+(x.num||0)},0)});
    });
    all.sort(function(a,b){
      var order={1:0,0:1,2:2,3:3};
      var oa=order[a.matchStatus]!==undefined?order[a.matchStatus]:99;
      var ob=order[b.matchStatus]!==undefined?order[b.matchStatus]:99;
      if(oa!==ob)return oa-ob;
      return (a.startTime||'')>(b.startTime||'')?1:-1;
    });
    return res.json({code:1,data:all,date:liveDate||date});
  }
  if(a==='match-detail'){
    var m=mergeLiveScore(findMatch(d.matchId)||{});
    var r=findRecommends(d.matchId);
    return res.json({code:1,data:{match:m,recommends:r}});
  }
  if(a==='recommend-trend'){
    var recs=findRecommends(d.matchId);
    var lastResult=[];
    var typeMap={};
    recs.forEach(function(x){
      var t=x.type;
      if(!typeMap[t]){typeMap[t]={num:0,type:t}};
      typeMap[t].num=x.num||typeMap[t].num;
    });
    Object.keys(typeMap).forEach(function(t){lastResult.push(typeMap[t])});

    // 从 trends.json 读取历史快照构建趋势数据
    var series=[],timeLabels=[];
    try{
      var trendFile=path.join(__dirname,'trends.json');
      if(fs.existsSync(trendFile)){
        var trends=JSON.parse(fs.readFileSync(trendFile,'utf8'));
        var key='m_'+d.matchId;
        var snaps=(trends[key]||[]);
        if(snaps.length>0){
          timeLabels=snaps.map(function(s){return s.t});
          var allTypes={};
          snaps.forEach(function(s){Object.keys(s).forEach(function(k){if(k!=='t'&&k!=='ts')allTypes[k]=true})});
          Object.keys(allTypes).forEach(function(type){
            series.push({
              name:type,type:'line',smooth:true,
              data:snaps.map(function(s){return s[type]||0})
            });
          });
          // 按当前总数排序取top5
          var top5=Object.keys(typeMap).sort(function(a,b){return(typeMap[b]?typeMap[b].num:0)-(typeMap[a]?typeMap[a].num:0)}).slice(0,5);
          series=series.filter(function(s){return top5.indexOf(s.name)>=0});
        }
      }
    }catch(e){}
    return res.json({code:1,data:{lastResult:lastResult,series:series,timeLabels:timeLabels}});
  }
  if(a==='ranking-list'){
    var filterCat=d.category||null,filterDir=d.direction||null;
    // 30s 缓存
    var ck=filterCat+'|'+filterDir;
    if(cache.rank.data&&ck===cache.rank.cat&&Date.now()-cache.rank.time<30000)
      return res.json(cache.rank.data);

    function fmtDate(dd){return dd.getFullYear()+'-'+String(dd.getMonth()+1).padStart(2,'0')+'-'+String(dd.getDate()).padStart(2,'0')}
    // 统计每个竞彩date的推荐总数
    var dateRecNum={};
    Object.keys(data.m).forEach(function(k){
      var m=data.m[k];
      if(!m.date)return;
      var total=m.recommNum||0;
      if(total===0){
        var recs=findRecommends(m.matchId);
        recs.forEach(function(r){total+=r.num||0});
      }
      if(!dateRecNum[m.date])dateRecNum[m.date]=0;
      dateRecNum[m.date]+=total;
    });
    // 从今天往前找最近一个有推荐的竞彩期号日期
    var now=new Date();
    var effectiveDate='';
    for(var i=0;i<30;i++){
      var ds=fmtDate(now);
      if(dateRecNum[ds]&&dateRecNum[ds]>0){effectiveDate=ds;break}
      now.setDate(now.getDate()-1);
    }
    if(!effectiveDate)effectiveDate=fmtDate(new Date());
    // 该日期的竞彩期号标签（如"周二"）
    var effectiveWeek='';
    Object.keys(data.m).forEach(function(k){
      var m=data.m[k];
      if(m.date===effectiveDate&&!effectiveWeek){effectiveWeek=m.num?m.num.slice(0,2):''}
    });
    var matchDateLabel=effectiveDate.slice(5).replace('-','/')+' '+effectiveWeek;
    function inRange(dt){return dt===effectiveDate}
    // 分类函数
    function classifyType(t){
      if(t.indexOf('半全场')===0)return '半全场';
      if(t.indexOf('总进球')===0)return '进球数';
      if(t.indexOf('、')>=0)return '双选';
      if(t.indexOf('让')===0)return '让球';
      if(t==='胜'||t==='平'||t==='负')return '胜平负';
      return '其他';
    }
    // 收集方向统计（仅 effectiveDate 的比赛）
    var dirStats={};
    Object.keys(data.m).forEach(function(k){
      var m=data.m[k],mId=m.matchId;
      if(m.date!==effectiveDate)return;
      var recs=findRecommends(mId);
      if(!recs.length)return;
      recs.forEach(function(r){
        if(!r.type||!r.num)return;
        if(!dirStats[r.type])dirStats[r.type]={totalNum:0,matches:[]};
        dirStats[r.type].totalNum+=r.num;
        dirStats[r.type].matches.push({
          matchId:mId,homeName:m.homeName,visitName:m.visitName,
          leagueName:m.leagueName,num:m.num,date:m.date,
          direction:r.type,expertCount:r.num,matchStatus:m.matchStatus||0
        });
      });
    });
    // 分类结构
    var categories={};
    Object.keys(dirStats).forEach(function(t){
      var cat=classifyType(t);
      if(!categories[cat])categories[cat]={directions:[]};
      categories[cat].directions.push({name:t,totalExpertCount:dirStats[t].totalNum});
    });
    Object.keys(categories).forEach(function(c){categories[c].directions.sort(function(a,b){return b.totalExpertCount-a.totalExpertCount})});
    var CAT_ORDER=['胜平负','让球','进球数','半全场','双选'];
    var sortedCats={};
    CAT_ORDER.forEach(function(k){if(categories[k])sortedCats[k]=categories[k]});
    // 构建排名
    var list=[];
    if(filterDir&&dirStats[filterDir]){
      dirStats[filterDir].matches.forEach(function(x){if(inRange(x.date))list.push(x)});
    }else if(filterCat&&categories[filterCat]){
      var catDirs={};
      categories[filterCat].directions.forEach(function(d){catDirs[d.name]=true});
      Object.keys(data.m).forEach(function(k){
        var m=data.m[k];
        if(!inRange(m.date))return;
        var recs=findRecommends(m.matchId).filter(function(r){return catDirs[r.type]&&r.num>0});
        if(recs.length){
          var max=recs.reduce(function(a,b){return b.num>a.num?b:a});
          list.push({matchId:m.matchId,homeName:m.homeName,visitName:m.visitName,leagueName:m.leagueName,num:m.num,date:m.date,direction:max.type,expertCount:max.num,matchStatus:m.matchStatus||0});
        }
      });
    }else{
      // 综合排名
      Object.keys(data.m).forEach(function(k){
        var m=data.m[k];
        if(!inRange(m.date))return;
        var recs=findRecommends(m.matchId).filter(function(r){return r.num>0});
        if(recs.length){
          var max=recs.reduce(function(a,b){return b.num>a.num?b:a});
          list.push({matchId:m.matchId,homeName:m.homeName,visitName:m.visitName,leagueName:m.leagueName,num:m.num,date:m.date,direction:max.type,expertCount:max.num,matchStatus:m.matchStatus||0});
        }
      });
    }
    list.sort(function(a,b){return b.expertCount-a.expertCount});
    list=list.slice(0,100);
    var ranking=list.map(function(x,i){x.rank=i+1;return x});
    var topExpertCount=list.length>0?list[0].expertCount:0;
    var respData={code:1,data:{categories:sortedCats,ranking:ranking,totalMatches:ranking.length,effectiveDate:effectiveDate,matchDateLabel:matchDateLabel,topExpertCount:topExpertCount}};
    cache.rank={data:respData,time:Date.now(),cat:ck};
    return res.json(respData);
  }
  if(a==='hit-rate-stats'){
    var days=d.days||60;
    var cutoff=new Date(Date.now()-days*86400000);
    function fmtDate(dd){return dd.getFullYear()+'-'+String(dd.getMonth()+1).padStart(2,'0')+'-'+String(dd.getDate()).padStart(2,'0')}
    var cutoffStr=fmtDate(cutoff);
    // 按方向统计（近N天完赛数据）
    var ds=[],recMap={};
    // 场次前三统计：对每个 matchId，取 3 个 intros 累加到 matchTop 对象
    var fieldTopHits = 0;
    var fieldTopTotal = 0;

    Object.keys(data.r).forEach(function(k){
      var mId=k.replace('m_','');
      var match=data.m[k]||data.m[mId];
      if(!match||!match.date||match.date.length<10)return;
      if(match.date.slice(0,10)<cutoffStr)return;
      // 该场比赛所有推荐方向排序后去 Top3
      var recs=normalizeRecs(data.r[k]);
      recs.sort(function(a,b){return(b.num||0)-(a.num||0)});
      // 存 Top3 + 累加主统计
      for(var i=0;i<recs.length;i++){
        var x=recs[i],t=x.type;
        if(!recMap[t])recMap[t]={total:0,hit:0,miss:0};
        recMap[t].total++;
        if(x.result===1)recMap[t].hit++;
        else if(x.result===0)recMap[t].miss++;
        // Top3 的特殊累加
        if(i<3){
          if(x.result===1)fieldTopHits++;
          else if(x.result===0){/* 未中不算命中 */}
          fieldTopTotal++;
        }
      }
    });

    Object.keys(recMap).forEach(function(t){var v=recMap[t];ds.push({direction:t,totalRecommends:v.total,hitCount:v.hit,missCount:v.miss,hitRate:v.total>0?Math.round(v.hit/v.total*1000)/10:0})});
    ds.sort(function(a,b){return b.hitCount-a.hitCount});
    var top3HitRate=fieldTopTotal>0?Math.round(fieldTopHits/fieldTopTotal*1000)/10:0;
    return res.json({code:1,data:{directionStats:ds,top3HitRate:top3HitRate,totalMatchFields:fieldTopTotal,top3Hits:fieldTopHits}});
  }
  if(a==='fix-data'){
    var result=fixMatchDates(data.m);
    // 回写到 data.json
    try{
      fs.writeFileSync(path.join(__dirname,'data.json'),JSON.stringify({m:data.m,r:data.r}));
      result.saved=true;
    }catch(e){result.saveError=e.message}
    return res.json({code:1,data:result,msg:'Fixed '+result.fixed+' matches'});
  }
  res.json({code:0,msg:'Not found'})
});
app.listen(PORT,function(){console.log('Server:'+PORT)});

var express=require('express'),cors=require('cors'),path=require('path'),fs=require('fs');
var app=express(),PORT=process.env.PORT||3000;
app.use(cors());app.use(express.json());
app.use('/assets/worldcup',express.static(path.join(__dirname,'../miniprogram/images/worldcup')));
app.use(express.static(path.join(__dirname,'../preview')));

var data={m:{},r:{}};
try{
  var raw=JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));
  data.m=raw.m||raw.matches||{};
  data.r=raw.r||raw.recommends||{};
  console.log('Loaded',Object.keys(data.m).length,'matches',Object.keys(data.r).length,'recGroups')
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

app.post('/api',function(req,res){
  var a=req.body.action,d=req.body.data||{};
  if(a==='match-list'){
    var date=d.date||'',now=new Date().toISOString().slice(0,10);
    if(!date) date=now;
    var all=[];
    var seen={};
    // 从静态数据加载并筛选
    Object.values(data.m).forEach(function(m){
      if(m.date===date||m.date===liveDate||m.date===now){all.push(m);seen[m.matchId]=true}
    });
    // 加入 live_scores 中的新比赛
    Object.keys(liveScores).forEach(function(k){
      if(!seen[k]) all.push({matchId:k,homeName:'',visitName:'',leagueName:'',num:'',startTime:'',date:''});
    });
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
    return res.json({code:1,data:{lastResult:lastResult,series:[],timeLabels:[]}});
  }
  if(a==='ranking-list'){
    var filterCat=d.category||null,filterDir=d.direction||null;
    // 日期过滤：仅今天和明天
    var today=new Date().toISOString().slice(0,10);
    var d2=new Date(Date.now()+86400000);
    var tomorrow=d2.toISOString().slice(0,10);
    function inRange(dt){return dt===today||dt===tomorrow}
    // 分类函数
    function classifyType(t){
      if(t.indexOf('半全场')===0)return '半全场';
      if(t.indexOf('总进球')===0)return '进球数';
      if(t.indexOf('、')>=0)return '双选';
      if(t.indexOf('让')===0)return '让球';
      if(t==='胜'||t==='平'||t==='负')return '胜平负';
      return '其他';
    }
    // 收集方向统计
    var dirStats={}; // {type: {totalNum, matches:[]}}
    Object.keys(data.m).forEach(function(k){
      var m=data.m[k],mId=m.matchId;
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
    return res.json({code:1,data:{categories:sortedCats,ranking:ranking,totalMatches:ranking.length}});
  }
  if(a==='hit-rate-stats'){
    var ds=[];
    var recMap={};
    Object.keys(data.r).forEach(function(k){
      normalizeRecs(data.r[k]).forEach(function(x){
        var t=x.type;if(!recMap[t])recMap[t]={total:0,hit:0,miss:0};
        recMap[t].total++;
        if(x.result===1)recMap[t].hit++;
        else if(x.result===0)recMap[t].miss++;
      });
    });
    Object.keys(recMap).forEach(function(t){var v=recMap[t];ds.push({direction:t,totalRecommends:v.total,hitCount:v.hit,missCount:v.miss,hitRate:v.total>0?Math.round(v.hit/v.total*1000)/10:0})});
    ds.sort(function(a,b){return b.hitCount-a.hitCount});
    return res.json({code:1,data:{directionStats:ds}});
  }
  res.json({code:0,msg:'Not found'})
});
app.listen(PORT,function(){console.log('Server:'+PORT)});

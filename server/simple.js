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
    var date=d.date||'';
    var all=Object.values(data.m);
    // 为每场比赛补充专家推荐数量
    all=all.map(function(m){
      var recs=findRecommends(m.matchId);
      return Object.assign({},m,{recommNum:recs.reduce(function(s,x){return s+(x.num||0)},0)});
    });
    if(date) all=all.filter(function(m){return m.date===date});
    all.sort(function(a,b){return (a.startTime||'')>(b.startTime||'')?1:-1});
    return res.json({code:1,data:all});
  }
  if(a==='match-detail'){
    var m=findMatch(d.matchId)||{};
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
    return res.json({code:1,data:{categories:{},ranking:[],totalMatches:Object.keys(data.m).length}});
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

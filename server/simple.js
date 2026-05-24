var express=require('express'),cors=require('cors'),compression=require('compression'),path=require('path'),fs=require('fs');
var app=express(),PORT=process.env.PORT||3000;
var {fetchOdds:fetch500Odds}=require('./fetch_500odds');
// 赔率缓存：避免重复抓取（30分钟过期）
var oddsCache={},oddsCacheTime={},oddsCacheTTL=1800000;
// 按日期缓存500.com全量赔率
var odds500Cache={},odds500Date='';
// 已从odds_history加载的日期（防止异步抓取覆盖历史数据）
var oddsHistoryLoaded={};
// 方案快照冻结缓存
var planSnapshots={};
app.use(compression());app.use(cors());app.use(express.json());
var staticOpts={maxAge:'30d',etag:true,immutable:true,setHeaders:function(res){res.removeHeader('Accept-Ranges')}};
app.use('/assets/worldcup',express.static(path.join(__dirname,'../miniprogram/images/worldcup'),staticOpts));
// 首页内存缓存：避免每次读磁盘
var homeCache=null,homeCacheTime=0,homeCacheMaxAge=0;
var hp=path.join(__dirname,'../preview/index.html');
function getHomeHTML(cb){
  var now=Date.now();
  if(homeCache&&(now-homeCacheTime<homeCacheMaxAge))return cb(null,homeCache);
  fs.readFile(hp,'utf8',function(err,html){
    if(!err){homeCache=html;homeCacheTime=now}
    cb(err,html||homeCache);
  });
}
app.get('/',function(req,res){
  getHomeHTML(function(err,html){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache, no-store, must-revalidate'});res.end(html)});
});
var previewOpts={maxAge:0,etag:false,setHeaders:function(res,fp){
  res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
  res.removeHeader('Accept-Ranges');
  if(fp.endsWith('.html'))res.setHeader('Content-Type','text/html; charset=utf-8');
}};
app.use(express.static(path.join(__dirname,'../preview'),previewOpts));

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
    if(aDay===eDay)return;
    if(aDay<0)return;
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
  // 根据推荐result自动修正历史比赛的matchStatus（已结束但状态未更新）
  var statusFixed=0;
  Object.keys(data.m).forEach(function(k){
    var m=data.m[k];
    if(!m||m.matchStatus===2)return;
    var recs=normalizeRecs(data.r['m_'+m.matchId]||data.r[m.matchId]||[]);
    if(recs.some(function(r){return r.result!==null})){
      m.matchStatus=2; statusFixed++;
    }
  });
  if(statusFixed>0) console.log('Status auto-fixed:',statusFixed,'finished matches');
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
  if(a==='plan-list'){
    var dateStr = d.date || new Date().toISOString().slice(0,10);
    var now = Date.now();

    // 收集当天比赛
    var mList = [];
    var mKeys = Object.keys(data.m||{});
    for(var k=0;k<mKeys.length;k++){ var m=data.m[mKeys[k]]; if((m.date||'').slice(0,10)===dateStr) mList.push(m); }

    // 异步拉取500.com赔率（已从历史加载的日期不重复抓取）
    if(!oddsHistoryLoaded[dateStr] && odds500Date!==dateStr && !odds500Cache._fetching){
      odds500Cache._fetching=true;
      fetch500Odds(dateStr).then(function(data){
        Object.keys(data).forEach(function(k){ data[k]._t=now; odds500Cache[k]=data[k]; });
        odds500Date=dateStr;
        odds500Cache._fetching=false;
      }).catch(function(){ odds500Cache._fetching=false; });
    }

    // 辅助：获取某场比赛某个方向的赔率
    function getMatchOdds(match, direction){
      var fiveOdds=odds500Cache[match.num||''];
      if(fiveOdds && fiveOdds._t && (now-fiveOdds._t<oddsCacheTTL)){
        return {
          spf: { home: fiveOdds.spf.home, draw: fiveOdds.spf.draw, away: fiveOdds.spf.away },
          rqspf: fiveOdds.rqspf ? { home: fiveOdds.rqspf.home, draw: fiveOdds.rqspf.draw, away: fiveOdds.rqspf.away, handicap: fiveOdds.rqspf.handicap } : null,
          totalGoals: fiveOdds.totalGoals || null,
          halfFull: fiveOdds.halfFull || null,
        };
      }
      return null;
    }

    // 提取复合方向的所有子选项赔率
    function extractSubOdds(oddsObj, direction){
      var vals = [];
      // 总进球复合: "总进球-2、3球"
      if(direction.indexOf('总进球-')===0){
        var tg = oddsObj.totalGoals;
        if(!tg) return vals;
        var nums = direction.replace('总进球-','').split(/[、,]/);
        for(var ni=0;ni<nums.length;ni++){
          var n = nums[ni].replace(/球/g,'').trim();
          if(tg[n]!==undefined) vals.push(tg[n]);
        }
        return vals;
      }
      // 其他复合方向: "平、让平"
      if(direction.indexOf('、')>=0 || direction.indexOf(',')>=0){
        var parts = direction.split(/[、,]/);
        for(var pi=0;pi<parts.length;pi++){
          var pd = parts[pi].trim();
          if(pd==='平'){ if(oddsObj.spf) vals.push(oddsObj.spf.draw); }
          else if(pd==='让平' && oddsObj.rqspf) vals.push(oddsObj.rqspf.draw);
          else if(pd==='让负' && oddsObj.rqspf) vals.push(oddsObj.rqspf.away);
          else if(pd==='让胜' && oddsObj.rqspf) vals.push(oddsObj.rqspf.home);
        }
        return vals;
      }
      // 单选
      if(direction==='让负' && oddsObj.rqspf) vals.push(oddsObj.rqspf.away);
      else if(direction==='让胜' && oddsObj.rqspf) vals.push(oddsObj.rqspf.home);
      return vals;
    }

    // 辅助：获取每个方向专家数最多的场次（可排除已选比赛）
    function findBestMatchForDirection(directions, excludeIds){
      var bestMatch=null,bestCount=0;
      for(var i=0;i<mList.length;i++){
        var m=mList[i];
        if(excludeIds && excludeIds.indexOf(m.matchId)>=0) continue;
        var recs=findRecommends(m.matchId);
        var total=0;
        for(var j=0;j<recs.length;j++){
          if(directions.indexOf(recs[j].type)>=0) total+=recs[j].num||0;
        }
        if(total>bestCount){ bestCount=total; bestMatch=m; }
      }
      return bestMatch;
    }

    // 辅助：构建单个match对象
    function buildMatchObj(m, direction){
      var recs=findRecommends(m.matchId);
      var expertCount=0, isMatchWon=null, isMatchLose=null;
      
      var subDirs = direction.split(/[、,]/);
      var matchedRecs = [];
      var subResults = [];  // [{direction, result}] 用于前端着色
      
      subDirs.forEach(function(subDir){
        var sd = subDir.trim();
        var found = null;
        for(var j=0;j<recs.length;j++){ if(recs[j].type===sd){ found=recs[j]; break; } }
        if(found) matchedRecs.push(found);
        subResults.push({ direction: sd, result: found ? found.result : null });
      });
      
      if(matchedRecs.length===0){
        for(var j=0;j<recs.length;j++){
          var rt=recs[j].type||'';
          if(rt.indexOf(direction)>=0 || direction.indexOf(rt)>=0){ matchedRecs.push(recs[j]); }
        }
        if(matchedRecs.length===0) subResults = [{ direction: direction, result: null }];
      }
      
      expertCount = matchedRecs.reduce(function(s,r){ return s + (r.num||0); }, 0);
      
      // 双选(复合方向): 任何一个子方向命中即为赢
      var anyWon = false, anyLose = false, anyUnknown = false;
      matchedRecs.forEach(function(r){
        if(r.result===1) anyWon=true;
        else if(r.result===0) anyLose=true;
        else anyUnknown=true;
      });
      if(!anyUnknown){
        isMatchWon = anyWon;
        isMatchLose = !anyWon && anyLose;
      }
      
      return {
        matchId:m.matchId, homeName:m.homeName, visitName:m.visitName,
        leagueName:m.leagueName, matchNum:m.num||'', startTime:m.startTime||'',
        matchStatus:m.matchStatus||0,
        direction:direction, expertCount:expertCount,
        isMatchWon:isMatchWon, isMatchLose:isMatchLose,
        subResults: subResults,
        odds:getMatchOdds(m, direction)
      };
    }

    // 生成3个方案
    function generatePlans(){
      var plans=[];
      
      // 奖金计算：eff = sum(sub_odds) / (2N)  双选公式
      function calcEffectiveOdds(direction, match){
        var oddsObj = match.odds || {};
        var subOdds = extractSubOdds(oddsObj, direction);
        if(subOdds.length === 0) return null;
        var N = subOdds.length;
        if(N === 1) return subOdds[0];
        return subOdds.reduce(function(a,b){return a+b}, 0) / (2 * N);
      }
      
      var m1a=findBestMatchForDirection(['平','让平']);
      var m1b=findBestMatchForDirection(['让负'], m1a?[m1a.matchId]:null);
      
      // 方案二：场次1=总进球-2、3球最多专家，场次2=让负最多专家
      var m2a=findBestMatchForDirection(['总进球-2、3球']);
      var m2b=findBestMatchForDirection(['让负']);
      
      // 方案三：场次1=总进球-2、3球最多专家，场次2=让胜最多专家
      var m3a=findBestMatchForDirection(['总进球-2、3球']);
      var m3b=findBestMatchForDirection(['让胜']);

      if(m1a&&m1b){
        var m1aObj = buildMatchObj(m1a,'平、让平');
        var m1bObj = buildMatchObj(m1b,'让负');
        var eff1 = calcEffectiveOdds('平、让平', m1aObj);
        var eff2 = calcEffectiveOdds('让负', m1bObj);
        var mp1 = eff1&&eff2 ? Math.round(1000 * eff1 * eff2) : Math.round(1000 * 2.5);
        plans.push({ planId:'plan_'+dateStr+'_1', planName:'方案一',
          matches:[m1aObj, m1bObj],
          amount:1000, playType:'混合投注', matchCount:2, passType:'2串1',
          betCount:250, ticketCount:10, multiplier:25, maxPrize:mp1
        });
      }
      if(m2a&&m2b){
        var m2aObj = buildMatchObj(m2a,'总进球-2、3球');
        var m2bObj = buildMatchObj(m2b,'让负');
        var eff1 = calcEffectiveOdds('总进球-2、3球', m2aObj);
        var eff2 = calcEffectiveOdds('让负', m2bObj);
        var mp2 = eff1&&eff2 ? Math.round(1000 * eff1 * eff2) : Math.round(1000 * 2.5);
        plans.push({ planId:'plan_'+dateStr+'_2', planName:'方案二',
          matches:[m2aObj, m2bObj],
          amount:1000, playType:'混合投注', matchCount:2, passType:'2串1',
          betCount:250, ticketCount:10, multiplier:25, maxPrize:mp2
        });
      }
      if(m3a&&m3b){
        var m3aObj = buildMatchObj(m3a,'总进球-2、3球');
        var m3bObj = buildMatchObj(m3b,'让胜');
        var eff1 = calcEffectiveOdds('总进球-2、3球', m3aObj);
        var eff2 = calcEffectiveOdds('让胜', m3bObj);
        var mp3 = eff1&&eff2 ? Math.round(1000 * eff1 * eff2) : Math.round(1000 * 2.5);
        plans.push({ planId:'plan_'+dateStr+'_3', planName:'方案三',
          matches:[m3aObj, m3bObj],
          amount:1000, playType:'混合投注', matchCount:2, passType:'2串1',
          betCount:250, ticketCount:10, multiplier:25, maxPrize:mp3
        });
      }
      return plans;
    }

    var plans=generatePlans();
    return res.json({code:1,data:{date:dateStr,plans:plans}});
  }
  if(a==='income-stats'){
    var planFilter=d.plan||'all';
    var daysFilter=parseInt(d.days)||0; // 0=all
    var AMOUNT=1000; // 方案金额固定1000元
    
    function fmtDate2(dd){return dd.getFullYear()+'-'+String(dd.getMonth()+1).padStart(2,'0')+'-'+String(dd.getDate()).padStart(2,'0')}
    
    // 日期范围：最早4/25 → 今天
    var minDate='2026-04-25';
    var endDate=new Date();
    var startDate=new Date(minDate);
    if(daysFilter>0){
      startDate=new Date(endDate.getTime()-(daysFilter-1)*86400000);
      if(fmtDate2(startDate)<minDate) startDate=new Date(minDate);
    }
    
    // 提取单个赔率值（仅供单选方向使用）
    function extractOddsVal(oddsObj, direction){
      if(!oddsObj) return null;
      if(direction==='平') return oddsObj.spf?oddsObj.spf.draw:null;
      if(direction==='让平') return oddsObj.rqspf?oddsObj.rqspf.draw:null;
      if(direction==='让负') return oddsObj.rqspf?oddsObj.rqspf.away:null;
      if(direction==='让胜') return oddsObj.rqspf?oddsObj.rqspf.home:null;
      return null;
    }
    
    // 提取复合方向的所有子选项赔率（返回数组）
    function extractIndividualOdds(oddsObj, direction){
      if(!oddsObj) return [];
      // 总进球双选："总进球-2、3球"
      if(direction.indexOf('总进球-')===0){
        var tg=oddsObj.totalGoals;
        if(!tg) return [];
        var nums=direction.replace('总进球-','').split(/[、,]/);
        var vals=[];
        for(var ni=0;ni<nums.length;ni++){
          var n=nums[ni].replace(/球/g,'').trim();
          if(tg[n]!==undefined) vals.push(tg[n]);
        }
        return vals;
      }
      // 其他复合方向："平、让平"
      if(direction.indexOf('、')>=0 || direction.indexOf(',')>=0){
        var parts = direction.split(/[、,]/);
        var vals=[];
        for(var pi=0;pi<parts.length;pi++){
          var sv = extractOddsVal(oddsObj, parts[pi].trim());
          if(sv!==null) vals.push(sv);
        }
        return vals;
      }
      // 单选
      var sv = extractOddsVal(oddsObj, direction);
      return sv!==null ? [sv] : [];
    }
    
    var results=[];
    var totalPlans=0,totalWon=0,totalIncome=0;
    
    for(var d=new Date(startDate); d<=endDate; d.setDate(d.getDate()+1)){
      var ds=fmtDate2(d);
      
      var mList=[];
      var mKeys=Object.keys(data.m||{});
      for(var k=0;k<mKeys.length;k++){ var m=data.m[mKeys[k]]; if((m.date||'').slice(0,10)===ds) mList.push(m); }
      if(mList.length===0) continue;
      
      // 加载历史赔率
      var oddsFile=path.join(__dirname,'odds_history',ds+'.json');
      var histOdds=null;
      if(fs.existsSync(oddsFile)){
        try{ var raw=JSON.parse(fs.readFileSync(oddsFile,'utf8')); histOdds=raw.odds||{}; }catch(e){}
      }
      
      function findBest(directions, excludeIds){
        var best=null,bestCount=0;
        for(var j=0;j<mList.length;j++){
          var mm=mList[j];
          if(excludeIds && excludeIds.indexOf(mm.matchId)>=0) continue;
          var recs=findRecommends(mm.matchId);
          var total=0;
          for(var ri=0;ri<recs.length;ri++){ if(directions.indexOf(recs[ri].type)>=0) total+=recs[ri].num||0; }
          if(total>bestCount){ bestCount=total; best=mm; }
        }
        return best;
      }
      
      function getOddsObj(match){
        var num=match.num||'';
        // 优先使用内存缓存（与 plan-list 一致）
        var five=odds500Cache[num];
        if(five&&five._t){
          return { spf:five.spf||null, rqspf:five.rqspf||null, totalGoals:five.totalGoals||null };
        }
        if(histOdds&&histOdds[num]){
          var od=histOdds[num];
          return { spf:od.spf||null, rqspf:od.rqspf||null, totalGoals:od.totalGoals||null };
        }
        return null;
      }
      
      function buildMatch(match, direction){
        var recs=findRecommends(match.matchId);
        var subResults = [];
        var matchedRecs = [];
        
        // 复合方向：按、分割，但总进球系列是整体（如"总进球-2、3球"不拆）
        var subDirs;
        if(direction.indexOf('总进球')===0){
          subDirs = [direction];
        } else {
          subDirs = direction.split(/[、,]/);
        }
        subDirs.forEach(function(sd){
          var s = sd.trim();
          var found = null;
          for(var ri=0;ri<recs.length;ri++){ if(recs[ri].type===s) found=recs[ri]; }
          if(found) matchedRecs.push(found);
          subResults.push({ direction: s, result: found ? found.result : null });
        });
        var isWon=null, isLose=null;
        if(matchedRecs.length>0){
          var anyWon=false, anyLose=false, anyUnknown=false;
          matchedRecs.forEach(function(r){
            if(r.result===1) anyWon=true;
            else if(r.result===0) anyLose=true;
            else anyUnknown=true;
          });
          if(!anyUnknown){ isWon=anyWon; isLose=!anyWon && anyLose; }
        }
        return {
          matchId:match.matchId, homeName:match.homeName, visitName:match.visitName,
          matchNum:match.num||'', direction:direction,
          oddsObj:getOddsObj(match),
          subResults: subResults,
          isWon:isWon, isLose:isLose
        };
      }
      
      var m1a=findBest(['平','让平']), m1b=findBest(['让负'], m1a?[m1a.matchId]:null);
      var m2a=findBest(['总进球-2、3球']), m2b=findBest(['让负'], m2a?[m2a.matchId]:null);
      var m3a=findBest(['总进球-2、3球']), m3b=findBest(['让胜'], m3a?[m3a.matchId]:null);
      
      var dayPlans=[];
      if(m1a&&m1b) dayPlans.push({name:'plan_1',planName:'方案一',matches:[buildMatch(m1a,'平、让平'),buildMatch(m1b,'让负')]});
      if(m2a&&m2b) dayPlans.push({name:'plan_2',planName:'方案二',matches:[buildMatch(m2a,'总进球-2、3球'),buildMatch(m2b,'让负')]});
      if(m3a&&m3b) dayPlans.push({name:'plan_3',planName:'方案三',matches:[buildMatch(m3a,'总进球-2、3球'),buildMatch(m3b,'让胜')]});
      
      // 如果当天有任意方案结果未知，整日不统计
      var dayHasUnknown = false;
      dayPlans.forEach(function(pp){
        if(planFilter!=='all' && pp.name!==planFilter) return;
        for(var mi=0;mi<pp.matches.length;mi++){
          if(!pp.matches[mi].isWon && !pp.matches[mi].isLose){ dayHasUnknown=true; return; }
        }
      });
      if(dayHasUnknown) continue;
      
      dayPlans.forEach(function(pp){
        if(planFilter!=='all' && pp.name!==planFilter) return;
        
        var allWon=true, anyLose=false, anyUnknown=false;
        for(var mi=0;mi<pp.matches.length;mi++){
          if(!pp.matches[mi].isWon) allWon=false;
          if(pp.matches[mi].isLose) anyLose=true;
          if(!pp.matches[mi].isWon&&!pp.matches[mi].isLose) anyUnknown=true;
        }
        
        // 奖金计算: 1000 × eff1 × eff2
        // eff = (单选赔率) 或 (双选: sum/4)
        var effectiveOdds=[];
        var hasAllOdds=true;
        for(var mi=0;mi<pp.matches.length;mi++){
          var subOdds = extractIndividualOdds(pp.matches[mi].oddsObj, pp.matches[mi].direction);
          if(subOdds.length===0){ hasAllOdds=false; continue; }
          var N = subOdds.length;
          if(N===1){
            effectiveOdds.push(subOdds[0]);
          } else {
            // 双选: eff = sum / (2N) = sum / 4
            var sum = subOdds.reduce(function(a,b){return a+b}, 0);
            effectiveOdds.push(sum / (2*N));
          }
        }
        
        var prize=0, dayIncome=0, status='unknown';
        if(allWon){
          prize = hasAllOdds && effectiveOdds.length===2 ? Math.round(AMOUNT * effectiveOdds[0] * effectiveOdds[1]) : Math.round(AMOUNT * 3);
          dayIncome = prize - AMOUNT;
          status='won'; totalWon++;
        } else if(anyLose){
          dayIncome = -AMOUNT;
          status='lose';
        }
        totalPlans++;
        totalIncome+=dayIncome;
        
        results.push({
          date:ds, plan:pp.planName, status:status,
          matches:pp.matches.map(function(mm){
            return { matchNum:mm.matchNum, home:mm.homeName, visit:mm.visitName, direction:mm.direction, isWon:mm.isWon, isLose:mm.isLose };
          }),
          prize:prize, income:dayIncome
        });
      });
    }
    
    // 按日期汇总
    var dateMap={};
    results.forEach(function(r){
      if(!dateMap[r.date]) dateMap[r.date]={ won:0, total:0, income:0 };
      dateMap[r.date].total++;
      dateMap[r.date].income+=r.income;
      if(r.status==='won') dateMap[r.date].won++;
    });
    
    var dayRecords=[];
    Object.keys(dateMap).sort().reverse().forEach(function(ds){
      var dr=dateMap[ds];
      dayRecords.push({
        date:ds,
        hitCount:dr.won,
        totalPlans:dr.total,
        hitRate:dr.total>0?Math.round(dr.won/dr.total*100):0,
        income:dr.income
      });
    });
    
    var winRate=totalPlans>0?Math.round(totalWon/totalPlans*100):0;
    return res.json({code:1,data:{
      summary:{ totalPlans:totalPlans, totalWon:totalWon, totalIncome:totalIncome, winRate:winRate },
      records:dayRecords
    }});
  }
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
    // 补充500.com单关标识
    var needFetch500 = false;
    all=all.map(function(m){
      var num=m.num||'';
      var fiveData=odds500Cache[num];
      var isSingle=false;
      if(fiveData && fiveData._t){
        isSingle=fiveData.isSingleGame===true;
      }else{
        needFetch500=true;
      }
      return Object.assign({},m,{isSingleGame:isSingle});
    });
    // 异步拉取500.com数据
    if(needFetch500 && !odds500Cache._fetching && date){
      odds500Cache._fetching=true;
      fetch500Odds(date).then(function(data){
        Object.keys(data).forEach(function(k){
          data[k]._t=Date.now();
          odds500Cache[k]=data[k];
        });
        odds500Cache._fetching=false;
      }).catch(function(){
        odds500Cache._fetching=false;
      });
    }
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
    var filterCat=d.category||null,filterDir=d.direction||null,reqDate=d.date||null;
    // 30s 缓存(按完整参数)
    var ck=filterCat+'|'+filterDir+'|'+(reqDate||'');
    if(cache.rank.data&&ck===cache.rank.cat&&Date.now()-cache.rank.time<30000)
      return res.json(cache.rank.data);

    function fmtDate(dd){return dd.getFullYear()+'-'+String(dd.getMonth()+1).padStart(2,'0')+'-'+String(dd.getDate()).padStart(2,'0')}
    // 统计每个竞彩date的推荐总数（全量统计，用于回退）
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
    // 指定日期或自动查找最近有推荐的日期
    var now=new Date();
    var effectiveDate='';
    if(reqDate){
      effectiveDate=reqDate;
    }else{
      for(var i=0;i<30;i++){
        var ds=fmtDate(now);
        if(dateRecNum[ds]&&dateRecNum[ds]>0){effectiveDate=ds;break}
        now.setDate(now.getDate()-1);
      }
    }
    if(!effectiveDate)effectiveDate=reqDate||fmtDate(new Date());
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
          direction:r.type,expertCount:r.num,matchStatus:m.matchStatus||0,
          isHit: r.result===1
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
          list.push({matchId:m.matchId,homeName:m.homeName,visitName:m.visitName,leagueName:m.leagueName,num:m.num,date:m.date,direction:max.type,expertCount:max.num,matchStatus:m.matchStatus||0,isHit:max.result===1});
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
          list.push({matchId:m.matchId,homeName:m.homeName,visitName:m.visitName,leagueName:m.leagueName,num:m.num,date:m.date,direction:max.type,expertCount:max.num,matchStatus:m.matchStatus||0,isHit:max.result===1});
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
  if(a==='filter-stats'){
    var ls=new Set(),ds=new Set(),ms=new Set();
    Object.keys(data.r).forEach(function(k){
      var m=data.m[k]||data.m[k.replace('m_','')];
      if(!m)return;
      var r=normalizeRecs(data.r[k]).filter(function(x){return x.result!==null});
      if(r.length){ms.add(k.replace('m_',''));if(m.leagueName)ls.add(m.leagueName);r.forEach(function(x){ds.add(x.type)})}
    });
    var lg=Array.from(ls).sort();
    var sl=0;Object.keys(data.r).forEach(function(k){var mId=k.replace('m_','');var m=data.m[k]||data.m[mId];if(!m||m.matchStatus<2)return;sl+=normalizeRecs(data.r[k]).filter(function(x){return x.result===null}).length});
    return res.json({code:1,data:{matchCount:ms.size,leagueCount:ls.size,directionCount:ds.size,leagues:lg,staleCount:sl}})
  }
  if(a==='filter-leagues'){
    var ls=new Set();
    Object.keys(data.m).forEach(function(k){var m=data.m[k];if(m&&m.leagueName)ls.add(m.leagueName)});
    return res.json({code:1,data:Array.from(ls).sort()})
  }
  if(a==='hit-rate-filter'){
    var league=d.league||'',tr=d.timeRange||'all',dt=d.directionType||'',dir=d.direction||'',rt=parseInt(d.rankTop)||0,rankType=d.rankType||'全部',cutoff=null;
    if(tr!=='all'){var cd=new Date(Date.now()-parseInt(tr)*86400000);cutoff=cd.getFullYear()+'-'+String(cd.getMonth()+1).padStart(2,'0')+'-'+String(cd.getDate()).padStart(2,'0')}
    // 方向分类：兼容 "总进球-" 前缀和 "、" 分隔符
    function ct(t){if(!t)return'other';t=String(t);if(t=='胜'||t=='平'||t=='负')return'胜平负';if(t[0]=='让')return'让球';if(t=='胜胜'||t=='负负'||t.slice(0,4)=='半全场-')return'半全场';if(t.slice(0,4)=='总进球-')return'进球数';if(/^[\d,\u3001]+$/.test(t))return'进球数';if(/[平胜负让球]/.test(t)&&(t.indexOf(',')>=0||t.indexOf('\u3001')>=0))return'双选';return'other'}
    function gd(dt){var m={};m['胜平负']=['胜','平','负'];m['让球']=['让胜','让平','让负'];m['进球数']=['总进球-1、2球','总进球-2、3球','总进球-3、4球','总进球-1、2、3球','总进球-2、3、4球','总进球-3、4、5球'];m['双选']=['平、让平','让胜、让平','让平、让负','胜、平','平、负'];m['半全场']=['半全场-胜胜','半全场-负负'];return m[dt]||[]}
    var td=null;if(dt&&dt!=='综合排名'){if(dir)td=[dir];else td=gd(dt)}
    // 预先计算每天全局最大值（直接遍历data.m确保覆盖所有比赛）
    var globalMaxDay={};
    Object.keys(data.m).forEach(function(rawKey){
      var mid=rawKey.replace('m_',''),match=data.m[rawKey];if(!match||!match.date)return;
      if(league&&match.leagueName!==league)return;
      if(cutoff&&match.date.slice(0,10)<cutoff)return;
      var dd=match.date.slice(0,10);if(!dd)return;
      var recs=findRecommends(mid).filter(function(x){return x.result!==null});
      if(!recs.length)return;
      var mx=0;recs.forEach(function(x){if(x.num>mx)mx=x.num});
      if(mx>(globalMaxDay[dd]||0))globalMaxDay[dd]=mx;
    });
    var MR={},detail=[];
    Object.keys(data.r).forEach(function(k){
      var mid=k.replace('m_',''),match=data.m[k]||data.m[mid];if(!match)return;
      if(league&&match.leagueName!==league)return;
      if(cutoff&&match.date&&match.date.slice(0,10)<cutoff)return;
      var r=normalizeRecs(data.r[k]).filter(function(x){return x.result!==null});
      if(!r.length)return;
      r.sort(function(a,b){return b.num-a.num});
      // 记录全局最大值（不限方向）
      var dd=match.date?match.date.slice(0,10):'';
      if(dd&&r[0].num>(globalMaxDay[dd]||0))globalMaxDay[dd]=r[0].num;
      var keep=[];
      if(td){
        // 先按方向过滤，再取该方向内的最大值
        var fr=r.filter(function(x){return td.indexOf(x.type)>=0||td.indexOf(ct(x.type))>=0});
        if(!fr.length)return;
        fr.sort(function(a,b){return b.num-a.num});
        var localMax=fr[0].num;
        fr.forEach(function(x){if(x.num===localMax)keep.push(x)});
      }else{
        keep=rt>0?r.slice(0,rt):r.slice();
      }
      if(!keep.length)return;
      MR[mid]=keep
    });
    Object.keys(MR).forEach(function(mid){
      var match=data.m['m_'+mid]||data.m[mid],recs=MR[mid];
      recs.forEach(function(x,i){detail.push({matchId:mid,num:match.num||'',homeName:match.homeName||'',visitName:match.visitName||'',leagueName:match.leagueName||'',date:match.date||'',direction:x.type,expertCount:x.num||0,result:x.result,rank:i+1})})
    });
    detail.sort(function(a,b){return a.date>b.date?-1:a.date<b.date?1:a.rank-b.rank});
    // 生成 dailyResults：从 detail 中收集实际日期
    var dateSet={};detail.forEach(function(x){if(x.date){dateSet[x.date.slice(0,10)]=true}});
    var sortedDates=Object.keys(dateSet).sort().reverse();
    // 限制展示条数：全部时间最多60天，指定时间范围则匹配
    var showDays=tr==='all'?60:(parseInt(tr)||30);
    sortedDates=sortedDates.slice(0,showDays);
    // 构建 dailyMap（存储每个matchId的该方向最大值）+ 每天全局最大值
    dailyMap={};
    sortedDates.forEach(function(ds){dailyMap[ds]={matchMax:{},matchHit:{}}});
    detail.forEach(function(x){
      if(x.date){
        var dd=x.date.slice(0,10);
        if(dailyMap[dd]){
          if(!dailyMap[dd].matchMax[x.matchId]||dailyMap[dd].matchMax[x.matchId]<x.expertCount)
            dailyMap[dd].matchMax[x.matchId]=x.expertCount;
          if(x.result===1)dailyMap[dd].matchHit[x.matchId]=1;
        }
      }
    });
    var dailyResults=[];
    var isDaily=(rankType==='每天'&&rt>0);var isPerMatch=(rankType==='每场'&&rt>0);
    var totalTc=0,totalHc=0;
    sortedDates.forEach(function(k){
      var m=dailyMap[k];
      var selected=[],tm=0,hm=0;
      if(isDaily){
        // 每天模式：该方向expertCount最高的比赛，仅当其count等于当天全局最大值时计入
        var ranked=Object.keys(m.matchMax).sort(function(a,b){return m.matchMax[b]-m.matchMax[a]});
        var gb=globalMaxDay[k]||0;
        if(td&&gb>0){
          // 有方向筛选：只取该方向值等于全局最大值的比赛
          ranked.forEach(function(mid,i){
            if(i<rt&&m.matchMax[mid]===gb)selected.push(mid);
          });
        }else{
          selected=ranked.slice(0,rt);
        }
      }else if(isPerMatch){
        selected=Object.keys(m.matchMax);
      }else{
        selected=Object.keys(m.matchMax);
      }
      selected.forEach(function(mid){tm++;if(m.matchHit[mid])hm++});
      totalTc+=tm;totalHc+=hm;
      dailyResults.push({date:k.replace(/-/g,'/'),totalMatch:tm,hitMatch:hm,hitRate:tm>0?Math.round(hm/tm*1000)/10:0});
    });
    // 筛选结果统计 = dailyResults 汇总，确保与详情一致
    var hc=totalHc,tc=totalTc,hr=tc>0?Math.round(totalHc/totalTc*1000)/10:0;
    var p=[];if(league)p.push(league);
    if(tr=='30')p.push('近30天');else if(tr=='60')p.push('近60天');else if(tr=='90')p.push('近90天');
    if(dt==='综合排名')p.push('综合排名');
    if(dir&&dt)p.push(dir);else if(dt&&dt!=='综合排名')p.push(dt);
    if(rankType!=='全部'&&rt>0){var rl=['','第一名','前二名','前三名','前四名','前五名','前六名'];var rkName=rankType==='每场'?'当天所有场次':rankType;p.push(rkName+'-'+rl[rt])}
    return res.json({code:1,data:{hitCount:hc,totalCount:tc,hitRate:hr,conditionSummary:p.length?p.join(' | '):'全部条件',detailList:detail,dailyResults:dailyResults}})
  }
  // ========== AI 预测 ==========
  // 加载 AI 缓存
  var aiCache={};
  try{aiCache=JSON.parse(fs.readFileSync(path.join(__dirname,'ai_cache.json'),'utf8'))}catch(e){}
  
  if(a==='ai-predict'){
    var mid=d.matchId;if(!mid)return res.json({code:0,msg:'缺少 matchId'});
    // 如果有缓存直接返回
    if(aiCache[mid]&&aiCache[mid].content)return res.json({code:1,data:{matchId:mid,content:aiCache[mid].content,confidence:aiCache[mid].confidence||0,fromCache:true}});
    // 无缓存时异步触发生成（不阻塞响应）
    try{var ds=require('./deepseek');var m=data.m['m_'+mid]||data.m[mid];if(m){
      res.json({code:0,msg:'分析未就绪，正在后台生成中，请稍后刷新',pending:true});
      ds.generateAnalysis({matchId:mid,homeName:m.homeName||'',visitName:m.visitName||'',leagueName:m.leagueName||'',date:m.date||'',num:m.num||''}).then(function(r){
        if(r.content){aiCache[mid]={content:r.content,confidence:(r.content&&r.content.confidence)||0,updatedAt:new Date().toISOString()};fs.writeFileSync(path.join(__dirname,'ai_cache.json'),JSON.stringify(aiCache));console.log('[ai] 缓存已写入',mid)}
      }).catch(function(e){console.error('[ai] 生成失败',mid,e.message)});
      return;
    }}catch(e){}
    return res.json({code:0,msg:'分析未就绪'});
  }
  if(a==='ai-predict-status'){
    var td=new Date().toISOString().slice(0,10);
    var tm=0,fm=0;
    Object.keys(data.m).forEach(function(k){var m=data.m[k];if(m&&m.date&&m.date.slice(0,10)===td){tm++;if(m.matchStatus>=3)fm++}});
    return res.json({code:1,data:{todayDate:td,totalMatches:tm,finishedMatches:fm,unfinishedMatches:tm-fm,canShowCards:(tm-fm)>0}});
  }
  if(a==='ai-batch-generate'){
    var daemon=require('./ai_daemon');daemon.dailyBatch();
    return res.json({code:1,data:{message:'AI批量生成已启动，将在后台运行'}});
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
// 启动时加载历史500.com赔率数据
function loadOddsHistory(){
  var dir=path.join(__dirname,'odds_history');
  if(!fs.existsSync(dir)){ console.log('No odds_history directory'); return; }
  var files=fs.readdirSync(dir).filter(function(f){return f.endsWith('.json')&&f!=='batch_report.json'}).sort();
  var loaded=0;
  var loadedKeys={}; // 防止跨文件重复覆盖
  files.forEach(function(f){
    try{
      var raw=fs.readFileSync(path.join(dir,f),'utf8');
      var record=JSON.parse(raw);
      var dateStr=record.date;
      var oddsData=record.odds||{};
      Object.keys(oddsData).forEach(function(k){
        if(loadedKeys[k]) return; // 已从更早日期加载，不覆盖
        loadedKeys[k]=true;
        oddsData[k]._t=Date.now();
        odds500Cache[k]=oddsData[k];
      });
      oddsHistoryLoaded[dateStr]=true;
      if(!odds500Date) odds500Date=dateStr;
      loaded++;
    }catch(e){}
  });
  console.log('Odds history loaded:',loaded,'dates from cache');
}
loadOddsHistory();

app.listen(PORT,function(){console.log('Server:'+PORT)});

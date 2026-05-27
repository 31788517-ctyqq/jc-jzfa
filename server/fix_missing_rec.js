var env={};
try{require('fs').readFileSync(require('path').join(__dirname,'.env'),'utf8').split('\n').forEach(function(l){var p=l.trim().split('=');if(p.length===2)env[p[0]]=p[1]})}catch(e){}
var https=require('https'),fs=require('fs'),path=require('path');

function get(url,p,h){
  return new Promise(function(r,e){
    var q=p?'?'+Object.keys(p).map(function(k){return k+'='+encodeURIComponent(p[k])}).join('&'):'';
    var u=require('url').parse(url+q);
    var req=https.request({hostname:u.hostname,port:443,path:u.pathname+(u.search||''),headers:Object.assign({'Accept':'*/*','User-Agent':'Mozilla/5.0'},h||{}),rejectUnauthorized:false},function(res){var c=[];res.on('data',function(d){c.push(d)});res.on('end',function(){var t=Buffer.concat(c).toString();try{r(JSON.parse(t))}catch(ee){r({code:0,msg:t.slice(0,200)})}})});
    req.on('error',e);req.setTimeout(15000,function(){req.abort();e(new Error('timeout'))});req.end();
  });
}

async function main(){
  var login=await get('https://midou310.com/mdsj/gduser/login.do',{mobile:env.MIDOU_MOBILE,password:env.MIDOU_PASSWORD});
  if(login.code!==1){console.log('Login fail:',login.msg);process.exit(1)}
  var token=login.data.token;
  var dataFile=path.join(__dirname,'data.json');
  var d=JSON.parse(fs.readFileSync(dataFile,'utf8'));

  // 找到有 recommNum>0 但缺少推荐的比赛 (matchStatus===0)
  var missing=[];
  Object.keys(d.m).forEach(function(k){
    var m=d.m[k];
    if(!m||!m.matchId)return;
    var mid=m.matchId;
    var rk='m_'+mid;
    if(m.recommNum>0 && (!d.r[rk]||d.r[rk].length===0)) missing.push({matchId:mid,num:m.num,recommNum:m.recommNum,homeName:m.homeName});
  });

  if(missing.length===0){console.log('No missing recommends');process.exit(0)}
  console.log('Missing recommends for',missing.length,'matches:');
  missing.forEach(function(x){console.log(' ',x.matchId,x.num,x.homeName,'recommNum='+x.recommNum)});

  for(var i=0;i<missing.length;i++){
    var x=missing[i];
    console.log('Fetching',x.matchId,x.num,'...');
    try{
      var rr=await get('https://midou310.com/mdsj/score/getExpertRecommData.do',{dataId:x.matchId,type:0},{Cookie:'token='+token});
      if(rr.code===1&&rr.data&&rr.data.length){
        var recs=(rr.data||[]).filter(function(r){return r&&r.type&&r.num>0}).map(function(r){return{type:r.type,num:r.num,result:r.result!==undefined?r.result:null}});
        d.r['m_'+x.matchId]=recs;
        console.log('  OK:',recs.length,'recommends');
      } else {console.log('  No recommends from API')}
    } catch(e){console.log('  Error:',e.message)}
    await new Promise(function(r){setTimeout(r,400)});
  }

  fs.writeFileSync(dataFile,JSON.stringify(d));
  console.log('Saved to',dataFile);
}
main().catch(function(e){console.error(e.message);process.exit(1)});

var env={};
try{require('fs').readFileSync(require('path').join(__dirname,'.env'),'utf8').split('\n').forEach(function(l){var p=l.trim().split('=');if(p.length===2)env[p[0]]=p[1]})}catch(e){}
var https=require('https'),fs=require('fs'),path=require('path');

function get(url,p,h){return new Promise(function(r,e){var q=p?'?'+Object.keys(p).map(function(k){return k+'='+encodeURIComponent(p[k])}).join('&'):'';var u=require('url').parse(url+q);var req=https.request({hostname:u.hostname,port:443,path:u.pathname+(u.search||''),headers:Object.assign({Accept:'*/*','User-Agent':'Mozilla/5.0'},h||{}),rejectUnauthorized:false},function(res){var c=[];res.on('data',function(d){c.push(d)});res.on('end',function(){var t=Buffer.concat(c).toString();try{r(JSON.parse(t))}catch(ee){r({code:0,msg:t.slice(0,200)})}})});req.on('error',e);req.setTimeout(15000,function(){req.abort()});req.end()})}

(async function(){
  var login=await get('https://midou310.com/mdsj/gduser/login.do',{mobile:env.MIDOU_MOBILE,password:env.MIDOU_PASSWORD});
  if(login.code!==1){console.log('Login fail');process.exit(1)}
  var token=login.data.token;

  var matchIds=[2039847]; // 周二005 时刻准备 vs 米拉索尔
  var dataFile=path.join(__dirname,'data.json');
  var d=JSON.parse(fs.readFileSync(dataFile,'utf8'));

  for(var i=0;i<matchIds.length;i++){
    var mid=matchIds[i];
    console.log('Fetching recommends for',mid);
    var rr=await get('https://midou310.com/mdsj/score/getExpertRecommData.do',{dataId:mid,type:0},{Cookie:'token='+token});
    if(rr.code===1&&rr.data&&rr.data.length){
      var recs=rr.data.filter(function(x){return x&&x.type&&x.num>0}).map(function(x){return{type:x.type,num:x.num,result:x.result!==undefined?x.result:null}});
      d.r['m_'+mid]=recs;
      console.log('Got',recs.length,'recommends');
      recs.slice(0,5).forEach(function(r){console.log(' ',r.type,r.num)});
    }else{
      console.log('No recommends from API');
    }
  }

  fs.writeFileSync(dataFile,JSON.stringify(d));
  console.log('Saved to',dataFile);
  console.log('Done! Restart PM2 to apply.');
})();

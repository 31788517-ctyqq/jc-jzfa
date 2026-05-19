// 探测 midou310 API 返回的比赛字段（特别检查半场比分字段）
var https = require('https'),fs=require('fs'),path=require('path');
function get(url,p,h){return new Promise(function(r,e){var u=require('url').parse(url+(p?'?'+Object.keys(p).map(function(k){return k+'='+encodeURIComponent(p[k])}).join('&'):''));https.get({hostname:u.hostname,port:443,path:u.path,headers:Object.assign({'Accept':'*/*','User-Agent':'Mozilla/5.0'},h||{}),rejectUnauthorized:false},function(res){var c=[];res.on('data',function(d){c.push(d)});res.on('end',function(){var b=Buffer.concat(c),t=b.toString('utf-8');try{JSON.parse(t)}catch(ee){try{t=require('iconv-lite').decode(b,'gbk')}catch(e2){}}try{r(JSON.parse(t))}catch(ee){e(new Error(t.slice(0,200)))}})})})}

var envTxt='';
try{envTxt=fs.readFileSync(path.join(__dirname,'.env'),'utf-8')}catch(e){}
envTxt.split('\n').forEach(function(l){var p=l.trim().split('=');if(p.length===2)process.env[p[0]]=p[1]});

var MOBILE=process.env.MIDOU_MOBILE,PASSWORD=process.env.MIDOU_PASSWORD;
if(!MOBILE||!PASSWORD){console.error('Need MIDOU_MOBILE/MIDOU_PASSWORD');process.exit(1)}

async function main(){
  var r=await get('https://midou310.com/mdsj/gduser/login.do',{mobile:MOBILE,password:PASSWORD});
  if(r.code!==1)throw new Error('Login failed');
  var token=r.data.token;

  var mr=await get('https://midou310.com/mdsj/score/footballDataList.do',{time:Date.now(),order:'status desc, start_datetime asc, data_id asc'},{Cookie:'token='+token});
  if(mr.code!==1)throw new Error('Match fail');

  var matches=mr.data||[];
  console.log('Total matches:',matches.length);
  if(matches.length){
    var m0=matches[0];
    console.log('First match fields:',Object.keys(m0).join(', '));
    console.log('First match sample:',JSON.stringify(m0).slice(0,500));
  }
  // Find match with half score
  matches.forEach(function(m){
    for(var k in m){
      if(k.toLowerCase().indexOf('half')>=0||k.toLowerCase().indexOf('ht')>=0){
        console.log('HALF FIELD FOUND:',k,'=',m[k],'in match',m.homeName,'vs',m.visitName);
      }
    }
    // Also check for any field containing 'score'
    if(m.score&&m.score.indexOf(':')>0&&m.score.indexOf('-')<0){
      console.log('SCORE:',m.score,'-',m.homeName,'vs',m.visitName,'keys:',Object.keys(m).filter(function(k){return k.toLowerCase().indexOf('score')>=0||k.toLowerCase().indexOf('half')>=0}).join(','));
    }
  });
}
main().catch(function(e){console.error('Error:',e.message);process.exit(1)});

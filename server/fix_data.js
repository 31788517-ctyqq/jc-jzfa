// 修复 data_all.json: 按 matchId 去重，保留最新 date
var fs=require('fs'),path=require('path');
var src=path.join(__dirname,'data_all.json');
var dst=path.join(__dirname,'data_fixed.json');

var d=JSON.parse(fs.readFileSync(src,'utf8'));
var m=d.m,r=d.r;
var fixedM={},fixedR={};

// 去重保留最新 date
Object.keys(m).forEach(function(k){
  var match=m[k];
  var mid=match.matchId;
  if(!fixedM[k])fixedM[k]=match;
  else if(match.date>fixedM[k].date)fixedM[k]=match;
});
// Recommends: 保留
Object.keys(r).forEach(function(k){fixedR[k]=r[k]});

// 输出
var out={m:fixedM,r:fixedR};
fs.writeFileSync(dst,JSON.stringify(out));
console.log('Fixed: matches',Object.keys(fixedM).length,'recs',Object.keys(fixedR).length,'size',(fs.statSync(dst).size/1024).toFixed(0),'KB');

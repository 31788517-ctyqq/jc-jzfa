var fs=require('fs');
var d=JSON.parse(fs.readFileSync('server/data.json','utf8'));
var mm=d.m||{};

// Show data.json match numbers for 2026-05
console.log('data.json matchNums for May 2026:');
var mayNums=new Set();
Object.keys(mm).forEach(function(k){
  var m=mm[k];
  if(m&&m.date&&m.date.slice(0,10)>='2026-05-08'&&m.date.slice(0,10)<='2026-05-23'){
    mayNums.add(m.num);
  }
});
console.log(Array.from(mayNums).sort().join(', '));

// Show sporttery match numbers for same dates
console.log('\nsporttery matchNums for 2026-05:');
var sps=fs.readdirSync('server/sporttery_odds').filter(function(f){return f.endsWith('.json')});
sps.forEach(function(f){
  try{
    var sp=JSON.parse(fs.readFileSync('server/sporttery_odds/'+f,'utf8'));
    if(!sp.matchInfo)return;
    if(typeof sp.matchInfo==='string'&&sp.matchInfo.indexOf('2026-05')>=0){
      var mn=(sp.matchNum||'').trim().replace(/\s+.*$/,'').trim();
      var d=sp.matchInfo.match(/(\d{4}-\d{2}-\d{2})/);
      if(d)console.log('  '+f+': matchNum='+mn+' date='+d[1]+' score='+sp.score);
    }
  }catch(e){}
});

// Compare: check if "周五008" exists in both
console.log('\nLooking for matchNum "周五008" in data.json:');
Object.keys(mm).forEach(function(k){
  var m=mm[k];
  if(m&&m.num==='周五008')console.log('  '+m.matchId+' '+m.homeName+' vs '+m.visitName+' date='+(m.date||'').slice(0,10)+' score='+m.score);
});

var fs=require('fs');
var d=JSON.parse(fs.readFileSync('./server/data.json','utf8'));
var mm=d.m||{},rm=d.r||{};

var matches=[
  {mid:'2039580',label:'多特蒙德 vs 法兰克福'},
  {mid:'2039881',label:'町田泽维亚 vs 浦和红钻'},
];

matches.forEach(function(tc){
  console.log('=== '+tc.label+' ('+tc.mid+') ===');
  
  // mMap info
  var m=mm['m_'+tc.mid]||mm[tc.mid]||{};
  console.log('  mMap: score='+(m.score||'N/A')+' status='+(m.matchStatus||0));
  
  // rMap - check ALL entries with results
  var raw=rm['m_'+tc.mid]||rm[tc.mid]||[];
  console.log('  rMap: '+raw.length+' entries');
  
  var hasResult=false;
  raw.forEach(function(r){
    var res=r.result!==undefined?r.result:null;
    if(res===0||res===1){
      hasResult=true;
      console.log('    "'+(r.t||r.type)+'" result='+res+' num='+(r.n||r.num));
    }
  });
  if(!hasResult)console.log('    No results found (all undefined/null)');
  
  console.log();
});

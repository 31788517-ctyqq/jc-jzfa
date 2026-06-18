var fs=require('fs');
[2039580,2039881].forEach(function(mid){
  var f='server/sporttery_odds/'+mid+'.json';
  if(!fs.existsSync(f)){console.log(mid+': NOT FOUND');return;}
  var j=JSON.parse(fs.readFileSync(f,'utf8'));
  console.log(mid+':');
  console.log('  matchNum='+j.matchNum);
  console.log('  score='+j.score);
  console.log('  home='+j.home+' away='+j.away);
  var mi='';
  try{mi=typeof j.matchInfo==='string'?j.matchInfo.slice(0,80):JSON.stringify(j.matchInfo||{}).slice(0,80);}catch(e){mi='[error]';}
  console.log('  all keys: '+Object.keys(j||{}).join(','));
  console.log('  text present: '+(typeof j.text==='string'?'yes ('+j.text.slice(0,60)+')':'no'));
  if(j.tables)console.log('  tables: '+Object.keys(j.tables).length+' sections');
});

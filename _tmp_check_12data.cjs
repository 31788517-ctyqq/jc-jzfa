var fs=require('fs');
var d=JSON.parse(fs.readFileSync('./server/data.json','utf8'));
var mm=d.m||{},rm=d.r||{};

var issues=[
  // 3 pending
  {date:'2026-05-08',plan:'plan_6a'},
  {date:'2026-05-22',plan:'plan_2'},
  {date:'2026-05-22',plan:'plan_3'},
  // 8 ONLY_IN_HYDRATE
  {date:'2026-06-06',plan:'plan_6a'},
  {date:'2026-06-08',plan:'plan_a123_01'},
  {date:'2026-06-08',plan:'plan_a123_02'},
  {date:'2026-06-09',plan:'plan_a123_01'},
  {date:'2026-06-09',plan:'plan_a123_02'},
  {date:'2026-06-10',plan:'plan_a123_01'},
  {date:'2026-06-10',plan:'plan_a123_02'},
  {date:'2026-06-11',plan:'plan_a345_01'},
  // 1 ONLY_IN_GENERATE
  {date:'2026-06-11',plan:'plan_wc7'},
];

issues.forEach(function(issue){
  var ds=issue.date;
  console.log('=== '+ds+' '+issue.plan+' ===');
  
  // Check snapshots
  var snapFile='server/plan_snapshots/'+ds+'.json';
  if(fs.existsSync(snapFile)){
    var snap=JSON.parse(fs.readFileSync(snapFile,'utf8'));
    var sp=snap.plans.find(function(p){return p.name===issue.plan});
    if(sp){
      console.log('  In snapshot: YES, planName='+sp.planName);
      sp.matches.forEach(function(m){
        console.log('    matchId='+m.matchId+' dir='+m.direction);
      });
    }else{
      console.log('  In snapshot: NO');
    }
  }
  
  // Check mMap matches for this date
  var dayMatches=[];
  Object.keys(mm).forEach(function(k){
    var m=mm[k];
    if(m&&(m.date||'').slice(0,10)===ds)dayMatches.push(Object.assign({},m));
  });
  console.log('  Matches on date: '+dayMatches.length);
  dayMatches.forEach(function(m){
    // Check score and status
    var score=m.score||'N/A';
    var status=m.matchStatus||0;
    console.log('    '+m.matchId+': '+m.homeName+' vs '+m.visitName+' score='+score+' status='+status+' num='+(m.num||''));
    
    // Check rMap
    var raw=rm['m_'+m.matchId]||rm[m.matchId]||[];
    if(raw.length===0)console.log('      rMap: EMPTY!');
  });
  console.log();
});

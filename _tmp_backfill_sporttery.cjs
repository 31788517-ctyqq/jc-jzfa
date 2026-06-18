/**
 * P1: sporttery 赛果回写 data.json
 * 匹配逻辑: sporttery matchNum(清洗) → data.json m.num → 填充 score
 */
var fs=require('fs'),path=require('path');

var DATA_FILE=path.join(__dirname,'server','data.json');
var SP_DIR=path.join(__dirname,'server','sporttery_odds');

var data=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
var mMap=data.m||{};

// Build match lookup: { "2026-05-08": { "周五008": [matchObj, ...] } }
// Use array because same matchNum can appear in multiple entries for the same matchId
var matchByNum={};
Object.keys(mMap).forEach(function(k){
  if(k.indexOf('m_')!==0)return;
  var m=mMap[k];
  if(!m||!m.date||!m.num)return;
  var ds=m.date.slice(0,10);
  if(!matchByNum[ds])matchByNum[ds]={};
  if(!matchByNum[ds][m.num])matchByNum[ds][m.num]=[];
  matchByNum[ds][m.num].push(m);
});

// Deduplicate by matchId
Object.keys(matchByNum).forEach(function(ds){
  Object.keys(matchByNum[ds]).forEach(function(num){
    var arr=matchByNum[ds][num];
    var seen={};
    var deduped=[];
    arr.forEach(function(m){
      var mid=m.matchId;
      if(!seen[mid]){seen[mid]=true;deduped.push(m);}
    });
    matchByNum[ds][num]=deduped;
  });
});

console.log('Dates indexed: '+Object.keys(matchByNum).length);

// Clean matchNum: "周一001 英冠>" → "周一001"
function cleanNum(raw){return(raw||'').trim().replace(/\s+.*$/,'').trim();}

// Parse date from matchInfo: "2023/2024 常规赛 第26轮 2024-01-01 20:30"
function parseMatchInfoDate(matchInfo){
  if(!matchInfo)return null;
  if(typeof matchInfo==='string'){
    var m=matchInfo.match(/(\d{4})-(\d{2})-(\d{2})/);
    if(m)return m[1]+'-'+m[2]+'-'+m[3];
  }
  if(matchInfo.matchDate)return matchInfo.matchDate.slice(0,10);
  return null;
}

// Scan sporttery files
var spFiles=fs.readdirSync(SP_DIR).filter(function(f){return f.endsWith('.json')});
console.log('Scanning '+spFiles.length+' sporttery files...');

var filled=0,already=0,noMatch=0,noDate=0;
var filledList=[];

spFiles.forEach(function(f){
  var sp;
  try{sp=JSON.parse(fs.readFileSync(path.join(SP_DIR,f),'utf8'));}catch(e){return;}
  
  var score=sp.score||'';
  if(!score)return;
  
  var matchNum=cleanNum(sp.matchNum||'');
  if(!matchNum)return;
  
  // Try to get date from matchInfo
  var ds=null;
  if(sp.matchInfo){
    ds=parseMatchInfoDate(sp.matchInfo);
  }
  
  if(!ds){noDate++;return;}
  
  // Filter: only 2026-03-19 and later
  if(ds<'2026-03-19')return;
  
  // Find match
  var candidates=(matchByNum[ds]||{})[matchNum]||[];
  if(candidates.length===0){noMatch++;return;}
  
  // Find first candidate with missing score
  var updated=false;
  for(var ci=0;ci<candidates.length;ci++){
    var m=candidates[ci];
    if(!m.score||m.score===''){
      m.score=score;
      m.matchStatus=2; // finished
      updated=true;
      filled++;
      filledList.push({matchId:m.matchId,home:m.homeName,away:m.visitName,num:matchNum,date:ds,score:score});
      break;
    }
  }
  if(!updated)already++;
});

// Sync score to all duplicate mMap entries
filledList.forEach(function(fi){
  var mid=fi.matchId;
  Object.keys(mMap).forEach(function(k){
    var m=mMap[k];
    if(!m)return;
    if(m.matchId===mid||k.replace('m_','')===String(mid)){
      m.score=fi.score;
      m.matchStatus=m.matchStatus||2;
    }
  });
});

// Write back
data.m=mMap;
fs.writeFileSync(DATA_FILE,JSON.stringify(data),'utf8');

console.log('\nFilled:  '+filled+' matches');
console.log('Already: '+already);
console.log('NoMatch: '+noMatch+' (matchNum not found in data.json)');
console.log('NoDate:  '+noDate+' (no date in sporttery file)');

if(filled>0){
  console.log('\nSample fills:');
  filledList.slice(0,10).forEach(function(fi){
    console.log('  '+fi.date+' '+fi.num+' '+fi.home+' vs '+fi.away+' → '+fi.score);
  });
}

// Verify pending cases
console.log('\nPending cases after backfill:');
var mids=['2039580','2039881'];
mids.forEach(function(mid){
  var m=mMap['m_'+mid]||mMap[mid]||{};
  console.log('  '+mid+': score='+(m.score||'N/A')+' status='+(m.matchStatus||0));
});

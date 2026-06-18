const fs=require('fs');
function load(p){return JSON.parse(fs.readFileSync(p,'utf8'));}
function pick(r){
  return {
    ts:r.ts,
    cold:r?.cold?.openMs,
    warm:r?.warm?.openMs,
    cards:r?.cold?.cards,
    matchListMax:r?.apiSummary?.['match-list']?.maxMs,
    matchListAvg:r?.apiSummary?.['match-list']?.avgMs,
    batchMax:r?.apiSummary?.['batch-match-odds']?.maxMs,
    topDirMax:r?.apiSummary?.['match-top-directions']?.maxMs,
    slowest:r?.slowest?.slice(0,5).map(x=>`${x.action}:${x.ms}`)
  };
}
const a=pick(load('E:/JC-ZJFA/.codebuddy/scheme_slow_result_prod_run2.json'));
const b=pick(load('E:/JC-ZJFA/.codebuddy/scheme_slow_result_prod.json'));
console.log(JSON.stringify({run2:a,current:b},null,2));

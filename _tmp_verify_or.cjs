var PG=require('./server/core/plan-generator');
var tests=['总进球-1、2、3球','总进球-3、4、5球','总进球-2、3球'];
tests.forEach(function(d){
  console.log(d+':');
  for(var g=0;g<=7;g++){
    var r=PG.judgeByScore(d,g+':0',null);
    console.log('  total='+g+' -> '+(r===true?'WON':r===false?'LOST':'?'));
  }
});

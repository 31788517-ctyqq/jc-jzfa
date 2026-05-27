var h = require('https');
var d = '';
h.get('https://localhost/analysis/detail.jsp?matchId=2039934',
{headers:{'Host':'qc.100qiu.com'},rejectUnauthorized:false},
function(r){
  r.on('data',function(c){d+=c.toString()});
  r.on('end',function(){
    // Split by label and find next value
    ['平均胜赔率','平均平赔率','平均负赔率'].forEach(function(label){
      var idx = d.indexOf(label);
      if(idx > 0){
        var nearby = d.substring(idx, idx + 500);
        var vals = nearby.match(/>([\d.]+)</g);
        if(vals){
          var clean = vals.map(function(v){return v.replace(/[><]/g,'')});
          console.log(label + ':', clean.slice(0,5));
        } else {
          console.log(label + ': no values found, nearby html: ' + nearby.substring(0,200));
        }
      } else {
        console.log(label + ': not found in page');
      }
    });
  });
}).on('error',function(e){console.log('ERR:',e.message)});

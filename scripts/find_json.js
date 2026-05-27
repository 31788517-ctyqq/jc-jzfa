var h = require('https');
var d = '';
h.get('https://localhost/analysis/detail.jsp?matchId=2039934',
{headers:{'Host':'qc.100qiu.com'},rejectUnauthorized:false},
function(r){
  r.on('data',function(c){d+=c.toString()});
  r.on('end',function(){
    // Find all script sources and AJAX URLs
    var scripts = d.match(/src=["']([^"']+\.js[^"']*)["']/g);
    if(scripts) {
      console.log('JS files:', scripts.map(function(s){return s.replace(/src=["']/,'').replace(/["']/,'')}));
    }
    // Find AJAX URLs or data endpoints
    var ajax = d.match(/url\s*:\s*["']([^"']+)["']/g);
    if(ajax) console.log('AJAX urls:', ajax);
    var api = d.match(/["']\/[^"']*(award|odds|spf|data)["']/gi);
    if(api) console.log('API refs:', api);
    // Find init data or JSON
    var jsonInit = d.match(/var\s+\w+\s*=\s*\{[^}]+award[^}]+\}/gi);
    if(jsonInit) console.log('JSON init:', jsonInit.slice(0,2));
  });
}).on('error',function(e){console.log('ERR:',e.message)});

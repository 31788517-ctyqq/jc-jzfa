var h = require('https');
var d = '';
h.get('https://localhost/analysis/detail.jsp?matchId=2039934',
{headers:{'Host':'qc.100qiu.com'},rejectUnauthorized:false},
function(r){
  r.on('data',function(c){d+=c.toString()});
  r.on('end',function(){
    console.log('Page has 1.66:', d.indexOf('1.66') > -1);
    console.log('Page has 3.85:', d.indexOf('3.85') > -1);
    console.log('Page has 3.75:', d.indexOf('3.75') > -1);
    
    // Check table structure
    var tables = d.match(/content_table even[\s\S]*?\/table/g) || [];
    console.log('Even tables:', tables.length);
    
    for(var i = 0; i < Math.min(tables.length, 3); i++){
      var tp = tables[i];
      // Find all values
      var rows = tp.split('<tr');
      var vcount = 0;
      rows.slice(1).forEach(function(row){
        var vals = row.match(/>([^<]+)</g) || [];
        var txt = vals.map(function(v){return v.replace(/[><]/g,'').trim()}).filter(Boolean);
        if(txt.some(function(t){return /[\d.]+/.test(t)})){
          console.log('Table', i, 'row:', txt.slice(0,15));
          vcount++;
          if(vcount > 3) return;
        }
      });
    }
  });
}).on('error',function(e){console.log('ERR:',e.message)});

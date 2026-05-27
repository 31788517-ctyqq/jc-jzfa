var h = require('https');
var d = '';
h.get('https://localhost/analysis/detail.jsp?matchId=2039934',
{headers:{'Host':'qc.100qiu.com'},rejectUnauthorized:false},
function(r){
  r.on('data',function(c){d+=c.toString()});
  r.on('end',function(){
    // The page has content_table even sections with odds
    // Search for content_layout sections
    var parts = d.split('content_layout');
    console.log('content_layout sections:', parts.length);
    
    // Find content_table even sections which contain the odds table
    var tables = d.match(/content_table even[\s\S]*?content_layout/g);
    if(tables) {
      console.log('content_table even sections:', tables.length);
      // Show first table (should be the odds table)
      if(tables[0]) {
        // Extract values from within this table
        var vals = tables[0].match(/>([\d.]+(?:\.[\d]+)?)</g);
        if(vals) {
          var clean = vals.map(function(v){return v.replace(/[><]/g,'')});
          console.log('Table 0 values:', clean.slice(0,20));
        }
      }
    }
    
    // Also search for the odds near "平均赔率" specifically
    // The structure might be: 公司名称 -> 胜赔率 -> 平赔率 -> 负赔率
    var odds_section = d.split('平均胜赔率')[1];
    if(odds_section) {
      var near = odds_section.substring(0, 3000);
      // Search for any number patterns
      var nums = near.match(/(\d+\.\d{2})/g);
      if(nums) console.log('Near 平均胜赔率 numbers:', nums.slice(0,15));
      
      // Check if there's a table row structure
      var rows = near.split('<tr');
      rows.slice(1,5).forEach(function(row, i){
        var vals = row.match(/>([^<]+)</g) || [];
        var txt = vals.map(function(v){return v.replace(/[><]/g,'')}).filter(function(v){return v.trim()});
        console.log('Row ' + (i+1) + ':', txt.slice(0,10));
      });
    }
  });
}).on('error',function(e){console.log('ERR:',e.message)});

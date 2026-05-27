var h = require('https');
var d = '';
h.get('https://localhost/analysis/detail.jsp?matchId=2039934',
{headers:{'Host':'qc.100qiu.com'},rejectUnauthorized:false},
function(r){
  r.on('data',function(c){d+=c.toString()});
  r.on('end',function(){
    // Find ALL number patterns near 赔率
    var idx = d.indexOf('平均胜赔率');
    if(idx > 0){
      var section = d.substring(idx, idx + 5000);
      // Show raw HTML structure
      console.log('Section length:', section.length);
      console.log('Has "平均胜赔率":', section.indexOf('平均胜赔率') > -1);
      // Find all cell_value divs
      var cells = section.match(/cell_tip">([^<]+)<\/div>/g);
      if(cells) console.log('Labels:', cells.map(function(c){return c.replace(/<[^>]*>/g,'')}));
      // Find numbers in the section  
      var nums = section.match(/[\d]{1,2}\.[\d]{2}/g);
      if(nums) console.log('Numbers found:', nums.slice(0,20));
    }
    console.log('\nTotal page size:', d.length);
  });
}).on('error',function(e){console.log('ERR:',e.message)});

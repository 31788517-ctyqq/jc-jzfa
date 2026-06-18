// Try 500.com detail page for match 2039580
var https=require('https');
var mids=['2039580','2039881'];

mids.forEach(function(mid){
  var fid=''; // 500.com uses different IDs
  
  // Try live.500.com detail page
  var url='https://live.500.com/detail.php?fid='+mid;
  console.log('Fetching: '+url);
  
  https.get(url,function(res){
    var data='';
    res.on('data',function(c){data+=c;});
    res.on('end',function(){
      // Extract score
      var scoreMatch=data.match(/<span class="score"[^>]*>(\d+)\s*[-:：]\s*(\d+)\s*<\/span>/);
      var halfMatch=data.match(/半场\s*[:：]\s*(\d+)\s*[-:：]\s*(\d+)/);
      if(scoreMatch)console.log(mid+': score='+scoreMatch[1]+'-'+scoreMatch[2]);
      else console.log(mid+': no score found');
      if(halfMatch)console.log(mid+': half='+halfMatch[1]+'-'+halfMatch[2]);
      
      // Also try match title
      var titleMatch=data.match(/<title>([^<]+)<\/title>/);
      if(titleMatch)console.log('  title: '+titleMatch[1].substring(0,80));
    });
  }).on('error',function(e){console.log(mid+': error '+e.message);});
});

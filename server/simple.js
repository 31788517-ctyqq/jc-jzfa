var express=require('express'),cors=require('cors'),path=require('path'),fs=require('fs');
var app=express(),PORT=process.env.PORT||3000;
app.use(cors());app.use(express.json());
app.use('/assets/worldcup',express.static(path.join(__dirname,'../miniprogram/images/worldcup')));
app.use(express.static(path.join(__dirname,'../preview')));

var data={matches:{},recommends:{}};
try{data=JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));console.log('Loaded',Object.keys(data.matches).length,'matches')}catch(e){console.log('No data.json')}

app.get('/health',function(req,res){res.json({status:'ok',matches:Object.keys(data.matches).length})});
app.post('/api',function(req,res){
  var a=req.body.action,d=req.body.data||{};
  if(a==='match-list'){return res.json({code:1,data:Object.values(data.matches||{})})}
  if(a==='match-detail'){var m=data.matches[d.matchId],r=data.recommends[d.matchId]||[];return res.json({code:1,data:{match:m||{},recommends:r}})}
  if(a==='ranking-list'||a==='hit-rate-stats'){return res.json({code:1,data:{categories:{},ranking:[],directionStats:[],totalMatches:0}})}
  res.json({code:0,msg:'Not found'})
});
app.listen(PORT,function(){console.log('Server:'+PORT)});

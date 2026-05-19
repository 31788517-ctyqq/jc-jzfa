var express=require('express'),cors=require('cors'),path=require('path'),fs=require('fs');
var app=express(),PORT=process.env.PORT||3000;
app.use(cors());app.use(express.json());
app.use('/assets/worldcup',express.static(path.join(__dirname,'../miniprogram/images/worldcup')));
app.use(express.static(path.join(__dirname,'../preview')));

var data={m:{},r:{}};
try{
  var raw=JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));
  data.m=raw.m||raw.matches||{};
  data.r=raw.r||raw.recommends||{};
  console.log('Loaded',Object.keys(data.m).length,'matches',Object.keys(data.r).length,'recGroups')
}catch(e){console.log('No data.json:',e.message)}

app.get('/health',function(req,res){res.json({status:'ok',matches:Object.keys(data.m).length})});
app.post('/api',function(req,res){
  var a=req.body.action,d=req.body.data||{};
  if(a==='match-list'){return res.json({code:1,data:Object.values(data.m)})}
  if(a==='match-detail'){var key='m_'+(d.matchId||''),m=data.m[key]||{},r=data.r[key]||[];return res.json({code:1,data:{match:m,recommends:r}})}
  if(a==='ranking-list'||a==='hit-rate-stats'){return res.json({code:1,data:{categories:{},ranking:[],directionStats:[],totalMatches:0}})}
  res.json({code:0,msg:'Not found'})
});
app.listen(PORT,function(){console.log('Server:'+PORT)});

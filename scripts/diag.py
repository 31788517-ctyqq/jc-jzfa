import paramiko, time, io
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Add diagnostic endpoint to simple.js
sftp = paramiko.SFTPClient.from_transport(c)
f = sftp.open('/var/www/zj.100qiu.com/server/simple.js', 'r')
content = f.read().decode()
f.close()

# Add diagnostic route
if "cache-diag" not in content:
    # Insert before the final catch-all
    idx = content.rindex("res.json({code:0,msg:'Not found'})")
    new_content = content[:idx] + """
  if(a==='cache-diag'){
    var key=d.key||'周一003';
    return res.json({code:1,data:{key:key,cached:odds500Cache[key]||null,fileData:function(){
      try{var f=require('fs').readFileSync(require('path').join(__dirname,'odds_history','2026-05-18.json'),'utf8');var r=JSON.parse(f);return r.odds[key]||null}catch(e){return null}
    }()}});
  }
  """ + content[idx:]
    
    sftp2 = paramiko.SFTPClient.from_transport(c)
    try: sftp2.remove('/var/www/zj.100qiu.com/server/simple.js')
    except: pass
    sftp2.putfo(io.BytesIO(new_content.encode('utf-8')), '/var/www/zj.100qiu.com/server/simple.js')
    sftp2.close()
    
c.close()

# Restart
c2 = paramiko.Transport(('119.23.51.159', 22))
c2.connect(username='root', password='Yy@@##861018')
chan = c2.open_session()
chan.exec_command('pm2 delete jc-zjfa; sleep 2; cd /var/www/zj.100qiu.com; pm2 start server/simple.js --name jc-zjfa')
chan.shutdown_write()
time.sleep(8)
c2.close()

# Now query diagnostic endpoint
import urllib.request, json
r = json.loads(urllib.request.urlopen(
    urllib.request.Request('https://zj.100qiu.com/api',
        json.dumps({'action':'cache-diag','data':{'key':'周一003'}}).encode(),
        {'Content-Type':'application/json'}), timeout=10).read())
print("DIAG:", json.dumps(r, ensure_ascii=False, indent=2)[:500])

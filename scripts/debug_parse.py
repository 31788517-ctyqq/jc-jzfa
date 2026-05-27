import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Check if the saved HTML has odds values
chan = c.open_session()
chan.exec_command('grep -c "平均胜赔率" /tmp/odds_010.html 2>/dev/null && grep -c "平均平赔率" /tmp/odds_010.html 2>/dev/null && echo "---" && grep -oP ".{0,50}平均胜赔率.{0,200}" /tmp/odds_010.html 2>/dev/null | head -3')
chan.shutdown_write()
time.sleep(3)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print(out.decode('utf-8')[:1500])
chan.close()

# Also test Node.js HTTPS module
chan2 = c.open_session()
chan2.exec_command('cd /var/www/zj.100qiu.com && node -e "var h=require(\'https\');var d=\'\';h.get(\'https://localhost/analysis/detail.jsp?matchId=2039934\',{headers:{\'Host\':\'qc.100qiu.com\'},rejectUnauthorized:false},function(r){r.on(\'data\',function(c){d+=c.toString()});r.on(\'end\',function(){console.log(\'Size:\',d.length,\'Home:\',d.indexOf(\'平均胜赔率\')>0?\'YES\':\'NO\')})}).on(\'error\',function(e){console.log(\'ERR:\',e.message)})" 2>&1')
chan2.shutdown_write()
time.sleep(12)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\nNode HTTPS test:', out2.decode('utf-8')[:300])
chan2.close()

c.close()

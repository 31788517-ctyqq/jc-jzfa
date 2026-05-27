import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Re-download and check HTML structure
chan = c.open_session()
chan.exec_command('cd /var/www/zj.100qiu.com && node -e '
'"var h=require(\'https\');'
'var d=\'\';'
'h.get(\'https://localhost/analysis/detail.jsp?matchId=2039934\','
'{headers:{\'Host\':\'qc.100qiu.com\'},rejectUnauthorized:false},'
'function(r){r.on(\'data\',function(c){d+=c.toString()});'
'r.on(\'end\',function(){'
'var s=d.split(\"平均胜赔率\")[1]||\"\";'
'var vals=s.substring(0,400).match(/>[\\d.]+</g)||[];'
'console.log(\"First occurrence values:\",vals.slice(0,3));'
'var s2=d.split(\"平均平赔率\")[1]||\"\";'
'var vals2=s2.substring(0,400).match(/>[\\d.]+</g)||[];'
'console.log(\"Draw odds values:\",vals2.slice(0,3));'
'var s3=d.split(\"平均负赔率\")[1]||\"\";'
'var vals3=s3.substring(0,400).match(/>[\\d.]+</g)||[];'
'console.log(\"Away odds values:\",vals3.slice(0,3));'
'})}).on(\'error\',function(e){console.log(\'ERR:\',e.message)})" 2>&1')
chan.shutdown_write()
time.sleep(15)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print(out.decode('utf-8','ignore')[:800])
chan.close()

c.close()

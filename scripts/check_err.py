import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Check PM2 error logs
chan = c.open_session()
chan.exec_command('tail -20 /root/.pm2/logs/jc-zjfa-error-0.log 2>&1')
chan.shutdown_write()
time.sleep(3)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('=== Error log ===')
print(out.decode('utf-8','ignore')[:1500])
chan.close()

# Check if fetchOdds works from Node
chan2 = c.open_session()
chan2.exec_command('cd /var/www/zj.100qiu.com && node -e "var o=require(\'./server/fetch_real_odds\'); o.fetchOdds(\'2039934\').then(function(r){console.log(JSON.stringify(r))}).catch(function(e){console.log(\'ERR:\'+e.message)})" 2>&1')
chan2.shutdown_write()
time.sleep(12)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\n=== Direct fetchOdds test ===')
print(out2.decode('utf-8','ignore')[:500])
chan2.close()

c.close()

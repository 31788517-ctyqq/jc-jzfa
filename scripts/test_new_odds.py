import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Upload new module and test
sftp = paramiko.SFTPClient.from_transport(c)
import os
BASE = os.path.dirname(os.path.dirname(__file__))
sftp.put(os.path.join(BASE, 'server', 'fetch_real_odds.js'), '/var/www/zj.100qiu.com/server/fetch_real_odds.js')
sftp.close()

# Test
chan = c.open_session()
chan.exec_command('cd /var/www/zj.100qiu.com && node -e "var o=require(\'./server/fetch_real_odds\'); o.fetchOdds(\'2039934\').then(function(r){console.log(\'010:\',JSON.stringify(r))}); o.fetchOdds(\'2039935\').then(function(r){console.log(\'011:\',JSON.stringify(r))})" 2>&1')
chan.shutdown_write()
time.sleep(20)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print(out.decode('utf-8','ignore'))
chan.close()

c.close()

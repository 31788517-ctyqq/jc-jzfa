import paramiko, os, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
BASE = os.path.dirname(os.path.dirname(__file__))
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')
sftp = paramiko.SFTPClient.from_transport(c)

# Upload test script
sftp.put(os.path.join(BASE, 'scripts', 'find_json.js'), '/tmp/find_json.js')

# Also check spf.jsp for data loading
chan = c.open_session()
chan.exec_command('grep -A5 "brfAwardMap\\|awardData\\|jsonData\\|initData" /data/wwwroot/quncai_wap/lottery/jcfb/spf.jsp 2>/dev/null | head -20')
chan.shutdown_write()
time.sleep(3)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('spf.jsp data:')
print(out.decode('utf-8','ignore')[:500])
chan.close()

# Run the JSON finder
chan2 = c.open_session()
chan2.exec_command('cd /var/www/zj.100qiu.com && node /tmp/find_json.js 2>&1')
chan2.shutdown_write()
time.sleep(15)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\nJSON API search:')
print(out2.decode('utf-8','ignore')[:800])
chan2.close()

sftp.close()
c.close()

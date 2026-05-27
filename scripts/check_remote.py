import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# 1. Check if 172.18.93.197:801 is reachable
chan = c.open_session()
chan.exec_command('timeout 5 curl -s http://172.18.93.197:801/ 2>&1 | head -10 && echo "REACHABLE" || echo "UNREACHABLE"')
chan.shutdown_write()
time.sleep(8)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('172.18.93.197:801:', out.decode('utf-8')[:300])
chan.close()

# 2. Try accessing spf.action with post data
chan2 = c.open_session()
chan2.exec_command('timeout 8 curl -s -X POST "http://172.18.93.197:801/lottery/jzdg/spf.action" -H "Host: m.quncai.com" 2>&1 | head -10')
chan2.shutdown_write()
time.sleep(10)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\nspf.action POST:', out2.decode('utf-8')[:300])
chan2.close()

# 3. Check if there's a JSON API endpoint
chan3 = c.open_session()
chan3.exec_command('timeout 8 curl -s http://172.18.93.197:801/lottery/json/spf.jsp 2>&1 | head -10 && timeout 8 curl -s "http://172.18.93.197:801/lottery/jzdg/spf?type=json" 2>&1 | head -10')
chan3.shutdown_write()
time.sleep(12)
out3 = b''
while chan3.recv_ready(): out3 += chan3.recv(8192)
chan3.recv(8192)
print('\nJSON endpoints:', out3.decode('utf-8')[:300])
chan3.close()

c.close()

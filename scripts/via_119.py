import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Access 172.18.93.196:19080 from the 119 server
chan = c.open_session()
chan.exec_command('curl -s "http://172.18.93.196:19080/lottery/jcfb/spf.jsp" 2>&1 | head -30')
chan.shutdown_write()
time.sleep(8)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('[spf.jsp from 196:19080]')
print(out.decode('utf-8','ignore')[:1000])
chan.close()

# Also try the action
chan2 = c.open_session()
chan2.exec_command('timeout 8 curl -s "http://172.18.93.196:19080/lottery/jzdg/spf.action" 2>&1 | head -10')
chan2.shutdown_write()
time.sleep(10)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\n[spf.action from 196:19080]')
print(out2.decode('utf-8','ignore')[:500])
chan2.close()

c.close()

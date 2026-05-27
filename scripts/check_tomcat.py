import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')

# Check Tomcat server.xml for connector ports
chan = c.open_session()
chan.exec_command('for d in /usr/tomcat/*/conf; do echo "=== $(dirname $(dirname $d)) ==="; grep "Connector" $d/server.xml 2>/dev/null | grep -v "<!--" | head -3; done')
chan.shutdown_write()
time.sleep(3)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print(out.decode('utf-8','ignore'))
chan.close()

# Try the public Java ports
chan2 = c.open_session()
chan2.exec_command('for p in 19884 11009 11090; do echo "Port $p:"; timeout 3 curl -s "http://localhost:$p/" 2>&1 | head -3; echo; done')
chan2.shutdown_write()
time.sleep(10)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print(out2.decode('utf-8','ignore')[:800])
chan2.close()

c.close()

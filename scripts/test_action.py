import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')

# Find all Tomcat ports
chan = c.open_session()
chan.exec_command('netstat -tlnp 2>/dev/null | grep java | head -20')
chan.shutdown_write()
time.sleep(3)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('[Java ports]\n', out.decode('utf-8','ignore'))
chan.close()

# Try accessing the action via different ports
for port in ['8080','801','18080','19080','20080']:
    chan2 = c.open_session()
    chan2.exec_command(f'curl -s -o /dev/null -w "%{{http_code}}" http://localhost:{port}/lottery/jzdg/spf.action 2>&1')
    chan2.shutdown_write()
    time.sleep(2)
    out2 = b''
    while chan2.recv_ready(): out2 += chan2.recv(8192)
    chan2.recv(8192)
    print(f'localhost:{port}/lottery/jzdg/spf.action: {out2.decode().strip()}')
    chan2.close()

c.close()

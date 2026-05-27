import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# 1. Check nginx upstream definition for quncaiSever
chan = c.open_session()
chan.exec_command('grep -A10 "upstream quncaiSever" /etc/nginx/conf.d/hd.quncai.com.conf 2>/dev/null')
chan.shutdown_write()
time.sleep(2)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('quncaiSever upstream:', out.decode('utf-8')[:500])
chan.close()

# 2. Test spf.action on different ports
for port in ['18080','20080','19080']:
    chan2 = c.open_session()
    chan2.exec_command(f'curl -s -o /dev/null -w "%{{http_code}}" http://localhost:{port}/lottery/jzdg/spf.action 2>&1')
    chan2.shutdown_write()
    time.sleep(3)
    out2 = b''
    while chan2.recv_ready(): out2 += chan2.recv(8192)
    chan2.recv(8192)
    print(f'  {port}/lottery/jzdg/spf.action: {out2.decode().strip()}')
    chan2.close()

# 3. Check what's at port 18080 (business backend)
chan3 = c.open_session()
chan3.exec_command('curl -s http://localhost:18080/ 2>&1 | head -5')
chan3.shutdown_write()
time.sleep(3)
out3 = b''
while chan3.recv_ready(): out3 += chan3.recv(8192)
chan3.recv(8192)
print('\n18080 home:', out3.decode('utf-8')[:200])
chan3.close()

# 4. Check if there's a JSON API for odds
chan4 = c.open_session()
chan4.exec_command('curl -s http://localhost:18080/lottery/jzdg/spf.action 2>&1 | head -10')
chan4.shutdown_write()
time.sleep(5)
out4 = b''
while chan4.recv_ready(): out4 += chan4.recv(8192)
chan4.recv(8192)
content = out4.decode('utf-8')
print('\n18080/lottery/jzdg/spf.action:')
# Check if it's HTML or JSON
if content.startswith('{') or content.startswith('['):
    print(content[:500])
else:
    print(f'Not JSON. First 200 chars: {content[:200]}')
chan4.close()

c.close()

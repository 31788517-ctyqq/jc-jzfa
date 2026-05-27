import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')

# Try port 801 with correct Host header
chan = c.open_session()
chan.exec_command('curl -s -H "Host: m.quncai.com" "http://localhost:801/lottery/jzdg/spf.action" 2>&1 | head -20')
chan.shutdown_write()
time.sleep(5)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
result = out.decode('utf-8','ignore')
print('[spf.action with Host header]')
print(result[:800] if result else 'EMPTY')
chan.close()

# Also try without Host header
chan2 = c.open_session()
chan2.exec_command('curl -s "http://localhost:801/lottery/jzdg/spf.action" 2>&1 | head -20')
chan2.shutdown_write()
time.sleep(5)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\n[spf.action without Host]')
print(out2.decode('utf-8','ignore')[:800])
chan2.close()

# Try via nginx (port 80) with lottery path
chan3 = c.open_session()
chan3.exec_command('curl -s "http://localhost/lottery/jcfb/spf.jsp" 2>&1 | head -5 && echo "---" && wc -c /tmp/spf_page.html')
chan3.shutdown_write()
time.sleep(5)
out3 = b''
while chan3.recv_ready(): out3 += chan3.recv(8192)
chan3.recv(8192)
print('\n[via nginx port 80]')
print(out3.decode('utf-8','ignore')[:500])
chan3.close()

c.close()

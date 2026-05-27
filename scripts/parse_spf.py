import paramiko, time, io, sys, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')

# Get SPF page and extract odds
chan = c.open_session()
chan.exec_command('curl -s http://localhost/lottery/jcfb/spf.jsp 2>&1 > /tmp/spf_page.html && echo OK && wc -c /tmp/spf_page.html')
chan.shutdown_write()
time.sleep(8)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print(out.decode('utf-8','ignore'))
chan.close()

# Parse the odds
chan2 = c.open_session()
chan2.exec_command('grep -oP "br-item[^>]*>[^<]+<span>[\\d.]+</span>" /tmp/spf_page.html | head -20')
chan2.shutdown_write()
time.sleep(3)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\nSPF odds (raw):\n', out2.decode('utf-8','ignore')[:800])
chan2.close()

# Also extract all numbers (odds values)
chan3 = c.open_session()
chan3.exec_command('grep -oP "<span>[\\d.]+</span>" /tmp/spf_page.html | head -30')
chan3.shutdown_write()
time.sleep(2)
out3 = b''
while chan3.recv_ready(): out3 += chan3.recv(8192)
chan3.recv(8192)
print('\nAll span values:\n', out3.decode('utf-8','ignore')[:500])
chan3.close()

c.close()

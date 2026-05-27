import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# 1. Get a session first by visiting the main page
chan = c.open_session()
cmd = '''
COOKIE=$(curl -s -c - "http://172.18.93.196:19080/" 2>&1 | head -5)
echo "Cookie: $COOKIE"
# Now try spf.action with the cookie
curl -s -b <(echo "$COOKIE") "http://172.18.93.196:19080/lottery/jzdg/spf.action" 2>&1 | grep -oP '<span>[\d.]+</span>' | head -20
'''
chan.exec_command('curl -s -c /tmp/cookie.txt "http://172.18.93.196:19080/" > /dev/null 2>&1 && curl -s -b /tmp/cookie.txt "http://172.18.93.196:19080/lottery/jzdg/spf.action" 2>&1 | grep -oP \'<span>[\\d.]+</span>\' | head -20')
chan.shutdown_write()
time.sleep(10)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
result = out.decode('utf-8','ignore').strip()
print('[With cookie]\n', result if result else 'NO ODDS FOUND')
chan.close()

# 2. Check if there's a JSON API 
chan2 = c.open_session()
chan2.exec_command('curl -s "http://172.18.93.196:19080/lottery/jzdg/spf.action" 2>&1 | grep -oP "data-value=\"[^\"]*\"|\d+\.\d+" | head -20')
chan2.shutdown_write()
time.sleep(8)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\n[data-value attrs]\n', out2.decode('utf-8','ignore')[:500])
chan2.close()

# 3. Check if the lottery page has odds embedded
chan3 = c.open_session()
chan3.exec_command('curl -s "http://172.18.93.196:19080/lottery/jcfb/index.jsp" 2>&1 | grep -oP "\d+\.\d+" | sort -u | head -20')
chan3.shutdown_write()
time.sleep(8)
out3 = b''
while chan3.recv_ready(): out3 += chan3.recv(8192)
chan3.recv(8192)
print('\n[index.jsp numbers]\n', out3.decode('utf-8','ignore')[:500])
chan3.close()

c.close()

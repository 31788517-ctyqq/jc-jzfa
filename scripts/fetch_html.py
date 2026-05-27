import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Use HTTPS since qc.100qiu.com listens on 443
chan = c.open_session()
chan.exec_command('timeout 10 curl -s -k "https://localhost/analysis/detail.jsp?matchId=2039934" -H "Host: qc.100qiu.com" 2>&1 | wc -c')
chan.shutdown_write()
time.sleep(12)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('Size:', out.decode().strip())
chan.close()

# Parse odds from the response  
chan2 = c.open_session()
chan2.exec_command('timeout 10 curl -s -k "https://localhost/analysis/detail.jsp?matchId=2039934" -H "Host: qc.100qiu.com" 2>&1 | grep -oE "(平均[胜负平大小]+赔率|\d+\.\d+)" | head -30')
chan2.shutdown_write()
time.sleep(12)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\nOdds:', out2.decode('utf-8')[:500])
chan2.close()

c.close()

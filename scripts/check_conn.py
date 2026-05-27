import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Test HTTP connectivity
chan = c.open_session()
chan.exec_command('timeout 5 curl -v http://172.18.93.197:801/ 2>&1')
chan.shutdown_write()
time.sleep(8)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('Direct:', out.decode('utf-8','ignore')[:800])
chan.close()

# Try via quncaiSever (nginx upstream)
# hd.quncai.com nginx should proxy to 172.18.93.197:801
chan2 = c.open_session()
chan2.exec_command('timeout 8 curl -s -k "https://localhost/analysis/detail.jsp?matchId=2039934" -H "Host: qc.100qiu.com" 2>&1 | grep -oP "\\d+\\.\\d+" | sort -u | head -10')
chan2.shutdown_write()
time.sleep(10)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\nqc.100qiu.com numbers:', out2.decode('utf-8','ignore')[:400])
chan2.close()

c.close()

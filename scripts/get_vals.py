import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Simple approach: get the HTML source and find odds near labels
chan = c.open_session()
chan.exec_command('timeout 10 curl -s -k "https://localhost/analysis/detail.jsp?matchId=2039934" -H "Host: qc.100qiu.com" 2>&1 > /tmp/odds_010.html && echo "OK"')
chan.shutdown_write()
time.sleep(12)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('010:', out.decode().strip())
chan.close()

# Get 011 too  
chan2 = c.open_session()
chan2.exec_command('timeout 10 curl -s -k "https://localhost/analysis/detail.jsp?matchId=2039935" -H "Host: qc.100qiu.com" 2>&1 > /tmp/odds_011.html && echo "OK"')
chan2.shutdown_write()
time.sleep(12)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('011:', out2.decode().strip())
chan2.close()

# Now use sed/grep to extract values
chan3 = c.open_session()
chan3.exec_command('for f in 010 011; do echo "=== Match 0${f} ==="; grep -oP "(?<=value\">)[\d.]+(?=<\/div>)" /tmp/odds_0${f}.html | head -20; done')
chan3.shutdown_write()
time.sleep(3)
out3 = b''
while chan3.recv_ready(): out3 += chan3.recv(8192)
chan3.recv(8192)
print('\nExtracted:')
print(out3.decode('utf-8')[:1000])
chan3.close()

c.close()

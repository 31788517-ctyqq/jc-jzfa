import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Get HTML around "平均胜赔率"
chan = c.open_session()
chan.exec_command('grep -oP ".{0,10}平均胜赔率.{0,500}" /tmp/odds_010.html 2>/dev/null | head -1')
chan.shutdown_write()
time.sleep(3)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('=== HTML around 平均胜赔率 ===')
print(out.decode('utf-8','ignore')[:800])
chan.close()

# Also check second occurrence (for away teams)
chan2 = c.open_session()
chan2.exec_command('grep -c "平均胜赔率" /tmp/odds_010.html 2>/dev/null')
chan2.shutdown_write()
time.sleep(2)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('Count of 平均胜赔率:', out2.decode().strip())
chan2.close()

c.close()

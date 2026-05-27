import paramiko, io, sys, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')
sftp = paramiko.SFTPClient.from_transport(c)

# 1. Check running Java processes
chan = c.open_session()
chan.exec_command('ps aux | grep java | grep -v grep | head -5')
chan.shutdown_write()
time.sleep(3)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('Java processes:\n', out.decode('utf-8','ignore')[:500])
chan.close()

# 2. Check Tomcat webapps
chan2 = c.open_session()
chan2.exec_command('find / -maxdepth 5 -name "server.xml" 2>/dev/null | head -3')
chan2.shutdown_write()
time.sleep(3)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\nTomcat config:\n', out2.decode('utf-8','ignore')[:500])
chan2.close()

# 3. Check the webapps that handle lottery/odds
chan3 = c.open_session()
chan3.exec_command('ls -la /data/wwwroot/ 2>/dev/null || ls -la /opt/ 2>/dev/null | head -20')
chan3.shutdown_write()
time.sleep(3)
out3 = b''
while chan3.recv_ready(): out3 += chan3.recv(8192)
chan3.recv(8192)
print('\nWebroot:\n', out3.decode('utf-8','ignore')[:500])
chan3.close()

sftp.close()
c.close()

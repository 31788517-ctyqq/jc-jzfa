import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')
sftp = paramiko.SFTPClient.from_transport(c)

# 1. Check tomcat_interface_appservice for odds JSP
chan = c.open_session()
chan.exec_command('find /usr/tomcat/tomcat_interface_appservice/webapps -name "*odds*" -o -name "*beidan*" -o -name "*spf*" 2>/dev/null | head -10')
chan.shutdown_write()
time.sleep(3)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('[odds files in tomcat]\n', out.decode('utf-8','ignore')[:500])
chan.close()

# 2. Check for current period odds via curl on the Java backend
chan2 = c.open_session()
chan2.exec_command('curl -s http://localhost/lottery/jcfb/spf.jsp 2>&1 | grep -oP "homeWinAward|guestWinAward|drawAward|[\\d]+\\.[\\d]+" | head -30')
chan2.shutdown_write()
time.sleep(5)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\n[curl spf.jsp]\n', out2.decode('utf-8','ignore')[:500])
chan2.close()

# 3. Check for data files with current period number
chan3 = c.open_session()
chan3.exec_command('ls /data/wwwpublic/lot-static/JCFootBall/ | sort -t_ -k1 -n | tail -5 && echo "===" && find /data/wwwpublic -maxdepth 1 -name "*jcfb*" -o -name "*JC*" -o -name "*football*" 2>/dev/null | head -10')
chan3.shutdown_write()
time.sleep(3)
out3 = b''
while chan3.recv_ready(): out3 += chan3.recv(8192)
chan3.recv(8192)
print('\n[Period files]\n', out3.decode('utf-8','ignore')[:500])
chan3.close()

# 4. Check Redis for odds data (with auth)
chan4 = c.open_session()
chan4.exec_command('redis-cli -a qcredismaster01 -h 172.18.93.196 KEYS "*odds*" 2>/dev/null | head -10 && redis-cli -a qcredismaster01 -h 172.18.93.196 KEYS "*award*" 2>/dev/null | head -10 && redis-cli -a qcredismaster01 -h 172.18.93.196 KEYS "*spf*" 2>/dev/null | head -10')
chan4.shutdown_write()
time.sleep(5)
out4 = b''
while chan4.recv_ready(): out4 += chan4.recv(8192)
chan4.recv(8192)
print('\n[Redis odds keys]\n', out4.decode('utf-8','ignore')[:500])
chan4.close()

c.close()

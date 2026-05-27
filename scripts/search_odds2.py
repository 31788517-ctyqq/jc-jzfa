import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')
sftp = paramiko.SFTPClient.from_transport(c)

# 1. Check nginx config for port mapping
chan = c.open_session()
chan.exec_command('grep -r "listen" /usr/local/nginx/conf/ 2>/dev/null | grep -v "^#" | head -10 && echo "===" && grep -r "proxy_pass\|upstream" /usr/local/nginx/conf/ 2>/dev/null | grep -v "^#" | head -20')
chan.shutdown_write()
time.sleep(3)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('[Nginx]\n', out.decode('utf-8','ignore')[:800])
chan.close()

# 2. Check quncai_wap lottery data files for odds
chan2 = c.open_session()
chan2.exec_command('ls /data/wwwroot/quncai_wap/lottery/jcfb/ 2>/dev/null | head -20 && echo "===" && find /data/wwwroot/quncai_wap -name "*spf*" -o -name "*award*" -o -name "*odds*" 2>/dev/null | head -20')
chan2.shutdown_write()
time.sleep(3)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\n[JCFB files]\n', out2.decode('utf-8','ignore')[:800])
chan2.close()

# 3. Check for data cache files (JSON/XML)
chan3 = c.open_session()
chan3.exec_command('find /data -maxdepth 4 -name "*.json" -o -name "*.xml" -o -name "*.js" 2>/dev/null | xargs grep -l "Award\\|homeWin\\|guestWin\\|drawAward" 2>/dev/null | head -20')
chan3.shutdown_write()
time.sleep(5)
out3 = b''
while chan3.recv_ready(): out3 += chan3.recv(8192)
chan3.recv(8192)
print('\n[Award files]\n', out3.decode('utf-8','ignore')[:800])
chan3.close()

c.close()

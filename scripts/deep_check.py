import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')
sftp = paramiko.SFTPClient.from_transport(c)

# 1. Read tomcat_wap server.xml
try:
    f = sftp.open('/usr/tomcat/tomcat_wap/conf/server.xml')
    content = f.read().decode('utf-8')
    f.close()
    for line in content.split('\n'):
        if 'Connector' in line and not line.strip().startswith('<!--'):
            print(line.strip())
except Exception as e:
    print(f'tomcat_wap server.xml error: {e}')

# 2. Check running java processes  
chan = c.open_session()
chan.exec_command('ps aux | grep "java\\|tomcat" | grep -v grep | awk \'{print $11, $12, $13, $14}\' | head -10')
chan.shutdown_write()
time.sleep(2)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('\nRunning Java:\n', out.decode('utf-8','ignore')[:500])
chan.close()

# 3. Check nginx configuration structure
chan2 = c.open_session()
chan2.exec_command('ls /etc/nginx/ && echo "===" && cat /etc/nginx/nginx.conf | head -80')
chan2.shutdown_write()
time.sleep(2)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\n[Nginx config]\n', out2.decode('utf-8','ignore')[:1500])
chan2.close()

c.close()

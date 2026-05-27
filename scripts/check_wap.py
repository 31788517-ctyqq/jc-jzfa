import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')

# Check tomcat_wap connector type
chan = c.open_session()
chan.exec_command('grep -B1 -A3 "Connector" /usr/tomcat/tomcat_wap/conf/server.xml | grep -v "^<!--"')
chan.shutdown_write()
time.sleep(2)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('[tomcat_wap connectors]\n', out.decode('utf-8','ignore')[:500])
chan.close()

# Check if tomcat_wap is running
chan2 = c.open_session()
chan2.exec_command('ps aux | grep tomcat_wap | grep -v grep')
chan2.shutdown_write()
time.sleep(2)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\n[tomcat_wap process]\n', out2.decode('utf-8','ignore')[:300])
chan2.close()

# Check nginx config for lottery routes
chan3 = c.open_session()
chan3.exec_command('grep -B2 -A5 "lottery\\|jcfb\\|jzdg" /etc/nginx/nginx.conf 2>/dev/null && echo "===" && grep -r "proxy_pass" /etc/nginx/conf.d/ 2>/dev/null | head -10')
chan3.shutdown_write()
time.sleep(2)
out3 = b''
while chan3.recv_ready(): out3 += chan3.recv(8192)
chan3.recv(8192)
print('\n[nginx lottery routes]\n', out3.decode('utf-8','ignore')[:500])
chan3.close()

c.close()

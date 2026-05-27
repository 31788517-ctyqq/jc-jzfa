import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')

# Find actual connector ports in server.xml (not comments)
chan = c.open_session()
chan.exec_command('for d in /usr/tomcat/*/conf/server.xml; do name=$(echo $d | cut -d/ -f4); echo "=== $name ==="; grep -A2 "Connector port" $d | grep -v "^<!--\\|^$\|docs" | head -5; done')
chan.shutdown_write()
time.sleep(3)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print(out.decode('utf-8','ignore')[:1500])
chan.close()

# Check nginx config for proxy_pass
chan2 = c.open_session()
chan2.exec_command('grep -r "proxy_pass\|upstream" /usr/local/nginx/conf/ 2>/dev/null | grep -v "^#" | head -30')
chan2.shutdown_write()
time.sleep(3)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\n[Nginx proxy]\n', out2.decode('utf-8','ignore')[:1000])
chan2.close()

# Check if nginx config exists
chan3 = c.open_session()
chan3.exec_command('find / -name "nginx.conf" -maxdepth 5 2>/dev/null | head -5 && echo "===" && nginx -V 2>&1 | head -3')
chan3.shutdown_write()
time.sleep(3)
out3 = b''
while chan3.recv_ready(): out3 += chan3.recv(8192)
chan3.recv(8192)
print('\n[Nginx loc]\n', out3.decode('utf-8','ignore')[:500])
chan3.close()

c.close()

import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')

# Check web.xml for Struts filter
chan = c.open_session()
chan.exec_command('grep -A2 "filter\\|servlet" /data/wwwroot/quncai_wap/WEB-INF/web.xml 2>/dev/null | head -30')
chan.shutdown_write()
time.sleep(2)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('[web.xml filters]\n', out.decode('utf-8','ignore')[:1000])
chan.close()

# Check if WEB-INF/classes exists  
chan2 = c.open_session()
chan2.exec_command('ls /data/wwwroot/quncai_wap/WEB-INF/classes/ 2>/dev/null | head -10 && echo "===" && ls /data/wwwroot/quncai_wap/WEB-INF/lib/*.jar 2>/dev/null | wc -l')
chan2.shutdown_write()
time.sleep(2)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\n[WEB-INF content]\n', out2.decode('utf-8','ignore')[:500])
chan2.close()

# Check catalina.out for deployment errors
chan3 = c.open_session()
chan3.exec_command('tail -100 /usr/tomcat/tomcat_wap/logs/catalina.out 2>/dev/null | grep -E "Deploy|Context|ERROR|SEVERE|Exception|Struts" | head -20')
chan3.shutdown_write()
time.sleep(2)
out3 = b''
while chan3.recv_ready(): out3 += chan3.recv(8192)
chan3.recv(8192)
print('\n[Deploy log]\n', out3.decode('utf-8','ignore')[:1000] or 'NO LOGS')
chan3.close()

c.close()

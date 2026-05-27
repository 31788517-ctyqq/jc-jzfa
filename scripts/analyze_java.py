import paramiko, time, io, sys, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')
sftp = paramiko.SFTPClient.from_transport(c)

# 1. 解析 struts.xml 找到 spf action 的完整配置
chan = c.open_session()
chan.exec_command('grep -B2 -A10 "singleFbMatchAction" /data/wwwroot/quncai_wap/WEB-INF/classes/wap-struts.xml 2>/dev/null')
chan.shutdown_write()
time.sleep(2)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('=== spf action config ===')
print(out.decode('utf-8')[:2000])
chan.close()

# 2. Check the Java action class for methods
chan2 = c.open_session()
chan2.exec_command('find /data/wwwroot/quncai_wap/WEB-INF/lib -name "*.jar" | xargs -I{} jar tf {} 2>/dev/null | grep -i "singleFbMatch\\|FbMatch\\|SpfData\\|Odds" | head -20')
chan2.shutdown_write()
time.sleep(5)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\n=== Java class files ===')
print(out2.decode('utf-8')[:1000])
chan2.close()

# 3. Check Spring context / action config for data service
chan3 = c.open_session()
chan3.exec_command('grep -i "spf\\|award\\|odds\\|brf" /data/wwwroot/quncai_wap/WEB-INF/classes/wap-actionServlet.xml 2>/dev/null | head -30')
chan3.shutdown_write()
time.sleep(2)
out3 = b''
while chan3.recv_ready(): out3 += chan3.recv(8192)
chan3.recv(8192)
print('\n=== action servlet config ===')
print(out3.decode('utf-8')[:2000])
chan3.close()

c.close()

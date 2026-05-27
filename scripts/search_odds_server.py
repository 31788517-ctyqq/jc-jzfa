import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')
sftp = paramiko.SFTPClient.from_transport(c)

cmds = [
    # 1. 服务器基本信息和运行的服务
    'hostname && echo "---" && uname -a && echo "---" && netstat -tlnp 2>/dev/null | grep -E ":801|:8080|:80|:3306|:6379" | head -10',
    # 2. 查找赔率相关目录
    'find / -maxdepth 4 -type d -name "*odds*" -o -name "*spf*" -o -name "*award*" -o -name "*赔率*" 2>/dev/null | head -20',
    # 3. 查找 Java/Tomcat 项目
    'find / -maxdepth 5 -name "webapps" -type d 2>/dev/null && find / -maxdepth 5 -name "struts.xml" 2>/dev/null | head -10',
    # 4. 查找数据库相关
    'ps aux | grep -E "mysql|oracle|redis|tomcat|java" | grep -v grep | head -10',
    # 5. 在项目目录中搜索赔率关键字
    'find / -maxdepth 6 -name "*.jsp" -o -name "*.xml" 2>/dev/null | xargs grep -l "Award\|spf\|赔率\|单FbMatch\|brf" 2>/dev/null | head -20',
    # 6. 检查 /data 目录结构
    'ls -la /data/ 2>/dev/null && echo "---" && ls -la /opt/ 2>/dev/null | head -10',
]

for i, cmd in enumerate(cmds):
    if i > 0: time.sleep(1)
    chan = c.open_session()
    chan.exec_command(cmd)
    chan.shutdown_write()
    time.sleep(5 if i != 5 else 10)
    out = b''
    while chan.recv_ready(): out += chan.recv(8192)
    chan.recv(8192)
    result = out.decode('utf-8','ignore').strip()
    if result:
        print(f'[{i+1}] {result[:800]}')
        print()
    chan.close()

c.close()

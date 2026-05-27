import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# 1. Check for database configs in Java projects
cmds = [
    'find /data/wwwroot/quncai_wap/WEB-INF -name "*.properties" -o -name "*.xml" | xargs grep -l "jdbc\\|3306\\|redis\\|datasource" 2>/dev/null | head -10',
    'grep -r "jdbc" /data/wwwroot/quncai_wap/WEB-INF/classes/ 2>/dev/null | grep -v ".jar" | head -10',
    'netstat -tlnp 2>/dev/null | grep -E "3306|6379"',
    'ps aux | grep mysqld | head -3',
    'ps aux | grep redis | head -3',
]

for cmd in cmds:
    chan = c.open_session()
    chan.exec_command(cmd)
    chan.shutdown_write()
    time.sleep(3)
    out = b''
    while chan.recv_ready(): out += chan.recv(8192)
    chan.recv(8192)
    result = out.decode('utf-8','ignore').strip()
    if result:
        print(f'[{cmd[:60]}]\n{result[:400]}\n')
    chan.close()

c.close()

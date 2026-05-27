import paramiko, time, io, sys, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')

# 1. Find recent odds data files
cmds = [
    'find /data/wwwpublic/lot-static -name "*2026*" -o -name "*2025*" 2>/dev/null | head -10',
    'find /data -maxdepth 4 -name "*.json" -newer /data/wwwpublic/lot-static/JCFootBall 2>/dev/null | xargs ls -lt 2>/dev/null | head -20',
    'ls -lt /data/wwwpublic/lot-static/ 2>/dev/null | head -20',
    'find /data/wwwpublic -name "*.json" -mtime -7 2>/dev/null | head -20',
    # Check Tomcat webapp for odds data
    'ls /usr/tomcat/tomcat_analysis/webapps/ROOT/ 2>/dev/null | head -10 && echo "===" && find /usr/tomcat -name "*odds*" -o -name "*award*" 2>/dev/null | head -10',
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
        print(f'[{cmd[:60]}]\n{result[:500]}\n')
    chan.close()

# 2. Check if there's a Spring action that generates odds JSON
chan2 = c.open_session()
chan2.exec_command('find /usr/tomcat/tomcat_analysis/webapps -name "*.xml" -o -name "*.properties" | xargs grep -l "award\\|spf\\|Single\\|Pass" 2>/dev/null | head -10')
chan2.shutdown_write()
time.sleep(5)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\n[Tomcat config]\n', out2.decode('utf-8','ignore')[:500])
chan2.close()

c.close()

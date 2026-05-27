import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')

# List ALL tomcat directories and their HTTP ports
chan = c.open_session()
chan.exec_command('for d in /usr/tomcat/*/conf/server.xml; do name=$(basename $(dirname $(dirname $d))); port=$(grep -oP \'Connector port=\"\\K\\d+\' $d | head -1); echo "$name: port=$port"; done')
chan.shutdown_write()
time.sleep(3)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('Tomcat HTTP ports:')
print(out.decode('utf-8','ignore'))
chan.close()

# Now try SPF action on each Tomcat port
for name_port in out.decode().strip().split('\n'):
    if ':' in name_port:
        port = name_port.split('=')[-1].strip()
        chan2 = c.open_session()
        chan2.exec_command(f'curl -s -o /dev/null -w "%{{http_code}}" http://localhost:{port}/lottery/jzdg/spf.action 2>&1')
        chan2.shutdown_write()
        time.sleep(2)
        out2 = b''
        while chan2.recv_ready(): out2 += chan2.recv(8192)
        chan2.recv(8192)
        code = out2.decode().strip()
        if code and code != '000':
            print(f'Port {port}: {code}')
        chan2.close()

c.close()

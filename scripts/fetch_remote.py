import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Try accessing the Java backend server directly
# And check if any local domain can proxy the action
tests = [
    ('Direct Java backend', 'curl -s -H "Host: m.quncai.com" http://172.18.93.197:801/lottery/jzdg/spf.action 2>&1 | head -5'),
    ('Via nginx with host', 'curl -s -H "Host: hd.quncai.com" https://localhost/lottery/jzdg/spf.action 2>&1 | head -5'),
    ('Check m.100qiu.com nginx', 'grep -A3 "location" /etc/nginx/conf.d/m.100qiu.com.conf 2>/dev/null | head -30'),
    ('Check hd.quncai nginx', 'grep -B1 -A5 "location.*/" /etc/nginx/conf.d/hd.quncai.com.conf 2>/dev/null | head -30'),
]

for label, cmd in tests:
    chan = c.open_session()
    chan.exec_command(cmd)
    chan.shutdown_write()
    time.sleep(5)
    out = b''
    while chan.recv_ready(): out += chan.recv(8192)
    chan.recv(8192)
    print(f'\n=== {label} ===')
    print(out.decode('utf-8','ignore')[:500])
    chan.close()

c.close()

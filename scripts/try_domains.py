import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Try accessing the spf action through various domains
# The Java action uses brfAwardMap which has the odds data
tests = [
    ('hd.quncai.com spf', 'timeout 10 curl -s -k "https://localhost/lottery/jzdg/spf.jsp?race=2039934" -H "Host: hd.quncai.com" 2>&1 | head -20'),
    ('hd.quncai.com action', 'timeout 10 curl -s -k "https://localhost/lottery/jzdg/spf.action?race=2039934" -H "Host: hd.quncai.com" 2>&1 | head -20'),
    ('Direct 197:801', 'timeout 8 curl -s "http://172.18.93.197:801/lottery/jcfb/spf.jsp" 2>&1 | head -20'),
    ('check qc nginx', 'grep -B1 -A10 "location.*lottery\|location.*spf" /etc/nginx/conf.d/qc.100qiu.com.conf 2>/dev/null | head -20'),
]

for label, cmd in tests:
    chan = c.open_session()
    chan.exec_command(cmd)
    chan.shutdown_write()
    time.sleep(12)
    out = b''
    while chan.recv_ready(): out += chan.recv(8192)
    chan.recv(8192)
    print(f'\n=== {label} ===')
    print(out.decode('utf-8','ignore')[:600])
    chan.close()

c.close()

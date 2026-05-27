import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('172.18.93.196', 22))
c.connect(username='root', password='Yy@@##861018', timeout=15)

# Basic info
chan = c.open_session()
chan.exec_command('hostname && echo "===" && netstat -tlnp 2>/dev/null | grep -E ":19080|:801|:19884" | head -5')
chan.shutdown_write()
time.sleep(3)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
result = out.decode('utf-8','ignore').strip()
print('[172.18.93.196]\n', result[:500])
chan.close()

# Check if SPF action works on 19080
if result:
    import urllib.request
    try:
        req = urllib.request.Request('http://172.18.93.196:19080/lottery/jcfb/spf.jsp')
        resp = urllib.request.urlopen(req, timeout=8)
        html = resp.read().decode()
        print(f'\nspf.jsp size: {len(html)}')
        # Extract odds
        import re
        odds = re.findall(r'<span>([\d.]+)</span>', html)
        print(f'Odds values: {odds[:20]}')
    except Exception as e:
        print(f'\nHTTP error: {e}')

c.close()

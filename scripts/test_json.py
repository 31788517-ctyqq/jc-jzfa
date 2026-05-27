import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Try different ways to get JSON from the Java action
# The action is at /lottery/jzdg/spf.action with singleFbMatchAction.spf()

tests = [
    # Direct action access
    '/lottery/jzdg/spf.action',
    # Try with Ajax headers
    '-H "X-Requested-With:XMLHttpRequest" /lottery/jzdg/spf.action',
    # Try with different accept header
    '-H "Accept:application/json" /lottery/jzdg/spf.action',
    # Check the index action for data loading pattern
    '/lottery/jzdg/index.jsp',
    # Check if there's an API that returns odds per match
    '/lottery/jcfb/spf.jsp',
]

for test in tests:
    chan = c.open_session()
    if test.startswith('-H'):
        parts = test.split(' ',2)
        headers = parts[0] + ' ' + parts[1]
        url = parts[2]
        cmd = f'curl -s {headers} -o /tmp/odds_test.txt -w "%{{http_code}} %{{size_download}}" http://localhost:19080{url} 2>&1'
    else:
        cmd = f'curl -s -o /tmp/odds_test.txt -w "%{{http_code}} %{{size_download}}" http://localhost:19080{test} 2>&1'
    
    chan.exec_command(cmd)
    chan.shutdown_write()
    time.sleep(5)
    out = b''
    while chan.recv_ready(): out += chan.recv(8192)
    chan.recv(8192)
    result = out.decode('utf-8').strip()
    print(f'{test}: {result}')
    chan.close()

# Check if we got JSON content
chan2 = c.open_session()
chan2.exec_command('file /tmp/odds_test.txt 2>/dev/null; echo "---"; head -5 /tmp/odds_test.txt 2>/dev/null')
chan2.shutdown_write()
time.sleep(2)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\nLast response content:')
print(out2.decode('utf-8')[:500])
chan2.close()

c.close()

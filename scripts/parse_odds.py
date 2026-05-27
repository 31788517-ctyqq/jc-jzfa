import paramiko, time, io, sys, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Use qc.100qiu.com local proxy to get analysis page
chan = c.open_session()
cmd = 'curl -s -k -H "Host: qc.100qiu.com" "http://127.0.0.1/analysis/detail.jsp?matchId=2039934" 2>&1'
chan.exec_command(cmd + '| wc -c')
chan.shutdown_write()
time.sleep(8)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('Page size:', out.decode().strip())
chan.close()

# Now fetch and parse
chan2 = c.open_session()
chan2.exec_command(cmd + '| grep -oP "(?<=content_cell value\\">)[\\d.]+(?=<)" | head -20')
chan2.shutdown_write()
time.sleep(8)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('Odds values:', out2.decode().strip())

chan2.close()
c.close()

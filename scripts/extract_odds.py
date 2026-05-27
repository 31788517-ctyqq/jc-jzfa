import paramiko, time, io, sys, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# Get the HTML and extract odds values near "赔率" labels
chan = c.open_session()
chan.exec_command('timeout 10 curl -s -k "https://localhost/analysis/detail.jsp?matchId=2039934" -H "Host: qc.100qiu.com" 2>&1 > /tmp/odds_page.html && echo OK')
chan.shutdown_write()
time.sleep(12)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('Download:', out.decode().strip())
chan.close()

# Extract odds using Python regex on the server
chan2 = c.open_session()
chan2.exec_command("python3 -c "
'import re; '
'html=open("/tmp/odds_page.html").read(); '
"# Find segments around 赔率 with their values; "
'segments=re.split(r"(平均[胜负平大小]+赔率)", html); '
'for i in range(1,len(segments),2): '
'  label=segments[i]; '
'  next_part=segments[i+1][:200]; '
'  vals=re.findall(r">([\d.]+)<", next_part); '
'  print(f"{label}: {vals[:3]}")'
)
chan2.shutdown_write()
time.sleep(3)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\nExtracted values:')
print(out2.decode('utf-8')[:1000])
chan2.close()

c.close()

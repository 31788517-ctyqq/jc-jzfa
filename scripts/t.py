import paramiko, time
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')
chan = c.open_session()
chan.exec_command("curl -s -X POST http://localhost:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"plan-list\",\"data\":{\"date\":\"2026-05-19\"}}' 2>&1 | python3 -c \"import sys,json;r=json.load(sys.stdin);p=r['data']['plans'][0];m1=p['matches'][0];print(m1['matchNum'],m1['direction']);print('odds:',json.dumps(m1['odds'],ensure_ascii=False)[:300])\"")
chan.shutdown_write()
time.sleep(10)
out = b''
while chan.recv_ready(): out += chan.recv(65536)
print(out.decode('utf-8', errors='replace'))
c.close()

import paramiko, time, io, sys, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('120.78.211.52', 22))
c.connect(username='root', password='Yy@@##861018')
sftp = paramiko.SFTPClient.from_transport(c)

# 1. List the JCFootBall directory
chan = c.open_session()
chan.exec_command('ls -la /data/wwwpublic/lot-static/JCFootBall/ 2>/dev/null | head -30')
chan.shutdown_write()
time.sleep(2)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('[JCFootBall files]\n', out.decode('utf-8','ignore')[:1000])
chan.close()

# 2. Check 37_SINGLE.json content 
try:
    f = sftp.open('/data/wwwpublic/lot-static/JCFootBall/37_SINGLE.json')
    raw = f.read(10000).decode('utf-8')
    f.close()
    data = json.loads(raw)
    if isinstance(data, list):
        print(f'\n37_SINGLE: {len(data)} items')
        # Show first few items
        for item in data[:3]:
            print(json.dumps(item, ensure_ascii=False, indent=2)[:500])
    elif isinstance(data, dict):
        print(f'\n37_SINGLE keys:', list(data.keys())[:10])
        for k, v in list(data.items())[:2]:
            print(f'  {k}:', json.dumps(v, ensure_ascii=False)[:200])
except Exception as e:
    print(f'\n37_SINGLE error: {e}')

# 3. Check 37_PASS.json
try:
    f2 = sftp.open('/data/wwwpublic/lot-static/JCFootBall/37_PASS.json')
    raw2 = f2.read(5000).decode('utf-8')
    f2.close()
    data2 = json.loads(raw2)
    if isinstance(data2, list):
        print(f'\n37_PASS: {len(data2)} items')
        for item in data2[:1]:
            print(json.dumps(item, ensure_ascii=False, indent=2)[:500])
except Exception as e:
    print(f'\n37_PASS error: {e}')

c.close()

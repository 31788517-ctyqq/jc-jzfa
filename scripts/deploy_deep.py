import paramiko, os, time, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
BASE = os.path.dirname(os.path.dirname(__file__))
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')
sftp = paramiko.SFTPClient.from_transport(c)
sftp.put(os.path.join(BASE, 'scripts', 'deep2.js'), '/tmp/deep2.js')
sftp.close()

chan = c.open_session()
chan.exec_command('cd /var/www/zj.100qiu.com && node /tmp/deep2.js 2>&1')
chan.shutdown_write()
time.sleep(15)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print(out.decode('utf-8','ignore'))
chan.close()
c.close()

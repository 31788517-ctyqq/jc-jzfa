import paramiko, time, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
c = paramiko.Transport(('119.23.51.159', 22))
c.connect(username='root', password='Yy@@##861018')

# 1. Check Redis keys for odds/award/spf data
chan = c.open_session()
chan.exec_command('redis-cli KEYS "*odds*" 2>/dev/null && redis-cli KEYS "*award*" 2>/dev/null && redis-cli KEYS "*spf*" 2>/dev/null && redis-cli KEYS "*brf*" 2>/dev/null | head -20')
chan.shutdown_write()
time.sleep(3)
out = b''
while chan.recv_ready(): out += chan.recv(8192)
chan.recv(8192)
print('Redis odds keys:', out.decode('utf-8','ignore')[:500])
chan.close()

# 2. Check MySQL databases for odds
chan2 = c.open_session()
chan2.exec_command('mysql -N -e "SHOW DATABASES" 2>/dev/null | head -20')
chan2.shutdown_write()
time.sleep(2)
out2 = b''
while chan2.recv_ready(): out2 += chan2.recv(8192)
chan2.recv(8192)
print('\nMySQL databases:', out2.decode('utf-8','ignore')[:500])
chan2.close()

# 3. Check Redis config
chan3 = c.open_session()
chan3.exec_command('cat /data/wwwroot/quncai_wap/WEB-INF/classes/redis.properties 2>/dev/null | head -20')
chan3.shutdown_write()
time.sleep(2)
out3 = b''
while chan3.recv_ready(): out3 += chan3.recv(8192)
chan3.recv(8192)
print('\nRedis config:', out3.decode('utf-8','ignore')[:300])
chan3.close()

c.close()

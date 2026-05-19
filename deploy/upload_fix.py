import paramiko, io
s=paramiko.SSHClient();s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect('119.23.51.159',22,'root','znm19811225@',timeout=10,look_for_keys=False,allow_agent=False)
ftp=s.open_sftp()

# Upload clean files
ftp.put('E:/JC-ZJFA/server/index.js','/var/www/zj.100qiu.com/server/index.js')
ftp.put('E:/JC-ZJFA/server/logger.js','/var/www/zj.100qiu.com/server/logger.js')
ftp.close()

# Restart
_,o,_=s.exec_command('pm2 restart jc-zjfa 2>&1',timeout=20)
print(o.read().decode(errors='replace')[:200])
s.close()

import paramiko, io, sys, os

HOST = "119.23.51.159"
USER = "root"
PASS = "znm19811225@"
LOCAL = "E:/JC-ZJFA/server/data.json"
REMOTE = "/var/www/zj.100qiu.com/server/data.json"

log = open("E:/JC-ZJFA/deploy/up2.log", "w")
log.write(f"Source: {LOCAL}\n")
log.write(f"Size: {os.path.getsize(LOCAL)/1024:.0f}KB\n")

try:
    s = paramiko.SSHClient()
    s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    s.connect(HOST, 22, USER, PASS, timeout=15, look_for_keys=False, allow_agent=False)
    log.write("Connected\n")
    
    ftp = s.open_sftp()
    with open(LOCAL, 'rb') as f:
        ftp.putfo(f, REMOTE)
    log.write("Uploaded\n")
    ftp.close()
    
    # Verify
    _, o, e = s.exec_command(f"ls -l {REMOTE} 2>&1 && pm2 restart jc-zjfa 2>&1", timeout=30)
    ec = o.channel.recv_exit_status()
    log.write(o.read().decode(errors='replace'))
    log.write(e.read().decode(errors='replace'))
    
    s.close()
    log.write("\nSUCCESS\n")
except Exception as ex:
    log.write(f"ERROR: {ex}\n")

log.close()
print("OK - check up2.log")

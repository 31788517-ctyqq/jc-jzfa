import paramiko, time, re
HOST="119.23.51.159"; USER="root"; PASS="znm19811225@"
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,22,USER,PASS,timeout=10,look_for_keys=False,allow_agent=False)

def run(cmd, t=15):
    _,o,e=ssh.exec_command(cmd,timeout=t)
    rc=o.channel.recv_exit_status()
    out=o.read().decode(errors='replace'); err=e.read().decode(errors='replace')
    return rc,out,err

# Full error log
rc,o,e=run("cat /root/.pm2/logs/jc-zjfa-error.log 2>&1 | tail -30")
clean=re.sub(r'[^\x00-\x7F]+','.',o)
print("[1] Error log:")
print(clean[:1000])

# Try running directly
rc,o,e=run("cd /var/www/zj.100qiu.com/server && node -e \"try{require('./index')}catch(e){console.log(e.message)}\" 2>&1")
print("\n[2] Direct run:", o.strip()[:500])

# Check Node modules
rc,o,e=run("ls /var/www/zj.100qiu.com/server/node_modules/express/package.json 2>&1 && echo 'express OK' || echo 'express MISSING'")
print("\n[3] Express:", o.strip())

rc,o,e=run("ls /var/www/zj.100qiu.com/server/node_modules/better-sqlite3/ 2>&1 | head -5")
print("[4] SQLite3:", o.strip())

ssh.close()

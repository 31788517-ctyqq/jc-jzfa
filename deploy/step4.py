import paramiko, time, sys
HOST="119.23.51.159"; USER="root"; PASS="znm19811225@"
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,22,USER,PASS,timeout=10,look_for_keys=False,allow_agent=False)

def run(cmd, t=60):
    _,o,e=ssh.exec_command(cmd,timeout=t)
    rc=o.channel.recv_exit_status()
    return rc,o.read().decode(errors='replace'),e.read().decode(errors='replace')

# Fix npm registry
print("[1] Fix npm registry...")
rc,o,e=run("npm config set registry https://registry.npmmirror.com && npm config get registry")
print(o)

# Install
print("[2] npm install...")
chan=ssh.get_transport().open_session()
chan.exec_command("cd /var/www/zj.100qiu.com/server && npm install --production 2>&1")
while True:
    if chan.recv_ready(): sys.stdout.write(chan.recv(65536).decode(errors='replace')); sys.stdout.flush()
    if chan.recv_stderr_ready(): sys.stdout.write(chan.recv_stderr(65536).decode(errors='replace')); sys.stdout.flush()
    if chan.exit_status_ready(): break
    time.sleep(0.3)
print(f"\nnpm rc={chan.recv_exit_status()}")

# Start PM2
print("[3] PM2 start...")
rc,o,e=run("cd /var/www/zj.100qiu.com && pm2 delete jc-zjfa 2>/dev/null; pm2 start server/index.js --name jc-zjfa && pm2 save 2>&1")
print(o[:500])
if e: print("ERR:", e[:200])

# Show status
print("\n[4] Status...")
rc,o,e=run("pm2 status 2>&1; echo '---'; curl -s http://localhost:3000/health 2>&1; echo '---'; ls /var/www/zj.100qiu.com/server/node_modules/ | head -5")
print(o)

ssh.close()
print("\nDone! Visit http://zj.100qiu.com")

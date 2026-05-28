import paramiko, time, sys, os
HOST = os.environ.get('DEPLOY_SSH_HOST', '119.23.51.159')
USER = os.environ.get('DEPLOY_SSH_USER', 'root')
PASS = os.environ.get('DEPLOY_SSH_PASS')
if not PASS:
    env_deploy = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env.deploy')
    if os.path.exists(env_deploy):
        with open(env_deploy, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('DEPLOY_SSH_PASS='):
                    PASS = line.split('=', 1)[1].strip().strip('"').strip("'")
                    break
if not PASS:
    print('Error: DEPLOY_SSH_PASS not set. Use env var or .env.deploy file.')
    sys.exit(1)

ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,22,USER,PASS,timeout=10,look_for_keys=False,allow_agent=False)

def run(cmd, t=60):
    _,o,e=ssh.exec_command(cmd,timeout=t)
    rc=o.channel.recv_exit_status()
    return rc,o.read().decode(),e.read().decode()

# Download and unzip
print("[1] Download...")
rc,o,e=run("cd /tmp && curl -sL -o jc.zip https://codeload.github.com/31788517-ctyqq/jc-jzfa/zip/refs/heads/master && unzip -o jc.zip && ls -d jc-jzfa-* jc-zjfa-* 31788517* 2>/dev/null")
print(o)

# Find the extracted dir
rc,o,e=run("cd /tmp && ls -d */ | grep -i jc 2>/dev/null || echo NOT_FOUND")
print("Found dir:", o.strip())

if "NOT_FOUND" not in o:
    dirname = o.strip().replace("/","")
    print(f"Dir: {dirname}")
    
    # Move to target
    rc,o,e=run(f"rm -rf /var/www/zj.100qiu.com && mv /tmp/{dirname} /var/www/zj.100qiu.com && ls /var/www/zj.100qiu.com/server/")
    print(f"Move rc={rc}")
    print(o)
    
    # Config
    print("[2] Config...")
    MIDOU_MOBILE = os.environ.get('MIDOU_MOBILE', '')
    MIDOU_PASSWORD = os.environ.get('MIDOU_PASSWORD', '')
    if not MIDOU_MOBILE or not MIDOU_PASSWORD:
        print("Warning: MIDOU_MOBILE/MIDOU_PASSWORD env vars not set, .env will be incomplete")
    rc,o,e=run(f"cat > /var/www/zj.100qiu.com/server/.env << 'ENVEOF'\nPORT=3000\nMIDOU_MOBILE={MIDOU_MOBILE}\nMIDOU_PASSWORD={MIDOU_PASSWORD}\nNODE_ENV=production\nENVEOF\necho DONE")
    print(o)
    
    # Install
    print("[3] Install...")
    chan=ssh.get_transport().open_session()
    chan.exec_command("cd /var/www/zj.100qiu.com/server && npm install --production 2>&1")
    while True:
        if chan.recv_ready(): sys.stdout.write(chan.recv(65536).decode()); sys.stdout.flush()
        if chan.recv_stderr_ready(): sys.stdout.write(chan.recv_stderr(65536).decode()); sys.stdout.flush()
        if chan.exit_status_ready(): break
        time.sleep(0.3)
    print(f"\nnpm rc={chan.recv_exit_status()}")
    
    # Nginx
    print("[4] Nginx...")
    rc,o,e=run("""cat > /etc/nginx/conf.d/zj.100qiu.com.conf << 'NGX'
server {
    listen 80;
    server_name zj.100qiu.com;
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/javascript application/json image/svg+xml;
    location /assets/ { alias /var/www/zj.100qiu.com/miniprogram/images/; expires 30d; }
    location /api { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; }
    location /health { proxy_pass http://127.0.0.1:3000; }
    location / { root /var/www/zj.100qiu.com/preview; try_files $uri /index.html; }
}
NGX
nginx -t && nginx -s reload && echo NGINX_OK""")
    print(o)
    
    # PM2
    print("[5] PM2...")
    rc,o,e=run("cd /var/www/zj.100qiu.com && pm2 delete jc-zjfa 2>/dev/null; BEHIND_PROXY=1 pm2 start server/index.js --name jc-zjfa && pm2 save && echo PM2_OK")
    print(o)
    
    print("\n[DONE] http://zj.100qiu.com")
else:
    print("FAIL: zip not extracted")
    
ssh.close()

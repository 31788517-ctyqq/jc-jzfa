import paramiko

HOST = "119.23.51.159"
USER = "root"
PASS = "znm19811225@"

def run(cmd, timeout=30):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    return exit_code, out, err

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASS, timeout=10, look_for_keys=False, allow_agent=False)

checks = [
    ("系统", "uname -a"),
    ("内存", "free -h | head -2"),
    ("磁盘", "df -h / | tail -1"),
    ("Node", "node -v 2>&1"),
    ("NPM", "npm -v 2>&1"),
    ("Nginx", "nginx -v 2>&1"),
    ("PM2", "pm2 -v 2>&1 || echo 'NOT_INSTALLED'"),
    ("Git", "git --version 2>&1 || echo 'NOT_INSTALLED'"),
    ("Curl", "curl --version 2>&1 | head -1"),
    ("端口3000", "ss -tlnp | grep -E ':3000|:80|:443' || echo '无'"),
    ("现有站点", "ls /etc/nginx/conf.d/ 2>/dev/null || echo 'conf.d空'"),
    ("项目目录", "ls /var/www/ 2>/dev/null || echo 'www空'"),
    ("SSH配置", "grep -i passwordauth /etc/ssh/sshd_config 2>/dev/null || echo '未找到'"),
]

for name, cmd in checks:
    ec, out, err = run(cmd)
    status = f"[{ec}] " if ec else "[+] "
    print(f"{status}{name}: {out}")
    if err: print(f"  err: {err}")

ssh.close()

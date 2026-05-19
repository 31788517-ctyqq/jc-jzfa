import paramiko, time

HOST = "119.23.51.159"
USER = "root"
PASS = "znm19811225@"
CMD = "curl -sL -o /root/deploy2.sh https://raw.githubusercontent.com/31788517-ctyqq/jc-jzfa/master/deploy/deploy2.sh && chmod +x /root/deploy2.sh && bash /root/deploy2.sh"

print("[*] 连接服务器...")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASS, timeout=10, look_for_keys=False, allow_agent=False)
print("[+] 已连接")

print("[*] 开始部署（约2-5分钟）...")
chan = ssh.get_transport().open_session()
chan.exec_command(CMD)

while True:
    if chan.recv_ready():
        data = chan.recv(65536)
        print(data.decode(), end="", flush=True)
    if chan.recv_stderr_ready():
        data = chan.recv_stderr(65536)
        print(data.decode(), end="", flush=True)
    if chan.exit_status_ready():
        break
    time.sleep(0.5)

rc = chan.recv_exit_status()
print(f"\n[*] 退出码: {rc}")
print("[OK] http://zj.100qiu.com" if rc == 0 else "[FAIL]")
chan.close()
ssh.close()

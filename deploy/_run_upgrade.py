"""Node.js v16 升级部署（SSH 密钥认证 + 辅助源码编译）"""
import subprocess, time, os

SSH_KEY = os.path.expanduser("~\.ssh\id_rsa_jczjfa")
SSH = f'ssh -i "{SSH_KEY}" -o StrictHostKeyChecking=no -o HostKeyAlgorithms=ssh-rsa,ssh-dss -o PubkeyAcceptedKeyTypes=ssh-rsa root@119.23.51.159'
SCP = f'scp -i "{SSH_KEY}" -o StrictHostKeyChecking=no -o HostKeyAlgorithms=ssh-rsa,ssh-dss -o PubkeyAcceptedKeyTypes=ssh-rsa'

def run(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60)
    return result.stdout.strip()

# 1. Stop old process & clean up old build
print("[1/4] 停止旧进程，清理编译残渣...")
run(f'{SSH} "pkill -f upgrade_node16.sh 2>/dev/null || true; rm -rf /usr/local/src/node-v16.20.2 /usr/include/sys/auxv.h 2>/dev/null; echo cleaned"')
time.sleep(1)

# 2. Upload script
print("[2/4] 上传升级脚本...")
run(f'{SCP} deploy/upgrade_node16.sh root@119.23.51.159:/root/upgrade_node16.sh')
run(f'{SSH} "chmod +x /root/upgrade_node16.sh"')
print("  已上传")

# 3. Execute in background
print("[3/4] 启动后台升级...")
out = run(f'{SSH} "nohup bash /root/upgrade_node16.sh > /tmp/upgrade_output.log 2>&1 & echo PID=\$!"')
print(f"  {out}")

# 4. Show progress after a moment
print("[4/4] 等待 10 秒后查看进度...")
time.sleep(10)
out = run(f'{SSH} "tail -30 /tmp/upgrade_output.log"')
for line in out.split('\n'):
    if line.strip():
        print(line[:200])

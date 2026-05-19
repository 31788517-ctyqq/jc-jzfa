"""竞彩推荐监控 - 远程部署脚本（通过 SSH）"""
import subprocess
import sys
import time

HOST = "119.23.51.159"
USER = "root"
PASS = "znm19811125@"
CMD = "curl -o /root/deploy.sh https://raw.githubusercontent.com/31788517-ctyqq/jc-jzfa/master/deploy/deploy.sh && bash /root/deploy.sh"

print("[*] 正在连接服务器...")

try:
    proc = subprocess.Popen(
        ["sshpass", "-p", PASS, "ssh",
         "-o", "HostKeyAlgorithms=+ssh-rsa",
         "-o", "StrictHostKeyChecking=accept-new",
         "-o", "ConnectTimeout=15",
         "-T", f"{USER}@{HOST}", CMD],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    stdout, stderr = proc.communicate(timeout=120)
    
    if stdout:
        print(stdout.decode())
    if stderr and proc.returncode != 0:
        print("[错误]", stderr.decode(), file=sys.stderr)
    
    if proc.returncode == 0:
        print("\n[✓] 部署完成！")
    else:
        print(f"\n[✗] 部署失败，返回码: {proc.returncode}")
        if stderr:
            print(stderr.decode())
            
except FileNotFoundError:
    print("[✗] 未找到 sshpass，请先安装: winget install sshpass")
    print("\n--- 替代方案：手动 SSH 登录后执行以下命令 ---")
    print(f"\nssh -o HostKeyAlgorithms=+ssh-rsa root@{HOST}")
    print(f"然后执行:")
    print(f"{CMD}")
    
except subprocess.TimeoutExpired:
    print("[✗] 连接超时，请检查网络")
    
except Exception as e:
    print(f"[✗] 异常: {e}")

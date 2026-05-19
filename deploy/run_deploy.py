import paramiko
import sys

HOST = "119.23.51.159"
USER = "root"
PASS = "znm19811225@"
CMD = "curl -s -o /root/deploy.sh https://raw.githubusercontent.com/31788517-ctyqq/jc-jzfa/master/deploy/deploy.sh && echo 'SCRIPT_OK' && bash /root/deploy.sh"

log = open("deploy_result.log", "w", encoding="utf-8")

def logline(msg):
    print(msg)
    log.write(msg + "\n")
    log.flush()

try:
    logline("[*] 连接 119.23.51.159...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASS, 
                timeout=15, look_for_keys=False, allow_agent=False)
    logline("[+] 已连接")

    logline("[*] 下载并执行部署脚本(1-3分钟)...")
    stdin, stdout, stderr = ssh.exec_command(CMD, timeout=300)
    
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode()
    err = stderr.read().decode()
    
    if out: logline(out)
    if err: logline("[ERR] " + err)
    
    logline(f"退出码: {exit_code}")
    logline("[OK] 部署完成! http://zj.100qiu.com" if exit_code == 0 else "[FAIL] 部署失败")
    ssh.close()

except Exception as e:
    logline("错误: " + str(e))

log.close()

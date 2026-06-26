#!/usr/bin/env python3
"""清除所有缓存"""
import paramiko, os

HOST = "119.23.51.159"
KEY = os.path.expanduser("~/.ssh/id_rsa_jczjfa")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username="root", key_filename=KEY, timeout=10, port=22,
            look_for_keys=False, allow_agent=False,
            disabled_algorithms={'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']})

def run(cmd, timeout=30):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

print("=== 清除缓存 ===")
run("redis-cli FLUSHDB 2>/dev/null || echo 'redis not used'")
run("rm -f /root/server/*cache*.json /root/server/api-cache* 2>/dev/null")

# 检查 home-bundle 缓存
print("\n=== 重启 jc-zjfa ===")
run("pm2 restart jc-zjfa --update-env 2>&1 | tail -3")

import time
time.sleep(12)

# 预热
run("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"home-bundle\"}' > /dev/null 2>&1")
time.sleep(3)

# 测试
print("\n=== home-bundle 今日比赛数 ===")
out = run("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"home-bundle\"}' 2>/dev/null")
# 找 todayMatches 或 今日比赛相关的数值
import re
todays = re.findall(r'"todayMatches":(\d+)|"matchCount":(\d+)|今日比赛[^0-9]*(\d+)', out)
print(f"  todayMatches/matchCount: {todays}")

# match-list
out2 = run("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"match-list\"}' 2>/dev/null")
matches = re.findall(r'"num":\s*"([^"]+)"', out2)
print(f"\n=== match-list: {len(matches)} matches ===")
for m in matches[:8]:
    print(f"  {m}")

ssh.close()

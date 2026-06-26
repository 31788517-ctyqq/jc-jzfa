#!/usr/bin/env python3
"""安装 playwright 并运行 scrape_sporttery.py --today"""
import paramiko
import os

HOST = "119.23.51.159"
USER = "root"
KEY_FILE = os.path.expanduser("~/.ssh/id_rsa_jczjfa")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, key_filename=KEY_FILE,
            timeout=10, port=22,
            look_for_keys=False, allow_agent=False,
            disabled_algorithms={'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']})

def run(cmd, timeout=120):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# Step 1: 安装 playwright
print("=== Step 1: pip3 install playwright ===\n")
out, err = run("pip3 install playwright 2>&1", timeout=120)
if out:
    lines = out.split('\n')
    for line in lines[-6:]:
        print(line.strip())
if err:
    print(f"ERR: {err[:300]}")

# Step 2: 安装 Chromium 浏览器
print("\n=== Step 2: playwright install chromium ===\n")
out, err = run("python3 -m playwright install chromium 2>&1", timeout=180)
if out:
    for line in out.split('\n'):
        print(line.strip())
if err:
    print(f"ERR: {err[:500]}")

# Step 3: 用 --dry 先预览一下
print("\n=== Step 3: --dry 预览模式 ===\n")
out, err = run("cd /root/scripts && python3 scrape_sporttery.py --dry 2>&1", timeout=30)
print(out[:2000] if out else "")
if err:
    print(f"ERR: {err[:500]}")

# Step 4: 用 --today 抓今天的数据
if "playwright" not in (err or ""):
    print("\n=== Step 4: --today 抓取今日数据 ===\n")
    out, err = run("cd /root/scripts && python3 scrape_sporttery.py --today 2>&1", timeout=300)
    print(out[:3000] if out else "")
    if err:
        print(f"ERR: {err[:1000]}")

ssh.close()

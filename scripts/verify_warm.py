#!/usr/bin/env python3
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

# Check scheduler logs for warmup
print("=== scheduler warmup 日志 ===")
out = run("grep -i 'warm' /root/.pm2/logs/jc-scheduler-out.log 2>/dev/null | tail -10")
if out:
    for line in out.split('\n'):
        print(f"  {line.strip()[-120:]}")
else:
    print("  (无 warmup 日志)")

# Test warmup via scheduler (not curl)
print("\n=== 验证 scheduler warmup 可用 ===")
out = run("grep -A3 'warm_api_cache' /root/server/index.js | head -10")
print(out[:300])

# Confirm TTL
print("\n=== HOME_BUNDLE_CACHE_TTL ===")
out = run("grep 'HOME_BUNDLE_CACHE_TTL' /root/server/index.js")
print(f"  {out}")

# Quick home-bundle test
print("\n=== home-bundle 当前延迟 ===")
for i in range(3):
    out = run("curl -s -o /dev/null -w '%{time_total}' http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"home-bundle\"}' 2>/dev/null")
    print(f"  run{i}: {float(out)*1000:.0f}ms")

ssh.close()

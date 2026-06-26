#!/usr/bin/env python3
"""修复 home-bundle 冷启动"""
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

# 1. 检查 warm_api_cache 实现
print("=== warm_api_cache 当前实现 ===")
out = run("grep -B3 -A15 'case.*warm_api_cache' /root/server/scheduler_v2.js 2>/dev/null")
print(out[:1000])

# 2. 检查 index.js 中 warm_api_cache 处理
print("\n=== index.js warm_api_cache ===")
out = run("grep -B2 -A20 'warm_api_cache' /root/server/index.js 2>/dev/null | head -40")
print(out[:1000])

# 3. 查看缓存 TTL 设置
print("\n=== 缓存 TTL ===")
out = run("grep -n 'cacheTtl\\|TTL\\|ttl\\|CACHE_TTL\\|cacheDuration' /root/server/index.js 2>/dev/null | head -10")
print(out[:500])

# 4. 查看 cache.js 实现
print("\n=== cache.js 实现 ===")
out = run("grep -B2 -A5 'getDataJson\\|homeBundle\\|home-bundle' /root/server/cache.js 2>/dev/null | head -30")
print(out[:500])

ssh.close()

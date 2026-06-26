#!/usr/bin/env python3
"""尝试安装 playwright 的老版本 + 检查 npm 版"""
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

# 方式1: pip search（可能被禁用）
print("=== pip search playwright ===\n")
out, err = run("pip3 search playwright 2>&1")
print(out[:500] if out else err[:500])

# 方式2: 尝试旧版本 playwright (最初叫 playwright-python)
print("\n=== 尝试 playwright-python ===\n")
for name in ["playwright-python", "playwright==1.0.0", "playwright==1.30.0"]:
    out, err = run(f"pip3 install -i https://pypi.org/simple/ {name} 2>&1", timeout=60)
    status = "OK" if "Successfully" in out else "FAIL"
    print(f"  {name}: {status}")
    if err and "ERROR" in err:
        print(f"    {err.strip()[:200]}")

# 方式3: 检查 npm playwright（已安装）
print("\n=== npm playwright 可用性 ===\n")
out, err = run("cd /root && npx playwright --version 2>&1", timeout=30)
print(out[:500] if out else err[:500])

out, err = run("node -e \"const pw = require('playwright'); console.log('playwright version:', pw.chromium?.name || 'loaded')\" 2>&1", timeout=30)
print(out[:300] if out else err[:300])

# 方式4: 检查系统依赖
print("\n=== 系统依赖检查 ===\n")
out, err = run("ldd /root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/browsers.json 2>&1; ls /root/.cache/ms-playwright/ 2>&1")
print(out[:500])

# 方式5: Python 版本约束检查
print("\n=== playwright requires-python ===\n")
out, err = run("pip3 install --dry-run playwright 2>&1")
print(out[:500] if out else "")
out, err = run("python3 -c 'import sys; print(\"Python:\", sys.version_info[:2])'")
print(out)

# 检查 pip 能否看到 playwright 的元数据
print("\n=== 元数据检查 ===\n")
out, err = run("python3 -c \"import urllib.request,json; d=json.load(urllib.request.urlopen('https://pypi.org/pypi/playwright/json')); print('latest:', d['info']['version']); print('requires_python:', d['info'].get('requires_python','?'))\" 2>&1", timeout=30)
print(out[:500] if out else err[:500])

ssh.close()

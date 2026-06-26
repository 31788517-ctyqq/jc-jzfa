#!/usr/bin/env python3
"""通用 SSH 远程命令执行（兼容 deploy.py 的密钥/密码认证）"""
import paramiko, os, sys

HOST = '119.23.51.159'
USER = 'root'

# 密码
PASS = os.environ.get('DEPLOY_SSH_PASS', '')
if not PASS:
    env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env.deploy')
    if os.path.exists(env_file):
        for line in open(env_file, encoding='utf-8'):
            if line.startswith('DEPLOY_SSH_PASS='):
                PASS = line.strip().split('=', 1)[1]
                break

# 密钥
key_path = os.path.expanduser('~/.ssh/id_rsa_jczjfa')
KEY_FILE = key_path if os.path.exists(key_path) else None

def get_ssh():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    connect_ok = False
    if KEY_FILE:
        for opts in [{}, {'disabled_algorithms': {'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']}}]:
            try:
                ssh.connect(HOST, username=USER, key_filename=KEY_FILE, timeout=10, port=22,
                            look_for_keys=False, allow_agent=False, **opts)
                connect_ok = True
                break
            except Exception:
                continue
    if not connect_ok:
        for algo in [{}, {'disabled_algorithms': {'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']}}]:
            try:
                ssh.connect(HOST, username=USER, password=PASS, timeout=10, port=22, **algo)
                connect_ok = True
                break
            except Exception:
                continue
    if not connect_ok:
        print('[ERROR] SSH 连接失败')
        sys.exit(1)
    return ssh

def run_cmds(commands, timeout=15):
    ssh = get_ssh()
    for cmd in commands:
        print(f'\n>>> {cmd[:100]}')
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode()
        err = stderr.read().decode()
        if out: print(out[:1200])
        if err and 'Warning' not in err: print('ERR:', err[:300])
    ssh.close()

# -*- coding: utf-8 -*-
"""
优化前全量数据备份脚本
用法: python .codebuddy/pre_opt_backup.py [--dry]
"""

import paramiko
import sys
import os
from datetime import datetime

HOST = os.environ.get('DEPLOY_SSH_HOST', '119.23.51.159')
USER = 'root'

def get_pass():
    PASS = os.environ.get('DEPLOY_SSH_PASS')
    if PASS:
        return PASS
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env.deploy')
    if os.path.exists(env_file):
        with open(env_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('DEPLOY_SSH_PASS='):
                    return line.split('=', 1)[1].strip().strip('"').strip("'")
    return None

def ssh_cmd(ssh, cmd, timeout=60):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

def main():
    dry = '--dry' in sys.argv
    PASS = get_pass()
    if not PASS:
        print('[ERROR] DEPLOY_SSH_PASS 未设置')
        sys.exit(1)

    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_name = f'/root/backup_pre_data_opt_{ts}.tar.gz'

    print('=' * 60)
    print(f'  优化前全量数据备份')
    print(f'  目标: {HOST}')
    print(f'  输出: {backup_name}')
    print(f'  模式: {"DRY RUN" if dry else "执行"}')
    print('=' * 60)

    # 连接
    print('\n连接服务器...')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    key_path = os.path.expanduser('~/.ssh/id_rsa_jczjfa')
    KEY_FILE = key_path if os.path.exists(key_path) else None

    connected = False
    if KEY_FILE:
        try:
            ssh.connect(HOST, username=USER, key_filename=KEY_FILE, timeout=10)
            connected = True
            print('  [OK] 密钥认证: ' + KEY_FILE)
        except:
            pass
    if not connected:
        ssh.connect(HOST, username=USER, password=PASS, timeout=10)
        print('  [OK] 密码认证')

    # 检查磁盘空间
    print('\n检查磁盘空间...')
    out, err = ssh_cmd(ssh, "df -h /root | tail -1 | awk '{print $4}'")
    print(f'  /root 可用: {out}')

    # 确保备份目录存在
    ssh_cmd(ssh, 'mkdir -p /root/backups')

    # 构建备份命令
    backup_cmd = (
        f"tar -czf {backup_name} "
        "/root/server/data.json "
        "/root/server/midou_data.db "
        "/root/server/odds_history/ "
        "/root/server/shuju_data/ "
        "/root/server/ai_cache.json "
        "/root/server/jczq_change_cache.json "
        "/root/server/live_scores.json "
        "/root/server/trends.json "
        "/root/server/gongshoudao/cache.json "
        "/root/server/plan_snapshots/ "
        "2>&1"
    )

    if dry:
        print(f'\n[DRY] 将执行: {backup_cmd}')
    else:
        print(f'\n开始打包备份...')
        out, err = ssh_cmd(ssh, backup_cmd, timeout=300)
        if err and 'error' in err.lower():
            print(f'  [WARN] {err[:200]}')

        # 验证备份
        check, _ = ssh_cmd(ssh, f"ls -lh {backup_name} 2>/dev/null | awk '{{print $5}}'")
        if check:
            print(f'  [OK] 备份完成: {check}')
        else:
            print(f'  [ERROR] 备份文件未生成!')
            sys.exit(1)

        # 验证内容
        verify, _ = ssh_cmd(ssh, f"tar -tzf {backup_name} | head -20")
        print(f'  包含文件 (前20):\n    ' + '\n    '.join(verify.split('\n')[:20]))

        # 确认 data.json 和 midou_data.db 都在
        if 'data.json' not in verify:
            print('  [WARN] data.json 不在备份中!')
        if 'midou_data.db' not in verify:
            print('  [WARN] midou_data.db 不在备份中!')

    print(f'\n  备份位置: {backup_name}')
    print(f'  恢复命令: tar -xzf {backup_name} -C /root/server/')
    print('=' * 60)

    ssh.close()

if __name__ == '__main__':
    main()

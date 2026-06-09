# -*- coding: utf-8 -*-
"""
一键操作：上传 fetch_historical_batches.js → 服务器执行 → 下载结果

用法：
    python scripts/fetch_and_download_batches.py              # 全部执行
    python scripts/fetch_and_download_batches.py --dry         # 试跑（服务器上 --dry）
    python scripts/fetch_and_download_batches.py --force       # 强制重新抓取
    python scripts/fetch_and_download_batches.py --upload-only # 仅上传脚本
    python scripts/fetch_and_download_batches.py --download-only # 仅下载结果
"""
import paramiko
import sys
import os
import io
import time

# UTF-8 输出
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ═══════════════════ 配置 ═══════════════════
HOST = '119.23.51.159'
USER = 'root'
REMOTE_DIR = '/root/server'
LOCAL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_SERVER = os.path.join(LOCAL_ROOT, 'server')

# 读取密码
PASS = os.environ.get('DEPLOY_SSH_PASS')
if not PASS:
    env_deploy = os.path.join(LOCAL_ROOT, '.env.deploy')
    if os.path.exists(env_deploy):
        with open(env_deploy, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('DEPLOY_SSH_PASS='):
                    PASS = line.split('=', 1)[1].strip().strip('"').strip("'")
                    break
if not PASS:
    print('[ERROR] 未找到密码，检查 .env.deploy 或 DEPLOY_SSH_PASS 环境变量')
    sys.exit(1)

DRY_RUN = '--dry' in sys.argv
FORCE = '--force' in sys.argv
UPLOAD_ONLY = '--upload-only' in sys.argv
DOWNLOAD_ONLY = '--download-only' in sys.argv

# ═══════════════════ SSH 连接 ═══════════════════
def connect_ssh():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    # 尝试密钥
    key_file = os.path.expandvars(r'%USERPROFILE%\.ssh\id_rsa_jczjfa')
    connected = False
    if os.path.exists(key_file):
        for key_type in [paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey]:
            try:
                key = key_type.from_private_key_file(key_file)
                ssh.connect(HOST, username=USER, pkey=key, timeout=15)
                connected = True
                print('[SSH] 密钥认证成功')
                break
            except Exception:
                continue

    if not connected:
        print('[SSH] 尝试密码认证...')
        ssh.connect(HOST, username=USER, password=PASS, timeout=15)
        print('[SSH] 密码认证成功')

    return ssh


def sftp_upload(sftp, local_path, remote_path):
    """上传单个文件"""
    print(f'  [UPLOAD] {local_path} → {remote_path}')
    sftp.put(local_path, remote_path)
    # 验证
    local_size = os.path.getsize(local_path)
    remote_stat = sftp.stat(remote_path)
    if remote_stat.st_size != local_size:
        print(f'  [WARN] 文件大小不匹配! 本地={local_size}, 远程={remote_stat.st_size}')
        return False
    return True


def sftp_download(sftp, remote_path, local_path):
    """下载单个文件"""
    print(f'  [DOWNLOAD] {remote_path} → {local_path}')
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    sftp.get(remote_path, local_path)
    if os.path.exists(local_path):
        size = os.path.getsize(local_path)
        print(f'  [OK] {local_path} ({size} bytes)')
        return True
    return False


def run_remote(ssh, cmd, description=''):
    """在服务器上执行命令并流式输出"""
    if description:
        print(f'\n  [{description}]')
    print(f'  $ {cmd}')
    stdin, stdout, stderr = ssh.exec_command(cmd)
    stdout_text = stdout.read().decode('utf-8', errors='replace')
    stderr_text = stderr.read().decode('utf-8', errors='replace')
    exit_code = stdout.channel.recv_exit_status()

    if stdout_text:
        # 缩进输出每一行
        for line in stdout_text.split('\n'):
            print(f'    {line}')
    if stderr_text:
        for line in stderr_text.split('\n'):
            if line.strip():
                print(f'    [STDERR] {line}')
    return exit_code, stdout_text, stderr_text


# ═══════════════════ 主流程 ═══════════════════
def main():
    print('=' * 60)
    print(' m.100qiu.com 历史批次抓取 + 下载')
    print(' 服务器: ' + HOST)
    print(' 模式: ' + ('DRY-RUN' if DRY_RUN else '正式') + (' + FORCE' if FORCE else ''))
    print('=' * 60)

    ssh = connect_ssh()
    sftp = ssh.open_sftp()

    try:
        if not DOWNLOAD_ONLY:
            # ─── 1. 上传脚本 ───
            print('\n📤 阶段 1: 上传 fetch_historical_batches.js')
            local_script = os.path.join(LOCAL_SERVER, 'fetch_historical_batches.js')
            remote_script = f'{REMOTE_DIR}/fetch_historical_batches.js'

            if not os.path.exists(local_script):
                print(f'[ERROR] 脚本不存在: {local_script}')
                sys.exit(1)

            sftp_upload(sftp, local_script, remote_script)

            if UPLOAD_ONLY:
                print('\n✅ 仅上传模式完成。')
                return

            # ─── 2. 备份服务器上现有文件 ───
            print('\n📦 阶段 2: 备份服务器现有数据')
            timestamp = time.strftime('%Y%m%d_%H%M%S')
            run_remote(ssh,
                f'cd {REMOTE_DIR} && '
                f'cp stats_bank.json stats_bank.json.pre_fetch_{timestamp} && '
                f'cp batch_index.json batch_index.json.pre_fetch_{timestamp} && '
                f'echo "备份完成: stats_bank.json.pre_fetch_{timestamp}"',
                '备份现有文件')

            # ─── 3. 执行抓取 ───
            print('\n🔄 阶段 3: 执行历史批次抓取（服务器直连 127.0.0.1:19880）')
            extra_args = ''
            if DRY_RUN:
                extra_args = ' --dry'
            if FORCE:
                extra_args += ' --force'

            exit_code, stdout_text, _ = run_remote(ssh,
                f'cd {REMOTE_DIR} && node fetch_historical_batches.js{extra_args}',
                '抓取执行中...')

            if exit_code != 0:
                print(f'\n[WARN] 脚本退出码: {exit_code}')

            # ─── 4. 检查结果文件 ───
            print('\n📊 阶段 4: 检查服务器上的结果文件')
            run_remote(ssh,
                f'cd {REMOTE_DIR} && '
                f'echo "stats_bank.json: $(wc -c < stats_bank.json) bytes, $(grep -o "_raw_" stats_bank.json | wc -l) 批次" && '
                f'echo "batch_index.json: $(wc -c < batch_index.json) bytes"',
                '文件大小检查')

        # ─── 5. 下载结果到本地 ───
        print('\n📥 阶段 5: 下载结果到本地')

        # 下载 stats_bank.json
        remote_bank = f'{REMOTE_DIR}/stats_bank.json'
        local_bank = os.path.join(LOCAL_SERVER, 'stats_bank.json')

        # 先备份本地文件
        if os.path.exists(local_bank):
            local_bak = local_bank + '.pre_update_' + time.strftime('%Y%m%d_%H%M%S')
            print(f'  备份本地: {local_bank} → {local_bak}')
            os.rename(local_bank, local_bak)

        sftp_download(sftp, remote_bank, local_bank)

        # 下载 batch_index.json
        remote_index = f'{REMOTE_DIR}/batch_index.json'
        local_index = os.path.join(LOCAL_SERVER, 'batch_index.json')

        if os.path.exists(local_index):
            local_bak = local_index + '.pre_update_' + time.strftime('%Y%m%d_%H%M%S')
            print(f'  备份本地: {local_index} → {local_bak}')
            os.rename(local_index, local_bak)

        sftp_download(sftp, remote_index, local_index)

        # ─── 6. 验证下载结果 ───
        print('\n✅ 阶段 6: 验证')
        if os.path.exists(local_bank):
            import json
            with open(local_bank, 'r', encoding='utf-8') as f:
                bank = json.load(f)
            raw_keys = [k for k in bank if k.startswith('_raw_')]
            total_matches = 0
            by_month = {}
            for k in raw_keys:
                entry = bank[k]
                data = entry.get('data', entry) if isinstance(entry, dict) else entry
                cnt = len(data) if isinstance(data, list) else 0
                total_matches += cnt
                # 解析月份
                dt = k.replace('_raw_', '')
                if len(dt) >= 4:
                    m = int(dt[3]) if dt[3].isdigit() else 0
                    if m not in by_month:
                        by_month[m] = {'batches': 0, 'matches': 0}
                    by_month[m]['batches'] += 1
                    by_month[m]['matches'] += cnt

            print(f'\n    批次总数: {len(raw_keys)}')
            print(f'    比赛总数: {total_matches}')
            months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
            for m in sorted(by_month):
                name = months[m] if m < len(months) else f'{m}月'
                print(f'    {name}: {by_month[m]["batches"]} 批次, {by_month[m]["matches"]} 场比赛')

            if os.path.exists(local_index):
                with open(local_index, 'r', encoding='utf-8') as f:
                    index = json.load(f)
                valid = sum(1 for v in index.values() if isinstance(v, dict) and v.get('valid'))
                print(f'\n    批次索引: {len(index)} 条, 有效 {valid}')

    finally:
        sftp.close()
        ssh.close()

    print('\n' + '=' * 60)
    print(' ✅ 全部完成！')
    print('=' * 60)


if __name__ == '__main__':
    main()

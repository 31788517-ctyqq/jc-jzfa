#!/usr/bin/env python3
"""Sync code from production server to local, preserving databases."""
import paramiko, os, sys, stat

HOST = os.environ.get('DEPLOY_SSH_HOST', '119.23.51.159')
USER = os.environ.get('DEPLOY_SSH_USER', 'root')
LOCAL_ROOT = os.environ.get('DEPLOY_LOCAL_ROOT', 'E:/JC-ZJFA')

PASS = os.environ.get('DEPLOY_SSH_PASS')
if not PASS:
    env_deploy = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env.deploy')
    if os.path.exists(env_deploy):
        with open(env_deploy, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('DEPLOY_SSH_PASS='):
                    PASS = line.split('=', 1)[1].strip().strip('"').strip("'")
                    break
if not PASS:
    print('Error: DEPLOY_SSH_PASS not set. Use env var or .env.deploy file.')
    sys.exit(1)

PROD_ROOT = '/var/www/zj.100qiu.com'

# Files/dirs to EXCLUDE from sync
EXCLUDE = {
    'server/midou_data.db',
    'server/midou_data.db-shm',
    'server/midou_data.db-wal',
    'server/data.json',
    'server/data3.json',
    'server/live_scores.json',
    'server/trends.json',
    'server/logs',
    'node_modules',
    'logs',
    '.git',
    '.claude',
    '.vscode',
}

SKIPPED = []
UPDATED = []
NEW = []
ERRORS = []

def should_skip(rel_path):
    parts = rel_path.replace('\\', '/').split('/')
    for ex in EXCLUDE:
        ex_parts = ex.replace('\\', '/').split('/')
        if parts[:len(ex_parts)] == ex_parts:
            return True
    return False

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=15)

    sftp = ssh.open_sftp()

    # Walk production directory tree
    def walk_remote(remote_dir, local_dir):
        try:
            items = sftp.listdir_attr(remote_dir)
        except Exception as e:
            ERRORS.append(f'Cannot list {remote_dir}: {e}')
            return

        for item in items:
            name = item.filename
            remote_path = remote_dir + '/' + name
            rel_path = remote_path[len(PROD_ROOT)+1:]
            local_path = os.path.join(local_dir, name)

            # Check exclusions
            if should_skip(rel_path):
                SKIPPED.append(rel_path + ' [excluded]')
                continue

            if stat.S_ISDIR(item.st_mode):
                os.makedirs(local_path, exist_ok=True)
                walk_remote(remote_path, local_path)
            else:
                try:
                    # Check if file exists and is different
                    remote_mtime = item.st_mtime
                    remote_size = item.st_size

                    if os.path.exists(local_path):
                        local_size = os.path.getsize(local_path)
                        if local_size == remote_size:
                            SKIPPED.append(rel_path + ' [same size]')
                            continue
                        UPDATED.append(rel_path)
                    else:
                        NEW.append(rel_path)

                    # Download file
                    os.makedirs(os.path.dirname(local_path), exist_ok=True)
                    sftp.get(remote_path, local_path)
                    print(f'  {"U" if rel_path in UPDATED else "N"}: {rel_path}')
                except Exception as e:
                    ERRORS.append(f'Failed {rel_path}: {e}')

    print('Syncing from production...')
    walk_remote(PROD_ROOT, LOCAL_ROOT)

    sftp.close()
    ssh.close()

    print(f'\n=== 同步结果 ===')
    print(f'新增: {len(NEW)} 个文件')
    print(f'更新: {len(UPDATED)} 个文件')
    print(f'跳过: {len(SKIPPED)} 个（保护/相同）')
    if ERRORS:
        print(f'错误: {len(ERRORS)}')
        for e in ERRORS[:10]:
            print(f'  ! {e}')

    if NEW:
        print(f'\n新增文件列表:')
        for f in sorted(NEW):
            print(f'  + {f}')
    if UPDATED:
        print(f'\n更新文件列表:')
        for f in sorted(UPDATED):
            print(f'  ~ {f}')

if __name__ == '__main__':
    main()

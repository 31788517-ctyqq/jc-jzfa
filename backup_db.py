# -*- coding: utf-8 -*-
"""
服务器数据库备份脚本
用法: python backup_db.py [--download]

  python backup_db.py             # 仅服务器端备份
  python backup_db.py --download  # 备份并下载到本地 backups/ 目录
"""
import paramiko, sys, os, io, hashlib
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ═══ 配置（与 deploy.py 一致） ═══
HOST = os.environ.get('DEPLOY_SSH_HOST', '119.23.51.159')
USER = os.environ.get('DEPLOY_SSH_USER', 'root')
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
    print('错误: 未找到 DEPLOY_SSH_PASS')
    sys.exit(1)

DOWNLOAD = '--download' in sys.argv

# ═══ 颜色 ═══
C = {'R': '\033[91m', 'G': '\033[92m', 'Y': '\033[93m', 'C': '\033[96m', 'B': '\033[0m'}
def c(color, text):
    return C.get(color, '') + text + C['B']

# ═══ 备份文件列表 ═══
BACKUP_FILES = [
    '/root/server/midou_data.db',
    '/root/server/data.json',
    '/root/server/trends.json',
    '/root/server/ai_cache.json',
    '/root/server/prediction_logs.db',
    '/root/server/gongshoudao/cache.json',
]

def ssh_cmd(ssh, cmd, timeout=60):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

print(c('C', '═' * 54))
print(c('C', '  服务器数据库备份'))
print(c('C', '═' * 54))
print(f'  服务器: {HOST}')
print(f'  时间:   {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
print()

# ═══ 连接 SSH ═══
print(c('D', '正在连接 SSH...'))
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    ssh.connect(HOST, username=USER, password=PASS, timeout=15)
    print(c('G', '✓ SSH 连接成功'))
except Exception as e:
    print(c('R', f'✗ SSH 连接失败: {e}'))
    sys.exit(1)

sftp = ssh.open_sftp()
ts = datetime.now().strftime('%Y%m%d_%H%M%S')
backup_dir = f'/tmp/db_backup_{ts}'

# ═══ 远程备份 ═══
print()
print(c('C', f'[1] 创建备份目录: {backup_dir}'))
ssh_cmd(ssh, f'mkdir -p {backup_dir}', 5)

print(c('C', '[2] 备份文件'))
backed = []
skipped = []
for f in BACKUP_FILES:
    out, _ = ssh_cmd(ssh,
        f'test -f {f} && cp {f} {backup_dir}/{os.path.basename(f)} && echo "OK $(wc -c < {f})" || echo "SKIP"',
        10)
    if 'OK' in out:
        size = out.split()[1] if len(out.split()) > 1 else '?'
        backed.append((os.path.basename(f), size))
        print(f'  {c("G", "✓")} {os.path.basename(f):28s} {size:>10s} B')
    else:
        skipped.append(os.path.basename(f))
        print(f'  {c("Y", "○")} {os.path.basename(f):28s} (文件不存在)')

# ═══ 打包 ═══
print()
print(c('C', '[3] 打包压缩'))
tar_name = f'db_backup_{ts}.tar.gz'
out, err = ssh_cmd(ssh,
    f'cd /tmp && tar -czf {tar_name} db_backup_{ts}/ 2>&1 && echo "OK $(wc -c < {tar_name})"',
    60)
if 'OK' in out:
    tar_size = out.split()[1] if len(out.split()) > 1 else '?'
    print(f'  {c("G", "✓")} {tar_name}  {tar_size} B')
else:
    print(c('R', f'  ✗ 打包失败: {err}'))

# ═══ 清理临时目录 ═══
ssh_cmd(ssh, f'rm -rf {backup_dir}', 5)

# 列出历史备份
print()
print(c('C', '[4] 服务器上的历史备份'))
out, _ = ssh_cmd(ssh,
    'ls -lht /tmp/db_backup_*.tar.gz 2>/dev/null | head -10', 10)
if out:
    for line in out.split('\n'):
        print(f'  {line}')
else:
    print('  (无历史备份)')

# ═══ 下载到本地 ═══
local_backup_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backups')
os.makedirs(local_backup_dir, exist_ok=True)

if DOWNLOAD:
    print()
    print(c('C', f'[5] 下载到本地: {local_backup_dir}'))
    remote_path = f'/tmp/{tar_name}'
    local_path = os.path.join(local_backup_dir, tar_name)
    try:
        sftp.get(remote_path, local_path)
        local_size = os.path.getsize(local_path)
        print(f'  {c("G", "✓")} 下载完成: {local_path} ({local_size} B)')
        # 校验
        out, _ = ssh_cmd(ssh, f'md5sum {remote_path} | cut -d" " -f1', 10)
        with open(local_path, 'rb') as f:
            local_md5 = hashlib.md5(f.read()).hexdigest()
        if out == local_md5:
            print(f'  {c("G", "✓")} MD5 校验通过: {out}')
        else:
            print(f'  {c("R", "✗")} MD5 不一致! 远程:{out} 本地:{local_md5}')
    except Exception as e:
        print(c('R', f'  ✗ 下载失败: {e}'))
else:
    print()
    print(c('D', '  (使用 --download 参数可下载备份到本地 backups/ 目录)'))

# ═══ 摘要 ═══
print()
print(c('C', '═' * 54))
print(c('G', f'  备份完成: {len(backed)} 个文件'))
if skipped:
    print(c('Y', f'  跳过:     {len(skipped)} 个文件（不存在）'))
print(c('C', f'  服务器:   /tmp/{tar_name}'))
if DOWNLOAD:
    print(c('C', f'  本地:     {local_backup_dir}\\{tar_name}'))
print(c('C', '═' * 54))

sftp.close()
ssh.close()

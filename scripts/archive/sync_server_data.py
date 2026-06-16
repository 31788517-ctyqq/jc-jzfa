# -*- coding: utf-8 -*-
"""
从服务器下载丰富数据到本地，覆盖本地数据文件，用于本地开发。

用法:
  python sync_server_data.py            # 交互式同步所有数据
  python sync_server_data.py --db       # 仅同步数据库
  python sync_server_data.py --files    # 仅同步 JSON 文件
"""

import paramiko, sys, os, io
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ═══ 配置 ═══
HOST = os.environ.get('DEPLOY_SSH_HOST', '119.23.51.159')
USER = os.environ.get('DEPLOY_SSH_USER', 'root')
PASS = os.environ.get('DEPLOY_SSH_PASS')

LOCAL_ROOT = os.path.dirname(os.path.abspath(__file__))
LOCAL_SERVER = os.path.join(LOCAL_ROOT, 'server')

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
    print('错误: 未找到 DEPLOY_SSH_PASS，请在 .env.deploy 或环境变量中设置')
    sys.exit(1)

# ═══ 服务器路径 → 本地路径映射 ═══
# 注意：服务器路径有两处：
#   - /root/server/     (PM2 运行目录，数据库在这里)
#   - /var/www/zj.100qiu.com/server/  (Nginx 目录)
# 数据库在 /root/server/midou_data.db
SYNC_FILES = {
    # 数据库（最大，耗时最久）
    'midou_data.db': {
        'remote': '/root/server/midou_data.db',
        'local': os.path.join(LOCAL_SERVER, 'midou_data.db'),
        'desc': '主数据库',
    },
    # JSON 数据文件
    'data.json': {
        'remote': '/root/server/data.json',
        'local': os.path.join(LOCAL_SERVER, 'data.json'),
        'desc': '比赛数据',
    },
    'trends.json': {
        'remote': '/root/server/trends.json',
        'local': os.path.join(LOCAL_SERVER, 'trends.json'),
        'desc': '推荐趋势',
    },
    'ai_cache.json': {
        'remote': '/root/server/ai_cache.json',
        'local': os.path.join(LOCAL_SERVER, 'ai_cache.json'),
        'desc': 'AI 预测缓存',
    },
    'gongshoudao_cache.json': {
        'remote': '/root/server/gongshoudao/cache.json',
        'local': os.path.join(LOCAL_SERVER, 'gongshoudao', 'cache.json'),
        'desc': '功守道缓存',
    },
}

# ═══ 颜色 ═══ 
C = {'R': '\033[91m', 'G': '\033[92m', 'Y': '\033[93m', 'C': '\033[96m', 'B': '\033[0m'}
def c(color, text):
    return C.get(color, '') + text + C['B']

def readable_size(size_bytes):
    if size_bytes < 1024:
        return f'{size_bytes} B'
    elif size_bytes < 1024 * 1024:
        return f'{size_bytes / 1024:.1f} KB'
    else:
        return f'{size_bytes / (1024 * 1024):.1f} MB'

def ssh_cmd(ssh, cmd, timeout=30):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# ═══ 下载单个文件（带进度反馈） ═══
def download_file(sftp, remote_path, local_path, key, desc, force=False):
    """下载文件，带本地备份和大小对比"""
    try:
        stat = sftp.stat(remote_path)
        remote_size = stat.st_size
    except FileNotFoundError:
        print(f'  {c("Y", "○")} {desc}: 服务器文件不存在，跳过')
        return False
    except Exception as e:
        print(f'  {c("R", "✗")} {desc}: 无法访问服务器文件 - {e}')
        return False

    local_size = 0
    if os.path.exists(local_path):
        local_size = os.path.getsize(local_path)
    
    if not force and local_size > 0:
        print(f'  {desc}:')
        print(f'    本地: {readable_size(local_size)}')
        print(f'    服务器: {readable_size(remote_size)}')
        
        if local_size == remote_size:
            print(f'    {c("G", "→ 大小相同，跳过同步")}')
            return False
        elif local_size > remote_size:
            print(f'    {c("Y", "⚠ 本地更大！可能数据更全，跳过覆盖")}')
            # 询问是否强制覆盖
            ans = input(f'    {c("R", "是否强制用服务器数据覆盖？(y/N)")}: ').strip().lower()
            if ans != 'y':
                print(f'    {c("C", "→ 保留本地数据")}')
                return False
        else:
            print(f'    {c("C", "→ 服务器数据更大，准备更新...")}')
    
    # 备份本地文件
    if os.path.exists(local_path):
        backup_path = local_path + '.bak_' + datetime.now().strftime('%Y%m%d_%H%M%S')
        try:
            os.rename(local_path, backup_path)
            print(f'    {c("Y", "备份:")} {os.path.basename(backup_path)}')
        except Exception:
            pass

    # 下载
    try:
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        sftp.get(remote_path, local_path)
        new_size = os.path.getsize(local_path)
        print(f'  {c("G", "✓")} {desc}: {readable_size(new_size)} 下载完成')
        return True
    except Exception as e:
        print(f'  {c("R", "✗")} {desc}: 下载失败 - {e}')
        # 恢复备份
        if os.path.exists(local_path + '.bak_' + datetime.now().strftime('%Y%m%d')):
            ...  # 备份保留，手动恢复
        return False

# ═══ 同步 odds_history 目录 ═══
def sync_odds_history(sftp, remote_dir='/root/server/odds_history'):
    """同步赔率历史目录（仅下载本地缺失或更新的文件）"""
    local_odds_dir = os.path.join(LOCAL_SERVER, 'odds_history')
    os.makedirs(local_odds_dir, exist_ok=True)
    
    try:
        items = sftp.listdir_attr(remote_dir)
    except Exception:
        print(f'  {c("Y", "○")} odds_history: 服务器目录不存在')
        return 0
    
    # 只下载新的或有变化的文件
    count = 0
    for item in items:
        if not item.filename.endswith('.json'):
            continue
        local_path = os.path.join(local_odds_dir, item.filename)
        remote_path = remote_dir + '/' + item.filename
        
        if os.path.exists(local_path):
            local_size = os.path.getsize(local_path)
            if local_size == item.st_size:
                continue  # 相同大小，跳过
        
        try:
            sftp.get(remote_path, local_path)
            count += 1
        except Exception:
            pass
    
    if count > 0:
        print(f'  {c("G", "✓")} odds_history: 同步 {count} 个文件')
    else:
        print(f'  {c("C", "→")} odds_history: 无新文件（共 {len(items)} 个）')
    return count

# ═══ 主流程 ═══
def main():
    only_db = '--db' in sys.argv
    only_files = '--files' in sys.argv
    force = '--force' in sys.argv
    
    print(c('C', '=' * 56))
    print(c('C', '  从服务器同步数据到本地'))
    print(c('C', '=' * 56))
    print(f'  服务器: {HOST}')
    print(f'  本地:   {LOCAL_SERVER}')
    print(f'  时间:   {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print()
    
    # 先清理本地 WAL 文件（防止数据库锁冲突）
    for suffix in ['-wal', '-shm']:
        wal_path = os.path.join(LOCAL_SERVER, 'midou_data.db' + suffix)
        if os.path.exists(wal_path):
            try:
                os.remove(wal_path)
                print(f'  {c("Y", "清理")} midou_data.db{suffix}')
            except Exception:
                pass
    
    print(c('C', '正在连接服务器...'))
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(HOST, username=USER, password=PASS, timeout=15)
        print(c('G', '✓ 连接成功'))
    except Exception as e:
        print(c('R', f'✗ 连接失败: {e}'))
        sys.exit(1)
    
    sftp = ssh.open_sftp()
    downloaded = []
    skipped = []
    
    # ═══ 1. 数据库 ═══
    if not only_files:
        print()
        print(c('C', '[1] 数据库同步'))
        db_key = 'midou_data.db'
        db_info = SYNC_FILES[db_key]
        if download_file(sftp, db_info['remote'], db_info['local'], db_key, db_info['desc'], force=force):
            downloaded.append(db_info['desc'])
        else:
            skipped.append(db_info['desc'])
    
    # ═══ 2. JSON 数据文件 ═══
    if not only_db:
        print()
        print(c('C', '[2] JSON 文件同步'))
        for key, info in SYNC_FILES.items():
            if key == 'midou_data.db':
                continue
            if download_file(sftp, info['remote'], info['local'], key, info['desc'], force=force):
                downloaded.append(info['desc'])
            else:
                skipped.append(info['desc'])
        
        # ═══ 3. odds_history 目录 ═══
        print()
        print(c('C', '[3] 赔率历史同步'))
        n = sync_odds_history(sftp)
        if n > 0:
            downloaded.append(f'赔率历史 ({n} 个文件)')
        else:
            skipped.append('赔率历史')
    
    sftp.close()
    ssh.close()
    
    # ═══ 摘要 ═══
    print()
    print(c('C', '=' * 56))
    if downloaded:
        print(c('G', '  已同步:'))
        for d in downloaded:
            print(c('G', f'    ✓ {d}'))
    if skipped:
        print(c('Y', '  跳过:'))
        for s in skipped:
            print(c('Y', f'    ○ {s}'))
    
    print()
    if downloaded:
        print(c('G', '✓ 同步完成！现在可以用富数据启动本地服务器:'))
        print(c('C', f'  {LOCAL_ROOT}\\start-local.bat'))
    else:
        print(c('Y', '所有数据已是最新，无需同步'))
    
    print(c('C', '=' * 56))


if __name__ == '__main__':
    main()

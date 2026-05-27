# -*- coding: utf-8 -*-
"""
安全部署脚本 — 只上传代码文件，永不触碰运行时数据。

特性：
  - 部署前自动备份数据文件到 /tmp/deploy_backup_{ts}/
  - 只 SFTP 上传代码文件（白名单模式），不运行 git 命令
  - 上传后验证文件大小/存在性
  - 部署后重启 PM2 + 健康检查
  - 不依赖服务器 git（避免 403/冲突问题）

用法: python deploy.py
"""
import paramiko, sys, os, io, json
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ═══ 配置 ═══
HOST = '119.23.51.159'
USER = 'root'
PASS = 'znm19811225@'
PROD_ROOT = '/var/www/zj.100qiu.com'
LOCAL_ROOT = 'E:/JC-ZJFA'

# 受保护的数据文件 — 部署时备份但永不上传
PROTECTED_FILES = [
    'server/data.json',
    'server/live_scores.json',
    'server/trends.json',
    'server/gongshoudao/cache.json',
    'server/jczq_change_cache.json',
    'server/ai_cache.json',
    'server/ai_timing.json',
    'server/midou_data.db',
    'server/.env',
]

# 需要部署的代码文件（白名单 — 相对于项目根目录）
# 修改此列表来指定每次部署的文件
DEPLOY_FILES = [
    '.gitignore',
    'preview/index.html',
    'preview/app.js',
    'preview/js/main.js',
    'preview/js/pages/quant-rank.js',
    'preview/js/pages/match-pk.js',
    'preview/js/api.js',
    'server/jczqYz_fetcher.js',
    'server/jczq_change.js',
    'server/index.js',
    'server/gongshoudao/index.js',
    'server/gongshoudao/attack.js',
    'server/gongshoudao/goal.js',
    'server/gongshoudao/parser.js',
    'server/gongshoudao/diff.js',
    'server/gongshoudao/score.js',
    'server/gongshoudao/fetch.js',
    'server/data_sync.js',
    'server/oneshot_sync.js',
    'server/scheduler.js',
    'server/scraper.js',
    'ecosystem.config.json',
]

# ═══ 工具函数 ═══
def run(ssh, cmd, desc=''):
    sys.stderr.write('[  {}] {}\n'.format(desc, cmd[:80]))
    sys.stderr.flush()
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=120)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if out: sys.stderr.write('  OUT: {}\n'.format(out[:200]))
    if err and 'warning' not in err.lower() and not err.startswith('From ') and not err.startswith('Updating '):
        sys.stderr.write('  ERR: {}\n'.format(err[:200]))
    return out, err

def main():
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_dir = '/tmp/deploy_backup_' + ts

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=15, port=22,
                disabled_algorithms={'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']})
    print('=' * 50)
    print('  安全部署 {}'.format(datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
    print('=' * 50)

    # ── Phase 1: 备份数据文件 ──
    print('\n[Phase 1] 备份运行时数据...')
    run(ssh, 'mkdir -p ' + backup_dir, 'create backup dir')
    backed = 0
    for f in PROTECTED_FILES:
        remote_path = PROD_ROOT + '/' + f
        out, _ = run(ssh, 'test -f {} && cp {} {}/{} && echo "OK" || echo "SKIP"'.format(
            remote_path, remote_path, backup_dir, os.path.basename(f)), 'backup ' + f)
        if 'OK' in out: backed += 1
    print('  已备份 {} 个文件 → {}'.format(backed, backup_dir))

    # ── Phase 2: 上传代码文件 ──
    print('\n[Phase 2] SFTP 上传代码文件...')
    sftp = ssh.open_sftp()
    ok_count = 0
    fail_list = []

    for rel in DEPLOY_FILES:
        local_path = os.path.join(LOCAL_ROOT, rel)
        remote_path = os.path.join(PROD_ROOT, rel)

        # 检查本地文件是否存在
        if not os.path.exists(local_path):
            print('  SKIP (not found):', rel)
            continue

        local_size = os.path.getsize(local_path)
        if local_size == 0 and not rel.endswith('.gitignore'):
            print('  SKIP (empty):', rel)
            continue

        try:
            # 确保远程目录存在
            remote_dir = os.path.dirname(remote_path)
            try:
                sftp.stat(remote_dir)
            except:
                try: sftp.mkdir(remote_dir)
                except: pass

            sftp.put(local_path, remote_path)

            # 验证上传
            try:
                remote_stat = sftp.stat(remote_path)
                if remote_stat.st_size == local_size:
                    print('  OK  {:6d}B  {}'.format(local_size, rel))
                    ok_count += 1
                else:
                    print('  MISMATCH: local={} remote={}  {}'.format(local_size, remote_stat.st_size, rel))
                    fail_list.append(rel)
            except Exception as e:
                print('  VERIFY FAIL: {} - {}'.format(rel, e))
                fail_list.append(rel)

        except Exception as e:
            print('  FAIL: {} - {}'.format(rel, e))
            fail_list.append(rel)

    sftp.close()
    print('  上传完成: {} OK, {} FAIL'.format(ok_count, len(fail_list)))
    if fail_list:
        for f in fail_list:
            print('    ! ' + f)

    # ── Phase 3: 服务器端 gitignore 保护 ──
    print('\n[Phase 3] 服务器端数据保护...')
    # 更新 .gitignore 确保服务器也保护数据文件
    run(ssh, 'cd {} && git update-index --assume-unchanged server/data.json server/live_scores.json server/trends.json server/gongshoudao/cache.json 2>/dev/null; echo "protected"'.format(PROD_ROOT), 'assume-unchanged')

    # ── Phase 4: PM2 重启 ──
    print('\n[Phase 4] PM2 重启...')
    out, _ = run(ssh, 'pm2 restart jc-zjfa', 'pm2 restart')

    # ── Phase 5: 健康检查 ──
    print('\n[Phase 5] 健康检查...')
    ssh.exec_command('sleep 4', timeout=10)  # wait for restart
    out, _ = run(ssh, 'curl -s http://localhost:3000/health', 'health check')

    # ── 验证数据完整性 ──
    print('\n[Phase 6] 验证数据完整性...')
    out, _ = run(ssh, 'wc -c < {}/server/data.json'.format(PROD_ROOT), 'data.json size')

    ssh.close()

    if fail_list:
        print('\n⚠ 有 {} 个文件上传异常！'.format(len(fail_list)))
        print('备份位置: ' + backup_dir)
    else:
        print('\n部署成功 ✅')
        print('备份位置: ' + backup_dir)

if __name__ == '__main__':
    main()

# -*- coding: utf-8 -*-
"""
安全部署脚本 v2 — zj.100qiu.com 独立项目专用

架构说明:
  ┌─────────────────────────────────────────────────┐
  │  Nginx :80/:443                                  │
  │  ├─ /          → /var/www/zj.100qiu.com/preview/ │ (静态文件)
  │  ├─ /api       → proxy → :3000                   │ (API 代理)
  │  └─ /health    → proxy → :3000                   │ (健康检查)
  ├─────────────────────────────────────────────────┤
  │  PM2 (jc-zjfa): cwd=/root/server                 │
  │  └─ node index.js (Express :3000)                │
  ├─────────────────────────────────────────────────┤
  │  PM2 (jc-sync): cwd=/root/server                 │
  │  └─ node data_sync.js                            │
  └─────────────────────────────────────────────────┘

部署策略:
  - preview/*  → /var/www/zj.100qiu.com/preview/  (Nginx 直接提供)
  - server/*   → /root/server/                     (PM2 运行时)
  - 也同步到 /var/www/zj.100qiu.com/server/        (备份)

上传方式 (解决 SFTP 文件被还原问题):
  1. SFTP → /tmp/_deploy_{md5}
  2. SSH md5sum 验证临时文件
  3. SSH cp -f 覆盖目标
  4. SSH md5sum 验证目标文件
  5. rm -f 清理临时文件

用法: python deploy.py [--dry] [--fast]
  --dry   试运行，不实际部署
  --fast  跳过备份，快速部署
"""
import paramiko, sys, os, io, hashlib, re, time
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ══════════════════════════════════════════
# 配置
# ══════════════════════════════════════════
HOST = '119.23.51.159'
USER = 'root'
PASS = 'znm19811225@'
LOCAL_ROOT = 'E:/JC-ZJFA'

# 两个部署目标
NGINX_ROOT = '/var/www/zj.100qiu.com'   # Nginx 静态文件从这里提供
PM2_ROOT   = '/root'                     # PM2 从 /root/server/ 运行

# 受保护的数据文件 — 部署时只备份、不覆盖
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

# 部署文件清单
# 标注 deploy_to: 'nginx' → Nginx 静态路径, 'pm2' → PM2 运行路径, 'both' → 两个都部署
DEPLOY_MAP = [
    # 前端静态文件 → Nginx 直接提供
    ('preview/index.html',                'nginx'),
    ('preview/app.js',                    'nginx'),
    ('preview/js/main.js',                'nginx'),
    ('preview/js/pages/quant-rank.js',    'nginx'),
    ('preview/js/pages/match-pk.js',      'nginx'),
    ('preview/js/pages/ranking.js',       'nginx'),
    ('preview/js/pages/income.js',        'nginx'),
    ('preview/js/pages/plans.js',         'nginx'),
    ('preview/js/pages/hit-rate.js',      'nginx'),
        ('preview/js/pages/filter.js',        'nginx'),
        ('preview/js/pages/gongshoudao.js',   'nginx'),
        ('preview/js/charts.js',              'nginx'),
    ('preview/js/api.js',                 'nginx'),
    # 服务端 → PM2 运行时路径
    ('server/index.js',                   'both'),
    ('server/jczqYz_fetcher.js',          'both'),
    ('server/jczq_change.js',             'both'),
    ('server/data_sync.js',               'both'),
    ('server/oneshot_sync.js',            'both'),
    ('server/scheduler.js',               'both'),
    ('server/scraper.js',                 'both'),
    ('server/http-utils.js',              'both'),
    ('server/fetch_odds.js',              'both'),
    ('server/fetch_500odds.js',           'both'),
    ('server/merge_shuju.js',             'both'),
    ('server/gongshoudao/index.js',       'both'),
    ('server/gongshoudao/attack.js',      'both'),
    ('server/gongshoudao/goal.js',        'both'),
    ('server/gongshoudao/parser.js',      'both'),
    ('server/gongshoudao/diff.js',        'both'),
    ('server/gongshoudao/score.js',       'both'),
    ('server/gongshoudao/fetch.js',       'both'),
    # PM2 配置 → PM2 启动目录
    ('ecosystem.config.json',             'pm2'),
    # 配置文件
    ('.gitignore',                        'both'),
]

# ── 颜色输出 ──
C = {'R': '\033[91m', 'G': '\033[92m', 'Y': '\033[93m', 'C': '\033[96m', 'B': '\033[0m', 'D': '\033[2m'}
def c(color, text):
    return C.get(color, '') + text + C['B']

# ══════════════════════════════════════════
# 核心函数
# ══════════════════════════════════════════

def ssh_cmd(ssh, cmd, timeout=120):
    """执行 SSH 命令，返回 (stdout, stderr)"""
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err


def batch_upload(sftp, ssh, file_list, dry_run=False):
    """
    批量上传：SFTP 全部→/tmp/ → 单次 SSH cp+md5 → 返回结果列表
    file_list: [(local_path, remote_path), ...]
    """
    results = []
    tmp_files = []
    cp_cmds = []
    verify_cmds = []

    if dry_run:
        for lp, rp in file_list:
            results.append((True, os.path.basename(rp), 'DRY', '-', '-'))
        return results

    # 1) SFTP 批量上传到 /tmp
    for local_path, remote_path in file_list:
        fname = os.path.basename(remote_path)
        tmp_path = '/tmp/_dep_{}'.format(fname)
        try:
            sftp.put(local_path, tmp_path)
            tmp_files.append((local_path, remote_path, tmp_path))
        except Exception as e:
            results.append((False, os.path.basename(remote_path), 'SFTP', '-', str(e)[:50]))

    # 2) 构建批量 cp + md5 命令
    for local_path, remote_path, tmp_path in tmp_files:
        remote_dir = os.path.dirname(remote_path)
        cp_cmds.append('mkdir -p {d} && cp -f {t} {p}'.format(
            d=remote_dir, t=tmp_path, p=remote_path))
        verify_cmds.append('echo "##{}##" && md5sum {}'.format(
            os.path.basename(remote_path), remote_path))

    if not cp_cmds:
        return results

    batch_cmd = ' && '.join(cp_cmds) + ' && ' + ' && '.join(verify_cmds)
    out, err = ssh_cmd(ssh, batch_cmd, len(tmp_files) * 5 + 10)

    # 3) 解析 md5sum 结果
    segments = out.split('##')
    md5_map = {}
    for i in range(1, len(segments) - 1, 2):
        fname = segments[i].strip()
        md5_str = segments[i + 1].strip().split()[0] if len(segments) > i + 1 else ''
        md5_map[fname] = md5_str

    # 4) 验证
    for local_path, remote_path, tmp_path in tmp_files:
        fname = os.path.basename(remote_path)
        with open(local_path, 'rb') as f:
            local_md5 = hashlib.md5(f.read()).hexdigest()
        remote_md5 = md5_map.get(fname, '')
        if remote_md5 == local_md5:
            results.append((True, os.path.basename(remote_path), 'OK', local_md5, remote_md5))
        else:
            results.append((False, os.path.basename(remote_path), 'MD5', local_md5[:8],
                            remote_md5[:8] if remote_md5 else 'MISSING'))

    # 5) 清理
    ssh_cmd(ssh, 'rm -f /tmp/_dep_* 2>/dev/null', 5)

    return results


def pm2_restart_and_verify(ssh):
    """重启 PM2 并验证新进程加载了新代码"""
    pm2_name = 'jc-zjfa'

    # 获取旧 PID
    out, _ = ssh_cmd(ssh, 'pm2 jlist 2>/dev/null', 10)
    old_pid = None
    try:
        import json
        jlist = json.loads(out) if out else []
        for p in jlist:
            if p.get('name') == pm2_name:
                old_pid = p.get('pid')
    except:
        pass

    print('  PM2 重启 {} ...'.format(pm2_name))
    out, err = ssh_cmd(ssh, 'pm2 restart {} --update-env 2>&1'.format(pm2_name), 15)

    # 等待重启完成
    time.sleep(3)

    # 验证新进程
    out, _ = ssh_cmd(ssh, 'pm2 jlist 2>/dev/null', 10)
    new_pid = None
    status = 'unknown'
    try:
        jlist = json.loads(out) if out else []
        for p in jlist:
            if p.get('name') == pm2_name:
                new_pid = p.get('pid')
                status = p.get('pm2_env', {}).get('status', 'unknown')
    except:
        pass

    if new_pid and new_pid != old_pid:
        print('  {} 新 PID: {} (旧: {}) 状态: {}'.format(c('G', '✓'), new_pid, old_pid or '-', status))
        return True
    elif new_pid:
        print('  {} PID 未变: {} (可能未重新加载)'.format(c('Y', '⚠'), new_pid))
        return False
    else:
        print('  {} 无法获取进程状态'.format(c('R', '✗')))
        return False


# ══════════════════════════════════════════
# 主流程
# ══════════════════════════════════════════

def main():
    dry_run = '--dry' in sys.argv
    fast_mode = '--fast' in sys.argv
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')

    if dry_run:
        print(c('Y', '\n*** DRY RUN — 不会实际部署 ***\n'))

    # ── 连接服务器 ──
    print(c('C', '连接服务器 {} ...'.format(HOST)))
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(HOST, username=USER, password=PASS, timeout=15, port=22,
                    disabled_algorithms={'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']})
        print(c('G', '  已连接\n'))
    except Exception as e:
        print(c('R', '  连接失败: {}'.format(e)))
        sys.exit(1)

    sftp = ssh.open_sftp()

    # ── Phase 0: 检查服务器环境 ──
    print(c('D', '═' * 54))
    print(c('C', '[Phase 0] 检查服务器环境'))
    checks = {
        'Nginx 存在': 'test -f /usr/sbin/nginx && echo OK || echo MISSING',
        'PM2 运行中': 'pm2 jlist 2>/dev/null | grep -c "name" || echo 0',
        'Nginx 路径': 'test -d {}/preview && echo OK || echo MISSING'.format(NGINX_ROOT),
        'PM2 路径':   'test -d {}/server && echo OK || echo MISSING'.format(PM2_ROOT),
    }
    all_ok = True
    for label, cmd in checks.items():
        out, _ = ssh_cmd(ssh, cmd, 10)
        ok = 'OK' in out or (out.isdigit() and int(out) >= 2)
        if not ok:
            all_ok = False
        mark = c('G', '✓') if ok else c('R', '✗')
        print('  {} {}: {}'.format(mark, label, out.strip()[:40]))
    print()

    if not all_ok:
        print(c('R', '⚠ 服务器环境检查未全部通过，请确认！'))
        if dry_run:
            print(c('Y', '  DRY RUN 模式继续...\n'))
        else:
            r = input('  是否继续部署？(y/N) ')
            if r.lower() != 'y':
                sys.exit(0)

    # ── Phase 1: 备份数据 ──
    if fast_mode:
        print(c('Y', '[Phase 1] --fast 模式，跳过备份\n'))
    else:
        backup_dir = '/tmp/deploy_backup_' + ts
        print(c('D', '═' * 54))
        print(c('C', '[Phase 1] 备份运行时数据'))
        if dry_run:
            print('  (skip)')
        else:
            ssh_cmd(ssh, 'mkdir -p ' + backup_dir, 5)
            backed = 0
            for f in PROTECTED_FILES:
                rp = PM2_ROOT + '/' + f
                out, _ = ssh_cmd(ssh,
                    'test -f {} && cp {} {}/{} && echo OK || echo SKIP'.format(
                        rp, rp, backup_dir, os.path.basename(f)), 10)
                if 'OK' in out:
                    backed += 1
            print('  已备份 {} 个文件 → {}'.format(backed, backup_dir))
        print()

    # ── Phase 2: 批量上传文件 ──
    print(c('D', '═' * 54))
    print(c('C', '[Phase 2] 批量上传代码文件'))
    results = []
    total = 0

    # 收集所有待上传文件
    upload_list = []
    for rel_path, target in DEPLOY_MAP:
        local_path = os.path.join(LOCAL_ROOT, rel_path)
        if not os.path.exists(local_path):
            print('  {} SKIP: 本地文件不存在 → {}'.format(c('Y', '?'), rel_path))
            continue
        if target in ('nginx', 'both'):
            upload_list.append((local_path, os.path.join(NGINX_ROOT, rel_path)))
        if target in ('pm2', 'both'):
            upload_list.append((local_path, os.path.join(PM2_ROOT, rel_path)))

    total = len(upload_list)
    if dry_run:
        for lp, rp in upload_list:
            results.append((True, rp, 'DRY', '-', '-'))
    else:
        batch_results = batch_upload(sftp, ssh, upload_list)
        for success, fname, label, lm, rm in batch_results:
            results.append((success, fname, label, lm, rm))
            if success:
                print('  {} {} {}'.format(c('G', '✓'), fname, c('D', '[' + label + ']')))
            else:
                print('  {} {} {} — {}'.format(c('R', '✗'), fname, c('D', '[' + label + ']'), rm[:40]))

    print('  上传完成: {} 文件'.format(total))

    # ── Phase 3: 部署后同步 ──
    # 确保 /var/www/zj.100qiu.com/server/ 和 /root/server/ 一致
    print(c('D', '\n═' * 54))
    print(c('C', '[Phase 3] 路径同步校验'))
    if not dry_run:
        # 用 rsync 或 cp 同步 server 目录（保护数据文件）
        out, _ = ssh_cmd(ssh,
            'rsync -av --exclude="data.json" --exclude="live_scores.json" '
            '--exclude="trends.json" --exclude="cache.json" '
            '--exclude="ai_cache.json" --exclude="ai_timing.json" '
            '--exclude="midou_data.db" --exclude=".env" '
            '--exclude="logs" --exclude="node_modules" '
            '{}/server/ {}/server/ 2>&1 | tail -3'.format(PM2_ROOT, NGINX_ROOT), 15)
        if out:
            for line in out.split('\n')[:3]:
                print('  ' + line[:100])
        print('  同步完成')
    print()

    sftp.close()

    # ── Phase 4: 重启 PM2 ──
    print(c('D', '═' * 54))
    print(c('C', '[Phase 4] PM2 重启'))
    if dry_run:
        print('  (skip)')
    else:
        pm2_restart_and_verify(ssh)
    print()

    # ── Phase 5: 健康检查 ──
    print(c('D', '═' * 54))
    print(c('C', '[Phase 5] 服务验证'))
    if dry_run:
        print('  (skip)')
    else:
        # Express 健康检查
        health, _ = ssh_cmd(ssh, 'curl -s http://localhost:3000/health 2>/dev/null', 10)
        print('  健康检查: {}'.format(c('G', health) if health == 'ok' else c('R', health or '无响应')))

        # 前端页面可访问性
        out, _ = ssh_cmd(ssh, 'curl -sI http://localhost/ 2>/dev/null | head -1', 10)
        print('  前端页面: {}'.format(out[:60] if out else c('R', '无响应')))

        # data.json 完整性
        out, _ = ssh_cmd(ssh, 'wc -c < {}/server/data.json 2>/dev/null'.format(PM2_ROOT), 10)
        print('  data.json: {} 字节'.format(out.strip() if out else c('R', '缺失!')))
    print()

    # ── 汇总 ──
    print(c('D', '═' * 54))
    ok_count = sum(1 for r in results if r[0])
    fail_count = len(results) - ok_count

    if fail_count > 0:
        print(c('R', '⚠ 部署完成，但有 {} 个文件失败:'.format(fail_count)))
        for success, rel, label, lm, ri in results:
            if not success:
                print('  ✗ {} [{}] → {}'.format(rel, label, ri[:50]))
    elif dry_run:
        print(c('Y', 'DRY RUN 完成 — 共 {} 个文件待部署'.format(total)))
    else:
        print(c('G', '部署成功 — {} 个文件全部验证通过'.format(total)))

    print(c('D', '\n用法: python deploy.py [--dry] [--fast]'))
    ssh.close()


if __name__ == '__main__':
    main()

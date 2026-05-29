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
HOST = os.environ.get('DEPLOY_SSH_HOST', '119.23.51.159')
USER = os.environ.get('DEPLOY_SSH_USER', 'root')
LOCAL_ROOT = os.environ.get('DEPLOY_LOCAL_ROOT', 'E:/JC-ZJFA')

# SSH 密码仅从环境变量获取，禁止硬编码
PASS = os.environ.get('DEPLOY_SSH_PASS')
if not PASS:
    # 尝试从 .env.deploy 文件读取（gitignored）
    env_deploy = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env.deploy')
    if os.path.exists(env_deploy):
        with open(env_deploy, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('DEPLOY_SSH_PASS='):
                    PASS = line.split('=', 1)[1].strip().strip('"').strip("'")
                    break
if not PASS:
    print(c('R', '错误: 未设置 DEPLOY_SSH_PASS 环境变量或 .env.deploy 文件'))
    print(c('D', '请运行: set DEPLOY_SSH_PASS=your_password  (Windows)'))
    print(c('D', '或创建 .env.deploy 文件 (参考 .env.deploy.example)'))
    sys.exit(1)

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
    # 前端静态文件 → Nginx + Express 双路径（防止 Express fallback 使用旧文件）
    ('preview/index.html',                'both'),
    ('preview/app.js',                    'both'),
    ('preview/js/main.js',                'both'),
    ('preview/js/main-fusion.js',         'both'),
    ('preview/js/pages/quant-rank.js',    'both'),
    ('preview/js/pages/quant-rank-fusion.js','both'),
    ('preview/js/pages/match-pk.js',      'both'),
    ('preview/js/pages/match-pk-fusion.js','both'),
    ('preview/js/pages/ranking.js',       'both'),
    ('preview/js/pages/income.js',        'both'),
    ('preview/js/pages/plans.js',         'both'),
    ('preview/js/pages/hit-rate.js',      'both'),
        ('preview/js/pages/filter.js',        'both'),
        ('preview/js/pages/gongshoudao.js',   'both'),
        ('preview/js/charts.js',              'both'),
    ('preview/js/api.js',                 'both'),
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
    ('server/gongshoudao/fusion.js',      'both'),
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

def ssh_cmd(ssh, cmd, timeout=60):
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

    # 1) SFTP 批量上传到 /tmp（用 remote_path 的 hash 避免同名冲突）
    for local_path, remote_path in file_list:
        fname = os.path.basename(remote_path)
        # 用远程路径的 MD5 前8位保证唯一性，防止不同目录同名文件互相覆盖
        path_hash = hashlib.md5(remote_path.encode()).hexdigest()[:8]
        tmp_path = '/tmp/_dep_{}_{}'.format(path_hash, fname)
        try:
            sftp.put(local_path, tmp_path)
            tmp_files.append((local_path, remote_path, tmp_path))
        except Exception as e:
            results.append((False, os.path.basename(remote_path), 'SFTP', '-', str(e)[:50]))

    # 2) 构建批量 cp + md5 命令
    for local_path, remote_path, tmp_path in tmp_files:
        remote_dir = os.path.dirname(remote_path)
        cp_cmds.append('mkdir -p {d} && chattr -i {p} 2>/dev/null; cp -f {t} {p}'.format(
            d=remote_dir, t=tmp_path, p=remote_path))
        # 用远程完整路径做标记（而非 basename），避免同名文件验证冲突
        verify_cmds.append('echo "##{}##" && md5sum {}'.format(
            remote_path, remote_path))

    if not cp_cmds:
        return results

    batch_cmd = ' && '.join(cp_cmds) + ' && sync && ' + ' && '.join(verify_cmds)
    out, err = ssh_cmd(ssh, batch_cmd, len(tmp_files) * 5 + 10)

    # 3) 解析 md5sum 结果
    segments = out.split('##')
    md5_map = {}
    for i in range(1, len(segments) - 1, 2):
        fname = segments[i].strip()
        md5_str = segments[i + 1].strip().split()[0] if len(segments) > i + 1 else ''
        md5_map[fname] = md5_str

    # 4) 验证（用 remote_path 而非 basename 做 key，消除同名冲突）
    for local_path, remote_path, tmp_path in tmp_files:
        fname = os.path.basename(remote_path)
        with open(local_path, 'rb') as f:
            local_md5 = hashlib.md5(f.read()).hexdigest()
        remote_md5 = md5_map.get(remote_path, '')
        if remote_md5 == local_md5:
            results.append((True, fname, 'OK', local_md5, remote_md5))
        else:
            results.append((False, fname, 'MD5', local_md5[:8],
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
    quick_mode = '--quick' in sys.argv
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')

    if dry_run:
        print(c('Y', '\n*** DRY RUN — 不会实际部署 ***\n'))

    # ── 连接服务器 ──
    print(c('C', '连接 {} ...'.format(HOST)))
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    # SSH 密钥认证优先
    key_path = os.path.expanduser('~/.ssh/id_rsa_jczjfa')
    KEY_FILE = key_path if os.path.exists(key_path) else None

    try:
        if KEY_FILE:
            print(c('D', '  使用 SSH 密钥认证: ' + KEY_FILE))
            ssh.connect(HOST, username=USER, key_filename=KEY_FILE, timeout=10, port=22,
                        disabled_algorithms={'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']},
                        look_for_keys=False, allow_agent=False)
        else:
            ssh.connect(HOST, username=USER, password=PASS, timeout=10, port=22,
                        disabled_algorithms={'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']})
        print(c('G', ' ok'))
    except Exception as e:
        print(c('R', ' 失败: {}'.format(e)))
        sys.exit(1)

    sftp = ssh.open_sftp()

    # ── Phase 0: 环境检查（fast/quick 跳过） ──
    if not fast_mode and not quick_mode:
        print(c('C', '[Phase 0] 环境检查'))
        checks = {'Nginx': 'test -f /usr/sbin/nginx && echo OK', 'PM2': 'pm2 jlist 2>/dev/null | grep -c name || echo 0'}
        ok = True
        for label, cmd in checks.items():
            out, _ = ssh_cmd(ssh, cmd, 5)
            is_ok = 'OK' in out or (out.isdigit() and int(out) >= 2)
            if not is_ok: ok = False
            print('  {}: {}'.format(c('G','✓') if is_ok else c('R','✗'), label))
        if not ok:
            print(c('R', '⚠ 环境异常，请确认'))
            if input('继续？(y/N) ').lower() != 'y':
                sys.exit(0)
    print()

    # ── Phase 1: 备份数据（fast/quick 跳过） ──
    if fast_mode or quick_mode:
        print(c('Y', '[Phase 1] 跳过备份'))
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

    # ── Phase 3: 路径同步（fast/quick 跳过） ──
    if not fast_mode and not quick_mode and not dry_run:
        print(c('C', '[Phase 3] 路径同步'))
        out, _ = ssh_cmd(ssh,
            'rsync -aq --exclude="data.json" --exclude="live_scores.json" '
            '--exclude="trends.json" --exclude="cache.json" '
            '--exclude="ai_cache.json" --exclude="ai_timing.json" '
            '--exclude="midou_data.db" --exclude=".env" '
            '--exclude="logs" --exclude="node_modules" '
            '{}/server/ {}/server/ 2>&1 | tail -3'.format(PM2_ROOT, NGINX_ROOT), 15)
        print('  完成')
    print()

    # ── Phase 3.5: 修复 Nginx 缓存配置 ──
    if not dry_run:
        print(c('C', '[Phase 3.5] 修复 Nginx 缓存'))
        fix_cmds = (
            "CONF=$(ls /etc/nginx/conf.d/zj*.conf 2>/dev/null | head -1); "
            "if [ -z \"$CONF\" ]; then echo NOTFOUND; exit 0; fi; "
            "NEED_FIX=0; "
            # 1) 添加 Cache-Control header
            "if ! grep -q 'Cache-Control.*no-cache' \"$CONF\" 2>/dev/null; then "
            "cp \"$CONF\" \"${CONF}.bak.$(date +%Y%m%d_%H%M%S)\" 2>/dev/null; "
            "sed -i '/try_files.*index\\.html;/a\\        add_header Cache-Control \"no-cache, must-revalidate\";' \"$CONF\"; "
            "NEED_FIX=1; fi; "
            # 2) 移除或缩短 expires（防 JS 模块导入被浏览器缓存）
            "if grep -qP 'expires\\s+1h;' \"$CONF\" 2>/dev/null; then "
            "sed -i 's/expires 1h;/expires -1;/g' \"$CONF\"; "
            "NEED_FIX=1; fi; "
            "if grep -qP 'expires\\s+\\d+d;' \"$CONF\" 2>/dev/null; then "
            "sed -i 's/expires [0-9]*d;/expires -1;/g' \"$CONF\"; "
            "NEED_FIX=1; fi; "
            "if [ $NEED_FIX -eq 1 ]; then echo FIXED; else echo SKIP; fi"
        )
        out, _ = ssh_cmd(ssh, fix_cmds, 10)
        if 'FIXED' in out:
            print('  {}'.format(c('G', '已修复: 添加 Cache-Control')))
        elif 'SKIP' in out:
            print('  {}'.format(c('D', '无需修复')))
        elif 'NOTFOUND' in out:
            print('  {}'.format(c('Y', '未找到配置文件')))
        ssh_cmd(ssh, 'nginx -t 2>&1', 10)
        # 完全重启 Nginx + 刷新内核页缓存
        ssh_cmd(ssh, 'nginx -s stop 2>/dev/null; sync; echo 3 > /proc/sys/vm/drop_caches 2>/dev/null; sleep 2; nginx 2>&1', 20)
        print('  Nginx 已重启（内核页缓存已清除）')
    # ── 内容二次验证：检查关键文件是否更新 ──
    if not dry_run:
        critical_files = [
            # (本地路径, nginx路径, pm2路径, 验证grep)
            ('preview/index.html', NGINX_ROOT+'/preview/index.html', PM2_ROOT+'/preview/index.html', 'match-header-left'),
            ('preview/js/main-fusion.js', NGINX_ROOT+'/preview/js/main-fusion.js', PM2_ROOT+'/preview/js/main-fusion.js', 'V5.0-FUSION'),
            ('preview/js/pages/match-pk-fusion.js', NGINX_ROOT+'/preview/js/pages/match-pk-fusion.js', PM2_ROOT+'/preview/js/pages/match-pk-fusion.js', 'x.dir +'),
            ('preview/js/pages/quant-rank-fusion.js', NGINX_ROOT+'/preview/js/pages/quant-rank-fusion.js', PM2_ROOT+'/preview/js/pages/quant-rank-fusion.js', 'gs.homeOverRate != null'),
            ('preview/js/pages/match-list.js', NGINX_ROOT+'/preview/js/pages/match-list.js', PM2_ROOT+'/preview/js/pages/match-list.js', 'window.startMatchPK = startMatchPK'),
        ]
        any_fixed = False
        for rel, nginx_path, pm2_path, keyword in critical_files:
            test_cmd = "grep -c '{}' {} 2>/dev/null || echo 0".format(keyword, nginx_path)
            out, _ = ssh_cmd(ssh, test_cmd, 5)
            count = out.strip()
            if count.isdigit() and int(count) > 0:
                print('  {} {} OK ({} matches)'.format(c('G', '✓'), os.path.basename(nginx_path), count))
            else:
                print('  {} {} MISSING! Retrying via SFTP...'.format(c('R', '✗'), os.path.basename(nginx_path)))
                local_path = os.path.join(LOCAL_ROOT, rel)
                try:
                    sftp2 = ssh.open_sftp()
                    sftp2.put(local_path, nginx_path)
                    sftp2.put(local_path, pm2_path)
                    sftp2.close()
                    ssh_cmd(ssh, 'sync', 5)
                    out2, _ = ssh_cmd(ssh, test_cmd, 5)
                    print('    After SFTP: {} matches'.format(out2.strip()))
                    any_fixed = True
                except Exception as e2:
                    print('    SFTP failed: {}'.format(str(e2)[:80]))
        if any_fixed:
            # 有文件被重新写入，需要再次刷新 Nginx
            ssh_cmd(ssh, 'nginx -s reload 2>/dev/null && echo "reloaded"', 5)
            print('  Nginx reloaded (due to file fix)')
    print()

    sftp.close()

    # ── Phase 3.8: 清除旧缓存 + 刷新 nginx ──
    if not dry_run:
        print(c('C', '[Phase 3.8] 清除功守道缓存 + 重载 Nginx'))
        ssh_cmd(ssh, 'rm -f {0}/server/gongshoudao/cache.json {1}/server/gongshoudao/cache.json 2>/dev/null && echo "cache cleared"'.format(PM2_ROOT, NGINX_ROOT), 5)
        ssh_cmd(ssh, 'nginx -s reload 2>/dev/null && echo "nginx reloaded"', 5)
        print('  完成')
    print()

    # ── Phase 4: PM2 重启 ──
    if not dry_run:
        if quick_mode:
            ssh_cmd(ssh, 'pm2 restart jc-zjfa 2>&1', 10)
            print(c('G', '[Phase 4] PM2 已重启'))
        else:
            pm2_restart_and_verify(ssh)
    print()

    # ── Phase 4.5: 部署复验（确认文件未被还原） ──
    if not dry_run and upload_list:
        print(c('D', '═' * 54))
        print(c('C', '[Phase 4.5] 部署复验 — 确认服务器文件与本地一致'))
        # 对 both 文件同时校验 NGINX 和 PM2 两条路径（去重仅对同一路径）
        seen_pairs = set()
        recheck_list = []
        for lp, rp in upload_list:
            # 用 (lp, rp) 而不是 lp 做去重，确保 both 文件两条路径都校验
            key = rp
            if key not in seen_pairs:
                seen_pairs.add(key)
                recheck_list.append((lp, rp))
        # 批量获取服务器 MD5（用远程路径做标签，避免同文件双路径冲突）
        md5_cmds = []
        for lp, rp in recheck_list:
            md5_cmds.append('echo "##{}##" && md5sum {}'.format(rp, rp))
        if md5_cmds:
            batch_md5_cmd = ' && '.join(md5_cmds)
            out, _ = ssh_cmd(ssh, batch_md5_cmd, len(md5_cmds) * 3 + 10)
            segments = out.split('##')
            server_md5_map = {}
            for i in range(1, len(segments) - 1, 2):
                remote_path = segments[i].strip()
                md5_str = segments[i + 1].strip().split()[0] if len(segments) > i + 1 else ''
                server_md5_map[remote_path] = md5_str

            # 缓存本地文件 md5
            local_md5_cache = {}
            def get_local_md5(lp):
                if lp not in local_md5_cache:
                    with open(lp, 'rb') as f:
                        local_md5_cache[lp] = hashlib.md5(f.read()).hexdigest()
                return local_md5_cache[lp]

            recheck_ok = 0
            recheck_fail = []
            for lp, rp in recheck_list:
                local_md5 = get_local_md5(lp)
                server_md5 = server_md5_map.get(rp, '')
                if server_md5 == local_md5:
                    recheck_ok += 1
                else:
                    recheck_fail.append((os.path.basename(rp) + ' [' + rp.split('/preview/')[-1].split('/')[0] + ']', local_md5[:8], server_md5[:8] if server_md5 else 'MISSING'))

            if recheck_fail:
                print(c('R', '  ✗ 复验失败 — {} 个文件与服务器不一致（可能被还原）:'.format(len(recheck_fail))))
                for fname, lm, rm in recheck_fail:
                    print('    ✗ {} 本地:{} 服务器:{}'.format(fname, lm, rm))
                print(c('Y', '  请重新运行部署脚本'))
            else:
                print('  {} {} 个文件复验通过'.format(c('G', '✓'), recheck_ok))
    print()

    # ── Phase 5: 验证（quick 跳过） ──
    if not quick_mode and not dry_run:
        print(c('D', '═' * 54))
        print(c('C', '[Phase 5] 服务验证'))
        health, _ = ssh_cmd(ssh, 'curl -s http://localhost:3000/health 2>/dev/null', 5)
        print('  健康: {}'.format(c('G', health) if health == 'ok' else c('R', health or 'N/A')))

        out, _ = ssh_cmd(ssh, 'wc -c < {}/server/data.json 2>/dev/null'.format(PM2_ROOT), 5)
        print('  data.json: {}B'.format(out.strip() if out else c('R', 'MISSING!')))
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

    print(c('D', '\n用法: python deploy.py [--dry] [--fast] [--quick]'))
    print(c('D', '  --dry   试运行  --fast  跳过环境检测/备份/同步  --quick  仅上传+重启'))
    ssh.close()


if __name__ == '__main__':
    main()

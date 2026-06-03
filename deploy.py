# -*- coding: utf-8 -*-
"""
安全部署脚本 v3 — zj.100qiu.com 独立项目专用

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

v3 核心改进:
  1. 逐文件独立上传+验证（消除 && 链断裂导致后续文件静默跳过）
  2. 失败文件自动重试（最多2次）
  3. 全面关键文件验证（覆盖所有 DEPLOY_MAP 文件）
  4. Nginx reload 替代 stop+start（消除竞态）
  5. SSH 自动选择可用算法

用法: python deploy.py [--dry] [--fast] [--files-only] [--clear-gs-cache]
  --dry          试运行，不实际部署
  --fast         跳过备份和环境检查，快速部署（仍会验证）
  --files-only   仅部署前端文件 (preview/)，跳过服务器重启
  --clear-gs-cache  强制清除功守道缓存（默认保留旧缓存）
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

NGINX_ROOT = '/var/www/zj.100qiu.com'
PM2_ROOT   = '/root'

# ★ v3: 远程路径拼接用 / 而非 os.path.join（避免 Windows 混入反斜杠）
def remote_path(base, *parts):
    """安全拼接 Linux 远程路径，始终使用 / 分隔符，保留绝对路径前缀"""
    path = base.rstrip('/')
    for p in parts:
        path += '/' + p.strip('/')
    return path

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

DEPLOY_MAP = [
    # 前端静态文件 → Nginx + PM2 双路径
    ('preview/index.html',                'both'),
    ('preview/assets/expressionless-face.svg', 'both'),
    ('preview/assets/plan_icon.png',      'both'),
    ('preview/assets/tab_plan.svg',       'both'),
    ('preview/assets/zuqiu_soccer.svg',   'both'),
    ('preview/css/app.css',               'both'),
    ('preview/css/modals.css',            'both'),
    ('preview/app.js',                    'both'),
    ('preview/js/utils.js',               'both'),  # ★ v3 新增，之前遗漏
    ('preview/js/main.js',                'both'),
    ('preview/js/main-fusion.js',         'both'),
    ('preview/js/state.js',               'both'),  # ★ v3 新增
    ('preview/js/pages/quant-rank.js',    'both'),
    ('preview/js/pages/quant-rank-fusion.js','both'),
    ('preview/js/pages/match-pk.js',      'both'),
    ('preview/js/pages/match-pk-fusion.js','both'),
    ('preview/js/pages/match-list.js',    'both'),
    ('preview/js/pages/match-detail.js',  'both'),
    ('preview/js/pages/backtest.js',      'both'),
    ('preview/js/pages/ranking.js',       'both'),
    ('preview/js/pages/income.js',        'both'),
    ('preview/js/pages/plans.js',         'both'),
    ('preview/js/pages/hit-rate.js',      'both'),
    ('preview/js/pages/filter.js',        'both'),
    ('preview/js/pages/gongshoudao.js',   'both'),
    ('preview/js/pages/home.js',          'both'),  # ★ v3 新增
    ('preview/js/pages/scheme-design.js', 'both'),  # ★ 方案设计页
    ('preview/js/pages/betting.js',       'both'),  # ★ 投注弹窗
    ('preview/js/pages/confirm-scheme.js','both'),  # ★ 确认方案页
    ('preview/js/charts.js',              'both'),
    ('preview/js/api.js',                 'both'),
    ('preview/js/ws-client.js',           'both'),
    ('preview/js/api-schema.js',          'both'),  # ★ v3 新增
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
    ('server/fetch_shuju.js',             'both'),
    ('server/logger.js',                  'both'),
    ('server/catch_up.js',                'both'),
    ('server/websocket.js',               'both'),
    ('server/scheduler_v2.js',            'both'),
    ('server/gongshoudao/index.js',       'both'),
    ('server/gongshoudao/attack.js',      'both'),
    ('server/gongshoudao/goal.js',        'both'),
    ('server/gongshoudao/fusion.js',      'both'),
    ('server/gongshoudao/parser.js',      'both'),
    ('server/gongshoudao/diff.js',        'both'),
    ('server/gongshoudao/score.js',       'both'),
    ('server/gongshoudao/fetch.js',       'both'),
    ('server/gongshoudao/model-weights.js','both'),
    ('server/gongshoudao/cache_manager.js','both'),
    ('server/core/plan-generator.js',     'both'),
    # ★ v3 核心模块（index.js 直接 require，遗漏会导致运行时崩溃）
    ('server/core/cache.js',              'both'),
    ('server/core/midou.js',              'both'),
    ('server/core/ai-timing.js',          'both'),
    ('server/core/health.js',             'both'),
    ('server/database.js',                'both'),
    ('server/deepseek.js',                'both'),
    ('server/doubao.js',                  'both'),
    ('server/ai_merger.js',               'both'),
    ('server/ai_daemon.js',               'both'),
    ('server/prediction_log.js',          'both'),
    ('server/alert.js',                   'both'),
    # ★ V7.1 新增核心模块（market.js 依赖 + 影子账户 + 赔率追踪）
    ('server/core/odds-movement.js',      'both'),
    ('server/core/market-overlay.js',     'both'),
    ('server/core/odds-tracker.js',       'both'),
    ('server/core/bet-scheme-filters.js', 'both'),
    ('server/core/cache-warmer.js',       'both'),
    ('server/core/league-heat-profile.js','both'),
    ('server/core/match-context-collector.js','both'),
    ('server/core/shadow-account.js',     'both'),
    ('ecosystem.config.json',             'pm2'),
    ('.gitignore',                        'both'),
]

_env_checked_ok = False

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


def ssh_cmd_retry(ssh, cmd, timeout=10, retries=2):
    """带重试的 SSH 命令执行"""
    for attempt in range(retries):
        try:
            out, err = ssh_cmd(ssh, cmd, timeout)
            return out, err
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2)
            else:
                raise
    return '', 'retry exhausted'


# ══════════════════════════════════════════
# ★ v3 核心改进：逐文件独立上传 + 即时验证
# ══════════════════════════════════════════

def upload_one_file(sftp, ssh, local_path, remote_path, retries=2):
    """
    上传单个文件：SFTP→/tmp → SSH cp→目标 → 即时 md5 验证
    返回 (success, fname, label, local_md5, remote_md5)
    失败时自动重试
    """
    fname = os.path.basename(remote_path)
    remote_dir = os.path.dirname(remote_path)

    # 计算本地 MD5
    try:
        with open(local_path, 'rb') as f:
            local_md5 = hashlib.md5(f.read()).hexdigest()
    except Exception as e:
        return (False, fname, 'LOCAL_READ', '-', str(e)[:40])

    for attempt in range(retries):
        try:
            # 1) SFTP 上传到 /tmp
            path_hash = hashlib.md5(remote_path.encode()).hexdigest()[:8]
            tmp_path = '/tmp/_dep_{}_{}'.format(path_hash, fname)
            sftp.put(local_path, tmp_path)

            # 2) SSH: 创建目录 + 覆盖 + 同步 + md5 验证
            # 用 ; 而非 && 确保 cp 即使 chattr 失败也运行
            # 路径加单引号防特殊字符（比双引号更安全，无变量展开风险）
            script = (
                "mkdir -p '{}' 2>/dev/null; "
                "chattr -i '{}' 2>/dev/null; "
                "cp -f '{}' '{}' 2>/dev/null && sync && "
                "md5sum '{}'"
            ).format(remote_dir, remote_path, tmp_path, remote_path, remote_path)

            out, err = ssh_cmd(ssh, script, 15)
            remote_md5 = out.strip().split()[0] if out else ''

            # 3) 清理临时文件
            ssh_cmd(ssh, 'rm -f "{}" 2>/dev/null'.format(tmp_path), 3)

            # 4) 验证
            if remote_md5.lower() == local_md5.lower():
                return (True, fname, 'OK', local_md5[:8], remote_md5[:8])

            # MD5 不匹配，重试
            if attempt < retries - 1:
                time.sleep(1)
                continue

            return (False, fname, 'MD5', local_md5[:8],
                    remote_md5[:8] if remote_md5 else 'EMPTY')

        except Exception as e:
            # 清理临时文件
            try:
                ssh_cmd(ssh, 'rm -f /tmp/_dep_*_{} 2>/dev/null'.format(fname), 3)
            except:
                pass
            if attempt < retries - 1:
                time.sleep(2)
                continue
            return (False, fname, 'SFTP/SSH', '-', str(e)[:50])

    return (False, fname, 'RETRY_EXHAUSTED', '-', '-')


def batch_upload_v3(sftp, ssh, upload_list, dry_run=False):
    """
    v3 批量上传：逐文件独立处理，每个文件独立上传+验证
    彻底消除 && 链断裂导致的静默失败
    """
    results = []
    total = len(upload_list)

    if dry_run:
        for lp, rp in upload_list:
            results.append((True, os.path.basename(rp), 'DRY', '-', '-'))
        return results

    for idx, (local_path, remote_path) in enumerate(upload_list):
        fname = os.path.basename(remote_path)
        success, fname_out, label, lm, rm = upload_one_file(
            sftp, ssh, local_path, remote_path)

        results.append((success, fname_out, label, lm, rm))

        # 进度显示
        progress = ' [{}/{}]'.format(idx + 1, total)
        if success:
            print('  {} {} {}{}'.format(
                c('G', '✓'), fname_out, c('D', '[' + label + ']'), progress))
        else:
            print('  {} {} {} — {}{}'.format(
                c('R', '✗'), fname_out, c('D', '[' + label + ']'),
                rm[:40], progress))

    return results


# ══════════════════════════════════════════
# PM2 与 Nginx
# ══════════════════════════════════════════

def pm2_restart_and_verify(ssh):
    """重启 PM2 并验证新进程"""
    pm2_name = 'jc-zjfa'

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
    out, err = ssh_cmd_retry(ssh, 'pm2 restart {} --update-env 2>&1'.format(pm2_name), 15)
    time.sleep(3)

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
        print('  {} 新 PID: {} (旧: {}) 状态: {}'.format(
            c('G', '✓'), new_pid, old_pid or '-', status))
        return True
    elif new_pid:
        print('  {} PID 未变: {} (PM2 可能跳过了重启)'.format(c('Y', '⚠'), new_pid))
        return False
    else:
        print('  {} 无法获取进程状态'.format(c('R', '✗')))
        return False


def nginx_reload(ssh):
    """v3: 使用 reload 代替 stop+start，消除竞态"""
    out, err = ssh_cmd(ssh, 'nginx -t 2>&1', 10)
    if 'test is successful' in out.lower() or 'syntax is ok' in out.lower():
        out2, _ = ssh_cmd(ssh, 'nginx -s reload 2>&1', 10)
        print('  Nginx reloaded (配置测试通过)')
        return True
    else:
        # 配置可能有问题，尝试强制重启
        print('  {} Nginx 配置测试异常: {}'.format(c('Y', '⚠'), (out + err)[:100]))
        ssh_cmd(ssh, 'nginx -s stop 2>/dev/null; sleep 1; nginx 2>/dev/null', 15)
        print('  Nginx 已强制重启')
        return False


# ══════════════════════════════════════════
# 主流程
# ══════════════════════════════════════════

def main():
    dry_run = '--dry' in sys.argv
    fast_mode = '--fast' in sys.argv
    files_only = '--files-only' in sys.argv
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')

    if dry_run:
        print(c('Y', '\n*** DRY RUN — 不会实际部署 ***\n'))

    # ── 连接服务器 ──
    print(c('C', '连接 {} ...'.format(HOST)))
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    key_path = os.path.expanduser('~/.ssh/id_rsa_jczjfa')
    KEY_FILE = key_path if os.path.exists(key_path) else None

    # v3: 自动探测可用的 SSH 算法
    connect_ok = False
    if KEY_FILE:
        print(c('D', '  使用 SSH 密钥认证: ' + KEY_FILE))
        # 尝试多种算法组合
        algo_opts = [
            {},  # 默认
            {'disabled_algorithms': {'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']}},
        ]
        for opts in algo_opts:
            try:
                ssh.connect(HOST, username=USER, key_filename=KEY_FILE,
                            timeout=10, port=22,
                            look_for_keys=False, allow_agent=False, **opts)
                connect_ok = True
                break
            except Exception:
                continue

    if not connect_ok:
        for algo in [{}, {'disabled_algorithms': {'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']}}]:
            try:
                ssh.connect(HOST, username=USER, password=PASS,
                            timeout=10, port=22, **algo)
                connect_ok = True
                break
            except Exception:
                continue

    if not connect_ok:
        print(c('R', ' 失败: 所有认证方式均失败'))
        sys.exit(1)

    print(c('G', ' ok'))
    sftp = ssh.open_sftp()

    # ── Phase 0: 环境检查 ──
    if not fast_mode and not files_only:
        global _env_checked_ok
        if _env_checked_ok:
            print(c('G', '[Phase 0] 环境检查 ✓ (已通过)'))
        else:
            print(c('C', '[Phase 0] 环境检查'))
            checks = {
                'Nginx': 'test -f /usr/sbin/nginx && echo OK || echo FAIL',
                'PM2': 'pm2 ping 2>/dev/null && echo OK || echo FAIL'
            }
            ok = True
            for label, cmd in checks.items():
                try:
                    out, _ = ssh_cmd_retry(ssh, cmd, timeout=10, retries=2)
                    is_ok = 'OK' in out
                    if not is_ok:
                        ok = False
                    print('  {}: {}  → {}'.format(
                        c('G','✓') if is_ok else c('R','✗'), label, (out or '')[:60]))
                except Exception as e:
                    ok = False
                    print('  {}: {} → 超时/异常'.format(c('R','✗'), label))
            if ok:
                _env_checked_ok = True
            else:
                if not files_only:
                    print(c('Y', '⚠ 环境异常，继续部署可能有风险'))
                    if input('继续？(y/N) ').lower() != 'y':
                        sys.exit(0)
    print()

    # ── Phase 1: 备份 ──
    if fast_mode or files_only:
        print(c('Y', '[Phase 1] 跳过备份'))
    else:
        backup_dir = '/tmp/deploy_backup_' + ts
        print(c('C', '[Phase 1] 备份运行时数据'))
        if not dry_run:
            ssh_cmd(ssh, 'mkdir -p ' + backup_dir, 5)
            backed = 0
            for f in PROTECTED_FILES:
                rp = PM2_ROOT + '/' + f
                out, _ = ssh_cmd(ssh,
                    'test -f "{}" && cp "{}" "{}/{}" && echo OK || echo SKIP'.format(
                        rp, rp, backup_dir, os.path.basename(f)), 10)
                if 'OK' in out:
                    backed += 1
            print('  已备份 {} 个文件 → {}'.format(backed, backup_dir))
    print()

    # ── Phase 2: 批量上传 ──
    print(c('D', '═' * 54))
    print(c('C', '[Phase 2] 批量上传代码文件 (v3 逐文件独立验证)'))

    # v3: files-only 只上传预览文件，跳过服务端
    upload_list = []
    for rel_path, target in DEPLOY_MAP:
        local_path = os.path.join(LOCAL_ROOT, rel_path)
        if not os.path.exists(local_path):
            continue
        if files_only and not rel_path.startswith('preview/'):
            continue  # files-only 模式只部署前端
        if target in ('nginx', 'both'):
            upload_list.append((local_path, remote_path(NGINX_ROOT, rel_path)))
        if target in ('pm2', 'both') and not files_only:
            upload_list.append((local_path, remote_path(PM2_ROOT, rel_path)))

    total = len(upload_list)
    if dry_run:
        for lp, rp in upload_list:
            print('  {} → {}'.format(os.path.basename(lp), rp))
    else:
        results = batch_upload_v3(sftp, ssh, upload_list)

    print('  上传完成: {} 文件'.format(total))
    print()

    # ── Phase 2.5: Nginx 缓存清除 ──
    if not dry_run and not files_only:
        print(c('C', '[Phase 2.5] Nginx 缓存清除与重载'))
        nginx_reload(ssh)
        # 可选：清除内核页缓存（仅 fast/files-only 跳过）
        if not fast_mode:
            ssh_cmd(ssh, 'sync; echo 3 > /proc/sys/vm/drop_caches 2>/dev/null', 5)
            print('  内核页缓存已清除')
        print()

    # ── Phase 3: 部署复验 (v3: 全面验证所有文件) ──
    if not dry_run:
        print(c('D', '═' * 54))
        print(c('C', '[Phase 3] 部署复验 — 逐文件 MD5 校验'))

        seen_paths = set()
        recheck_list = []
        for lp, rp in upload_list:
            if rp not in seen_paths:
                seen_paths.add(rp)
                recheck_list.append((lp, rp))

        # 缓存本地 MD5
        local_md5_cache = {}
        def get_local_md5(lp):
            if lp not in local_md5_cache:
                try:
                    with open(lp, 'rb') as f:
                        local_md5_cache[lp] = hashlib.md5(f.read()).hexdigest()
                except:
                    local_md5_cache[lp] = None
            return local_md5_cache[lp]

        recheck_ok = 0
        recheck_fail = []

        for lp, rp in recheck_list:
            local_md5 = get_local_md5(lp)
            if local_md5 is None:
                recheck_fail.append((os.path.basename(rp), '-', 'LOCAL_ERROR'))
                continue
            # v3: 单个文件独立查询 md5（加引号保护路径）
            out, _ = ssh_cmd(ssh, "md5sum '{}' 2>/dev/null || echo 'MISSING'".format(rp), 5)
            remote_md5 = out.strip().split()[0] if out else 'MISSING'
            if remote_md5 == 'MISSING':
                remote_md5 = ''
            if remote_md5.lower() == local_md5.lower():
                recheck_ok += 1
            else:
                short_name = rp.replace(NGINX_ROOT + '/preview/', '').replace(NGINX_ROOT + '/', '').replace(PM2_ROOT + '/', '')
                recheck_fail.append((short_name, local_md5[:8],
                                     remote_md5[:8] if remote_md5 else 'MISSING'))

        if recheck_fail:
            print(c('R', '  ✗ 复验失败 — {} 个文件不一致:'.format(len(recheck_fail))))
            for fname, lm, rm in recheck_fail:
                print('    ✗ {}  本地:{}  服务器:{}'.format(fname, lm, rm))
            print(c('Y', '  → 将重试失败的文件...'))
            # v3: 自动重试失败文件
            retry_list = [(lp, rp) for (lp, rp) in recheck_list
                          if any(rp.endswith(f.split('/')[-1]) for f, _, _ in recheck_fail)]
            for lp, rp in retry_list:
                success, fn, lb, lm, rm = upload_one_file(sftp, ssh, lp, rp, retries=2)
                if success:
                    print('    {} {} 重试成功'.format(c('G', '✓'), fn))
                else:
                    print('    {} {} 重试失败: {}'.format(c('R', '✗'), fn, rm))
            # 再次验证
            final_fail = 0
            for lp, rp in retry_list:
                local_md5 = get_local_md5(lp)
                out, _ = ssh_cmd(ssh, "md5sum '{}' 2>/dev/null".format(rp), 5)
                remote_md5 = out.strip().split()[0] if out else ''
                if remote_md5.lower() != local_md5.lower():
                    final_fail += 1
                    print('    {} 文件仍不一致: {}'.format(c('R', '✗'), rp))
            if final_fail == 0:
                print('  {} 重试后全部通过'.format(c('G', '✓')))
            else:
                print(c('Y', '  ⚠ {} 个文件仍然不一致，建议重新部署'.format(final_fail)))
        else:
            print('  {} {} 个文件复验全部通过'.format(c('G', '✓'), recheck_ok))

        # v3: 修复后重载 Nginx
        nginx_reload(ssh)
        print()

    # ── Phase 3.5: 功守道缓存 ──
    clear_gs = '--clear-gs-cache' in sys.argv
    if not dry_run and not files_only:
        if clear_gs:
            print(c('C', '[Phase 3.5] 清除功守道缓存'))
            ssh_cmd(ssh, 'rm -f {0}/server/gongshoudao/cache.json {1}/server/gongshoudao/cache.json 2>/dev/null'.format(PM2_ROOT, NGINX_ROOT), 5)
            print('  已清除')
        else:
            print(c('C', '[Phase 3.5] 触发功守道缓存刷新（保留旧缓存）'))
            ssh_cmd(ssh, 'curl -s -X POST http://localhost:3000/api -H "Content-Type: application/json" -d \'{"action":"gongshoudao-all","date":"' + datetime.now().strftime('%Y-%m-%d') + '"}\' > /dev/null 2>&1 &', 5)
            print('  已触发')
        print()

    sftp.close()

    # ── Phase 4: PM2 重启 ──
    if not dry_run and not files_only:
        pm2_restart_and_verify(ssh)
        ssh_cmd(ssh, 'pm2 restart jc-sync 2>&1', 10)
        print('  PM2 jc-sync 已重启')
        print()

    # ── Phase 5: 服务验证 ──
    if not dry_run and not files_only:
        print(c('D', '═' * 54))
        print(c('C', '[Phase 5] 服务验证'))
        health, _ = ssh_cmd_retry(ssh, 'curl -s http://localhost:3000/health 2>/dev/null', 10, retries=3)
        health_ok = 'ok' in (health or '')
        print('  健康: {}'.format(c('G', health.strip()) if health_ok else c('R', health or 'N/A')))

        out, _ = ssh_cmd(ssh, 'wc -c < {}/server/data.json 2>/dev/null'.format(PM2_ROOT), 5)
        print('  data.json: {}B'.format(out.strip() if out else c('R', 'MISSING!')))
        print()

    # ── 汇总 ──
    print(c('D', '═' * 54))
    if dry_run:
        ok_count = total
    else:
        ok_count = sum(1 for r in results if r[0]) if 'results' in dir() else total
    fail_count = total - ok_count if not dry_run else 0

    if fail_count > 0:
        print(c('R', '⚠ 部署完成，但有 {} 个文件失败'.format(fail_count)))
        if not dry_run:
            for success, rel, label, lm, ri in results:
                if not success:
                    print('  ✗ {} [{}] → {}'.format(rel, label, ri[:50]))
    elif dry_run:
        print(c('Y', 'DRY RUN 完成 — 共 {} 个文件待部署'.format(total)))
    else:
        print(c('G', '部署成功 — {} 个文件全部验证通过'.format(total)))

    print(c('D', '\n用法: python deploy.py [--dry] [--fast] [--files-only] [--clear-gs-cache]'))
    print(c('D', '  --dry           试运行'))
    print(c('D', '  --fast          跳过环境检查/备份'))
    print(c('D', '  --files-only    仅部署前端文件 (preview/)，跳过服务器重启'))
    print(c('D', '  --clear-gs-cache  强制清除功守道缓存'))

    if files_only:
        print(c('Y', '\n  ★ files-only 模式: 仅上传了前端静态文件，未重启 PM2'))
        print(c('D', '    如需重启服务器: python deploy.py --fast'))

    ssh.close()


if __name__ == '__main__':
    main()

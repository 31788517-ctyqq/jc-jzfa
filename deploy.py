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

用法: python deploy.py [--dry] [--fast] [--files-only] [--clear-gs-cache] [--skip-catchup] [--catchup-days N]
  --dry            试运行，不实际部署
  --fast           跳过备份和环境检查，快速部署（仍会验证）
  --files-only     仅部署前端文件 (preview/)，跳过服务器重启
  --clear-gs-cache 强制清除功守道缓存（默认保留旧缓存）
  --skip-catchup   跳过部署后自动补算闭环
  --catchup-days N 部署后补算天数（默认 2：昨天+今天）
"""
import paramiko, sys, os, io, hashlib, re, time, json
from datetime import datetime, timedelta

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
    # ★ 修复：Nginx root 直读 index.html + JS/CSS（非 preview/ 子目录）
    ('index.html',                        'nginx'),
    ('preview/index.html',                'both'),
    # Nginx 从 root 目录读取 js/css，需要额外映射
    ('preview/js/main-fusion.js',         'nginx'),  # ★ 关键入口
    ('preview/js/vendor.js',              'nginx'),  # Phase1 vendor chunk
    ('preview/css/app.css',               'nginx'),  # 主样式
    ('preview/sw.js',                     'both'),  # P2-4: Service Worker
    ('preview/assets/expressionless-face.svg', 'both'),
    ('preview/assets/plan_icon.png',      'both'),
    ('preview/assets/tab_plan.svg',       'both'),
    ('miniprogram/images/zuqiu_soccer-duose.svg', 'nginx'),
    ('preview/assets/zuqiu_soccer-duose.svg', 'both'),
    ('preview/assets/zuqiu_soccer.svg',   'both'),

    # /assets/ URL 由 Nginx 映射到 miniprogram/images/，首页 banner 和 ECharts 库须部署到该目录
    ('miniprogram/images/worldcup/banner3.webp', 'nginx'),
    ('miniprogram/images/login-eagle.png',   'nginx'),  # ★ V9: 登录页背景图
    ('preview/laoying11.png',                'nginx'),  # ★ 个人中心/套餐/返利页鹰图
    ('miniprogram/images/echarts.min.js',      'nginx'),
    ('preview/css/app.css',               'both'),
    ('preview/css/modals.css',            'both'),
    ('preview/css/betting.css',           'both'),  # ★ 投注弹窗样式
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
    ('preview/js/pages/my-plan.js',       'both'),  # ★ 我的方案页
    ('preview/js/pages/hit-rate.js',      'both'),
    ('preview/js/pages/filter.js',        'both'),
    ('preview/js/pages/gongshoudao.js',   'both'),
    ('preview/js/pages/home.js',          'both'),  # ★ v3 新增
    ('preview/js/pages/scheme-design.js', 'both'),  # ★ 方案设计页
    ('preview/js/pages/betting.js',       'both'),  # ★ 投注弹窗
    ('preview/js/pages/confirm-scheme.js','both'),  # ★ 确认方案页
    ('preview/js/pages/login.js',          'both'),  # ★ V9: 登录页
    ('preview/js/pages/register.js',       'both'),  # ★ V9: 注册页（邀请链接）
    ('preview/js/pages/contact-invite.js', 'both'),  # ★ V9: 邀请制联系客服页（避免线上动态加载404）
    ('preview/js/pages/account-security.js','both'), # ★ V9: 账号安全页
    ('preview/js/pages/profile.js',        'both'),  # ★ V9: 个人主页

    # ★ 蓝图 V8.2 新增前端页面
    ('preview/js/pages/model-dashboard.js','both'), # ★ 模型仪表板
    ('preview/js/pages/data-health.js', 'both'),    # ★ 数据健康监控
    # ★ Phase 4 支付体系前端页面
    ('preview/js/pages/pricing.js',        'both'),
    ('preview/js/pages/payment.js',        'both'),
    ('preview/js/pages/payment-result.js', 'both'),
    ('preview/js/pages/subscription.js',   'both'),
    ('preview/js/pages/referral.js',       'both'),
    ('preview/js/pages/admin-payments.js', 'both'),
    ('preview/js/pages/admin-referrals.js','both'),
    ('preview/js/pages/admin.js',         'both'),  # ★ 统一管理后台
    ('preview/css/payments.css',           'both'),
    ('preview/css/admin.css',              'both'),  # ★ 管理后台样式
    ('preview/css/admin-v2.css',           'both'),  # ★ 管理后台实际加载样式
    ('preview/js/charts.js',              'both'),

    ('preview/js/api.js',                 'both'),
    ('preview/js/auth-client.js',         'both'),  # ★ V9: 认证客户端（main-fusion.js import）
    ('preview/js/vendor.js',              'both'),  # ★ Phase1: 共享模块合并（api+utils+state+auth-client）


    ('preview/js/ws-client.js',           'both'),
    ('preview/js/api-schema.js',          'both'),  # ★ v3 新增
    # 服务端 → PM2 运行时路径
    ('server/package.json',               'pm2'),
    ('server/package-lock.json',          'pm2'),
    ('server/index.js',                   'both'),
    ('server/jczqYz_fetcher.js',          'both'),
    ('server/jczq_change.js',             'both'),
    ('server/data_sync.js',               'both'),
    ('server/sync_gov_schedule.js',        'both'),  # ★ V9 P1: SP官方赛程轻量抓取
    ('server/bridge_sporttery_local.js',   'both'),  # ★ V9: SP本地数据桥接
    ('server/bridge_sp_gap_dates.js',      'both'),  # ★ V9: SP缺口日期修复
    ('server/sync_live_500.js',             'both'),  # ★ V9: 500.com 即时比分抓取
    ('server/sync_today_schedule.js',       'both'),  # ★ V9: 今日赛程高频检查器
    ('server/sync_sp_full.js',              'both'),  # ★ V9: SP全量数据每日同步(赛程+赔率+前瞻)
    ('server/auto_heal.js',               'both'),  # ★ V9 P2: 数据自动补漏
    ('server/batch_fetch_500all.js',       'both'),  # ★ V9 P2: 全玩法赔率批量抓取
    ('server/fetch_500all.js',             'both'),  # ★ V9 P2: 全玩法赔率抓取依赖
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
    # ★ Phase 4 支付体系服务端
    ('server/payments/index.js',           'both'),
    ('server/payments/schema.js',          'both'),
    ('server/payments/plans.js',           'both'),
    ('server/payments/orders.js',          'both'),
    ('server/payments/subscriptions.js',   'both'),
    ('server/payments/subscription-guard.js','both'),
    ('server/payments/alipay.js',          'both'),
    ('server/payments/alipay-callback.js', 'both'),
    ('server/payments/renewal-scheduler.js','both'),
    ('server/payments/referral-compute.js','both'),
    ('server/payments/referral-account.js','both'),
    ('server/payments/referral-anti-fraud.js','both'),
    # ★ Phase 3: 路由拆分
    ('server/routes/auth.js',             'both'),
    ('server/routes/users.js',            'both'),
    ('server/core/plan-generator.js',     'both'),
    ('server/core/plan-cache.js',         'both'),  # ★ 方案缓存共享模块
    ('server/core/sp_data_adapter.js',      'both'),  # ★ V9: SP官方数据统一访问层
    # ★ v3 核心模块（index.js 直接 require，遗漏会导致运行时崩溃）
    ('server/core/cache.js',              'both'),
    ('server/core/midou.js',              'both'),
    ('server/core/ai-timing.js',          'both'),
    ('server/core/health.js',             'both'),
    ('server/core/ingestion-guard.js',    'both'),  # ★ V9: 实时比分摄入门禁（data_sync/sync_live_500 依赖）
    ('server/core/match-data-pack.js',    'both'),  # ★ V9: data_sync 依赖，缺失会导致 jc-sync 启动失败
    ('server/database.js',                'both'),
    ('server/deepseek.js',                'both'),
    ('server/doubao.js',                  'both'),
    ('server/ai_merger.js',               'both'),
    ('server/auth-service.js',            'both'),  # ★ V9: 认证服务（index.js 第25行 require）
    ('server/ai_daemon.js',               'both'),
    ('server/prediction_log.js',          'both'),
    ('server/alert.js',                   'both'),
    # ★ V7.1 新增核心模块（market.js 依赖 + 影子账户 + 赔率追踪）
    ('server/core/odds-movement.js',      'both'),
    ('server/core/market-overlay.js',     'both'),
    ('server/core/odds-tracker.js',       'both'),
    ('server/core/odds-provider.js',      'both'),  # ★ V10: 统一赔率读取+ sporttery rawDB兜底
    # ★ V8.0 Phase 8+9 新增核心模块（原子写入 + 文件追踪 + 备份 + 数据质量）
    ('server/core/file-utils.js',         'both'),
    ('server/core/file-tracker.js',       'both'),
    ('server/core/data-quality.js',       'both'),
    ('server/core/bet-scheme-filters.js', 'both'),
    ('server/core/cache-warmer.js',       'both'),
    ('server/core/league-heat-profile.js','both'),
    ('server/core/match-context-collector.js','both'),
    ('server/core/shadow-account.js',     'both'),
    # ★ 蓝图 V8.2 新增核心模块（预测融合 + 特征工程 + 回填 + 质量监控）
    ('server/core/prediction-adapter.js', 'both'),
    ('server/backfill_expert_consensus.js', 'both'),  # ★ V9: 专家共识回填
    ('server/core/prediction-fusion.js', 'both'),
    ('server/core/feature-engine.js',    'both'),
    ('server/core/outcome-backfill.js',  'both'),
    ('server/core/data-quality.js',      'both'),
    # ★ V9.0 三源数据融合层（被 market/goal/feature-engine/index 依赖）
    ('server/core/data-fusion.js',       'both'),
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

    print('  PM2 零停机重载 {} ...'.format(pm2_name))
    out, err = ssh_cmd_retry(ssh, 'pm2 reload {} --update-env 2>&1'.format(pm2_name), 15)
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


def inject_nginx_502_retry(ssh):
    """★ 零停机部署：注入 Nginx 502 自动重试指令"""
    conf_path = '/etc/nginx/conf.d/zj.100qiu.com.conf'
    try:
        _, out, _ = ssh.exec_command('grep -q "proxy_next_upstream" {} 2>/dev/null && echo EXISTS || echo MISSING'.format(conf_path), timeout=5)
        has_retry = 'EXISTS' in out.read().decode()
        if has_retry:
            return  # already injected
    except:
        pass

    # Inject retry directives after proxy_read_timeout line
    cmd = (
        "sed -i '/proxy_read_timeout/a\\"
        "        proxy_next_upstream error timeout http_502 http_503;\\n"
        "        proxy_next_upstream_tries 2;\\n"
        "        proxy_next_upstream_timeout 3s;'"
        " {}".format(conf_path)
    )
    try:
        ssh.exec_command(cmd, timeout=5)
        print('  Nginx 502 重试指令已注入')
    except:
        pass


def nginx_reload(ssh):
    """v3: 使用 reload 代替 stop+start，消除竞态"""
    inject_nginx_502_retry(ssh)  # ★ 注入重试指令后 reload
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


def ensure_server_dependencies(ssh):
    """新增 npm 依赖时，确保 /root/server 运行时依赖已安装。"""
    required = ['sql.js', 'alipay-sdk', 'winston-daily-rotate-file', 'nodemailer', 'iconv-lite']
    check_js = "const mods={}; for (const m of %s) { try { require(m); mods[m]=true; } catch(e) { mods[m]=false; } } console.log(JSON.stringify(mods)); if (Object.values(mods).some(v=>!v)) process.exit(2);" % repr(required)
    check_cmd = "cd /root/server && node -e \"{}\" 2>&1".format(check_js.replace('"', '\\"'))
    out, _ = ssh_cmd(ssh, check_cmd, 10)
    if all(('\"{}\":true'.format(m) in (out or '')) for m in required):
        print('  {} server npm 依赖已就绪'.format(c('G', '✓')))
        return True
    print('  {} 检测到缺少 server npm 依赖，执行 npm install --omit=dev'.format(c('Y', '⚠')))
    out, err = ssh_cmd(ssh, 'cd /root/server && npm install --omit=dev --no-audit --no-fund 2>&1', 240)
    verify_out, _ = ssh_cmd(ssh, check_cmd, 10)
    ok = all(('\"{}\":true'.format(m) in (verify_out or '')) for m in required)
    print('  {} {}'.format(c('G', '✓') if ok else c('R', '✗'), (verify_out or out or err or '')[-300:]))
    return ok


def _get_flag_int(flag, default_value):
    """读取形如 --catchup-days 2 的整数参数。"""
    try:
        if flag not in sys.argv:
            return default_value
        idx = sys.argv.index(flag)
        if idx + 1 >= len(sys.argv):
            return default_value
        raw = sys.argv[idx + 1]
        if str(raw).startswith('--'):
            return default_value
        return int(raw)
    except Exception:
        return default_value


def _api_post_json(ssh, payload, timeout=40):
    """在远端调用本机 API，返回 (json_obj, raw_text, err_text)。"""
    try:
        body = json.dumps(payload, ensure_ascii=False)
        cmd = "curl -s -X POST http://localhost:3000/api -H \"Content-Type: application/json\" -d '{}' 2>&1".format(body)
        out, err = ssh_cmd(ssh, cmd, timeout)
        text = (out or '').strip()
        if not text:
            return None, text, err
        try:
            return json.loads(text), text, err
        except Exception:
            return None, text, err
    except Exception as e:
        return None, '', str(e)


def run_post_deploy_catchup(ssh, catchup_days=2):
    """部署后触发自动补算闭环：sync-match-date(昨天+今天) + gongshoudao-all + backfill-results。"""
    today = datetime.now().date()
    days = max(1, min(7, int(catchup_days or 2)))
    target_dates = [(today - timedelta(days=delta)).strftime('%Y-%m-%d') for delta in range(days - 1, -1, -1)]

    print(c('C', '[Phase 5.5] 部署后自动补算闭环'))
    print('  目标日期: {}'.format(', '.join(target_dates)))

    warn_count = 0

    # 1) 指定日期同步（后台异步执行）
    for ds in target_dates:
        resp, raw, err = _api_post_json(ssh, {'action': 'sync-match-date', 'date': ds}, timeout=20)
        if resp and resp.get('code') == 1:
            hint = ((resp.get('data') or {}).get('hint') or '').strip()
            print('  {} sync-match-date {} {}'.format(c('G', '✓'), ds, hint))
        else:
            warn_count += 1
            print('  {} sync-match-date {} 触发失败: {}'.format(c('Y', '⚠'), ds, (raw or err or 'N/A')[:160]))

    # 2) 触发当天功守道批量计算
    today_str = today.strftime('%Y-%m-%d')
    resp, raw, err = _api_post_json(ssh, {'action': 'gongshoudao-all', 'date': today_str}, timeout=30)
    if resp and resp.get('code') == 1:
        print('  {} gongshoudao-all {} 已触发'.format(c('G', '✓'), today_str))
    else:
        warn_count += 1
        print('  {} gongshoudao-all 触发失败: {}'.format(c('Y', '⚠'), (raw or err or 'N/A')[:160]))

    # 3) 触发赛果回填任务
    resp, raw, err = _api_post_json(ssh, {'action': 'backfill-results'}, timeout=20)
    if resp and resp.get('code') == 1:
        print('  {} backfill-results 已触发'.format(c('G', '✓')))
    else:
        warn_count += 1
        print('  {} backfill-results 触发失败: {}'.format(c('Y', '⚠'), (raw or err or 'N/A')[:160]))

    # 4) 数据就绪检查 + 覆盖率阈值告警
    time.sleep(2)
    ready_resp, ready_raw, ready_err = _api_post_json(ssh, {'action': 'data-readiness', 'date': today_str}, timeout=20)
    if ready_resp and ready_resp.get('code') == 1:
        info = ready_resp.get('data') or {}
        total_matches = int(info.get('totalMatches') or 0)
        ai_cov = float(info.get('aiCoverage') or 0)
        gs_cov = float(info.get('gsCoverage') or 0)
        pk_cov = float(info.get('pkCoverage') or 0)
        print('  readiness: 场次={} AI={}% GS={}% PK={}%'.format(total_matches, ai_cov, gs_cov, pk_cov))

        if total_matches > 5:
            if ai_cov < 80:
                warn_count += 1
                print('  {} 覆盖率告警: AI < 80%'.format(c('Y', '⚠')))
            if gs_cov < 85:
                warn_count += 1
                print('  {} 覆盖率告警: GS < 85%'.format(c('Y', '⚠')))
            if pk_cov < 75:
                warn_count += 1
                print('  {} 覆盖率告警: PK < 75%'.format(c('Y', '⚠')))
    else:
        warn_count += 1
        print('  {} data-readiness 查询失败: {}'.format(c('Y', '⚠'), (ready_raw or ready_err or 'N/A')[:160]))

    if warn_count > 0:
        print(c('Y', '  自动补算已执行，但存在 {} 个告警（不阻断部署）'.format(warn_count)))
    else:
        print(c('G', '  自动补算触发完成，无告警'))
    print()


# ══════════════════════════════════════════
# 主流程
# ══════════════════════════════════════════


def main():
    dry_run = '--dry' in sys.argv
    fast_mode = '--fast' in sys.argv
    files_only = '--files-only' in sys.argv
    skip_catchup = '--skip-catchup' in sys.argv
    catchup_days = _get_flag_int('--catchup-days', 2)
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

    # ★ Phase2 (Vite): 遍历 dist/ 目录上传所有构建产物
    dist_dir = os.path.join(LOCAL_ROOT, 'preview', 'dist')
    if os.path.isdir(dist_dir):
        for root, dirs, files in os.walk(dist_dir):
            for f in files:
                local_path = os.path.join(root, f)
                rel_path = os.path.relpath(local_path, LOCAL_ROOT).replace('\\', '/')
                upload_list.append((local_path, remote_path(NGINX_ROOT, rel_path)))
                if not files_only:
                    upload_list.append((local_path, remote_path(PM2_ROOT, rel_path)))

    total = len(upload_list)
    if dry_run:
        for lp, rp in upload_list:
            print('  {} → {}'.format(os.path.basename(lp), rp))
    else:
        results = batch_upload_v3(sftp, ssh, upload_list)

    print('  上传完成: {} 文件'.format(total))

    # ★ 修复：将 preview/js/ + preview/css/ 复制到 Nginx 根目录
    #   Nginx root 为 /var/www/zj.100qiu.com/，直接从根读 /js/main-fusion.js
    if not dry_run:
        print(c('C', '[Phase 2.4] 同步 JS/CSS 到 Nginx 根目录'))
        for sub in ['js', 'css']:
            src = f'{NGINX_ROOT}/preview/{sub}/'
            dst = f'{NGINX_ROOT}/{sub}/'
            ssh_cmd(ssh, f'mkdir -p {dst} 2>/dev/null; cp -rf {src}* {dst} && echo "  synced {sub}" || echo "  skip {sub}"', 5)
    print()

    # ── Phase 2.5: Nginx 缓存清除 ──
    if not dry_run and not files_only:
        print(c('C', '[Phase 2.5] Nginx 缓存清除与重载'))
        # ★ 清理 Vite dist 残留文件（防止 Nginx 服务旧版本）
        for dist_dir in ['/var/www/zj.100qiu.com/dist', '/var/www/zj.100qiu.com/preview/dist', '/root/preview/dist']:
            ssh_cmd(ssh, f'rm -rf {dist_dir} 2>/dev/null && echo "  cleaned {dist_dir}" || echo "  skip {dist_dir}"', 3)
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

    # ── Phase 3.6: 服务端 npm 依赖 ──
    if not dry_run and not files_only:
        print(c('C', '[Phase 3.6] 服务端 npm 依赖检查'))
        ensure_server_dependencies(ssh)
        print()

    sftp.close()

    # ── Phase 4: PM2 重启 ──
    if not dry_run and not files_only:
        pm2_restart_and_verify(ssh)
        ssh_cmd(ssh, 'pm2 reload jc-sync --kill-timeout 10000 2>&1', 10)
        print('  PM2 jc-sync 已重载（10s 优雅关闭）')
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

    # ── Phase 5.5: 部署后自动补算闭环 ──
    if not dry_run and not files_only:
        deploy_all_ok = all(r[0] for r in results) if 'results' in dir() else True
        if skip_catchup:
            print(c('Y', '[Phase 5.5] 已跳过自动补算（--skip-catchup）'))
            print()
        elif not deploy_all_ok:
            print(c('Y', '[Phase 5.5] 检测到文件上传失败，跳过自动补算'))
            print()
        else:
            run_post_deploy_catchup(ssh, catchup_days=catchup_days)

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

    print(c('D', '\n用法: python deploy.py [--dry] [--fast] [--files-only] [--clear-gs-cache] [--skip-catchup] [--catchup-days N]'))
    print(c('D', '  --dry             试运行'))
    print(c('D', '  --fast            跳过环境检查/备份'))
    print(c('D', '  --files-only      仅部署前端文件 (preview/)，跳过服务器重启'))
    print(c('D', '  --clear-gs-cache  强制清除功守道缓存'))
    print(c('D', '  --skip-catchup    跳过部署后自动补算闭环'))
    print(c('D', '  --catchup-days N  部署后补算天数（默认 2：昨天+今天，范围 1~7）'))

    if files_only:
        print(c('Y', '\n  ★ files-only 模式: 仅上传了前端静态文件，未重启 PM2'))
        print(c('D', '    如需重启服务器: python deploy.py --fast'))

    ssh.close()


if __name__ == '__main__':
    main()

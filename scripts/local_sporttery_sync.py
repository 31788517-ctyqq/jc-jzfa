"""
本地 Sporttery 数据同步脚本
  1. 本地运行 Playwright 抓取器（Python 3 + Playwright）
  2. SFTP 上传 sporttery_odds/ + sporttery_preview/ 到服务器
  3. 触发服务器桥接

用法:
  python scripts/local_sporttery_sync.py             # 抓取今天 + 上传
  python scripts/local_sporttery_sync.py --dry       # 仅抓取不推送
  python scripts/local_sporttery_sync.py --date 2026-06-22
  python scripts/local_sporttery_sync.py --upload-only  # 仅上传已有文件

依赖: pip install paramiko playwright
"""
import os, sys, subprocess, json, time, argparse
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
ODDS_DIR = PROJECT_ROOT / "server" / "sporttery_odds"
PREVIEW_DIR = PROJECT_ROOT / "server" / "sporttery_preview"
ODDS_DIR.mkdir(parents=True, exist_ok=True)
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

SERVER_HOST = "119.23.51.159"
SERVER_USER = "root"
SERVER_ODDS = "/root/server/sporttery_odds"
SERVER_PREVIEW = "/root/server/sporttery_preview"

# ═══ 步骤 1: 本地抓取 ═══
def run_local_scrape(date_str=None, force=True):
    """运行本地 Playwright 抓取器：先 odds (--today), 再 preview (--date 逐个场次)"""
    today = date_str or time.strftime("%Y-%m-%d")

    # 记录抓取前的文件状态
    before_odds = set(f.name for f in ODDS_DIR.glob("*.json"))
    before_preview = set(f.name for f in PREVIEW_DIR.glob("*.json"))

    # ── 阶段 A: odds 抓取 ──
    cmd_odds = [sys.executable, str(PROJECT_ROOT / "scripts" / "scrape_sporttery.py"), "--today"]
    if force:
        cmd_odds.append("--force")

    print(f"[1a/3] 本地抓取赔率: {' '.join(cmd_odds)}")
    print("-" * 50)
    result = subprocess.run(cmd_odds, cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=600)
    print(result.stdout[-500:] if len(result.stdout) > 500 else result.stdout)
    if result.stderr:
        print("[STDERR]", result.stderr[:300])

    # ── 阶段 B: preview 抓取（全量日期模式含前瞻）──
    cmd_preview = [sys.executable, str(PROJECT_ROOT / "scripts" / "scrape_sporttery.py"),
                   "--date", today]
    if force:
        cmd_preview.append("--force")

    print(f"\n[1b/3] 本地抓取前瞻: {' '.join(cmd_preview)}")
    print("-" * 50)
    result2 = subprocess.run(cmd_preview, cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=600)
    print(result2.stdout[-500:] if len(result2.stdout) > 500 else result2.stdout)
    if result2.stderr:
        print("[STDERR]", result2.stderr[:300])

    # 找出新文件
    after_odds = set(f.name for f in ODDS_DIR.glob("*.json"))
    after_preview = set(f.name for f in PREVIEW_DIR.glob("*.json"))
    new_odds = after_odds - before_odds
    new_preview = after_preview - before_preview

    # 也需要找最近 1 小时内修改的文件（--force 重写的）
    now = time.time()
    recent_odds = set(
        f.name for f in ODDS_DIR.glob("*.json")
        if now - f.stat().st_mtime < 3600
    )
    recent_preview = set(
        f.name for f in PREVIEW_DIR.glob("*.json")
        if now - f.stat().st_mtime < 3600
    )

    upload_odds = new_odds | recent_odds
    upload_preview = new_preview | recent_preview

    print()
    print(f"  新增 odds: {len(new_odds)}, 更新 odds: {len(recent_odds - new_odds)}")
    print(f"  新增 preview: {len(new_preview)}, 更新 preview: {len(recent_preview - new_preview)}")

    return upload_odds, upload_preview


# ═══ 步骤 2: SFTP 上传 ═══
def upload_to_server(odds_files, preview_files, dry=False):
    """通过 SFTP 上传文件到服务器"""
    import paramiko

    print(f"\n[2/3] SFTP 上传 {len(odds_files)} odds + {len(preview_files)} preview 文件...")
    print("-" * 50)

    if dry:
        for f in sorted(odds_files):
            print(f"  [DRY] {f} -> {SERVER_ODDS}/")
        for f in sorted(preview_files):
            print(f"  [DRY] {f} -> {SERVER_PREVIEW}/")
        return

    key_path = os.path.expanduser("~/.ssh/id_rsa_jczjfa")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    algo_opts = [
        {"disabled_algorithms": {"pubkeys": ["rsa-sha2-256", "rsa-sha2-512"]}},
        {},
    ]
    connected = False
    for opts in algo_opts:
        try:
            ssh.connect(SERVER_HOST, username=SERVER_USER, key_filename=key_path,
                        timeout=10, port=22, look_for_keys=False, allow_agent=False, **opts)
            connected = True
            break
        except Exception:
            continue

    if not connected:
        print("  [FAIL] SSH 连接失败")
        return

    sftp = ssh.open_sftp()

    # 确保远程目录存在
    for remote_dir in [SERVER_ODDS, SERVER_PREVIEW]:
        try:
            sftp.stat(remote_dir)
        except FileNotFoundError:
            sftp.mkdir(remote_dir)
            print(f"  创建目录: {remote_dir}")

    uploaded_odds = 0
    uploaded_preview = 0

    # 上传 odds
    for fname in sorted(odds_files):
        local_path = str(ODDS_DIR / fname)
        remote_path = f"{SERVER_ODDS}/{fname}"
        try:
            sftp.put(local_path, remote_path)
            uploaded_odds += 1
            if uploaded_odds <= 10:
                print(f"  ✓ {fname}")
        except Exception as e:
            print(f"  ✗ {fname}: {e}")

    if uploaded_odds > 10:
        print(f"  ... 共 {uploaded_odds} 个 odds 文件")

    # 上传 preview
    for fname in sorted(preview_files):
        local_path = str(PREVIEW_DIR / fname)
        remote_path = f"{SERVER_PREVIEW}/{fname}"
        try:
            sftp.put(local_path, remote_path)
            uploaded_preview += 1
            if uploaded_preview <= 10:
                print(f"  ✓ {fname}")
        except Exception as e:
            print(f"  ✗ {fname}: {e}")

    if uploaded_preview > 10:
        print(f"  ... 共 {uploaded_preview} 个 preview 文件")

    sftp.close()
    ssh.close()

    print(f"\n  上传完成: odds={uploaded_odds}, preview={uploaded_preview}")

    return uploaded_odds + uploaded_preview > 0


# ═══ 步骤 3: 触发桥接 ═══
def trigger_bridge():
    """触发服务器端的桥接脚本"""
    import paramiko

    print(f"\n[3/3] 触发服务器桥接...")
    print("-" * 50)

    key_path = os.path.expanduser("~/.ssh/id_rsa_jczjfa")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    algo_opts = [
        {"disabled_algorithms": {"pubkeys": ["rsa-sha2-256", "rsa-sha2-512"]}},
        {},
    ]
    connected = False
    for opts in algo_opts:
        try:
            ssh.connect(SERVER_HOST, username=SERVER_USER, key_filename=key_path,
                        timeout=10, port=22, look_for_keys=False, allow_agent=False, **opts)
            connected = True
            break
        except Exception:
            continue

    if not connected:
        print("  [FAIL] SSH 连接失败")
        return

    # 运行桥接
    stdin, stdout, stderr = ssh.exec_command(
        "cd /root/server && node -e "
        + repr("var s=require('./sync_sp_full');s.bridgeOddsToHistory().then(function(r){console.log(JSON.stringify(r))}).catch(function(e){console.log('ERR:',e.message)})"),
        timeout=120,
    )
    result = stdout.read().decode("utf-8", errors="replace").strip()
    print(f"  桥接结果: {result[:300]}")

    ssh.close()


# ═══ 主流程 ═══
def main():
    parser = argparse.ArgumentParser(description="本地 Sporttery 数据同步")
    parser.add_argument("--dry", action="store_true", help="仅抓取不上传")
    parser.add_argument("--upload-only", action="store_true", help="仅上传已有文件")
    parser.add_argument("--date", help="指定日期 YYYY-MM-DD")
    parser.add_argument("--no-bridge", action="store_true", help="跳过桥接")
    args = parser.parse_args()

    t0 = time.time()

    if args.upload_only:
        # 上传最近 24h 的所有文件
        now = time.time()
        odds_files = set(
            f.name for f in ODDS_DIR.glob("*.json")
            if now - f.stat().st_mtime < 86400
        )
        preview_files = set(
            f.name for f in PREVIEW_DIR.glob("*.json")
            if now - f.stat().st_mtime < 86400
        )
        print(f"待上传: {len(odds_files)} odds + {len(preview_files)} preview")
        upload_to_server(odds_files, preview_files, dry=args.dry)
    else:
        odds_files, preview_files = run_local_scrape(args.date)
        if odds_files or preview_files:
            upload_to_server(odds_files, preview_files, dry=args.dry)
        else:
            print("[SKIP] 无新文件需要上传")

    if not args.dry and not args.no_bridge and (odds_files if not args.upload_only else True):
        trigger_bridge()

    elapsed = time.time() - t0
    print(f"\n✓ 完成 ({elapsed:.0f}s)")


if __name__ == "__main__":
    main()

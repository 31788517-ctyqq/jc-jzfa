"""
从中国竞彩官网 (lottery.gov.cn + sporttery.cn) 抓取 2026 年全量赔率数据
覆盖: SPF / RQSPF / 比分 / 总进球 / 半全场 (含初盘->终盘变更历史)

策略: Playwright 模拟浏览器，从列表页点击"详细"链接进入详情（共用会话）

用法:
  单日:  python scripts/scrape_sporttery.py --date 2026-06-04
  范围:  python scripts/scrape_sporttery.py --start 2026-01-01 --end 2026-03-18
  预览:  python scripts/scrape_sporttery.py --dry
  全量:  python scripts/scrape_sporttery.py

依赖: pip install playwright && playwright install chromium
"""

import os, sys, json, time, re, argparse
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
ODDS_DIR = PROJECT_ROOT / "server" / "sporttery_odds"
SCHEDULE_DIR = PROJECT_ROOT / "server" / "sporttery_schedule"
PREVIEW_DIR = PROJECT_ROOT / "server" / "sporttery_preview"
ODDS_DIR.mkdir(parents=True, exist_ok=True)
SCHEDULE_DIR.mkdir(parents=True, exist_ok=True)
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

LIST_URL = "https://www.lottery.gov.cn/jc/zqsgkj/"
SCHEDULE_URL = "https://www.lottery.gov.cn/jc/zqszsc/"
DETAIL_BASE = "https://www.sporttery.cn/jc/zqdz/index.html"

parser = argparse.ArgumentParser(description="抓取竞彩官网数据")
parser.add_argument("--date", help="YYYY-MM-DD")
parser.add_argument("--start", help="起始日期 YYYY-MM-DD")
parser.add_argument("--end", help="结束日期 YYYY-MM-DD")
parser.add_argument("--dry", action="store_true")
parser.add_argument("--headless", action="store_true", default=True)
parser.add_argument("--schedule", action="store_true", help="抓取赛程页面")
parser.add_argument("--today", action="store_true", help="抓取今天赛程中的比赛（含赛前赔率+前瞻）")
parser.add_argument("--bridge", action="store_true", help="抓取后自动桥接到 SQLite")
parser.add_argument("--match-nums", help="指定match_num列表，逗号分隔（例: 周六213,周六217）")
args = parser.parse_args()

def get_dates():
    if args.start and args.end:
        s = datetime.strptime(args.start, "%Y-%m-%d")
        e = datetime.strptime(args.end, "%Y-%m-%d")
    elif args.date:
        return [args.date]
    else:
        s = datetime(2024, 1, 1)
        e = datetime.now()
    dates = []
    d = s
    while d <= e:
        dates.append(d.strftime("%Y-%m-%d"))
        d += timedelta(days=1)
    return dates

def already_scraped(mid):
    return (ODDS_DIR / f"{mid}.json").exists()

# ═══ 赛程抓取 ═══
def scrape_schedule(dry=False):
    """抓取竞彩赛程页 (jc/zqszsc/) — 表格结构，一次性加载所有赛程"""
    from playwright.sync_api import sync_playwright
    
    print("=" * 50)
    print("  竞彩赛程抓取 — lottery.gov.cn/jc/zqszsc/")
    if dry: print("  >>> DRY RUN\n")
    
    if dry:
        print("预览完成。执行: python scripts/scrape_sporttery.py --schedule")
        return
    
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=args.headless)
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0"
        )
        page = ctx.new_page()
        
        try:
            page.goto(SCHEDULE_URL, wait_until="networkidle", timeout=20000)
            time.sleep(2)
            
            # Extract schedule via JS
            schedule = page.evaluate("""() => {
                const text = document.body.innerText;
                const tables = [];
                document.querySelectorAll('table').forEach(t => {
                    const rows = [];
                    t.querySelectorAll('tr').forEach(r => {
                        const cells = Array.from(r.querySelectorAll('td,th')).map(c => c.innerText.trim());
                        if (cells.length >= 2) rows.push(cells);
                    });
                    if (rows.length > 0) tables.push(rows);
                });
                return { text: text.substring(0, 5000), tables };
            }""")
            
            if schedule and schedule.get("tables"):
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                fname = SCHEDULE_DIR / f"schedule_{ts}.json"
                with open(fname, "w", encoding="utf-8") as f:
                    json.dump(schedule, f, ensure_ascii=False, indent=2)
                
                # Parse and report
                match_count = schedule["text"].count("析\n讯")
                print(f"[OK] 保存: {fname.name}")
                print(f"     约 {match_count} 场比赛")
                
                # Show summary by date groups
                date_groups = re.findall(r'(周[一二三四五六日]) (\d{4}-\d{2}-\d{2}) 共(\d+)场', schedule["text"])
                for g in date_groups:
                    print(f"     {g[0]} {g[1]}: {g[2]} 场")
            else:
                print("[SKIP] 无赛程数据")
        except Exception as e:
            print(f"[FAIL] {e}")
        finally:
            page.close()
            ctx.close()
            browser.close()

# ═══ 赛事前瞻抓取 (showType=2) ═══
def parse_preview_page(match_id, page, dry=False):
    """解析赛事前瞻页 — 7大模块：特征分析、历史交锋、积分榜、比赛近况、未来赛事、射手、伤停"""
    url = f"{DETAIL_BASE}?showType=2&mid={match_id}"
    preview_file = PREVIEW_DIR / f"{match_id}.json"
    
    if preview_file.exists():
        return preview_file.name  # skip
    
    try:
        page.goto(url, wait_until="networkidle", timeout=30000, referer="https://www.lottery.gov.cn/")
        time.sleep(3)
        
        data = page.evaluate("""(mid) => {
            var result = { match_id: mid };
            
            // ── 特征分析 ──
            var fa = document.querySelector('.m-featureAnalysis');
            if (fa) {
                var labels = [];
                fa.querySelectorAll('.m-center .u-cont').forEach(function(c){ labels.push(c.innerText.trim()); });
                var homeVals = [];
                fa.querySelectorAll('.m-left .u-cont .data').forEach(function(c){ homeVals.push(c.innerText.trim()); });
                var awayVals = [];
                fa.querySelectorAll('.m-right .u-cont .data').forEach(function(c){ awayVals.push(c.innerText.trim()); });
                result.featureAnalysis = { labels: labels, home: homeVals, away: awayVals };
            }
            
            // ── 历史交锋 ──
            var h2hRows = [];
            document.querySelectorAll('#lsM .m-tableData tr').forEach(function(r) {
                var tds = r.querySelectorAll('td');
                if (tds.length >= 3) {
                    h2hRows.push({
                        date: tds[0].innerText.trim(),
                        league: tds[1].innerText.trim(),
                        teams: tds[2].innerText.replace(/\\n/g, ' ').replace(/\\s{2,}/g, ' ').trim(),
                        totalGoals: tds[3] ? tds[3].innerText.trim() : ''
                    });
                }
            });
            var h2hTitle = document.querySelector('#lsM .m-tableTitle');
            if (h2hTitle) {
                result.h2h = { title: h2hTitle.innerText.replace(/\\n/g, ' ').replace(/\\s{2,}/g, ' ').trim(), rows: h2hRows };
            }
            
            // ── 积分榜 ──
            var standings = [];
            document.querySelectorAll('#jfb .m-tableBox-1').forEach(function(box) {
                var teamEl = box.querySelector('.u-team');
                var team = teamEl ? teamEl.innerText.trim() : '';
                var titleEl = box.querySelector('.u-tit1');
                var title = titleEl ? titleEl.innerText.trim() : '';
                var rows = [];
                box.querySelectorAll('table tr').forEach(function(r) {
                    var tds = Array.from(r.querySelectorAll('td')).map(function(td){ return td.innerText.trim(); });
                    if (tds.length >= 7) {
                        rows.push({ where: tds[0], played: tds[1], wdl: tds[2], winRate: tds[3], goals: tds[4], gd: tds[5], points: tds[6], rank: tds[7] });
                    }
                });
                standings.push({ team: team, title: title, rows: rows });
            });
            result.standings = standings;
            
            // ── 比赛近况 ──
            var formTeams = [];
            document.querySelectorAll('#bsjk .m-tableBox-1').forEach(function(box) {
                var teamEl = box.querySelector('.u-team');
                var team = teamEl ? teamEl.innerText.trim() : '';
                var titleEl = box.querySelector('.u-tit1');
                var summaryEl = box.querySelector('.m-tableTitle-2');
                var summary = summaryEl ? summaryEl.innerText.replace(/\\n/g, ' ').replace(/\\s{2,}/g, ' ').trim() : '';
                var matches = [];
                box.querySelectorAll('table tr').forEach(function(r) {
                    var tds = r.querySelectorAll('td');
                    if (tds.length >= 4) {
                        matches.push({ date: tds[0].innerText.trim(), league: tds[1].innerText.trim(), vs: tds[2].innerText.replace(/\\n/g, ' ').replace(/\\s{2,}/g, ' ').trim(), result: tds[3].innerText.trim() });
                    }
                });
                formTeams.push({ team: team, summary: summary, matches: matches });
            });
            result.recentForm = formTeams;
            
            // ── 未来赛事 ──
            var futureTeams = [];
            document.querySelectorAll('#wlss .m-tableBox-1').forEach(function(box) {
                var teamEl = box.querySelector('.u-team');
                var team = teamEl ? teamEl.innerText.trim() : '';
                var none = box.querySelector('.m-listNone');
                var content = none ? none.innerText.trim() : '';
                var matches = [];
                if (!content) {
                    box.querySelectorAll('table tr').forEach(function(r) {
                        var tds = r.querySelectorAll('td');
                        if (tds.length >= 2) matches.push(Array.from(tds).map(function(td){ return td.innerText.trim(); }));
                    });
                }
                futureTeams.push({ team: team, content: content || 'has data', matches: matches });
            });
            result.futureMatches = futureTeams;
            
            // ── 射手信息 ──
            var scorers = [];
            document.querySelectorAll('#ssxx .m-tableBox-1').forEach(function(box) {
                var teamEl = box.querySelector('.u-team');
                var team = teamEl ? teamEl.innerText.trim() : '';
                var players = [];
                box.querySelectorAll('table tr').forEach(function(r) {
                    var tds = r.querySelectorAll('td');
                    if (tds.length >= 5) {
                        players.push({ player: tds[0].innerText.replace(/\\n/g, ' ').trim(), apps: tds[1].innerText.trim(), goals: tds[2].innerText.trim(), assists: tds[3].innerText.trim(), avg: tds[4].innerText.trim() });
                    }
                });
                scorers.push({ team: team, players: players });
            });
            result.scorers = scorers;
            
            // ── 伤停一览 ──
            var injuries = [];
            document.querySelectorAll('#styl .m-tableBox-1').forEach(function(box) {
                var teamEl = box.querySelector('.u-team');
                var team = teamEl ? teamEl.innerText.trim() : '';
                var none = box.querySelector('.m-listNone');
                if (none) {
                    injuries.push({ team: team, status: none.innerText.trim() });
                } else {
                    var players = [];
                    box.querySelectorAll('table tr').forEach(function(r) {
                        var tds = r.querySelectorAll('td');
                        if (tds.length >= 5) {
                            players.push({ player: tds[0].innerText.replace(/\\n/g, ' ').trim(), totalApps: tds[1].innerText.trim(), starts: tds[2].innerText.trim(), subs: tds[3].innerText.trim(), status: tds[4].innerText.trim() });
                        }
                    });
                    injuries.push({ team: team, players: players });
                }
            });
            result.injuries = injuries;
            
            return result;
        }""", match_id)
        
        if data and (data.get("featureAnalysis") or data.get("h2h") or data.get("standings")):
            if not dry:
                with open(preview_file, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
            return preview_file.name
        return None
    except Exception as e:
        print(f"    [WARN] Preview {match_id}: {e}")
        return None

# ═══ 今天实盘抓取（赛程->详情页赔率+前瞻）═══
LIVE_DETAIL_URL = "https://www.sporttery.cn/jc/zqdz/index.html"

def scrape_today_live(dry=False, match_nums_str=None):
    """
    抓取今天赛程中比赛的实盘赔率+前瞻。
    流程：赛程页 -> 提取match_id -> 详情页(showType=3赔率 + showType=2前瞻)
    
    Args:
        dry: 预览模式
        match_nums_str: 逗号分隔的match_num列表（如 "周六213,周六217"），为空则全量
    """
    from playwright.sync_api import sync_playwright

    today_str = datetime.now().strftime("%Y-%m-%d")
    filter_nums = set()
    if match_nums_str:
        filter_nums = set(n.strip() for n in match_nums_str.split(",") if n.strip())

    print("=" * 50)
    print(f"  今天实盘抓取 — {today_str}")
    print(f"  赛程页: {SCHEDULE_URL}")
    print(f"  详情页: {LIVE_DETAIL_URL}")
    if filter_nums:
        print(f"  过滤: {', '.join(sorted(filter_nums))}")
    if dry:
        print("  >>> DRY RUN")
    print()

    if dry:
        print("预览完成。执行: python scripts/scrape_sporttery.py --today")
        return

    saved_odds = 0
    saved_preview = 0
    start_time = time.time()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=args.headless)
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0"
        )
        page = ctx.new_page()

        # Step 1: 赛程页提取 match IDs
        print("[1/3] 赛程页提取比赛ID...")
        try:
            page.goto(SCHEDULE_URL, wait_until="networkidle", timeout=20000)
            time.sleep(3)
        except Exception as e:
            print(f"  赛程页加载失败: {e}")
            browser.close()
            return

        # 提取赛程中的比赛链接
        matches = page.evaluate("""() => {
            var results = [];
            // 赛程页：查找所有指向详情页的链接
            var allLinks = document.querySelectorAll('a');
            allLinks.forEach(function(a) {
                var href = a.href || '';
                var midMatch = href.match(/mid=(\\d+)/);
                if (midMatch) {
                    var row = a.closest('tr');
                    var rowText = row ? row.innerText.trim() : '';
                    // 提取 match_num（如 "周六213"）
                    var numMatch = rowText.match(/(周[一二三四五六日]\\d{3})/);
                    var matchNum = numMatch ? numMatch[1] : '';
                    var teamsMatch = rowText.match(/([^\\s]+)\\s*[vsVS]\\s*([^\\s]+)/i);
                    results.push({
                        mid: midMatch[1],
                        matchNum: matchNum,
                        home: teamsMatch ? teamsMatch[1] : '',
                        away: teamsMatch ? teamsMatch[2] : '',
                        rowText: rowText.substring(0, 200)
                    });
                }
            });
            // 也查 data-mid 属性
            document.querySelectorAll('[data-mid]').forEach(function(el) {
                var mid = el.getAttribute('data-mid');
                if (mid && !results.find(function(r) { return r.mid === mid; })) {
                    results.push({ mid: mid, matchNum: '', home: '', away: '', rowText: '' });
                }
            });
            return results;
        }""")

        if not matches:
            # Fallback: 从页面文本提取
            page_text = page.evaluate("() => document.body.innerText")
            # 尝试从文本匹配 match_num
            nums_found = re.findall(r'(周[一二三四五六日]\d{3})', page_text)
            print(f"  页面中找到 {len(nums_found)} 个 match_num: {', '.join(sorted(set(nums_found)))}")
            # 再尝试查找所有 mid 数值
            mid_found = re.findall(r'mid[=:](\d+)', page_text)
            if mid_found:
                for mid in mid_found:
                    if not any(m['mid'] == mid for m in matches):
                        matches.append({"mid": mid, "matchNum": "", "home": "", "away": "", "rowText": ""})
            if not matches:
                print("  [FAIL] 未找到任何比赛链接")
                browser.close()
                return

        print(f"  找到 {len(matches)} 场比赛")

        # 过滤指定 match_num
        if filter_nums:
            matches = [m for m in matches if m['matchNum'] in filter_nums]
            print(f"  过滤后: {len(matches)} 场 ({', '.join(m['matchNum'] for m in matches)})")
            if not matches:
                print("  [FAIL] 没有匹配的比赛")
                browser.close()
                return

        # Step 2: 逐个抓取详情页赔率
        print(f"\n[2/3] 抓取赔率详情 (showType=3)...")
        for idx, m in enumerate(matches):
            mid = m['mid']
            match_num = m['matchNum'] or f"未知{mid[:4]}"
            odds_file = ODDS_DIR / f"{mid}.json"

            # 检查是否已有（24小时内已抓则跳过）
            if odds_file.exists():
                age_hours = (time.time() - odds_file.stat().st_mtime) / 3600
                if age_hours < 24:
                    print(f"  [{idx+1}/{len(matches)}] {match_num} (mid={mid}) — 已存在({age_hours:.1f}h前), 跳过")
                    saved_odds += 1
                    continue

            try:
                url = f"{LIVE_DETAIL_URL}?showType=3&mid={mid}"
                page.goto(url, wait_until="networkidle", timeout=30000, referer="https://www.lottery.gov.cn/")
                time.sleep(3)

                # 提取数据（复用已有的提取逻辑）
                data = page.evaluate("""() => {
                    var result = {};
                    var topEl = document.querySelector('.u-top');
                    if (topEl) result.matchNum = topEl.innerText.replace(/\\\\n/g,' ').replace(/\\\\s+/g,' ').trim();
                    var btmEl = document.querySelector('.u-btm');
                    if (btmEl) result.matchInfo = btmEl.innerText.replace(/\\\\n/g,' ').replace(/\\\\s+/g,' ').trim();
                    result.home = document.querySelector('.u-middleLf a') ? document.querySelector('.u-middleLf a').innerText.trim() : '';
                    result.away = document.querySelector('.u-middleRt a') ? document.querySelector('.u-middleRt a').innerText.trim() : '';
                    var nums = document.querySelectorAll('.u-middleMid .num');
                    result.score = nums.length >= 2 ? (nums[0].innerText + ':' + nums[1].innerText) : '';
                    
                    // ★ 让球数（handicap）提取
                    var hcpEls = document.querySelectorAll('.u-handicap, .handicap, [class*="handicap"]');
                    var handicaps = [];
                    hcpEls.forEach(function(el) { handicaps.push(el.innerText.trim()); });
                    result.handicaps = handicaps;
                    
                    // 赔率表格
                    var allTables = [];
                    document.querySelectorAll('table').forEach(function(t) {
                        var rows = [];
                        t.querySelectorAll('tr').forEach(function(r) {
                            var cells = Array.from(r.querySelectorAll('td,th')).map(function(c) {
                                var txt = c.innerText.trim();
                                var imgs = c.querySelectorAll('img');
                                var trend = '';
                                if (imgs.length > 0) {
                                    var src = imgs[0].src || '';
                                    if (src.indexOf('icon_sjt') >= 0) trend = '↑';
                                    else if (src.indexOf('icon_xjt') >= 0) trend = '↓';
                                }
                                if (trend) txt += ' ' + trend;
                                return txt;
                            });
                            if (cells.length >= 2) rows.push(cells);
                        });
                        if (rows.length > 0) allTables.push(rows);
                    });
                    result.tables = allTables;
                    result.rawText = document.body.innerText.substring(0, 3000);
                    return result;
                }""")

                if data and data.get("tables") and len(data["tables"]) > 1:
                    data["_match_num"] = match_num
                    data["_scraped_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    with open(odds_file, "w", encoding="utf-8") as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)
                    saved_odds += 1

                    # 提取并打印 RQSPF 让球数
                    hcps = data.get("handicaps", [])
                    rqspf_info = ""
                    for tbl in data["tables"]:
                        if tbl and any("让球" in str(c) for row in tbl for c in row):
                            # 找让球数行
                            for row in tbl:
                                txt = " ".join(str(c) for c in row)
                                hcp_match = re.search(r'\([+-]?\d+\)', txt)
                                if hcp_match:
                                    rqspf_info += f" 让球{hcp_match.group()} "
                                    # 找赔率
                                    odds_match = re.findall(r'(\d+\.\d{2})', txt)
                                    if odds_match:
                                        rqspf_info += f"赔率:{'/'.join(odds_match[-3:])}"
                                    break
                            break
                    print(f"  [{idx+1}/{len(matches)}] {match_num} (mid={mid}) [OK] {rqspf_info}")
                else:
                    print(f"  [{idx+1}/{len(matches)}] {match_num} (mid={mid}) [WARN] 无赔率数据")

            except Exception as e:
                print(f"  [{idx+1}/{len(matches)}] {match_num} (mid={mid}) [ERR] {e}")

            time.sleep(1)  # 礼貌间隔

        # Step 3: 抓取赛事前瞻 (showType=2)
        print(f"\n[3/3] 抓取赛事前瞻 (showType=2)...")
        for idx, m in enumerate(matches):
            mid = m['mid']
            match_num = m['matchNum'] or f"未知{mid[:4]}"
            pv = parse_preview_page(mid, page, dry)
            if pv:
                saved_preview += 1
                print(f"  [{idx+1}/{len(matches)}] {match_num} [OK] 前瞻已保存")
            else:
                print(f"  [{idx+1}/{len(matches)}] {match_num} [WARN] 无前瞻数据")

        page.close()
        ctx.close()
        browser.close()

    elapsed = time.time() - start_time
    print(f"\n{'='*50}")
    print(f"  [Done] 赔率: {saved_odds} 场 | 前瞻: {saved_preview} 场")
    print(f"  odds: {ODDS_DIR}")
    print(f"  preview: {PREVIEW_DIR}")
    print(f"  耗时: {elapsed/60:.1f} min")

    # 如果指定了 match-nums，显示汇总
    if filter_nums:
        print(f"\n  ── 已验证场次 ──")
        for mn in sorted(filter_nums):
            found = False
            for f in sorted(ODDS_DIR.glob("*.json")):
                try:
                    d = json.loads(f.read_text(encoding="utf-8"))
                    if d.get("_match_num") == mn:
                        hcps = d.get("handicaps", [])
                        print(f"  {mn} (mid={f.stem}): {d.get('home','?')} vs {d.get('away','?')} | 让球信息: {'; '.join(hcps) if hcps else '未提取到'}")
                        found = True
                        break
                except:
                    pass
            if not found:
                print(f"  {mn}: 未抓取到数据")

# ═══ 自动桥接到 SQLite ═══
def run_bridge():
    """调用 bridge_sporttery_to_odds.js 将抓取结果写入 SQLite"""
    import subprocess
    print("\n" + "=" * 50)
    print("  自动桥接到 SQLite...")
    bridge_script = PROJECT_ROOT / "scripts" / "bridge_sporttery_to_odds.js"
    if not bridge_script.exists():
        print(f"  [FAIL] 桥接脚本不存在: {bridge_script}")
        return
    try:
        result = subprocess.run(
            ["node", str(bridge_script)],
            cwd=str(PROJECT_ROOT),
            capture_output=True, text=True, timeout=120
        )
        print(result.stdout)
        if result.stderr:
            print("[STDERR]", result.stderr[:500])
        print(f"  桥接完成 (exit={result.returncode})")
    except Exception as e:
        print(f"  [FAIL] 桥接失败: {e}")

def main():
    if args.schedule:
        scrape_schedule(args.dry)
        return
    if args.today:
        scrape_today_live(args.dry, args.match_nums)
        if args.bridge:
            run_bridge()
        return
    dates = get_dates()
    existing_count = len(list(ODDS_DIR.glob("*.json")))
    
    print("=" * 50)
    print(f"  竞彩官网赔率抓取 — {len(dates)} 天 ({dates[0]}~{dates[-1]})")
    print(f"  已有: {existing_count} 场")
    if args.dry: print("  >>> DRY RUN\n")
    
    if args.dry:
        print("预览完成。执行: python scripts/scrape_sporttery.py")
        return
    
    from playwright.sync_api import sync_playwright
    
    total = 0
    saved = 0
    skipped = 0
    
    start_time = time.time()
    
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=args.headless)
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0"
        )
        page = ctx.new_page()
        
        for di, date_str in enumerate(dates):
            day_new = 0
            day_skip = 0
            day_preview = 0
            day_total_match = 0
            
            try:
                # Navigate list page
                page.goto(LIST_URL, wait_until="networkidle", timeout=20000)
                time.sleep(2)
                
                # If not today, set date filter
                today = datetime.now().strftime("%Y-%m-%d")
                if date_str != today:
                    try:
                        page.fill("#start_date", date_str)
                        page.fill("#end_date", date_str)
                        page.click("a.u-btn")
                        time.sleep(3)
                    except:
                        pass
                
                # Get all match "详细" links
                detail_links = page.eval_on_selector_all(
                    "a[href*='showType=3']",
                    "els => els.map(e => ({href: e.href, mid: e.href.match(/mid=(\\d+)/)?.[1]}))"
                )
                
                day_total_match = len(detail_links) if detail_links else 0
                
                if not detail_links:
                    print(f"[{di+1}/{len(dates)}] {date_str} │ 0 场")
                    continue
                
                for link in detail_links:
                    mid = link["mid"]
                    if not mid:
                        continue
                    if already_scraped(mid):
                        skipped += 1
                        day_skip += 1
                        continue
                    total += 1
                    
                    # Navigate detail page via clicking (same context/cookies)
                    try:
                        page.goto(link["href"], wait_until="networkidle", timeout=30000, referer=LIST_URL)
                        time.sleep(3)
                        
                        # ★ 全量提取：赛事信息 + 球队排名战绩 + 赔率表格
                        data = page.evaluate("""() => {
                            const result = {};
                            
                            // ── 赛事基本信息 ──
                            const topEl = document.querySelector('.u-top');
                            if (topEl) {
                                result.matchNum = topEl.innerText.replace(/\\n/g,' ').replace(/\\s+/g,' ').trim();
                            }
                            const btmEl = document.querySelector('.u-btm');
                            if (btmEl) {
                                result.matchInfo = btmEl.innerText.replace(/\\n/g,' ').replace(/\\s+/g,' ').trim();
                            }
                            
                            // ── 球队名称 + 比分 ──
                            result.home = document.querySelector('.u-middleLf a')?.innerText.trim() || '';
                            result.away = document.querySelector('.u-middleRt a')?.innerText.trim() || '';
                            const nums = document.querySelectorAll('.u-middleMid .num');
                            result.score = nums.length >= 2 ? (nums[0].innerText + ':' + nums[1].innerText) : '';
                            
                            // ── 主队排名/战绩 ──
                            const homeCard = document.querySelector('.m-matchCard-Lf');
                            if (homeCard) {
                                const homePs = homeCard.querySelectorAll('.u-detail p');
                                const homeRecord = { rank: '', total: '', home: '' };
                                homePs.forEach(function(p) {
                                    const txt = p.innerText.trim();
                                    if (txt.indexOf('排名') >= 0) {
                                        homeRecord.rank = txt.replace(/[^0-9]/g,'');
                                    } else if (txt.indexOf('赛季总成绩') >= 0 || txt.indexOf('赛季成绩') >= 0) {
                                        homeRecord.total = txt.replace(/\\s{2,}/g,' ').trim();
                                    } else if (txt.indexOf('主场') >= 0) {
                                        homeRecord.home = txt.replace(/\\s{2,}/g,' ').trim();
                                    }
                                });
                                result.homeRecord = homeRecord;
                            }
                            
                            // ── 客队排名/战绩 ──
                            const awayCard = document.querySelector('.m-matchCard-Rt');
                            if (awayCard) {
                                const awayPs = awayCard.querySelectorAll('.u-detail p');
                                const awayRecord = { rank: '', total: '', away: '' };
                                awayPs.forEach(function(p) {
                                    const txt = p.innerText.trim();
                                    if (txt.indexOf('排名') >= 0) {
                                        awayRecord.rank = txt.replace(/[^0-9]/g,'');
                                    } else if (txt.indexOf('赛季总成绩') >= 0 || txt.indexOf('赛季成绩') >= 0) {
                                        awayRecord.total = txt.replace(/\\s{2,}/g,' ').trim();
                                    } else if (txt.indexOf('客场') >= 0) {
                                        awayRecord.away = txt.replace(/\\s{2,}/g,' ').trim();
                                    }
                                });
                                result.awayRecord = awayRecord;
                            }
                            
                            // ── 开奖结果 ──
                            result.lotteryResult = {};
                            const firstTable = document.querySelector('table.m-table-0');
                            if (firstTable) {
                                const rows = firstTable.querySelectorAll('tr');
                                rows.forEach(function(r) {
                                    const tds = r.querySelectorAll('td');
                                    if (tds.length >= 2) {
                                        const game = r.querySelector('th')?.innerText.trim() || '';
                                        const outcome = tds[0].innerText.trim();
                                        const prize = tds[1]?.innerText.trim() || '';
                                        if (game) result.lotteryResult[game] = { outcome, prize };
                                    }
                                });
                            }
                            
                            // ── 赔率表格（含时间序列）──
                            const allTables = [];
                            document.querySelectorAll('table').forEach(function(t) {
                                const rows = [];
                                t.querySelectorAll('tr').forEach(function(r) {
                                    const cells = Array.from(r.querySelectorAll('td,th')).map(function(c) {
                                        var txt = c.innerText.trim();
                                        var imgs = c.querySelectorAll('img');
                                        var trend = '';
                                        if (imgs.length > 0) {
                                            var src = imgs[0].src || '';
                                            if (src.indexOf('icon_sjt') >= 0) trend = '↑';
                                            else if (src.indexOf('icon_xjt') >= 0) trend = '↓';
                                        }
                                        if (trend) txt += ' ' + trend;
                                        return txt;
                                    });
                                    if (cells.length >= 2) rows.push(cells);
                                });
                                if (rows.length > 0) allTables.push(rows);
                            });
                            result.tables = allTables;
                            
                            // ── 纯文本兜底 ──
                            result.rawText = document.body.innerText.substring(0, 3000);
                            
                            return result;
                        }""")
                        
                        if data and data.get("tables") and len(data["tables"]) > 1:
                            fname = ODDS_DIR / f"{mid}.json"
                            if not args.dry:
                                with open(fname, "w", encoding="utf-8") as f:
                                    json.dump(data, f, ensure_ascii=False, indent=2)
                            saved += 1
                            day_new += 1
                            
                            # ★ 同时抓取赛事前瞻 (showType=2)
                            pv = parse_preview_page(mid, page, args.dry)
                            if pv:
                                day_preview += 1
                        else:
                            print(f"  [SKIP] mid={mid} — no data")
                    except Exception as e:
                        print(f"  [ERR] mid={mid}: {e}")
                
                time.sleep(0.5)
                
                # ── 日汇总 ──
                elapsed = time.time() - start_time
                eta = "--"
                if saved > 0 and di < len(dates) - 1:
                    est_total = elapsed / saved * (len(dates) * 6)  # rough estimate
                    eta = f"{est_total/60:.0f}min"
                print(f"[{di+1}/{len(dates)}] {date_str} | {day_total_match}场 新增{day_new} 预览{day_preview} 跳过{day_skip} | 累计{saved}/{total} | {elapsed/60:.0f}min" + (f" ETA:{eta}" if eta != "--" else ""))
            except Exception as e:
                print(f"[{di+1}/{len(dates)}] {date_str} │ FAIL: {e}")
        
        page.close()
        ctx.close()
        browser.close()
    
    elapsed = time.time() - start_time
    print(f"\n{'='*50}")
    print(f"  [Done] | 新增 {saved} 场赔率 + {total-saved} 跳过")
    print(f"  odds: {ODDS_DIR}")
    print(f"  preview: {PREVIEW_DIR}")
    print(f"  Time: {elapsed/60:.1f} min")
    
    if args.bridge:
        run_bridge()

if __name__ == "__main__":
    main()

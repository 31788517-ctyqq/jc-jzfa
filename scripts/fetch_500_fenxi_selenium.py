#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Selenium 增强爬虫: 抓取 JS 动态加载的数据
  - 近6场战绩 (点击 "6场" tab 触发)
  - 赛季积分表 (尝试多种方式获取)

用法:
  python scripts/fetch_500_fenxi_selenium.py 2026-05-27
  python scripts/fetch_500_fenxi_selenium.py 2026-05-27 --match 周三001
"""
import json, re, sys, io, os, time, random
from pathlib import Path
from datetime import datetime

if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from bs4 import BeautifulSoup

PROJECT_DIR = Path(__file__).resolve().parent.parent
SERVER_DIR = PROJECT_DIR / 'server'
SHUJU_DATA_DIR = SERVER_DIR / 'shuju_data'


def create_driver():
    """创建 headless Chrome 实例"""
    opts = Options()
    opts.add_argument('--headless=new')
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_argument('--disable-gpu')
    opts.add_argument('--disable-blink-features=AutomationControlled')
    opts.add_argument('--window-size=1920,1080')
    opts.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    opts.add_experimental_option('excludeSwitches', ['enable-automation'])
    opts.add_experimental_option('useAutomationExtension', False)
    return webdriver.Chrome(options=opts)


def scrape_match_selenium(driver, shuju_id, match_num, home_team, away_team):
    """用 Selenium 抓取单场比赛的 JS 动态数据"""
    url = f'https://odds.500.com/fenxi/shuju-{shuju_id}.shtml'
    print(f'  [SEL] {match_num} {home_team or "?"} vs {away_team or "?"} (shuju-{shuju_id})')

    result = {
        'matchNum': match_num, 'shujuId': shuju_id,
        'homeTeam': home_team, 'awayTeam': away_team,
        'recent6': {'home': {}, 'away': {}},
        'season': {'home': {}, 'away': {}}
    }

    try:
        driver.get(url)
        time.sleep(3)

        # ---- Step 0: 从页面标题获取队名 ----
        if not home_team or not away_team:
            title = driver.title
            vs_match = re.search(r'([\u4e00-\u9fa5a-zA-Z]+)VS([\u4e00-\u9fa5a-zA-Z]+)', title)
            if vs_match:
                home_team = home_team or vs_match.group(1).strip()
                away_team = away_team or vs_match.group(2).strip()
                result['homeTeam'] = home_team
                result['awayTeam'] = away_team

        # ---- Step 1: 先抓取初始 HTML (含百分比统计) ----
        initial_html = driver.page_source
        initial_soup = BeautifulSoup(initial_html, 'html.parser')
        initial_text = initial_soup.get_text()

        # 提取百分比: "胜率XX% 赢盘率YY% 大球率ZZ%"
        pct_entries = list(re.finditer(
            r'胜率\s*([\d.]+)\s*%\s*赢盘率\s*([\d.]+)\s*%\s*大球率\s*([\d.]+)\s*%',
            initial_text))

        # ---- Step 2: 点击所有 "6场" tabs 获取近6场数据 ----
        try:
            for btn in driver.find_elements(By.XPATH, "//*[text()='6场']"):
                try:
                    driver.execute_script("arguments[0].click();", btn)
                    time.sleep(0.5)
                except:
                    pass
            time.sleep(1.5)
        except:
            pass

        # ---- Step 3: 用渲染后的 page_source 提取近6场 WDL ----
        # (Selenium .text 只返回可见元素, page_source 包含隐藏元素)
        html = driver.page_source
        soup = BeautifulSoup(html, 'html.parser')
        page_text = soup.get_text()

        # ---- 2a. 近6场战绩 WDL + 进失球 ----
        rec6_all = list(re.finditer(
            r'([\u4e00-\u9fa5a-zA-Z]+)\s*近6场战绩\s*(\d+)\s*胜\s*(\d+)\s*平\s*(\d+)\s*负\s*进\s*(\d+)\s*球\s*失\s*(\d+)\s*球',
            page_text))

        for i, m in enumerate(rec6_all[:2]):
            team_text = m.group(1).strip()
            w, d, l = int(m.group(2)), int(m.group(3)), int(m.group(4))
            goals, conceded = int(m.group(5)), int(m.group(6))

            if home_team and team_text in home_team:
                target = 'home'
            elif away_team and team_text in away_team:
                target = 'away'
            else:
                target = 'home' if i == 0 else 'away'

            result['recent6'][target] = {'wins': w, 'draws': d, 'losses': l, 'goals': goals, 'conceded': conceded}

        # ---- 3b. 附加百分比 (从初始 HTML Step 1 中已提取) ----
        for j, pe in enumerate(pct_entries[:2]):
            target = 'home' if j == 0 else 'away'
            if result['recent6'].get(target):
                result['recent6'][target].update({
                    'winPct': float(pe.group(1)),
                    'handicapPct': float(pe.group(2)),
                    'overPct': float(pe.group(3))
                })

        # ---- 4. 赛季积分表 (勾选单独联赛触发) ----
        # 500.com 赛季表格需单独勾选当前联赛才加载数据
        # div.record_check 下有 input.zj0_0 (主队) 和 input.zj0_1 (客队) 两组复选框
        try:
            # 4a. 取消所有复选框, 只保留每队第一个(即该队的国内联赛)
            unchecked = driver.execute_script("""
                var groups = ['zj0_0', 'zj0_1'];
                for (var g = 0; g < groups.length; g++) {
                    var cbs = document.querySelectorAll('input.' + groups[g]);
                    if (cbs.length > 0) {
                        // 取消全部
                        for (var i = 0; i < cbs.length; i++) {
                            if (cbs[i].checked) {
                                cbs[i].click();
                            }
                        }
                    }
                }
                return 'unchecked';
            """)
            time.sleep(0.5)

            # 4b. 只勾选每队第一个联赛 (主队的国内联赛)
            driver.execute_script("""
                var groups = ['zj0_0', 'zj0_1'];
                for (var g = 0; g < groups.length; g++) {
                    var cbs = document.querySelectorAll('input.' + groups[g]);
                    if (cbs.length > 0 && !cbs[0].checked) {
                        cbs[0].click();
                    }
                }
            """)
            time.sleep(2)  # 等待 AJAX 加载赛季数据

            # 4c. 解析赛季表格
            season_html = driver.page_source
            season_soup = BeautifulSoup(season_html, 'html.parser')
            season_tables = []

            for table in season_soup.select('table'):
                t = table.get_text()
                if '比赛' in t and '积分' in t:
                    # 检查是否有实际数据 (>20 chars beyond header)
                    rows = table.select('tr')
                    data_cells = []
                    for r in rows:
                        cells = [c.get_text(strip=True) for c in r.select('td')]
                        for c in cells:
                            if c and c not in ['总成绩', '主场', '客场', '\xa0', '']:
                                data_cells.append(c)
                    if len(data_cells) >= 6:  # 有足够数据才加入
                        season_tables.append(table)

            sides = ['home', 'away']
            for idx, table in enumerate(season_tables[:2]):
                side = sides[idx] if idx < len(sides) else 'home'
                rows = table.select('tr')
                for row in rows:
                    cells = [c.get_text(strip=True) for c in row.select('td')]
                    # 跳过表头行
                    header_kw = ['比赛', '胜', '平', '负', '进', '失', '净', '积分', '排名', '胜率']
                    if all(c in header_kw for c in cells):
                        continue
                    if not cells or cells[0] == '\xa0' or cells[0] == '':
                        # 可能是总成绩行
                        cells = [c.get_text(strip=True) for c in row.select('td, th')]
                    
                    row_label = cells[0] if cells else ''
                    # Convert cells to numbers
                    numeric = []
                    for c in cells:
                        cs = c.replace('%', '').strip()
                        try:
                            if cs.isdigit() or (cs.startswith('-') and cs[1:].isdigit()):
                                numeric.append(int(cs))
                            else:
                                numeric.append(float(cs))
                        except:
                            numeric.append(None)
                    valid = [n for n in numeric if n is not None]
                    
                    if len(valid) >= 6:
                        mapped = {}
                        fnames = ['matches', 'wins', 'draws', 'losses', 'goals', 'conceded', 'goalDiff', 'points', 'rank', 'winPct']
                        for fi, fn in enumerate(fnames):
                            if fi < len(valid):
                                mapped[fn] = valid[fi]
                        
                        if '总成绩' in row_label:
                            result['season'][side] = mapped
                        elif '主场' in row_label:
                            if 'home' not in result['season'][side]:
                                result['season'][side] = {}
                            result['season'][side]['home'] = mapped
                        elif '客场' in row_label:
                            if 'away' not in result['season'][side]:
                                result['season'][side] = {}
                            result['season'][side]['away'] = mapped
                        elif not result['season'].get(side):  # 首行数据
                            result['season'][side] = mapped

        except Exception as e:
            # 赛季数据非关键，静默失败
            pass

        result['scrapedAt'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    except Exception as e:
        print(f'  [SEL-FAIL] {match_num}: {e}')
        result['error'] = str(e)

    return result


def main():
    if len(sys.argv) > 1:
        date_str = sys.argv[1]
    else:
        date_str = datetime.now().strftime('%Y-%m-%d')

    # 可选: 只抓取指定场次
    single_match = None
    for arg in sys.argv:
        if arg.startswith('--match='):
            single_match = arg.split('=', 1)[1]

    print(f'=== Selenium shuju fetch [{date_str}] ===')

    # 读取 shuju ID 映射
    map_file = SERVER_DIR / f'shuju_map_{date_str}.json'
    if not map_file.exists():
        print(f'[FAIL] map not found: {map_file}')
        sys.exit(1)

    with open(map_file, 'r', encoding='utf-8') as f:
        shuju_map = json.load(f)

    if not shuju_map:
        print('[WARN] empty map')
        sys.exit(0)

    # 读取 data.json 获取队名
    data_file = SERVER_DIR / 'data.json'
    match_info = {}
    if data_file.exists():
        with open(data_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        for k, v in data.get('m', {}).items():
            if v and v.get('date', '')[:10] == date_str and v.get('num'):
                match_info[v['num']] = {
                    'homeName': v.get('homeName', ''),
                    'visitName': v.get('visitName', '')
                }

    # 如果已有完整 Selenium 数据则跳过
    output_file = SHUJU_DATA_DIR / f'shuju_selenium_{date_str}.json'
    if output_file.exists() and output_file.stat().st_size > 100 and not single_match:
        print(f'[SKIP] already exists: {output_file}')
        return

    SHUJU_DATA_DIR.mkdir(parents=True, exist_ok=True)

    # 加载已有结果（增量更新）
    existing = {}
    if output_file.exists():
        try:
            with open(output_file, 'r', encoding='utf-8') as f:
                existing = json.load(f).get('matches', {})
        except:
            pass

    # 创建浏览器
    print('[INIT] starting headless Chrome...')
    driver = create_driver()
    results = dict(existing)

    try:
        match_nums = [single_match] if single_match else sorted(shuju_map.keys())
        print(f'[OK] {len(match_nums)} matches to fetch')

        for i, match_num in enumerate(match_nums):
            if match_num not in shuju_map:
                print(f'  [SKIP] {match_num} not in map')
                continue

            item = shuju_map[match_num]
            shuju_id = item['shujuId'] if isinstance(item, dict) else item
            info = match_info.get(match_num, {})
            home_name = info.get('homeName', '')
            away_name = info.get('visitName', '')

            result = scrape_match_selenium(driver, shuju_id, match_num, home_name, away_name)
            results[match_num] = result

            # 延迟防反爬
            if i < len(match_nums) - 1:
                time.sleep(random.uniform(1.5, 3.5))

    finally:
        driver.quit()

    # 保存
    output = {
        'date': date_str,
        'source': 'odds.500.com/fenxi/shuju (selenium)',
        'matchesCount': len(results),
        'matches': results,
        'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    ok = sum(1 for r in results.values() if 'error' not in r)
    fail = sum(1 for r in results.values() if 'error' in r)
    print(f'\n[OK] selenium done: {ok} ok, {fail} fail -> {output_file}')


if __name__ == '__main__':
    main()

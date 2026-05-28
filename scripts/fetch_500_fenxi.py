#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 odds.500.com/fenxi/shuju-{matchId}.shtml 抓取：
  1) 近期战绩对比（W/D/L 走势序列 + 进失球统计）
  2) 攻防数据对比（赛季数据 + 近6场数据）

数据来源: 500.com 全球指数分析页(shuju)
页面编码: GBK

用法:
  python scripts/fetch_500_fenxi.py 2026-05-27

输入: 读取 server/shuju_map_{date}.json (由 fetch_500odds.js:fetchShujuMap 生成)
输出: 写入 server/shuju_data/shuju_{date}.json
"""
import requests
import json
import re
import sys
import os
import io
import time
import random
from bs4 import BeautifulSoup
from datetime import datetime
from pathlib import Path

# Windows GBK 控制台兼容：强制 UTF-8 输出
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ========== 配置 ==========
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate',
    'Referer': 'https://trade.500.com/jczq/',
    'Connection': 'keep-alive',
}

PROJECT_DIR = Path(__file__).resolve().parent.parent
SERVER_DIR = PROJECT_DIR / 'server'
SHUJU_DATA_DIR = SERVER_DIR / 'shuju_data'


def fetch_page(url, max_retries=2):
    """获取页面内容，支持重试"""
    for attempt in range(max_retries + 1):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=20)
            resp.encoding = 'gbk'
            return resp.text
        except Exception as e:
            if attempt < max_retries:
                wait = (attempt + 1) * 2
                print(f'  [retry] fail, waiting {wait}s: {e}')
                time.sleep(wait)
            else:
                raise
    return None


def parse_recent_form(soup):
    """
    解析近期战绩 W/D/L 走势
    500.com 使用带颜色的 div 或 span 标识胜负平:
      - 胜(W): class含'win' / 'red' / 红色背景
      - 平(D): class含'draw' / 'grey' / 'blue'
      - 负(L): class含'lose' / 'green'
    红=主胜, 蓝=平, 绿=主负
    """
    result = {'w': 0, 'd': 0, 'l': 0, 'sequence': '', 'goals': None, 'conceded': None}

    # 方法1: 查找所有比赛记录球(小圆点)元素
    # 500.com shuju 页面的走势球结构
    form_items = []
    
    # 查找带颜色 class 的走势元素
    for cls_pattern in ['lqiu', 'chart', 'vs-content']:
        found = soup.select(f'.{cls_pattern}')
        if found:
            # 在每个区域内找有颜色标识的元素
            for container in found:
                # 查找红色球(胜)
                red_items = container.select('[style*="background-color:red"], [style*="background:#f00"], [style*="background:red"], [bgcolor="red"], [class*="red"], [class*="win"], .red, .win, font[color="red"], font[color="#ff0000"]')
                # 查找蓝色/灰色球(平)
                blue_items = container.select('[style*="background-color:blue"], [style*="background:#00f"], [style*="background:blue"], [style*="background-color:grey"], [style*="background:grey"], [style*="background-color:gray"], [style*="background:gray"], [bgcolor="blue"], [class*="blue"], [class*="draw"], .blue, .draw, font[color="blue"], font[color="#0000ff"]')
                # 查找绿色球(负)
                green_items = container.select('[style*="background-color:green"], [style*="background:#0f0"], [style*="background:green"], [style*="background-color:#090"], [bgcolor="green"], [class*="green"], [class*="lose"], .green, .lose, font[color="green"], font[color="#008000"]')
                
                if red_items or blue_items or green_items:
                    result['w'] += len(red_items)
                    result['d'] += len(blue_items)
                    result['l'] += len(green_items)

    # 方法2: 如果方法1没找到，尝试从表格文字解析
    if result['w'] == 0 and result['d'] == 0 and result['l'] == 0:
        tables = soup.select('table')
        for table in tables:
            cells_text = table.get_text()
            if '近期' in cells_text or '战绩' in cells_text or '历史' in cells_text:
                # 尝试匹配 W/D/L 或 胜/平/负 计数字段
                patterns = [
                    (r'胜\s*(\d+)场', 'w'),
                    (r'平\s*(\d+)场', 'd'),
                    (r'负\s*(\d+)场', 'l'),
                    (r'(\d+)胜\s*(\d+)平\s*(\d+)负', 'wdll'),
                    (r'W\s*:\s*(\d+)', 'w'),
                    (r'D\s*:\s*(\d+)', 'd'),
                    (r'L\s*:\s*(\d+)', 'l'),
                ]
                all_text = ' '.join([r.get_text(strip=True) for r in table.select('tr')])
                for pat, key in patterns:
                    match = re.search(pat, all_text)
                    if match:
                        if key == 'wdll':
                            result['w'] = int(match.group(1))
                            result['d'] = int(match.group(2))
                            result['l'] = int(match.group(3))
                            break
                        else:
                            result[key] = int(match.group(1))
                if result['w'] > 0 or result['d'] > 0:
                    break

    return result


def parse_attack_defense(soup, home_team='', away_team=''):
    """
    解析攻防数据对比表 (2026-05-27 实测结构):
      - 赛季积分表: 比赛/胜/平/负/进/失/净/积分/排名/胜率 (主客各一)
      - 近10场战绩: 4个实例 [主-全联赛, 客-全联赛, 主-同赛事, 客-同赛事]
      - 胜率/赢盘率/大球率: 跟在近10场后面的百分比
      - 近6场: JS动态加载(在走势图区域)
    """
    data = {
        'home': {'recent10': {}, 'season': {}, 'recent6': {}},
        'away': {'recent10': {}, 'season': {}, 'recent6': {}}
    }

    tables = soup.select('table')
    all_text = soup.get_text()
    sides = ['home', 'away']

    # ---- 1. 赛季数据表格 ----
    season_tables = []
    for table in tables:
        text = table.get_text()
        if '比赛' in text and '积分' in text:
            season_tables.append(table)

    for idx, table in enumerate(season_tables[:2]):
        side = sides[idx] if idx < len(sides) else 'home'
        rows = table.select('tr')
        for row in rows:
            cells = [c.get_text(strip=True) for c in row.select('td, th')]
            if not cells:
                continue
            # 跳过表头
            if all(c in ['比赛', '胜', '平', '负', '进', '失', '净', '积分', '排名', '胜率'] for c in cells):
                continue
            # 转数字
            numeric = []
            for c in cells:
                cs = c.replace('%', '').strip()
                try:
                    numeric.append(int(cs) if (cs.isdigit() or (cs.startswith('-') and cs[1:].isdigit())) else float(cs))
                except:
                    numeric.append(None)
            valid = [n for n in numeric if n is not None]
            if len(valid) >= 6:
                mapped = {}
                fnames = ['matches', 'wins', 'draws', 'losses', 'goals', 'conceded', 'goalDiff', 'points', 'rank', 'winPct']
                for fi, fn in enumerate(fnames):
                    if fi < len(valid):
                        mapped[fn] = valid[fi]
                if not data[side]['season']:
                    data[side]['season'] = mapped

    # ---- 2. 近10场战绩文本 (4个实例) ----
    rec10_pat = re.compile(r'([\u4e00-\u9fa5a-zA-Z]+)\s*近10场战绩\s*(\d+)\s*胜\s*(\d+)\s*平\s*(\d+)\s*负\s*进\s*(\d+)\s*球\s*失\s*(\d+)\s*球')
    all_recs = list(rec10_pat.finditer(all_text))

    pct_pat = re.compile(r'胜率\s*(\d+)\s*%\s*赢盘率\s*(\d+)\s*%\s*大球率\s*(\d+)\s*%')
    all_pcts = list(pct_pat.finditer(all_text))

    for i, m in enumerate(all_recs):
        team_text = m.group(1).strip()
        w, d, l = int(m.group(2)), int(m.group(3)), int(m.group(4))
        goals, conceded = int(m.group(5)), int(m.group(6))

        # 判断主/客队
        if home_team and team_text in home_team:
            target = 'home'
        elif away_team and team_text in away_team:
            target = 'away'
        else:
            target = 'home' if i % 2 == 0 else 'away'

        league_type = 'allLeagues' if i < 2 else 'sameLeague'
        entry = {'wins': w, 'draws': d, 'losses': l, 'goals': goals, 'conceded': conceded}

        if i < len(all_pcts):
            pct = all_pcts[i]
            entry['winPct'] = int(pct.group(1))
            entry['handicapPct'] = int(pct.group(2))
            entry['overPct'] = int(pct.group(3))

        if league_type == 'allLeagues':
            if not data[target]['recent10']:
                data[target]['recent10'] = entry
        else:
            if 'recent10League' not in data[target]:
                data[target]['recent10League'] = entry

    # ---- 3. 近期战绩表格(补充验证) ----
    hist_tables = []
    for table in tables:
        t = table.get_text()
        if '赛事' in t and '盘口' in t:
            hist_tables.append(table)

    for idx, table in enumerate(hist_tables[:2]):
        side = sides[idx] if idx < len(sides) else 'home'
        w, d, l = 0, 0, 0
        for row in table.select('tr')[1:]:
            cells = [c.get_text(strip=True) for c in row.select('td')]
            if len(cells) >= 8:
                r = cells[7]
                if '胜' in r: w += 1
                elif '平' in r: d += 1
                elif '负' in r: l += 1
        if (w + d + l) > 0 and not data[side]['recent10'].get('wins'):
            data[side]['recent10'] = {'wins': w, 'draws': d, 'losses': l}

    return data


def parse_match_teams(soup):
    """解析比赛双方队名"""
    home = ''
    away = ''

    # 尝试从标题获取
    title_tag = soup.select_one('title')
    if title_tag:
        title_text = title_tag.get_text()
        # 例如: "水晶宫 VS 巴列卡诺_全球指数分析_500.com"
        vs_match = re.search(r'([\u4e00-\u9fa5a-zA-Z]+)\s*VS\s*([\u4e00-\u9fa5a-zA-Z]+)', title_text, re.IGNORECASE)
        if vs_match:
            home = vs_match.group(1).strip()
            away = vs_match.group(2).strip()

    # 从页面内容获取
    if not home:
        for selector in ['.team-l a', '.team-r a', '.home-team', '.away-team', '.m-title']:
            elems = soup.select(selector)
            if len(elems) >= 2:
                home = elems[0].get_text(strip=True)
                away = elems[1].get_text(strip=True)
                break

    return home, away


def parse_match_league(soup):
    """解析联赛名称"""
    # 常见位置: 面包屑导航 或 比赛信息区
    for selector in ['.location a', '.league-name', '.breadcrumb a:last-child', '.vs-info .league']:
        elem = soup.select_one(selector)
        if elem:
            text = elem.get_text(strip=True)
            # 过滤掉非联赛文本
            if len(text) >= 2 and '析' not in text and '指数' not in text:
                return text
    return ''


def scrape_match(shuju_id, match_num, home_team, away_team):
    """抓取单场比赛的 shuju 数据"""
    url = f'https://odds.500.com/fenxi/shuju-{shuju_id}.shtml'
    print(f'  [->] {match_num} {home_team} vs {away_team} (shuju-{shuju_id})')

    try:
        html = fetch_page(url)
        soup = BeautifulSoup(html, 'html.parser')

        # 如果标题没有队名，从页面中解析
        page_home, page_away = parse_match_teams(soup)
        if page_home:
            home_team = page_home
        if page_away:
            away_team = page_away

        league = parse_match_league(soup)

        # 获取主客队数据区域
        # 500.com fenxi 页面通常有两个 table 并排，分别为主客队
        # 传入队名以帮助主客队匹配
        attack_def = parse_attack_defense(soup, home_team, away_team)

        return {
            'matchNum': match_num,
            'shujuId': shuju_id,
            'homeTeam': home_team,
            'awayTeam': away_team,
            'leagueName': league,
            'url': url,
            'attackDefense': attack_def,
            'scrapedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }
    except Exception as e:
        print(f'  [FAIL] {match_num} fetch error: {e}')
        return {
            'matchNum': match_num,
            'shujuId': shuju_id,
            'homeTeam': home_team,
            'awayTeam': away_team,
            'error': str(e)
        }


def main():
    # 读取日期参数
    if len(sys.argv) > 1:
        date_str = sys.argv[1]
    else:
        date_str = datetime.now().strftime('%Y-%m-%d')

    print(f'=== 500.com shuju fetch [{date_str}] ===')

    # 1. 读取 shuju ID 映射表
    map_file = SERVER_DIR / f'shuju_map_{date_str}.json'
    if not map_file.exists():
        print(f'[FAIL] map file not found: {map_file}')
        print('  please ensure data_sync.js generated the shuju ID mapping')
        sys.exit(1)

    with open(map_file, 'r', encoding='utf-8') as f:
        shuju_map = json.load(f)

    if not shuju_map:
        print('[WARN] map empty, no data to fetch')
        sys.exit(0)

    print(f'[OK] loaded map: {len(shuju_map)} matches')

    # 2. 读取 data.json 获取队名等补充信息
    data_file = SERVER_DIR / 'data.json'
    match_info = {}
    if data_file.exists():
        with open(data_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        m_map = data.get('m', {})
        for k, v in m_map.items():
            if v and v.get('date', '')[:10] == date_str and v.get('num'):
                match_info[v['num']] = {
                    'homeName': v.get('homeName', ''),
                    'visitName': v.get('visitName', ''),
                    'leagueName': v.get('leagueName', '')
                }

    # 3. 逐场抓取
    SHUJU_DATA_DIR.mkdir(parents=True, exist_ok=True)
    results = {}

    match_nums = sorted(shuju_map.keys())
    for i, match_num in enumerate(match_nums):
        item = shuju_map[match_num]
        shuju_id = item['shujuId'] if isinstance(item, dict) else item

        # 从 data.json 获取队名
        info = match_info.get(match_num, {})
        home_name = info.get('homeName', '')
        away_name = info.get('visitName', '')

        result = scrape_match(shuju_id, match_num, home_name, away_name)
        results[match_num] = result

        # 随机延迟 1~3 秒，防止反爬
        if i < len(match_nums) - 1:
            delay = random.uniform(1.0, 3.0)
            time.sleep(delay)

    # 4. 保存结果
    output_file = SHUJU_DATA_DIR / f'shuju_{date_str}.json'
    output = {
        'date': date_str,
        'source': 'odds.500.com/fenxi/shuju',
        'matchesCount': len(results),
        'matches': results,
        'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # 统计
    success = sum(1 for r in results.values() if 'error' not in r)
    failed = sum(1 for r in results.values() if 'error' in r)
    print(f'\n[OK] done: {success} ok, {failed} fail -> {output_file}')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""从 liansai.500.com 抓取联赛积分榜，补齐赛季表"""
import json, re, sys, io, time, requests
from pathlib import Path
from datetime import datetime
from bs4 import BeautifulSoup

if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HEADERS = {'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN,zh;q=0.9'}
UA_POOL = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
]
SESSION = None

def get_session():
    global SESSION
    if SESSION is None:
        SESSION = requests.Session()
        SESSION.headers.update({
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Connection': 'keep-alive',
        })
        # Visit main page first to get cookies
        try:
            SESSION.get('https://liansai.500.com/', timeout=10)
        except:
            pass
    return SESSION
PROJECT_DIR = Path(__file__).resolve().parent.parent
SERVER_DIR = PROJECT_DIR / 'server'
SHUJU_DATA_DIR = SERVER_DIR / 'shuju_data'

# 联赛名标准化映射
LEAGUE_NAME_MAP = {
    '英超': '英超','西甲': '西甲','意甲': '意甲','德甲': '德甲','法甲': '法甲','法乙': '法乙',
    '欧冠': '欧冠','欧罗巴': '欧罗巴','欧协联': '欧协联','解放者杯': '解放者杯','南俱杯': '南俱杯',
    '厄甲': '厄瓜甲','巴拉联': '巴拉联','委超': '委超',
}


def load_league_map():
    mf = SERVER_DIR / 'league_jifen_map.json'
    if mf.exists():
        with open(mf, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def normalize_league(name, lm):
    if not name: return None
    if name in lm: return lm[name]
    mapped = LEAGUE_NAME_MAP.get(name, name)
    if mapped in lm: return lm[mapped]
    for k, v in lm.items():
        if name in k or k in name: return v
    return None


def fetch_standings(url):
    try:
        import random as _rand
        sess = get_session()
        base_url = re.sub(r'/jifen-\d+/', '/', url)
        sess.headers['User-Agent'] = _rand.choice(UA_POOL)
        sess.headers['Referer'] = base_url
        r = sess.get(url, timeout=20)
        r.encoding = 'gbk'
        soup = BeautifulSoup(r.text, 'html.parser')
        table = soup.select_one('table.ljifen_top_list')
        if not table:
            return None

        standings = {}
        for row in table.select('tr')[1:]:
            cells = [c.get_text(strip=True) for c in row.select('td, th')]
            if len(cells) < 12: continue
            tn = cells[1].strip()

            def si(s):
                try: return int(s)
                except: return None

            def sf(s):
                try: return float(s.replace('%', ''))
                except: return None

            standings[tn] = {
                'rank': si(cells[0]), 'matches': si(cells[2]),
                'wins': si(cells[3]), 'draws': si(cells[4]), 'losses': si(cells[5]),
                'goals': si(cells[6]), 'conceded': si(cells[7]), 'goalDiff': si(cells[8]),
                'avgGoals': sf(cells[9]), 'avgConceded': sf(cells[10]),
                'winPct': sf(cells[11]), 'drawPct': sf(cells[12]), 'lossPct': sf(cells[13]),
                'points': si(cells[14]),
            }
        return standings
    except:
        return None


def find_team(standings, tn):
    if not standings or not tn: return None
    if tn in standings: return standings[tn]
    for k, v in standings.items():
        if tn in k or k in tn: return v
    for k, v in standings.items():
        if tn[:3] in k: return v
    return None


def main():
    date_str = sys.argv[1] if len(sys.argv) > 1 else datetime.now().strftime('%Y-%m-%d')
    print(f'=== League Standings [{date_str}] ===')

    league_map = load_league_map()
    if not league_map:
        print('[FAIL] no league map, run _build_final3.py first')
        return

    # Collect matches + leagues
    matches = {}

    # Source 1: odds (team names)
    odds_f = SERVER_DIR / 'odds_history' / (date_str + '.json')
    if odds_f.exists():
        od = json.load(open(odds_f, 'r', encoding='utf-8'))
        for num, o in od.get('odds', {}).items():
            if o.get('homeName'):
                matches[num] = {'home': o['homeName'], 'visit': o['visitName'], 'league': ''}

    # Source 2: selenium data (team names)
    sel_f = SHUJU_DATA_DIR / f'shuju_selenium_{date_str}.json'
    if sel_f.exists():
        sd = json.load(open(sel_f, 'r', encoding='utf-8'))
        for num, v in sd.get('matches', {}).items():
            if num not in matches:
                matches[num] = {'home': '', 'visit': '', 'league': ''}
            if v.get('homeTeam') and not matches[num]['home']:
                matches[num]['home'] = v['homeTeam']
            if v.get('awayTeam') and not matches[num]['visit']:
                matches[num]['visit'] = v['awayTeam']

    # Source 3: data.json
    df = SERVER_DIR / 'data.json'
    if df.exists():
        d = json.load(open(df, 'r', encoding='utf-8'))
        for k, v in d.get('m', {}).items():
            if v and v.get('date', '')[:10] == date_str and v.get('num'):
                num = v['num']
                if num not in matches:
                    matches[num] = {'home': '', 'visit': '', 'league': ''}
                if v.get('homeName'): matches[num]['home'] = v['homeName']
                if v.get('visitName'): matches[num]['visit'] = v['visitName']
                if v.get('leagueName'): matches[num]['league'] = v['leagueName']

    # Source 4: Extract league from fenxi page checkboxes
    smf = SERVER_DIR / f'shuju_map_{date_str}.json'
    if smf.exists():
        has_league = any(m['league'] for m in matches.values())
        if not has_league:
            print('[extract] Getting leagues from fenxi pages...')
            sm = json.load(open(smf, 'r', encoding='utf-8'))
            for i, (num, item) in enumerate(sm.items()):
                if num in matches and matches[num]['league']:
                    continue
                sid = item['shujuId'] if isinstance(item, dict) else item
                try:
                    r = requests.get(f'https://odds.500.com/fenxi/shuju-{sid}', headers=HEADERS, timeout=10)
                    r.encoding = 'gbk'
                    for cb_class, side in [('zj0_1', 'home'), ('zj0_0', 'away')]:
                        cbs = re.findall(rf'<input class="{cb_class}"[^>]*checked[^>]*>([\u4e00-\u9fa5]+)', r.text)
                        if cbs and num in matches:
                            if side == 'home' and not matches[num].get('league'):
                                matches[num]['league'] = cbs[0]
                            # Also use as home/visit team names
                            if not matches[num].get('home') or not matches[num].get('visit'):
                                tm = re.search(r'([\u4e00-\u9fa5]+)VS([\u4e00-\u9fa5]+)', r.text)
                                if tm:
                                    if not matches[num]['home']: matches[num]['home'] = tm.group(1)
                                    if not matches[num]['visit']: matches[num]['visit'] = tm.group(2)
                    if i < 3: print(f'  {num}: league={matches.get(num,{}).get("league","?")}')
                except: pass
                time.sleep(0.3)

    if not matches:
        print('[WARN] no matches found')
        return

    print(f'\nMatches: {len(matches)}')

    # Fetch standings per league (handle cross-league matches)
    cache = {}
    season_data = {}
    leagues_done = set()

    # Also store team->league mapping from fenxi checkboxes
    team_leagues = {}
    # Re-read league extraction with per-team league info
    smf2 = SERVER_DIR / f'shuju_map_{date_str}.json'
    if smf2.exists():
        sm = json.load(open(smf2, 'r', encoding='utf-8'))
        for num, item in sm.items():
            if num not in matches:
                continue
            sid = item['shujuId'] if isinstance(item, dict) else item
            try:
                r = requests.get(f'https://odds.500.com/fenxi/shuju-{sid}', headers=HEADERS, timeout=10)
                r.encoding = 'gbk'
                # Get team names
                tm = re.search(r'([\u4e00-\u9fa5]+)VS([\u4e00-\u9fa5]+)', r.text)
                home_tn = tm.group(1) if tm else ''
                away_tn = tm.group(2) if tm else ''

                # Get leagues: zj0_1 = home, zj0_0 = away
                h_cbs = re.findall(r'<input class="zj0_1"[^>]*checked[^>]*>([\u4e00-\u9fa5]+)', r.text)
                a_cbs = re.findall(r'<input class="zj0_0"[^>]*checked[^>]*>([\u4e00-\u9fa5]+)', r.text)
                
                if not matches[num]['home']: matches[num]['home'] = home_tn
                if not matches[num]['visit']: matches[num]['visit'] = away_tn
                if not matches[num]['league'] and h_cbs:
                    matches[num]['league'] = h_cbs[0]

                # Per-team league
                if home_tn and h_cbs:
                    team_leagues[home_tn] = h_cbs[0]
                if away_tn and a_cbs:
                    team_leagues[away_tn] = a_cbs[0]
            except: pass
            time.sleep(0.3)

    for num, m in sorted(matches.items()):
        home = m['home']
        visit = m['visit']
        h_info = {}
        a_info = {}

        # Look up home team in their league
        if home and home in team_leagues:
            h_league = team_leagues[home]
            jinfo = normalize_league(h_league, league_map)
            if jinfo:
                url = jinfo['url']
                if url not in cache:
                    cache[url] = fetch_standings(url) or {}
                    if cache[url]:
                        print(f'  [{h_league}] {len(cache[url])} teams')
                        leagues_done.add(h_league)
                    time.sleep(0.5)
                h_info = find_team(cache[url], home) or {}

        # Look up away team in their league
        if visit and visit in team_leagues:
            a_league = team_leagues[visit]
            jinfo = normalize_league(a_league, league_map)
            if jinfo:
                url = jinfo['url']
                if url not in cache:
                    cache[url] = fetch_standings(url) or {}
                    if cache[url]:
                        print(f'  [{a_league}] {len(cache[url])} teams')
                        leagues_done.add(a_league)
                    time.sleep(0.5)
                a_info = find_team(cache[url], visit) or {}

        # Fallback: use match's main league
        if (not h_info or not a_info) and m['league']:
            jinfo = normalize_league(m['league'], league_map)
            if jinfo:
                url = jinfo['url']
                if url not in cache:
                    cache[url] = fetch_standings(url) or {}
                    time.sleep(0.5)
                if not h_info: h_info = find_team(cache[url], home) or {}
                if not a_info: a_info = find_team(cache[url], visit) or {}

        season_data[num] = {
            'home': h_info, 'away': a_info, 'league': m['league']
        }

    # Merge into data files
    for target in [SHUJU_DATA_DIR / f'shuju_selenium_{date_str}.json',
                   SHUJU_DATA_DIR / f'shuju_{date_str}.json']:
        if target.exists():
            ex = json.load(open(target, 'r', encoding='utf-8'))
            updated = 0
            for num, sd in season_data.items():
                if num in ex.get('matches', {}):
                    ex['matches'][num]['season'] = {
                        'home': sd['home'], 'away': sd['away'], 'source': 'liansai.500.com'
                    }
                    updated += 1
            if updated:
                ex['generatedAt'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                json.dump(ex, open(target, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
                print(f'Updated {updated} in {target.name}')

    filled = sum(1 for v in season_data.values() if v['home'] or v['away'])
    print(f'\n[OK] {filled}/{len(matches)} with season data from {len(leagues_done)} leagues')


if __name__ == '__main__':
    main()

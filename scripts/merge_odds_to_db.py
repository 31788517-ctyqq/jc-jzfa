#!/usr/bin/env python3
"""
整合赔率数据到 odds_history/ 目录
策略: sporttery.cn官方数据优先(含BQC/BF/JQS/SPF/RQSPF)
      编号使用matchId排序(代表官方出场顺序)
      ttyingqiu数据补充sporttery缺失的比赛
"""
import json, re
from datetime import datetime, timedelta
from pathlib import Path

SERVER_DIR = Path(__file__).parent.parent / "server"
ODDS_DIR = SERVER_DIR / "odds_history"
DATA_DIR = SERVER_DIR / "ttyingqiu_data"
ODDS_DIR.mkdir(parents=True, exist_ok=True)
DATE_START, DATE_END = "2026-03-19", "2026-04-24"

def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def get_match_day(date_str):
    weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    return weekdays[datetime.strptime(date_str, "%Y-%m-%d").weekday()]

def name_key(name):
    if not name:
        return ''
    name = name.strip().replace(' ', '')
    return re.sub(r'[^\u4e00-\u9fa5a-zA-Z0-9]', '', name).lower()

def names_match(n1, n2):
    if not n1 or not n2:
        return False
    k1 = name_key(n1)
    k2 = name_key(n2)
    if not k1 or not k2:
        return False
    if k1 == k2:
        return True
    if k1 in k2 or k2 in k1:
        return True
    common = sum(1 for c in k1 if c in k2)
    return common >= max(len(k1), len(k2)) * 0.6

def build_from_sporttery(sm, match_num, day_of_week):
    entry = {
        'num': match_num,
        'homeName': sm.get('homeTeam', ''),
        'visitName': sm.get('awayTeam', ''),
        'handicap': 0,
        'spf': {'home': 0, 'draw': 0, 'away': 0},
        'rqspf': {'home': 0, 'draw': 0, 'away': 0, 'handicap': 0},
        'halfFull': sporttery_bqc_to_format(sm.get('bqc', {})),
        'totalGoals': sporttery_jqs_to_format(sm.get('jqs', {})),
        'scores': sporttery_bf_to_format(sm.get('bf', {})),
        'isSingleGame': False,
        'matchId': sm.get('matchId', ''),
    }
    
    spf = sm.get('spf', {})
    rqspf = sm.get('rqspf', {})
    
    if spf.get('home'):
        entry['spf'] = {
            'home': float(spf['home']),
            'draw': float(spf.get('draw', 0)),
            'away': float(spf.get('away', 0)),
        }
    
    if rqspf.get('home'):
        hcp_str = rqspf.get('handicap', '0')
        try:
            hcp = int(hcp_str)
        except (ValueError, TypeError):
            hcp = 0
        entry['rqspf'] = {
            'home': float(rqspf['home']),
            'draw': float(rqspf.get('draw', 0)),
            'away': float(rqspf.get('away', 0)),
            'handicap': hcp,
        }
        entry['handicap'] = hcp
    
    return entry

def sporttery_bqc_to_format(bqc):
    if not bqc:
        return None
    mapping = {
        'ss': 'hh', 'sp': 'hd', 'sf': 'ha',
        'ps': 'dh', 'pp': 'dd', 'pf': 'da',
        'fs': 'ah', 'fp': 'ad', 'ff': 'aa',
    }
    vals = {}
    for sk, ok in mapping.items():
        v = bqc.get(sk, '')
        vals[ok] = float(v) if v and v != '' else None
    if all(v is None for v in vals.values()):
        return None
    return vals

def sporttery_jqs_to_format(jqs):
    if not jqs:
        return None
    vals = {}
    for k in ['0', '1', '2', '3', '4', '5', '6', '7+']:
        v = jqs.get(k, '')
        vals[k] = float(v) if v and v != '' else None
    if all(v is None for v in vals.values()):
        return None
    return vals

def sporttery_bf_to_format(bf):
    if not bf:
        return None
    result = {}
    for k, v in bf.items():
        if k == 'updateTime':
            continue
        result[k] = float(v) if v and v != '' else None
    return result if result else None


def main():
    print("Loading data...")
    tty_data = load_json(DATA_DIR / "odds_spf_rqspf.json")
    sporttery_data = load_json(DATA_DIR / "sporttery_bqc_bf_jqs.json")
    
    # 按日期索引sporttery数据
    sporttery_by_date = {}
    for mid, m in sporttery_data.items():
        dt = m.get('date', '')
        if dt:
            sporttery_by_date.setdefault(dt, {})[mid] = m
    
    dates = []
    cur = datetime.strptime(DATE_START, "%Y-%m-%d")
    end = datetime.strptime(DATE_END, "%Y-%m-%d")
    while cur <= end:
        dates.append(cur.strftime("%Y-%m-%d"))
        cur += timedelta(days=1)
    
    print(f"Processing {len(dates)} dates...")
    total_m, total_b, total_j, total_bf = 0, 0, 0, 0
    
    for date_str in dates:
        tty_day = tty_data.get(date_str, [])
        sporttery_day = sporttery_by_date.get(date_str, {})
        day_of_week = get_match_day(date_str)
        odds = {}
        
        # 关键修改: 按 matchId 排序 (代表官方出场顺序)
        sporttery_list = sorted(sporttery_day.values(), key=lambda x: int(x.get('matchId', 0)))
        
        # 从001开始编号（matchId顺序 = 官方出场顺序）
        used_nums = set()
        next_idx = 1
        
        for sm in sporttery_list:
            # 生成唯一编号
            match_num = f"{day_of_week}{next_idx:03d}"
            next_idx += 1
            used_nums.add(match_num)
            
            entry = build_from_sporttery(sm, match_num, day_of_week)
            odds[match_num] = entry
        
        # 补充只有ttyingqiu的记录（不在sporttery中的比赛）
        sporttery_home_set = set()
        for sm in sporttery_list:
            sporttery_home_set.add((name_key(sm.get('homeTeam', '')), name_key(sm.get('awayTeam', ''))))
        
        for tm in tty_day:
            if not tm.get('matchNum'):
                continue
            hk = name_key(tm.get('homeName', ''))
            ak = name_key(tm.get('awayName', ''))
            is_in_sporttery = any(
                names_match(tm.get('homeName', ''), sm.get('homeTeam', '')) and
                names_match(tm.get('awayName', ''), sm.get('awayTeam', ''))
                for sm in sporttery_list
            )
            if not is_in_sporttery and tm['matchNum'] not in odds:
                # 使用tty的matchNum，但要确保不冲突
                tty_num = tm['matchNum']
                if tty_num in odds:
                    # 冲突：给sporttery预留的编号被占用了，改用新编号
                    while f"{day_of_week}{next_idx:03d}" in odds:
                        next_idx += 1
                    tty_num = f"{day_of_week}{next_idx:03d}"
                    next_idx += 1
                
                spf_tty = tm.get('spf', {})
                rqspf_tty = tm.get('rqspf', {})
                h = int(rqspf_tty.get('handicap', 0)) if rqspf_tty.get('handicap') else 0
                odds[tty_num] = {
                    'num': tty_num,
                    'homeName': tm.get('homeName', ''),
                    'visitName': tm.get('awayName', ''),
                    'handicap': h,
                    'spf': {
                        'home': float(spf_tty.get('home', spf_tty.get('win', 0))) if spf_tty.get('home') or spf_tty.get('win') else 0,
                        'draw': float(spf_tty.get('draw', 0)) if spf_tty.get('draw') else 0,
                        'away': float(spf_tty.get('away', spf_tty.get('lose', 0))) if spf_tty.get('away') or spf_tty.get('lose') else 0,
                    },
                    'rqspf': {
                        'home': float(rqspf_tty.get('home', rqspf_tty.get('win', 0))) if rqspf_tty.get('home') or rqspf_tty.get('win') else 0,
                        'draw': float(rqspf_tty.get('draw', 0)) if rqspf_tty.get('draw') else 0,
                        'away': float(rqspf_tty.get('away', rqspf_tty.get('lose', 0))) if rqspf_tty.get('away') or rqspf_tty.get('lose') else 0,
                        'handicap': h,
                    },
                    'halfFull': None, 'totalGoals': None, 'scores': None,
                    'isSingleGame': False,
                }
        
        if odds:
            with open(ODDS_DIR / f"{date_str}.json", 'w', encoding='utf-8') as f:
                json.dump({'date': date_str, 'odds': odds}, f, ensure_ascii=False, indent=2)
            
            n = len(odds)
            n_bqc = sum(1 for m in odds.values() if m.get('halfFull'))
            n_jqs = sum(1 for m in odds.values() if m.get('totalGoals'))
            n_bf = sum(1 for m in odds.values() if m.get('scores'))
            total_m += n; total_b += n_bqc; total_j += n_jqs; total_bf += n_bf
            print(f"  {date_str}: {n} matches (BQC:{n_bqc} JQS:{n_jqs} BF:{n_bf})")
        else:
            print(f"  {date_str}: 0 matches")
    
    print(f"\n{'='*50}")
    print(f"Done! {len(dates)} days, {total_m} matches")
    print(f"  BQC={total_b} JQS={total_j} BF={total_bf}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""将500.com全玩法数据融合到odds_history中（补BQC/BF到4/28-5/25）"""
import json
from pathlib import Path

ODDS_DIR = Path(__file__).parent.parent / "server" / "odds_history"
DATA_DIR = Path(__file__).parent.parent / "server" / "ttyingqiu_data"

def main():
    # 加载500.com全玩法数据
    with open(DATA_DIR / "odds_500_allplays.json", 'r', encoding='utf-8') as f:
        d500 = json.load(f)
    
    updated = 0
    for date_str in sorted(d500.keys()):
        odds_path = ODDS_DIR / f"{date_str}.json"
        if not odds_path.exists():
            print(f"  {date_str}: file not found, skipping")
            continue
        
        with open(odds_path, 'r', encoding='utf-8') as f:
            existing = json.load(f)
        
        odds = existing.get('odds', {})
        d500_day = d500[date_str]
        
        modified = False
        for match_num, d500_m in d500_day.items():
            if match_num in odds:
                m = odds[match_num]
                changed = False
                
                # 补BQC (halfFull)
                hf = d500_m.get('halfFull')
                if hf and not m.get('halfFull'):
                    bqc_vals = {}
                    for k in ['hh','hd','ha','dh','dd','da','ah','ad','aa']:
                        bqc_vals[k] = hf.get(k) if hf.get(k) is not None else None
                    if any(v is not None for v in bqc_vals.values()):
                        m['halfFull'] = bqc_vals
                        changed = True
                
                # 补BF (scores)
                scores = d500_m.get('scores')
                if scores and not m.get('scores'):
                    m['scores'] = scores
                    changed = True
                
                # 补JQS (totalGoals) - 如果已有但可能不全
                tg = d500_m.get('totalGoals')
                if tg and not m.get('totalGoals'):
                    m['totalGoals'] = tg
                    changed = True
                
                if changed:
                    modified = True
                    updated += 1
        
        if modified:
            with open(odds_path, 'w', encoding='utf-8') as f:
                json.dump(existing, f, ensure_ascii=False, indent=2)
            print(f"  {date_str}: updated ({updated} total)")
    
    print(f"\nUpdated {updated} matches across {len(d500)} dates")

if __name__ == "__main__":
    main()

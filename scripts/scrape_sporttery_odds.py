#!/usr/bin/env python3
"""
从 sporttery.cn 抓取 BQC(半全场)/BF(比分)/JQS(总进球) 赔率
日期范围: 2026-03-19 ~ 2026-04-24
策略: 扫描 matchId 范围，提取最后发布的赔率
"""
import asyncio, json
from datetime import datetime, timedelta
from pathlib import Path
from playwright.async_api import async_playwright

OUTPUT_DIR = Path(__file__).parent.parent / "server" / "ttyingqiu_data"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DATE_START, DATE_END = "2026-03-19", "2026-04-24"

def parse_match(data, mid):
    """解析单场比赛的完整赔率数据"""
    v = data.get('value', {})
    oh = v.get('oddsHistory', {})
    
    # 取每条列表的最后一项（最新发布）
    last_crs = (oh.get('crsList') or [None])[-1]
    last_hafu = (oh.get('hafuList') or [None])[-1]
    last_ttg = (oh.get('ttgList') or [None])[-1]
    last_had = (oh.get('hadList') or [None])[-1]
    last_hhad = (oh.get('hhadList') or [None])[-1]
    
    # 从历史赔率中获取日期
    match_date = ''
    for entry in [last_crs, last_hafu, last_ttg, last_had, last_hhad]:
        if entry and entry.get('updateDate'):
            match_date = entry['updateDate']
            break
    if not match_date:
        match_date = oh.get('updateDate', '')
    
    m = {
        'matchId': mid,
        'date': match_date,
        'homeTeam': oh.get('homeTeamAllName', oh.get('homeTeamAbbName', '')),
        'awayTeam': oh.get('awayTeamAllName', oh.get('awayTeamAbbName', '')),
        'league': oh.get('leagueAllName', oh.get('leagueAbbName', '')),
    }
    
    # SPF (已有，但一并抓)
    if last_had:
        m['spf'] = {
            'home': last_had.get('h', ''), 'draw': last_had.get('d', ''), 'away': last_had.get('a', ''),
            'updateTime': f"{last_had.get('updateDate','')} {last_had.get('updateTime','')}".strip()
        }
    
    # RQSPF
    if last_hhad:
        m['rqspf'] = {
            'home': last_hhad.get('h', ''), 'draw': last_hhad.get('d', ''), 'away': last_hhad.get('a', ''),
            'handicap': last_hhad.get('goalLine', ''),
            'updateTime': f"{last_hhad.get('updateDate','')} {last_hhad.get('updateTime','')}".strip()
        }
    
    # BQC (半全场): ss/sp/sf/ps/pp/pf/fs/fp/ff
    if last_hafu:
        m['bqc'] = {
            'ss': last_hafu.get('h', ''), 'sp': last_hafu.get('d', ''), 'sf': last_hafu.get('a', ''),
            'ps': last_hafu.get('dh', ''), 'pp': last_hafu.get('dd', ''), 'pf': last_hafu.get('da', ''),
            'fs': last_hafu.get('ah', ''), 'fp': last_hafu.get('ad', ''), 'ff': last_hafu.get('aa', ''),
            'updateTime': f"{last_hafu.get('updateDate','')} {last_hafu.get('updateTime','')}".strip()
        }
    
    # JQS (总进球): 0,1,2,3,4,5,6,7+
    if last_ttg:
        m['jqs'] = {
            '0': last_ttg.get('s0', ''), '1': last_ttg.get('s1', ''),
            '2': last_ttg.get('s2', ''), '3': last_ttg.get('s3', ''),
            '4': last_ttg.get('s4', ''), '5': last_ttg.get('s5', ''),
            '6': last_ttg.get('s6', ''), '7+': last_ttg.get('s7', ''),
            'updateTime': f"{last_ttg.get('updateDate','')} {last_ttg.get('updateTime','')}".strip()
        }
    
    # BF (比分): s01s00=1:0, etc.
    if last_crs:
        bf = {}
        score_map = {
            's01s00': '1:0', 's02s00': '2:0', 's02s01': '2:1',
            's03s00': '3:0', 's03s01': '3:1', 's03s02': '3:2',
            's04s00': '4:0', 's04s01': '4:1', 's04s02': '4:2',
            's05s00': '5:0', 's05s01': '5:1', 's05s02': '5:2',
            's00s00': '0:0', 's01s01': '1:1', 's02s02': '2:2', 's03s03': '3:3',
            's00s01': '0:1', 's00s02': '0:2', 's01s02': '1:2',
            's00s03': '0:3', 's01s03': '1:3', 's02s03': '2:3',
            's00s04': '0:4', 's01s04': '1:4', 's02s04': '2:4',
            's00s05': '0:5', 's01s05': '1:5', 's02s05': '2:5',
        }
        for k, name in score_map.items():
            if k in last_crs:
                bf[name] = last_crs[k]
        if bf:
            bf['updateTime'] = f"{last_crs.get('updateDate','')} {last_crs.get('updateTime','')}".strip()
            m['bf'] = bf
    
    return m


async def main():
    print(f"Date range: {DATE_START} ~ {DATE_END}\n")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox'])
        ctx = await browser.new_context(viewport={'width':1920,'height':1080})
        page = await ctx.new_page()
        
        await page.goto('https://www.sporttery.cn/jc/zqdz/index.html?showType=3&mid=2039170',
                        wait_until='networkidle', timeout=30000)
        await page.wait_for_timeout(2000)
        
        # 扫描matchId范围 (根据之前的测试，3/19-4/24的matchId约在2036800-2039800)
        id_start, id_end = 2036800, 2040000
        id_range = list(range(id_start, id_end + 1))
        
        all_matches = {}
        batch_size = 30
        
        print(f"Scanning matchId {id_start} ~ {id_end}...")
        
        for batch_start in range(0, len(id_range), batch_size):
            batch = id_range[batch_start:batch_start + batch_size]
            id_list = json.dumps(batch)
            
            result = await page.evaluate(f"""
                async () => {{
                    var ids = {id_list};
                    var results = {{}};
                    
                    for (var id of ids) {{
                        try {{
                            var r = await fetch('https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=' + id);
                            if (r.ok) {{
                                var d = await r.json();
                                if (d.success && d.value) {{
                                    var oh = d.value.oddsHistory || {{}};
                                    if (Object.keys(oh).length > 0) {{
                                        // Get date from last odds entry
                                        var date = '';
                                        var lists = ['crsList','hafuList','ttgList','hadList','hhadList'];
                                        for (var li of lists) {{
                                            var arr = oh[li] || [];
                                            if (arr.length > 0) {{
                                                date = arr[arr.length-1].updateDate || '';
                                                if (date) break;
                                            }}
                                        }}
                                        results[id] = {{
                                            date: date,
                                            home: oh.homeTeamAllName || '',
                                            away: oh.awayTeamAllName || '',
                                            league: oh.leagueAbbName || '',
                                            data: d,
                                        }};
                                    }}
                                }}
                            }}
                        }} catch(e) {{}}
                    }}
                    return results;
                }}
            """)
            
            count = len(result)
            if count > 0:
                for mid, info in result.items():
                    date_str = info.get('date', '')
                    if date_str and DATE_START <= date_str <= DATE_END:
                        m = parse_match(info['data'], mid)
                        all_matches[mid] = m
                        print(f"  [{info['date']}] mid={mid}: {info['home']} vs {info['away']} ({info['league']}) - BQC/BF/JQS hasData")
            
            progress = batch_start + batch_size
            pct = min(progress / len(id_range) * 100, 100)
            print(f"  [{pct:.0f}%] batch={batch_start//batch_size+1}, found={count}, total={len(all_matches)} in range")
            
            await page.wait_for_timeout(100)
        
        await browser.close()
    
    # 保存
    output_path = OUTPUT_DIR / "sporttery_bqc_bf_jqs.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(all_matches, f, ensure_ascii=False, indent=2)
    
    print(f"\n{'='*50}")
    print(f"Done! {len(all_matches)} matches in date range")
    print(f"Saved: {output_path}")
    
    # CSV
    if all_matches:
        csv_path = OUTPUT_DIR / "sporttery_bqc_bf_jqs.csv"
        with open(csv_path, 'w', encoding='utf-8') as f:
            f.write("date,matchId,home,away,league," +
                    "BQC_ss,BQC_sp,BQC_sf,BQC_ps,BQC_pp,BQC_pf,BQC_fs,BQC_fp,BQC_ff," +
                    "JQS_0,JQS_1,JQS_2,JQS_3,JQS_4,JQS_5,JQS_6,JQS_7p," +
                    "BF_scores\n")
            for mid in sorted(all_matches.keys()):
                m = all_matches[mid]
                bqc = m.get('bqc', {})
                jqs = m.get('jqs', {})
                bf = m.get('bf', {})
                bf_str = json.dumps(bf, ensure_ascii=False).replace(',', ';')
                f.write(f"{m.get('date','')},{mid},{m.get('homeTeam','')},{m.get('awayTeam','')},{m.get('league','')},")
                f.write(f"{bqc.get('ss','')},{bqc.get('sp','')},{bqc.get('sf','')},{bqc.get('ps','')},{bqc.get('pp','')},{bqc.get('pf','')},{bqc.get('fs','')},{bqc.get('fp','')},{bqc.get('ff','')},")
                f.write(f"{jqs.get('0','')},{jqs.get('1','')},{jqs.get('2','')},{jqs.get('3','')},{jqs.get('4','')},{jqs.get('5','')},{jqs.get('6','')},{jqs.get('7+','')},")
                f.write(f"{bf_str}\n")
        print(f"CSV: {csv_path}")

asyncio.run(main())

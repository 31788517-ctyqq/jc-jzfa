#!/usr/bin/env python3
"""扫描3月19-4月24期间遗漏的matchId，补充缺失比赛"""
import asyncio, json
from pathlib import Path
from playwright.async_api import async_playwright

DATA_DIR = Path(__file__).parent.parent / "server" / "ttyingqiu_data"

async def main():
    # 已知已有数据的matchId（从sporttery_bqc_bf_jqs.json读取）
    existing = json.loads(DATA_DIR.joinpath('sporttery_bqc_bf_jqs.json').read_text('utf-8'))
    
    # 扫描2036800-2040000，找缺失的
    all_ids = set(str(i) for i in range(2036800, 2040001))
    existing_ids = set(existing.keys())
    missing_ids = sorted(all_ids - existing_ids, key=int)
    
    print(f"Total existing: {len(existing_ids)}")
    print(f"Total missing in scan range: {len(missing_ids)}")
    
    # 只测试疑似足球比赛的ID（连续块附近的缺口）
    # 找出有数据的连续ID块
    existing_sorted = sorted(int(x) for x in existing_ids)
    ranges = []
    start = end = existing_sorted[0]
    for x in existing_sorted[1:]:
        if x == end + 1:
            end = x
        else:
            ranges.append((start, end))
            start = end = x
    ranges.append((start, end))
    
    print(f"\nExisting matchId ranges: {len(ranges)} blocks")
    for s, e in ranges:
        print(f"  {s} - {e} ({e-s+1} IDs)")
    
    # 找出缺口（gap）
    gaps = []
    for i, (s, e) in enumerate(ranges):
        if i + 1 < len(ranges):
            gap_start = e + 1
            gap_end = ranges[i+1][0] - 1
            if gap_end - gap_start <= 50:  # Small gaps might be football
                gaps.append((gap_start, gap_end))
    
    print(f"\nSmall gaps to check ({len(gaps)}):")
    for gs, ge in gaps:
        print(f"  {gs}-{ge} ({ge-gs+1} IDs)")
    
    # 测试这些小gap中的matchId
    test_ids = []
    for gs, ge in gaps:
        for mid in range(gs, ge + 1):
            test_ids.append(mid)
    
    if not test_ids:
        print("No gaps to test (all within same block)")
        return
    
    print(f"\nTesting {len(test_ids)} missing matchIds...")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox'])
        ctx = await browser.new_context(viewport={'width':1920,'height':1080})
        page = await ctx.new_page()
        
        await page.goto('https://www.sporttery.cn/jc/zqdz/index.html?showType=3&mid=2039170',
                        wait_until='networkidle', timeout=30000)
        await page.wait_for_timeout(2000)
        
        found = {}
        batch_size = 30
        
        for batch_start in range(0, len(test_ids), batch_size):
            batch = test_ids[batch_start:batch_start + batch_size]
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
                                            hasData: true
                                        }};
                                    }}
                                }}
                            }}
                        }} catch(e) {{}}
                    }}
                    return results;
                }}
            """)
            
            if result:
                for mid, info in result.items():
                    if info.get('hasData'):
                        found[mid] = info
                        print(f"  FOUND mid={mid}: {info.get('home','?')} vs {info.get('away','?')} date={info.get('date','?')}")
        
        await browser.close()
        
    print(f"\nFound {len(found)} additional matches")
    if found:
        print(json.dumps(found, ensure_ascii=False, indent=2))

asyncio.run(main())

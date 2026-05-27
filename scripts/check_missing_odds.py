#!/usr/bin/env python3
"""
诊断脚本：检查赔率数据缺失原因
用法：python3 check_missing_odds.py [服务器IP]
"""
import subprocess, sys, json

# 需要在服务器上运行的命令
check_dates = {
    '2026-04-25': ['周六021'],
    '2026-05-18': ['周一001', '周一003'],
    '2026-05-19': ['周二002'],
}

if len(sys.argv) > 1:
    server = sys.argv[1]
else:
    server = 'localhost'

print('='*60)
print('赔率数据缺失诊断')
print('='*60)

for date, nums in check_dates.items():
    for num in nums:
        cmd = f'curl -s -X POST http://{server}:3000/api -H "Content-Type: application/json" -d \'{{"action":"check-odds","data":{{"date":"{date}","num":"{num}"}}}}\''
        try:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15)
            data = json.loads(result.stdout) if result.stdout else {}
            d = data.get('data', {})
            print(f'\n--- {date} {num} ---')
            print(f'  文件存在: {d.get("fileExists")}')
            print(f'  总场次数: {d.get("totalMatches")}')
            print(f'  找到场次: {d.get("found")}')
            if d.get('found'):
                print(f'  有SPF: {d.get("hasSPF")}  -> {json.dumps(d.get("spfDetail"), ensure_ascii=False)}')
                print(f'  有RQ:  {d.get("hasRQ")}  -> {json.dumps(d.get("rqspfDetail"), ensure_ascii=False)}')
                print(f'  有TG:  {d.get("hasTG")}  -> {json.dumps(d.get("totalGoalsDetail"), ensure_ascii=False)}')
            else:
                if d.get('fileExists'):
                    print(f'  可用场次: {d.get("availableNums")}')
                else:
                    print(f'  错误: {d.get("error", d.get("filePath",""))}')
        except Exception as e:
            print(f'  请求失败: {e}')

print('\n' + '='*60)
print('如果文件存在但场次不在其中，则需要重新抓取该日期的500.com赔率')
print('运行命令: NODE_PATH=server node server/batch_fetch_odds.js')
print('='*60)

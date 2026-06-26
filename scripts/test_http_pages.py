#!/usr/bin/env python3
"""测试 sporttery.cn / lottery.gov.cn 页面是否服务端渲染"""
import paramiko, os

HOST = "119.23.51.159"
USER = "root"
KEY_FILE = os.path.expanduser("~/.ssh/id_rsa_jczjfa")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, key_filename=KEY_FILE,
            timeout=10, port=22,
            look_for_keys=False, allow_agent=False,
            disabled_algorithms={'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']})

def run(cmd, timeout=30):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# 用 Python 3.9 测试关键URL是否返回服务端渲染的HTML
test_script = r'''
import requests, re

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0",
    "Referer": "https://www.lottery.gov.cn/"
}

tests = [
    ("赛程页", "https://www.lottery.gov.cn/jc/zqszsc/", ["mid=", "周", "table", "tr"]),
    ("列表页", "https://www.lottery.gov.cn/jc/zqsgkj/", ["mid=", "showType=3", "table"]),
    ("赔率详情", "https://www.sporttery.cn/jc/zqdz/index.html?showType=3&mid=2040290", ["u-top", "u-btm", "table"]),
    ("前瞻详情", "https://www.sporttery.cn/jc/zqdz/index.html?showType=2&mid=2040290", ["featureAnalysis", "lsM", "table"]),
]

for name, url, keywords in tests:
    try:
        r = requests.get(url, headers=HEADERS, timeout=20, verify=False)
        html = r.text
        status = r.status_code
        length = len(html)
        
        found = [kw for kw in keywords if kw.lower() in html.lower()]
        found_str = ",".join(found)
        print(f"[{status}] {name}: {length}B | 关键词: {found_str}")
        
        # 显示HTML片段
        if "table" in found:
            tables = re.findall(r'<table[^>]*>', html[:5000], re.I)
            print(f"  表格数: {len(tables)}")
        if "mid=" in html.lower():
            mids = re.findall(r'mid[=:](\d+)', html[:5000])
            if mids:
                print(f"  比赛ID: {mids[:5]}")
        
        # 检查是否SPA（空壳）
        if length < 1000:
            print(f"  [WARN] 页面可能是SPA!")
        
    except Exception as e:
        print(f"[ERR] {name}: {e}")
    print()
'''

out, err = run(f"/usr/local/bin/python3 -c '{test_script}'", timeout=120)
print(out)
if err:
    print(f"STDERR: {err[:1000]}")
ssh.close()

"""建立联赛名称 -> liansai.500.com jifen URL 映射表"""
import requests, re, json

HEADERS = {'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN,zh;q=0.9'}

# 已知 season ID 的联赛 (从首页获取)
known_seasons = {
    '英超': 9110, '西甲': 9124, '意甲': 9080, '德甲': 9117, '法甲': 9118,
    '欧冠': 9106, '欧罗巴': 9107, '欧协联': 9121, '中超': 19603,
    '解放者杯': 19496, '南俱杯': 19497, '世俱杯': 7365,
}

# 还需要发现的联赛: 从首页所有 zuqiu 链接
r = requests.get('https://liansai.500.com/', headers=HEADERS, timeout=10)
r.encoding = 'gbk'

# 找到所有 zuqiu-{id}/ 链接
all_seasons = {}
for m in re.finditer(r'/zuqiu-(\d+)/"[^>]*>([^<]+)', r.text):
    sid = m.group(1)
    name = m.group(2).strip()
    if name and sid not in all_seasons:
        all_seasons[name] = int(sid)

# 也尝试从页面匹配
for m in re.finditer(r'/zuqiu-(\d+)/"[^>]*title="([^"]+)"', r.text):
    sid = m.group(1)
    title = m.group(2)
    # title may contain league name
    if sid not in all_seasons:
        all_seasons[title] = int(sid)

# Try to get jifen ID for each known season
league_map = {}
for name, sid in list(all_seasons.items())[:80]:  # 限制数量
    try:
        url = f'https://liansai.500.com/zuqiu-{sid}/'
        r2 = requests.get(url, headers=HEADERS, timeout=10)
        r2.encoding = 'gbk'
        
        # Find jifen ID
        jf = re.search(r'/zuqiu-\d+/jifen-(\d+)/', r2.text)
        if jf:
            jid = jf.group(1)
            league_map[name] = {
                'season_id': sid,
                'jifen_id': jid,
                'url': f'https://liansai.500.com/zuqiu-{sid}/jifen-{jid}/'
            }
    except:
        pass

# Save
with open('server/league_jifen_map.json', 'w', encoding='utf-8') as f:
    json.dump(league_map, f, ensure_ascii=False, indent=2)

print(f"Found {len(league_map)} leagues with jifen URLs:")
for name, info in sorted(league_map.items()):
    print(f"  {name}: {info['url']}")

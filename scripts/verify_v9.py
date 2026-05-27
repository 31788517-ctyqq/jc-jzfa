import urllib.request, json, time

URL = 'https://zj.100qiu.com/api'
d = json.dumps({'action': 'plan-list', 'data': {'date': '2026-05-24'}}).encode()

# Trigger plan-list (kicks off 500.com async fetch)
r = json.loads(urllib.request.urlopen(urllib.request.Request(URL, d, {'Content-Type': 'application/json'}), timeout=15).read())
plans = r.get('data', {}).get('plans', [])
print(f'Triggered, {len(plans)} plans')

print('Waiting 40s for 500.com data...')
time.sleep(40)

# Check again - odds should now include totalGoals
r2 = json.loads(urllib.request.urlopen(urllib.request.Request(URL, d, {'Content-Type': 'application/json'}), timeout=15).read())
plans2 = r2.get('data', {}).get('plans', [])
print(f'\n{len(plans2)} plans after cache:')

for p in plans2:
    odds = p.get('odds', {})
    dirs = p.get('mainDirection', '')
    spf = odds.get('spf')
    tg = odds.get('totalGoals')
    isSpf = spf and spf.get('home')
    hasTg = tg and tg.get('3')
    num = p.get('matchNum', '')
    
    if hasTg or '总进球' in dirs:
        print(f'\n{num} {p.get("homeName")} vs {p.get("visitName")}: {dirs}')
        print(f'  odds.spf: {spf}')
        print(f'  odds.totalGoals: {tg}')
    elif isSpf:
        print(f'{num} spf={spf.get("home")}/{spf.get("draw")}/{spf.get("away")} | dir={dirs}')
    else:
        print(f'{num} no-500-data | dir={dirs[:20]}')

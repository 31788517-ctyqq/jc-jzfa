import urllib.request, json, io, sys, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
URL = 'https://zj.100qiu.com/api'
def api(a,d=None):
    j=json.dumps({'action':a,'data':d or{}}).encode()
    return json.loads(urllib.request.urlopen(urllib.request.Request(URL,j,{'Content-Type':'application/json'}),timeout=15).read())

# First call - should use inferred odds
print('=== First call (inferred odds) ===')
r = api('plan-list', {'date': '2026-05-24'})
for p in r.get('data',{}).get('plans',[]):
    n = p.get('matchNum','')
    if '010' in n or '011' in n:
        o = p.get('odds',{})
        print(f'{n}: H={o.get("home")} D={o.get("draw")} A={o.get("away")}')
        break

# Wait for background fetch to complete
print('\nWaiting 12s for background fetch...')
time.sleep(12)

# Second call - should use cached real odds
print('=== Second call (should be cached real odds) ===')
r2 = api('plan-list', {'date': '2026-05-24'})
for p in r2.get('data',{}).get('plans',[]):
    n = p.get('matchNum','')
    if '010' in n or '011' in n:
        o = p.get('odds',{})
        print(f'{n}: H={o.get("home")} D={o.get("draw")} A={o.get("away")}')
        break

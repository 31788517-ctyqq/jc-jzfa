import urllib.request,json
r=json.loads(urllib.request.urlopen(urllib.request.Request('https://zj.100qiu.com/api',json.dumps({'action':'plan-list','data':{'date':'2026-05-23'}}).encode(),{'Content-Type':'application/json'}),timeout=15).read())
for p in r['data']['plans']:
    print(p['planName'])
    for m in p['matches']:
        print(' ', m['matchNum'], m['direction'], 'isWin:', m['isMatchWon'], 'isLose:', m['isMatchLose'])

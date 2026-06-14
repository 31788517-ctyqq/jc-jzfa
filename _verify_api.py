"""
JC-ZJFA 生产端分层验证脚本
L1: PM2 进程状态
L2: 内部健康检查
L3: Nginx 代理链路
L4: 核心业务 API
L5: AI 健康采样（新增）
L6: 错误日志扫描
"""
import paramiko, json, sys
from deploy import HOST, USER, PASS

def run(cmd, timeout=15):
    _, stdout, _ = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode()

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)

errors = []
passes = []

def check(name, cond, detail=''):
    if cond:
        passes.append(f'  [OK] {name}{" — "+detail if detail else ""}')
    else:
        errors.append(f'  [FAIL] {name}{" — "+detail if detail else ""}')

print('=' * 56)
print('  JC-ZJFA ' + (' ' * 10) + '生产验证 v2')
print('=' * 56)

# L1
print('\n-- L1: PM2 --')
pm2 = json.loads(run('~/.nvm/versions/node/v16.20.2/bin/pm2 jlist 2>/dev/null || pm2 jlist'))
for p in pm2:
    s = p['pm2_env']['status']
    check(p['name'], s == 'online', f'pid={p["pid"]} uptime={int(p["pm2_env"]["pm_uptime"]/1000)}s')

# L2
print('\n-- L2: 内部健康 --')
h = run('curl -s http://127.0.0.1:3000/health')
check('health', 'ok' in h, h.strip())

# L3
print('\n-- L3: Nginx --')
for url in ['/', '/index.html', '/js/main-fusion.js', '/css/app.css', '/sw.js']:
    out = run(f'curl -sL -o /dev/null -w "%{{http_code}}" -H "Host: zj.100qiu.com" http://127.0.0.1{url} --max-time 10')
    check(url, out in ['200','301'], f'HTTP {out.strip()}')

# L4
print('\n-- L4: 业务 API --')
apis = [
    ('match-list', '{"action":"match-list"}'),
    ('ranking-list', '{"action":"ranking-list"}'),
    ('gongshoudao', '{"action":"gongshoudao","matchId":"2040174"}'),
    ('cache-stats', '{"action":"cache-stats"}'),
    ('data-health', '{"action":"data-health","days":1}'),
]
for name, body in apis:
    out = run(
        f"curl -sL -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{body}' --max-time 15",
        timeout=20
    )
    try:
        d = json.loads(out)
        check(name, d.get('code') == 1, f'code={d["code"]}')
    except:
        check(name, False, f'parse: {out[:50]}')

# L5: AI采样
print('\n-- L5: AI 健康采样 --')
out = run("curl -sL -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"ai-health-check\"}' --max-time 120", timeout=130)
try:
    d = json.loads(out)
    ok = d.get('code') == 1
    detail = ''
    if ok and d.get('data'):
        dd = d['data']
        detail = f'{dd.get("sample","?")} 级别={dd.get("level","?")} {dd.get("elapsedSec","?")}s DS={dd.get("deepseek","?")} DB={dd.get("doubao","?")}'
    check('ai-health-check', ok, detail)
except:
    check('ai-health-check', False, f'parse: {out[:80]}')

# L6
print('\n-- L6: 错误日志 --')
err = run(
    "pm2 logs jc-zjfa --nostream --lines 5 2>&1 | "
    "grep -iE '(Error:|FATAL|CRASH|Cannot find|Uncaught|TypeError|ReferenceError)' | "
    "grep -v 'log last' | head -3"
)
check('严重错误', not err.strip(), err.strip()[:80] if err else 'clean')

ssh.close()

# 汇总
print('\n' + '=' * 56)
print(f'  通过: {len(passes)}  失败: {len(errors)}')
for p in passes: print(p)
for e in errors: print(e)
print('=' * 56)

sys.exit(1 if errors else 0)

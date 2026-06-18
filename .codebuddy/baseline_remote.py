# -*- coding: utf-8 -*-
"""
远程基线采集 — 使用 paramiko（绕过 Windows ssh-rsa 问题）
用法: python .codebuddy/baseline_remote.py
"""

import paramiko
import json
import os
import sys
from datetime import datetime

HOST = os.environ.get('DEPLOY_SSH_HOST', '119.23.51.159')
USER = 'root'

def get_pass():
    PASS = os.environ.get('DEPLOY_SSH_PASS')
    if PASS: return PASS
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env.deploy')
    if os.path.exists(env_file):
        with open(env_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('DEPLOY_SSH_PASS='):
                    return line.split('=', 1)[1].strip().strip('"').strip("'")
    return None

def ssh_cmd(ssh, cmd, timeout=60):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

def curl_api(ssh, action, date):
    """调用本地 API"""
    out, err = ssh_cmd(ssh,
        f"curl -s -X POST http://localhost:3000/api "
        f"-H 'Content-Type: application/json' "
        f"-d '{{\"action\":\"{action}\",\"date\":\"{date}\"}}' 2>/dev/null",
        timeout=25)
    return out[:500] if out else 'EMPTY'

def main():
    PASS = get_pass()
    if not PASS:
        print('[ERROR] DEPLOY_SSH_PASS 未设置')
        sys.exit(1)

    OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'baseline')
    os.makedirs(OUT_DIR, exist_ok=True)
    ts = datetime.now().strftime('%Y-%m-%dT%H-%M-%S')
    OUT_FILE = os.path.join(OUT_DIR, f'baseline_remote_{ts}.json')

    print('=' * 60)
    print('  远程性能基线采集 (paramiko)')
    print(f'  目标: {HOST}')
    print('=' * 60)

    # 连接
    print('\n连接服务器...')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    key_path = os.path.expanduser('~/.ssh/id_rsa_jczjfa')
    KEY_FILE = key_path if os.path.exists(key_path) else None

    connected = False
    if KEY_FILE:
        try:
            ssh.connect(HOST, username=USER, key_filename=KEY_FILE, timeout=10)
            connected = True
            print(f'  [OK] 密钥认证')
        except:
            pass
    if not connected:
        ssh.connect(HOST, username=USER, password=PASS, timeout=10)
        print('  [OK] 密码认证')

    baseline = {
        'collectedAt': datetime.now().isoformat(),
        'host': HOST,
        'mode': 'remote_paramiko',
    }

    # ── 1. API 延迟 ──
    print('\n[1/5] API 延迟采样...')
    today = datetime.now().strftime('%Y-%m-%d')
    api_latency = {}
    for action in ['match-list', 'daily-profit-7d', 'ranking-list', 'plan-list', 'my-plan-stats', 'week-dates']:
        t0_script = f"echo $(($(date +%s%N)/1000000))"
        out1, _ = ssh_cmd(ssh, t0_script)
        t0 = int(out1) if out1.isdigit() else 0
        
        result = curl_api(ssh, action, today)
        
        out2, _ = ssh_cmd(ssh, t0_script)
        t1 = int(out2) if out2.isdigit() else 0
        
        ms = t1 - t0 if t0 and t1 else -1
        api_latency[action] = {'ms': ms, 'resultPreview': result[:200]}
        print(f'  {action}: {ms}ms')
    baseline['apiLatency'] = api_latency

    # ── 2. 资源基线 ──
    print('\n[2/5] 数据资源基线...')
    resources = {}
    
    out, _ = ssh_cmd(ssh, "test -f /root/server/data.json && stat -c%s /root/server/data.json || echo 0")
    resources['dataJsonBytes'] = int(out) if out.isdigit() else 0
    
    out, _ = ssh_cmd(ssh, "test -f /root/server/midou_data.db && stat -c%s /root/server/midou_data.db || echo 0")
    resources['dbBytes'] = int(out) if out.isdigit() else 0
    
    out, _ = ssh_cmd(ssh, "ls /root/server/odds_history/*.json 2>/dev/null | wc -l")
    resources['oddsHistoryFiles'] = int(out.strip()) if out.strip().isdigit() else 0
    
    out, _ = ssh_cmd(ssh, "ls /root/server/shuju_data/*.json 2>/dev/null | wc -l")
    resources['shujuDataFiles'] = int(out.strip()) if out.strip().isdigit() else 0
    
    out, _ = ssh_cmd(ssh, "test -f /root/server/ai_cache.json && stat -c%s /root/server/ai_cache.json || echo 0")
    resources['aiCacheBytes'] = int(out) if out.isdigit() else 0
    
    resources['dataJsonKB'] = round(resources['dataJsonBytes'] / 1024) if resources['dataJsonBytes'] else 0
    resources['dbSizeMB'] = round(resources['dbBytes'] / 1048576, 1) if resources['dbBytes'] else 0
    resources['aiCacheKB'] = round(resources['aiCacheBytes'] / 1024) if resources['aiCacheBytes'] else 0
    
    for k, v in resources.items():
        print(f'  {k}: {v}')
    baseline['resources'] = resources

    # ── 3. AI 命中率 ──
    print('\n[3/5] AI 命中率基线...')
    hitrate_cmd = (
        "node -e \""
        "try{"
        "var d=require('/root/server/database');"
        "if(!d.isAvailable||!d.isAvailable()){console.log('DB_UNAVAILABLE');process.exit(0);}"
        "var a=d.getAdapter();"
        "var r=a.execAll('SELECT model_name, COUNT(*) as total, SUM(direction_hit) as hits FROM prediction_outcomes WHERE direction_hit IS NOT NULL GROUP BY model_name ORDER BY total DESC');"
        "r.forEach(function(x){console.log(x.model_name+' total='+x.total+' hits='+(x.hits||0)+' rate='+(x.total>0?Math.round((x.hits||0)/x.total*100):0)+'%')});"
        "}catch(e){console.log('ERROR: '+e.message);}"
        "\" 2>&1"
    )
    out, err = ssh_cmd(ssh, hitrate_cmd, timeout=30)
    baseline['aiHitrate'] = out
    for line in (out or '').split('\n'):
        print(f'  {line}')

    # ── 4. PM2 状态 ──
    print('\n[4/5] PM2 进程状态...')
    out, _ = ssh_cmd(ssh, "pm2 jlist 2>/dev/null", timeout=10)
    try:
        jlist = json.loads(out) if out else []
        pm2_info = []
        for p in jlist:
            info = {
                'name': p.get('name'),
                'pid': p.get('pid'),
                'status': (p.get('pm2_env') or {}).get('status', '?'),
                'memMB': round((p.get('monit') or {}).get('memory', 0) / 1048576),
                'cpu': (p.get('monit') or {}).get('cpu', 0),
                'restarts': (p.get('pm2_env') or {}).get('restart_time', 0),
                'uptimeH': round((datetime.now().timestamp() * 1000 - (p.get('pm2_env') or {}).get('pm_uptime', 0)) / 3600000, 1),
            }
            pm2_info.append(info)
            print(f"  {info['name']}: pid={info['pid']} status={info['status']} mem={info['memMB']}MB cpu={info['cpu']}% restart={info['restarts']} uptime={info['uptimeH']}h")
        baseline['pm2Status'] = pm2_info
    except Exception as e:
        baseline['pm2Status'] = f'PARSE_ERROR: {e}'
        print(f'  PARSE_ERROR')

    # ── 5. data.json 统计 ──
    print('\n[5/5] data.json 内容统计...')
    stats_cmd = (
        "node -e \""
        "var d=JSON.parse(require('fs').readFileSync('/root/server/data.json','utf8'));"
        "var m=Object.keys(d.m||{}).length;"
        "var r=Object.keys(d.r||{}).length;"
        "var dates=new Set();"
        "Object.values(d.m||{}).forEach(function(x){if(x&&x.date)dates.add(x.date.slice(0,10))});"
        "console.log('matches='+m+' recommends='+r+' uniqueDates='+dates.size);"
        "\""
    )
    out, _ = ssh_cmd(ssh, stats_cmd, timeout=15)
    baseline['dataJsonStats'] = out
    print(f'  {out}')

    # 写入
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(baseline, f, ensure_ascii=False, indent=2)
    
    print(f'\n基线已保存: {OUT_FILE}')
    print('=' * 60)
    ssh.close()

if __name__ == '__main__':
    main()

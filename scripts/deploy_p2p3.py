"""
deploy_p2p3.py — P2+P3 部署脚本
  P2: Redis + cluster:3
  P3: API 精细化缓存 (Redis 响应级缓存)

部署步骤:
  1. SFTP 上传修改文件
  2. 上传 ecosystem.config.json (cluster:3)
  3. pm2 kill + 重启 jc-zjfa (cluster模式需要pm2 kill而非restart)
  4. 验证 cluster:3 启动成功
  5. 验证 Redis 缓存工作
  6. 验证 API 响应时间
"""

import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from ssh_utils import get_ssh, run_cmds

SSH = get_ssh()
REMOTE_SERVER = '/root/server'
REMOTE_WEB = '/var/www/zj.100qiu.com'

# 文件上传列表
UPLOAD_FILES = [
    # P3: Redis 响应缓存模块
    ('server/core/redis-response-cache.js', REMOTE_SERVER + '/core/redis-response-cache.js'),
    # P2+P3: index.js (Redis缓存接入 + cluster:3 兼容)
    ('server/index.js', REMOTE_SERVER + '/index.js'),
    # P2: ecosystem.config.json (cluster:3 + REDIS env + 768M)
    ('ecosystem.config.json', REMOTE_SERVER + '/ecosystem.config.json'),
    # P3: deploy.py DEPLOY_MAP 更新
    ('deploy.py', REMOTE_SERVER + '/../deploy.py'),  # 部署脚本本身不需要上传到服务器
]

def upload_file(local, remote):
    """SFTP 上传单个文件"""
    import paramiko
    sftp = SSH.open_sftp()
    try:
        sftp.put(local, remote)
        print(f'[OK] {local} -> {remote}')
    except Exception as e:
        print(f'[FAIL] {local} -> {remote}: {e}')
        raise
    finally:
        sftp.close()

def main():
    print('\n=== P2+P3 部署 ===')
    print('P2: Redis + cluster:3')
    print('P3: API 精细化缓存\n')

    # 1. 上传文件
    print('--- Step 1: SFTP 上传 ---')
    for local, remote in UPLOAD_FILES:
        local_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), local)
        if local == 'deploy.py':
            continue  # deploy.py 不需要上传到服务器
        if not os.path.exists(local_path):
            print(f'[WARN] {local_path} 不存在，跳过')
            continue
        upload_file(local_path, remote)

    # 2. pm2 kill + 重启 (cluster模式切换需要)
    print('\n--- Step 2: PM2 重启 (cluster:3) ---')
    cmds = [
        # cluster模式切换必须 pm2 kill，否则旧dump覆盖ecosystem.config.json
        'pm2 kill',
        'sleep 2',
        # 验证没有残留进程
        'ps aux | grep "node.*index.js" | grep -v grep | wc -l',
        # 用新 ecosystem.config.json 启动
        f'cd {REMOTE_SERVER} && pm2 start ecosystem.config.json',
        'sleep 5',
        # 验证 jc-zjfa cluster:3
        'pm2 show jc-zjfa | grep -E "instances|exec mode|status|memory"',
        # 验证 Redis 连接
        f'cd {REMOTE_SERVER} && node -e "const r=require(\'./core/redis-client\');r.init().then(()=>{console.log(\'redis-connected:\'+r.isConnected()+\' degraded:\'+r.isDegraded());process.exit(0)}).catch(e=>{console.log(\'ERR:\'+e.message);process.exit(1)})"',
        'sleep 2',
    ]
    results = run_cmds(SSH, cmds, timeout=120)
    for i, (cmd, out, err) in enumerate(results):
        print(f'  [{i}] {cmd[:60]}...')
        if out.strip():
            # 只打印关键输出
            lines = out.strip().split('\n')
            for line in lines:
                if any(k in line for k in ['instances', 'exec', 'status', 'memory', 'redis', 'OK', 'online', 'ERR']):
                    print(f'       {line.strip()[:120]}')

    # 3. 验证 API 响应
    print('\n--- Step 3: API 响应验证 ---')
    verify_cmds = [
        # home-bundle
        f'curl -s -w "\\n%{time_total}" -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -d \'{{"action":"home-bundle"}}\' | tail -1',
        # match-list
        f'curl -s -w "\\n%{time_total}" -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -d \'{{"action":"match-list"}}\' | tail -1',
        # ranking-list
        f'curl -s -w "\\n%{time_total}" -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -d \'{{"action":"ranking-list"}}\' | tail -1',
        # plan-list
        f'curl -s -w "\\n%{time_total}" -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -d \'{{"action":"plan-list"}}\' | tail -1',
        # 第二次请求（应命中 Redis 缓存）
        f'curl -s -w "\\n%{time_total}" -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -d \'{{"action":"home-bundle"}}\' | tail -1',
        f'curl -s -w "\\n%{time_total}" -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -d \'{{"action":"match-list"}}\' | tail -1',
        # Redis keys count
        f'cd {REMOTE_SERVER} && node -e "const r=require(\'./core/redis-client\');r.init().then(()=>r.get(\'test\').then(()=>{const keys=[\'zjfa:resp:home-bundle\',\'zjfa:resp:match-list\'];Promise.all(keys.map(k=>r.get(k))).then(vs=>{vs.forEach((v,i)=>console.log(keys[i]+\'=\'+(v?\'cached\':\'empty\')));process.exit(0)})}).catch(e=>{console.log(\'ERR:\'+e.message);process.exit(1)})"',
    ]
    results = run_cmds(SSH, verify_cmds, timeout=60)
    for i, (cmd, out, err) in enumerate(results):
        print(f'  API [{i}]: {out.strip()[:80]}')

    # 4. pm2 状态汇总
    print('\n--- Step 4: PM2 状态 ---')
    status_cmds = [
        'pm2 jlist | node -e "const j=JSON.parse(require(\'fs\').readFileSync(\'/dev/stdin\',\'utf8\'));j.forEach(p=>console.log(p.name+\' instances:\'+(p.instances?p.instances.length:1)+\' mem:\'+Math.round(p.monit.memory/1024/1024)+\'MB uptime:\'+Math.round(p.pm2_env.pm_uptime/1000)+\'s\'))"',
        'pm2 list',
    ]
    results = run_cmds(SSH, status_cmds, timeout=15)
    for cmd, out, err in results:
        if 'pm2 list' in cmd:
            # 打印 pm2 list 的关键行
            for line in out.strip().split('\n'):
                if 'jc-zjfa' in line or 'jc-sync' in line or 'jc-scheduler' in line or 'st' in line.lower():
                    print(f'  {line.strip()[:120]}')

    print('\n=== P2+P3 部署完成 ===')

if __name__ == '__main__':
    main()

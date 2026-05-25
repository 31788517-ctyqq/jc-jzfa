"""一键修复方案收入 + 清理data.json + 部署到生产服务器"""
import paramiko, sys, os, time

HOST = "119.23.51.159"
USER = "root"
PASS = "znm19811225@"
BASE = "/var/www/zj.100qiu.com/server"

FILES = {
    "E:/JC-ZJFA/server/simple.js": f"{BASE}/simple.js",
}

print("=" * 50)
print("  修复方案收入 - 部署到 zj.100qiu.com")
print("=" * 50)

try:
    s = paramiko.SSHClient()
    s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    s.connect(HOST, 22, USER, PASS, timeout=15, look_for_keys=False, allow_agent=False)
    print("[1] SSH connected")

    ftp = s.open_sftp()

    # 1. 上传修复后的 simple.js
    print("[2] Uploading simple.js ...")
    for local, remote in FILES.items():
        if os.path.exists(local):
            ftp.put(local, remote)
            size = os.path.getsize(local)
            print(f"    {local} -> {remote} ({size/1024:.0f}KB) OK")
        else:
            print(f"    SKIP: {local} not found")

    # 2. 清理 data.json (去掉 200 万 null key)
    print("[3] Cleaning data.json on server ...")
    cmd = """cd /var/www/zj.100qiu.com/server && node -e "
var d=JSON.parse(require('fs').readFileSync('data.json','utf8'));
var newM={};
Object.keys(d.m).forEach(function(k){if(d.m[k])newM[k]=d.m[k]});
var old=Object.keys(d.m).length;
d.m=newM;
var n=Object.keys(d.m).length;
require('fs').writeFileSync('data.json',JSON.stringify(d));
console.log('data.json: ' + old + ' -> ' + n + ' keys');
" 2>&1"""
    _, o, e = s.exec_command(cmd, timeout=30)
    print("    " + o.read().decode(errors='replace').strip())

    # 3. 重启 PM2
    print("[4] Restarting PM2 ...")
    cmd = "pm2 restart jc-zjfa 2>&1"
    _, o, e = s.exec_command(cmd, timeout=15)
    ec = o.channel.recv_exit_status()
    out = o.read().decode(errors='replace')
    err = e.read().decode(errors='replace')
    print("    " + out.strip())
    if err.strip(): print("    ERR: " + err.strip())

    # 4. 验证 API
    print("[5] Verifying API ...")
    time.sleep(3)
    cmd = """curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"income-stats","data":{"days":0,"plan":"all"}}' | python3 -c "import sys,json;d=json.load(sys.stdin);print('plans='+str(d['data']['summary']['totalPlans'])+' records='+str(len(d['data']['records'])))" 2>&1 || echo 'API verify failed'"""
    _, o, e = s.exec_command(cmd, timeout=15)
    print("    " + o.read().decode(errors='replace').strip())

    ftp.close()
    s.close()
    print("\n[DONE] 部署完成! 刷新 https://zj.100qiu.com/ 查看")

except Exception as ex:
    print(f"[ERROR] {ex}")
    sys.exit(1)

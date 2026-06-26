#!/usr/bin/env python3
import paramiko, os, sys, json, time

HOST = '119.23.51.159'
USER = 'root'
env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env.deploy')
PASS = ''
if os.path.exists(env_file):
    for line in open(env_file, encoding='utf-8'):
        if line.startswith('DEPLOY_SSH_PASS='):
            PASS = line.strip().split('=', 1)[1]

key_path = os.path.expanduser('~/.ssh/id_rsa_jczjfa')
KEY_FILE = key_path if os.path.exists(key_path) else None

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
connect_ok = False
if KEY_FILE:
    for opts in [{}, {'disabled_algorithms': {'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']}}]:
        try:
            ssh.connect(HOST, username=USER, key_filename=KEY_FILE, timeout=10, port=22,
                        look_for_keys=False, allow_agent=False, **opts)
            connect_ok = True
            break
        except:
            continue
if not connect_ok and PASS:
    ssh.connect(HOST, username=USER, password=PASS, timeout=10, port=22)

# Write result to file instead of stdout
cmd = '''curl -s -X POST http://localhost:3210/api -H "Content-Type: application/json" -H "Host: zj.100qiu.com" -d '{"action":"user-list","page":1,"pageSize":20}' > /tmp/users_result.json 2>&1'''

_, _, _ = ssh.exec_command(cmd, timeout=15)
time.sleep(5)

# Read the result file via SSH
_, stdout, _ = ssh.exec_command('cat /tmp/users_result.json', timeout=10)
stdout.channel.settimeout(10)
result = stdout.read().decode('utf-8', errors='replace')

# Write to local file
output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'users_result.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    try:
        data = json.loads(result)
        users = data.get('users', data.get('data', []))
        if isinstance(users, list):
            for u in users[:20]:
                f.write(f"username={u.get('username','?')} role={u.get('role','?')} status={u.get('status','?')}\n")
        else:
            f.write(json.dumps(data, indent=2, ensure_ascii=False)[:500])
    except:
        f.write(result[:500])

ssh.close()
print("DONE")

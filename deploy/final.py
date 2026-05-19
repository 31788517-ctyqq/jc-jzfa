import paramiko, time
H="119.23.51.159"; U="root"; P="znm19811225@"

s=paramiko.SSHClient()
s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect(H,22,U,P,timeout=10,look_for_keys=False,allow_agent=False)

# Combined fix + restart command
cmd = """
echo "=== CHECKING ==="
cat /var/www/zj.100qiu.com/server/database.js | head -5
echo "=== RESTARTING ==="
pm2 restart jc-zjfa --update-env
sleep 4
echo "=== STATUS ==="
pm2 list
echo "=== HEALTH ==="
curl -s -m 3 http://localhost:3000/health || echo FAIL
echo "=== DONE ==="
"""

stdin, stdout, stderr = s.exec_command(cmd, timeout=60)
exit_code = stdout.channel.recv_exit_status()
out = stdout.read().decode(errors='replace')
err = stderr.read().decode(errors='replace')

# Clean non-ASCII
import re
out = re.sub(r'[^\x00-\x7F]+', '.', out)
print(out[:1200])
if err:
    print("ERR:", re.sub(r'[^\x00-\x7F]+', '.', err)[:300])

s.close()
print("\n>>> http://zj.100qiu.com <<<")

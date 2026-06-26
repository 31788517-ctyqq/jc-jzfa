"""检查 Node.js 中 REDIS_PASSWORD 的值"""
import sys, os, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

sys.path.insert(0, os.path.dirname(__file__))
from ssh_utils import get_ssh

SSH = get_ssh()

def run(cmd, timeout=15):
    _, stdout, stderr = SSH.exec_command(cmd, timeout=timeout)
    stdout.channel.settimeout(timeout)
    stderr.channel.settimeout(timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# 检查 REDIS_PASSWORD
script = 'console.log("REDIS_PASSWORD="+process.env.REDIS_PASSWORD);console.log("REDIS_ENABLED="+process.env.REDIS_ENABLED);console.log("REDIS_HOST="+process.env.REDIS_HOST);console.log("REDIS_PORT="+process.env.REDIS_PORT)'
out, err = run('cd /root/server && node -e "' + script + '"')
print(f'环境变量:')
print(out.strip()[:500])

# 检查 RESP AUTH 命令编码
script2 = '''const pw=process.env.REDIS_PASSWORD||'';function enc(...a){let c='*'+a.length+'\\r\\n';for(const arg of a){const s=String(arg);c+='$'+Buffer.byteLength(s)+'\\r\\n'+s+'\\r\\n';}return c;}console.log("AUTH_CMD="+enc('AUTH',pw));console.log("pw_len="+pw.length)'''
out2, err = run('cd /root/server && node -e "' + script2 + '"')
print(f'\nRESP 编码:')
print(out2.strip()[:500])

SSH.close()

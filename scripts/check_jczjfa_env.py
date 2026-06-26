#!/usr/bin/env python3
"""Check jc-zjfa process env and DB state"""
import sys, io, time, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# Check PM2 env for jc-zjfa
script_content = r'''const pm2 = require('/root/node_modules/pm2');
pm2.connect(function(err) {
  if (err) { console.error(err); process.exit(2); }
  pm2.describe('jc-zjfa', function(err, desc) {
    if (err) { console.error(err); pm2.disconnect(); process.exit(2); }
    if (desc && desc[0]) {
      const p = desc[0];
      console.log('PID: ' + p.pid);
      console.log('Status: ' + p.pm2_env.status);
      console.log('DB_PATH: ' + (p.pm2_env.DATABASE_PATH || 'not set'));
      console.log('DATA_DB_LAZY: ' + (p.pm2_env.DATA_DB_LAZY || 'not set'));
      console.log('REDIS_ENABLED: ' + (p.pm2_env.REDIS_ENABLED || 'not set'));
      // Check all env vars
      const envKeys = Object.keys(p.pm2_env).filter(k => k.includes('DB') || k.includes('REDIS') || k.includes('LAZY') || k.includes('PATH'));
      console.log('Env keys: ' + JSON.stringify(envKeys));
      for (const k of envKeys) {
        console.log(k + '=' + p.pm2_env[k]);
      }
    }
    pm2.disconnect();
  });
});'''

_, out, _ = SSH.exec_command("cat > /tmp/check_pm2_env.js << 'SCRIPT_END'\n" + script_content + "\nSCRIPT_END", timeout=10)
out.channel.settimeout(10)
time.sleep(2)

_, stdout, _ = SSH.exec_command('node /tmp/check_pm2_env.js 2>&1', timeout=15)
stdout.channel.settimeout(15)
time.sleep(5)

result = stdout.read().decode('utf-8', errors='replace')

output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'pm2_env.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(result)

SSH.close()

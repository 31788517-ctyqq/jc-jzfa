#!/usr/bin/env python3
"""Test scrypt password verification on server"""
import sys, io, time, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

script_content = r'''const crypto = require('crypto');

// ctyqq's password hash from DB
const storedHash = 'scrypt$deee75bf1f1cb208f243409704e00509$88589c207beee92536273c7c1f26b6b1e18d0eed6894b1cfb91b10d735a95b4618622c3633df5b980d3f852746ec2e3cf1fdcc4f9f11f71b8a146ac5bb2be4e2';
const password = '31788517';

function verifyPasswordAsync(password, storedHash) {
  return new Promise(function (resolve) {
    if (!storedHash || typeof storedHash !== 'string') return resolve(false);
    const parts = storedHash.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return resolve(false);
    const salt = parts[1];
    const expectedHex = parts[2];
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    crypto.scrypt(String(password || ''), salt, 64, function (err, derivedKey) {
      if (err) { console.log('scrypt error:', err.message); return resolve(false); }
      const actualBuf = Buffer.from(derivedKey);
      const actualHex = actualBuf.toString('hex');
      console.log('expected hex:', expectedHex);
      console.log('actual hex:  ', actualHex);
      console.log('match:', expectedHex === actualHex);
      if (expectedBuf.length !== actualBuf.length) return resolve(false);
      try {
        resolve(crypto.timingSafeEqual(expectedBuf, actualBuf));
      } catch (e) {
        resolve(false);
      }
    });
  });
}

verifyPasswordAsync(password, storedHash).then(result => {
  console.log('verification result:', result);
});'''

_, out, _ = SSH.exec_command("cat > /tmp/test_scrypt.js << 'SCRIPT_END'\n" + script_content + "\nSCRIPT_END", timeout=10)
out.channel.settimeout(10)
time.sleep(2)

_, stdout, stderr = SSH.exec_command('node /tmp/test_scrypt.js 2>&1', timeout=10)
stdout.channel.settimeout(10)
time.sleep(5)

result = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')

output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'scrypt_test.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(result + "\n---STDERR---\n" + err)

SSH.close()

#!/usr/bin/env python3
import paramiko, os

HOST = "119.23.51.159"
USER = "root"
KEY_FILE = os.path.expanduser("~/.ssh/id_rsa_jczjfa")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, key_filename=KEY_FILE,
            timeout=10, port=22, look_for_keys=False, allow_agent=False,
            disabled_algorithms={'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']})

sftp = ssh.open_sftp()
sftp.put("e:/JC-ZJFA/scripts/find_api.py", "/root/_find_api.py")
sftp.close()

stdin, stdout, stderr = ssh.exec_command("/usr/local/bin/python3 /root/_find_api.py 2>&1", timeout=120)
print(stdout.read().decode('utf-8', errors='replace'))
err = stderr.read().decode('utf-8', errors='replace')
if err: print(f"ERR: {err[:500]}")
ssh.close()

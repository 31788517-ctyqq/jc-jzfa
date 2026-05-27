import paramiko, sys, os

HOST = '119.23.51.159'
USER = 'root'
PASS = 'znm19811225@'

try:
    sys.stderr.write('Connecting...\n')
    sys.stderr.flush()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=15, port=22, disabled_algorithms={'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']})
    sys.stderr.write('Connected.\n')

    stdin, stdout, stderr = ssh.exec_command('pwd')
    print('PWD:', stdout.read().decode().strip())

    stdin, stdout, stderr = ssh.exec_command('ls /root/')
    print('LS:', stdout.read().decode().strip())

    ssh.close()
except Exception as e:
    sys.stderr.write(f'Error: {e}\n')
    import traceback
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)

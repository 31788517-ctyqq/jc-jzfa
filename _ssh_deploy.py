import paramiko, sys, os

HOST = os.environ.get('DEPLOY_SSH_HOST', '119.23.51.159')
USER = os.environ.get('DEPLOY_SSH_USER', 'root')
PASS = os.environ.get('DEPLOY_SSH_PASS')

if not PASS:
    env_deploy = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env.deploy')
    if os.path.exists(env_deploy):
        with open(env_deploy, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('DEPLOY_SSH_PASS='):
                    PASS = line.split('=', 1)[1].strip().strip('"').strip("'")
                    break
if not PASS:
    sys.stderr.write('Error: DEPLOY_SSH_PASS not set. Use env var or .env.deploy file.\n')
    sys.exit(1)

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

import os, sys, io, paramiko
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HOST=os.environ.get('DEPLOY_SSH_HOST','119.23.51.159')
USER=os.environ.get('DEPLOY_SSH_USER','root')
PASS=os.environ.get('DEPLOY_SSH_PASS','').strip()
if not PASS:
    envp=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),'.env.deploy')
    if os.path.exists(envp):
        for line in open(envp,'r',encoding='utf-8'):
            s=line.strip()
            if s.startswith('DEPLOY_SSH_PASS='):
                PASS=s.split('=',1)[1].strip().strip('"').strip("'")
                break
if not PASS:
    raise SystemExit('NO_PASS')
cmd=' '.join(sys.argv[1:]).strip() or 'pwd'
ssh=paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,username=USER,password=PASS,timeout=20,disabled_algorithms={'pubkeys':['rsa-sha2-256','rsa-sha2-512']})
stdin,stdout,stderr=ssh.exec_command(cmd,timeout=120)
out=stdout.read().decode('utf-8',errors='replace')
err=stderr.read().decode('utf-8',errors='replace')
print(out,end='')
if err:
    print('\n[STDERR]\n'+err)
ssh.close()

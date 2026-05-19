import paramiko
HOST="119.23.51.159"; USER="root"; PASS="znm19811225@"
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,22,USER,PASS,timeout=10,look_for_keys=False,allow_agent=False)
_,o,e=ssh.exec_command("curl -sL -o /root/deploy2.sh https://raw.githubusercontent.com/31788517-ctyqq/jc-jzfa/master/deploy/deploy2.sh && echo OK")
print(o.read().decode()+e.read().decode())
ssh.close()

import paramiko
s=paramiko.SSHClient();s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect('119.23.51.159',22,'root','znm19811225@',timeout=10,look_for_keys=False,allow_agent=False)
_,o,_=s.exec_command("head -5 /root/.pm2/logs/jc-zjfa-error.log && echo '---CURRENT---' && tail -5 /root/.pm2/logs/jc-zjfa-error.log && echo '---PORT---' && ss -tlnp | grep 3000", timeout=10)
out=o.read().decode(errors='replace')
f=open("E:/JC-ZJFA/deploy/e.log","w",encoding="utf-8")
f.write(out)
f.close()
s.close()

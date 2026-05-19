import paramiko
s=paramiko.SSHClient();s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect('119.23.51.159',22,'root','znm19811225@',timeout=10,look_for_keys=False,allow_agent=False)

# Check what's happening
_,o,_=s.exec_command("cat /root/.pm2/logs/jc-zjfa-error.log | tail -15", timeout=10)
out=o.read().decode(errors='replace')

f=open("E:/JC-ZJFA/deploy/errlog.txt","w",encoding="utf-8")
f.write(out)
f.close()

# Also check out log  
_,o,_=s.exec_command("cat /root/.pm2/logs/jc-zjfa-out.log | tail -10", timeout=10)
out2=o.read().decode(errors='replace')
f=open("E:/JC-ZJFA/deploy/outlog.txt","w",encoding="utf-8")
f.write(out2)
f.close()
s.close()

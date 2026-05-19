import paramiko
s=paramiko.SSHClient();s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect('119.23.51.159',22,'root','znm19811225@',timeout=10,look_for_keys=False,allow_agent=False)

cmd="cd /var/www/zj.100qiu.com/server && npm install compression winston express-rate-limit dotenv 2>&1 && echo INSTALL_OK && pm2 restart jc-zjfa 2>&1 && sleep 4 && ss -tlnp | grep 3000 && curl -s http://localhost:3000/health"
_,o,_=s.exec_command(cmd, timeout=120)
ec=_.channel.recv_exit_status()
out=o.read().decode(errors='replace')
f=open("E:/JC-ZJFA/deploy/pkg.log","w",encoding="utf-8")
f.write(f"ec={ec}\n{out}")
f.close()
s.close()

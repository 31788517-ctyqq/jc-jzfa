import paramiko
s=paramiko.SSHClient();s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect('119.23.51.159',22,'root','znm19811225@',timeout=10,look_for_keys=False,allow_agent=False)

# Remove large data file and restart with clean start
cmd="rm -f /var/www/zj.100qiu.com/server/data.json && echo CLEANED && pm2 restart jc-zjfa && sleep 3 && ss -tlnp | grep 3000 && curl -s http://localhost:3000/health"
_,o,_=s.exec_command(cmd, timeout=30)
ec=_.channel.recv_exit_status()
f=open("E:/JC-ZJFA/deploy/r4.log","w",encoding="utf-8")
f.write(f"ec={ec}\n")
f.write(o.read().decode(errors='replace'))
f.close()
s.close()

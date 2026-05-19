import paramiko, time
H="119.23.51.159"; U="root"; P="znm19811225@"
f=open("E:/JC-ZJFA/deploy/r3.log","w",encoding="utf-8")
try:
    ssh=paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(H,22,U,P,timeout=10,look_for_keys=False,allow_agent=False)
    f.write("connected\nf.flush()")
    time.sleep(2)
    _,o,_=ssh.exec_command("curl -s -m 5 http://localhost:3000/health", timeout=15)
    ec=_.channel.recv_exit_status()
    f.write(f"health: '{o.read().decode()}' ec={ec}\n")
    _,o,_=ssh.exec_command("curl -s -m 5 -w HTTP:%{http_code} -o /dev/null http://localhost:3000/", timeout=15)
    f.write(f"home: '{o.read().decode()}'\n")
    _,o,_=ssh.exec_command("pm2 list", timeout=10)
    f.write("pm2: done\n")
    ssh.close()
except Exception as e:
    f.write(f"err: {e}\n")
f.close()

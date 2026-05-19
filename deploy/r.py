import paramiko, time
H="119.23.51.159"; U="root"; P="znm19811225@"
f=open("E:/JC-ZJFA/deploy/r2.log","w")
try:
    ssh=paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(H,22,U,P,timeout=10,look_for_keys=False,allow_agent=False)
    f.write("connected\n")
    _,o,_=ssh.exec_command("pm2 restart jc-zjfa && sleep 3 && curl -s http://localhost:3000/health", timeout=30)
    ec=_.channel.recv_exit_status()
    f.write(o.read().decode(errors='replace'))
    f.write(f"\nec={ec}\n")
    ssh.close()
except Exception as e:
    f.write(f"err: {e}\n")
f.close()

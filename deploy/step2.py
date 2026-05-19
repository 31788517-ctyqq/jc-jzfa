import paramiko, time, sys
HOST="119.23.51.159"; USER="root"; PASS="znm19811225@"
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,22,USER,PASS,timeout=10,look_for_keys=False,allow_agent=False)
chan=ssh.get_transport().open_session()
chan.settimeout(600)
chan.exec_command("bash /root/deploy2.sh")
while True:
    if chan.recv_ready(): sys.stdout.write(chan.recv(65536).decode()); sys.stdout.flush()
    if chan.recv_stderr_ready(): sys.stdout.write(chan.recv_stderr(65536).decode()); sys.stdout.flush()
    if chan.exit_status_ready(): break
    time.sleep(0.3)
rc=chan.recv_exit_status()
print(f"\nDONE rc={rc}")
chan.close(); ssh.close()

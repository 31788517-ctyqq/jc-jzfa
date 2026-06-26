"""Kill port 3000 process and restart dev server with API proxy"""
import subprocess, os, time, sys

# Find PID on port 3000
result = subprocess.run('netstat -ano'.split(), capture_output=True, text=True)
for line in result.stdout.splitlines():
    if ':3000' in line and 'LISTENING' in line:
        pid = line.strip().split()[-1]
        subprocess.run(['taskkill', '/f', '/pid', pid], capture_output=True)
        print(f'Killed PID {pid} on port 3000')
        time.sleep(1)
        break

# Start dev server
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
dev = os.path.join('scripts', 'dev_server.py')
subprocess.Popen(['python', dev, '3000'], 
                 creationflags=subprocess.CREATE_NEW_CONSOLE if sys.platform == 'win32' else 0)
time.sleep(1)
print('Dev server restarted on port 3000 with API proxy to 3001')

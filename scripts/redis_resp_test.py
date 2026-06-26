"""直接用 RESP 协议测试 AUTH"""
import sys, os, io, socket
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# 直接用 TCP 发送 RESP AUTH 命令
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(5)
s.connect(('119.23.51.159', 6379))

# AUTH 命令
pw = 'qcredismaster01'
auth_cmd = '*2\r\n$4\r\nAUTH\r\n$' + str(len(pw)) + '\r\n' + pw + '\r\n'
print(f'Sending AUTH cmd: {auth_cmd[:50]}...')
s.send(auth_cmd.encode('utf-8'))

# 读取响应
resp = s.recv(1024).decode('utf-8')
print(f'AUTH response: {repr(resp)}')

# 尝试 SET 命令
set_cmd = '*3\r\n$3\r\nSET\r\n$4\r\ntest\r\n$5\r\nhello\r\n'
s.send(set_cmd.encode('utf-8'))
resp2 = s.recv(1024).decode('utf-8')
print(f'SET response: {repr(resp2)}')

s.close()

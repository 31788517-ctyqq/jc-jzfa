"""模拟用户操作: 登录 -> 进入后台 -> 检查Tab"""
import urllib.request, json, re

BASE = 'http://localhost:3000'

def api_post(action, data):
    url = BASE + '/api'
    body = json.dumps({'action': action, 'data': data}).encode('utf-8')
    req = urllib.request.Request(url, body, {'Content-Type': 'application/json'})
    r = urllib.request.urlopen(req, timeout=10)
    return json.loads(r.read())

# 1. 登录
print('=== 登录 ctyqq ===')
try:
    login = api_post('auth-login', {'username': 'ctyqq', 'password': '31788517'})
    print('登录结果:', json.dumps({k: login.get(k) for k in ['ok', 'msg', 'token']}, ensure_ascii=False))
    print('roles:', login.get('roles'))
    print('permissions (前10):', login.get('permissions', [])[:10])
    print('has data_health_view:', 'dashboard:data_health_view' in (login.get('permissions', []) or []))
    print('has super_admin:', 'super_admin' in (login.get('roles', []) or []))
    print('has ops_admin:', 'ops_admin' in (login.get('roles', []) or []))
except Exception as e:
    print('登录失败:', e)

# 2. 检查admin.js是否包含7个Tab
print('\n=== 检查 admin.js ===')
try:
    r = urllib.request.urlopen(BASE + '/js/pages/admin.js', timeout=5)
    c = r.read().decode('utf-8')
    print('文件大小:', len(c), 'bytes')
    print('包含 pipeline case:', "'pipeline'" in c)
    print('包含 compute case:', "'compute'" in c)
    print('包含 overview case:', "'overview'" in c)
    
    # 检查 _renderTabs 中的 tabs 数组
    matches = re.findall(r"key:\s*'([^']+)'", c)
    print('Tab keys found:', matches)
    print('Tab数量:', len(matches))
except Exception as e:
    print('检查失败:', e)

# 3. 检查index.html 引用的main-fusion.js
print('\n=== 检查 index.html 引用 ===')
try:
    r = urllib.request.urlopen(BASE + '/preview/index.html', timeout=5)
    html = r.read().decode('utf-8')
    js_refs = re.findall(r'src="([^"]*main-fusion[^"]*)"', html)
    print('main-fusion.js 引用:', js_refs)
except Exception as e:
    print('失败:', e)

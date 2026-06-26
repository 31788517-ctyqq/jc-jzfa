"""
Local dev server — mimics Nginx path aliases for preview/ + API proxy
Usage: python scripts/dev_server.py [port]
"""
import sys, os, json, threading, time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import URLError

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREVIEW = os.path.join(ROOT, 'preview')
IMAGES = os.path.join(ROOT, 'miniprogram', 'images')
API_PORT = int(os.environ.get('API_PORT', '3001'))

class AliasHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        """Proxy POST /api requests to backend"""
        if self.path.startswith('/api'):
            content_len = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_len) if content_len > 0 else b''
            content_type = self.headers.get('Content-Type', 'application/json')
            try:
                url = f'http://127.0.0.1:{API_PORT}{self.path}'
                req = Request(url, data=body, headers={'Content-Type': content_type})
                resp = urlopen(req, timeout=60)
                data = resp.read()
                self.send_response(resp.status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)
            except URLError as e:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'code': 0, 'msg': f'API backend unreachable: {e}'}).encode())
        else:
            self.send_response(405)
            self.end_headers()

    def do_GET(self):
        # Proxy all GET /api/* requests to backend (e.g. simulate-pay, callback)
        if self.path.startswith('/api'):
            try:
                url = f'http://127.0.0.1:{API_PORT}{self.path}'
                req = Request(url)
                resp = urlopen(req, timeout=10)
                data = resp.read()
                self.send_response(resp.status)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)
            except URLError as e:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'code': 0, 'msg': 'API backend unreachable'}).encode())
        else:
            super().do_GET()

    def translate_path(self, path):
        parsed = urlparse(path)
        p = parsed.path

        # /css/* → preview/css/
        if p.startswith('/css/') or p.startswith('/js/') or p == '/favicon.ico':
            return os.path.join(PREVIEW, p.lstrip('/'))

        # /assets/worldcup/* → miniprogram/images/worldcup/
        # /assets/zuqiu* → miniprogram/images/
        if p.startswith('/assets/'):
            rel = p[len('/assets/'):]
            # First try miniprogram/images/ (static assets)
            img_path = os.path.join(IMAGES, rel)
            if os.path.isfile(img_path):
                return img_path
            # Fallback to preview/dist/assets/ (Vite chunks)
            dist_asset = os.path.join(PREVIEW, 'dist', p.lstrip('/'))
            if os.path.isfile(dist_asset):
                return dist_asset
            # Fallback to preview/assets/
            prev_asset = os.path.join(PREVIEW, 'assets', rel)
            if os.path.isfile(prev_asset):
                return prev_asset
            return dist_asset  # let 404 happen naturally

        # /preview/* → preview/
        if p.startswith('/preview/'):
            return os.path.join(PREVIEW, p[len('/preview/'):])

        # Default: serve from ROOT
        return super().translate_path(path)

    def log_message(self, fmt, *args):
        pass  # quieter

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    server = HTTPServer(('0.0.0.0', port), AliasHandler)
    print(f'Dev server: http://127.0.0.1:{port}/preview/index.html')
    print(f'  /css/*  → {PREVIEW}\\css\\')
    print(f'  /js/*   → {PREVIEW}\\js\\')
    print(f'  /assets/worldcup/*  → {IMAGES}\\worldcup\\')
    print(f'  /assets/* (Vite)    → {PREVIEW}\\dist\\assets\\')
    print(f'  /preview/*          → {PREVIEW}\\')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()

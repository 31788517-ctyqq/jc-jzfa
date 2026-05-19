#!/bin/bash
# 竞彩推荐监控 - 一键部署脚本
# 在服务器上执行: bash deploy.sh

set -e

SERVER_IP="119.23.51.159"
DOMAIN="zj.100qiu.com"
PROJECT_DIR="/var/www/zj.100qiu.com"
GIT_REPO="https://github.com/31788517-ctyqq/jc-jzfa.git"

echo "============================================"
echo "  竞彩推荐监控 - 生产部署"
echo "  目标: $DOMAIN"
echo "============================================"

# 1. 检查环境
echo ""
echo "[1/8] 检查环境..."
node -v && echo "  Node.js ✓" || { echo "  请安装 Node.js"; exit 1; }
nginx -v && echo "  Nginx ✓" || { echo "  请安装 Nginx"; exit 1; }
which pm2 && echo "  PM2 ✓" || npm install -g pm2

# 2. 检查端口
if ss -tlnp | grep -q ':3000 '; then
    echo "  ⚠️ 端口 3000 被占用，将使用 3001"
    export PORT=3001
    sed -i 's/^PORT=3000/PORT=3001/' server/.env 2>/dev/null || true
else
    export PORT=3000
    echo "  端口 3000 空闲 ✓"
fi

# 3. 克隆项目
echo ""
echo "[2/8] 部署项目..."
if [ -d "$PROJECT_DIR" ]; then
    echo "  目录已存在，备份..."
    mv $PROJECT_DIR ${PROJECT_DIR}_backup_$(date +%Y%m%d_%H%M%S)
fi

git clone $GIT_REPO $PROJECT_DIR
cd $PROJECT_DIR

# 4. 配置环境变量
echo ""
echo "[3/8] 配置环境变量..."
if [ ! -f server/.env ]; then
    cp server/.env.example server/.env 2>/dev/null || {
        cat > server/.env << EOF
PORT=$PORT
MIDOU_MOBILE=13570060818
MIDOU_PASSWORD=73d26b46ab37f7a3725ba19e1b704090
NODE_ENV=production
EOF
    }
fi
echo "PORT=$PORT" >> server/.env
echo "NODE_ENV=production" >> server/.env

# 5. 安装依赖
echo ""
echo "[4/8] 安装依赖..."
cd server && npm install --production

# 6. 初始化数据库
echo ""
echo "[5/8] 初始化数据库..."
node -e "require('./database').initDatabase()"

# 7. 启动 PM2
echo ""
echo "[6/8] 启动服务..."
cd $PROJECT_DIR
pm2 delete jc-zjfa 2>/dev/null || true
pm2 start ecosystem.config.json
pm2 save
pm2 startup | tail -1 | bash 2>/dev/null || echo "  (手动执行上面的 pm2 startup 命令)"

# 8. 配置 Nginx
echo ""
echo "[7/8] 配置 Nginx..."
NGINX_CONF="/etc/nginx/conf.d/zj.conf"
if [ -f "$NGINX_CONF" ]; then
    cp $NGINX_CONF ${NGINX_CONF}.bak
fi

cat > $NGINX_CONF << 'NGINX_EOF'
server {
    listen 80;
    server_name zj.100qiu.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name zj.100qiu.com;

    ssl_certificate     /etc/nginx/ssl/zj.100qiu.com.pem;
    ssl_certificate_key /etc/nginx/ssl/zj.100qiu.com.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/javascript application/json application/javascript image/svg+xml;

    location /assets/ {
        alias /var/www/zj.100qiu.com/miniprogram/images/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location / {
        root /var/www/zj.100qiu.com/preview;
        try_files $uri /index.html;
        expires 1h;
    }

    location /api {
        proxy_pass http://127.0.0.1:PORT_PLACEHOLDER;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }

    location /health {
        proxy_pass http://127.0.0.1:PORT_PLACEHOLDER;
    }

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
}
NGINX_EOF

sed -i "s/PORT_PLACEHOLDER/$PORT/g" $NGINX_CONF
echo "  Nginx 配置已写入 $NGINX_CONF"

# 9. 验证并重载
echo ""
echo "[8/8] 验证并重载..."
nginx -t && nginx -s reload && echo "  Nginx 重载成功 ✓"

# 完成
echo ""
echo "============================================"
echo "  部署完成！"
echo "  访问地址: http://$DOMAIN"
echo "  PM2 状态: pm2 status"
echo "  日志查看: pm2 logs jc-zjfa"
echo "============================================"

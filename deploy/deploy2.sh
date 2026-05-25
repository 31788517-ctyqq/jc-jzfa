#!/bin/bash
# 竞彩推荐监控 - 适配版部署脚本 (CentOS 6 + Node 10)

set -e

PROJECT_DIR="/var/www/zj.100qiu.com"
PORT=3000

echo "============================================"
echo "  竞彩推荐监控 - 生产部署 v2.1"
echo "  目标: zj.100qiu.com"
echo "============================================"

# 1. 环境确认
echo "[1/7] 检查环境..."
node -v
nginx -v
echo "  PM2: $(pm2 -v)"

# 2. 清理旧项目
echo "[2/7] 准备项目目录..."
if [ -d "$PROJECT_DIR" ]; then
    mv $PROJECT_DIR ${PROJECT_DIR}_old_$(date +%H%M%S)
fi

# 3. 下载项目（Git 太旧，用 curl+unzip）
echo "[3/7] 下载项目..."
curl -sL -o /tmp/jc-zjfa.zip https://codeload.github.com/31788517-ctyqq/jc-jzfa/zip/refs/heads/master
cd /tmp
unzip -qo jc-zjfa.zip
mv jc-zjfa-master $PROJECT_DIR
rm -f jc-zjfa.zip
echo "  项目已部署到 $PROJECT_DIR"

# 4. 配置环境变量
echo "[4/7] 配置..."
cd $PROJECT_DIR
cat > server/.env << 'EOF'
PORT=3000
MIDOU_MOBILE=13570060818
MIDOU_PASSWORD=73d26b46ab37f7a3725ba19e1b704090
NODE_ENV=production
EOF

# 5. 安装依赖（跳过 native 模块编译失败的）
echo "[5/7] 安装依赖..."
cd $PROJECT_DIR/server
npm install --production --no-optional 2>&1 || echo "部分包安装失败，尝试继续..."

# 手动安装核心依赖
npm install express@4.17.1 cors@2.8.5 dotenv@16.4.0 express-rate-limit@6.7.0 compression@1.7.4 --save 2>&1 || true
# better-sqlite3 需要编译，尝试安装
npm install better-sqlite3@7.4.0 --build-from-source 2>&1 || echo "better-sqlite3 编译失败，将使用内存模式"

# 6. 配置 Nginx
echo "[6/7] 配置 Nginx..."
cat > /etc/nginx/conf.d/zj.100qiu.com.conf << NGINXEOF
server {
    listen 80;
    server_name zj.100qiu.com;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/javascript application/json application/javascript image/svg+xml;

    location /assets/ {
        alias /var/www/zj.100qiu.com/miniprogram/images/;
        expires 30d;
    }

    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 30s;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000;
    }

    location / {
        root /var/www/zj.100qiu.com/preview;
        try_files \$uri /index.html;
    }
}
NGINXEOF

nginx -t && nginx -s reload && echo "  Nginx 配置成功"

# 7. 启动 PM2
echo "[7/7] 启动服务..."
cd $PROJECT_DIR
pm2 delete jc-zjfa 2>/dev/null || true
BEHIND_PROXY=1 pm2 start server/index.js --name jc-zjfa --node-args="--max-old-space-size=256"
pm2 save

echo ""
echo "============================================"
echo "  部署完成!"
echo "  访问: http://zj.100qiu.com"
echo "  状态: pm2 status"
echo "============================================"

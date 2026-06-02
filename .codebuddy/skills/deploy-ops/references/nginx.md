# Nginx 配置参考

## 服务器信息

- 服务器 IP：119.23.51.159
- Web 根目录：/var/www/zj.100qiu.com/
- Nginx 配置文件：/etc/nginx/conf.d/zj.100qiu.com.conf（推测）
- SSL：Let's Encrypt 自动管理

## 路径映射表

| URL 路径 | 文件系统路径 | 类型 | 说明 |
|----------|-------------|------|------|
| `/` | `/var/www/zj.100qiu.com/preview/index.html` | 静态文件 | 首页 |
| `/preview/*` | `/var/www/zj.100qiu.com/preview/*` | 静态目录 | 前端页面资源 |
| `/assets/*` | `/var/www/zj.100qiu.com/miniprogram/images/*` | 静态目录 | ⚠️ 注意映射关系！ |
| `/server/*` | `/var/www/zj.100qiu.com/server/*` | 静态目录 | 服务端 JS 文件 |
| `/miniprogram/*` | `/var/www/zj.100qiu.com/miniprogram/*` | 静态目录 | 小程序资源 |
| `/api` | `proxy_pass http://localhost:3000` | 反向代理 | API 接口 |
| `/uploads/*` | `/var/www/zj.100qiu.com/uploads/*` | 静态目录 | 上传文件 |

## 静态资源部署注意事项

### ⚠️ /assets/ 路径特别警告

`/assets/` URL 前缀映射到 `miniprogram/images/` 目录，**不是** `preview/assets/`。这意味着：

- 放在 `preview/assets/xxx.png` 的文件无法通过 `/assets/xxx.png` 访问
- 必须放在 `miniprogram/images/xxx.png` 才能通过 `/assets/xxx.png` 访问

### 推荐策略

1. **前端页面 JS/CSS**：放在 `preview/` 目录，通过 `/preview/` 访问 ✅
2. **通用静态资源（图片/图标）**：放在 `miniprogram/images/` 目录，通过 `/assets/` 访问 ✅
3. **服务端 JS**：放在 `server/` 目录，通过 `/server/` 访问（或 /root/server/ 供 PM2 使用）

### 上传命令参考

```powershell
# 上传到 miniprogram/images/（对应 /assets/ URL）
scp -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" -o StrictHostKeyChecking=no ^
  miniprogram\images\icon.png ^
  root@119.23.51.159:/var/www/zj.100qiu.com/miniprogram/images/

# 上传到 preview/（对应 /preview/ URL）
scp -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" -o StrictHostKeyChecking=no ^
  preview\js\pages\gongshoudao.js ^
  root@119.23.51.159:/var/www/zj.100qiu.com/preview/js/pages/
```

## 部署目录结构总览

```
/var/www/zj.100qiu.com/
├── preview/
│   ├── index.html
│   ├── app.js
│   ├── js/
│   │   ├── main.js
│   │   └── pages/
│   │       ├── gongshoudao.js
│   │       ├── match-pk.js
│   │       └── quant-rank.js
│   └── css/
├── miniprogram/
│   └── images/        ← /assets/ 映射到此
├── server/
│   ├── index.js
│   ├── core/
│   ├── gongshoudao/   ← 从 /root/server/gongshoudao/ 同步
│   └── ...
└── uploads/

/root/server/          ← PM2 工作目录
├── index.js
├── core/
│   ├── odds-movement.js
│   ├── market-overlay.js
│   └── ...
├── gongshoudao/
│   ├── index.js
│   ├── market.js
│   ├── cache.json
│   └── ...
└── ecosystem.config.json
```

## Nginx 配置要点（推测）

```nginx
server {
    listen 443 ssl;
    server_name zj.100qiu.com;

    root /var/www/zj.100qiu.com;
    index index.html;

    # /assets/ → miniprogram/images/
    location /assets/ {
        alias /var/www/zj.100qiu.com/miniprogram/images/;
    }

    # /preview/ → preview/
    location /preview/ {
        alias /var/www/zj.100qiu.com/preview/;
    }

    # /api → Node.js
    location /api {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

> ⚠️ 以上 nginx 配置为推测。如需精确配置，请在服务器执行 `cat /etc/nginx/conf.d/zj.100qiu.com.conf`。

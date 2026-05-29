@echo off
chcp 65001 >nul
echo ===============================================
echo   功守道弹窗 快速部署 (nginx + PM2 双路径)
echo ===============================================
echo.

REM 读取 .env.deploy 中的密码
for /f "tokens=2 delims==" %%a in ('findstr /c:"DEPLOY_SSH_PASS=" .env.deploy 2^>nul') do set DEPLOY_SSH_PASS=%%a

if "%DEPLOY_SSH_PASS%"=="" (
    echo [警告] 未设置 DEPLOY_SSH_PASS，将使用 SSH 密钥
)

echo [1] 上传服务器端模块...
scp -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" -o StrictHostKeyChecking=no -o HostKeyAlgorithms=ssh-rsa,ssh-dss -o PubkeyAcceptedKeyTypes=ssh-rsa ^
  server\gongshoudao\index.js server\gongshoudao\attack.js server\gongshoudao\goal.js server\gongshoudao\diff.js ^
  server\gongshoudao\score.js server\gongshoudao\parser.js server\gongshoudao\fetch.js server\gongshoudao\fusion.js ^
  root@119.23.51.159:/root/server/gongshoudao/

echo [2] 上传前端到 nginx 路径...
scp -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" -o StrictHostKeyChecking=no -o HostKeyAlgorithms=ssh-rsa,ssh-dss -o PubkeyAcceptedKeyTypes=ssh-rsa ^
  preview\js\pages\gongshoudao.js ^
  root@119.23.51.159:/var/www/zj.100qiu.com/preview/js/pages/
scp -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" -o StrictHostKeyChecking=no -o HostKeyAlgorithms=ssh-rsa,ssh-dss -o PubkeyAcceptedKeyTypes=ssh-rsa ^
  preview\js\main.js ^
  root@119.23.51.159:/var/www/zj.100qiu.com/preview/js/main.js

echo [3] 同步 server 到 nginx 路径...
ssh -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" -o StrictHostKeyChecking=no -o HostKeyAlgorithms=ssh-rsa,ssh-dss -o PubkeyAcceptedKeyTypes=ssh-rsa root@119.23.51.159 "cp -f /root/server/gongshoudao/*.js /var/www/zj.100qiu.com/server/gongshoudao/ && echo synced"

echo [4] 清除旧缓存...
ssh -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" -o StrictHostKeyChecking=no -o HostKeyAlgorithms=ssh-rsa,ssh-dss -o PubkeyAcceptedKeyTypes=ssh-rsa root@119.23.51.159 "rm -f /root/server/gongshoudao/cache.json /var/www/zj.100qiu.com/server/gongshoudao/cache.json && echo cleared"

echo [5] 重载 nginx...
ssh -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" -o StrictHostKeyChecking=no -o HostKeyAlgorithms=ssh-rsa,ssh-dss -o PubkeyAcceptedKeyTypes=ssh-rsa root@119.23.51.159 "nginx -s reload && echo reloaded"

echo [6] 重启 PM2...
ssh -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" -o StrictHostKeyChecking=no -o HostKeyAlgorithms=ssh-rsa,ssh-dss -o PubkeyAcceptedKeyTypes=ssh-rsa root@119.23.51.159 "pm2 restart all && echo restarted"

echo.
echo ===============================================
echo   部署完成! 请刷新页面 (Ctrl+Shift+R)
echo ===============================================
pause

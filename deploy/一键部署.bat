@echo off
chcp 65001 >nul
title 竞彩推荐监控 - 部署到 119.23.51.159

echo ============================================
echo  竞彩推荐监控 - 远程部署
echo  目标服务器: 119.23.51.159
echo ============================================
echo.
echo 请手动在下方命令行中输入密码: znm19811125@
echo 共需输入 2 次（scp上传 + ssh执行）
echo.

echo [1] 上传部署脚本...
scp -o HostKeyAlgorithms=+ssh-rsa -o StrictHostKeyChecking=accept-new deploy\deploy.sh root@119.23.51.159:/root/

echo.
echo [2] 执行远程部署...
ssh -o HostKeyAlgorithms=+ssh-rsa -o StrictHostKeyChecking=accept-new -tt root@119.23.51.159 "bash /root/deploy.sh"

echo.
echo ============================================
echo  部署完成！访问: http://zj.100qiu.com
echo ============================================
pause

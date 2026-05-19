@echo off
chcp 65001 >nul
set SERVER=root@119.23.51.159
set SSH_FLAG=-o HostKeyAlgorithms=+ssh-rsa -o StrictHostKeyChecking=no

echo ============================================
echo  竞彩推荐监控 - 上传并部署
echo  目标: 119.23.51.159
echo ============================================

echo.
echo [1/3] 上传部署脚本...
scp %SSH_FLAG% deploy\deploy.sh %SERVER%:/root/
echo [2/3] 连接服务器执行部署...
ssh %SSH_FLAG% %SERVER% "bash /root/deploy.sh"
echo [3/3] 完成！
echo ============================================
pause

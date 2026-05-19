@echo off
chcp 65001 >nul
title 竞彩推荐监控系统 - 项目初始化
echo ============================================
echo  竞彩足球推荐趋势监控系统 - 项目初始化
echo ============================================
echo.

:: Step 1: Check Node.js
echo [1/5] 检查 Node.js 环境...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 未找到 Node.js，请先安装: https://nodejs.org/
    pause
    exit /b 1
)
echo ✅ Node.js 已安装

:: Step 2: Install TDesign
echo [2/5] 安装 TDesign 组件库...
cd /d "%~dp0..\miniprogram"
call npm install --production
if %errorlevel% neq 0 (
    echo ⚠️ npm install 失败，请检查网络
)
echo ✅ TDesign 安装完成

:: Step 3: Check ECharts
echo [3/5] 检查 ECharts 组件...
if exist "..\ec-canvas\echarts.js" (
    echo ✅ ECharts 组件已就绪
) else (
    echo ⚠️ ECharts 组件缺失
    echo 请从 https://github.com/ecomfe/echarts-for-weixin 下载 ec-canvas/
)

:: Step 4: 提示
echo [4/5] 配置文件检查...
if exist "..\project.config.json" (
    echo ✅ project.config.json 已就绪
) else (
    echo ⚠️ project.config.json 缺失
)

echo [5/5] 完成!
echo.
echo ============================================
echo  下一步操作:
echo  1. 打开微信开发者工具
echo  2. 导入项目目录: %~dp0..
echo  3. 修改 project.config.json 中的 appid
echo  4. 工具 → 构建 npm
echo  5. 右键 cloudfunctions → 上传并部署所有云函数
echo  6. 云开发控制台 → 运行 init-database 创建集合
echo  7. 配置环境变量 MIDOU_MOBILE / MIDOU_PASSWORD
echo  8. 编译运行
echo ============================================
echo.
pause

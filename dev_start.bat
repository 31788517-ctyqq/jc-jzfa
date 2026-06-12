@echo off
title JC-ZJFA Dev Server

cd /d "%~dp0"

:loop
echo ============================================
echo [%time%] Starting...
echo ============================================
node server/index.js
echo.
echo ============================================
echo [%time%] Exited (code: %ERRORLEVEL%). Restart in 3s...
echo ============================================
timeout /t 3 /nobreak >nul
goto loop

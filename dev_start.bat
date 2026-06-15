@echo off
title JC-ZJFA Dev Server

cd /d "%~dp0"
set "PORT=3000"

:loop
echo ============================================
echo [%time%] Preparing port %PORT%...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo [%time%] Port %PORT% occupied by PID %%P, stopping...
  taskkill /PID %%P /F >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo [%time%] Starting...
echo ============================================
node server/index.js
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo ============================================
echo [%time%] Exited (code: %EXIT_CODE%). Restart in 3s...
echo ============================================
timeout /t 3 /nobreak >nul
goto loop

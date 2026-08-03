@echo off
chcp 65001 >nul
title 烘焙工作台
cd /d "%~dp0"
echo ================================
echo   正在启动烘焙工作台服务器...
echo   启动后请看窗口里的手机访问地址
echo ================================
node server.js
pause

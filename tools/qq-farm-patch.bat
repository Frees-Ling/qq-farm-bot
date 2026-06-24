@echo off
chcp 65001 >nul
title QQ农场 一键配置工具
setlocal enabledelayedexpansion

set SERVER_IP={{SERVER_IP}}
set SNIFF_PORT={{SNIFF_PORT}}
set PANEL_PORT={{PANEL_PORT}}
set PANEL_URL=http://%SERVER_IP%:%PANEL_PORT%

echo ============================================
echo     QQ农场 - PC一键全栈配置工具
echo ============================================
echo  服务器: %SERVER_IP%:%SNIFF_PORT%
echo  面板: %PANEL_URL%
echo ============================================
echo.

:: 检查管理员权限
net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARN] 建议以管理员身份运行
    echo        右键本脚本 → 「以管理员身份运行」
    echo.
)

:: 下载并执行 PowerShell 脚本（绕过执行策略）
echo [INFO] 正在下载配置程序...
set PS_SCRIPT=%TEMP%\qq-farm-patch-run.ps1
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%PANEL_URL%/api/pc-capture/download-ps1' -OutFile '%PS_SCRIPT%' -UseBasicParsing -ErrorAction Stop; Write-Host '[OK] 下载成功' -ForegroundColor Green } catch { Write-Host '[ERR] 下载失败: ' $_ -ForegroundColor Red; exit 1 }"
if %ERRORLEVEL% NEQ 0 (
    echo [ERR] 无法从服务器下载配置脚本
    echo       请检查网络连接: %PANEL_URL%
    pause
    exit /b 1
)

echo [INFO] 正在执行配置...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%"

echo.
echo 按任意键退出...
pause >nul

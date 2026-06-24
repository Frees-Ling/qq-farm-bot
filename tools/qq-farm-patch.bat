@echo off
set SERVER_IP={{SERVER_IP}}
set SNIFF_PORT={{SNIFF_PORT}}
set PANEL_PORT={{PANEL_PORT}}
echo QQ农场 - 一键配置工具
echo 服务器: %SERVER_IP%:%SNIFF_PORT%
echo.
echo 正在下载配置脚本...
powershell -NoProfile -Command "Invoke-WebRequest -Uri 'http://%SERVER_IP%:%PANEL_PORT%/api/pc-capture/download-ps1' -OutFile '%TEMP%\qq-farm-patch-run.ps1' -UseBasicParsing"
if exist "%TEMP%\qq-farm-patch-run.ps1" (
    echo 正在执行配置...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\qq-farm-patch-run.ps1"
) else (
    echo 下载失败，请检查网络连接
)
echo.
pause

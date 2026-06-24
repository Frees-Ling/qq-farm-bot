@echo off
set SERVER_IP={{SERVER_IP}}
set SNIFF_PORT={{SNIFF_PORT}}
set PANEL_PORT={{PANEL_PORT}}
echo QQ Farm - One-Click Setup
echo Server: %SERVER_IP%:%SNIFF_PORT%
echo.
echo Downloading setup script...
powershell -NoProfile -Command "Invoke-WebRequest -Uri 'http://%SERVER_IP%:%PANEL_PORT%/api/pc-capture/download-ps1' -OutFile '%TEMP%\qq-farm-patch-run.ps1' -UseBasicParsing"
if exist "%TEMP%\qq-farm-patch-run.ps1" (
    echo Running setup...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\qq-farm-patch-run.ps1"
) else (
    echo Download failed, check network connection
)
echo.
pause

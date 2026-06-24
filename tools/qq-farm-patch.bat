@echo off
chcp 65001 >nul
title QQ农场 一键配置工具
echo ============================================
echo     QQ农场 - PC一键全栈配置工具
echo ============================================
echo  服务器: {{SERVER_IP}}:{{SNIFF_PORT}}
echo  面板: http://{{SERVER_IP}}:{{PANEL_PORT}}
echo ============================================
echo.

:: 检查是否以管理员身份运行
net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARN] 建议以管理员身份运行以获得更好兼容性
    echo        右键本脚本 → 「以管理员身份运行」
    echo.
)

:: 用 PowerShell 执行核心逻辑（绕过执行策略）
echo [INFO] 正在启动配置程序...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "
`$ErrorActionPreference = 'Stop';
`$SERVER_IP = '{{SERVER_IP}}';
`$SNIFF_PORT = '{{SNIFF_PORT}}';
`$PANEL_PORT = '{{PANEL_PORT}}';
`$WS_URL = 'ws://{{SERVER_IP}}:{{SNIFF_PORT}}/admin';
`$PANEL_URL = 'http://{{SERVER_IP}}:{{PANEL_PORT}}';

function Write-Step { param([string]`$m,[string]`$s='info'); `$c=@{info='Cyan';ok='Green';warn='Yellow';err='Red'}; Write-Host '[`$(`$s.ToUpper())] `$m' -ForegroundColor `$c[`$s] }

# Node.js检测
Write-Step '步骤 1/4: 检测 Node.js 环境...' -s info;
`$np = (Get-Command node -ErrorAction SilentlyContinue).Source;
if (-not `$np) {
    `$paths = @('`$env:ProgramFiles\\nodejs\\node.exe','`${env:ProgramFiles(x86)}\\nodejs\\node.exe','`$env:LOCALAPPDATA\\fnm\\nodejs\\current\\node.exe');
    foreach (`$p in `$paths) { `$f=Get-ChildItem ([System.Environment]::ExpandEnvironmentVariables(`$p)) -ErrorAction SilentlyContinue; if(`$f){`$np=`$f[0].FullName;break} }
}
if (-not `$np) {
    Write-Step 'Node.js 未找到，正在自动下载...' -s warn;
    `$nodeExe = '`$env:LOCALAPPDATA\\qq-farm-nodejs\\node.exe';
    if (Test-Path `$nodeExe) { `$np = `$nodeExe }
    else {
        try {
            `$arch = if([Environment]::Is64BitOperatingSystem){'x64'}else{'x86'};
            `$v='22.14.0';`$url='https://nodejs.org/dist/v`${v}/node-v`${v}-win-`${arch}.zip';
            `$z='`$env:TEMP\\node.zip';`$e='`$env:TEMP\\node-extract';
            Write-Step '   下载 Node.js ...' -s info;
            (New-Object System.Net.WebClient).DownloadFile(`$url,`$z);
            Add-Type -AssemblyName System.IO.Compression.FileSystem;
            [System.IO.Compression.ZipFile]::ExtractToDirectory(`$z,`$e);
            mkdir '`$env:LOCALAPPDATA\\qq-farm-nodejs' -Force | Out-Null;
            `$ex=(Get-ChildItem '`$e\\node-v*-win-`${arch}\\node.exe' -Recurse)[0].Directory;
            Copy-Item '`$ex\\*' '`$env:LOCALAPPDATA\\qq-farm-nodejs' -Recurse -Force;
            Remove-Item `$z -Force -ErrorAction SilentlyContinue;
            Remove-Item `$e -Recurse -Force -ErrorAction SilentlyContinue;
            if(Test-Path `$nodeExe){`$np=`$nodeExe}
        } catch { Write-Step '自动安装失败: '`$_ -s err; pause; exit 1 }
    }
}
`$ver = & `$np --version; Write-Step 'Node.js '`$ver -s ok;

# 下载补丁
Write-Step '步骤 2/4: 下载补丁脚本...' -s info;
`$sf = '`$PSScriptRoot\\patch-qq-farm-code-capture.js';
if (-not (Test-Path `$sf)) {
    try { (New-Object System.Net.WebClient).DownloadFile('`$PANEL_URL/api/pc-capture/download-patch',`$sf); Write-Step '补丁下载成功' -s ok }
    catch { Write-Step '下载失败' -s err; pause; exit 1 }
} else { Write-Step '补丁已存在' -s ok }

# 搜索game.js
Write-Step '步骤 3/4: 搜索QQ经典农场缓存...' -s info;
`$roots = @('`$env:APPDATA\\QQEX\\miniapp','`$env:LOCALAPPDATA\\QQEX\\miniapp','`$env:USERPROFILE\\.config\\QQEX\\miniapp');
`$found = @();
foreach (`$r in `$roots) { if(Test-Path `$r){ Get-ChildItem `$r -Filter 'game.js' -Recurse -ErrorAction SilentlyContinue | Where-Object { `$_.Directory.Name -like '1112386029_*' } | ForEach-Object { `$found += `$_.FullName } } }
if (`$found.Count -eq 0) { Write-Step '未找到game.js，请先打开QQ经典农场' -s warn; pause; exit 1 }
`$gj = `$found | Sort-Object LastWriteTime -Descending | Select-Object -First 1;
Write-Step '找到: '`$gj -s ok;

# 注入补丁
Write-Step '步骤 4/4: 注入补丁...' -s info;
& `$np `$sf --target `$gj --capture-ws `$WS_URL;
if (`$LASTEXITCODE -eq 0) { Write-Step '补丁注入成功!' -s ok } else { Write-Step '注入可能未完全成功' -s warn }

Write-Host '';
Write-Host '============================================' -ForegroundColor Green;
Write-Host '  ✅ 配置完成！' -ForegroundColor Green;
Write-Host '  请打开 PC QQ 上的 QQ经典农场' -ForegroundColor Cyan;
Write-Host '  Code 将自动被捕获并发送到服务器' -ForegroundColor Cyan;
Write-Host '  面板: `$PANEL_URL' -ForegroundColor Cyan;
Write-Host '============================================' -ForegroundColor Green;
"

echo.
echo 按任意键退出...
pause >nul

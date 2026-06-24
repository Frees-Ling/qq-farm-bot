<#
.SYNOPSIS
    QQ农场 - PC一键全栈配置工具
.DESCRIPTION
    自动检测Node.js环境（如缺失则自动下载安装），下载补丁脚本并注入到QQ经典农场
    用户只需以管理员身份运行本脚本，然后打开QQ经典农场即可
#>

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "QQ农场 一键配置工具"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# 占位符，由服务器端替换
$SERVER_IP = "{{SERVER_IP}}"
$SNIFF_PORT = "{{SNIFF_PORT}}"
$PANEL_PORT = "{{PANEL_PORT}}"
$WS_URL = "ws://${SERVER_IP}:${SNIFF_PORT}/admin"
$PANEL_URL = "http://${SERVER_IP}:${PANEL_PORT}"

function Write-Step {
    param([string]$Message, [string]$Status = "info")
    $colors = @{ info = "Cyan"; ok = "Green"; warn = "Yellow"; err = "Red" }
    $c = $colors[$Status]
    if (-not $c) { $c = "White" }
    Write-Host "[$($Status.ToUpper())] $Message" -ForegroundColor $c
}

function Write-Banner {
    Clear-Host
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "     QQ农场 - PC一键全栈配置工具" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host " 服务器: ${SERVER_IP}:${SNIFF_PORT}" -ForegroundColor Gray
    Write-Host " 面板: ${PANEL_URL}" -ForegroundColor Gray
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
}

# ========== 步骤1：检测/安装 Node.js ==========
function Ensure-NodeJS {
    Write-Step "步骤 1/4: 检测 Node.js 环境..." -Status "info"

    $nodePath = $null
    try { $nodePath = (Get-Command node -ErrorAction Stop).Source } catch {}

    if ($nodePath -and (Test-Path $nodePath)) {
        $ver = & $nodePath --version
        Write-Step "Node.js 已安装: $ver ($nodePath)" -Status "ok"
        return $nodePath
    }

    # 检查常见安装路径
    $commonPaths = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\fnm\nodejs\current\node.exe",
        "$env:USERPROFILE\AppData\Roaming\nvm\v*\node.exe"
    )
    foreach ($p in $commonPaths) {
        $expanded = [System.Environment]::ExpandEnvironmentVariables($p)
        $files = Get-ChildItem $expanded -ErrorAction SilentlyContinue
        if ($files) {
            $ver = & $files[0].FullName --version 2>$null
            Write-Step "Node.js 已安装: $ver ($($files[0].FullName))" -Status "ok"
            return $files[0].FullName
        }
    }

    Write-Step "未检测到 Node.js，正在自动下载安装..." -Status "warn"

    $installDir = "$env:LOCALAPPDATA\qq-farm-nodejs"
    $nodeExe = "$installDir\node.exe"

    if (Test-Path $nodeExe) {
        $ver = & $nodeExe --version 2>$null
        Write-Step "Node.js 已存在: $ver (缓存)" -Status "ok"
        return $nodeExe
    }

    try {
        $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
        $nodeVersion = "22.14.0"
        $url = "https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-win-${arch}.zip"
        $zipPath = "$env:TEMP\node.zip"
        $extractPath = "$env:TEMP\node-extract"

        Write-Step "   下载 Node.js $nodeVersion ($arch)..." -Status "info"
        Write-Step "   $url" -Status "info"

        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add("User-Agent", "QQFarm-Bot/1.0")
        $wc.DownloadFile($url, $zipPath)

        Write-Step "   下载完成，正在解压..." -Status "info"

        if (Test-Path $extractPath) { Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractPath)

        if (-not (Test-Path $installDir)) { New-Item -ItemType Directory -Path $installDir -Force | Out-Null }
        $extractedNode = Get-ChildItem -Path "$extractPath\node-v*-win-${arch}\node.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $extractedNode) { throw "解压后未找到 node.exe" }

        Copy-Item "$($extractedNode.Directory)\*" $installDir -Recurse -Force
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue

        if (Test-Path $nodeExe) {
            $ver = & $nodeExe --version
            Write-Step "Node.js 安装成功: $ver" -Status "ok"
            return $nodeExe
        } else { throw "安装后未找到 node.exe" }
    } catch {
        Write-Step "自动安装 Node.js 失败: $_" -Status "err"
        Write-Step "请手动安装 Node.js 后重试:" -Status "warn"
        Write-Step "  访问 https://nodejs.org/ 下载 LTS 版本" -Status "info"
        pause; exit 1
    }
}

# ========== 步骤2：下载补丁脚本 ==========
function Download-PatchScript {
    param([string]$NodePath)
    Write-Step "步骤 2/4: 下载补丁脚本..." -Status "info"

    $scriptFile = "$ScriptDir\patch-qq-farm-code-capture.js"
    $url = "${PANEL_URL}/api/pc-capture/download-patch"

    if (Test-Path $scriptFile) {
        Write-Step "补丁脚本已存在，跳过下载" -Status "ok"
        return $scriptFile
    }

    try {
        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add("User-Agent", "QQFarm-Bot/1.0")
        $wc.DownloadFile($url, $scriptFile)
        Write-Step "补丁脚本下载成功" -Status "ok"
        return $scriptFile
    } catch {
        Write-Step "下载失败，请检查网络连接" -Status "err"
        Write-Step "  手动下载: $url" -Status "info"
        pause; exit 1
    }
}

# ========== 步骤3：搜索QQ缓存目录 ==========
function Find-GameJs {
    Write-Step "步骤 3/4: 搜索QQ经典农场缓存..." -Status "info"

    $searchRoots = @(
        "$env:APPDATA\QQEX\miniapp",
        "$env:LOCALAPPDATA\QQEX\miniapp",
        "$env:USERPROFILE\.config\QQEX\miniapp",
        "$env:USERPROFILE\AppData\Local\QQ\QQEX\miniapp"
    )

    $found = @()
    foreach ($root in $searchRoots) {
        if (Test-Path $root) {
            $files = Get-ChildItem -Path $root -Filter "game.js" -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Directory.Name -like "1112386029_*" }
            foreach ($f in $files) { $found += $f.FullName }
        }
    }

    if ($found.Count -eq 0) {
        Write-Step "未找到QQ经典农场的游戏缓存" -Status "warn"
        Write-Step "请先打开PC QQ上的QQ经典农场（进入游戏即可），然后关闭QQ重新运行本脚本" -Status "warn"
        pause; exit 1
    }

    $latest = $found | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    Write-Step "找到游戏缓存: $($latest.FullName)" -Status "ok"
    return $latest.FullName
}

# ========== 步骤4：注入补丁 ==========
function Install-Patch {
    param([string]$NodePath, [string]$GameJsPath)
    Write-Step "步骤 4/4: 注入捕获补丁..." -Status "info"

    $patchScript = "$ScriptDir\patch-qq-farm-code-capture.js"

    try {
        $output = & $NodePath $patchScript --target $GameJsPath --capture-ws $WS_URL
        if ($LASTEXITCODE -eq 0) {
            Write-Step "补丁注入成功!" -Status "ok"
            Write-Step $output -Status "info"
            return $true
        } else {
            Write-Step "补丁注入可能未完全成功" -Status "warn"
            Write-Step $output -Status "info"
            return $false
        }
    } catch { Write-Step "补丁注入失败: $_" -Status "err"; return $false }
}

# ========== 主流程 ==========
try {
    Write-Banner

    if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
        Write-Step "建议以管理员身份运行以获得更好兼容性" -Status "warn"
        Write-Step "   右键本脚本 → 「以管理员身份运行」" -Status "info"
        Write-Host ""
    }

    $nodePath = Ensure-NodeJS
    $scriptFile = Download-PatchScript -NodePath $nodePath
    $gameJs = Find-GameJs
    $result = Install-Patch -NodePath $nodePath -GameJsPath $gameJs

    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    if ($result) {
        Write-Host "  ✅ 配置完成！" -ForegroundColor Green
        Write-Host "  请打开 PC QQ 上的 QQ经典农场" -ForegroundColor Cyan
        Write-Host "  Code 将自动被捕获并发送到服务器" -ForegroundColor Cyan
        Write-Host "  面板: ${PANEL_URL}" -ForegroundColor Cyan
    } else {
        Write-Host "  ⚠️ 配置未完全完成" -ForegroundColor Yellow
    }
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""

    # 可选：监视模式
    Write-Host "是否要监视QQ农场更新？（QQ更新后会重置补丁）" -ForegroundColor Cyan
    Write-Host "   [Y] 是 - 后台持续监视" -ForegroundColor Gray
    Write-Host "   [N] 否 - 退出（默认）" -ForegroundColor Gray
    $watchChoice = Read-Host "请选择 (Y/N)"
    if ($watchChoice -eq "y" -or $watchChoice -eq "Y") {
        $watchFile = "$ScriptDir\qq-farm-watch.ps1"
        $watchScript = @"
`$watcher = New-Object System.IO.FileSystemWatcher
`$watcher.Path = "$(Split-Path $gameJs -Parent)"
`$watcher.Filter = "game.js"
`$watcher.EnableRaisingEvents = `$true
Register-ObjectEvent `$watcher "Changed" -Action {
    Start-Sleep -Seconds 2
    & '$nodePath' '$scriptFile' --target '$gameJs' --capture-ws '$WS_URL'
} | Out-Null
Write-Host "监视中 (Ctrl+C 停止)" -ForegroundColor Green
while (`$true) { Start-Sleep -Seconds 10 }
"@
        $watchScript | Out-File -FilePath $watchFile -Encoding utf8
        Write-Step "监视已启动，关闭窗口即停止" -Status "ok"
        & powershell -NoProfile -File $watchFile
    }

    pause
} catch {
    Write-Host ""; Write-Step "脚本执行出错: $_" -Status "err"
    pause; exit 1
}

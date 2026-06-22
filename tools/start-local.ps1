$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Core = Join-Path $Root "core"
$Logs = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

if (-not $env:FARM_PANEL_API) { $env:FARM_PANEL_API = "http://127.0.0.1:3000/api/code-capture" }
if (-not $env:FARM_CAPTURE_USERNAME) { $env:FARM_CAPTURE_USERNAME = "admin" }
if (-not $env:FARM_CAPTURE_HOST) { $env:FARM_CAPTURE_HOST = "0.0.0.0" }
if (-not $env:FARM_CAPTURE_PORT) { $env:FARM_CAPTURE_PORT = "9988" }
if (-not $env:FARM_CAPTURE_LOG) { $env:FARM_CAPTURE_LOG = Join-Path $Logs "code-capture.log" }

Write-Host "[1/4] Build web"
pnpm -C (Join-Path $Root "web") build

Write-Host "[2/4] Stop old listeners on 3000/9988"
foreach ($port in 3000, 9988) {
  Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Where-Object { $_.OwningProcess -gt 0 } |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

Write-Host "[3/4] Start panel on http://0.0.0.0:3000"
Start-Process -FilePath node -ArgumentList "client.js" -WorkingDirectory $Core -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $Logs "panel.out.log") `
  -RedirectStandardError (Join-Path $Logs "panel.err.log")

Write-Host "[4/4] Start code capture on http://0.0.0.0:$env:FARM_CAPTURE_PORT/$env:FARM_CAPTURE_USERNAME"
Start-Process -FilePath python -ArgumentList "tools\sniff9988.py" -WorkingDirectory $Root -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $Logs "capture.out.log") `
  -RedirectStandardError (Join-Path $Logs "capture.err.log")

Write-Host "[extra] Patch QQ Farm mini-app when its cache appears"
$captureWs = "ws://127.0.0.1:$env:FARM_CAPTURE_PORT/$env:FARM_CAPTURE_USERNAME"
Start-Process -FilePath node -ArgumentList "tools\watch-qq-farm-code-capture.js --capture-ws $captureWs --username $env:FARM_CAPTURE_USERNAME" -WorkingDirectory $Root -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $Logs "patch.out.log") `
  -RedirectStandardError (Join-Path $Logs "patch.err.log")

Start-Sleep -Seconds 2
Get-NetTCPConnection -LocalPort 3000,9988 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess |
  Sort-Object LocalPort,State |
  Format-Table -AutoSize

Write-Host ""
Write-Host "Next:"
Write-Host "  1. Open QQ on this machine/server and scan the QQ login QR once."
Write-Host "  2. Open QQ Classic Farm once, wait 3 seconds, close it, then open it again."
Write-Host "  3. Watch logs\code-capture.log; captured code will auto-create/start the account."

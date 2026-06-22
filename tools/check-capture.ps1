$ErrorActionPreference = "SilentlyContinue"

Write-Host "Listeners:"
Get-NetTCPConnection -LocalPort 3000,9988 |
  Select-Object LocalAddress,LocalPort,State,OwningProcess |
  Sort-Object LocalPort,State |
  Format-Table -AutoSize

Write-Host ""
Write-Host "Capture endpoint test:"
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:9988/admin" -TimeoutSec 5
  Write-Host "Unexpected success: $($r.StatusCode)"
} catch {
  if ($_.Exception.Response) {
    $status = [int]$_.Exception.Response.StatusCode
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $body = $reader.ReadToEnd()
    Write-Host "Status: $status"
    Write-Host "Body: $body"
    if ($status -eq 400 -and $body -match "missing code") {
      Write-Host "OK: capture service is reachable. Missing code is expected for this dry run."
    }
  } else {
    Write-Host $_.Exception.Message
  }
}

Write-Host ""
Write-Host "ProxyPin redirect target:"
Write-Host "  http://SERVER_IP:9988/admin"

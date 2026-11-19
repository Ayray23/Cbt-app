# Pilot foreground process: use a managed service and UPS in production.
param(
  [Parameter(Mandatory=$true)][string]$Hostname,
  [string]$DatabasePath = 'C:\SchoolCBT\private\exams.sqlite'
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Test-Path (Split-Path -Parent $DatabasePath))) { throw 'Database directory missing. Run setup-staging.ps1 first.' }
$env:HOST = '127.0.0.1'
$env:PORT = '8788'
$env:CBT_LAN_DB = $DatabasePath
$env:CBT_LAN_PUBLIC_ORIGIN = "https://$Hostname"
Remove-Item Env:CBT_LAN_TLS_KEY,Env:CBT_LAN_TLS_CERT -ErrorAction SilentlyContinue
& node (Join-Path $root 'lan-server/server.js')
if ($LASTEXITCODE -ne 0) { throw 'LAN server stopped with an error.' }

# Pilot foreground process: keep Caddy CA storage persistent and protected.
param([Parameter(Mandatory=$true)][string]$Hostname)
$ErrorActionPreference = 'Stop'
$env:CBT_LAN_HOSTNAME = $Hostname
& caddy run --config (Join-Path $PSScriptRoot 'Caddyfile') --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'Caddy stopped with an error.' }

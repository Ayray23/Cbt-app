# Run in PowerShell on the dedicated school host (Node 24+, Caddy in PATH).
# Prepares and validates the PR #17 offline LAN portal; does NOT serve
# the Firebase-dependent React frontend or install certificate trust.
param(
  [Parameter(Mandatory=$true)][string]$Hostname,
  [string]$DatabasePath = 'C:\SchoolCBT\private\exams.sqlite'
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 or later.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Install npm.' }
if (-not (Get-Command caddy -ErrorAction SilentlyContinue)) { throw 'Install Caddy and add it to PATH.' }
$nodeVersion = (& node --version).TrimStart('v')
if ([int]($nodeVersion.Split('.')[0]) -lt 24) { throw "Node.js 24+ required; installed: $nodeVersion" }
if ($Hostname -notmatch '^[a-zA-Z0-9.-]+$' -or $Hostname -notmatch '\.') { throw 'Provide a DNS hostname, not an IP address or URL.' }

$dbFolder = Split-Path -Parent $DatabasePath
New-Item -ItemType Directory -Path $dbFolder -Force | Out-Null
$env:CBT_LAN_HOSTNAME = $Hostname
& caddy validate --config (Join-Path $PSScriptRoot 'Caddyfile') --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'Caddyfile validation failed.' }
& npm test --prefix (Join-Path $root 'lan-server')
if ($LASTEXITCODE -ne 0) { throw 'LAN server tests failed.' }
$answer = Resolve-DnsName -Name $Hostname -Type A -ErrorAction SilentlyContinue
if (-not $answer) { Write-Warning "$Hostname does not yet resolve; set up the school LAN DNS before testing." }
Write-Host 'LAN staging checks passed. This is NOT a 500-device certification.' -ForegroundColor Green
Write-Host "Private SQLite path: $DatabasePath"
Write-Host "Import online-prepared bundles with: cd lan-server; `$env:CBT_LAN_DB='$DatabasePath'; node manage.js import <private-bundle.json>"
Write-Host "Then start the Node host and Caddy proxy in separate terminals using start-lan.ps1 and start-proxy.ps1."
Write-Host "Configure the firewall: only school subnet -> TCP 443; NEVER expose TCP 8788 or Caddy admin port."
Write-Host 'Trust Caddy internal CA on each managed exam PC before the pilot. Never bypass browser TLS warnings.'

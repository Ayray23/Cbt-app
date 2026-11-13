# Run from the repository root in an elevated PowerShell terminal.
# Requires Node.js 22+, npm, Caddy, and an installed private LAN DNS record.
# This config is a STAGING UI: Firebase-dependent exams are not yet offline-ready.
$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Install Node.js 22+ first." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "Install npm first." }
if (-not (Get-Command caddy -ErrorAction SilentlyContinue)) { throw "Install Caddy and put caddy.exe in PATH." }
$nodeMajor = [int]((node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) { throw "Node.js 22+ is required." }

Push-Location "cbt-app"
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
} finally { Pop-Location }

Write-Host "Built frontend for staging. Before starting Caddy:"
Write-Host "1. Configure DNS cbt.school.test -> server LAN IP."
Write-Host "2. Allow inbound TCP 443 only from the trusted school subnet."
Write-Host "3. Run: caddy run --config school-deployment/Caddyfile"
Write-Host "4. Trust the Caddy root CA on ALL managed student devices."
Write-Host "5. Open https://cbt.school.test and check that the browser shows no TLS warning."
Write-Warning "Firebase login/exam start still needs connectivity. Do NOT use as a production offline CBT yet."

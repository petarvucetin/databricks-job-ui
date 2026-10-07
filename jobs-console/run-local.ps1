# Runs the prebuilt app in deploy/ on this machine against a Databricks workspace: no npm install, only Node 22+
# and a Databricks CLI login. Usage:  .\run-local.ps1 -Profile gov   (then open http://127.0.0.1:8000)
param(
  [Parameter(Mandatory = $true)][string]$Profile,
  [int]$Port = 8000,
  [ValidateSet('live', 'mock')][string]$Data = 'live',
  # SQL warehouse id for run history from system tables; without it history falls back to the API.
  [string]$Warehouse = ''
)
$ErrorActionPreference = 'Stop'
$deploy = Join-Path $PSScriptRoot 'deploy'
if (-not (Test-Path (Join-Path $deploy 'server.mjs'))) { throw "No deploy\server.mjs: run 'git pull' (or 'npm run package' on a dev machine)." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not on PATH (need v22 or later).' }

$env:NODE_ENV = 'production'
$env:JOBS_CONSOLE_DATA = $Data
# Locally "app" means: read as the CLI profile's identity (you), not a forwarded Apps user token.
$env:JOBS_CONSOLE_AUTH = 'app'
$env:DATABRICKS_CONFIG_PROFILE = $Profile
$env:DATABRICKS_APP_PORT = "$Port"
if ($Warehouse) { $env:DATABRICKS_WAREHOUSE_ID = $Warehouse }
# Listen on this machine only. The default, 0.0.0.0, is not browsable (corporate web filters block it) and exposes the app on the network.
$env:FLASK_RUN_HOST = '127.0.0.1'

Write-Host "jobs-console: $Data data, profile '$Profile', http://127.0.0.1:$Port  (Ctrl+C to stop)"
Push-Location $deploy   # the server serves the page from public\ under the current folder
try { node server.mjs } finally { Pop-Location }
